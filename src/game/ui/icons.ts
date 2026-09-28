// KUBO KARTS - Item icons: every power-up gets a crisp hand-drawn canvas icon
// (user: "ایموجی و انیمیشن و خود اون قدرت‌ها بیشتر کار کنی — پرجزئیات‌تر").
// Drawn once per item, cached as dataURL — identical on every device, no emoji
// font roulette. HUD adds a per-item glow + pulse animation via CSS.
import type { ItemId } from '../items/items';

type Draw = (c: CanvasRenderingContext2D) => void;

const S = 96;
const C = S / 2;

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/** subtle dark orb behind every icon so it reads on any HUD background */
function orb(c: CanvasRenderingContext2D, rim: string) {
  const g = c.createRadialGradient(C, C - 10, 6, C, C, 42);
  g.addColorStop(0, 'rgba(58,66,88,0.95)');
  g.addColorStop(1, 'rgba(14,18,30,0.95)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(C, C, 41, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = 4;
  c.strokeStyle = rim;
  c.stroke();
}

const DRAW: Record<ItemId, Draw> = {
  boost: (c) => {
    // v3.1 NITRO (user: "آیکون نیترو رو از نو درست کن و جذابش کن"):
    // blue NOS bottle on a speed-streak orb with a plasma jet
    const bg = c.createRadialGradient(C, C - 8, 4, C, C, 44);
    bg.addColorStop(0, '#1d4a8a'); bg.addColorStop(1, '#0a1430');
    c.fillStyle = bg; c.beginPath(); c.arc(C, C, 42, 0, Math.PI * 2); c.fill();
    c.lineWidth = 4; c.strokeStyle = '#2fd0ff'; c.stroke();
    // speed streaks
    c.lineCap = 'round';
    for (const [y, l, a] of [[26, 18, 0.5], [40, 26, 0.8], [56, 22, 0.65], [70, 14, 0.4]] as const) {
      c.strokeStyle = `rgba(120,230,255,${a})`; c.lineWidth = 3;
      c.beginPath(); c.moveTo(12, y); c.lineTo(12 + l, y); c.stroke();
    }
    c.save(); c.translate(C + 6, C); c.rotate(-0.6);
    // plasma jet (behind the bottle)
    const jet = c.createLinearGradient(0, 22, 0, 50);
    jet.addColorStop(0, 'rgba(255,255,255,1)'); jet.addColorStop(0.35, 'rgba(90,220,255,0.95)'); jet.addColorStop(1, 'rgba(60,120,255,0)');
    c.fillStyle = jet; c.beginPath(); c.moveTo(-8, 22); c.quadraticCurveTo(0, 60, 8, 22); c.closePath(); c.fill();
    // bottle
    const bd = c.createLinearGradient(-11, 0, 11, 0);
    bd.addColorStop(0, '#0f4fb8'); bd.addColorStop(0.35, '#4fa6ff'); bd.addColorStop(0.6, '#1e6fe0'); bd.addColorStop(1, '#0a3680');
    c.fillStyle = bd;
    roundRect(c, -11, -20, 22, 42, 9); c.fill();
    c.strokeStyle = '#06224f'; c.lineWidth = 2.5; c.stroke();
    // label band
    c.fillStyle = '#f5f7fa'; c.fillRect(-11, -2, 22, 11);
    c.fillStyle = '#ff3b30'; c.fillRect(-11, 1.5, 22, 4);
    // neck + valve
    c.fillStyle = '#c9d1d9'; c.fillRect(-4, -28, 8, 9);
    c.fillStyle = '#ff3b30'; roundRect(c, -9, -33, 18, 6, 3); c.fill();
    // gloss
    c.fillStyle = 'rgba(255,255,255,0.45)'; roundRect(c, -7, -16, 4, 12, 2); c.fill();
    c.restore();
    // sparkle
    c.fillStyle = '#ffffff';
    c.beginPath(); c.moveTo(72, 18); c.lineTo(75, 25); c.lineTo(82, 28); c.lineTo(75, 31); c.lineTo(72, 38); c.lineTo(69, 31); c.lineTo(62, 28); c.lineTo(69, 25); c.closePath(); c.fill();
  },
  shield: (c) => {
    orb(c, '#5ad0ff');
    const g = c.createLinearGradient(C - 22, 16, C + 22, 78);
    g.addColorStop(0, '#9fe6ff'); g.addColorStop(0.5, '#38b6f0'); g.addColorStop(1, '#1b7fc0');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(C, 14);
    c.lineTo(C + 24, 24);
    c.lineTo(C + 24, 48);
    c.bezierCurveTo(C + 24, 66, C + 8, 78, C, 82);
    c.bezierCurveTo(C - 8, 78, C - 24, 66, C - 24, 48);
    c.lineTo(C - 24, 24);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 3; c.stroke();
    c.fillStyle = 'rgba(255,255,255,0.5)';
    c.fillRect(C - 12, 26, 6, 30);
  },
  rocket: (c) => {
    orb(c, '#ff5252');
    c.save();
    c.translate(C, C);
    c.rotate(Math.PI / 4);
    // body
    c.fillStyle = '#e8eef4';
    roundRect(c, -9, -26, 18, 40, 9); c.fill();
    // nose
    c.fillStyle = '#ff5252';
    c.beginPath();
    c.moveTo(-9, -18);
    c.quadraticCurveTo(0, -34, 9, -18);
    c.closePath(); c.fill();
    // fins
    c.fillStyle = '#ff5252';
    c.beginPath(); c.moveTo(-9, 6); c.lineTo(-17, 20); c.lineTo(-9, 14); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(9, 6); c.lineTo(17, 20); c.lineTo(9, 14); c.closePath(); c.fill();
    // window
    c.fillStyle = '#5ad0ff';
    c.beginPath(); c.arc(0, -8, 5.5, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#274b60'; c.lineWidth = 2; c.stroke();
    // exhaust
    c.fillStyle = '#ffb74d';
    c.beginPath();
    c.moveTo(-5, 14); c.lineTo(0, 30); c.lineTo(5, 14); c.closePath(); c.fill();
    c.restore();
  },
  lightning: (c) => {
    // v1.10: BLUE storm bolt (user: "قدرت رعد و برق رنگ آبی داشته باشه") —
    // cold electric palette + mini field orbs to hint the 3-zone storm
    orb(c, '#4fc3ff');
    c.fillStyle = 'rgba(79,195,255,0.55)';
    c.beginPath(); c.arc(14, 22, 7, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(82, 70, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#8fe0ff';
    c.strokeStyle = '#1f7fd0'; c.lineWidth = 3;
    c.beginPath();
    c.moveTo(C + 12, 12); c.lineTo(C - 16, 50); c.lineTo(C - 2, 50);
    c.lineTo(C - 12, 84); c.lineTo(C + 18, 42); c.lineTo(C + 3, 42);
    c.closePath();
    c.fill(); c.stroke();
    // electric sparks around the bolt
    c.strokeStyle = 'rgba(214,242,255,0.9)'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(20, 16); c.lineTo(26, 10); c.moveTo(76, 82); c.lineTo(82, 76); c.stroke();
  },
  ice: (c) => {
    orb(c, '#aee8ff');
    c.strokeStyle = '#aee8ff'; c.lineWidth = 5; c.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI;
      const dx = Math.cos(a) * 28, dy = Math.sin(a) * 28;
      c.beginPath(); c.moveTo(C - dx, C - dy); c.lineTo(C + dx, C + dy); c.stroke();
      // side barbs
      for (const s of [-1, 1]) {
        const bx = C + dx * 0.55, by = C + dy * 0.55;
        const px = Math.cos(a) * 7, py = Math.sin(a) * 7;
        c.beginPath();
        c.moveTo(bx - px * s, by - py * s); c.lineTo(bx + dx * 0.18, by + dy * 0.18);
        c.lineTo(bx + px * s, by + py * s);
        c.stroke();
      }
    }
    c.fillStyle = '#e8f8ff';
    c.beginPath(); c.arc(C, C, 6, 0, Math.PI * 2); c.fill();
  },
  trap: (c) => {
    orb(c, '#4a5160');
    // OIL SLICK v2 (user v1.9: "بیشتر روی آیکون لکه روغن کار بشه"): a proper
    // glossy iridescent puddle — layered blob, rainbow sheen swirls, bright
    // specular highlights, drips and a droplet — reads at HUD size instantly.
    // outer blob (asymmetric, organic)
    c.fillStyle = '#181c22';
    c.beginPath();
    c.ellipse(C + 2, C + 6, 31, 19, 0.16, 0, Math.PI * 2);
    c.fill();
    c.ellipse(C - 14, C + 12, 12, 7, 0.1, 0, Math.PI * 2);
    c.fill();
    c.ellipse(C + 20, C + 14, 8, 5, 0.5, 0, Math.PI * 2);
    c.fill();
    // mid layer
    c.fillStyle = '#242a33';
    c.beginPath();
    c.ellipse(C, C + 2, 24, 14, 0.14, 0, Math.PI * 2);
    c.fill();
    // deep core
    c.fillStyle = '#12151b';
    c.beginPath();
    c.ellipse(C - 2, C + 3, 15, 8, 0.12, 0, Math.PI * 2);
    c.fill();
    // iridescent sheen arcs (the classic oil-on-water rainbow)
    const sheen = ['rgba(255,110,190,0.85)', 'rgba(120,225,255,0.8)', 'rgba(190,150,255,0.75)', 'rgba(120,255,180,0.6)'];
    c.lineCap = 'round';
    sheen.forEach((col, i) => {
      c.strokeStyle = col;
      c.lineWidth = 3 - i * 0.4;
      c.beginPath();
      c.ellipse(C - 2 + i * 2, C + 1 + i * 1.5, 20 - i * 4, 11 - i * 2, 0.16 + i * 0.1, 2.6 + i * 0.5, 5.4 + i * 0.4);
      c.stroke();
    });
    // specular glare
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.beginPath();
    c.ellipse(C - 12, C - 4, 6, 2.6, -0.5, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.beginPath();
    c.ellipse(C + 8, C - 1, 3.4, 1.6, -0.3, 0, Math.PI * 2);
    c.fill();
    // dripping droplets
    c.fillStyle = '#242a33';
    c.beginPath(); c.arc(C + 26, C - 12, 3.4, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(C - 28, C + 20, 2.6, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(120,225,255,0.5)'; c.lineWidth = 1.6;
    c.beginPath(); c.arc(C + 26, C - 12, 3.4, 0, Math.PI * 2); c.stroke();
  },
  mine: (c) => {
    orb(c, '#ff3b30');
    // spikes
    c.fillStyle = '#565d66';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.save();
      c.translate(C + Math.cos(a) * 28, C + Math.sin(a) * 28);
      c.rotate(a);
      c.fillRect(-7, -4.5, 14, 9);
      c.restore();
    }
    // body disc
    const g = c.createRadialGradient(C - 6, C - 8, 4, C, C, 26);
    g.addColorStop(0, '#4a525c'); g.addColorStop(1, '#23272e');
    c.fillStyle = g;
    c.beginPath(); c.arc(C, C, 25, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#11141a'; c.lineWidth = 3; c.stroke();
    // red detonator lens
    c.fillStyle = '#ff3b30';
    c.beginPath(); c.arc(C, C, 9, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgba(255,220,210,0.9)';
    c.beginPath(); c.arc(C - 3, C - 3, 3, 0, Math.PI * 2); c.fill();
  },
  magnet: (c) => {
    // v3.1 MAGNET: glossy red/steel horseshoe + red/blue field arcs + pulled coins
    orb(c, '#ff5ad0');
    c.lineCap = 'round';
    for (const [r, col] of [[36, 'rgba(255,90,90,0.55)'], [30, 'rgba(90,170,255,0.55)']] as const) {
      c.strokeStyle = col; c.lineWidth = 2.5; c.setLineDash([5, 5]);
      c.beginPath(); c.arc(C, C + 6, r, Math.PI * 1.08, Math.PI * 1.92); c.stroke();
    }
    c.setLineDash([]);
    // horseshoe body (thick arc with shading)
    const hs = c.createLinearGradient(C - 26, 0, C + 26, 0);
    hs.addColorStop(0, '#b3121f'); hs.addColorStop(0.3, '#ff4d4d'); hs.addColorStop(0.55, '#e0202c'); hs.addColorStop(1, '#8e0d18');
    c.strokeStyle = '#4a0610'; c.lineWidth = 19; c.lineCap = 'butt';
    c.beginPath(); c.arc(C, C + 2, 17, Math.PI, 0, false); c.lineTo(C + 17, C + 20); c.moveTo(C - 17, C + 2); c.lineTo(C - 17, C + 20); c.stroke();
    c.strokeStyle = hs; c.lineWidth = 14;
    c.beginPath(); c.arc(C, C + 2, 17, Math.PI, 0, false); c.lineTo(C + 17, C + 18); c.moveTo(C - 17, C + 2); c.lineTo(C - 17, C + 18); c.stroke();
    // steel poles
    const st = c.createLinearGradient(0, C + 18, 0, C + 30);
    st.addColorStop(0, '#ffffff'); st.addColorStop(1, '#9aa4ae');
    c.fillStyle = st;
    c.fillRect(C - 24, C + 18, 14, 11); c.fillRect(C + 10, C + 18, 14, 11);
    c.strokeStyle = '#4a5560'; c.lineWidth = 1.5;
    c.strokeRect(C - 24, C + 18, 14, 11); c.strokeRect(C + 10, C + 18, 14, 11);
    // highlight
    c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 3; c.lineCap = 'round';
    c.beginPath(); c.arc(C, C + 2, 21, Math.PI * 1.15, Math.PI * 1.45); c.stroke();
    // pulled coins + sparks
    for (const [x, y, r] of [[C - 30, C - 26, 6], [C + 29, C - 27, 5], [C, C - 36, 4.5]] as const) {
      c.fillStyle = '#ffc21a'; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#9a6400'; c.lineWidth = 1.5; c.stroke();
    }
    c.strokeStyle = '#ffe9ff'; c.lineWidth = 2;
    for (const [x, y] of [[C - 20, C - 16], [C + 20, C - 16]] as const) {
      c.beginPath(); c.moveTo(x - 4, y); c.lineTo(x + 4, y); c.moveTo(x, y - 4); c.lineTo(x, y + 4); c.stroke();
    }
  },
  emp: (c) => {
    // v3.1 EMP: violet energy core with a jagged shock ring + lightning forks
    const bg = c.createRadialGradient(C, C, 4, C, C, 44);
    bg.addColorStop(0, '#3d1670'); bg.addColorStop(1, '#10061f');
    c.fillStyle = bg; c.beginPath(); c.arc(C, C, 42, 0, Math.PI * 2); c.fill();
    c.lineWidth = 4; c.strokeStyle = '#b45aff'; c.stroke();
    // jagged shock ring
    c.strokeStyle = '#c77dff'; c.lineWidth = 3.5; c.beginPath();
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * Math.PI * 2, r = 30 + (i % 2 ? 4 : -4);
      const x = C + Math.cos(a) * r, y = C + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    // lightning forks
    c.strokeStyle = '#f3e6ff'; c.lineWidth = 2.5; c.lineJoin = 'miter';
    for (let k = 0; k < 4; k++) {
      const a0 = (k / 4) * Math.PI * 2 + 0.4;
      c.beginPath();
      c.moveTo(C + Math.cos(a0) * 12, C + Math.sin(a0) * 12);
      c.lineTo(C + Math.cos(a0 + 0.3) * 19, C + Math.sin(a0 + 0.3) * 19);
      c.lineTo(C + Math.cos(a0 - 0.1) * 24, C + Math.sin(a0 - 0.1) * 24);
      c.lineTo(C + Math.cos(a0 + 0.2) * 33, C + Math.sin(a0 + 0.2) * 33);
      c.stroke();
    }
    c.lineJoin = 'round';
    // glowing core
    const core = c.createRadialGradient(C, C, 1, C, C, 15);
    core.addColorStop(0, '#ffffff'); core.addColorStop(0.45, '#e2b8ff'); core.addColorStop(1, 'rgba(180,90,255,0)');
    c.fillStyle = core; c.beginPath(); c.arc(C, C, 15, 0, Math.PI * 2); c.fill();
    // tiny bolt glyph in the core
    c.fillStyle = '#6a1fc2';
    c.beginPath(); c.moveTo(C + 2, C - 8); c.lineTo(C - 5, C + 1); c.lineTo(C, C + 1); c.lineTo(C - 2, C + 8); c.lineTo(C + 5, C - 1); c.lineTo(C, C - 1); c.closePath(); c.fill();
  },
  giant: (c) => {
    orb(c, '#67c23a');
    // T-rex head profile
    c.fillStyle = '#4faf2e';
    c.beginPath();
    c.moveTo(20, 40);
    c.lineTo(40, 26); c.lineTo(62, 24); c.lineTo(72, 34); c.lineTo(70, 44);
    c.lineTo(58, 48); c.lineTo(54, 58); c.lineTo(46, 56); c.lineTo(46, 48);
    c.lineTo(34, 50); c.lineTo(26, 60); c.lineTo(20, 56); c.closePath();
    c.fill();
    c.strokeStyle = '#2c6e18'; c.lineWidth = 3; c.stroke();
    // eye + teeth
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(56, 36, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1c1c1c';
    c.beginPath(); c.arc(57.5, 36, 2.4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff';
    for (const tx of [48, 54, 60]) {
      c.beginPath();
      c.moveTo(tx, 48 + Math.abs(tx - 54)); c.lineTo(tx + 3, 54); c.lineTo(tx + 6, 48 + Math.abs(tx - 54));
      c.closePath(); c.fill();
    }
  },
  ghost: (c) => {
    orb(c, '#cfe8ff');
    c.fillStyle = '#eef8ff';
    c.beginPath();
    c.moveTo(C - 22, 78);
    c.lineTo(C - 22, 44);
    c.arc(C, 44, 22, Math.PI, 0);
    c.lineTo(C + 22, 78);
    for (let i = 0; i < 4; i++) {
      const x0 = C + 22 - i * 11;
      c.quadraticCurveTo(x0 - 2.75, i % 2 ? 70 : 86, x0 - 11, 78);
    }
    c.closePath();
    c.fill();
    c.fillStyle = '#35506b';
    c.beginPath(); c.arc(C - 8, 42, 4.5, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(C + 8, 42, 4.5, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(C, 56, 5, 3.5, 0, 0, Math.PI * 2); c.fill();
  },
  jump: (c) => {
    // v3 SPRING MINE: wooden floor plate flipping open over a steel coil
    orb(c, '#d08a45');
    // coil
    c.strokeStyle = '#dfe5ec'; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i <= 8; i++) {
      const y = 76 - i * 4.2;
      const x = C + (i % 2 ? 13 : -13);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    c.strokeStyle = '#8c96a3'; c.lineWidth = 2;
    c.beginPath(); c.moveTo(C - 18, 78); c.lineTo(C + 18, 78); c.stroke();
    // lid (tilted plank group)
    c.save();
    c.translate(C - 20, 40);
    c.rotate(-0.42);
    const tones = ['#b07a44', '#9c6a3a', '#b68250'];
    for (let i = 0; i < 3; i++) {
      c.fillStyle = tones[i];
      c.fillRect(0, i * 8.5, 46, 7.5);
    }
    c.fillStyle = '#5a3a22';
    c.fillRect(0, 7.5, 46, 1); c.fillRect(0, 16, 46, 1);
    c.fillStyle = '#c9d1da';
    for (const [x, y] of [[4, 3], [40, 3], [4, 21], [40, 21]]) c.fillRect(x, y, 3.5, 3.5);
    c.restore();
    // hinge
    c.fillStyle = '#6b7380';
    c.beginPath(); c.arc(C - 20, 40, 4, 0, Math.PI * 2); c.fill();
    // launch arrow
    c.fillStyle = '#ffd08a';
    c.beginPath();
    c.moveTo(C + 24, 14); c.lineTo(C + 33, 26); c.lineTo(C + 27, 26); c.lineTo(C + 27, 36);
    c.lineTo(C + 21, 36); c.lineTo(C + 21, 26); c.lineTo(C + 15, 26);
    c.closePath(); c.fill();
  },
  // v1.21 new items — blocky Minecraft-style pixel art
  tnt: (c) => {
    orb(c, '#e53935');
    const x0 = C - 26, y0 = C - 22, w = 52, h = 50;
    c.fillStyle = '#c62b1f'; c.fillRect(x0, y0, w, h);
    c.fillStyle = '#a8231a'; for (let x = x0; x < x0 + w; x += 8) c.fillRect(x, y0, 3, h);
    c.fillStyle = '#efe9dc'; c.fillRect(x0, y0 + 17, w, 16);
    c.fillStyle = '#161616'; c.font = 'bold 15px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('TNT', C, y0 + 25.5);
    c.strokeStyle = '#5a130e'; c.lineWidth = 3; c.strokeRect(x0, y0, w, h);
    // fuse + spark
    c.fillStyle = '#6b5b45'; c.fillRect(C - 2, y0 - 10, 4, 10);
    c.fillStyle = '#ffe08a'; c.beginPath(); c.arc(C, y0 - 12, 5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(C, y0 - 12, 2, 0, Math.PI * 2); c.fill();
  },
  banana: (c) => {
    // v3.1: a real, readable banana peel (the old pixel sprite read as a tree)
    orb(c, '#ffe14d');
    c.save(); c.translate(C, C + 4);
    // shadow
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.beginPath(); c.ellipse(0, 24, 26, 5, 0, 0, Math.PI * 2); c.fill();
    // three peel flaps
    const flap = (rot: number, col: string) => {
      c.save(); c.rotate(rot);
      c.fillStyle = col; c.strokeStyle = '#8a6a00'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(-5, 0); c.quadraticCurveTo(-10, 16, -3, 26); c.quadraticCurveTo(3, 20, 5, 0); c.closePath();
      c.fill(); c.stroke(); c.restore();
    };
    flap(-0.9, '#ffd21f'); flap(0.9, '#ffd21f'); flap(0, '#ffe14d');
    // fruit body curving up
    const g = c.createLinearGradient(-10, -30, 12, 0);
    g.addColorStop(0, '#fff6a8'); g.addColorStop(0.5, '#ffe14d'); g.addColorStop(1, '#f2b705');
    c.fillStyle = g; c.strokeStyle = '#8a6a00'; c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(-8, 2); c.quadraticCurveTo(-14, -18, 2, -32); c.quadraticCurveTo(12, -34, 10, -30);
    c.quadraticCurveTo(-2, -16, 8, 2); c.closePath(); c.fill(); c.stroke();
    // stem tip
    c.fillStyle = '#5a3d10'; c.beginPath(); c.arc(8, -32, 3.2, 0, Math.PI * 2); c.fill();
    // gloss
    c.strokeStyle = 'rgba(255,255,255,0.7)'; c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-6, -6); c.quadraticCurveTo(-8, -18, 0, -26); c.stroke();
    c.restore();
  },
  minecart: (c) => {
    orb(c, '#9aa4ae');
    // iron cart with creeper face plate on rails
    c.fillStyle = '#9aa3ab'; c.fillRect(C - 26, C - 16, 52, 30);
    c.fillStyle = '#6d757d'; c.fillRect(C - 26, C - 16, 52, 5);
    c.fillStyle = '#3fae3a'; c.fillRect(C - 12, C - 9, 24, 20);
    c.fillStyle = '#10300f';
    c.fillRect(C - 9, C - 6, 6, 6); c.fillRect(C + 3, C - 6, 6, 6); c.fillRect(C - 3, C, 6, 5); c.fillRect(C - 6, C + 3, 3, 6); c.fillRect(C + 3, C + 3, 3, 6);
    c.fillStyle = '#2c3036';
    for (const x of [C - 18, C + 10]) c.fillRect(x, C + 14, 9, 9);
    c.fillStyle = '#b8bec4'; c.fillRect(C - 36, C + 24, 72, 4);
    c.fillStyle = '#7a5530'; for (let x = C - 34; x < C + 34; x += 12) c.fillRect(x, C + 28, 7, 4);
    c.strokeStyle = '#3a4048'; c.lineWidth = 3; c.strokeRect(C - 26, C - 16, 52, 30);
  },
};

const cache = new Map<ItemId, string>();

/** v3.1: raw canvas of an item icon (used by 3D 'real item' tokens on the road) */
export function itemIconCanvas(id: ItemId, size = 128): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d')!;
  c.scale(size / S, size / S);
  c.lineJoin = 'round';
  DRAW[id](c);
  return cv;
}

/** crisp canvas-drawn icon (dataURL) — cached per item */
export function itemIconDataURL(id: ItemId): string {
  let v = cache.get(id);
  if (!v) {
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const c = cv.getContext('2d')!;
    c.lineJoin = 'round';
    DRAW[id](c);
    v = cv.toDataURL('image/png');
    cache.set(id, v);
  }
  return v;
}

// ================= MC-STYLE HEARTS (v1.13 FULL REDRAW) =================
// user: "قلب‌ها معلوم نیست که واقعاً قلب هستن — از نو طراحی کن، طراحی ماینکرفتی"
// The old 8×7 sprite read as a blob. This is the authentic Minecraft heart:
// a 7×7 chunky core inside a programmatically generated 1px dark outline
// (9×9 sprite, square → no more aspect distortion in the HUD), with the
// classic white specular pixels on the top-left lobe, per-row red volume
// shading and a charred dark shell for the empty container.
const HEART_CORE = [
  '.XX.XX.',
  'XXXXXXX',
  'XXXXXXX',
  'XXXXXXX',
  '.XXXXX.',
  '..XXX..',
  '...X...',
];

function drawHeart(state: 'full' | 'half' | 'empty'): string {
  const px = 12;
  const CW = 9, CH = 9;                       // core 7×7 + 1px outline all around
  const cv = document.createElement('canvas');
  cv.width = CW * px; cv.height = CH * px;
  const c = cv.getContext('2d')!;
  // grid: '.'=empty, 'o'=outline, then the fill codes
  const grid: string[][] = [];
  for (let y = 0; y < CH; y++) grid.push(Array(CW).fill('.'));
  for (let y = 0; y < HEART_CORE.length; y++) {
    for (let x = 0; x < 7; x++) {
      if (HEART_CORE[y][x] === 'X') grid[y + 1][x + 1] = 'X';
    }
  }
  // AUTO OUTLINE: every empty cell touching the core (8-dir) becomes outline
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (grid[y][x] !== '.') continue;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < CH && nx >= 0 && nx < CW && grid[ny][nx] === 'X') { touch = true; break; }
        }
      }
      if (touch) grid[y][x] = 'o';
    }
  }
  // paint
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      const ch = grid[y][x];
      if (ch === '.') continue;
      const cx = x - 1, cy = y - 1;             // core-space coords
      const isRight = cx >= 4;                  // MC half hearts: RIGHT side empties
      const emptySide = state === 'empty' || (state === 'half' && isRight);
      let col: string;
      if (ch === 'o') {
        col = state === 'empty' || (state === 'half' && isRight) ? '#170a10' : '#22060b';
      } else if (emptySide) {
        // empty container: charred dark shell with a faint inner rim
        col = (x + y) % 2 === 0 ? '#3a2430' : '#2c1a24';
        if (cy === 1) col = '#4b3040';          // top-edge highlight of the vessel
      } else {
        // MC volume: bright top rows → deep bottom rows, left-lit
        const shade = cy <= 1 ? 1.22 : cy <= 2 ? 1.08 : cy <= 3 ? 0.97 : cy <= 4 ? 0.8 : 0.62;
        const r = Math.min(255, Math.round(0xff * shade));
        const g2 = Math.round(0x2a * shade);
        const b2 = Math.round(0x36 * shade);
        col = `rgb(${r},${g2},${b2})`;
        // the classic specular: white pixel on the top-left lobe + light rim
        if (cx === 1 && cy === 1) col = '#ffe9ec';
        if (cx === 2 && cy === 1) col = '#ff9aa4';
        if (cx === 1 && cy === 2) col = '#ff8f9a';
        // darker right edge for roundness (reads even at 26px)
        if (cx === 5 && cy >= 2 && cy <= 3) col = '#c21f30';
      }
      c.fillStyle = col;
      c.fillRect(x * px, y * px, px, px);
    }
  }
  return cv.toDataURL('image/png');
}

const heartCache = new Map<string, string>();
export function heartDataURL(state: 'full' | 'half' | 'empty'): string {
  let v = heartCache.get(state);
  if (!v) { v = drawHeart(state); heartCache.set(state, v); }
  return v;
}
