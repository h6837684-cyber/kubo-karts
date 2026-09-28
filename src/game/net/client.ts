// KUBO KARTS - Multiplayer client v3 (socket.io): IP-based Wi-Fi rooms.
// The HOST opens a server (and sees the address to share), joiners connect by
// entering that address. No room codes anymore (user request).
//
// v1.13 WIFI FIX (user: "شبکه وای‌فای هنوز کار نمیکنه … ببین مشکل ساخت سرور
// چیه و حلش کن") — root causes found & fixed here:
//  1. The mp-service is a SEPARATE process (port 3003). When it is down,
//     every create/join silently failed. Now the client pings the self-heal
//     endpoint /api/mp-health (which auto-starts the service) and retries.
//  2. Join-by-address only worked through the site gateway. On a real LAN
//     (host runs the source bundle) the address must go DIRECT to port 3003 —
//     connect() now races BOTH routes and uses whichever answers first.
//  3. connect() never resolved on a slow/half-open socket (no timeout race) —
//     joiners were stuck on "connecting" forever. Hard 7s deadline now.
//
// v3.7 APK / NO-INTERNET MULTIPLAYER (user: "چند نفر بدون نت با وای‌فای بازی
// میکنند"): socket.io is gone. The client now speaks a tiny plain-WebSocket
// protocol (net/link.ts). In the ANDROID APP the host phone runs the room
// itself (net/lan-host.ts + the LanServer plugin), friends connect straight to
// ws://<host-ip>:3003 over Wi-Fi or the host's hotspot. On the web/desktop the
// same protocol talks to mini-services/mp-server (which runs the same room code).
import { WsLink, LocalLink, type Link } from './link';
import { lanHost, isNativeApp, LAN_PORT } from './lan-host';

export interface MpPlayer {
  id: string;
  name: string;
  char: string;
  car: string;
  color: string;
  ready: boolean;
  isHost: boolean;
  /** v1.21: false while the player is inside the reconnect grace window */
  online?: boolean;
}

export interface MpSettings {
  theme: string;
  laps: number;
  bots: number;
  items: string[];
  /** v3.1: lucky boxes vs real items on the road */
  itemMode?: 'mystery' | 'placed';
}

export interface MpLobby {
  code: string;
  players: MpPlayer[];
  settings: MpSettings;
  started: boolean;
  /** HOST's unlocked cars — joiners may pick them (multiplayer only) */
  hostCars?: string[];
}

export interface MpStartInfo {
  theme: string;
  laps: number;
  bots: number;
  items: string[];
  itemMode?: 'mystery' | 'placed';
  seed: number;
  players: MpPlayer[];
  yourId: string;
}

const NATIVE = typeof window !== 'undefined' && isNativeApp();

/** v1.21: real LAN IP of the host machine (fetched once from /api/lan-ip).
 *  v3.7: never called inside the APK (there is no /api there). */
let webLanHost = '';
if (typeof window !== 'undefined' && !NATIVE && /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname)) {
  fetch('/api/lan-ip', { cache: 'no-store' }).then(r => r.json()).then((j: { ips?: string[]; port?: number }) => {
    const ip = (j.ips ?? []).find(a => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a)) ?? j.ips?.[0];
    if (ip) webLanHost = `${ip}:${location.port || j.port || 3000}`;
  }).catch(() => { /* no API (static build) */ });
}
/** v3.7 APK: the host address a joiner is connected to (shown in the lobby) */
let nativeJoinedHost = '';
/** v3.7 APK: true while THIS phone is the server */
let nativeHosting = false;

export function isApp(): boolean { return NATIVE; }

/** the LAN address other players should join (this game server's host) —
 *  never "localhost" when a real Wi-Fi IP is known */
export function serverAddress(): string {
  if (NATIVE) {
    if (nativeHosting) return lanHost.ip || '—';
    return nativeJoinedHost || lanHost.ip || '—';
  }
  return webLanHost || location.host || 'localhost:3000';
}

/** v3.8 APK host: every address friends can use (hotspot + Wi-Fi…), best first */
export function hostAddrList(): { ip: string; kind?: string }[] {
  return NATIVE ? lanHost.addrs.slice() : [];
}
/** v3.9: why no IP is shown ('' = no problem) */
export function hostIpProblem(): '' | 'no-plugin' | 'no-network' {
  if (!NATIVE) return '';
  if (!lanHost.pluginOk) return 'no-plugin';
  return lanHost.addrs.length ? '' : 'no-network';
}
/** v3.8 APK host: re-read the phone's IPs (Wi-Fi / hotspot may change) */
export async function refreshHostAddr(): Promise<string> {
  if (!NATIVE) return serverAddress();
  await lanHost.refreshIp();
  return serverAddress();
}
/** v3.8 APK joiner: scan the Wi-Fi / hotspot for hosts (no typing) */
export function discoverHosts(timeoutMs = 2500) { return lanHost.discover(timeoutMs); }
/** v3.8: room name broadcast to the discovery list */
export function setHostName(name: string) { lanHost.setName(name); }

