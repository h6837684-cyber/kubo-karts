"use client";

import dynamic from "next/dynamic";

const GameMount = dynamic(() => import("@/components/GameMount"), { ssr: false });

export default function Home() {
  return (
    <main id="game-root" className="fixed inset-0 overflow-hidden bg-[#0a0e18]">
      <GameMount />
    </main>
  );
}
