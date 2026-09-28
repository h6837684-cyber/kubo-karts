// KUBO KARTS - GPU particle system: pooled Points with velocity/gravity/fade/scale
// Voxel-style square particles. One draw call for all particles.
import * as THREE from 'three';
import { makeParticleTexture } from './materials';

const MAX = 1400;

interface P {
  active: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number; sizeEnd: number;
  r: number; g: number; b: number;
  a: number;
  grav: number;
  drag: number;
}

export interface SpawnOpts {
  count?: number;
  pos: THREE.Vector3;
  spread?: number;         // random sphere radius for initial position jitter
  vel?: THREE.Vector3;     // base velocity
  velSpread?: number;
  life?: number; lifeSpread?: number;
  size?: number; sizeEnd?: number; sizeSpread?: number;
  color?: string; colorEnd?: string;   // lerp color over life
  gravity?: number;
  drag?: number;
  alpha?: number;
}

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

export class Particles {
  points: THREE.Points;
  private pool: P[] = [];
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private sizeAttr: THREE.BufferAttribute;
  private alpAttr: THREE.BufferAttribute;
  density = 1; // graphics quality multiplier

  constructor(soft = false) {
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3);
    this.colAttr = new THREE.BufferAttribute(new Float32Array(MAX * 3), 3);
    this.sizeAttr = new THREE.BufferAttribute(new Float32Array(MAX), 1);
    this.alpAttr = new THREE.BufferAttribute(new Float32Array(MAX), 1);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr.setUsage(THREE.DynamicDrawUsage);
    this.alpAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('pcolor', this.colAttr);
    geo.setAttribute('psize', this.sizeAttr);
    geo.setAttribute('palpha', this.alpAttr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      uniforms: { tex: { value: makeParticleTexture(soft) } },
      transparent: true, depthWrite: false,
      blending: THREE.NormalBlending,
      vertexShader: `
        attribute vec3 pcolor; attribute float psize; attribute float palpha;
        varying vec3 vColor; varying float vAlpha;
        void main(){
          vColor = pcolor; vAlpha = palpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = psize * (160.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D tex; varying vec3 vColor; varying float vAlpha;
        void main(){
          vec4 t = texture2D(tex, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a * vAlpha);
          if (gl_FragColor.a < 0.02) discard;
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    for (let i = 0; i < MAX; i++) {
      this.pool.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 1, sizeEnd: 1, r: 1, g: 1, b: 1, a: 1, grav: 0, drag: 0 });
    }
  }

  private cursor = 0;
  private alloc(): P {
    for (let i = 0; i < MAX; i++) {
      this.cursor = (this.cursor + 1) % MAX;
      if (!this.pool[this.cursor].active) return this.pool[this.cursor];
    }
    return this.pool[this.cursor]; // recycle oldest slot
  }

  spawn(o: SpawnOpts) {
    const n = Math.max(1, Math.round((o.count ?? 8) * this.density));
    _c1.set(o.color ?? '#ffffff');
    _c2.set(o.colorEnd ?? o.color ?? '#ffffff');
    for (let i = 0; i < n; i++) {
      const p = this.alloc();
      const sp = o.spread ?? 0.3;
      p.x = o.pos.x + (Math.random() - 0.5) * sp * 2;
      p.y = o.pos.y + (Math.random() - 0.5) * sp * 2;
      p.z = o.pos.z + (Math.random() - 0.5) * sp * 2;
      const vs = o.velSpread ?? 1.5;
      p.vx = (o.vel?.x ?? 0) + (Math.random() - 0.5) * vs * 2;
      p.vy = (o.vel?.y ?? 0) + (Math.random() - 0.5) * vs * 2;
      p.vz = (o.vel?.z ?? 0) + (Math.random() - 0.5) * vs * 2;
      const life = o.life ?? 0.6;
      p.maxLife = p.life = life + (Math.random() - 0.5) * (o.lifeSpread ?? life * 0.6);
      const ss = o.sizeSpread ?? 0;
      p.size = (o.size ?? 0.35) + (Math.random() - 0.5) * ss * 2;
      p.sizeEnd = o.sizeEnd ?? p.size * 0.5;
      p.r = _c1.r; p.g = _c1.g; p.b = _c1.b;
      p.a = o.alpha ?? 0.9;
      p.grav = o.gravity ?? 0;
      p.drag = o.drag ?? 0;
      p.active = true;
    }
  }

  update(dt: number) {
    const pos = this.posAttr.array as Float32Array;
    const col = this.colAttr.array as Float32Array;
    const size = this.sizeAttr.array as Float32Array;
    const alp = this.alpAttr.array as Float32Array;
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[i];
      if (!p.active) { alp[i] = 0; continue; }
      p.life -= dt;
      if (p.life <= 0) { p.active = false; alp[i] = 0; continue; }
      p.vy -= p.grav * dt;
      if (p.drag > 0) { const d = Math.max(0, 1 - p.drag * dt); p.vx *= d; p.vy *= d; p.vz *= d; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const t = 1 - p.life / p.maxLife;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      size[i] = p.size + (p.sizeEnd - p.size) * t;
      alp[i] = p.a * (t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
      _c1.setRGB(p.r, p.g, p.b); _c2.set(p.r, p.g, p.b);
      // simple color lerp stored at spawn? we lerp toward colorEnd
      col[i * 3] = p.r; col[i * 3 + 1] = p.g; col[i * 3 + 2] = p.b;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alpAttr.needsUpdate = true;
  }
}

// ---- debris chunks: instanced small cubes with physics (voxel explosion) ----
const DEBRIS_MAX = 90;
interface D { active: boolean; x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; rz: number; srx: number; sry: number; srz: number; life: number; maxLife: number; s: number; }

export class Debris {
  mesh: THREE.InstancedMesh;
  private items: D[] = [];
  private dummy = new THREE.Object3D();
  private colAttr: THREE.InstancedBufferAttribute;
  density = 1;

  constructor() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, DEBRIS_MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS_MAX * 3), 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = this.colAttr as unknown as THREE.InstancedBufferAttribute;
    this.mesh.frustumCulled = false;
    this.mesh.count = DEBRIS_MAX;
    for (let i = 0; i < DEBRIS_MAX; i++) this.items.push({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, srx: 0, sry: 0, srz: 0, life: 0, maxLife: 1, s: 0.2 });
    // hide all
    for (let i = 0; i < DEBRIS_MAX; i++) { this.dummy.position.set(0, -9999, 0); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix); }
  }

  burst(pos: THREE.Vector3, count: number, color: string, power = 5, size = 0.22) {
    const c = new THREE.Color(color);
    const n = Math.round(count * this.density);
    for (let k = 0; k < n; k++) {
      let d: D | null = null;
      for (const it of this.items) if (!it.active) { d = it; break; }
      if (!d) break;
      d.active = true;
      d.x = pos.x + (Math.random() - 0.5) * 0.5; d.y = pos.y + Math.random() * 0.5; d.z = pos.z + (Math.random() - 0.5) * 0.5;
      d.vx = (Math.random() - 0.5) * power; d.vy = Math.random() * power * 0.9 + 1.5; d.vz = (Math.random() - 0.5) * power;
      d.rx = Math.random() * 6; d.ry = Math.random() * 6; d.rz = Math.random() * 6;
      d.srx = (Math.random() - 0.5) * 10; d.sry = (Math.random() - 0.5) * 10; d.srz = (Math.random() - 0.5) * 10;
      d.maxLife = d.life = 0.8 + Math.random() * 0.7;
      d.s = size * (0.6 + Math.random() * 0.8);
      const i = this.items.indexOf(d);
      this.colAttr.setXYZ(i, c.r * (0.7 + Math.random() * 0.5), c.g * (0.7 + Math.random() * 0.5), c.b * (0.7 + Math.random() * 0.5));
    }
    this.colAttr.needsUpdate = true;
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < DEBRIS_MAX; i++) {
      const d = this.items[i];
      if (!d.active) continue;
      any = true;
      d.life -= dt;
      if (d.life <= 0) { d.active = false; this.dummy.position.set(0, -9999, 0); this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix); continue; }
      d.vy -= 18 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      if (d.y < d.s / 2 && d.vy < 0) { d.y = d.s / 2; d.vy *= -0.4; d.vx *= 0.7; d.vz *= 0.7; }
      d.rx += d.srx * dt; d.ry += d.sry * dt; d.rz += d.srz * dt;
      this.dummy.position.set(d.x, d.y, d.z);
      this.dummy.rotation.set(d.rx, d.ry, d.rz);
      const sc = d.s * Math.min(1, d.life / d.maxLife * 2);
      this.dummy.scale.setScalar(sc);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
