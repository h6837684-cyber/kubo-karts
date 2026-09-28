// KUBO KARTS — ROOM CORE v3.7 (transport-agnostic multiplayer brain)
//
// v3.7 (user: "میخوام داخل APK چندنفره با وای‌فای بدون اینترنت کار کنه"):
// the lobby/race logic that used to live ONLY inside mini-services/mp-server
// (socket.io on Node/bun) now lives HERE, with zero dependencies, so the very
// same code runs in two places:
//   1. mini-services/mp-server  → desktop / web hosting (plain WebSocket)
//   2. INSIDE THE APK on the host phone (Android LanServer plugin carries the
//      bytes, this file runs the room) → Wi-Fi / hotspot play with no internet
// Behaviour is a 1:1 port of mp-server v3 (same events, same payloads, same
// reconnect grace, same host migration), so the game client did not change.

export interface RoomConn {
  /** unique per physical connection (changes on reconnect) */
  id: string;
  send(ev: string, data?: unknown): void;
  close(): void;
}

export interface ConnHandlers {
  onEvent(ev: string, data: unknown, ack?: (d: unknown) => void): void;
  onClose(): void;
}

interface Player {
  id: string; sid: string; token: string;
  name: string; char: string; car: string; color: string;
  ready: boolean; online: boolean;
  graceTimer?: ReturnType<typeof setTimeout>;
}

export interface RoomSettings {
  theme: string; laps: number; bots: number; items: string[];
  itemMode?: 'mystery' | 'placed';
}

interface Room {
  code: string;
  players: Map<string, Player>;
  settings: RoomSettings;
  started: boolean;
  finishes: Map<string, number>;
  hostId: string;
  createdAt: number;
  hostCars: string[];
  lastActivity?: number;
  startInfo?: Record<string, unknown>;
}

const COLORS = ['#e84a3f', '#2f7de0', '#28e0a8', '#f7d154', '#8c4de0', '#ff5ad0'];
export const ALL_ITEMS = ['boost', 'shield', 'rocket', 'lightning', 'ice', 'trap', 'mine', 'magnet', 'emp', 'giant', 'ghost', 'jump', 'tnt', 'banana', 'minecart'];
const MAX_PLAYERS = 6;

const rid = (n: number) => {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let o = '';
  for (let i = 0; i < n; i++) o += chars[Math.floor(Math.random() * chars.length)];
  return o;
};

const str = (v: unknown, fallback: string, max: number) =>
  (typeof v === 'string' && v.trim() ? v : fallback).slice(0, max);

function sanitizeSettings(s: Partial<RoomSettings> | undefined, prev?: RoomSettings): RoomSettings {
  const base = prev ?? { theme: 'grass', laps: 3, bots: 2, items: [...ALL_ITEMS] };
  const items = Array.isArray(s?.items)
    ? (s!.items.filter(i => ALL_ITEMS.includes(i)))
    : base.items;
  return {
    theme: typeof s?.theme === 'string' ? s.theme.slice(0, 24) : base.theme,
    laps: Math.min(8, Math.max(1, Number(s?.laps ?? base.laps) || 3)),
    bots: Math.min(4, Math.max(0, Number(s?.bots ?? base.bots) || 0)),
    // v3.7 BUGFIX: an array of ONLY unknown ids used to leave the boxes EMPTY
    // (filter → []); an empty result now means "all items", like the UI shows.
    items: items.length > 0 ? items : [...ALL_ITEMS],
    itemMode: s?.itemMode === 'placed' || s?.itemMode === 'mystery' ? s.itemMode : (base.itemMode ?? 'mystery'),
  };
}

export interface RoomServerOptions {
  graceMs?: number;
  log?: (msg: string) => void;
}

export class RoomServer {
  private rooms = new Map<string, Room>();
  private sessions = new Map<string, { code: string; pid: string }>();
  private conns = new Map<string, RoomConn>();
  private sweepTimer: ReturnType<typeof setInterval>;
  private graceMs: number;
  private log: (m: string) => void;

