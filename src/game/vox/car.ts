// KUBO KARTS - PREMIUM Voxel CAR Builder v3 (full rebuild #2).
// User request: "cars must look like REAL cars & be beautiful".
// Proper automobile silhouette: closed body, hood → raked windshield → roof →
// rear glass → trunk, bulging fenders over all 4 wheels, front/rear bumpers,
// grille + headlights, tail lights, mirrors, door seams + handles, exhausts,
// spoilers, roof scoops, roll cages for the buggy. Driver sits INSIDE the
// glass cabin and is scaled to fit each car (charScale) — user request.
// Grid unit u=0.10m; merged into body + emissive geometry per car.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VoxelBuilder } from './builder';
import { makeCarPaintMaterial, makeEmissiveVoxelMaterial, makeFlameMaterial, makeUnderglowMaterial, makeHeadlightBeamMaterial } from '../gfx/materials';
import type { CarDef } from '../data/cars';
import type { CarCustom } from '../core/save';

export interface CarModel {
  group: THREE.Group;
  wheels: THREE.Object3D[];        // spin groups (rotation.x)
  wheelGroups: THREE.Object3D[];   // suspension/steer hubs
  flames: THREE.Mesh[];
  brakeMats: THREE.MeshLambertMaterial[];
  reverseMats: THREE.MeshLambertMaterial[];     // white lenses — lit while reversing (§8)
  headlightMats: THREE.MeshLambertMaterial[];  // lens materials — night mode ramps their emissive
  headlightGlows: THREE.Object3D[];            // additive beams + glow sprites (night only)
  headlightSpot: THREE.SpotLight | null;       // real light for the PLAYER at night
  underglow: THREE.Object3D | null;            // glow plane + light (custom.glow)
  underglowMat: THREE.MeshBasicMaterial | null;
  bodyRoot: THREE.Group;
  ghostShell: THREE.Mesh | null;               // v1.12 body-hugging WHITE overlay (ghost ON)
  ghostShellMat: THREE.MeshBasicMaterial | null;
  boostFx: THREE.PointLight | null;
  seatY: number;                   // driver hips height (meters)
  seatZ: number;
  charScale: number;               // driver scale fitted to this cabin
}

// v1.10 CAR PAINT SHADER: the body gets panel seams, micro-grain texture,
// fresnel rim, sky reflection and a sun glint (user: "شیدر + تکسچر بهتر")
const matBody = makeCarPaintMaterial();
const matDark = new THREE.MeshLambertMaterial({ color: 0x1d2126 });
const matGrey = new THREE.MeshLambertMaterial({ color: 0x585f6a });
const matTire = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
const matChrome = new THREE.MeshPhongMaterial({ color: 0xd8dee6, shininess: 90 });
const matGlass = new THREE.MeshPhongMaterial({
  color: 0x9fd8ff, shininess: 100, transparent: true, opacity: 0.34,
  depthWrite: false, side: THREE.DoubleSide,
});
const matSeat = new THREE.MeshLambertMaterial({ color: 0x26292f });

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex);
  if (f >= 0) c.lerp(new THREE.Color(0xffffff), f);
  else c.multiplyScalar(1 + f);
  return '#' + c.getHexString();
}

// ================= WHEELS =================
// WHEEL v2 (user: "دایره‌ایش کنی" — make the tires ROUND). The old tire was
// built from voxel cubes (5-7 cell octagon) → visibly polygonal and it made
// the whole car look jittery while rolling. Now: a true 18-segment cylinder
// tire + voxel-style tread blocks + styled rim/spokes/hub, merged into ONE
// vertex-colored mesh (1 draw call per wheel, mobile friendly).

function withColor(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  // strip anything merge can't align (none of our primitives have extra attrs)
  return geo;
}

export const wheelRadius = (style: number, size: number): number => (style === 3 ? 0.29 : 0.25) * size;

export function buildWheel(style: number, size: number, color = '#1c1c1c'): THREE.Group {
  const g = new THREE.Group();
  const rimC = ['#454c55', '#e8c34a', '#e84a8a', '#4a90d9'][((style % 4) + 4) % 4];
  const R = wheelRadius(style, size);       // outer radius (m)
  const W2 = 0.115 * size;                  // half width (m)
  const parts: THREE.BufferGeometry[] = [];

  const tireC = shade(color, -0.35);        // deep rubber
  const treadA = '#101215';
  const treadB = shade(color, 0.05);

  // 1) tire barrel (smooth, round)
  const barrel = new THREE.CylinderGeometry(R, R, W2 * 2, 18, 1, false);
  barrel.rotateX(Math.PI / 2);              // axle = Z
  parts.push(withColor(barrel, tireC));

  // 2) subtle tread pads that barely break the surface. Axis order matters:
  //    after rotateZ(a) the box's local X points RADIALLY — so X must be the
  //    thin dimension (an earlier attempt put the long axis here and the
  //    wheels looked like cog wheels / saw blades).
  const TREADS = 14;
  for (let i = 0; i < TREADS; i++) {
    const a = (i / TREADS) * Math.PI * 2;
    const blk = new THREE.BoxGeometry(0.026 * size, 0.055 * size, W2 * 1.96);
    blk.rotateZ(a);
    blk.translate(Math.cos(a) * R * 0.985, Math.sin(a) * R * 0.985, 0);
    parts.push(withColor(blk, i % 2 === 0 ? treadA : treadB));
  }

  // 3) rim disc
  const rimR = R * (style === 3 ? 0.58 : 0.63);
  const rim = new THREE.CylinderGeometry(rimR, rimR, W2 * 1.55, 14);
  rim.rotateX(Math.PI / 2);
  parts.push(withColor(rim, shade(rimC, -0.15)));

  // 4) spokes (style patterns)
  const spokeCount = style === 1 ? 5 : style === 2 ? 3 : style === 3 ? 4 : 6;
  for (let i = 0; i < spokeCount; i++) {
    const a = (i / spokeCount) * Math.PI * 2;
    const sp = new THREE.BoxGeometry(rimR * 1.72, rimR * 0.24, W2 * 1.7);
    sp.rotateZ(a);
    sp.translate(Math.cos(a) * rimR * 0.5, Math.sin(a) * rimR * 0.5, 0);
    parts.push(withColor(sp, rimC));
  }
  if (style === 0) { // classic: solid inner disc
    const disc = new THREE.CylinderGeometry(rimR * 0.55, rimR * 0.55, W2 * 1.72, 12);
    disc.rotateX(Math.PI / 2);
    parts.push(withColor(disc, shade(rimC, -0.4)));
  }

  // 5) hub cap + center bolt
  const hubC = new THREE.CylinderGeometry(R * 0.16, R * 0.16, W2 * 2.05, 10);
  hubC.rotateX(Math.PI / 2);
  parts.push(withColor(hubC, shade(rimC, 0.3)));
  const bolt = new THREE.CylinderGeometry(R * 0.07, R * 0.07, W2 * 2.2, 8);
  bolt.rotateX(Math.PI / 2);
  parts.push(withColor(bolt, '#d8dee6'));

  const merged = mergeGeometries(parts, false) ?? barrel;
  for (const p of parts) if (p !== merged) p.dispose();
  const mesh = new THREE.Mesh(merged, matTire);
  mesh.castShadow = true;
  g.add(mesh);
  return g;
}

