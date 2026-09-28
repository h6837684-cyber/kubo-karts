// KUBO KARTS - Decoration factory: builds voxel props per theme. Cached merged geometries.
import * as THREE from 'three';
import { VoxelBuilder } from '../vox/builder';
import { makeEmissiveVoxelMaterial, makeVoxelMaterial } from '../gfx/materials';
import { makeRng, shade } from '../core/utils';

export interface DecoGeo { geometry: THREE.BufferGeometry; emissiveGeometry?: THREE.BufferGeometry; }

const cache = new Map<string, DecoGeo>();
const matStatic = makeVoxelMaterial();
export const decoMaterial = matStatic;
export const decoEmissiveMaterial = makeEmissiveVoxelMaterial();

function B(): VoxelBuilder { return new VoxelBuilder(); }

const builders: Record<string, (rng: () => number) => VoxelBuilder> = {
  treeRound: (rng) => {
    const b = B();
    const h = 3 + Math.floor(rng() * 3);
    const trunkC = ['#6d4c2f', '#7a5535', '#5d4028'][Math.floor(rng() * 3)];
    const leafC = ['#4e9c35', '#5cae3d', '#3d8c2e'][Math.floor(rng() * 3)];
    for (let y = 0; y < h; y++) b.add(0, y, 0, trunkC);
    const r = 2 + Math.floor(rng() * 2);
    for (let x = -r; x <= r; x++) for (let y = 0; y <= r; y++) for (let z = -r; z <= r; z++) {
      const d = Math.sqrt(x * x + y * y * 1.4 + z * z);
      if (d <= r + 0.3 && !(d > r - 0.5 && rng() < 0.35)) {
        b.add(x, h + y, z, (x + y + z) % 2 === 0 ? leafC : shade(leafC, 0.12));
      }
    }
    return b;
  },
  treePine: (rng) => {
    const b = B(); const h = 5 + Math.floor(rng() * 3);
    const leafC = ['#2e7c42', '#356e38', '#28663a'][Math.floor(rng() * 3)];
    for (let y = 0; y < 2; y++) b.add(0, y, 0, '#5d4028');
    for (let y = 2; y < h; y++) {
      const r = Math.max(0, Math.round((h - y) * 0.42));
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++)
        if (Math.abs(x) + Math.abs(z) <= r + (y % 2)) b.add(x, y, z, y % 2 ? leafC : shade(leafC, 0.1));
    }
    return b;
  },
  treePineSnow: (rng) => {
    const b = builders.treePine(rng);
    for (const v of b.list) if (v.y > 3 && (v.x + v.z) % 2 === 0) v.c = '#eef6fa';
    return b;
  },
  tallPalm: (rng) => {
    const b = B(); const h = 5 + Math.floor(rng() * 3);
    for (let y = 0; y < h; y++) b.add(Math.round(Math.sin(y * 0.5) * 0.6), y, 0, '#8d6e42');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      for (let r = 1; r <= 3; r++) b.add(Math.round(Math.cos(a) * r), h - Math.floor(r / 2) + (r === 3 ? -1 : 0), Math.round(Math.sin(a) * r), '#43a047');
    }
    return b;
  },
  palm: (rng) => builders.tallPalm(rng),
  vineTree: (rng) => {
    const b = builders.treeRound(rng);
    for (let i = 0; i < 4; i++) {
      const sx = Math.floor(rng() * 5) - 2, sz = Math.floor(rng() * 5) - 2;
      const len = 2 + Math.floor(rng() * 3);
      for (let y = 0; y < len; y++) b.add(sx, 4 + y - len, sz, '#33691e');
    }
    return b;
  },
  bush: (rng) => {
    const b = B(); const c = ['#4e9c35', '#5cae3d'][Math.floor(rng() * 2)];
    b.add(0, 0, 0, c); b.add(1, 0, 0, shade(c, 0.1)); b.add(0, 0, 1, c); b.add(0, 1, 0, shade(c, 0.18)); b.add(1, 1, 0, c);
    if (rng() > 0.5) b.add(1, 0, 1, c);
    return b;
  },
  flower: (rng) => {
    const b = B();
    const c = ['#e84a8a', '#f7d154', '#e8452f', '#ffffff', '#8c4de0'][Math.floor(rng() * 5)];
    b.add(0, 0, 0, '#4e9c35'); b.add(0, 1, 0, c);
    return b;
  },
  rock: (rng) => {
    const b = B(); const c = ['#8a8f96', '#7a7f86', '#9aa0a6'][Math.floor(rng() * 3)];
    const s = 1 + Math.floor(rng() * 2);
    for (let x = 0; x <= s; x++) for (let y = 0; y <= s - (rng() > 0.5 ? 1 : 0); y++) for (let z = 0; z <= s; z++)
      if (rng() > 0.15) b.add(x, y, z, (x + y) % 2 ? c : shade(c, -0.12));
    return b;
  },
  volcanoRock: (rng) => {
    const b = builders.rock(rng);
    for (const v of b.list) v.c = ['#4a3c38', '#372c28', '#5a4c42'][Math.floor(rng() * 3)];
    return b;
  },
  obsidian: (rng) => {
    const b = B();
    for (let y = 0; y <= 2 + Math.floor(rng() * 3); y++) for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++)
      if (rng() > 0.2) b.add(x, y, z, (x + y + z) % 3 === 0 ? '#241c2e' : '#2e2438', (x + y + z) % 5 === 0 ? 0.15 : 0);
    return b;
  },
  lavaPool: () => B().addBox(-2, 0, -2, 2, 0, 2, '#ff6d00', 0.9),
  house1: (rng) => {
    const b = B(); const wallC = ['#e8dcc8', '#d9c9a8', '#c9b898'][Math.floor(rng() * 3)];
    const roofC = ['#c0392b', '#a83232', '#8c3a3a'][Math.floor(rng() * 3)];
    const w = 4, d = 4, h = 3;
    for (let x = 0; x <= w; x++) for (let z = 0; z <= d; z++) for (let y = 0; y < h; y++)
      if (x === 0 || x === w || z === 0 || z === d || y === 0) b.add(x, y, z, wallC);
    for (let y = 0; y <= 2; y++) for (let x = -1; x <= w + 1; x++) for (let z = -1; z <= d + 1; z++) {
      const edge = Math.max(Math.abs(x - w / 2), Math.abs(z - d / 2));
      if (edge === w / 2 + 1 - y * 0.5 || Math.abs(Math.abs(x - w / 2) - Math.abs(z - d / 2)) < 0.01) b.add(x, h + y, z, roofC);
    }
    b.add(Math.floor(w / 2), 0, d, '#6d4c2f'); // door
    b.add(1, 1, d, '#8fe3ff', 0.4); b.add(w - 1, 1, d, '#8fe3ff', 0.4); // windows
    return b;
  },
  house2: (rng) => {
    const b = builders.house1(rng);
    for (const v of b.list) if (v.y >= 3) v.c = '#5a6e8c';
    return b;
  },
  tower: (rng) => {
    const b = B(); const h = 8 + Math.floor(rng() * 5);
    const c = ['#8a8f96', '#9aa0a6'][Math.floor(rng() * 2)];
    for (let y = 0; y < h; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++)
      if ((Math.abs(x) === 2 || Math.abs(z) === 2) && (x + z + y) % 3 !== 0) b.add(x, y, z, y % 4 === 3 ? shade(c, -0.1) : c);
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++)
      if (Math.max(Math.abs(x), Math.abs(z)) === 3 && (x + z) % 2 === 0) b.add(x, h, z, '#5a6572');
    b.add(0, h + 1, 0, '#c0392b', 0.2);
    return b;
  },
  torch: () => {
    const b = B();
    for (let y = 0; y < 3; y++) b.add(0, y, 0, '#6d4c2f');
    b.add(0, 3, 0, '#ffca28', 1); b.add(0, 4, 0, '#ff8a3a', 1);
    return b;
  },
  tiki: (rng) => {
    const b = B();
    for (let y = 0; y < 3; y++) { b.add(0, y, 0, '#8d6e42'); b.add(1, y, 0, '#8d6e42'); }
    b.add(0, 3, 0, '#e8452f', 0.5); b.add(1, 3, 0, '#f7d154', 0.5);
    b.add(0, 1, 0.5, '#3e2723'); b.add(1, 1, 0.5, '#3e2723');
    void rng;
    return b;
  },
  fence: (rng) => {
    const b = B();
    for (let y = 0; y < 2; y++) b.add(0, y, 0, '#8d6e42');
    b.add(0, 1, 1, '#7a5d38'); b.add(0, 0.5, 1, '#7a5d38');
    void rng; return b;
  },
  flag: (rng) => {
    const b = B();
    for (let y = 0; y < 4; y++) b.add(0, y, 0, '#8a8f96');
    const c = ['#e8452f', '#2f7de0', '#f7d154'][Math.floor(rng() * 3)];
    b.add(0, 3, 1, c); b.add(0, 3, 2, c); b.add(0, 2, 1, c);
    return b;
  },
  statue: () => {
    const b = B(); const c = '#9aa08c';
    for (let y = 0; y < 1; y++) b.addBox(-1, y, -1, 1, y, 1, shade(c, -0.2));
    for (let y = 1; y <= 3; y++) { b.add(0, y, 0, c); b.add(-1, y, 0, shade(c, -0.1)); b.add(1, y, 0, shade(c, -0.1)); }
    b.add(0, 4, 0, shade(c, 0.1)); b.add(0, 5, 0, c);
    return b;
  },
  ruinColumn: (rng) => {
    const b = B(); const c = '#c9b898'; const h = 3 + Math.floor(rng() * 4);
    for (let y = 0; y < h; y++) { b.add(0, y, 0, c); b.add(1, y, 0, shade(c, -0.08)); b.add(0, y, 1, shade(c, -0.08)); b.add(1, y, 1, c); }
    b.addBox(-0.5, h, -0.5, 1.5, h, 1.5, shade(c, 0.1));
    return b;
  },
  brokenArch: (rng) => {
    const b = B(); const c = '#b8a888';
    for (let y = 0; y < 4; y++) { b.add(0, y, 0, c); b.add(3, y, 0, c); }
    b.add(1, 4, 0, c); b.add(2, 4, 0, shade(c, -0.1));
    void rng; return b;
  },
  pyramid: (rng) => {
    const b = B(); const s = 4;
    for (let y = 0; y <= s; y++) for (let x = -s + y; x <= s - y; x++) for (let z = -s + y; z <= s - y; z++)
      if (Math.abs(x) === s - y || Math.abs(z) === s - y || y === 0) b.add(x, y, z, (x + z + y) % 2 ? '#d9b877' : '#c2a05e');
    void rng; return b;
  },
  skullRock: () => {
    const b = B(); const c = '#c9bfb0';
    b.addBox(-1, 0, -1, 1, 2, 1, c);
    b.add(-1, 1, -1.5, '#2a2420', 0.1); b.add(1, 1, -1.5, '#2a2420', 0.1);
    b.add(0, 0, -1.5, '#2a2420');
    return b;
  },
  snowman: (rng) => {
    const b = B();
    b.addBox(-1, 0, 0, 1, 0, 0, '#ffffff'); b.add(0, 1, 0, '#ffffff'); b.add(0, 2, 0, '#ffffff');
    b.add(-0.5, 2, 0.5, '#2a2420'); b.add(0.5, 2, 0.5, '#2a2420');
    b.add(0, 1.5, 0.5, '#ff8a3a');
    b.add(-1, 1, 0, '#6d4c2f'); b.add(1, 1, 0, '#6d4c2f');
    void rng; return b;
  },
  igloo: () => {
    const b = B();
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 0; y <= 2; y++) {
      const d = Math.sqrt(x * x + y * y + z * z);
      if (d <= 2.4 && d > 1.6 && !(z === 2 && y < 2 && Math.abs(x) < 1)) b.add(x, y, z, (x + y + z) % 2 ? '#e8f4fa' : '#cfe4ee');
    }
    return b;
  },
  iceCrystal: (rng) => {
    const b = B(); const h = 2 + Math.floor(rng() * 3);
    for (let y = 0; y < h; y++) { b.add(0, y, 0, '#8fe3ff', 0.5); b.add(1, y, 0, '#b8f0ff', 0.4); if (y < h - 1) b.add(0, y, 1, '#7fd8f4', 0.45); }
    return b;
  },
  crystalCluster: (rng) => {
    const b = B(); const c = ['#a85aff', '#20c8d8', '#ff5ad0'][Math.floor(rng() * 3)];
    const h = 2 + Math.floor(rng() * 3);
    for (let y = 0; y < h; y++) { b.add(0, y, 0, c, 0.8); b.add(0, y, 0, c, 0.8); }
    for (let y = 0; y < h - 1; y++) { b.add(1, y, 0, shade(c, 0.25), 0.7); b.add(-1, y, 1, shade(c, -0.15), 0.7); }
    return b;
  },
  stalagmite: (rng) => {
    const b = B(); const h = 3 + Math.floor(rng() * 4);
    for (let y = 0; y < h; y++) {
      const r = Math.max(0, Math.round((h - y) * 0.3));
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) b.add(x, y, z, (x + z) % 2 ? '#4a5160' : '#424855');
    }
    return b;
  },
  glowMushroom: (rng) => {
    const b = B(); const c = ['#20c8d8', '#a85aff', '#28e0a8'][Math.floor(rng() * 3)];
    b.add(0, 0, 0, '#cfd6dd'); b.add(0, 1, 0, c, 0.7); b.add(1, 1, 0, c, 0.7); b.add(0, 1, 1, c, 0.7); b.add(1, 1, 1, c, 0.7);
    b.add(0, 2, 0, shade(c, 0.3), 0.8);
    return b;
  },
  building: (rng) => {
    const b = B(); const w = 2 + Math.floor(rng() * 2), d = 2 + Math.floor(rng() * 2), h = 6 + Math.floor(rng() * 10);
    const c = ['#2a3040', '#323a4c', '#262c3a'][Math.floor(rng() * 3)];
    const winC = ['#ffd54f', '#7fe8ff', '#ff5ad0', '#28e0a8'][Math.floor(rng() * 4)];
    for (let x = -w; x <= w; x++) for (let z = -d; z <= d; z++) for (let y = 0; y <= h; y++) {
      const edge = Math.abs(x) === w || Math.abs(z) === d;
      if (edge || y === h || y === 0) b.add(x, y, z, edge ? c : shade(c, 0.15));
      else if ((x + z + y) % 3 === 0 && y % 2 === 0 && rng() > 0.4) b.add(x, y, z, winC, 0.85);
    }
    return b;
  },
  neonSign: (rng) => {
    const b = B();
    for (let y = 0; y < 4; y++) b.add(0, y, 0, '#37474f');
    const c = ['#e8459e', '#20c8d8', '#28e0a8', '#ffd54f'][Math.floor(rng() * 4)];
    b.add(0, 4, 0, c, 1); b.add(1, 4, 0, c, 1); b.add(0, 5, 0, shade(c, 0.3), 1);
    b.add(1, 3, 0, c, 0.8);
    return b;
  },
  billboard: (rng) => {
    const b = B();
    for (let y = 0; y < 5; y++) { b.add(-2, y, 0, '#37474f'); b.add(2, y, 0, '#37474f'); }
    const c = ['#e8452f', '#2f7de0', '#f7d154'][Math.floor(rng() * 3)];
    for (let x = -2; x <= 2; x++) for (let y = 3; y <= 6; y++) b.add(x, y, 0, (x + y) % 2 ? c : '#f2f2f2', 0.5);
    return b;
  },
  lamp: () => {
    const b = B();
    for (let y = 0; y < 4; y++) b.add(0, y, 0, '#4a5160');
    b.add(0, 4, 0, '#ffd54f', 1); b.add(0, 5, 0, '#ffe88f', 1);
    return b;
  },
  floatIsland: (rng) => {
    const b = B(); const r = 3 + Math.floor(rng() * 3);
    for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) for (let y = 0; y >= -3; y--) {
      const d = Math.sqrt(x * x + z * z + y * y * 2.4);
      if (d <= r && y > -3) b.add(x, y * 2, z, y === 0 ? '#67a03a' : (x + y + z) % 2 ? '#8a6a4a' : '#7a5a3e');
    }
    if (rng() > 0.4) {
      const th = 2 + Math.floor(rng() * 2);
      for (let y = 1; y <= th; y++) b.add(0, y * 2, 0, '#6d4c2f');
      const lr = 2;
      for (let x = -lr; x <= lr; x++) for (let y = 0; y <= lr; y++) for (let z = -lr; z <= lr; z++)
        if (Math.sqrt(x * x + y * y * 1.4 + z * z) <= lr) b.add(x, th * 2 + 1 + y, z, '#4e9c35');
    }
    return b;
  },
  cloud: (rng) => {
    const b = B(); const n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const x = Math.floor(rng() * 7) - 3, y = Math.floor(rng() * 2), z = Math.floor(rng() * 4) - 2;
      b.addBox(x, y, z, x + 1, y, z + 1, '#ffffff');
    }
    return b;
  },
  windmill: () => {
    const b = B();
    for (let y = 0; y < 6; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      const edge = Math.abs(x) === 2 || Math.abs(z) === 2;
      if (edge && y % 3 !== 2) b.add(x, y, z, '#d9c9a8');
      if (!edge && y === 0) b.add(x, y, z, '#8a8f96');
    }
    for (let y = 6; y <= 7; y++) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++)
      if (Math.max(Math.abs(x), Math.abs(z)) === 3) b.add(x, y, z, '#8c3a3a');
    b.add(2, 8, 2, '#6d4c2f'); b.add(-2, 8, 2, '#6d4c2f'); b.add(2, 8, -2, '#6d4c2f'); b.add(-2, 8, -2, '#6d4c2f');
    return b;
  },
  ghostLantern: () => {
    const b = B();
    for (let y = 0; y < 2; y++) b.add(0, y, 0, '#4a5160');
    b.add(0, 2, 0, '#b8fff2', 0.9); b.add(0, 3, 0, '#88e8dc', 0.7);
    return b;
  },
  // ---- ROADSIDE PROPS (v1.8 variety pass: "داخل مپ‌ها چیزهای مختلف") ----
  tireStack: () => {
    const b = B();
    const dark = ['#23262c', '#1d2026'];
    for (let layer = 0; layer < 3; layer++) {
      const c = dark[layer % 2];
      // ring of voxels (hollow look)
      for (const [x, z] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]])
        b.add(x, layer, z, c);
    }
    b.add(0, 3, 0, '#e84a3f', 0.25);   // red cap marker
    return b;
  },
  streetlamp: () => {
    const b = B();
    for (let y = 0; y < 5; y++) b.add(0, y, 0, '#454c55');
    b.add(0, 5, 0, '#454c55'); b.add(1, 5, 0, '#454c55');
    b.add(1, 4, 0, '#fff2b8', 0.95);   // warm lamp head (glows at night)
    return b;
  },
  flagpole: () => {
    const b = B();
    for (let y = 0; y < 6; y++) b.add(0, y, 0, '#b8bec8');
    const c = ['#e84a3f', '#2f7de0', '#f7d154'][Math.floor(Math.random() * 3)];
    for (let x = 1; x <= 3; x++) b.add(x, 5, 0, x === 3 ? c : c);
    for (let x = 1; x <= 2; x++) b.add(x, 4, 0, c);
    return b;
  },
  crate: () => {
    const b = B();
    for (let x = 0; x <= 1; x++) for (let y = 0; y <= 1; y++) for (let z = 0; z <= 1; z++)
      b.add(x, y, z, (x + y + z) % 2 === 0 ? '#a8794a' : '#8a6238');
    return b;
  },
  barrel: () => {
    const b = B();
    for (let y = 0; y < 3; y++) {
      const c = y === 1 ? '#e84a3f' : '#5a6068';
      for (const [x, z] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) b.add(x, y, z, c);
    }
    return b;
  },
  // ---- v1.9 CRASH CITY props (new demolition map) ----
  /** wrecked car: half-crushed voxel coupe with hazard lights still blinking
   *  (emissive) — sells the "car-crash city" mood instantly */
  wreckCar: (rng) => {
    const b = B();
    const body = ['#7a3a30', '#3a4a5c', '#5c5648'][Math.floor(rng() * 3)];
    // squashed chassis (lower + skewed)
    for (let x = -2; x <= 2; x++) for (let z = -1; z <= 2; z++)
      b.add(x, 0, z, (x + z) % 2 ? body : shade(body, -0.15));
    // crumpled cabin on one side only (roof caved)
    for (let x = -1; x <= 1; x++) for (let z = 0; z <= 1; z++)
      if (rng() > 0.25) b.add(x, 1, z, shade(body, -0.25));
    b.add(2, 1, 0, shade(body, -0.35));
    // popped-open hood + detached bumper
    b.add(-2, 1, 1, shade(body, -0.3));
    b.add(3, 0, 2, '#4a5058');
    // wheels half sunk
    b.add(-2, 0, -1, '#1d2026'); b.add(2, 0, -1, '#1d2026');
    // hazard lights still glowing (orange emissive) + cracked windshield
    b.add(-2, 0, 2, '#ff9a3d', 1); b.add(2, 0, 2, '#ff9a3d', 0.9);
    b.add(0, 1, 2, '#cfe8ff', 0.4);
    return b;
  },
  /** construction barrier: striped jersey wall with warning lights */
  barrier: () => {
    const b = B();
    for (let x = -2; x <= 2; x++) for (let y = 0; y <= 1; y++)
      b.add(x, y, 0, (x + y) % 2 === 0 ? '#ff7a1f' : '#e8e4dc');
    b.add(-2, 2, 0, '#ffb74d', 0.8); b.add(2, 2, 0, '#ffb74d', 0.8);  // beacon tops
    b.add(0, 2, 0, '#ff5252', 0.9);
    return b;
  },
  /** traffic cone: classic orange stack with reflective band */
  cone: () => {
    const b = B();
    b.add(0, 0, 0, '#e8621f'); b.add(-1, 0, 0, '#d85a1c'); b.add(1, 0, 0, '#d85a1c');
    b.add(0, 0, -1, '#d85a1c'); b.add(0, 0, 1, '#d85a1c');
    b.add(0, 1, 0, '#fff2b8', 0.7);   // reflective band
    b.add(0, 2, 0, '#e8621f');
    return b;
  },
  // ================= v3.3 PREMIUM MAP PROPS =================
  // 🍭 CANDY KINGDOM
  lollipop: (rng) => {
    const b = B(); const h = 4 + Math.floor(rng() * 3);
    const c = ['#ff4fa3', '#ffd23f', '#3ee6c8', '#a66bff'][Math.floor(rng() * 4)];
    for (let y = 0; y < h; y++) b.add(0, y, 0, '#fdf3f7');
    for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) {
      const d = Math.sqrt(x * x + y * y); if (d > 2.4) continue;
      const ring = Math.floor(Math.atan2(y, x) * 1.3 + d * 1.6) % 2 === 0;
      b.add(x, h + 2 + y, 0, ring ? c : '#ffffff', ring ? 0.25 : 0);
    }
    return b;
  },
  candyCane: (rng) => {
    const b = B(); const h = 5 + Math.floor(rng() * 3);
    for (let y = 0; y < h; y++) b.add(0, y, 0, y % 2 ? '#ff2f4f' : '#ffffff');
    b.add(1, h, 0, '#ff2f4f'); b.add(2, h, 0, '#ffffff'); b.add(2, h - 1, 0, '#ff2f4f');
    return b;
  },
  cupcake: (rng) => {
    const b = B(); const c = ['#ff8ccf', '#8fe9ff', '#fff07a'][Math.floor(rng() * 3)];
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) { b.add(x, 0, z, '#c9884a'); b.add(x, 1, z, (x + z) % 2 ? '#b8743a' : '#d99a5a'); }
    for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (Math.abs(x) + Math.abs(z) < 4) b.add(x, 2, z, c);
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) b.add(x, 3, z, shade(c, 0.1));
    b.add(0, 4, 0, '#ff1f3d', 0.4);
    return b;
  },
  gumdrop: (rng) => {
    const b = B(); const c = ['#ff5ad0', '#5affc8', '#ffe45a', '#8c7bff'][Math.floor(rng() * 4)];
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) b.add(x, 0, z, c, 0.2);
    b.add(0, 1, 0, shade(c, 0.2), 0.3);
    return b;
  },
  // 🌌 STAR GALAXY
  starPillar: (rng) => {
    const b = B(); const h = 5 + Math.floor(rng() * 6);
    const c = ['#00f0ff', '#b400ff', '#ff3df0'][Math.floor(rng() * 3)];
    for (let y = 0; y < h; y++) { b.add(0, y, 0, '#1a1236'); if (y % 3 === 1) b.add(1, y, 0, c, 1); }
    b.add(0, h, 0, c, 1); b.add(-1, h, 0, c, 0.8); b.add(1, h, 0, c, 0.8); b.add(0, h + 1, 0, '#ffffff', 1);
    return b;
  },
  ufo: (rng) => {
    const b = B(); const c = ['#9bff5a', '#00f0ff'][Math.floor(rng() * 2)];
    for (let y = 0; y < 6; y++) b.add(0, y, 0, '#2a2450');
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) if (x * x + z * z <= 10) b.add(x, 6, z, (x + z) % 2 ? '#c8ccd8' : '#9aa2b8');
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) b.add(x, 7, z, c, 0.8);
    for (let a = 0; a < 8; a++) b.add(Math.round(Math.cos(a * 0.785) * 3), 5, Math.round(Math.sin(a * 0.785) * 3), '#ffe45a', 1);
    return b;
  },
  planetRock: (rng) => {
    const b = B(); const r = 1 + Math.floor(rng() * 2);
    const c = ['#5a3cff', '#ff4fd8', '#1fd4ff'][Math.floor(rng() * 3)];
    for (let x = -r; x <= r; x++) for (let y = 0; y <= r * 2; y++) for (let z = -r; z <= r; z++) {
      if (Math.sqrt(x * x + (y - r) ** 2 + z * z) <= r + 0.3) b.add(x, y, z, (x + y + z) % 2 ? c : shade(c, -0.2), 0.35);
    }
    return b;
  },
  // 🐉 DRAGON TEMPLE
  pagoda: (rng) => {
    const b = B(); const lv = 3 + Math.floor(rng() * 2);
    let y = 0;
    for (let i = 0; i < lv; i++) {
      const r = lv - i;
      for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
        const edge = Math.abs(x) === r || Math.abs(z) === r;
        b.add(x, y, z, edge ? '#8a1414' : '#5a0e0e');
        b.add(x, y + 1, z, edge ? '#8a1414' : '#5a0e0e');
      }
      for (let x = -r - 1; x <= r + 1; x++) for (let z = -r - 1; z <= r + 1; z++) b.add(x, y + 2, z, '#ffc02e', 0.15);
      y += 3;
    }
    b.add(0, y, 0, '#ffd84a', 1);
    return b;
  },
  dragonStatue: () => {
    const b = B();
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) b.add(x, 0, z, '#3a2a26');
    for (let y = 1; y < 6; y++) b.add(0, y, y > 3 ? 1 : 0, '#c21818');
    b.add(0, 6, 1, '#c21818'); b.add(0, 6, 2, '#ffc02e'); b.add(0, 7, 1, '#ffc02e');
    b.add(-1, 6, 1, '#ff3d00', 1); b.add(1, 6, 1, '#ff3d00', 1);
    b.add(-1, 3, 0, '#8a1414'); b.add(1, 3, 0, '#8a1414'); b.add(-2, 4, 0, '#8a1414'); b.add(2, 4, 0, '#8a1414');
    return b;
  },
  goldLantern: () => {
    const b = B();
    for (let y = 0; y < 4; y++) b.add(0, y, 0, '#2a1a14');
    b.add(0, 4, 0, '#ff2f1f', 0.9); b.add(0, 5, 0, '#ffb300', 1); b.add(0, 6, 0, '#2a1a14');
    return b;
  },
  // 👑 ROYAL GOLD CITY
  goldTower: (rng) => {
    const b = B(); const w = 2, h = 9 + Math.floor(rng() * 10);
    for (let x = -w; x <= w; x++) for (let z = -w; z <= w; z++) for (let y = 0; y <= h; y++) {
      const edge = Math.abs(x) === w || Math.abs(z) === w;
      if (!edge && y !== h) continue;
      const win = edge && y % 2 === 1 && (x + z) % 2 === 0;
      b.add(x, y, z, win ? '#ffd86b' : (Math.abs(x) === w && Math.abs(z) === w ? '#d4a017' : '#1b1712'), win ? 0.9 : 0);
    }
    for (let y = h + 1; y < h + 4; y++) b.add(0, y, 0, '#ffd24a', 0.6);
    return b;
  },
  crownStatue: () => {
    const b = B();
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) { b.add(x, 0, z, '#2a2520'); b.add(x, 1, z, '#2a2520'); }
    for (let x = -2; x <= 2; x++) { b.add(x, 2, 0, '#ffc62e', 0.4); if (x % 2 === 0) b.add(x, 3, 0, '#ffd84a', 0.6); }
    b.add(0, 4, 0, '#ff2f6d', 1);
    return b;
  },
};

export function getDecoGeo(type: string): DecoGeo {
  let g = cache.get(type);
  if (!g) {
    const rng = makeRng(type.length * 7919 + 13);
    const b = (builders[type] ?? builders.rock)(rng);
    const built = b.build(0.5);
    // split emissive voxels (e>0) into separate geometry for glow material
    g = { geometry: built.geometry };
    cache.set(type, g);
  }
  return g;
}

/** Create an instanced batch of a deco type */
export function makeDecoInstances(type: string, count: number): THREE.InstancedMesh | null {
  const geo = getDecoGeo(type);
  if (!geo.geometry.attributes.position || geo.geometry.attributes.position.count === 0) return null;
  const mesh = new THREE.InstancedMesh(geo.geometry, decoMaterial, Math.max(1, count));
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.count = 0; // fill later
  return mesh;
}
