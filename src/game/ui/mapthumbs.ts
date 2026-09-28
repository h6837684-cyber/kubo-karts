// KUBO KARTS - Map preview images for the multiplayer map selection.
// Each theme gets a stylized top-down preview generated from the REAL track
// layout generator (same code that builds the race world), drawn to a canvas
// and cached as a PNG data-URL. (user: "در بخش چندنفره همراه اسم مپ‌ها عکسشون
// باشه و بهترین عکس برای مپ‌ها بگیر")
import { generateTrackData, minimapPath } from '../world/track';
import { themeById } from '../world/themes';

/** a representative, good-looking layout generator per theme */
const GEN_FOR: Record<string, string> = {
  grass: 'sCurves', castle: 'figure8', desert: 'canyon', snow: 'highlands',
  volcano: 'pinball', cave: 'sCurves', sky: 'highlands', city: 'figure8',
  ruins: 'canyon', jungle: 'kidney',
  candy: 'kidney', galaxy: 'figure8', dragon: 'pretzel', royal: 'pinball',
};

const cache = new Map<string, string>();
const W = 256, H = 192;

function pathOnce(
  ctx: CanvasRenderingContext2D, pts: [number, number][],
  map: (p: [number, number]) => [number, number],
  width: number, color: string, dash?: number[],
) {
  ctx.save();
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
  ctx.beginPath();
  pts.forEach((p, i) => {
    const [x, y] = map(p);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function mapThumb(themeId: string): string {
  const hit = cache.get(themeId);
  if (hit) return hit;
  const theme = themeById(themeId);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  try {
    const data = generateTrackData(24680, { genName: GEN_FOR[themeId] ?? 'oval', laps: 1, themeId, itemRows: 0 });
    const mm = minimapPath(data);
    const PAD = 18;
    const map = (p: [number, number]): [number, number] => [
      PAD + p[0] * (W - PAD * 2),
      PAD + p[1] * (H - PAD * 2),
    ];

    // background: sea (or void for sky theme)
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, theme.water ? theme.water.shallow : '#1b2c4e');
    bg.addColorStop(0.55, theme.water ? theme.water.deep : '#0d1830');
    bg.addColorStop(1, theme.water ? theme.water.deep : '#0a1226');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // island: heavily dilated track stroke = land mass, then grass texture pass
    pathOnce(ctx, mm.pts, map, 44, theme.ground.accent);
    pathOnce(ctx, mm.pts, map, 36, theme.ground.base);
    pathOnce(ctx, mm.pts, map, 30, theme.ground.alt);

    // road shoulder, asphalt, center line
    pathOnce(ctx, mm.pts, map, 17, theme.road.edge);
    pathOnce(ctx, mm.pts, map, 13, theme.road.base);
    pathOnce(ctx, mm.pts, map, 1.6, theme.road.line, [5, 6]);

    // start/finish line across the track at pts[0]
    const [ax, ay] = map(mm.pts[0]);
    const [bx, by] = map(mm.pts[1] ?? mm.pts[4]);
    const ang = Math.atan2(by - ay, bx - ax) + Math.PI / 2;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    for (let i = -2; i <= 1; i++) {
      ctx.fillStyle = i % 2 ? '#f2f2f2' : '#20242c';
      ctx.fillRect(i * 4, -8, 4, 16);
    }
    ctx.restore();

    // item boxes as glowing dots (first N box samples)
    ctx.save();
    for (const ib of data.itemBoxes.slice(0, 8)) {
      const idx = ((ib.sIdx % mm.pts.length) + mm.pts.length) % mm.pts.length;
      const p = map(mm.pts[Math.min(mm.pts.length - 1, Math.floor(idx / 6))]);
      ctx.fillStyle = 'rgba(255,214,79,0.95)';
      ctx.beginPath(); ctx.arc(p[0], p[1], 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,214,79,0.25)';
      ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // subtle vignette for depth
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.38)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);
  } catch {
    // fallback: flat theme-colored preview
    ctx.fillStyle = theme.ground.base;
    ctx.fillRect(0, 0, W, H);
  }
  const url = c.toDataURL('image/png');
  cache.set(themeId, url);
  return url;
}
