import type { CapacitorConfig } from "@capacitor/cli";

// KUBO KARTS v3.7 — Android app shell.
// androidScheme "http": friends connect to the host phone with ws:// (plain,
// LAN only). An https page would block ws:// as "mixed content".
const config: CapacitorConfig = {
  appId: "com.kubo.karts",
  appName: "KUBO KARTS",
  webDir: "out",
  server: {
    androidScheme: "http",
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