  constructor(opts: RoomServerOptions = {}) {
    this.graceMs = opts.graceMs ?? 20000;
    this.log = opts.log ?? (() => { /* silent */ });
    this.sweepTimer = setInterval(() => this.sweep(), 60000);
  }

  /** number of live rooms (diagnostics / tests) */
  get roomCount() { return this.rooms.size; }

  dispose() {
    clearInterval(this.sweepTimer);
    for (const r of this.rooms.values()) for (const p of r.players.values()) if (p.graceTimer) clearTimeout(p.graceTimer);
    this.rooms.clear(); this.sessions.clear();
    for (const c of this.conns.values()) { try { c.close(); } catch { /* gone */ } }
    this.conns.clear();
  }

  // ------------------------------------------------------------ helpers
  private emitTo(sid: string, ev: string, payload: unknown) {
    const c = this.conns.get(sid);
    if (!c) return;
    try { c.send(ev, payload); } catch { /* broken link: its close handler cleans up */ }
  }
  private publicPlayer(r: Room, p: Player) {
    return { id: p.id, name: p.name, char: p.char, car: p.car, color: p.color, ready: p.ready, isHost: p.id === r.hostId, online: p.online };
  }
  private lobbyPayload(r: Room) {
    return { code: r.code, settings: r.settings, started: r.started, hostCars: r.hostCars, players: [...r.players.values()].map(p => this.publicPlayer(r, p)) };
  }
  private toRoom(r: Room, ev: string, payload: unknown, exceptPid?: string) {
    for (const p of r.players.values()) if (p.online && p.id !== exceptPid) this.emitTo(p.sid, ev, payload);
  }
  private broadcast(r: Room) { this.toRoom(r, 'room', this.lobbyPayload(r)); }

