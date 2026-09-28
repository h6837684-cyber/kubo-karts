"use client";

import { useEffect } from "react";

/**
 * Mounts the KUBO KARTS game engine (framework-agnostic TypeScript + Three.js).
 * The engine owns the full screen: canvas + DOM UI overlay.
 */
export default function GameMount() {
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    import("@/game/main").then((mod) => {
      if (cancelled) return;
      // engine self-mounts on import (creates canvas & UI inside #game-root)
      void mod;
      cleanup = () => {};
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div id="game-ui" className="absolute inset-0 z-10" style={{ pointerEvents: "none" }} />
  );
}
