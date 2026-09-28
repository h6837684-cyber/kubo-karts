// KUBO KARTS - Real 3D card thumbnails: render each voxel car / character /
// customization option with a tiny offscreen WebGL renderer and cache PNG
// data-URLs. (user: "منوها همراه با تصویر باشن — نشون بدن چی میخوام اضافه کنم"
// — every menu option must SHOW what it adds, not just say A/B/C.)
import * as THREE from 'three';
import { buildCar, buildWheel } from '../vox/car';
import { buildCharacter } from '../vox/char';
import { carById } from '../data/cars';
import { charById } from '../data/characters';
import type { CarCustom } from '../core/save';

const cache = new Map<string, string>();
// v1.12 (user: "عکس ماشین‌ها بزرگ‌تر باشه، از بقل و تمام‌قد"): the offscreen
// renderer now outputs 2.6× more pixels so every card image stays crisp at
// the bigger CSS sizes.
const W = 384, H = 240;
let renderer: THREE.WebGLRenderer | null = null;

function ensureRenderer(): THREE.WebGLRenderer {
  if (renderer) return renderer;
  renderer = new THREE.WebGLRenderer({
    antialias: true, alpha: true, preserveDrawingBuffer: true,
    powerPreference: 'low-power',
  });
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  return renderer;
}

function renderObject(obj: THREE.Object3D, camCfg: {
  yaw?: number; pitch?: number; zoom?: number; fov?: number; targetY?: number;
  fit?: 'v' | 'h';   // v1.12: fit the subject into the VERTICAL (default) or HORIZONTAL frustum
}): string | null {
  const r = ensureRenderer();
  try {
    const scene = new THREE.Scene();
    scene.add(obj);
    const hemi = new THREE.HemisphereLight(0xeaf2ff, 0x39415a, 1.1);
    const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(4, 8, 5);
    const rim = new THREE.DirectionalLight(0xa9c8ff, 0.7); rim.position.set(-6, 3, -5);
    scene.add(hemi, key, rim);

    // bounding box from VISIBLE meshes only — the new headlight beam cones and
    // underglow planes are visible=false at menu time and must NOT inflate the
    // framing (they made every thumbnail render tiny)
    const box = new THREE.Box3();
    const _p = new THREE.Vector3();
    obj.updateWorldMatrix(true, true);
    obj.traverse(o => {
      if (!(o instanceof THREE.Mesh) || !o.visible) return;
      if (!o.geometry) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox!;
      for (const c of [bb.min, bb.max]) {
        _p.copy(c).applyMatrix4(o.matrixWorld);
        box.expandByPoint(_p);
      }
    });
    if (box.isEmpty()) box.setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camCfg.fov ?? 32;
    const cam = new THREE.PerspectiveCamera(fov, W / H, 0.05, 120);
    // v1.12: 'h' fits the subject across the HORIZONTAL frustum (side-view car
    // profiles fill the whole image width — "عکس بزرگ و تمام‌قد"), 'v' (default)
    // keeps the old vertical fit.
    const fitMul = camCfg.fit === 'h' ? (W / H) : 1;
    const dist = (maxDim / 2) / (Math.tan(THREE.MathUtils.degToRad(fov) / 2) * fitMul) * (camCfg.zoom ?? 1.28);
    const yaw = camCfg.yaw ?? 0.52, pitch = camCfg.pitch ?? 0.4;
    cam.position.set(
      center.x + dist * Math.cos(pitch) * Math.sin(yaw),
      center.y + dist * Math.sin(pitch) + (camCfg.targetY ?? 0),
      center.z + dist * Math.cos(pitch) * Math.cos(yaw),
    );
    cam.lookAt(center.x, center.y - size.y * 0.05 + (camCfg.targetY ?? 0), center.z);

    r.render(scene, cam);
    return r.domElement.toDataURL('image/png');
  } catch {
    return null;
  } finally {
    scene_dispose(obj);
  }
}

function scene_dispose(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
  if (obj.parent) obj.parent.remove(obj);
}

/**
 * get (or render) the car thumbnail.
 * v1.12 (user: "از بقل باشه و تمام قد باشه"): TRUE SIDE PROFILE — camera sits
 * on the car's flank (yaw π/2), nearly level (pitch 0.10), fully framed so
 * the entire car fits head-to-tail with margin (zoom 1.16).
 */
export function carThumb(carId: string): string | null {
  const hit = cache.get('car:' + carId);
  if (hit) return hit;
  try {
    const def = carById(carId);
    const model = buildCar(def, undefined, false);
    const url = renderObject(model.group, { yaw: Math.PI / 2, pitch: 0.10, zoom: 1.08, fov: 30, fit: 'h' });
    if (url) cache.set('car:' + carId, url);
    return url;
  } catch {
    return null;
  }
}

/** character portrait thumbnail — v1.12: FULL BODY ("تمام قد"), bigger frame */
export function charThumb(charId: string): string | null {
  const hit = cache.get('char:' + charId);
  if (hit) return hit;
  try {
    const def = charById(charId);
    const model = buildCharacter(def);
    model.group.rotation.y = -0.5;
    const url = renderObject(model.group, { yaw: 0.3, pitch: 0.05, zoom: 1.1, fov: 34 });
    if (url) cache.set('char:' + charId, url);
    return url;
  } catch {
    return null;
  }
}

/** wheel style thumbnail (customize menu: show the actual rim design) */
export function wheelThumb(style: number, size = 1): string | null {
  const hit = cache.get(`wheel:${style}`);
  if (hit) return hit;
  try {
    const wheel = buildWheel(style, size, '#1c1c1c');
    wheel.rotation.y = Math.PI / 2;
    const url = renderObject(wheel, { yaw: 0.0, pitch: 0.12, zoom: 1.5, fov: 34 });
    if (url) cache.set(`wheel:${style}`, url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Customization previews rendered ON THE CAR itself: pass a CarCustom override
 * (spoiler/decal/exhaust/glow…) and get the car from the chosen angle. Cached
 * per option so the menu stays instant after first open.
 */
export function customThumb(carId: string, override: Partial<CarCustom>, view: 'front' | 'rear' | 'glow'): string | null {
  const key = `custom:${carId}:${view}:${JSON.stringify(override)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const def = carById(carId);
    const base: CarCustom = {
      paint: def.bodyColor, paint2: def.accentColor, wheelStyle: def.model.wheelStyle,
      wheelColor: '#1c1c1c', spoiler: -1, decal: 0, exhaust: 1,
      boostColor: '#ff9a3d', glow: '', upgrade: 0,
    };
    const custom: CarCustom = { ...base, ...override };
    // paint carries over so previews match the player's car
    custom.paint = def.bodyColor;
    custom.paint2 = def.accentColor;
    const model = buildCar(def, custom, false);
    const cfg =
      view === 'front' ? { yaw: 0.85, pitch: 0.3, zoom: 0.98 } :
      view === 'rear' ? { yaw: Math.PI - 0.55, pitch: 0.26, zoom: 1.0 } :
      { yaw: Math.PI - 0.4, pitch: 0.6, zoom: 1.1 };  // glow: high rear 3/4 to see the floor
    const url = renderObject(model.group, cfg);
    if (url) cache.set(key, url);
    return url;
  } catch {
    return null;
  }
}

export function thumbCached(carId: string): string | null {
  return cache.get('car:' + carId) ?? null;
}
