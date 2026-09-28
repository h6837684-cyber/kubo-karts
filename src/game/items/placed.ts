// KUBO KARTS v3.1 part 2 - "REAL ITEMS" mode (user: "اگه آیتم زد باید خود آیتم‌ها
// داخل بازی باشه یعنی مثل موز و ریل و نیترو").
// Instead of a yellow ? box, every box spot shows the ACTUAL power-up floating
// over the road: a 3D model for the iconic ones (nitro canister, banana,
// minecart on a rail, TNT, rocket, shield bubble) and a chunky spinning
// medallion with the hand-drawn icon for the rest. You see what you grab.
//
// Item choice per spot is deterministic (track seed + spot index + respawn
// generation) so every client in a multiplayer race sees the same items.
import * as THREE from 'three';
import type { ItemId } from './items';
import { itemIconCanvas } from '../ui/icons';

export type ItemMode = 'mystery' | 'placed';

/** placed-mode weights: a friendly mix (no rank bias — you choose what to take) */
const PLACED_W: Partial<Record<ItemId, number>> = {
  boost: 16, banana: 12, shield: 10, rocket: 9, minecart: 7, tnt: 7, mine: 6, jump: 6,
  magnet: 6, emp: 5, ice: 6, trap: 5, ghost: 5, lightning: 3, giant: 3,
};

function hash(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function pickPlacedItem(seed: number, spot: number, gen: number, enabled: Set<ItemId> | null): ItemId {
  const ids = (Object.keys(PLACED_W) as ItemId[]).filter(id => !enabled || enabled.has(id));
  if (!ids.length) return 'boost';
  // neighbours in the same row should differ: mix the spot index hard
  let sum = 0;
  for (const id of ids) sum += PLACED_W[id]!;
  let r = hash(seed | 0, spot, gen) * sum;
  for (const id of ids) { r -= PLACED_W[id]!; if (r <= 0) return id; }
  return ids[0];
}

// ---------------- shared resources (built once, never disposed per race) ----------------
const texCache = new Map<string, THREE.Texture>();
function iconTex(id: ItemId): THREE.Texture {
  let tx = texCache.get(id);
  if (!tx) {
    tx = new THREE.CanvasTexture(itemIconCanvas(id, 128));
    tx.colorSpace = THREE.SRGBColorSpace;
    tx.anisotropy = 4;
    texCache.set(id, tx);
  }
  return tx;
}
function glowTex(): THREE.Texture {
  let tx = texCache.get('__glow');
  if (!tx) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 128;
    const c = cv.getContext('2d')!;
    const g = c.createRadialGradient(64, 64, 4, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
    tx = new THREE.CanvasTexture(cv);
    texCache.set('__glow', tx);
  }
  return tx;
}

const COLORS: Record<ItemId, number> = {
  boost: 0x2fd0ff, shield: 0x5ad0ff, rocket: 0xff5252, lightning: 0x4fc3ff, ice: 0xaee8ff, trap: 0x8a8f96,
  mine: 0xff3b30, magnet: 0xff5ad0, emp: 0xb45aff, giant: 0x67c23a, ghost: 0xcfe8ff, jump: 0xd08a45,
  tnt: 0xe53935, banana: 0xffe14d, minecart: 0xb0bac4,
};

const lam = (color: number, emissive = 0x000000) => new THREE.MeshLambertMaterial({ color, emissive });
function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; return b;
}
function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 14) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); c.castShadow = true; return c;
}

