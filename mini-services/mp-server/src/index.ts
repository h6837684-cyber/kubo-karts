// KUBO KARTS - Multiplayer server v3.7 (LAN Wi-Fi) — desktop / web hosting
//
// v3.7: ZERO dependencies. The room logic moved to src/game/net/room-core.ts
// (shared with the Android APK host) and the transport is a tiny built-in
// WebSocket server on node:net, so this runs with EITHER:
//     bun src/index.ts
//     node --experimental-strip-types src/index.ts      (Node 22.6+)
// No `npm install` needed here anymore (socket.io removed).
import net from 'node:net';
import crypto from 'node:crypto';
import { RoomServer } from '../../../src/game/net/room-core.ts';

const GRACE_MS = Number(process.env.MP_GRACE_MS || 20000);
const PORT = Number(process.env.MP_PORT || 3003);
const MAX_FRAME = 1 << 20;          // 1 MB — game frames are < 2 KB
const IDLE_MS = 20000;              // clients ping every 2 s

const rooms = new RoomServer({ graceMs: GRACE_MS, log: (m) => console.log('[mp-server]', m) });

// ---- same wire format as src/game/net/link.ts (kept inline: no TS path tricks for Node) ----
const ACK = '@ack';
const enc = (ev: string, data?: unknown, ackId?: number) =>
  JSON.stringify(ackId === undefined ? [ev, data ?? null] : [ev, data ?? null, ackId]);

function wsFrame(op: number, payload: Buffer): Buffer {
  const len = payload.length;
  let head: Buffer;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x80 | op;
  return Buffer.concat([head, payload]);
}

let seq = 0;

const server = net.createServer((sock) => {
  sock.setNoDelay(true);
  sock.setTimeout(IDLE_MS);
  let buf = Buffer.alloc(0);
  let upgraded = false;
  let closed = false;
  let fragments: Buffer[] = [];
  const id = 's' + (++seq) + '_' + crypto.randomBytes(3).toString('hex');
  let peer: { onText(t: string): void; onClose(): void } | null = null;

  const close = () => {
    if (closed) return;
    closed = true;
    try { if (upgraded) sock.write(wsFrame(0x8, Buffer.alloc(0))); } catch { /* */ }
    sock.destroy();
    peer?.onClose();
  };
  const sendText = (t: string) => { if (!closed && upgraded) sock.write(wsFrame(0x1, Buffer.from(t, 'utf8'))); };

  sock.on('timeout', close);
  sock.on('error', close);
  sock.on('close', close);

  sock.on('data', (chunk: Buffer) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (!upgraded) {
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) { if (buf.length > 8192) close(); return; }
      const head = buf.subarray(0, end).toString('latin1');
      buf = buf.subarray(end + 4);
      const key = /^sec-websocket-key:\s*(.+)$/im.exec(head)?.[1]?.trim();
      if (!key || !/^upgrade:\s*websocket/im.test(head)) {
        // plain HTTP → tiny health page (open http://<ip>:3003 in a browser to test)
        sock.end('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\nKUBO KARTS mp-server OK\n');
        closed = true;
        return;
      }
      const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      upgraded = true;
      const h = rooms.connect({ id, send: (ev, data) => sendText(enc(ev, data)), close });
      peer = {
        onText(t) {
          let a: unknown;
          try { a = JSON.parse(t); } catch { return; }
          if (!Array.isArray(a) || typeof a[0] !== 'string' || a[0] === ACK) return;
          const ackId = typeof a[2] === 'number' ? a[2] : undefined;
          h.onEvent(a[0], a[1], ackId !== undefined ? (d) => sendText(enc(ACK, d, ackId)) : undefined);
        },
        onClose() { h.onClose(); },
      };
    }
    // ---- frames ----
    while (!closed && buf.length >= 2) {
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0, op = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX_FRAME)) { close(); return; } len = Number(big); off = 10; }
      if (len > MAX_FRAME) { close(); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const m = buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= m[i & 3];
      }
      buf = buf.subarray(need);
      if (op === 0x8) { close(); return; }
      if (op === 0x9) { sock.write(wsFrame(0xA, payload)); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        fragments.push(payload);
        if (fin) {
          const text = Buffer.concat(fragments).toString('utf8');
          fragments = [];
          peer?.onText(text);
        }
      }
    }
  });
});

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(`[mp-server] cannot listen on :${PORT} — ${e.code === 'EADDRINUSE' ? 'already running?' : e.message}`);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[mp-server] KUBO KARTS multiplayer service v3.7 on :${PORT} (reconnect grace ${GRACE_MS}ms, no deps)`);
});
