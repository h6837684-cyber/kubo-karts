// KUBO KARTS - Voxel geometry builder: merges voxel grids into single BufferGeometry
// with face culling, per-vertex baked ambient occlusion and per-vertex colors.
import * as THREE from 'three';

export interface Voxel {
  x: number; y: number; z: number;
  c: string;          // hex color
  e?: number;         // emissive strength 0..1 (stored in uv2.x)
  s?: number;         // scale (1 default) - allows slab-like voxels (drawn from origin)
}

interface Key { x: number; y: number; z: number; }
const k2s = (x: number, y: number, z: number) => x + ',' + y + ',' + z;

// face definitions: [normal, 4 corner offsets (CCW from outside)]
const FACES: { n: [number, number, number]; v: [number, number, number][]; corners: [number, number, number][] }[] = [
  { // +X
    n: [1, 0, 0],
    v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  },
  { // -X
    n: [-1, 0, 0],
    v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  },
  { // +Y (top)
    n: [0, 1, 0],
    v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  },
  { // -Y
    n: [0, -1, 0],
    v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  },
  { // +Z
    n: [0, 0, 1],
    v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  },
  { // -Z
    n: [0, 0, -1],
    v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
    corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  },
];

const hex2rgb = (() => {
  const cache = new Map<string, [number, number, number]>();
  return (hex: string): [number, number, number] => {
    let v = cache.get(hex);
    if (!v) {
      const n = parseInt(hex.replace('#', ''), 16);
      v = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
      cache.set(hex, v);
    }
    return v;
  };
})();

export class VoxelBuilder {
  private map = new Map<string, Voxel>();
  list: Voxel[] = [];

  clear() { this.map.clear(); this.list.length = 0; return this; }
  get count() { return this.list.length; }

  add(x: number, y: number, z: number, c: string, e = 0, s = 1): this {
    const q = 4; // dedupe quantum (0.25 grid)
    const key = k2s(Math.round(x * q) / q, Math.round(y * q) / q, Math.round(z * q) / q);
    if (this.map.has(key)) return this; // dedupe
    const v: Voxel = { x, y, z, c, e, s };
    this.map.set(key, v);
    this.list.push(v);
    return this;
  }

  addBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string, e = 0, step = 1): this {
    for (let x = x0; x <= x1; x += step)
      for (let y = y0; y <= y1; y += step)
        for (let z = z0; z <= z1; z += step)
          this.add(x, y, z, c, e);
    return this;
  }

  /** Hollow shell box (walls only, used for structures) */
  addShell(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string, e = 0): this {
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      if (x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1) this.add(x, y, z, c, e);
    }
    return this;
  }

  /** Mirror current voxels on X axis (for symmetric models). */
  mirrorX(offset = 0): this {
    const snapshot = this.list.slice();
    for (const v of snapshot) this.add(-(v.x + offset) + offset * 0, v.y, v.z, v.c, v.e, v.s);
    return this;
  }

  /** Build merged geometry. unit = voxel world size (voxels are unit* s) */
  build(unit = 1): { geometry: THREE.BufferGeometry; triangles: number } {
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const emissive: number[] = [];
    let tris = 0;

    const solid = new Set(this.map.keys());

    for (const v of this.list) {
      const [r, g, b] = hex2rgb(v.c);
      const vs = v.s ?? 1;
      for (const f of FACES) {
        // neighbor check in grid space (grid step = vs)
        if (vs === 1) {
          const nx = v.x + f.n[0], ny = v.y + f.n[1], nz = v.z + f.n[2];
          if (solid.has(k2s(nx, ny, nz))) continue;
        }
        // corners in world space: grid coord * unit
        const corners = f.corners.map(([cx, cy, cz]) => [
          (v.x + cx * vs) * unit, (v.y + cy * vs) * unit, (v.z + cz * vs) * unit,
        ] as [number, number, number]);
        // AO per corner (only meaningful for full voxels)
        const ao: number[] = [];
        if (vs === 1) {
          for (let i = 0; i < 4; i++) {
            ao.push(this.cornerAO(v, f, f.corners[i], solid, vs));
          }
        } else { ao.push(1, 1, 1, 1); }

        // two triangles: 0,1,2 & 0,2,3
        const idx = [0, 1, 2, 0, 2, 3];
        for (const i of idx) {
          const p = corners[i];
          positions.push(p[0], p[1], p[2]);
          normals.push(f.n[0], f.n[1], f.n[2]);
          const a = ao[i];
          colors.push(r * a, g * a, b * a);
          emissive.push(v.e || 0);
        }
        tris += 2;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('emissiveStrength', new THREE.Float32BufferAttribute(emissive, 1));
    geometry.computeBoundingSphere();
    return { geometry, triangles: tris };
  }

  /** classic voxel corner AO: count the 3 blocks around this corner on the face plane (grid space) */
  private cornerAO(v: Voxel, f: typeof FACES[0], cornerGrid: [number, number, number], solid: Set<string>, vs: number): number {
    const n = f.n;
    let ax: number, ay: number;
    if (n[0] !== 0) { ax = 1; ay = 2; } else if (n[1] !== 0) { ax = 0; ay = 2; } else { ax = 0; ay = 1; }
    const base: [number, number, number] = [v.x + n[0] * vs, v.y + n[1] * vs, v.z + n[2] * vs];
    const center = [v.x + vs / 2, v.y + vs / 2, v.z + vs / 2];
    const d = [cornerGrid[0] - center[0], cornerGrid[1] - center[1], cornerGrid[2] - center[2]];
    const sign = (i: number) => (d[i] >= 0 ? 1 : -1);
    const o1: [number, number, number] = [base[0], base[1], base[2]];
    o1[ax] += sign(ax) * vs;
    const o2: [number, number, number] = [base[0], base[1], base[2]];
    o2[ay] += sign(ay) * vs;
    const oc: [number, number, number] = [o1[0], o1[1], o1[2]];
    oc[ay] += sign(ay) * vs;

    const s1 = solid.has(k2s(o1[0], o1[1], o1[2])) ? 1 : 0;
    const s2 = solid.has(k2s(o2[0], o2[1], o2[2])) ? 1 : 0;
    const sc = solid.has(k2s(oc[0], oc[1], oc[2])) ? 1 : 0;
    if (s1 && s2) return 0.55;
    const occ = s1 + s2 + sc;
    return occ === 0 ? 1 : occ === 1 ? 0.82 : 0.66;
  }
}

/** Convenience: build geometry + mesh with the shared voxel material */
export function voxMesh(b: VoxelBuilder, material: THREE.Material, unit = 1): THREE.Mesh {
  const { geometry } = b.build(unit);
  const m = new THREE.Mesh(geometry, material);
  m.matrixAutoUpdate = false;
  return m;
}