// ---------------- 3D models ----------------
function modelNitro(): THREE.Object3D {
  const g = new THREE.Group();
  const body = cyl(0.26, 0.26, 0.8, lam(0x1b6fe0, 0x0a2c66)); g.add(body);
  const band = cyl(0.27, 0.27, 0.16, lam(0xffffff, 0x444444)); band.position.y = 0.05; g.add(band);
  const nos = cyl(0.272, 0.272, 0.07, lam(0xff3b30, 0x5a0000)); nos.position.y = 0.05; g.add(nos);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), lam(0x1b6fe0, 0x0a2c66)); dome.position.y = 0.4; g.add(dome);
  const valve = cyl(0.07, 0.09, 0.18, lam(0xc9d1d9, 0x333333), 8); valve.position.y = 0.72; g.add(valve);
  const knob = box(0.26, 0.06, 0.08, lam(0xff3b30, 0x440000)); knob.position.y = 0.82; g.add(knob);
  // blue plasma flame under the canister
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x6fe8ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.x = Math.PI; flame.position.y = -0.66; g.add(flame);
  g.userData.flame = flame;
  g.rotation.z = 0.25;
  return g;
}
function modelBanana(): THREE.Object3D {
  const g = new THREE.Group();
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.5, 0.25, 0), new THREE.Vector3(0, -0.35, 0), new THREE.Vector3(0.5, 0.25, 0));
  const body = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.17, 10, false), lam(0xffe14d, 0x4a3a00));
  body.castShadow = true; g.add(body);
  for (const [x, y] of [[-0.5, 0.25], [0.5, 0.25]] as const) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), lam(0xffe14d, 0x4a3a00)); cap.position.set(x, y, 0); g.add(cap);
  }
  const stem = cyl(0.05, 0.07, 0.2, lam(0x6b4a1e), 6); stem.position.set(0.58, 0.38, 0); stem.rotation.z = -0.6; g.add(stem);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), lam(0x3a2a10)); tip.position.set(-0.62, 0.3, 0); g.add(tip);
  return g;
}
function modelMinecart(): THREE.Object3D {
  const g = new THREE.Group();
  const iron = lam(0x9aa4ae, 0x1c2228), dark = lam(0x3b4148), wood = lam(0x8a5a2b, 0x1a0e00);
  // rail piece under it
  for (const x of [-0.32, 0.32]) g.add(box(0.07, 0.07, 1.3, iron, x, -0.42, 0));
  for (const z of [-0.45, 0, 0.45]) g.add(box(0.95, 0.06, 0.16, wood, 0, -0.48, z));
  // cart tub
  g.add(box(0.8, 0.12, 0.95, dark, 0, -0.15, 0));
  g.add(box(0.8, 0.42, 0.08, iron, 0, 0.1, 0.44));
  g.add(box(0.8, 0.42, 0.08, iron, 0, 0.1, -0.44));
  g.add(box(0.08, 0.42, 0.95, iron, 0.4, 0.1, 0));
  g.add(box(0.08, 0.42, 0.95, iron, -0.4, 0.1, 0));
  // gold ore peeking out
  const gold = lam(0xffc21a, 0x6a4200);
  g.add(box(0.26, 0.2, 0.26, gold, -0.12, 0.28, 0.1), box(0.22, 0.18, 0.22, gold, 0.14, 0.26, -0.12));
  for (const x of [-0.34, 0.34]) for (const z of [-0.3, 0.3]) {
    const w = cyl(0.12, 0.12, 0.08, dark, 10); w.rotation.z = Math.PI / 2; w.position.set(x * 1.12, -0.3, z); g.add(w);
  }
  g.scale.setScalar(0.9);
  return g;
}
function modelTnt(): THREE.Object3D {
  const g = new THREE.Group();
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#d93a2b'; c.fillRect(0, 0, 64, 64);
  c.fillStyle = '#f2f2f2'; c.fillRect(0, 22, 64, 20);
  c.fillStyle = '#111'; c.font = 'bold 17px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('TNT', 32, 33);
  c.fillStyle = 'rgba(0,0,0,0.18)'; for (let x = 0; x < 64; x += 16) c.fillRect(x, 0, 2, 64);
  const tx = new THREE.CanvasTexture(cv); tx.magFilter = THREE.NearestFilter; tx.colorSpace = THREE.SRGBColorSpace;
  const side = new THREE.MeshLambertMaterial({ map: tx, emissive: 0x220000 });
  const top = lam(0xb8342a, 0x220000);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.72), [side, side, top, top, side, side]);
  b.castShadow = true; g.add(b);
  const fuse = cyl(0.03, 0.03, 0.22, lam(0x333333), 5); fuse.position.y = 0.46; g.add(fuse);
  const spark = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd54f }));
  spark.position.y = 0.6; g.add(spark); g.userData.spark = spark;
  return g;
}
function modelRocket(): THREE.Object3D {
  const g = new THREE.Group();
  const body = cyl(0.17, 0.17, 0.75, lam(0xf2f4f6, 0x222222)); body.rotation.z = Math.PI / 2; g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.35, 14), lam(0xff3b30, 0x440000)); nose.rotation.z = -Math.PI / 2; nose.position.x = 0.55; g.add(nose);
  for (let i = 0; i < 4; i++) {
    const fin = box(0.22, 0.02, 0.2, lam(0xff3b30, 0x330000)); fin.position.x = -0.3;
    const piv = new THREE.Group(); piv.rotation.x = (i / 4) * Math.PI * 2; fin.position.z = 0.2; piv.add(fin); g.add(piv);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame.rotation.z = Math.PI / 2; flame.position.x = -0.6; g.add(flame); g.userData.flame = flame;
  g.rotation.z = 0.35;
  return g;
}
function modelShield(): THREE.Object3D {
  const g = new THREE.Group();
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x5ad0ff, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false }));
  g.add(bubble);
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.32); shape.quadraticCurveTo(0.2, 0.3, 0.26, 0.24); shape.lineTo(0.24, -0.02);
  shape.quadraticCurveTo(0.2, -0.24, 0, -0.34); shape.quadraticCurveTo(-0.2, -0.24, -0.24, -0.02);
  shape.lineTo(-0.26, 0.24); shape.quadraticCurveTo(-0.2, 0.3, 0, 0.32);
  const crest = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }), lam(0x38b6f0, 0x0c3a5a));
  crest.position.z = -0.04; g.add(crest);
  g.userData.bubble = bubble;
  return g;
}