/** the FULL clickable URL a host can simply send to friends (v1.13).
 *  v3.7 APK: friends TYPE the IP into their own app, so no http:// prefix. */
export function fullShareUrl(): string {
  if (NATIVE) return serverAddress();
  return `${location.protocol}//${serverAddress()}`;
}

/** v3.7: Persian/Arabic keyboards type ۱۹۲٫۱۶۸… — normalise to 192.168… */
export function normalizeAddr(raw: string): string {
  return raw.trim()
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u066B\u060C\u3002\uFF0E]/g, '.')   // ٫ ، 。 ．
    .replace(/\s+/g, '')
    .replace(/^(https?|wss?):\/\//i, '')
    .replace(/\/+$/, '');
}

/** candidate socket URLs for a typed/raw address (v1.13) — gateway route first
 *  (works on the hosted site), then the direct :3003 route (real LAN). */
function candidateUrls(addr?: string): string[] {
  const q = new URLSearchParams(location.search).get('mp');
  if (q) return [q];
  if (NATIVE) {
    // v3.7 APK: always a DIRECT link to the host phone's LanServer (port 3003).
    // No gateway route here — XTransformPort only exists on the hosted site.
    const a = normalizeAddr(addr ?? '') || '127.0.0.1';
    const m = /^(.*?)(?::(\d{1,5}))?$/.exec(a)!;
    const host = m[1], port = m[2];
    const urls = [`ws://${host}:${port || LAN_PORT}`];
    // people used to type ":3000" (the old web address) → also try the game port
    if (port && Number(port) !== LAN_PORT) urls.push(`ws://${host}:${LAN_PORT}`);
    return urls;
  }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  if (addr && addr.trim()) {
    const a = normalizeAddr(addr);
    // explicit port typed by the user → respect it (gateway transform first,
    // then the exact address as given)
    if (/:{1,5}\d+$/.test(a)) {
      return [`${proto}://${a}/?XTransformPort=3003`, `${proto}://${a}`];
    }
    // bare host → gateway on the site port, then direct service port
    return [`${proto}://${a}/?XTransformPort=3003`, `${proto}://${a}:3003`];
  }
  return [`${proto}://${location.host}/?XTransformPort=3003`];
}

export class MpClient {
  socket: Link | null = null;
  lobby: MpLobby | null = null;
  /** STABLE player id from the server (v1.21: survives reconnects) */
  myId = '';

