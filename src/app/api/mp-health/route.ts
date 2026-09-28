import { NextResponse } from "next/server";
import { spawn } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";

/**
 * KUBO KARTS — MP server HEALTH + AUTO-START (web / desktop hosting only;
 * the Android APK does not use this: the host phone is the server there).
 *
 * v3.7 BUGFIXES:
 *  - CRASH: `spawn("bun")` on a machine WITHOUT bun emitted an async 'error'
 *    event that nobody listened to → the WHOLE Next.js game server died
 *    (try/catch cannot catch it). Every spawn now has an error listener.
 *  - The comment promised an "npx tsx fallback" that never existed. The mp
 *    server now has zero dependencies, so we simply re-use the runtime that is
 *    running THIS server (process.execPath): bun → `bun src/index.ts`,
 *    node → `node --experimental-strip-types src/index.ts` (Node 22.6+).
 *  - Output now goes to <project>/mp-server.log (the old comment said so,
 *    but stdio was "ignore" → impossible to debug).
 */

const MP_PORT = Number(process.env.MP_PORT || 3003);
let spawning = false;
let lastError = "";

function probe(port: number, timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (ok: boolean) => { try { s.destroy(); } catch { /* already gone */ } resolve(ok); };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

/** the project root even when running from .next/standalone */
function projectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (fs.existsSync(path.join(dir, "mini-services", "mp-server", "src", "index.ts"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function startServer(): boolean {
  if (spawning) return true;
  spawning = true;
  setTimeout(() => { spawning = false; }, 4000);
  try {
    const root = projectRoot();
    const cwd = path.join(root, "mini-services", "mp-server");
    if (!fs.existsSync(path.join(cwd, "src", "index.ts"))) { lastError = "MP_SOURCE_MISSING"; return false; }
    const isBun = typeof (process.versions as Record<string, string | undefined>).bun === "string";
    const cmd = process.execPath;
    const args = isBun ? ["src/index.ts"] : ["--experimental-strip-types", "--no-warnings", "src/index.ts"];
    let logFd: number | "ignore" = "ignore";
    try { logFd = fs.openSync(path.join(root, "mp-server.log"), "a"); } catch { /* read-only disk */ }
    const child = spawn(cmd, args, {
      cwd,
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, MP_PORT: String(MP_PORT) },
    });
    child.on("error", (e) => { lastError = e.message; });   // ← the crash fix
    child.unref();
    return true;
  } catch (e) {
    lastError = (e as Error).message;
    return false;
  }
}

export async function GET() {
  const alive = await probe(MP_PORT);
  if (alive) return NextResponse.json({ ok: true, started: false, port: MP_PORT });
  const ok = startServer();
  if (!ok) return NextResponse.json({ ok: false, started: false, port: MP_PORT, error: lastError });
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 350));
    if (await probe(MP_PORT)) return NextResponse.json({ ok: true, started: true, port: MP_PORT });
  }
  return NextResponse.json({ ok: false, started: true, port: MP_PORT, error: lastError || "MP_START_TIMEOUT" });
}
