import type { Metadata, Viewport } from "next";
import "./globals.css";

const MOBILE = process.env.KUBO_TARGET === "mobile" || process.env.NEXT_PUBLIC_KUBO_TARGET === "mobile";

export const metadata: Metadata = {
  title: "KUBO KARTS — Voxel Arcade Racing",
  description: "Original blocky kart racing game: 60 levels, 10 worlds, drift, power-ups, local Wi-Fi multiplayer. Built for mobile.",
  keywords: ["karts", "racing", "voxel", "arcade", "game", "multiplayer"],
  applicationName: "KUBO KARTS",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0a0e18",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* v3.7: the APK must boot with NO internet (and Google Fonts is often
            filtered in Iran → a blocking stylesheet = long white screen).
            The app build skips it and falls back to the bundled fonts. */}
        {!MOBILE && (
          <>
            <link rel="preconnect" href="https://fonts.googleapis.com" />
            <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
            <link
              href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&display=swap"
              rel="stylesheet"
            />
          </>
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
