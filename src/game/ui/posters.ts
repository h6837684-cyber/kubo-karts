// KUBO KARTS v3 - Illustrated track POSTERS (quick race, seasons, modes).
// user: "به مسابقه سریع به جای اون گرادیانت‌ها و متن و ایموجی درهم عکس و
// طراحی خفن بزاری". Every theme gets its own flat-shaded landscape drawn from
// its REAL palette: layered sky bands, silhouettes unique to the world
// (castle keep, dunes + pyramid, volcano, skyline, floating islands...) and a
// perspective race road with curbs running into the horizon. Rendered once
// per theme to a canvas and cached as a data-URL.
import { themeById, type ThemeDef } from '../world/themes';
import { makeRng } from '../core/utils';

/** multiply a hex color's brightness by f (f>1 brightens, clamped) */
function shade(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

const cache = new Map<string, string>();
const W = 480, H = 270;
const HZ = 150; // horizon line

type Ctx = CanvasRenderingContext2D;
type Rng = () => number;

function poly(c: Ctx, pts: number[], fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fill();
}
function rect(c: Ctx, x: number, y: number, w: number, h: number, fill: string) { c.fillStyle = fill; c.fillRect(x, y, w, h); }
function circle(c: Ctx, x: number, y: number, r: number, fill: string) { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }

function sky(c: Ctx, th: ThemeDef, night: boolean, r: Rng) {
  const bands = night
    ? ['#070a1c', '#0c1130', '#141a44', '#1d2458']
    : [th.sky.top, shade(th.sky.top, 1.12), th.sky.bottom, th.sky.horizon];
  const bh = HZ / bands.length;
  bands.forEach((b, i) => rect(c, 0, i * bh, W, bh + 1, b));
  if (night) {
    for (let i = 0; i < 70; i++) {
      const s = r() < 0.12 ? 2 : 1;
      rect(c, r() * W, r() * HZ * 0.85, s, s, r() < 0.3 ? '#9fb4ff' : '#ffffff');
    }
    circle(c, W * 0.78, 42, 17, '#f4f0d8');
    circle(c, W * 0.78 + 7, 37, 14, '#0c1130');
  } else {
    circle(c, W * 0.8, 44, 26, shade(th.sky.sun, 0.98));
    circle(c, W * 0.8, 44, 19, '#fffbe9');
    // flat pixel clouds
    for (let i = 0; i < 4; i++) {
      const x = r() * W, y = 18 + r() * 60, w = 40 + r() * 60;
      rect(c, x, y, w, 8, 'rgba(255,255,255,0.85)');
      rect(c, x + w * 0.2, y - 6, w * 0.45, 7, 'rgba(255,255,255,0.85)');
    }
  }
}

function mountains(c: Ctx, th: ThemeDef, r: Rng, night: boolean) {
  const base = night ? shade(th.mountains, 0.45) : th.mountains;
  for (let layer = 0; layer < 2; layer++) {
    const col = layer === 0 ? shade(base, 0.82) : base;
    const y0 = HZ - (layer === 0 ? 62 : 40);
    const pts: number[] = [0, HZ];
    let x = -20;
    while (x < W + 40) {
      const pw = 50 + r() * 70;
      const ph = y0 + r() * 26;
      pts.push(x + pw / 2, ph, x + pw, HZ - 8 - r() * 10);
      if (th.mountainSnow && layer === 1 && !night) {
        poly(c, [x + pw / 2, ph, x + pw / 2 - 11, ph + 12, x + pw / 2 + 11, ph + 12], th.mountainSnow);
      }
      x += pw;
    }
    pts.push(W, HZ);
    poly(c, pts, col);
  }
}

function silhouettes(c: Ctx, th: ThemeDef, r: Rng, night: boolean) {
  const dk = (h: string, f = 0.7) => shade(h, night ? f * 0.6 : f);
  const neon = th.neon ?? ['#ff3db8', '#39e6ff', '#ffe14d'];
  switch (th.id) {
    case 'castle': {
      const s = dk('#7d8492', 0.9);
      rect(c, 80, HZ - 70, 90, 70, s);
      for (let i = 0; i < 5; i++) rect(c, 80 + i * 20, HZ - 78, 10, 9, s);
      rect(c, 60, HZ - 96, 28, 96, dk('#8a92a0', 0.9));
      rect(c, 162, HZ - 110, 30, 110, dk('#8a92a0', 0.9));
      poly(c, [58, HZ - 96, 74, HZ - 122, 90, HZ - 96], '#c0392b');
      poly(c, [160, HZ - 110, 177, HZ - 140, 194, HZ - 110], '#c0392b');
      rect(c, 176, HZ - 152, 2, 14, '#333');
      poly(c, [178, HZ - 152, 192, HZ - 148, 178, HZ - 144], '#ffd23f');
      rect(c, 118, HZ - 34, 16, 34, '#2a1d14');
      break;
    }
    case 'desert': {
      poly(c, [250, HZ, 320, HZ - 78, 390, HZ], dk('#e2b465', 0.95));
      poly(c, [320, HZ - 78, 390, HZ, 340, HZ], dk('#c7964a', 0.95));
      for (let i = 0; i < 3; i++) {
        const x = 30 + i * 70;
        poly(c, [x - 60, HZ, x + 10, HZ - 22 - r() * 12, x + 80, HZ], dk(th.ground.alt, 0.92));
      }
      rect(c, 120, HZ - 44, 6, 44, dk('#3d7a3a', 0.8));
      rect(c, 110, HZ - 30, 6, 16, dk('#3d7a3a', 0.8));
      rect(c, 130, HZ - 36, 6, 14, dk('#3d7a3a', 0.8));
      break;
    }
    case 'snow': case 'grass': case 'jungle': {
      const n = th.id === 'jungle' ? 18 : 12;
      for (let i = 0; i < n; i++) {
        const x = r() * W, h = 26 + r() * 30;
        if (th.id === 'grass') {
          rect(c, x + 7, HZ - h * 0.5, 4, h * 0.5, '#5a3d24');
          circle(c, x + 9, HZ - h * 0.6, h * 0.36, dk(th.ground.accent, 0.85));
        } else {
          const col = th.id === 'snow' ? dk('#2f6b55', 0.85) : dk('#1f7a3a', 0.8);
          poly(c, [x, HZ, x + 10, HZ - h, x + 20, HZ], col);
          if (th.id === 'snow') poly(c, [x + 5, HZ - h / 2, x + 10, HZ - h, x + 15, HZ - h / 2], '#eef6fb');
        }
      }
      if (th.id === 'grass') {
        rect(c, 330, HZ - 50, 12, 50, '#e8e2d4');
        c.save(); c.translate(336, HZ - 50); c.rotate(0.5);
        for (let k = 0; k < 4; k++) { c.rotate(Math.PI / 2); rect(c, -2, 0, 4, 30, '#c9b89a'); }
        c.restore();
      }
      if (th.id === 'jungle') for (let i = 0; i < 8; i++) rect(c, r() * W, 0, 3, 30 + r() * 50, '#2e7d32');
      break;
    }
    case 'volcano': {
      poly(c, [150, HZ, 240, HZ - 105, 272, HZ - 105, 370, HZ], dk('#4a2a22', 0.9));
      poly(c, [240, HZ - 105, 256, HZ - 92, 272, HZ - 105], '#ff7a1a');
      poly(c, [252, HZ - 96, 244, HZ - 40, 262, HZ - 60, 258, HZ - 96], '#ff5a1a');
      for (let i = 0; i < 16; i++) rect(c, 230 + r() * 60, HZ - 130 - r() * 60, 3, 3, r() < 0.5 ? '#ffb13d' : '#ff5541');
      rect(c, 0, HZ - 4, W, 4, '#ff6a1a');
      break;
    }
    case 'cave': {
      rect(c, 0, 0, W, 30, '#171320');
      for (let x = 0; x < W; x += 22) poly(c, [x, 28, x + 11, 50 + r() * 40, x + 22, 28], '#1f1a2c');
      for (let i = 0; i < 7; i++) { const x = 30 + r() * (W - 60); poly(c, [x, HZ, x + 8, HZ - 30 - r() * 20, x + 16, HZ], '#57e8ff'); poly(c, [x + 8, HZ - 20, x + 8, HZ - 40, x + 16, HZ], '#b6f5ff'); }
      break;
    }
    case 'sky': {
      for (let i = 0; i < 4; i++) {
        const x = 30 + i * 115 + r() * 20, y = 60 + r() * 60, w = 60 + r() * 30;
        rect(c, x, y, w, 10, th.ground.base);
        poly(c, [x, y + 10, x + w, y + 10, x + w / 2, y + 40], dk('#8a6a4a', 0.9));
        rect(c, x + w / 2 - 3, y - 18, 6, 18, '#6b4a2a');
        circle(c, x + w / 2, y - 22, 10, dk(th.ground.accent, 0.9));
      }
      break;
    }
    case 'city': case 'crashcity': case 'mccity': {
      let x = 0;
      while (x < W) {
        const bw = 26 + r() * 34, bh = 40 + r() * (th.id === 'crashcity' ? 100 : 76);
        const bc = th.id === 'mccity' ? (r() < 0.5 ? '#1c2a1e' : '#232a33') : (r() < 0.5 ? '#141a33' : '#1b2140');
        rect(c, x, HZ - bh, bw - 3, bh, bc);
        for (let wy = HZ - bh + 6; wy < HZ - 6; wy += 8)
          for (let wx = x + 4; wx < x + bw - 8; wx += 7)
            if (r() < 0.42) rect(c, wx, wy, 3, 4, r() < 0.2 ? neon[Math.floor(r() * neon.length)] : '#ffd98a');
        if (r() < 0.35) rect(c, x + 3, HZ - bh - 4, bw - 9, 3, neon[Math.floor(r() * neon.length)]);
        x += bw;
      }
      break;
    }
    case 'ruins': {
      for (let i = 0; i < 6; i++) {
        const x = 30 + i * 75, h = 40 + r() * 50;
        rect(c, x, HZ - h, 14, h, dk('#b3a582', 0.9));
        rect(c, x - 4, HZ - h - 6, 22, 6, dk('#cbbd98', 0.9));
        if (r() < 0.5) rect(c, x + 14, HZ - h, 40, 8, dk('#a39570', 0.9));
      }
      break;
    }
    // ---- v3.3 premium maps ----
    case 'candy': {
      for (let i = 0; i < 9; i++) {
        const x = 20 + i * 52 + r() * 16, h = 30 + r() * 34;
        rect(c, x, HZ - h, 3, h, '#fff3f8');
        const col = ['#ff4fa3', '#ffd23f', '#3ee6c8', '#a66bff'][i % 4];
        circle(c, x + 1.5, HZ - h, 12, col);
        circle(c, x + 1.5, HZ - h, 7, '#ffffff');
        circle(c, x + 1.5, HZ - h, 3.5, col);
      }
      for (let i = 0; i < 6; i++) { const x = r() * W; circle(c, x, HZ - 2, 8 + r() * 6, ['#ff8ccf', '#8fe9ff', '#fff07a'][i % 3]); }
      break;
    }
    case 'galaxy': {
      const g = c.createRadialGradient(W * 0.3, 60, 5, W * 0.3, 60, 170);
      g.addColorStop(0, 'rgba(255,61,240,0.55)'); g.addColorStop(0.5, 'rgba(120,40,255,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, HZ);
      circle(c, W * 0.2, 55, 26, '#5a3cff'); circle(c, W * 0.2 - 7, 49, 20, '#7d66ff');
      c.strokeStyle = '#00f0ff'; c.lineWidth = 3; c.beginPath(); c.ellipse(W * 0.2, 55, 44, 9, -0.25, 0, Math.PI * 2); c.stroke();
      for (let i = 0; i < 8; i++) { const x = 30 + i * 60, h = 40 + r() * 60; rect(c, x, HZ - h, 6, h, '#1a1236'); rect(c, x - 2, HZ - h - 4, 10, 4, neon[i % neon.length]); }
      break;
    }
    case 'dragon': {
      for (let k = 0; k < 2; k++) {
        const x = 70 + k * 250, base = HZ;
        for (let i = 0; i < 4; i++) {
          const w = 90 - i * 18, y = base - 18 - i * 22;
          rect(c, x - w / 2 + 8, y + 4, w - 16, 18, dk('#7a1010', 0.9));
          poly(c, [x - w / 2 - 8, y + 6, x + w / 2 + 8, y + 6, x + w / 2 - 6, y - 4, x - w / 2 + 6, y - 4], '#ffb300');
        }
        circle(c, x, base - 110, 5, '#ffd84a');
      }
      for (let i = 0; i < 10; i++) circle(c, 20 + i * 48, HZ - 40 - r() * 30, 5, '#ff3a1a');
      break;
    }
    case 'royal': {
      for (let i = 0; i < 12; i++) {
        const bw = 22 + r() * 22, bh = 50 + r() * 90, x = i * 42 + r() * 10;
        rect(c, x, HZ - bh, bw, bh, '#1b1712');
        for (let y = HZ - bh + 6; y < HZ - 6; y += 9) for (let xx = x + 4; xx < x + bw - 4; xx += 7) if (r() < 0.55) rect(c, xx, y, 3, 4, '#ffd86b');
        rect(c, x, HZ - bh, bw, 3, '#d4a017');
      }
      poly(c, [W * 0.5 - 22, 40, W * 0.5 - 14, 20, W * 0.5 - 4, 34, W * 0.5 + 4, 16, W * 0.5 + 12, 34, W * 0.5 + 22, 20, W * 0.5 + 28, 40], '#ffc62e');
      break;
    }
    case 'megaramp': {
      poly(c, [120, HZ, 420, HZ - 130, 440, HZ - 130, 440, HZ], dk('#6c7a8c', 0.9));
      poly(c, [120, HZ, 420, HZ - 130, 420, HZ - 122, 140, HZ], '#ffd23f');
      for (let i = 0; i < 6; i++) rect(c, 180 + i * 42, HZ - 26 - i * 18, 4, 26 + i * 18, '#3b4656');
      break;
    }
  }
}

function road(c: Ctx, th: ThemeDef, night: boolean) {
  const g = night ? shade(th.ground.base, 0.5) : th.ground.base;
  rect(c, 0, HZ, W, H - HZ, g);
  // ground stripes (mowed lanes) for depth
  for (let i = 0; i < 6; i++) {
    const y0 = HZ + Math.pow(i / 6, 1.8) * (H - HZ);
    const y1 = HZ + Math.pow((i + 0.5) / 6, 1.8) * (H - HZ);
    rect(c, 0, y0, W, y1 - y0, night ? shade(th.ground.alt, 0.5) : th.ground.alt);
  }
  const vx = W * 0.56;
  const L = (t: number) => vx - 6 + (W * 0.02 - (vx - 6)) * t;   // left edge x at depth t (0 horizon .. 1 bottom)
  const R = (t: number) => vx + 6 + (W * 0.98 - (vx + 6)) * t;
  const Y = (t: number) => HZ + (H - HZ) * t;
  // curbs
  const segs = 10;
  for (let i = 0; i < segs; i++) {
    const t0 = Math.pow(i / segs, 1.6), t1 = Math.pow((i + 1) / segs, 1.6);
    const cc = i % 2 ? th.road.curbA : th.road.curbB;
    const cw = (t: number) => 3 + 22 * t;
    poly(c, [L(t0) - cw(t0), Y(t0), L(t0), Y(t0), L(t1), Y(t1), L(t1) - cw(t1), Y(t1)], cc);
    poly(c, [R(t0), Y(t0), R(t0) + cw(t0), Y(t0), R(t1) + cw(t1), Y(t1), R(t1), Y(t1)], cc);
  }
  poly(c, [L(0), Y(0), R(0), Y(0), R(1), Y(1), L(1), Y(1)], night ? shade(th.road.base, 0.6) : th.road.base);
  // center dashes
  for (let i = 0; i < segs; i += 2) {
    const t0 = Math.pow(i / segs, 1.6), t1 = Math.pow((i + 1) / segs, 1.6);
    const cx0 = (L(t0) + R(t0)) / 2, cx1 = (L(t1) + R(t1)) / 2;
    const w0 = 1 + 5 * t0, w1 = 1 + 5 * t1;
    poly(c, [cx0 - w0, Y(t0), cx0 + w0, Y(t0), cx1 + w1, Y(t1), cx1 - w1, Y(t1)], th.road.line);
  }
  // start gantry
  const t = 0.34;
  const gy = Y(t);
  rect(c, L(t) - 20, gy - 70, 5, 70, '#23283a');
  rect(c, R(t) + 15, gy - 70, 5, 70, '#23283a');
  rect(c, L(t) - 20, gy - 76, R(t) - L(t) + 40, 14, '#23283a');
  for (let k = 0; k < 16; k++) rect(c, L(t) - 16 + k * ((R(t) - L(t) + 32) / 16), gy - 73 + (k % 2) * 4, (R(t) - L(t) + 32) / 16, 4, k % 2 ? '#fff' : '#111');
  if (night) {
    // headlight pool
    c.fillStyle = 'rgba(255,240,190,0.10)';
    c.beginPath(); c.moveTo(W * 0.4, H); c.lineTo(vx, HZ + 20); c.lineTo(W * 0.72, H); c.fill();
  }
}

/** flat-shaded illustration of a theme (cached PNG data-URL) */
export function themePoster(themeId: string): string {
  const hit = cache.get(themeId);
  if (hit) return hit;
  const th = themeById(themeId);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d')!;
  let seed = 0;
  for (const ch of themeId) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  const r = makeRng(Math.abs(seed) + 7) as Rng;
  const night = !!th.night;
  try {
    sky(c, th, night, r);
    mountains(c, th, r, night);
    silhouettes(c, th, r, night);
    road(c, th, night);
  } catch {
    rect(c, 0, 0, W, H, th.ground.base);
  }
  const url = cv.toDataURL('image/png');
  cache.set(themeId, url);
  return url;
}
