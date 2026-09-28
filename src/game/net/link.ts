// KUBO KARTS — LINK v3.7: tiny socket.io replacement (zero dependencies)
//
// Why: socket.io needs a Node/bun server — impossible inside an APK. The new
// host (Android plugin) and the desktop mp-server both speak this plain
// WebSocket protocol instead:
//     frame  = JSON  [event, data]            fire-and-forget
//              JSON  [event, data, ackId]     sender wants an answer
//     answer = JSON  ["@ack", data, ackId]
// Local pseudo-events on the client side: 'connect', 'connect_error', 'disconnect'.
import type { ConnHandlers, RoomConn, RoomServer } from './room-core';

type Fn = (...a: any[]) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

export const ACK = '@ack';

export function encodeFrame(ev: string, data?: unknown, ackId?: number): string {
  return JSON.stringify(ackId === undefined ? [ev, data ?? null] : [ev, data ?? null, ackId]);
}
export function decodeFrame(raw: string): { ev: string; data: unknown; ackId?: number } | null {
  try {
    const a = JSON.parse(raw);
    if (!Array.isArray(a) || typeof a[0] !== 'string') return null;
    return { ev: a[0], data: a[1], ackId: typeof a[2] === 'number' ? a[2] : undefined };
  } catch { return null; }
}

/** what the MpClient needs from a connection (subset of the old socket.io Socket) */
export interface Link {
  id: string;
  on(ev: string, fn: Fn): void;
  once(ev: string, fn: Fn): void;
  emit(ev: string, data?: unknown, ack?: Fn): void;
  disconnect(): void;
}

class Emitter {
  private map = new Map<string, Set<Fn>>();
  on(ev: string, fn: Fn) { (this.map.get(ev) ?? this.map.set(ev, new Set()).get(ev)!).add(fn); }
  once(ev: string, fn: Fn) {
    const w: Fn = (...a) => { this.map.get(ev)?.delete(w); fn(...a); };
    this.on(ev, w);
  }
  protected fire(ev: string, ...a: unknown[]) {
    const set = this.map.get(ev);
    if (!set) return;
    for (const fn of [...set]) { try { fn(...a); } catch (e) { console.error('[link]', ev, e); } }
  }
}

let linkSeq = 0;

// ------------------------------------------------------------------ client over a real WebSocket
export class WsLink extends Emitter implements Link {
  id = 'c' + (++linkSeq) + '_' + Math.random().toString(36).slice(2, 8);
  private ws: WebSocket;
  private acks = new Map<number, Fn>();
  private ackSeq = 0;
  private open = false;
  private closed = false;
  private lastIn = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  /** silenceMs: a link with no inbound traffic for this long is treated as dead
   *  (the client pings every 2s, so a live server always answers). Browsers can
   *  take MINUTES to notice a Wi-Fi drop on their own. */
  private silenceMs: number;
  constructor(url: string, silenceMs = 9000) {
    super();
    this.silenceMs = silenceMs;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.open = true;
      this.lastIn = Date.now();
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastIn > this.silenceMs) this.drop();
      }, 1000);
      this.fire('connect');
    };
    this.ws.onmessage = (e: MessageEvent) => {
      this.lastIn = Date.now();
      if (typeof e.data !== 'string') return;
      const f = decodeFrame(e.data);
      if (!f) return;
      if (f.ev === ACK) {
        const fn = f.ackId !== undefined ? this.acks.get(f.ackId) : undefined;
        if (fn) { this.acks.delete(f.ackId!); fn(f.data); }
        return;
      }
      this.fire(f.ev, f.data);
    };
    this.ws.onerror = () => {
      if (!this.open && !this.closed) { this.closed = true; this.fire('connect_error', new Error('CONNECT_ERROR')); }
    };
    this.ws.onclose = () => {
      if (!this.open) {
        if (!this.closed) { this.closed = true; this.fire('connect_error', new Error('CONNECT_ERROR')); }
        return;
      }
      this.drop();
    };
  }

  private drop() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    if (this.watchdog) { clearInterval(this.watchdog); this.watchdog = null; }
    this.acks.clear();
    try { this.ws.close(); } catch { /* already closed */ }
    this.fire('disconnect');
  }

  emit(ev: string, data?: unknown, ack?: Fn) {
    if (!this.open || this.ws.readyState !== 1) return;
    let id: number | undefined;
    if (ack) {
      id = ++this.ackSeq;
      this.acks.set(id, ack);
      if (this.acks.size > 64) this.acks.delete(this.acks.keys().next().value as number);
    }
    try { this.ws.send(encodeFrame(ev, data, id)); } catch { this.drop(); }
  }

  disconnect() {
    if (!this.open) {
      this.closed = true;
      try { this.ws.close(); } catch { /* never opened */ }
      return;
    }
    this.drop();
  }
}

// ------------------------------------------------------------------ in-process link (host phone ↔ its own RoomServer)
/** The host phone does not need a network hop to reach its OWN room: this link
 *  plugs the MpClient straight into the RoomServer running in the same page.
 *  Messages are delivered asynchronously to keep the same ordering semantics
 *  as a real socket. */
export class LocalLink extends Emitter implements Link {
  id = 'local_' + (++linkSeq);
  private h: ConnHandlers | null = null;
  private alive = false;

  private server: RoomServer;
  constructor(server: RoomServer) {
    super();
    this.server = server;
    setTimeout(() => {
      const conn: RoomConn = {
        id: this.id,
        send: (ev, data) => {
          if (!this.alive) return;
          const copy = data === undefined ? null : JSON.parse(JSON.stringify(data));
          setTimeout(() => { if (this.alive) this.fire(ev, copy); }, 0);
        },
        close: () => this.disconnect(),
      };
      this.alive = true;
      this.h = this.server.connect(conn);
      this.fire('connect');
    }, 0);
  }

  emit(ev: string, data?: unknown, ack?: Fn) {
    if (!this.alive || !this.h) return;
    const copy = data === undefined ? null : JSON.parse(JSON.stringify(data));
    const h = this.h;
    setTimeout(() => {
      if (!this.alive) return;
      h.onEvent(ev, copy, ack ? (d: unknown) => setTimeout(() => ack(d), 0) : undefined);
    }, 0);
  }

  disconnect() {
    if (!this.alive) return;
    this.alive = false;
    this.h?.onClose();
    this.h = null;
    this.fire('disconnect');
  }
}

// ------------------------------------------------------------------ server-side adapter
/** glue one raw text connection (Android socket, Node socket…) to a RoomServer */
export function serveRaw(server: RoomServer, id: string, sendRaw: (text: string) => void, closeRaw: () => void) {
  const conn: RoomConn = {
    id,
    send: (ev, data) => sendRaw(encodeFrame(ev, data)),
    close: closeRaw,
  };
  const h = server.connect(conn);
  return {
    onText(text: string) {
      const f = decodeFrame(text);
      if (!f || f.ev === ACK) return;
      const ack = f.ackId !== undefined ? (d: unknown) => sendRaw(encodeFrame(ACK, d, f.ackId)) : undefined;
      h.onEvent(f.ev, f.data, ack);
    },
    onClose() { h.onClose(); },
  };
}