/** chunky spinning medallion with the item icon on both faces */
function medallion(id: ItemId): THREE.Object3D {
  const g = new THREE.Group();
  const rim = new THREE.MeshLambertMaterial({ color: COLORS[id], emissive: new THREE.Color(COLORS[id]).multiplyScalar(0.35) });
  const face = new THREE.MeshBasicMaterial({ map: iconTex(id), transparent: true });
  const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.14, 28), [rim, face, face]);
  coin.rotation.x = Math.PI / 2;
  coin.castShadow = true;
  g.add(coin);
  const torus = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.05, 6, 28), lam(0xffffff, 0x555555));
  g.add(torus);
  return g;
}

/** build the floating token for an item. Caller owns disposal via disposeToken(). */
export function buildItemToken(id: ItemId): THREE.Group {
  const g = new THREE.Group();
  let model: THREE.Object3D;
  switch (id) {
    case 'boost': model = modelNitro(); break;
    case 'banana': model = modelBanana(); break;
    case 'minecart': model = modelMinecart(); break;
    case 'tnt': model = modelTnt(); break;
    case 'rocket': model = modelRocket(); break;
    case 'shield': model = modelShield(); break;
    default: model = medallion(id);
  }
  model.name = 'model';
  g.add(model);
  // soft colored halo behind (always faces camera)
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9),
    new THREE.MeshBasicMaterial({ map: glowTex(), color: COLORS[id], transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.name = 'halo';
  halo.renderOrder = 1;
  g.add(halo);
  // glowing ring on the road under it
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.78, 28),
    new THREE.MeshBasicMaterial({ color: COLORS[id], transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -1.02;
  ring.name = 'ring';
  g.add(ring);
  g.userData.itemId = id;
  return g;
}

/** per-frame animation: spin, bob, flame flicker, halo facing camera */
export function animateToken(tok: THREE.Object3D, t: number, dt: number, cam: THREE.Camera) {
  const model = tok.getObjectByName('model');
  if (model) {
    model.rotation.y += dt * 1.9;
    model.position.y = Math.sin(t * 2.6) * 0.12;
    const fl = model.userData.flame as THREE.Mesh | undefined;
    if (fl) { const s = 0.8 + Math.random() * 0.45; fl.scale.set(1, s, 1); }
    const sp = model.userData.spark as THREE.Mesh | undefined;
    if (sp) sp.scale.setScalar(0.7 + Math.random() * 0.7);
    const bb = model.userData.bubble as THREE.Mesh | undefined;
    if (bb) bb.scale.setScalar(1 + Math.sin(t * 4) * 0.05);
  }
  const halo = tok.getObjectByName('halo');
  if (halo) {
    halo.quaternion.copy(cam.quaternion);
    (halo as THREE.Mesh).scale.setScalar(1 + Math.sin(t * 3.1) * 0.08);
  }
  const ring = tok.getObjectByName('ring') as THREE.Mesh | undefined;
  if (ring) {
    const k = (t * 0.8) % 1;
    ring.scale.setScalar(0.8 + k * 0.6);
    (ring.material as THREE.MeshBasicMaterial).opacity = 0.65 * (1 - k);
    // ring is a child: keep it on the ground while the parent bobs
    ring.position.y = -1.02 - (tok.userData.bobY ?? 0);
  }
}

/** free geometry + per-token materials (icon/glow textures are shared & kept) */
export function disposeToken(tok: THREE.Object3D) {
  tok.parent?.remove(tok);
  tok.traverse(o => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) for (const mm of Array.isArray(mat) ? mat : [mat]) {
      const map = (mm as THREE.MeshLambertMaterial).map;
      if (map && ![...texCache.values()].includes(map)) map.dispose();
      mm.dispose();
    }
  });
}