  onLobby: ((l: MpLobby) => void) | null = null;
  onStart: ((info: MpStartInfo) => void) | null = null;
  onPeerState: ((id: string, s: Record<string, unknown>) => void) | null = null;
  onPeerFinish: ((id: string, timeMs: number) => void) | null = null;
  onPeerItem: ((id: string, item: string, backward: boolean) => void) | null = null;
  onHostChanged: ((newHostId: string) => void) | null = null;
  onPeerLeft: ((id: string, name: string) => void) | null = null;
  onPeerLost: ((id: string, name: string) => void) | null = null;
  onPeerBack: ((id: string, name: string) => void) | null = null;
  onPlayerJoined: ((name: string) => void) | null = null;
  /** final: the link is gone and could not be resumed */
  onDisconnect: (() => void) | null = null;
  onReconnecting: ((attempt: number) => void) | null = null;
  onReconnected: ((info: { started: boolean }) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  connected = false;
  /** v1.13: how the current session reached the server (diagnostics + tests) */
  activeUrl = '';
  /** v1.21: smoothed round-trip time in ms (-1 = unknown) */
  rttMs = -1;
  reconnecting = false;
  private token = '';
  private userClosed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private wire(socket: Link) {
    socket.on('room', (l: MpLobby) => {
      this.lobby = l;
      this.onLobby?.(l);
    });
    socket.on('session', (m: { pid: string; token: string }) => { this.myId = m.pid; this.token = m.token; });
    socket.on('started', (info: MpStartInfo) => this.onStart?.(info));
    socket.on('s', (msg: { id: string; s: Record<string, unknown> }) => this.onPeerState?.(msg.id, msg.s));
    socket.on('u', (msg: { id: string; it: string; b: boolean }) => this.onPeerItem?.(msg.id, msg.it, !!msg.b));
    socket.on('finish', (msg: { id: string; timeMs: number }) => this.onPeerFinish?.(msg.id, msg.timeMs));
    socket.on('hostChanged', (msg: { id: string }) => this.onHostChanged?.(msg.id));
    socket.on('peerLeft', (msg: { id: string; name: string }) => this.onPeerLeft?.(msg.id, msg.name));
    socket.on('peerLost', (msg: { id: string; name: string }) => this.onPeerLost?.(msg.id, msg.name));
    socket.on('peerBack', (msg: { id: string; name: string }) => this.onPeerBack?.(msg.id, msg.name));
    socket.on('playerJoined', (msg: { name: string }) => this.onPlayerJoined?.(msg.name));
    socket.on('errorMsg', (msg: { m: string }) => this.onError?.(msg.m));
  }

  /** open ONE socket to `url`; resolves once connected, rejects on error /
   *  deadline / abort. It does NOT adopt the socket — the caller decides. */
  private dial(url: string, timeoutMs: number, abort: { done: boolean }): Promise<Link> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket: Link = new WsLink(url);
      const kill = () => { try { socket.disconnect(); } catch { /* never connected */ } };
      const to = setTimeout(() => {
        if (settled) return;
        settled = true; kill(); reject(new Error('TIMEOUT'));
      }, timeoutMs);
      socket.once('connect', () => {
        if (settled) { kill(); return; }
        settled = true; clearTimeout(to);
        // v1.21 BUGFIX: a route that answers AFTER another already won must
        // close itself — before, two routes connecting together both got
        // adopted and one socket stayed open forever (extra player / leak).
        if (abort.done) { kill(); reject(new Error('LOST_RACE')); return; }
        resolve(socket);
      });
      socket.once('connect_error', (e: Error) => {
        if (settled) return;
        settled = true; clearTimeout(to); kill();
        reject(new Error(e?.message || 'CONNECT_ERROR'));
      });
    });
  }

  /** race several routes; the FIRST to connect wins immediately (no waiting
   *  for the slowest route), every loser is closed. */
  private raceUrls(urls: string[], timeoutMs: number): Promise<{ socket: Link; url: string }> {
    const abort = { done: false };
    return new Promise((resolve, reject) => {
      let pending = urls.length;
      if (!pending) { reject(new Error('NO_ROUTE')); return; }
      for (const u of urls) {
        this.dial(u, timeoutMs, abort).then((sock) => {
          if (abort.done) { try { sock.disconnect(); } catch { /* */ } return; }
          abort.done = true;
          resolve({ socket: sock, url: u });
        }).catch(() => {
          if (--pending === 0 && !abort.done) { abort.done = true; reject(new Error('ALL_FAILED')); }
        });
      }
    });
  }

  private adopt(socket: Link, url: string) {
    this.socket = socket;
    this.activeUrl = url;
    this.connected = true;
    if (NATIVE && url.startsWith('ws')) {
      const h = url.replace(/^wss?:\/\//, '').replace(/\/.*$/, '');
      nativeJoinedHost = h.endsWith(':' + LAN_PORT) ? h.slice(0, -(String(LAN_PORT).length + 1)) : h;
    }
    if (!this.myId) this.myId = socket.id ?? '';
    this.wire(socket);
    socket.on('disconnect', () => this.handleDrop(socket));
    socket.on('connect_error', (e: Error) => this.onError?.(e.message));
    this.startPing();
  }

  /** v1.21 RTT: ack'd ping every 2s, exponentially smoothed */
  private startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const tick = () => {
      const s = this.socket;
      if (!s || !this.connected) return;
      const t0 = performance.now();
      s.emit('pingx', t0, () => {
        const rtt = performance.now() - t0;
        this.rttMs = this.rttMs < 0 ? rtt : this.rttMs * 0.7 + rtt * 0.3;
      });
    };
    tick();
    this.pingTimer = setInterval(tick, 2000);
  }

  /** the socket dropped: unless WE closed it, try to resume the seat */
  private async handleDrop(sock: Link) {
    if (sock !== this.socket) return;         // an old/replaced socket
    this.connected = false;
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.userClosed || !this.token || !this.activeUrl) { this.socket = null; this.onDisconnect?.(); return; }
    this.socket = null;
    this.reconnecting = true;
    // backoff 0.5 1 2 3 4 4 4 … s  (≈18s total — inside the server's 20s grace)
    const waits = [500, 1000, 2000, 3000, 4000, 4000, 4000];
    for (let i = 0; i < waits.length; i++) {
      if (this.userClosed) break;
      this.onReconnecting?.(i + 1);
      await new Promise(r => setTimeout(r, waits[i]));
      if (this.userClosed) break;
      try {
        const { socket, url } = await this.raceUrls([this.activeUrl], 3000);
        const ok = await new Promise<{ started: boolean } | null>((res) => {
          const to = setTimeout(() => res(null), 3000);
          socket.once('resumed', (m: { started: boolean; info: MpStartInfo | null }) => { clearTimeout(to); res({ started: !!m?.started }); });
          socket.once('resumeFail', () => { clearTimeout(to); res(null); });
          socket.once('session', (m: { pid: string; token: string }) => { this.myId = m.pid; this.token = m.token; });
          socket.emit('resume', { token: this.token });
        });
        if (!ok) { try { socket.disconnect(); } catch { /* */ } break; }   // seat is gone
        this.adopt(socket, url);
        this.reconnecting = false;
        this.onReconnected?.(ok);
        return;
      } catch { /* try again */ }
    }
    this.reconnecting = false;
    this.token = '';
    this.lobby = null;
    this.onDisconnect?.();
  }

  /** ask the game server to (re)start the mp service, then give it a moment */
  private async selfHeal(): Promise<boolean> {
    if (NATIVE) return false;   // v3.7: no Node server inside the APK
    try {
      const r = await fetch('/api/mp-health', { cache: 'no-store' });
      const j = await r.json() as { ok?: boolean; started?: boolean };
      return !!j.ok;
    } catch { return false; }
  }

  /** v3.7: "BECOME SERVER". In the APK this phone starts its own LanServer
   *  and plugs into it in-process; on the web it is the classic connect(). */
  async connectHost(): Promise<void> {
    if (!NATIVE) { nativeHosting = false; return this.connect(); }
    if (this.connected && this.socket) {
      if (this.activeUrl === 'local') return;
      this.disconnect();                        // was a joiner elsewhere → switch roles
    }
    this.userClosed = false;
    let server;
    try { server = await lanHost.start(); } catch { throw new Error('HOST_FAILED'); }
    await lanHost.refreshIp();
    const link = new LocalLink(server);
    await new Promise<void>((res) => link.once('connect', () => res()));
    nativeHosting = true;
    this.adopt(link, 'local');
  }

  async connect(addr?: string): Promise<void> {
    if (this.connected && this.socket) {
      // v3.7 BUGFIX: pressing JOIN while still linked to ANOTHER server silently
      // re-used the old link and joined the wrong game. Different target → re-dial.
      if (!addr || candidateUrls(addr).includes(this.activeUrl)) return;
      this.disconnect();
    }
    nativeHosting = false;
    this.userClosed = false;
    const urls = candidateUrls(addr);
    try {
      const { socket, url } = await this.raceUrls(urls, 6000);
      this.adopt(socket, url);
      return;
    } catch { /* every route failed */ }
    // EVERY route failed → the service is probably DOWN: self-heal + one retry
    const healed = await this.selfHeal();
    if (healed) {
      await new Promise(res => setTimeout(res, 700));
      try {
        const { socket, url } = await this.raceUrls(urls, 5000);
        this.adopt(socket, url);
        return;
      } catch { /* still down */ }
    }
    throw new Error('MP_OFFLINE');
  }

  create(name: string, char: string, car: string, settings: Partial<MpSettings>, ownedCars?: string[]) {
    this.socket?.emit('create', { name, char, car, settings, ownedCars });
  }
  join(name: string, char: string, car: string) {
    this.socket?.emit('join', { name, char, car });
  }
  sel(car: string, char: string) {
    this.socket?.emit('sel', { car, char });
  }
  setSettings(s: Partial<MpSettings>) {
    this.socket?.emit('settings', s);
  }
  leave() {
    this.socket?.emit('leave');
    this.lobby = null;
    this.token = '';
  }
  setReady(v: boolean) { this.socket?.emit('ready', v); }
  startRace() { this.socket?.emit('start'); }
  /** v1.11: host returns to the lobby after a race → the room REOPENS */
  reopen() { this.socket?.emit('reopen'); }
  /** v1.11: quitting to the menu frees the room slot immediately */
  quitRoom() { this.socket?.emit('quitRoom'); this.token = ''; }
  sendState(s: Record<string, unknown>) { if (this.connected) this.socket?.emit('s', s); }
  /** v1.21: tell the room I fired a power-up (they simulate it too) */
  sendItem(it: string, backward: boolean) { if (this.connected) this.socket?.emit('u', { it, b: backward }); }
  sendFinish(timeMs: number) { this.socket?.emit('finish', { timeMs }); }
  disconnect() {
    this.userClosed = true;
    this.token = '';
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    const s = this.socket;
    // v3.5: an intentional quit frees the seat at once (no ghost seat for the grace window)
    if (s && this.connected) { try { s.emit('quitRoom'); } catch { /* socket already gone */ } }
    this.socket = null;
    this.connected = false;
    s?.disconnect();
  }
}