// ================= BODY =================
export function buildCar(def: CarDef, custom: CarCustom | undefined, glowLight: boolean): CarModel {
  const group = new THREE.Group();
  const bodyRoot = new THREE.Group();
  group.add(bodyRoot);
  const M = def.model;
  const paint = custom?.paint || def.bodyColor;
  const paint2 = custom?.paint2 || def.accentColor;
  const boostColor = custom?.boostColor || '#ff9a3d';
  const u = 0.1;
  const L = Math.max(20, Math.round(M.length / u));   // cells rear→front
  const W = Math.max(13, Math.round(M.width / u));
  const pD = shade(paint, -0.34);
  const pM = shade(paint, -0.16);
  const pL = shade(paint, 0.14);
  const aD = shade(paint2, -0.25);
  const DARK = '#1d2126', DARK2 = '#15181c', CHROME = '#d8dee6';

  // class flavour
  const isSpeed = def.cls === 'speed';
  const isHeavy = def.cls === 'heavy';
  const isDrift = def.cls === 'drift';
  const isBuggy = def.id === 'kart_buggy';
  const isClassic = def.id === 'kart_classic';
  const isCanopy = M.cabin === 'canopy' && !isHeavy;
  // NEW CAR PASS flavours
  const st = M.style;
  const isGT = st === 'gt';            // scarlet grand tourer (Ferrari vibe)
  const isWedge2 = st === 'wedge2';    // extreme supercar wedge (Lambo vibe)
  const isMuscle = st === 'muscle';    // classic muscle
  const isEV = st === 'ev';            // smooth electric
  // SPORTS CAR SEASON flavours — each one gets its own dedicated detailing pass
  const isF40 = st === 'f40';          // twin-turbo berlinetta (F40 vibe)
  const isLambo = st === 'lambo';      // angular bull supercar (Aventador vibe)
  const isPorsche = st === 'porsche';  // round-eyed rear-engine legend (911 vibe)
  const isMcLaren = st === 'mclaren';  // hybrid hypercar, long tail (P1 vibe)
  const isBugatti = st === 'bugatti';  // two-tone quad-turbo GT (Chiron vibe)
  const isAston = st === 'aston';      // grand tourer, wide mouth (DB11 vibe)

  const b = new VoxelBuilder();      // body voxels
  const e = new VoxelBuilder();      // emissive voxels

  const cx = Math.floor(W / 2);
  const X = (j: number) => j - cx;               // centered x
  const Z = (i: number) => i - Math.floor(L / 2);// centered z (rear → front)
  const mz = (i: number) => (Z(i) + 0.5) * u;

  // ---- key heights (cells) ----
  const belt = Math.max(4, Math.min(7, Math.round(M.height / u)));  // shoulder line
  const yRoof = belt + (isHeavy ? 3 : isCanopy ? 1 : 2);            // roof top
  const cabA = Math.floor(L * (isBuggy ? 0.42 : 0.34));             // cabin rear
  const cabB = Math.floor(L * 0.60);                                // cabin front
  const wzF = Math.round(L * 0.76);                                 // front axle
  const wzR = Math.round(L * 0.22);                                 // rear axle

  const carved = new Set<string>();
  const carve = (j: number, k: number, i: number) => carved.add(`${j},${k},${i}`);

  // ---- 1. under-tray + floor pan ----
  for (let i = 1; i < L - 1; i++) for (let j = 1; j < W - 1; j++) b.add(X(j), 0, Z(i), DARK2);
  // side skirts (dark rocker panels)
  for (let i = Math.floor(L * 0.12); i < Math.floor(L * 0.9); i++) {
    if (Math.abs(i - wzF) < 3 || Math.abs(i - wzR) < 3) continue;
    b.add(X(0), 0, Z(i), DARK); b.add(X(W - 1), 0, Z(i), DARK);
  }

  // ---- 2. lower body (y=1) — full width, nose taper ----
  for (let i = 0; i < L; i++) {
    const t = i / (L - 1);
    let w0 = 0, w1 = W;
    if (t > 0.78 && !isHeavy) { const k = (t - 0.78) / 0.22; w0 += Math.round(k * 1.4); w1 -= Math.round(k * 1.4); }
    for (let j = w0; j < w1; j++) {
      const side = j <= w0 || j >= w1 - 1;
      b.add(X(j), 1, Z(i), side ? DARK : pM);
    }
  }

  // ---- 3. main body (y=2..belt) with hood slope + cabin carve ----
  // supercar wedges start their drop earlier & deeper
  const wedgeT0 = isWedge2 ? 0.5 : isGT ? 0.58 : 0.62;
  const wedgeDrop = isWedge2 ? 3.2 : isGT ? 2.3 : isSpeed ? 2.4 : 1.8;
  const isWedgey = M.nose === 'wedge' || isWedge2 || isGT;
  for (let i = 0; i < L; i++) {
    const t = i / (L - 1);
    let w0 = 1, w1 = W - 1;
    let yTop = belt;
    // hood slope by nose type
    if (isWedgey && t > wedgeT0) { const k = (t - wedgeT0) / (1 - wedgeT0); yTop = Math.max(2, belt - Math.round(k * wedgeDrop)); w0 += Math.round(k * (isWedge2 ? 1.8 : 1.2)); w1 -= Math.round(k * (isWedge2 ? 1.8 : 1.2)); }
    else if (M.nose === 'round' && t > 0.78) { const k = (t - 0.78) / 0.22; yTop = k > 0.5 ? belt - 1 : belt; if (k > 0.8) { w0 += 1; w1 -= 1; } }
    else if (M.nose === 'split' && t > 0.84) { w0 += 1; w1 -= 1; }
    if (isHeavy && t > 0.9) { w0 += 1; w1 -= 1; }
    for (let j = w0; j < w1; j++) for (let k = 2; k <= yTop; k++) {
      // carve cabin interior (only above belt-1 so the tub floor stays)
      if (i >= cabA && i <= cabB && j >= 2 && j < W - 2 && k >= belt - 1) carve(j, k, i);
      if (carved.has(`${j},${k},${i}`)) continue;
      let c = paint;
      if (k === 2) c = pM;
      if (j === w0 || j === w1 - 1) c = shade(c, -0.1);
      // door seam + handles
      if ((j === w0 || j === w1 - 1) && i === Math.floor(L * 0.5)) c = pD;
      b.add(X(j), k, Z(i), c);
    }
  }
  // cabin tub floor (visible through glass)
  for (let i = cabA; i <= cabB; i++) for (let j = 2; j < W - 2; j++) b.add(X(j), belt - 1, Z(i), DARK);
  // rear bulkhead behind seat
  for (let j = 2; j < W - 2; j++) b.add(X(j), belt - 1, Z(cabA - 1), DARK);

  // ---- 4. greenhouse: pillars + roof (or roll cage for the buggy) ----
  if (isBuggy) {
    // open-top roll cage
    const zbA = cabA, zbB = cabB;
    for (const j of [2, W - 3]) {
      for (let i = zbA; i <= zbB; i += 2) b.add(X(j), belt, Z(i), CHROME);
      b.add(X(j), yRoof, Z(zbA), CHROME); b.add(X(j), yRoof, Z(zbB), CHROME);
    }
    for (let j = 2; j <= W - 3; j++) { b.add(X(j), yRoof, Z(zbA), CHROME); b.add(X(j), yRoof, Z(zbB), CHROME); }
    // low windscreen frame
    for (let j = 3; j < W - 3; j++) b.add(X(j), belt, Z(cabB + 1), DARK);
  } else {
    // pillars
    for (const j of [2, W - 3]) {
      for (let k = belt; k <= yRoof; k++) {
        b.add(X(j), k, Z(cabB), aD);          // A pillar
        b.add(X(j), k, Z(cabA), aD);          // C pillar
      }
    }
    // B pillar (mid) for big cabins
    if (cabB - cabA > 6) for (const j of [2, W - 3]) b.add(X(j), belt + 1, Z(Math.floor((cabA + cabB) / 2)), aD);
    // roof panel
    for (let i = cabA; i <= cabB; i++) for (let j = 2; j < W - 2; j++) {
      b.add(X(j), yRoof, Z(i), custom?.paint2 && isHeavy ? paint2 : (isSpeed ? pM : paint));
    }
    // roof scoop (heavy/muscle attitude)
    if (isHeavy) for (let j = cx - 2; j <= cx + 1; j++) { b.add(X(j), yRoof + 1, Z(cabB - 1), pD); b.add(X(j), yRoof + 1, Z(cabB), pD); }
    // roof light bar for heavy
    if (isHeavy) for (let j = 3; j < W - 3; j += 2) e.add(X(j), yRoof + 1, Z(cabA + 1), '#ffca7a', 0.9);
  }

  // ---- 5. glass (transparent meshes — driver visible inside) ----
  // bugatti / mclaren: dark masked greenhouse (black A-pillar band)
  if (!isBuggy) {
    const cabMid = (mz(cabA) + mz(cabB)) / 2;
    const cabLen = (cabB - cabA) * u;
    const glassW = (W - 4) * u * 0.92;
    const glassH = (yRoof - belt + 1) * u * 0.92;
    // windshield (raked)
    const ws = new THREE.Mesh(new THREE.BoxGeometry(glassW, glassH * 1.15, 0.05), matGlass);
    ws.position.set(0, belt * u + glassH * 0.52, mz(cabB) + 0.06);
    ws.rotation.x = isCanopy ? -0.62 : -0.5;
    bodyRoot.add(ws);
    // rear glass (raked opposite)
    const rg = new THREE.Mesh(new THREE.BoxGeometry(glassW, glassH * 1.05, 0.05), matGlass);
    rg.position.set(0, belt * u + glassH * 0.5, mz(cabA) - 0.06);
    rg.rotation.x = 0.55;
    bodyRoot.add(rg);
    // side glass
    for (const sx of [-1, 1]) {
      const sg = new THREE.Mesh(new THREE.BoxGeometry(0.04, glassH * 0.8, cabLen * 0.92), matGlass);
      sg.position.set(sx * (W * u * 0.5 - u * 1.2), belt * u + glassH * 0.48, cabMid);
      bodyRoot.add(sg);
    }
    if (isCanopy) {
      // glass roof strip for supercars
      const top = new THREE.Mesh(new THREE.BoxGeometry(glassW * 0.9, 0.04, cabLen * 0.85), matGlass);
      top.position.set(0, (yRoof + 1) * u - 0.02, cabMid);
      bodyRoot.add(top);
    }
    // black window mask band wrapping the pillars (bugatti/mclaren signature)
    if (isBugatti || isMcLaren) {
      const maskH = glassH * 0.24;
      for (const sx of [-1, 1]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.05, maskH, cabLen * 1.04), matDark);
        band.position.set(sx * (W * u * 0.5 - u * 1.1), belt * u + glassH * 0.92, cabMid);
        bodyRoot.add(band);
      }
    }
  } else {
    // buggy acrylic windscreen
    const ws = new THREE.Mesh(new THREE.BoxGeometry((W - 6) * u, u * 1.6, 0.04), matGlass);
    ws.position.set(0, belt * u + u * 0.6, mz(cabB + 1));
    ws.rotation.x = -0.35;
    bodyRoot.add(ws);
  }

  // ---- 6. front fascia: bumper, grille, headlights ----
  {
    const iF = L - 1;
    for (let j = 1; j < W - 1; j++) { b.add(X(j), 1, Z(iF), DARK2); b.add(X(j), 2, Z(iF), DARK); }
    // grille (EV: none — smooth sealed nose; muscle: full mesh grille)
    if (isEV) {
      b.add(X(cx), 3, Z(iF), paint2);           // accent dot on the smooth nose
    } else if (isMuscle) {
      for (let j = Math.floor(W * 0.28); j < Math.ceil(W * 0.72); j++) b.add(X(j), 3, Z(iF), DARK2);
      for (let j = Math.floor(W * 0.3); j < Math.ceil(W * 0.7); j += 2) b.add(X(j), 3, Z(iF), CHROME);
    } else if (isBugatti) {
      // horseshoe grille: dark opening + chrome ring
      for (let j = Math.floor(W * 0.32); j < Math.ceil(W * 0.68); j++) b.add(X(j), 2, Z(iF), DARK2);
      for (let j = Math.floor(W * 0.34); j < Math.ceil(W * 0.66); j++) b.add(X(j), 3, Z(iF), DARK2);
      b.add(X(Math.floor(W * 0.32) - 1), 3, Z(iF), CHROME); b.add(X(Math.ceil(W * 0.68)), 3, Z(iF), CHROME);
      for (let j = Math.floor(W * 0.34); j < Math.ceil(W * 0.66); j++) b.add(X(j), 2, Z(iF), CHROME);
    } else if (isAston) {
      // wide mouth: big dark opening with chrome lip
      for (let j = Math.floor(W * 0.22); j < Math.ceil(W * 0.78); j++) b.add(X(j), 2, Z(iF), DARK2);
      for (let j = Math.floor(W * 0.24); j < Math.ceil(W * 0.76); j++) b.add(X(j), 3, Z(iF), DARK2);
      for (let j = Math.floor(W * 0.22); j < Math.ceil(W * 0.78); j += 2) b.add(X(j), 1, Z(iF), CHROME);
    } else if (isMcLaren) {
      // grin-less aero nose: low dark splitter + twin side intakes
      for (let j = 2; j < W - 2; j++) b.add(X(j), 1, Z(iF), '#0c0e12');
      for (const jx of [Math.floor(W * 0.2), Math.ceil(W * 0.8) - 1]) { b.add(X(jx), 2, Z(iF), DARK2); b.add(X(jx), 3, Z(iF), DARK2); }
    } else {
      for (let j = Math.floor(W * 0.3); j < Math.ceil(W * 0.7); j++) b.add(X(j), 3, Z(iF), DARK2);
      if (!isSpeed && !isGT && !isF40 && !isLambo) for (const j of [Math.floor(W * 0.38), Math.floor(W * 0.6)]) b.add(X(j), 3, Z(iF), CHROME);
    }
    // headlights
    const lightC = '#fff7d0';
    if (M.lights === 'strip') { for (let j = Math.floor(W * 0.24); j < Math.ceil(W * 0.76); j++) e.add(X(j), 4, Z(iF), lightC, 1); }
    else if (M.lights === 'visor') { for (let j = Math.floor(W * 0.22); j < Math.ceil(W * 0.78); j++) e.add(X(j), Math.min(4, belt), Z(iF), '#7fe8ff', 1); }
    else {
      for (const jj of [Math.floor(W * 0.24), Math.ceil(W * 0.76) - 1]) { e.add(X(jj), 3, Z(iF), lightC, 1); e.add(X(jj), 3, Z(iF - 1), shade(lightC, -0.25), 0.4); }
    }
    // porsche frog-eyes: big round lamps sitting ON TOP of the fenders
    if (isPorsche) {
      for (const jj of [Math.floor(W * 0.22), Math.ceil(W * 0.78) - 1]) {
        e.add(X(jj), 4, Z(iF), lightC, 1);
        e.add(X(jj), 4, Z(iF - 1), shade(lightC, -0.3), 0.5);
      }
    }
    // front badge
    b.add(X(cx), 4, Z(iF), paint2);
    // heavy bull bar
    if (isHeavy) {
      for (const j of [2, cx, W - 3]) for (let k = 2; k <= belt; k++) b.add(X(j), k, Z(iF), '#3a4048');
      for (let j = 2; j < W - 2; j++) b.add(X(j), belt, Z(iF), '#3a4048');
    }
    // classic chrome bumper
    if (isClassic) for (let j = 1; j < W - 1; j++) b.add(X(j), 2, Z(iF), CHROME);
    // muscle chrome front bumper
    if (isMuscle) for (let j = 1; j < W - 1; j++) b.add(X(j), 2, Z(iF), CHROME);
  }

  // ---- 7. rear fascia: bumper, trunk, taillight housing, plate ----
  {
    const iR = 0;
    for (let j = 1; j < W - 1; j++) { b.add(X(j), 1, Z(iR), DARK2); b.add(X(j), 2, Z(iR), DARK); }
    // trunk deck
    for (let i = 1; i <= Math.max(1, cabA - 2); i++) for (let j = 2; j < W - 2; j++) b.add(X(j), belt, Z(i), i % 3 === 0 ? pM : paint);
    // diffuser for sporty cars
    if (isSpeed || isDrift) for (let j = 3; j < W - 3; j += 2) b.add(X(j), 1, Z(iR), '#0c0e12');
    // classic chrome rear bumper
    if (isClassic) for (let j = 1; j < W - 1; j++) b.add(X(j), 2, Z(iR), CHROME);
    // license plate
    b.add(X(cx), 2, Z(iR) - 0, '#f2f2f2');
  }

  // ---- 8. fenders over all 4 wheels ----
  const flare = isSpeed || isDrift || isBuggy || isWedge2 || isGT || isMuscle ||
    isF40 || isLambo || isMcLaren || isBugatti || isAston;
  for (const zi of [wzF, wzR]) {
    for (let dz = -2; dz <= 2; dz++) {
      const i = zi + dz; if (i < 1 || i > L - 2) continue;
      for (const j of [0, W - 1]) {
        b.add(X(j), 1, Z(i), pD);
        b.add(X(j), 2, Z(i), pD);
        if (Math.abs(dz) <= 1) b.add(X(j), 3, Z(i), pM);
      }
      // wide-body flares (half-voxels poking outward)
      if (flare && Math.abs(dz) <= 2) {
        const fy = Math.abs(dz) <= 1 ? 3 : 2;
        b.add(X(0) - 0.5, fy, Z(i), pM, 0, 0.5);
        b.add(X(W - 1) + 0.5, fy, Z(i), pM, 0, 0.5);
      }
    }
  }

  // ---- 9. mirrors + door handles ----
  {
    const mi = cabB + 1;
    for (const sx of [-1, 1]) {
      const jx = sx === -1 ? 0 : W - 1;
      b.add(X(jx) + sx * 0.5, belt + 1, Z(mi), pD, 0, 0.5);           // stalk
      b.add(X(jx) + sx * 1.2, belt + 1, Z(mi), paint2, 0, 0.9);       // mirror head
      // door handle (chrome half-voxel just outside the door)
      b.add(X(0) + sx * 0.9, belt, Z(Math.floor(L * 0.46)), CHROME, 0, 0.5);
    }
  }

  // ---- 9b. NEW CAR PASS: per-style detail features ----
  if (isGT || isWedge2) {
    // side cooling vents just behind the front wheels (dark slots)
    const vi = wzF + 2;
    for (const jx of [1, W - 2]) {
      for (let dz = 0; dz < 3; dz++) {
        b.add(X(jx), 2, Z(vi + dz), '#101216');
        if (dz === 1) b.add(X(jx), 3, Z(vi + dz), '#101216');
      }
    }
    // beltline accent strip (paint2) along the flank
    for (let i = Math.floor(L * 0.16); i < Math.floor(L * 0.94); i++) {
      if (Math.abs(i - wzF) < 3 || Math.abs(i - wzR) < 3 || (i > cabA && i < cabB)) continue;
      b.add(X(0), 2, Z(i), paint2);
      b.add(X(W - 1), 2, Z(i), paint2);
    }
  }
  if (isWedge2) {
    // rear fin + Y-taillight bar (emissive) for the alien wedge
    for (let i = 1; i <= Math.max(1, cabA - 1); i++) b.add(X(cx), belt + 1, Z(i), pD);
    for (let j = 2; j < W - 2; j += 2) e.add(X(j), belt - 1, Z(0), '#ff3b30', 1);
  }
  if (isMuscle) {
    // hood scoop (two raised voxels on the hood)
    const si = Math.floor(L * 0.72);
    for (let j = cx - 2; j <= cx + 1; j++) { b.add(X(j), belt + 1, Z(si), DARK); b.add(X(j), belt + 1, Z(si - 1), DARK); }
    // rear quarter stripes
    for (const jx of [1, W - 2]) for (let i = 1; i < cabA; i++) b.add(X(jx), 3, Z(i), paint2);
  }
  if (isEV) {
    // sealed aero flank: full-width teal energy strip (emissive accent)
    for (let i = Math.floor(L * 0.1); i < Math.floor(L * 0.9); i++) {
      if (Math.abs(i - wzF) < 3 || Math.abs(i - wzR) < 3) continue;
      e.add(X(0), 3, Z(i), paint2, 0.55);
      e.add(X(W - 1), 3, Z(i), paint2, 0.55);
    }
  }
  // ---- 9c. SPORTS CAR SEASON: dedicated detailing per machine ----
  if (isF40) {
    // NACA side strakes: stepped dark channels carved into the doors
    for (const jx of [1, W - 2]) {
      for (let dz = 0; dz < 4; dz++) {
        b.add(X(jx), 2, Z(Math.floor(L * 0.48) + dz), '#101216');
        b.add(X(jx), 3, Z(Math.floor(L * 0.5) + dz), '#101216');
      }
    }
    // lattice engine deck (dark grid over the rear window bay)
    for (let i = 1; i <= Math.max(1, cabA - 1); i++) {
      for (let j = 3; j < W - 3; j++) if ((i + j) % 2 === 0) b.add(X(j), belt, Z(i), '#0e1013');
    }
    // pop-up headlight seams on the hood
    for (const jx of [Math.floor(W * 0.26), Math.ceil(W * 0.74) - 1]) b.add(X(jx), belt, Z(L - 3), DARK);
    // quad round taillights (emissive, iconic)
    for (const sx of [-1, 1]) for (const ddx of [0, 1]) {
      e.add(X(sx === -1 ? 3 + ddx : W - 4 - ddx), belt - 1, Z(0), '#ff2e1f', 1);
    }
    // wing endplates painted accent
    // (big wing comes from spoilerStyle 3 below)
  }
  if (isLambo) {
    // hexagonal side intakes: big trapezoid dark pockets behind the doors
    for (const jx of [1, W - 2]) {
      for (let dz = 0; dz < 3; dz++) { b.add(X(jx), 2, Z(cabA - 2 + dz), '#0b0d10'); b.add(X(jx), 3, Z(cabA - 1 + dz), '#0b0d10'); }
    }
    // angular hood creases (dark diagonal lines)
    for (let k = 0; k < 4; k++) b.add(X(cx - 3 + k), belt, Z(L - 3 - k * 2), pD);
    // Y-shaped emissive taillights
    for (const sx of [-1, 1]) {
      const jx = sx === -1 ? 2 : W - 3;
      e.add(X(jx), belt - 1, Z(0), '#ff3b30', 1);
      e.add(X(jx + sx * 1), belt - 1, Z(0), '#ff3b30', 0.8);
      e.add(X(jx), belt - 2, Z(0), '#ff3b30', 0.8);
    }
    // center spine over hood + roof
    for (let i = Math.floor(L * 0.62); i < L - 1; i++) b.add(X(cx), belt, Z(i), pD);
    for (let i = cabA; i <= cabB; i++) b.add(X(cx), yRoof + 1, Z(i), pD);
  }
  if (isPorsche) {
    // sloped rear engine deck with cooling slats
    for (let i = 1; i <= Math.max(1, cabA - 1); i++) {
      const k = (cabA - i) / Math.max(1, cabA - 1);
      const y = belt - Math.round(k * 1.2);
      for (let j = 3; j < W - 3; j++) b.add(X(j), Math.max(2, y), Z(i), i % 2 === 0 ? DARK : pM);
    }
    // center accent stripe over hood/roof (classic two-tone racing stripe)
    for (let i = Math.floor(L * 0.6); i < L; i++) b.add(X(cx), belt, Z(i), paint2);
    for (let i = cabA; i <= cabB; i++) b.add(X(cx), yRoof, Z(i), paint2);
    // side gill vent behind front wheels
    for (const jx of [1, W - 2]) for (let dz = 0; dz < 2; dz++) b.add(X(jx), 3, Z(wzF - 2 + dz), DARK2);
  }
  if (isMcLaren) {
    // dihedral door crease: bright paint2 line sweeping up the flank
    for (let i = Math.floor(L * 0.3); i < Math.floor(L * 0.62); i++) {
      const jj = i < Math.floor(L * 0.46) ? 1 : 2;
      b.add(X(jj), 3, Z(i), paint2);
      b.add(X(W - 1 - (jj - 1)), 3, Z(i), paint2);
    }
    // long-tail rear deck with mesh
    for (let i = 1; i <= Math.max(1, cabA - 1); i++) {
      for (let j = 3; j < W - 3; j++) if ((i * 3 + j) % 4 === 0) b.add(X(j), belt, Z(i), '#0e1013');
    }
    // rear diffuser fins
    for (let j = 3; j < W - 3; j += 2) { b.add(X(j), 1, Z(0), '#0c0e12'); b.add(X(j), 1, Z(1), '#0c0e12'); }
    // slim emissive taillight bar
    for (let j = 3; j < W - 3; j++) e.add(X(j), belt - 1, Z(0), '#ff5a2e', 0.9);
  }
  if (isBugatti) {
    // two-tone: cabin roof + C-pillar zone painted paint2 (dark tone)
    for (let i = cabA; i <= cabB; i++) for (let j = 2; j < W - 2; j++) b.add(X(j), yRoof, Z(i), paint2);
    // C-line: sweeping accent curve across the flank (signature)
    for (let i = cabB; i >= cabA - 2; i--) {
      const t = (cabB - i) / Math.max(1, cabB - cabA + 2);
      const jx = Math.round(1 + t * 1.6);
      b.add(X(jx), 3, Z(i), CHROME);
      b.add(X(W - 1 - jx + 1), 3, Z(i), CHROME);
    }
    // center spine from hood to tail
    for (let i = 1; i < L - 1; i++) {
      if (i > cabA && i < cabB) continue;
      b.add(X(cx), i > cabB ? belt : belt, Z(i), pD);
    }
    // quad square exhaust tips hint (dark squares at rear center)
    for (const jx of [cx - 2, cx + 1]) b.add(X(jx), 1, Z(0), '#181b20');
  }
  if (isAston) {
    // ribbed hood vents (3 raised louvres)
    for (const ddx of [-2, 0, 2]) {
      for (let i = Math.floor(L * 0.66); i < Math.floor(L * 0.86); i++) b.add(X(cx + ddx), belt + 0, Z(i), pD);
    }
    // side gills with chrome strakes
    for (const jx of [1, W - 2]) {
      b.add(X(jx), 3, Z(Math.floor(L * 0.44)), CHROME);
      b.add(X(jx), 3, Z(Math.floor(L * 0.46)), DARK2);
      b.add(X(jx), 3, Z(Math.floor(L * 0.48)), CHROME);
    }
    // ducktail spoiler lip (raised rear deck edge)
    for (let j = 3; j < W - 3; j++) b.add(X(j), belt + 1, Z(1), paint);
    // chrome rear finisher
    for (let j = Math.floor(W * 0.3); j < Math.ceil(W * 0.7); j++) b.add(X(j), belt - 1, Z(0), CHROME);
  }

  // ---- 10. decals (hood + roof) ----
  const decal = custom?.decal ?? M.decalDefault;
  const hoodA = Math.floor(L * 0.64), hoodB = Math.floor(L * 0.84);
  const roofMid = Math.floor((cabA + cabB) / 2);
  if (decal === 1) { for (let i = hoodA; i <= hoodB; i++) b.add(X(cx), belt, Z(i), paint2); for (let i = cabA; i <= cabB; i++) b.add(X(cx), yRoof, Z(i), paint2); }
  if (decal === 2) { for (const jx of [cx - 2, cx + 1]) { for (let i = hoodA; i <= hoodB; i++) b.add(X(jx), belt, Z(i), paint2); for (let i = cabA; i <= cabB; i++) b.add(X(jx), yRoof, Z(i), paint2); } }
  if (decal === 3) for (let i = 0; i < 4; i++) for (let j = 3; j < W - 3; j++) if ((i + j) % 2 === 0) b.add(X(j), belt, Z(hoodA + 1 + i), '#f2f2f2');
  if (decal === 4) for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (i * i + j * j <= 4) b.add(X(cx + j), belt, Z(Math.floor(L * 0.45) + i), '#f8f4ec');
  if (decal === 5) { for (let i = Math.floor(L * 0.14); i < Math.floor(L * 0.9); i++) { if (Math.abs(i - wzF) < 3 || Math.abs(i - wzR) < 3 || (i > cabA && i < cabB)) continue; b.add(X(0), 2, Z(i), paint2); b.add(X(W - 1), 2, Z(i), paint2); } }
  if (decal === 6) { for (let i = hoodA; i <= hoodB; i++) b.add(X(cx), belt, Z(i), boostColor); for (let i = cabA; i <= cabB; i++) b.add(X(cx), yRoof, Z(i), boostColor); }

  const bodyMesh = new THREE.Mesh(b.build(u).geometry, matBody);
  bodyMesh.castShadow = true;
  bodyRoot.add(bodyMesh);
  // GHOST WHITISH SHELL (user v1.12: "قدرت روح — خود ماشین شفاف و کمی سفید بشه,
  // مثل یک روح"): a body-hugging white overlay that reads as the spectral tint
  // WHILE the body materials themselves go translucent (see visuals.ts).
  const ghostShellMat = new THREE.MeshBasicMaterial({ color: 0xe9f4ff, transparent: true, opacity: 0, depthWrite: false });
  const ghostShell = new THREE.Mesh(bodyMesh.geometry, ghostShellMat);
  ghostShell.scale.setScalar(1.04);
  ghostShell.visible = false;
  bodyRoot.add(ghostShell);
  const emisMesh = new THREE.Mesh(e.build(u).geometry, makeEmissiveVoxelMaterial());
  bodyRoot.add(emisMesh);

  // ---- 11. interior: seat, dash, steering wheel ----
  const seatY = (belt - 1) * u + 0.02;
  {
    const seatJ0 = cx - 2, seatJ1 = cx + 1;
    for (let j = seatJ0; j <= seatJ1; j++) {
      b.add(X(j), belt - 1, Z(cabA), '#26292f');           // seat base (back)
      b.add(X(j), belt, Z(cabA), '#26292f');               // seat back rest
      b.add(X(j), belt, Z(cabA + 1), '#26292f');           // headrest
      b.add(X(j), belt - 1, Z(cabA + 1), '#2e3238');       // cushion
    }
    // dashboard
    for (let j = 3; j < W - 3; j++) b.add(X(j), belt - 1, Z(cabB), pD);
    // steering column + wheel
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, u * 1.5, 6), matGrey);
    col.position.set(0, seatY + u * 1.4, mz(cabB) - 0.05);
    col.rotation.x = 0.5;
    bodyRoot.add(col);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 12), matDark);
    rim.position.set(0, seatY + u * 2.1, mz(cabB) - 0.12);
    rim.rotation.x = 1.1;
    bodyRoot.add(rim);
  }

  // ---- 12. spoiler ----
  const spoiler = custom?.spoiler !== undefined ? custom.spoiler : M.spoilerStyle;
  if (spoiler >= 0) {
    const s = new THREE.Group();
    const zRear = mz(0) - u * 0.5;
    const bodyTop = belt * u;
    if (spoiler === 0) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(W * u * 0.8, 0.07, u * 1.6), new THREE.MeshLambertMaterial({ color: new THREE.Color(paint2) }));
      plank.position.set(0, bodyTop + 0.14, zRear); plank.rotation.x = -0.22; plank.castShadow = true; s.add(plank);
    } else if (spoiler === 1 || spoiler === 2) {
      const h = spoiler === 2 ? 0.42 : 0.3;
      for (const sx of [-1, 1]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.08), matDark);
        strut.position.set(sx * W * u * 0.3, bodyTop + h / 2, zRear); s.add(strut);
      }
      const plank = new THREE.Mesh(new THREE.BoxGeometry(W * u * 0.96, 0.06, spoiler === 2 ? 0.34 : 0.26), new THREE.MeshLambertMaterial({ color: new THREE.Color(paint2) }));
      plank.position.set(0, bodyTop + h, zRear - 0.05); plank.rotation.x = -0.26; plank.castShadow = true; s.add(plank);
      if (spoiler === 2) {
        for (const sx of [-1, 1]) {
          const end = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.15, 0.34), matDark);
          end.position.set(sx * W * u * 0.48, bodyTop + h + 0.05, zRear - 0.05); s.add(end);
        }
      }
    } else {
      for (const [hgt, wid] of [[0.24, 0.85], [0.44, 1.0]] as [number, number][]) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(W * u * wid, 0.045, 0.2), new THREE.MeshLambertMaterial({ color: new THREE.Color(paint2), emissive: new THREE.Color(boostColor).multiplyScalar(0.25) }));
        plank.position.set(0, bodyTop + hgt, zRear - 0.05); plank.rotation.x = -0.24; s.add(plank);
      }
      for (const sx of [-1, 1]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.46, 0.07), matChrome);
        strut.position.set(sx * W * u * 0.34, bodyTop + 0.23, zRear); s.add(strut);
      }
    }
    bodyRoot.add(s);
  }

  // ---- 13. exhaust + flames ----
  const flames: THREE.Mesh[] = [];
  const exCount = custom?.exhaust !== undefined ? ([1, 2, 4] as const)[custom.exhaust] ?? 2 : M.exhaust;
  const exY = u * 1.7;
  const exPositions: number[] = [];
  if (exCount === 1) exPositions.push(0);
  else if (exCount === 2) exPositions.push(-W * u * 0.24, W * u * 0.24);
  else exPositions.push(-W * u * 0.32, -W * u * 0.11, W * u * 0.11, W * u * 0.32);
  for (const x of exPositions) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.055, 0.18, 6), matChrome);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, exY, mz(0) - 0.2);
    bodyRoot.add(pipe);
    const flameGeo = new THREE.PlaneGeometry(0.32, 0.5);
    const fm = new THREE.Mesh(flameGeo, makeFlameMaterial(boostColor).clone());
    fm.position.set(x, exY, mz(0) - 0.44);
    fm.rotation.y = Math.PI / 2;
    fm.visible = false;
    bodyRoot.add(fm);
    flames.push(fm);
  }

  // ---- 14. tail lights (brake emissive) ----
  // USER PASS: brake lights must light up whenever the brake is pressed (even
  // mid-drift) and glow as dim running lights at night.
  const brakeMats: THREE.MeshLambertMaterial[] = [];
  {
    const iR = 0;
    for (const sx of [-1, 1]) {
      const bm = new THREE.MeshLambertMaterial({ color: 0x5a1010, emissive: 0x000000 });
      const bl = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.05), bm);
      bl.position.set(sx * W * u * 0.3, belt * u - u * 0.4, mz(iR) - 0.26);
      bodyRoot.add(bl);
      brakeMats.push(bm);
      // housing voxel
      b.add(X(sx === -1 ? 2 : W - 3), belt - 1, Z(iR), '#5a1010');
    }
    // wide light bar between the housings (modern look, brighter braking)
    const bar = new THREE.MeshLambertMaterial({ color: 0x4a0e0e, emissive: 0x000000 });
    const barMesh = new THREE.Mesh(new THREE.BoxGeometry(W * u * 0.42, 0.05, 0.04), bar);
    barMesh.position.set(0, belt * u - u * 0.4, mz(iR) - 0.24);
    bodyRoot.add(barMesh);
    brakeMats.push(bar);
  }

  // ---- 14.5 REVERSE LIGHTS (§8: "وقتی عقب میاد چراغ ماشین روشن بشه") ----
  // small white lenses under the tail lights; visuals.ts lights them (bright
  // emissive) ONLY while the kart actually moves backwards, off otherwise.
  const reverseMats: THREE.MeshLambertMaterial[] = [];
  {
    const iR = 0;
    for (const sx of [-1, 1]) {
      const rm = new THREE.MeshLambertMaterial({ color: 0xd8e2e8, emissive: 0x000000 });
      const rl = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.045), rm);
      rl.position.set(sx * W * u * 0.13, belt * u - u * 0.62, mz(iR) - 0.27);
      bodyRoot.add(rl);
      reverseMats.push(rm);
    }
  }

  // ---- 15. antenna (classic) ----
  if (isClassic) {
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), matDark);
    ant.position.set(-W * u * 0.28, belt * u + 0.15, mz(1));
    bodyRoot.add(ant);
  }

  // ---- 16. UNDERGLOW (user: "بشه برای زیر ماشین افکت رنگی گذاشت") ----
  // additive radial glow plane hugging the ground + subtle pulse (visuals.ts);
  // NIGHT-ONLY (visuals.ts keeps it hidden in daylight).
  // v1.9 FIX (user, third report: "داخل شب چراغ زیر ماشین هم روشن باشه و کامل
  // دیده بشه"): the glow used to be built ONLY when the player had picked a
  // color in the garage (`if (custom?.glow)`) — every stock car shipped with
  // glow:'' so NOTHING existed under the car at night and it looked broken.
  // Now EVERY car gets the underglow; an unset color falls back to the classic
  // cyan neon. The garage's last swatch is now AUTO (default cyan), so the
  // light is always there at night — exactly what the user keeps asking for.
  let underglow: THREE.Object3D | null = null;
  let underglowMat: THREE.MeshBasicMaterial | null = null;
  {
    const glowColor = custom?.glow || '#00e5ff';
    underglowMat = makeUnderglowMaterial(glowColor);
    const glowGeo = new THREE.PlaneGeometry(W * u * 2.3, L * u * 1.9);
    underglow = new THREE.Mesh(glowGeo, underglowMat);
    underglow.rotation.x = -Math.PI / 2;
    underglow.position.y = 0.035;
    underglow.renderOrder = 1;
    group.add(underglow);
  }

  // ---- 17. wheels ----
  const wheels: THREE.Object3D[] = [];
  const wheelGroups: THREE.Object3D[] = [];
  const wStyle = custom?.wheelStyle ?? M.wheelStyle;
  const wColor = custom?.wheelColor || '#1c1c1c';
  const wSize = M.wheelSize;
  const wx = W * u * 0.5 + 0.05;
  const wR = wheelRadius(wStyle, wSize);
  const susp = Math.max(wR * 0.92, 0.2);
  for (const [x, zi, front] of [[-wx, wzF, 1], [wx, wzF, 1], [-wx, wzR, 0], [wx, wzR, 0]] as [number, number, number][]) {
    const hub = new THREE.Group();
    hub.position.set(x, susp, mz(zi));
    const spin = new THREE.Group();
    const wheel = buildWheel(wStyle, wSize, wColor);
    wheel.rotation.y = Math.PI / 2;
    spin.add(wheel);
    hub.add(spin);
    group.add(hub);
    wheels.push(spin);
    wheelGroups.push(hub);
    (hub as unknown as { isFront: boolean }).isFront = !!front;
  }

  // ---- 17.5 HEADLIGHT RIG (user: "اگه شب هست چراغ‌های جلوی ماشین روشن بشه") ----
  // dedicated lens materials (night ramps emissive to full beam) + additive
  // beam cones + a real SpotLight for the local player. Day: lenses stay dark
  // glass, beams hidden → zero cost.
  const headlightMats: THREE.MeshLambertMaterial[] = [];
  const headlightGlows: THREE.Object3D[] = [];
  let headlightSpot: THREE.SpotLight | null = null;
  {
    const iF = L - 1;
    const lampY = 3.1 * u * 1.0 + 0.06;
    const lampZ = mz(iF) + 0.03;
    for (const sx of [-1, 1]) {
      // lens (toggleable emissive)
      const lm = new THREE.MeshLambertMaterial({ color: 0xf5efd2, emissive: 0x000000 });
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.05), lm);
      lens.position.set(sx * W * u * 0.3, lampY, lampZ);
      bodyRoot.add(lens);
      headlightMats.push(lm);
      // additive glow cone: tip AT the lamp, widening forward (+Z) — v2:
      // longer + wider so the beams clearly rake the road (شیدر چراغ جلو)
      const glowMat = makeHeadlightBeamMaterial('#fff3c4');
      const beam = new THREE.Mesh(new THREE.ConeGeometry(0.85, 4.4, 12, 1, true), glowMat);
      beam.rotation.x = -Math.PI / 2;            // tip (+Y) → -Z; center ahead → tip lands on the lamp
      beam.position.set(sx * W * u * 0.3, lampY - 0.02, lampZ + 2.2);
      beam.visible = false;
      bodyRoot.add(beam);
      headlightGlows.push(beam);
    }
  }

  const boostFx = glowLight ? new THREE.PointLight(0xffaa44, 0, 4.5) : null;
  if (boostFx) { boostFx.position.set(0, 0.5, -1.2); group.add(boostFx); }

  // driver scale fitted to the cabin (user request: character matches car size)
  const roofM = (isBuggy ? belt + 2 : yRoof) * u;
  const charScale = isBuggy
    ? 0.85
    : THREE.MathUtils.clamp((roofM - seatY - 0.04) / 0.62, 0.5, 0.95);
  const seatZ = (mz(cabA) + mz(cabB)) / 2 + 0.08;

  return {
    group, wheels, wheelGroups, flames, brakeMats, reverseMats, headlightMats, headlightGlows,
    headlightSpot, underglow, underglowMat, bodyRoot, ghostShell, ghostShellMat, boostFx,
    seatY, seatZ, charScale,
  };
}
