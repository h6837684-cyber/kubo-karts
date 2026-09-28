// KUBO KARTS — LAN HOST v3.7: the HOST PHONE is the server (no PC, no internet)
//
// The Android "LanServer" plugin (android-plugin/…/LanServerPlugin.java) opens
// a WebSocket server on port 3003 of the phone. It only moves bytes; the room
// logic is room-core.ts running right here in the game page. Friends on the
// same Wi-Fi — or connected to the host's HOTSPOT — join with the host's IP.
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { RoomServer } from './room-core';
import { serveRaw } from './link';

export const LAN_PORT = 3003;

export interface LanAddr { ip: string; iface?: string; kind?: 'hotspot' | 'wifi' | 'usb' | 'lan' | 'other' }
export interface FoundHost { ip: string; port: number; name: string }

interface LanServerPlugin {
  start(o: { port: number; name?: string }): Promise<{ ips: string[]; addrs?: LanAddr[]; port: number }>;
  stop(): Promise<void>;
  getIps(): Promise<{ ips: string[]; addrs?: LanAddr[] }>;
  setName(o: { name: string }): Promise<void>;
  discover(o: { timeoutMs: number }): Promise<{ hosts: FoundHost[] }>;
  sendBatch(o: { items: { id: string; data: string }[] }): Promise<void>;
  closeClient(o: { id: string }): Promise<void>;
  addListener(ev: 'open', fn: (e: { id: string; addr?: string }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'message', fn: (e: { id: string; data: string }) => void): Promise<PluginListenerHandle>;
  addListener(ev: 'close', fn: (e: { id: string }) => void): Promise<PluginListenerHandle>;
}

const LanServer = registerPlugin<LanServerPlugin>('LanServer');

export function isNativeApp(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/** best address to show friends: private Wi-Fi/hotspot IPv4 first */
export function pickLanIp(ips: string[]): string {
  // v3.8: the plugin already drops VPN (tun0) and mobile-data (rmnet) addresses
  // and sorts hotspot → Wi-Fi → USB → LAN, so the first private one is right.
  const priv = ips.filter(a => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a));
  return priv[0] ?? '';
}

class LanHost {
  server: RoomServer | null = null;
  ip = '';
  /** v3.8: every reachable address (hotspot + Wi-Fi…) — the lobby lists them all */
  addrs: LanAddr[] = [];
  /** v3.9: false when the native LanServer plugin is NOT inside the APK
   *  (app built without `npm run android:sync`) — the lobby says so clearly
   *  instead of showing an empty IP forever. */
  pluginOk = true;
  private name = 'KUBO';
  private handles: PluginListenerHandle[] = [];
  private peers = new Map<string, ReturnType<typeof serveRaw>>();
  private outbox: { id: string; data: string }[] = [];
  private flushQueued = false;
  private starting: Promise<RoomServer> | null = null;

  /** one bridge call per tick instead of one per message per player */
  private queueSend(id: string, data: string) {
    this.outbox.push({ id, data });
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      const items = this.outbox;
      this.outbox = [];
      if (items.length) LanServer.sendBatch({ items }).catch(() => { /* server stopped */ });
    });
  }

  async start(): Promise<RoomServer> {
    if (this.server) return this.server;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const server = new RoomServer({ log: (m) => console.log('[lan-host]', m) });
      this.handles.push(await LanServer.addListener('open', (e) => {
        const id = e.id;
        this.peers.set(id, serveRaw(server, id,
          (text) => this.queueSend(id, text),
          () => { LanServer.closeClient({ id }).catch(() => { /* already gone */ }); }));
      }));
      this.handles.push(await LanServer.addListener('message', (e) => {
        this.peers.get(e.id)?.onText(e.data);
      }));
      this.handles.push(await LanServer.addListener('close', (e) => {
        const p = this.peers.get(e.id);
        this.peers.delete(e.id);
        p?.onClose();
      }));
      try {
        const r = await LanServer.start({ port: LAN_PORT, name: this.name });
        this.setAddrs(r.ips ?? [], r.addrs);
      } catch (err) {
        if (/not implemented|UNIMPLEMENTED|not available/i.test(String((err as { message?: string })?.message ?? err))) this.pluginOk = false;
        for (const h of this.handles) h.remove().catch(() => { /* */ });
        this.handles = [];
        server.dispose();
        throw err;
      }
      this.server = server;
      return server;
    })();
    try { return await this.starting; } finally { this.starting = null; }
  }

  /** refresh the IP (the phone may have switched Wi-Fi / turned on hotspot) */
  async refreshIp(): Promise<string> {
    // v3.8: an EMPTY list is real information (Wi-Fi + hotspot both off) — the
    // old code kept showing a stale IP forever.
    try {
      const r = await LanServer.getIps();
      this.pluginOk = true;
      this.setAddrs(r.ips ?? [], r.addrs);
    } catch (err) {
      if (/not implemented|UNIMPLEMENTED|not available/i.test(String((err as { message?: string })?.message ?? err))) this.pluginOk = false;
    }
    return this.ip;
  }

  private setAddrs(ips: string[], addrs?: LanAddr[]) {
    this.addrs = addrs && addrs.length ? addrs : ips.map(ip => ({ ip }));
    this.ip = pickLanIp(this.addrs.map(a => a.ip));
  }

  /** room name friends see in the auto-discovery list */
  setName(name: string) {
    this.name = (name || 'KUBO').slice(0, 24);
    if (this.server) LanServer.setName({ name: this.name }).catch(() => { /* old plugin */ });
  }

  /** v3.8 joiner: find hosts on this Wi-Fi / hotspot automatically */
  async discover(timeoutMs = 2500): Promise<FoundHost[]> {
    if (!isNativeApp()) return [];
    try { const r = await LanServer.discover({ timeoutMs }); return r.hosts ?? []; }
    catch { return []; }
  }

  async stop() {
    for (const h of this.handles) h.remove().catch(() => { /* */ });
    this.handles = [];
    this.peers.clear();
    this.server?.dispose();
    this.server = null;
    await LanServer.stop().catch(() => { /* not running */ });
  }
}

export const lanHost = new LanHost();