  private makeCode(): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    } while (this.rooms.has(code));
    return code;
  }

  /** v3.7 BUGFIX: colours were picked by `players.size % 6`, so after someone
   *  left, the next joiner could get the SAME colour as a player still in the
   *  room. Now the first colour nobody is using wins. */
  private freeColor(r: Room): string {
    const used = new Set([...r.players.values()].map(p => p.color));
    return COLORS.find(c => !used.has(c)) ?? COLORS[r.players.size % COLORS.length];
  }

  private findOpenRoom(): Room | null {
    let best: Room | null = null;
    for (const r of this.rooms.values()) {
      if (r.started || r.players.size >= MAX_PLAYERS) continue;
      let online = 0;
      for (const p of r.players.values()) if (p.online) online++;
      if (online === 0) continue;
      if (!best) { best = r; continue; }
      if (r.players.size > best.players.size) best = r;
      else if (r.players.size === best.players.size && r.createdAt < best.createdAt) best = r;
    }
    return best;
  }

  private removePlayer(room: Room, p: Player) {
    if (p.graceTimer) { clearTimeout(p.graceTimer); p.graceTimer = undefined; }
    this.sessions.delete(p.token);
    if (!room.players.delete(p.id)) return;
    const anyOnline = [...room.players.values()].some(q => q.online);
    if (room.players.size === 0 || !anyOnline) {
      for (const q of room.players.values()) { if (q.graceTimer) clearTimeout(q.graceTimer); this.sessions.delete(q.token); }
      this.rooms.delete(room.code);
      return;
    }
    let hostMigrated = false;
    if (room.hostId === p.id) {
      room.hostId = [...room.players.values()].find(q => q.online)!.id;
      hostMigrated = true;
    }
    this.broadcast(room);
    this.toRoom(room, 'peerLeft', { id: p.id, name: p.name });
    if (hostMigrated) this.toRoom(room, 'hostChanged', { id: room.hostId });
  }

  private sweep() {
    const now = Date.now();
    for (const [code, r] of this.rooms) {
      const dead = now - r.createdAt > 6 * 3600 * 1000
        || (r.started && now - (r.lastActivity ?? r.createdAt) > 10 * 60 * 1000);
      if (dead) {
        this.toRoom(r, 'errorMsg', { m: 'ROOM_CLOSED' });
        for (const q of r.players.values()) { if (q.graceTimer) clearTimeout(q.graceTimer); this.sessions.delete(q.token); }
        this.rooms.delete(code);
      }
    }
  }

  // ------------------------------------------------------------ connection
  /** register a new physical connection; feed its events into the returned handlers */
  connect(conn: RoomConn): ConnHandlers {
    this.conns.set(conn.id, conn);
    let myRoom: Room | null = null;
    let me: Player | null = null;
    const S = this;

    const leaveCurrent = () => {
      if (!myRoom || !me) return;
      S.removePlayer(myRoom, me);
      myRoom = null; me = null;
    };
    const newPlayer = (name: string, char: string, car: string, color: string, ready: boolean): Player => ({
      id: 'p_' + rid(8), sid: conn.id, token: rid(24), name, char, car, color, ready, online: true,
    });
    const attach = (room: Room, p: Player) => {
      myRoom = room; me = p;
      S.sessions.set(p.token, { code: room.code, pid: p.id });
      conn.send('session', { pid: p.id, token: p.token });
    };

    type M = Record<string, unknown> | undefined;
    const handlers: Record<string, (d: unknown, ack?: (d: unknown) => void) => void> = {
      pingx: (t, ack) => { if (typeof ack === 'function') ack(t); },

      create: (raw) => {
        const msg = raw as M;
        leaveCurrent();
        const p = newPlayer(str(msg?.name, 'Host', 14), str(msg?.char, 'bolt', 24), str(msg?.car, 'kart_start', 24), COLORS[0], true);
        const owned = msg?.ownedCars;
        const room: Room = {
          code: S.makeCode(),
          players: new Map([[p.id, p]]),
          settings: sanitizeSettings(msg?.settings as Partial<RoomSettings> | undefined),
          started: false,
          finishes: new Map(),
          hostId: p.id,
          createdAt: Date.now(),
          hostCars: Array.isArray(owned) ? owned.filter((c): c is string => typeof c === 'string').slice(0, 40) : [],
        };
        S.rooms.set(room.code, room);
        attach(room, p);
        conn.send('room', S.lobbyPayload(room));
        S.log(`room ${room.code} created by ${p.name}`);
      },

      join: (raw) => {
        const msg = raw as M;
        if (myRoom) return;
        const room = S.findOpenRoom();
        if (!room) { conn.send('errorMsg', { m: 'NO_SERVER' }); return; }
        const p = newPlayer(str(msg?.name, 'Player', 14), str(msg?.char, 'bolt', 24), str(msg?.car, 'kart_start', 24), S.freeColor(room), false);
        room.players.set(p.id, p);
        attach(room, p);
        S.broadcast(room);
        S.toRoom(room, 'playerJoined', { name: p.name });
        S.log(`${p.name} joined ${room.code}`);
      },

      resume: (raw) => {
        const msg = raw as M;
        const sess = msg && typeof msg.token === 'string' ? S.sessions.get(msg.token) : undefined;
        const room = sess ? S.rooms.get(sess.code) : undefined;
        const p = room && sess ? room.players.get(sess.pid) : undefined;
        if (!room || !p) { conn.send('resumeFail', { m: 'SESSION_EXPIRED' }); return; }
        if (p.graceTimer) { clearTimeout(p.graceTimer); p.graceTimer = undefined; }
        const oldSid = p.sid;
        p.sid = conn.id;
        p.online = true;
        if (oldSid !== conn.id) { const old = S.conns.get(oldSid); try { old?.close(); } catch { /* gone */ } }
        myRoom = room; me = p;
        conn.send('session', { pid: p.id, token: p.token });
        conn.send('resumed', { started: room.started, info: room.started ? { ...room.startInfo, yourId: p.id } : null });
        S.broadcast(room);
        S.toRoom(room, 'peerBack', { id: p.id, name: p.name }, p.id);
      },

      sel: (raw) => {
        const msg = raw as M;
        if (!myRoom || !me) return;
        if (typeof msg?.car === 'string') me.car = msg.car.slice(0, 24);
        if (typeof msg?.char === 'string') me.char = msg.char.slice(0, 24);
        S.broadcast(myRoom);
      },

      settings: (raw) => {
        if (!myRoom || !me || myRoom.hostId !== me.id) return;
        myRoom.settings = sanitizeSettings(raw as Partial<RoomSettings>, myRoom.settings);
        S.broadcast(myRoom);
      },

      ready: (v) => {
        if (!myRoom || !me) return;
        me.ready = !!v; S.broadcast(myRoom);
      },

      start: () => {
        if (!myRoom || !me || myRoom.hostId !== me.id) return;
        const room = myRoom;
        // v3.7 BUGFIX: a double-tap on START sent TWO different seeds → players
        // raced on two different tracks. A running race ignores a second START.
        if (room.started) return;
        room.started = true;
        room.finishes.clear();
        room.lastActivity = Date.now();
        const info = {
          theme: room.settings.theme, laps: room.settings.laps, bots: room.settings.bots,
          items: room.settings.items, itemMode: room.settings.itemMode ?? 'mystery',
          seed: Math.floor(Math.random() * 99999),
          players: [...room.players.values()].map(p => S.publicPlayer(room, p)),
          yourId: '',
        };
        room.startInfo = info;
        for (const p of room.players.values()) if (p.online) S.emitTo(p.sid, 'started', { ...info, yourId: p.id });
      },

      s: (st) => {
        if (!myRoom || !me) return;
        myRoom.lastActivity = Date.now();
        S.toRoom(myRoom, 's', { id: me.id, s: st }, me.id);
      },

      u: (raw) => {
        const msg = raw as M;
        if (!myRoom || !me || typeof msg?.it !== 'string' || !ALL_ITEMS.includes(msg.it)) return;
        S.toRoom(myRoom, 'u', { id: me.id, it: msg.it, b: !!msg.b }, me.id);
      },

      finish: (raw) => {
        const msg = raw as M;
        if (!myRoom || !me) return;
        const tm = Number(msg?.timeMs) || 0;
        myRoom.finishes.set(me.id, tm);
        myRoom.lastActivity = Date.now();
        S.toRoom(myRoom, 'finish', { id: me.id, timeMs: tm });
      },

      reopen: () => {
        if (!myRoom || !me || myRoom.hostId !== me.id) return;
        const room = myRoom;
        room.started = false;
        room.startInfo = undefined;
        room.finishes.clear();
        room.lastActivity = Date.now();
        for (const p of room.players.values()) p.ready = p.id === room.hostId;
        S.broadcast(room);
      },

      quitRoom: () => leaveCurrent(),
      leave: () => leaveCurrent(),
    };

    return {
      onEvent(ev, data, ack) {
        const h = Object.prototype.hasOwnProperty.call(handlers, ev) ? handlers[ev] : undefined;
        if (!h) return;
        try { h(data, ack); } catch (e) { S.log(`handler ${ev} failed: ${(e as Error)?.message}`); }
      },
      onClose() {
        if (S.conns.get(conn.id) === conn) S.conns.delete(conn.id);
        if (!myRoom || !me) return;
        const room = myRoom, p = me;
        if (p.sid !== conn.id) return;
        p.online = false;
        S.broadcast(room);
        S.toRoom(room, 'peerLost', { id: p.id, name: p.name });
        p.graceTimer = setTimeout(() => { if (!p.online) S.removePlayer(room, p); }, S.graceMs);
      },
    };
  }
}
