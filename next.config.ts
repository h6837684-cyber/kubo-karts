import type { NextConfig } from "next";

// v3.7: KUBO_TARGET=mobile → fully static export into ./out for the Android
// APK (Capacitor). The normal web build stays "standalone" (with API routes).
// Run the mobile build with `npm run build:mobile` (it hides src/app/api,
// which cannot exist in a static export).
const mobile = process.env.KUBO_TARGET === "mobile";

const nextConfig: NextConfig = {
  output: mobile ? "export" : "standalone",
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_KUBO_TARGET: mobile ? "mobile" : "web" },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
