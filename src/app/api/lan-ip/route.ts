import { NextResponse } from "next/server";
import os from "os";

/** v1.21: the host's real Wi-Fi/LAN IPv4 addresses, so a host that opened the
 *  game on "localhost" still sees an address friends can actually join. */
export async function GET() {
  const ips: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) ips.push(a.address);
  }
  return NextResponse.json({ ips, port: Number(process.env.PORT || 3000) }, { headers: { "cache-control": "no-store" } });
}
