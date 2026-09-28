// KUBO KARTS - Procedural canvas textures (voxel-style, mobile-cheap: 1 fetch).
// All textures are grayscale multipliers so vertex colors keep driving the palette.
import * as THREE from 'three';

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  return tex;
}

/** seeded value noise so every session looks identical */
function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = Math.imul(t ^ (t >>> 14), 1 | s);
    return (t >>> 0) / 4294967296;
  };
}

/**
 * Blocky grayscale noise in [dark..1]. `cells` blocks across the texture.
 * Used as a world-space detail multiply for terrain/props (via shader injection).
 */
export function makeBlockNoiseTexture(cells = 8, dark = 0.8, seed = 7): THREE.CanvasTexture {
  const size = 64;
  return canvasTex(size, (ctx, s) => {
    const rng = mulberry(seed);
    const px = Math.ceil(s / cells);
    const img = ctx.createImageData(s, s);
    const vals: number[] = [];
    for (let i = 0; i < cells * cells; i++) vals.push(dark + rng() * (1 - dark));
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const cx = Math.min(cells - 1, Math.floor(x / px));
        const cy = Math.min(cells - 1, Math.floor(y / px));
        const v = Math.floor(vals[cy * cells + cx] * 255);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/**
 * Asphalt road strip: base near-white so vertex color tints it; adds grain,
 * darker wheel tracks, faint cracks + patch blocks. u = across width, v = along.
 */
export function makeRoadTexture(): THREE.CanvasTexture {
  const s = 128;
  return canvasTex(s, (ctx) => {
    const rng = mulberry(31);
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, s, s);
    // grain blocks (16px grid)
    const g = 16;
    for (let y = 0; y < s; y += g) {
      for (let x = 0; x < s; x += g) {
        const v = Math.floor((0.86 + rng() * 0.14) * 255);
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.fillRect(x, y, g, g);
      }
    }
    // subtle wheel-track darkening (two vertical bands)
    for (const bx of [0.28, 0.72]) {
      const grd = ctx.createLinearGradient((bx - 0.09) * s, 0, (bx + 0.09) * s, 0);
      grd.addColorStop(0, 'rgba(120,120,120,0)');
      grd.addColorStop(0.5, 'rgba(120,120,120,0.16)');
      grd.addColorStop(1, 'rgba(120,120,120,0)');
      ctx.fillStyle = grd;
      ctx.fillRect((bx - 0.1) * s, 0, 0.2 * s, s);
    }
    // cracks: thin dark polylines
    ctx.strokeStyle = 'rgba(90,90,90,0.35)';
    ctx.lineWidth = 1;
    for (let c = 0; c < 5; c++) {
      let x = rng() * s, y = rng() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rng() - 0.5) * 26; y += rng() * 22;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // patch rectangles
    for (let p = 0; p < 4; p++) {
      const v = Math.floor((0.88 + rng() * 0.08) * 255);
      ctx.fillStyle = `rgba(${v},${v},${v},0.8)`;
      ctx.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 10 + rng() * 20, 8 + rng() * 16);
    }
  });
}

// v3.8 HD TEXTURE PACK (public/textures): 1024px asphalt + normal map and a
// 512px beveled voxel detail map, preloaded at boot. The small canvas
// textures above stay as a fallback if a file can't load.
const HD: Record<string, HTMLImageElement> = {};
// v3.9 ULTRA-HD PACK: HIGH / ULTRA presets load 2048px asphalt (fine
// aggregate stones + matching normal relief) and a 1024px voxel detail map.
// LOW / MEDIUM keep the 1024 set so weak phones don't pay the extra VRAM.
const HI_RES: Record<string, string> = {
  'road_albedo.jpg': 'road_albedo_2k.jpg',
  'road_normal.jpg': 'road_normal_2k.jpg',
  'detail.png': 'detail_1k.png',
};
export function preloadHDTextures(timeoutMs = 6000, hiRes = false): Promise<void> {
  const files = ['road_albedo.jpg', 'road_normal.jpg', 'detail.png'];
  const one = (f: string) => new Promise<void>((res) => {
    const load = (src: string, fallback: boolean) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { HD[f] = img; upgradeInPlace(f, img); res(); };
      img.onerror = () => { if (fallback) load(`/textures/${f}`, false); else res(); };
      img.src = src;
    };
    if (hiRes && HI_RES[f]) load(`/textures/${HI_RES[f]}`, true);
    else load(`/textures/${f}`, false);
  });
  return Promise.race([Promise.all(files.map(one)).then(() => undefined), new Promise<void>(r => setTimeout(r, timeoutMs))]);
}
function hdTex(f: string): THREE.Texture | null {
  const img = HD[f];
  if (!img) return null;
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** v3.9: materials built at import time (car paint!) grabbed the tiny canvas
 *  fallback before the HD files finished loading and kept it forever.
 *  When an HD image arrives, swap it into the existing singleton. */
function upgradeInPlace(f: string, img: HTMLImageElement) {
  const t = f === 'detail.png' ? _detail : f === 'road_albedo.jpg' ? _road : null;
  if (!t || t.image === img) return;
  t.image = img;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
}

/** Singletons (created lazily on first use, reused across worlds) */
let _detail: THREE.Texture | null = null;
export function worldDetailTexture(): THREE.Texture {
  if (!_detail) _detail = hdTex('detail.png') ?? makeBlockNoiseTexture(8, 0.8, 7);
  return _detail;
}
let _road: THREE.Texture | null = null;
export function roadTexture(): THREE.Texture {
  if (!_road) _road = hdTex('road_albedo.jpg') ?? makeRoadTexture();
  return _road;
}
let _roadN: THREE.Texture | null = null;
export function roadNormalTexture(): THREE.Texture | null {
  if (!_roadN) _roadN = hdTex('road_normal.jpg');
  return _roadN;
}
