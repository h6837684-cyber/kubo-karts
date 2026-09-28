// KUBO KARTS - Power-up system: 10 items, position-based fair roulette,
// projectile/hazard entities with VFX, counterplay via shield/invul.
import * as THREE from 'three';
import { Kart } from '../kart/kart';
import type { TrackData } from '../world/track';
import { Particles, Debris } from '../gfx/particles';
import { clamp, rand, wrapAngle } from '../core/utils';
import { audio } from '../core/audio';
import { t } from '../core/lang';

export type ItemId = 'boost' | 'shield' | 'rocket' | 'lightning' | 'ice' | 'trap' | 'mine' | 'magnet' | 'emp' | 'giant' | 'ghost' | 'jump'
  // v1.21: the three reference-sheet items that were still missing
  | 'tnt' | 'banana' | 'minecart';

export interface ItemDef {
  id: ItemId;
  icon: string;      // glyph for UI
  color: string;
  desc: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  boost: { id: 'boost', icon: '🔥', color: '#ff9a3d', desc: 'Instant turbo burst' },
  shield: { id: 'shield', icon: '🛡️', color: '#5ad0ff', desc: 'Blocks the next attack' },
  rocket: { id: 'rocket', icon: '🚀', color: '#ff5252', desc: 'Homing missile for the racer ahead — hold LOOK BACK to fire it at whoever is BEHIND you' },
  lightning: { id: 'lightning', icon: '⚡', color: '#4fc3ff', desc: 'BLUE STORM: 3 giant electric zones materialize ahead of the LEADER — touch one and it discharges with HUGE damage, then vanishes' },
  ice: { id: 'ice', icon: '🧊', color: '#aee8ff', desc: 'Freezes the racer in front' },
  trap: { id: 'trap', icon: '🛢️', color: '#3a3f46', desc: 'Drops an oil slick behind you' },
  mine: { id: 'mine', icon: 'mine', color: '#ff3b30', desc: 'Plant a MINE behind you — it blows up ANYONE who drives over it, even YOU. Watch out!' },
  magnet: { id: 'magnet', icon: '🧲', color: '#ff5ad0', desc: 'Attracts item boxes from afar • +60 coins at the finish' },
  emp: { id: 'emp', icon: '💥', color: '#b45aff', desc: 'Shockwave that stalls nearby racers' },
  giant: { id: 'giant', icon: '🦖', color: '#67c23a', desc: 'Monster mode: crush and smash' },
  ghost: { id: 'ghost', icon: '👻', color: '#cfe8ff', desc: 'Phase out: nothing can touch you and you pass THROUGH rivals' },
  // v3 (user: "به جای قدرت پرش، قدرت مین باشه ولی مین فنری"): the old MEGA HOP
  // slot is now the SPRING MINE. The internal id stays 'jump' so saves, MP
  // settings and the server whitelist keep working unchanged.
  jump: { id: 'jump', icon: 'spring', color: '#d08a45', desc: 'SPRING MINE: a wooden floor plate hides a steel spring — whoever drives over it gets catapulted sky-high and takes heavy damage' },
  tnt: { id: 'tnt', icon: '🧨', color: '#e53935', desc: 'Drop a LIT TNT block behind you — the fuse keeps burning and it blows up the moment a car reaches it' },
  banana: { id: 'banana', icon: '🍌', color: '#ffe14d', desc: 'Drop a banana peel — the next racer over it slips and spins' },
  minecart: { id: 'minecart', icon: '🛒', color: '#9aa4ae', desc: 'Summon a runaway minecart that rides the track, hunts the racer ahead and throws them off the road' },
};

/** fair roulette: weights per rank bucket (1 = leader) */
const WEIGHTS: Record<ItemId, [number, number, number]> = {
  //           [1st, 2-3, 4+]
  boost: [13, 15, 11],
  shield: [15, 12, 7],
  rocket: [2, 11, 15],
  lightning: [0, 5, 14],
  ice: [2, 9, 13],
  trap: [9, 11, 9],
  mine: [1, 7, 13],
  magnet: [11, 9, 6],
  emp: [2, 7, 12],
  giant: [0, 3, 9],
  ghost: [4, 6, 8],
  jump: [6, 7, 8],
  tnt: [7, 9, 9],
  banana: [12, 10, 6],
  minecart: [0, 6, 12],
};

/** §17 SCREEN FLASH: bright full-screen blink so the lightning STRIKE actually
 *  reads (cast moment + victims). Cheap DOM overlay, zero postFX cost. */
/** v3.2 NITRO overlay: radial speed streaks + blue edge glow for the burst */
export function nitroOverlay(sec: number) {
  if (typeof document === 'undefined') return;
  let f = document.getElementById('nitro-ov') as HTMLDivElement | null;
  if (!f) {
    f = document.createElement('div');
    f.id = 'nitro-ov';
    f.innerHTML = '<i class="nv-glow"></i><i class="nv-lines"></i><i class="nv-lines b"></i>';
    document.body.appendChild(f);
  }
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  clearTimeout((f as unknown as { _t?: number })._t);
  (f as unknown as { _t?: number })._t = window.setTimeout(() => f!.classList.remove('on'), sec * 1000);
}
export function screenFlash(color = '#fff8d0', peak = 0.65, ms = 170) {
  if (typeof document === 'undefined') return;
  let f = document.getElementById('kubo-flash') as HTMLDivElement | null;
  if (!f) {
    f = document.createElement('div');
    f.id = 'kubo-flash';
    document.body.appendChild(f);
  }
  f.style.background = color;
  f.style.transition = 'none';
  f.style.opacity = String(peak);
  void f.offsetWidth;
  f.style.transition = `opacity ${ms}ms ease-out`;
  f.style.opacity = '0';
}

export function rollItem(rank: number, total: number, luck = false, enabled?: Set<ItemId> | null): ItemId {
  const bucket = rank <= 1 ? 0 : rank <= 3 ? 1 : 2;
  // multiplayer host setting: only roll enabled power-ups (falls back to all)
  const entries = (Object.keys(WEIGHTS) as ItemId[]).filter(id => !enabled || enabled.has(id));
  if (entries.length === 0) entries.push('boost');
  let sum = 0;
  const w: number[] = entries.map(id => {
    let v = WEIGHTS[id][bucket];
    if (luck && v > 6) v = Math.round(v * 1.35);
    sum += v;
    return v;
  });
  let r = Math.random() * sum;
  for (let i = 0; i < entries.length; i++) {
    r -= w[i];
    if (r <= 0) return entries[i];
  }
  void total;
  return entries[0];
}

/** v1.14 spatial audio: stereo pan of a world position relative to the local
 *  player's heading (right = positive). AI events now happen AROUND you. */
function panOf(pv: Kart, pos: THREE.Vector3): number {
  const dx = pos.x - pv.pos.x, dz = pos.z - pv.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.001) return 0;
  const pan = (dx / d) * -Math.cos(pv.heading) + (dz / d) * Math.sin(pv.heading);
  return clamp(pan, -1, 1) * 0.75;
}

// ---------- entities ----------
interface Entity {
  mesh: THREE.Object3D;
  kind: 'rocket' | 'mine' | 'trap' | 'ice' | 'efield' | 'tnt' | 'banana' | 'cart' | 'spring';
  owner: Kart;
  plank?: THREE.Object3D;        // spring mine: hinged wooden lid
  coil?: THREE.Object3D;         // spring mine: steel coil under the lid
  sprung?: number;               // spring mine: >0 = firing animation time left
  life: number;
  sIdx: number;
  vel?: THREE.Vector3;
  vy?: number;
  target?: Kart;
  armed?: number;
  mat?: THREE.Material;          // per-entity cloned material (beacon blink / sheen)
  freeFly?: boolean;             // ice shard with no target: flies straight ahead
  dir?: THREE.Vector3;           // freeFly travel direction
  backward?: boolean;            // rocket fired at racers BEHIND (look-back + fire)
  beacon?: THREE.Mesh;           // mine: blinking red warning light
  ring?: THREE.Mesh;             // mine: pulsing hazard ring on the ground
  scale?: number;                // MONSTER MODE: 2 = giant item (bigger hit/trigger radius)
  spd?: number;                  // rocket: current samples/s (SPOOLS UP — user: "هی سریع بشه")
  mps?: number;                  // v3.2 rocket: real speed in m/s (spools toward cap)
  cap?: number;                  // v3.2 rocket: top speed in m/s (relative to the victim's car)
  flame?: THREE.Object3D;        // v3.2 rocket: flickering jet flame
  advance?: number;              // rocket: fractional sample cursor (sub-sample precision at any sim rate)
  beepT?: number;                // rocket: countdown to the next lock-on beep / field: next mini-bolt
  deflected?: boolean;           // rocket bounced off a shield/magnet — flies away harmlessly
  audioId?: string;              // v1.14: live whoosh loop id (distance/pan driven)
  orb?: THREE.Mesh;              // rocket: glowing red orb core (user: "گوی نورانی قرمز")
  radius?: number;               // efield: trigger radius (meters)
  mats?: THREE.MeshBasicMaterial[];  // efield: animated dome/arc materials
  arcs?: THREE.Mesh[];           // efield: rotating electric arc rings
  fieldPos?: THREE.Vector3;      // efield: world anchor (flat distance tests)
  domeMat?: THREE.MeshBasicMaterial;  // efield: dome pulse
  coreMat?: THREE.MeshBasicMaterial;  // efield: core column pulse
  ringMat?: THREE.MeshBasicMaterial;  // efield: ground ring pulse
  flash?: THREE.MeshBasicMaterial;    // tnt: white fuse-blink overlay
  fuseSpark?: THREE.Mesh;             // tnt: sparkling fuse tip
  lane?: number;                      // minecart: lateral offset on the road (m)
  clackT?: number;                    // minecart: next rail-clack sound
  railT?: number;                     // minecart: next rail sleeper drop
  immuneT?: number;                   // owner grace window (banana / tnt)
  fuseSfxT?: number;                  // v3.4 tnt: re-hiss timer for the long burning fuse
  hitSet?: Set<Kart>;                 // minecart: karts already run over
}

export class ItemSystem {
  entities: Entity[] = [];
  private scene: THREE.Scene;
  private particles: Particles;
  private debris: Debris;
  private track: TrackData;
  onHit: ((kart: Kart, item: ItemId) => void) | null = null;
  /** GROUND SHAKE request (v1.10 storm): the race camera reads + clears this
   *  every tick — set on every thunder spawn and field discharge. */
  shakeReq = 0;
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  /** MISSILE INCOMING WARNING (user v1.9): live state for the LOCAL player —
   *  a missile is homing on them RIGHT NOW. angleDeg: screen-relative direction
   *  the missile is coming from (0 = straight ahead), pulse: spikes to 1 on
   *  every beep then decays (the HUD flash feeds on this — user: "هر دید دید
   *  فلش کمی بزرگ و پرنور بشه و بعد برگرده"). */
  missileWarn: { active: boolean; angleDeg: number; pulse: number; dist: number; kind: 'rocket' | 'cart'; eta?: number } = { active: false, angleDeg: 0, pulse: 0, dist: 999, kind: 'rocket' };
  private warnEl: HTMLElement | null = null;
  private audioSeq = 0;          // v1.14: unique ids for missile whoosh loops
  private warnArrow: HTMLElement | null = null;
  private warnBanner: HTMLElement | null = null;

  constructor(scene: THREE.Scene, particles: Particles, debris: Debris, track: TrackData) {
    this.scene = scene; this.particles = particles; this.debris = debris; this.track = track;
  }

  private dead = false;
  dispose() {
    this.dead = true;
    for (const e of this.entities) { if (e.kind === 'rocket' && e.audioId) audio.stopRocketLoop(e.audioId); }
    for (const e of this.entities) this.scene.remove(e.mesh);
    this.entities = [];
    this.pendingFields = [];
    for (const o of this.temp) this.scene.remove(o);
    this.temp = [];
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    for (const tx of this.texStore) tx.dispose();
    this.texStore = [];
    this.rails = [];
    this.warnEl?.remove();
    this.warnEl = null;
    this.missileWarn.active = false;
  }

  // ---- use an item ----
  use(kart: Kart, id: ItemId, racers: Kart[]) {
    // AUDIO PLACEMENT (user v1.9: "صداها به خوبی جایگذاری بشن… یه صدای علکی
    // بدون هیچ کار نیاد"): AI item sounds are distance-gated — full volume for
    // the local player, soft nearby, silent far away. No more random noises.
    const pv = racers.find(r => r.isLocal);
    const dToPlayer = pv ? kart.pos.distanceTo(pv.pos) : 0;
    const vol = kart.isLocal ? 1 : dToPlayer < 26 ? 0.5 : 0.14;
    audio.play('itemUse', 1, vol);
    // MONSTER MODE (user v1.8: "داخل حالت هیولا موشک و تمام قدرت‌ها بزرگ بشن،
    // دمیزشون دو برابر باشه"): a kart in giant mode fires/plants EVERYTHING
    // at DOUBLE size with matching blast/trigger radii — monster rocket,
    // monster mine, monster shockwave…
    const gs = kart.giantT > 0 ? 2 : 1;
    switch (id) {
      case 'boost': kart.applyNitro(2.6); audio.play('boost', 1, vol); audio.play('lightning', 1.35, vol * 0.55); this.nitroBurst(kart); break;
      case 'shield': kart.shieldT = 9; audio.play('shield', 1, vol); this.shieldFlash(kart); break;
      case 'magnet': kart.magnetT = 9; kart.usedMagnet = true; audio.play('magnet', 1, vol); this.magnetField(kart); this.magnetSlam(kart); break;
      case 'giant': kart.giantT = 6.5; audio.play('giantRoar', 1, vol); this.giantBurst(kart); break;
      case 'rocket': this.spawnRocket(kart, racers, this.backwardHint === true, gs); break;
      case 'ice': this.spawnIce(kart, racers, gs); break;
      case 'mine': this.spawnMine(kart, gs); break;
      case 'ghost': kart.ghostT = 5; audio.play('ghostFx', 1, vol); this.ghostVeil(kart); break;
      case 'jump': this.spawnSpring(kart, gs); break;   // v3: SPRING MINE
      case 'trap': audio.play('trap', 0.8, vol * 0.7); this.spawnTrap(kart, gs); break;
      case 'lightning': this.zapLightning(kart, racers, gs); break;
      case 'emp': this.zapEmp(kart, racers, gs); break;
      case 'tnt': this.spawnTnt(kart, gs); break;
      case 'banana': this.spawnBanana(kart, gs); break;
      case 'minecart': this.spawnMinecart(kart, racers, gs); break;
    }
  }

  /** set right before use() by the race (player): fires the rocket BACKWARD
   *  when the character looks back (eye button) — user request */
  backwardHint = false;

  // ---- quick cast VFX helpers (user: better animation/effect for EVERY item) ----
  private flareRing(pos: THREE.Vector3, color: string, maxR: number, life: number, axis: 'x' | 'z' = 'x') {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.6, 0.09, 6, 22),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = axis === 'x' ? Math.PI / 2 : 0;
    ring.rotation.y = axis === 'z' ? Math.PI / 2 : 0;
    ring.position.copy(pos).setY(pos.y + 0.35);
    this.scene.add(ring);
    this.trackTemp(ring);
    const t0 = performance.now() / 1000;
    const anim = () => {
      const t = (performance.now() / 1000) - t0;
      if (!ring.parent || t > life) { this.scene.remove(ring); return; }
      const k = t / life;
      ring.scale.setScalar(0.4 + k * maxR);
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k);
      requestAnimationFrame(anim);
    };
    anim();
  }

  /** temp objects removed on dispose() too (no GPU leak) */
  private temp: THREE.Object3D[] = [];
  private trackTemp(o: THREE.Object3D) {
    this.temp.push(o);
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    if (m) this.disposables.push(m);
    if ((o as THREE.Mesh).geometry) this.disposables.push((o as THREE.Mesh).geometry);
  }

  private boostFlare(kart: Kart) {
    this.flareRing(kart.pos, '#ff9a3d', 3.2, 0.45);
    this.particles.spawn({
      count: 16, pos: kart.pos.clone().setY(kart.pos.y + 0.3), spread: 0.5,
      vel: new THREE.Vector3(0, 1.5, 0), velSpread: 4,
      life: 0.4, size: 0.35, sizeEnd: 0.05, color: '#ffb74d', alpha: 0.9, gravity: 0,
    });
  }

  private shieldFlash(kart: Kart) {
    this.flareRing(kart.pos, '#5ad0ff', 2.6, 0.5);
    this.particles.spawn({
      count: 12, pos: kart.pos.clone().setY(kart.pos.y + 0.6), spread: 0.7,
      vel: new THREE.Vector3(0, 2, 0), velSpread: 2,
      life: 0.5, size: 0.25, sizeEnd: 0.4, color: '#8fe3ff', alpha: 0.8, gravity: -2,
    });
  }

  private magnetField(kart: Kart) {
    this.flareRing(kart.pos, '#ff5ad0', 5.5, 0.7);
    this.particles.spawn({
      count: 14, pos: kart.pos.clone().setY(kart.pos.y + 0.4), spread: 1.0,
      vel: new THREE.Vector3(0, 0.5, 0), velSpread: 1,
      life: 0.7, size: 0.22, sizeEnd: 0.05, color: '#ff8ae0', alpha: 0.9, gravity: -3,
    });
  }

  private giantBurst(kart: Kart) {
    this.flareRing(kart.pos, '#67c23a', 4.5, 0.6);
    this.particles.spawn({
      count: 20, pos: kart.pos.clone(), spread: 0.8,
      vel: new THREE.Vector3(0, 2.5, 0), velSpread: 5,
      life: 0.6, size: 0.5, sizeEnd: 0.1, color: '#8fe36a', alpha: 0.9, gravity: 6,
    });
  }

  /** GHOST: soft white veil rings + cold sparks (phase-out feel) */
  private ghostVeil(kart: Kart) {
    this.flareRing(kart.pos, '#cfe8ff', 3.4, 0.55);
    this.particles.spawn({
      count: 16, pos: kart.pos.clone().setY(kart.pos.y + 0.5), spread: 0.7,
      vel: new THREE.Vector3(0, 1.2, 0), velSpread: 1.5,
      life: 0.7, size: 0.3, sizeEnd: 0.05, color: '#eaf6ff', alpha: 0.75, gravity: -1.5,
    });
  }

  /** MEGA JUMP: real big hop (leaps over mines/oil/hazards) + dust VFX */
  private megaJump(kart: Kart) {
    if (kart.grounded) kart.vy = 10.2;   // gravity 26 → ~2m apex, ~0.8s air
    this.flareRing(kart.pos, '#ffd54f', 3.0, 0.4);
    this.particles.spawn({
      count: 18, pos: kart.pos.clone(), spread: 0.9,
      vel: new THREE.Vector3(0, 3.5, 0), velSpread: 3,
      life: 0.55, size: 0.4, sizeEnd: 0.08, color: '#ffe9a8', alpha: 0.9, gravity: 7,
    });
  }


  // =====================================================================
  // v3.1 VFX KIT (user: "آیکون نیترو و انیمیشنشو از نو درست کن و جذابش کن",
  // "قدرت مغناطیسی … انیمیشن و عکسشو بهتر کن", "قدرت آهنربا … انیمیشن خفن‌تر")
  // =====================================================================
  /** register a whole object tree for cleanup (geometry + materials) */
  private trackDeep(o: THREE.Object3D) {
    this.temp.push(o);
    o.traverse(c => {
      const m = (c as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) for (const mm of Array.isArray(m) ? m : [m]) this.disposables.push(mm);
      const g = (c as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
      if (g) this.disposables.push(g);
    });
  }
  /** add + animate a temp object; step(k 0..1, t seconds) — auto-removed */
  private fxAnim(o: THREE.Object3D, life: number, step: (k: number, t: number) => void, delay = 0) {
    if (this.dead) return;
    this.scene.add(o);
    this.trackDeep(o);
    o.visible = delay <= 0;
    const t0 = performance.now() / 1000 + delay;
    const tick = () => {
      if (!o.parent) return;
      const t = performance.now() / 1000 - t0;
      if (t < 0) { requestAnimationFrame(tick); return; }
      o.visible = true;
      if (t > life) { this.scene.remove(o); return; }
      step(t / life, t);
      requestAnimationFrame(tick);
    };
    tick();
  }
  private addMat(color: number, opacity = 1): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }
  /** jagged electric arc between two points, flickers (re-jitters) while alive */
  private arcBetween(a: THREE.Vector3, b: THREE.Vector3, color: number, life = 0.35, jitter = 0.7) {
    const segs = 12;
    const pts = Array.from({ length: segs + 1 }, () => new THREE.Vector3());
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(geo, mat);
    const core = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    const g = new THREE.Group(); g.add(line, core);
    let nextJ = 0;
    this.fxAnim(g, life, (k, t) => {
      if (t >= nextJ) {
        nextJ = t + 0.045;
        const pa = geo.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i <= segs; i++) {
          const u = i / segs;
          const env = Math.sin(u * Math.PI) * jitter;
          pa.setXYZ(i,
            a.x + (b.x - a.x) * u + rand(-env, env),
            a.y + (b.y - a.y) * u + rand(-env, env) * 0.6 + Math.sin(u * Math.PI) * 0.4,
            a.z + (b.z - a.z) * u + rand(-env, env));
        }
        pa.needsUpdate = true;
      }
      mat.opacity = 1 - k * 0.8;
      (core.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - k);
    });
  }
  private static texCache = new Map<string, THREE.CanvasTexture>();
  /** canvas texture: jagged electric ring (EMP ground shock) */
  private electricRingTex(): THREE.Texture {
    let tx = ItemSystem.texCache.get('eRing');
    if (tx) return tx;
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d')!;
    c.translate(S / 2, S / 2);
    const glow = c.createRadialGradient(0, 0, S * 0.3, 0, 0, S * 0.5);
    glow.addColorStop(0, 'rgba(180,90,255,0)'); glow.addColorStop(0.8, 'rgba(190,110,255,0.55)'); glow.addColorStop(1, 'rgba(180,90,255,0)');
    c.fillStyle = glow; c.fillRect(-S / 2, -S / 2, S, S);
    for (const [w, col] of [[7, 'rgba(199,125,255,0.9)'], [2.5, '#ffffff']] as const) {
      c.strokeStyle = col; c.lineWidth = w; c.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const r = S * 0.42 + (i % 2 ? 7 : -7) + Math.sin(i * 1.7) * 4;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    tx = new THREE.CanvasTexture(cv);
    ItemSystem.texCache.set('eRing', tx);
    return tx;
  }
  /** canvas texture: spiral vortex (magnet pull) */
  private vortexTex(): THREE.Texture {
    let tx = ItemSystem.texCache.get('vortex');
    if (tx) return tx;
    const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const c = cv.getContext('2d')!;
    c.translate(S / 2, S / 2);
    for (let arm = 0; arm < 4; arm++) {
      c.beginPath();
      for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        const a = arm * Math.PI / 2 + u * Math.PI * 2.2;
        const r = 14 + u * (S * 0.46 - 14);
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.strokeStyle = arm % 2 ? 'rgba(255,90,90,0.95)' : 'rgba(120,200,255,0.95)';
      c.lineWidth = 9; c.lineCap = 'round'; c.stroke();
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2.5; c.stroke();
    }
    const g = c.createRadialGradient(0, 0, 0, 0, 0, S * 0.5);
    g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(-S / 2, -S / 2, S, S);
    tx = new THREE.CanvasTexture(cv);
    ItemSystem.texCache.set('vortex', tx);
    return tx;
  }

  /** 🔥 NITRO v3.1: blue shock cone out of the exhaust, 3 "mach diamond"
   *  rings popping behind the car, a 1.7 s blue-white plasma stream that
   *  FOLLOWS the kart, sparks + a cold screen flash for the driver. */
  private nitroBurst(kart: Kart) {
    const fwd = new THREE.Vector3();
    const rear = () => {
      kart.forward(fwd);
      return kart.pos.clone().addScaledVector(fwd, -1.35).setY(kart.pos.y + 0.45);
    };
    if (kart.isLocal) { screenFlash('#bfe8ff', 0.42, 320); nitroOverlay(2.6); }
    // ignition ring around the car
    this.flareRing(kart.pos, '#5ad0ff', 3.6, 0.4);
    // v3.2 ENERGY WAVE (user: "موج انرژی و رعد اضافه کن، بعد با سرعت خیلی بالا و
    // تأثیر بیشتر"): a big electric shock wave rolls out over the road …
    {
      const wave = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        map: this.electricRingTex(), color: 0x7fd8ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }));
      wave.rotation.x = -Math.PI / 2;
      this.fxAnim(wave, 0.7, (k, t) => {
        wave.position.copy(kart.pos).setY(kart.pos.y + 0.15);
        wave.scale.setScalar(2 + k * 16);
        wave.rotation.z = t * 5;
        (wave.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      });
      // … plus a vertical energy dome that pops and fades
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), this.addMat(0x4fc3ff, 0.45));
      this.fxAnim(dome, 0.45, (k) => {
        dome.position.copy(kart.pos).setY(kart.pos.y + 0.5);
        dome.scale.set(1.5 + k * 5, 0.9 + k * 2.6, 1.5 + k * 5);
        (dome.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - k);
      });
    }
    // … and LIGHTNING: forked bolts crack around the car for the whole burst
    {
      const t0 = performance.now();
      const zap = () => {
        const el = (performance.now() - t0) / 1000;
        if (el > 2.2 || kart.finished || this.dead) return;
        const from = kart.pos.clone().setY(kart.pos.y + 0.6);
        const n = el < 0.35 ? 3 : 1;
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const to = from.clone().add(new THREE.Vector3(Math.cos(a) * (1.6 + Math.random() * 2.2), -0.4 + Math.random() * 1.6, Math.sin(a) * (1.6 + Math.random() * 2.2)));
          this.arcBetween(from, to, Math.random() < 0.5 ? 0x9fe6ff : 0x5ab8ff, 0.12, 0.45);
        }
        setTimeout(zap, el < 0.35 ? 40 : 110 + Math.random() * 90);
      };
      zap();
      // sky bolt striking the car at ignition
      const top = kart.pos.clone().add(new THREE.Vector3(0.6, 9, -1.2));
      this.arcBetween(top, kart.pos.clone().setY(kart.pos.y + 0.8), 0xcff4ff, 0.22, 1.1);
    }
    // shock cone (tip at the exhaust, opening backward)
    const coneGeo = new THREE.ConeGeometry(0.9, 3.4, 22, 1, true);
    coneGeo.translate(0, -1.7, 0);
    const cone = new THREE.Group();
    const outer = new THREE.Mesh(coneGeo, this.addMat(0x3fb8ff, 0.7));
    const inner = new THREE.Mesh(coneGeo, this.addMat(0xffffff, 0.8));
    inner.scale.set(0.45, 0.8, 0.45);
    cone.add(outer, inner);
    this.fxAnim(cone, 0.75, (k) => {
      kart.forward(fwd);
      cone.position.copy(rear());
      // cone axis (local -Y after translate) must point BACKWARD
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), fwd.clone().negate());
      const pop = k < 0.15 ? k / 0.15 : 1;
      cone.scale.set(0.5 + pop * 0.8, 0.4 + pop * (1 + k * 0.8), 0.5 + pop * 0.8);
      (outer.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
      (inner.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k * k);
    });
    // mach diamonds
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.07, 6, 26), this.addMat(i === 0 ? 0xffffff : 0x7fd4ff, 0.95));
      let placed = false;
      this.fxAnim(ring, 0.42, (k) => {
        if (!placed) {
          placed = true;
          kart.forward(fwd);
          ring.position.copy(rear()).addScaledVector(fwd, -0.8 - i * 1.1);
          ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd);
        }
        ring.scale.setScalar(0.6 + k * 2.4);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.95 * (1 - k);
      }, i * 0.07);
    }
    // plasma stream that follows the kart for the burst duration
    if (this.particles) {
      const t0 = performance.now();
      const stream = () => {
        const el = (performance.now() - t0) / 1000;
        if (el > 2.6 || kart.finished) return;
        kart.forward(fwd);
        const p = rear();
        const back = fwd.clone().multiplyScalar(-(6 + Math.abs(kart.speed) * 0.25));
        this.particles.spawn({ count: 3, pos: p, spread: 0.18, vel: back, velSpread: 1.2, life: 0.32, size: 0.42, sizeEnd: 0.05, color: '#bfefff', colorEnd: '#1e7dff', alpha: 0.95, gravity: 0, drag: 2 });
        if (Math.random() < 0.5) this.particles.spawn({ count: 1, pos: p, spread: 0.3, vel: back.clone().multiplyScalar(0.6).setY(1.5), velSpread: 2.5, life: 0.4, size: 0.12, sizeEnd: 0.02, color: '#ffffff', alpha: 1, gravity: 6 });
        requestAnimationFrame(stream);
      };
      stream();
    }
  }

  /** 🧲 MAGNET v3.1 cast: a spinning red/blue spiral vortex slams into the
   *  ground around the car and sparks get SUCKED in from all sides. */
  private magnetSlam(kart: Kart) {
    const disk = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.vortexTex(), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    disk.rotation.x = -Math.PI / 2;
    this.fxAnim(disk, 1.1, (k, t) => {
      disk.position.copy(kart.pos).setY(kart.pos.y + 0.12);
      const sc = k < 0.25 ? 14 - k / 0.25 * 7 : 7 - (k - 0.25) * 4;   // big → snaps in → shrinks
      disk.scale.setScalar(sc);
      disk.rotation.z = -t * 7;
      (disk.material as THREE.MeshBasicMaterial).opacity = k < 0.1 ? k * 10 : 1 - (k - 0.1) / 0.9;
    });
    // converging sparks (each one aimed at the car)
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      const r = 6.5;
      const from = kart.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.6 + Math.random() * 1.6, Math.sin(a) * r));
      const vel = kart.pos.clone().setY(kart.pos.y + 0.8).sub(from).multiplyScalar(1 / 0.45);
      this.particles.spawn({ count: 1, pos: from, spread: 0.1, vel, velSpread: 0.2, life: 0.45, size: 0.26, sizeEnd: 0.06, color: i % 2 ? '#ff6b6b' : '#8fd8ff', colorEnd: '#ffffff', alpha: 1, gravity: 0 });
    }
  }

  // ---- spawners ----
  private rocketGeo(): { geo: THREE.BufferGeometry; mat: THREE.Material } {
    return this.cached('rocket', () => {
      // v1.11 MISSILE BODY upgrade: 10 segments + flat shading + specular so
      // the hull reads as machined metal instead of a flat red cone
      const geo = new THREE.ConeGeometry(0.3, 1.1, 10);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshPhongMaterial({ color: 0xd8322a, emissive: 0x5c0e0e, shininess: 58, specular: 0xff8866, flatShading: true });
      return { geo, mat };
    });
  }
  /** v1.11 GLOWING NOSE (user: "گوش موشک قرمز گرافیکش بره بالا تر"): the
   *  missile tip gets its own additive hot cone + white-hot core bead — the
   *  nose now BURNS instead of ending in flat red plastic. Shared cache. */
  private rocketNose(): { nose: THREE.BufferGeometry; noseMat: THREE.Material; coreGeo: THREE.BufferGeometry; coreMat: THREE.Material; fin: THREE.BufferGeometry; finMat: THREE.Material } {
    return this.cachedSet('rocketNose', () => {
      const nose = new THREE.ConeGeometry(0.17, 0.5, 10);
      nose.rotateX(Math.PI / 2);
      const noseMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.92, blending: THREE.AdditiveBlending, depthWrite: false });
      const coreGeo = new THREE.SphereGeometry(0.085, 8, 6);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xfff3d8, transparent: true, opacity: 0.98, blending: THREE.AdditiveBlending, depthWrite: false });
      const fin = new THREE.BoxGeometry(0.05, 0.3, 0.26);
      const finMat = new THREE.MeshPhongMaterial({ color: 0x2c2f36, shininess: 30 });
      return { nose, noseMat, coreGeo, coreMat, fin, finMat };
    });
  }

  private cachedStore = new Map<string, { geo: THREE.BufferGeometry; mat: THREE.Material }>();
  private cached(key: string, make: () => { geo: THREE.BufferGeometry; mat: THREE.Material }) {
    let v = this.cachedStore.get(key);
    if (!v) { v = make(); this.cachedStore.set(key, v); this.disposables.push(v.geo, v.mat); }
    return v;
  }
  /** generic multi-asset cache (missile nose kit: cone + bead + fins) */
  private cachedKit = new Map<string, Record<string, THREE.BufferGeometry | THREE.Material>>();
  private cachedSet<T extends Record<string, THREE.BufferGeometry | THREE.Material>>(key: string, make: () => T): T {
    let v = this.cachedKit.get(key) as T | undefined;
    if (!v) {
      v = make(); this.cachedKit.set(key, v);
      for (const d of Object.values(v)) this.disposables.push(d);
    }
    return v;
  }
  /** shared-geometry cache for the electric-field meshes (built once, reused) */
  private geoCache = new Map<string, THREE.BufferGeometry>();
  private cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
    let g = this.geoCache.get(key);
    if (!g) { g = make(); this.geoCache.set(key, g); this.disposables.push(g); }
    return g;
  }

  private spawnRocket(owner: Kart, racers: Kart[], backward = false, scale = 1) {
    const pvF = racers.find(r => r.isLocal);
    audio.play('rocketFire', 1, owner.isLocal ? 1 : 0.45, owner.isLocal || !pvF ? 0 : panOf(pvF, owner.pos));
    const { geo, mat } = this.rocketGeo();
    const { nose, noseMat, coreGeo, coreMat, fin, finMat } = this.rocketNose();
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(geo, mat);
    body.scale.setScalar(scale);               // MONSTER MODE: 2x missile
    mesh.add(body);
    // GLOWING RED ORB (user v1.9: "حالتش یه گوی نورانی قرمز باشه"): an
    // additive pulsing plasma core rides the missile — reads as live danger.
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xff2418, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.disposables.push(orbMat);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.34 * scale, 10, 8), orbMat);
    orb.position.z = 0.02 * scale;
    mesh.add(orb);
    // v1.11 HOT NOSE CONE + white-hot tip bead sitting ON the hull's tip
    const noseMesh = new THREE.Mesh(nose, noseMat);
    noseMesh.scale.setScalar(scale);
    noseMesh.position.z = 0.78 * scale;
    mesh.add(noseMesh);
    const tipCore = new THREE.Mesh(coreGeo, coreMat);
    tipCore.scale.setScalar(scale);
    tipCore.position.z = 1.02 * scale;
    mesh.add(tipCore);
    // 3 rear fins (dark metal silhouette — reads at speed)
    for (let i = 0; i < 3; i++) {
      const fm2 = new THREE.Mesh(fin, finMat);
      fm2.scale.setScalar(scale);
      const ang = (i / 3) * Math.PI * 2 + Math.PI / 2;
      fm2.position.set(Math.cos(ang) * 0.22 * scale, Math.sin(ang) * 0.22 * scale, -0.34 * scale);
      fm2.rotation.z = ang + Math.PI / 2;
      mesh.add(fm2);
    }
    // exhaust halo behind the orb
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xff7a3d, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.disposables.push(haloMat);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.52 * scale, 8, 6), haloMat);
    halo.position.z = -0.42 * scale;
    mesh.add(halo);
    mesh.position.copy(owner.pos).add(new THREE.Vector3(0, 0.6, 0));
    // find target: nearest racer AHEAD on track — or, when fired while looking
    // back (eye button held), the nearest racer BEHIND (user request)
    let target: Kart | null = null;
    let bestGap = Infinity;
    const N = this.track.samples.length;
    for (const r of racers) {
      if (r === owner || r.finished) continue;
      const gap = backward
        ? ((owner.trackPos - r.trackPos) + N * 2) % N
        : ((r.trackPos - owner.trackPos) + N * 2) % N;
      if (gap > 0.5 && gap < bestGap) { bestGap = gap; target = r; }
    }
    const cap = target ? Math.max(34, target.pt.vTop * 1.42) : 40;
    const e: Entity = { mesh, kind: 'rocket', owner, life: 16, sIdx: owner.sIdx, target: target ?? undefined, vel: owner.forward(new THREE.Vector3()).clone(), backward, scale, spd: 20, mps: Math.max(22, Math.abs(owner.speed) * 0.9), cap, beepT: 0.25, orb };
    // v3.2 JET FLAME: layered additive cones (orange shell + white-hot core)
    // that flicker every frame + a spinning shock ring = a much meaner missile
    {
      const fl = new THREE.Group();
      const shellGeo = this.cachedGeo('rkFlameShell', () => { const g = new THREE.ConeGeometry(0.26, 1.5, 12, 1, true); g.translate(0, 0.75, 0); g.rotateX(-Math.PI / 2); return g; });
      const coreGeo2 = this.cachedGeo('rkFlameCore', () => { const g = new THREE.ConeGeometry(0.13, 0.9, 10, 1, true); g.translate(0, 0.45, 0); g.rotateX(-Math.PI / 2); return g; });
      const shell = new THREE.Mesh(shellGeo, this.addMat(0xff7a1a, 0.85));
      const core = new THREE.Mesh(coreGeo2, this.addMat(0xfff4d0, 0.95));
      const blue = new THREE.Mesh(coreGeo2, this.addMat(0x62b8ff, 0.55));
      blue.scale.set(1.5, 1.5, 0.45);
      fl.add(shell, core, blue);
      this.disposables.push(shell.material as THREE.Material, core.material as THREE.Material, blue.material as THREE.Material);
      const shock = new THREE.Mesh(this.cachedGeo('rkShock', () => new THREE.TorusGeometry(0.32, 0.035, 6, 20)), this.addMat(0xffd08a, 0.8));
      shock.position.z = -0.9;
      fl.add(shock);
      fl.position.z = -0.5 * scale;
      fl.scale.setScalar(scale);
      mesh.add(fl);
      e.flame = fl;
      // white/red warning stripes on the hull
      const band = new THREE.Mesh(this.cachedGeo('rkBand', () => { const g = new THREE.CylinderGeometry(0.235, 0.235, 0.09, 12); g.rotateX(Math.PI / 2); return g; }), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      band.position.z = 0.12 * scale; band.scale.setScalar(scale);
      this.disposables.push(band.material as THREE.Material);
      mesh.add(band);
    }
    // v1.14 LIVE WHOOSH: the missile owns a looping jet sound whose gain,
    // brightness and stereo pan are driven by its distance to the player —
    // you HEAR it approach and hunt (per-frame update in the rocket case).
    e.audioId = 'rk' + (++this.audioSeq);
    audio.startRocketLoop(e.audioId);
    // v1.13 MISSILE TUNING (user: "سرعتش بالاست، ۷۵٪ خوبه — اولش کم بعد زیاد
    // بشه، مهم نیست هدف چقدر دور باشه شکارش میکنه"): launch is SLOW (20)
    // and spools to 64 (75% of the old 86 cap) — a fair chase the victim can
    // actually react to, while life 11s lets it hunt targets half a map away.
    this.scene.add(mesh);
    this.entities.push(e);
    // cast flare so the backward shot reads instantly
    this.flareRing(owner.pos, backward ? '#ff8a5c' : '#ff5252', 2.6 * scale, 0.35);
  }

  private spawnIce(owner: Kart, racers: Kart[], scale = 1) {
    // v1.13 GLOWING ORB (user: "گوی نورانی با هاله آبی"): the old flat-shaded
    // shard is now a luminous ice orb — white-blue core + additive halo + a
    // cold trail — that reads like a frozen comet chasing its victim.
    const kit = this.cachedSet('iceOrb', () => {
      const coreGeo = new THREE.SphereGeometry(0.3, 14, 10);
      const coreMat = new THREE.MeshBasicMaterial({ color: 0xeaf9ff, transparent: true, opacity: 0.98, blending: THREE.AdditiveBlending, depthWrite: false });
      const haloGeo = new THREE.SphereGeometry(0.52, 14, 10);
      const haloMat = new THREE.MeshBasicMaterial({ color: 0x62c8ff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
      const auraGeo = new THREE.SphereGeometry(0.8, 12, 8);
      const auraMat = new THREE.MeshBasicMaterial({ color: 0x3f9fe8, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
      return { coreGeo, coreMat, haloGeo, haloMat, auraGeo, auraMat };
    });
    const mesh = new THREE.Group();
    const core = new THREE.Mesh(kit.coreGeo, kit.coreMat);
    const halo = new THREE.Mesh(kit.haloGeo, kit.haloMat);
    const aura = new THREE.Mesh(kit.auraGeo, kit.auraMat);
    core.scale.setScalar(scale); halo.scale.setScalar(scale); aura.scale.setScalar(scale);
    mesh.add(aura); mesh.add(halo); mesh.add(core);
    mesh.position.copy(owner.pos).add(new THREE.Vector3(0, 0.8, 0));
    // target = racer directly ahead on track
    let target: Kart | null = null;
    let bestGap = Infinity;
    const N = this.track.samples.length;
    for (const r of racers) {
      if (r === owner || r.finished) continue;
      const gap = ((r.trackPos - owner.trackPos) + N * 2) % N;
      if (gap > 0.5 && gap < bestGap) { bestGap = gap; target = r; }
    }
    const e: Entity = { mesh, kind: 'ice', owner, life: 3.2, sIdx: owner.sIdx, target: target ?? undefined, scale };
    // FIX ("ice does nothing when you're last"): with no target it used to
    // drop straight down and vanish. Now it flies straight ahead as a shard
    // and freezes ANY racer it touches.
    if (!target) {
      e.freeFly = true;
      e.dir = owner.forward(new THREE.Vector3()).clone();
      e.life = 2.4;
    }
    this.scene.add(mesh);
    this.entities.push(e);
  }

  /** MINE (user: bomb → mine): planted BEHIND the kart. Neutral hazard —
   *  explodes under ANY kart (owner included once armed!). Loud warning look:
   *  spiky disc + blinking red beacon + pulsing hazard ring on the ground so
   *  players have time to swerve. */
  private spawnMine(owner: Kart, scale = 1) {
    audio.play('mineArm', 1, owner.isLocal || !this.localKart ? 1 : clamp(1 - owner.pos.distanceTo(this.localKart.pos) / 50, 0.3, 1), owner.isLocal || !this.localKart ? 0 : panOf(this.localKart, owner.pos));
    const g = new THREE.Group();
    g.scale.setScalar(scale);   // MONSTER MODE: 2x mine
    // body: flat dark disc + spikes (cached geos/materials — one GPU set)
    const body = this.cached('mineBody', () => {
      const geo = new THREE.CylinderGeometry(0.55, 0.62, 0.16, 12);
      const mat = new THREE.MeshPhongMaterial({ color: 0x23262c, shininess: 30 });
      return { geo, mat };
    });
    const spike = this.cached('mineSpike', () => {
      const geo = new THREE.ConeGeometry(0.09, 0.3, 5);
      const mat = new THREE.MeshPhongMaterial({ color: 0x4a5058, shininess: 60, emissive: 0x220a06 });
      return { geo, mat };
    });
    const bodyMesh = new THREE.Mesh(body.geo, body.mat);
    bodyMesh.position.y = 0.1;
    g.add(bodyMesh);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const s = new THREE.Mesh(spike.geo, spike.mat);
      s.position.set(Math.cos(a) * 0.52, 0.16, Math.sin(a) * 0.52);
      s.rotation.z = Math.PI / 2;
      s.rotation.y = -a;
      g.add(s);
    }
    // blinking beacon (per-mine material so it blinks independently)
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 1 });
    this.disposables.push(beaconMat);
    const beaconGeo = new THREE.SphereGeometry(0.13, 8, 6);
    this.disposables.push(beaconGeo);
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.position.y = 0.3;
    g.add(beacon);
    // pulsing hazard ring on the ground (readable from distance)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xff5a2a, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    this.disposables.push(ringMat);
    const ringGeo = new THREE.RingGeometry(0.9, 1.15, 20);
    ringGeo.rotateX(-Math.PI / 2);
    this.disposables.push(ringGeo);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.05;
    g.add(ring);
    // place BEHIND the kart, on the road
    const back = owner.forward(new THREE.Vector3()).multiplyScalar(-1.6);
    g.position.copy(owner.pos).add(back).setY(owner.pos.y + 0.02);
    const e: Entity = { mesh: g, kind: 'mine', owner, life: 45, sIdx: owner.sIdx, armed: 1.0, beacon, ring, scale };
    this.scene.add(g);
    this.entities.push(e);
  }

  /** v3 SPRING MINE (user spec): looks like a patch of WOODEN FLOOR planted
   *  behind the kart. It does not explode — when anyone drives over it the
   *  steel spring under the boards fires, the lid flips up and the kart is
   *  catapulted into the air with HEAVY damage. Neutral like the mine: once
   *  armed it catches its owner too. Ghosts pass over, shields absorb it. */
  private spawnSpring(owner: Kart, scale = 1) {
    const [v0, p0] = this.spatial(owner.pos, 50);
    audio.play('mineArm', 0.8, owner.isLocal ? 1 : v0, owner.isLocal ? 0 : p0);
    const g = new THREE.Group();
    g.scale.setScalar(scale);
    const wood = this.cached('springWood', () => ({
      geo: new THREE.BoxGeometry(0.5, 0.09, 1.9),
      mat: new THREE.MeshLambertMaterial({ color: 0xa8743f }),
    }));
    const woodDark = this.cached('springWoodDark', () => ({
      geo: new THREE.BoxGeometry(2.1, 0.07, 2.1),
      mat: new THREE.MeshLambertMaterial({ color: 0x4a3020 }),
    }));
    const iron = this.cached('springIron', () => ({
      geo: new THREE.BoxGeometry(0.16, 0.05, 0.16),
      mat: new THREE.MeshPhongMaterial({ color: 0x9aa3ad, shininess: 70 }),
    }));
    const coilPart = this.cached('springCoil', () => ({
      geo: new THREE.TorusGeometry(0.42, 0.06, 6, 16),
      mat: new THREE.MeshPhongMaterial({ color: 0xc9d1da, shininess: 90, specular: 0xffffff }),
    }));
    // dark frame sunk in the road (the "pit" the plate sits in)
    const frame = new THREE.Mesh(woodDark.geo, woodDark.mat);
    frame.position.y = 0.035;
    frame.receiveShadow = true;
    g.add(frame);
    // coil (hidden, compressed) — grows when the plate fires
    const coil = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(coilPart.geo, coilPart.mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = i * 0.2;
      coil.add(ring);
    }
    coil.position.y = 0.05;
    coil.scale.set(1, 0.05, 1);
    g.add(coil);
    // hinged lid: pivot at the rear edge so it flips up like a trapdoor
    const hinge = new THREE.Group();
    hinge.position.set(0, 0.1, -0.95);
    const lid = new THREE.Group();
    lid.position.z = 0.95;
    const tones = [0xb07a44, 0x9c6a3a, 0xb68250, 0xa3703f];
    for (let i = 0; i < 4; i++) {
      const plank = new THREE.Mesh(wood.geo, i === 0 ? wood.mat : new THREE.MeshLambertMaterial({ color: tones[i] }));
      if (i > 0) this.disposables.push(plank.material as THREE.Material);
      plank.position.set(-0.78 + i * 0.52, 0, 0);
      plank.castShadow = true;
      lid.add(plank);
    }
    for (const [x, z] of [[-0.85, -0.8], [0.85, -0.8], [-0.85, 0.8], [0.85, 0.8], [0, -0.8], [0, 0.8]]) {
      const b = new THREE.Mesh(iron.geo, iron.mat);
      b.position.set(x, 0.06, z);
      lid.add(b);
    }
    hinge.add(lid);
    g.add(hinge);
    const back = owner.forward(new THREE.Vector3()).multiplyScalar(-2.1);
    g.position.copy(owner.pos).add(back).setY(owner.pos.y + 0.01);
    g.rotation.y = owner.heading;
    this.flareRing(g.position, '#d08a45', 2.2, 0.35);
    const e: Entity = { mesh: g, kind: 'spring', owner, life: 45, sIdx: owner.sIdx, armed: 1.0, scale, plank: hinge, coil };
    this.scene.add(g);
    this.entities.push(e);
  }

  private spawnTrap(owner: Kart, scale = 1) {
    const { geo } = this.cached('trap', () => {
      const geo = new THREE.CircleGeometry(1.5, 12);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({ color: 0x23262c, transparent: true, opacity: 0.85 });
      return { geo, mat };
    });
    // per-trap material clone → animated rainbow-ish sheen
    const mat = new THREE.MeshBasicMaterial({ color: 0x23262c, transparent: true, opacity: 0.85 });
    this.disposables.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(scale);   // MONSTER MODE: 2x oil slick
    mesh.position.copy(owner.pos).setY(owner.pos.y + 0.06);
    const e: Entity = { mesh, kind: 'trap', owner, life: 14, sIdx: owner.sIdx, armed: 0.6, mat, scale };
    this.scene.add(mesh);
    this.entities.push(e);
  }

  // ======================================================================
  // v1.21 NEW ITEMS (reference sheet #1/#2/#8): TNT · BANANA PEEL · MINECART
  // Each one: own pickup chime, activation, travel (cart), impact and end cue.
  // Shield absorbs, ghost phases through, monster mode doubles the size.
  // ======================================================================
  private texStore: THREE.Texture[] = [];
  private canvasTex(key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): THREE.Texture | null {
    const k = '__tex_' + key;
    const hit = (this as unknown as Record<string, THREE.Texture | undefined>)[k];
    if (hit) return hit;
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c = cv.getContext('2d');
    if (!c) return null;
    draw(c);
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter;          // crisp voxel pixels
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    (this as unknown as Record<string, THREE.Texture>)[k] = tex;
    this.texStore.push(tex);
    return tex;
  }

  /** local-player relative volume + pan for a world event */
  private spatial(pos: THREE.Vector3, range = 70, isLocalOwner = false): [number, number] {
    const pv = this.localKart;
    if (!pv || isLocalOwner) return [1, 0];
    return [clamp(1.1 - pos.distanceTo(pv.pos) / range, 0.1, 1), panOf(pv, pos)];
  }

  // ---------- 🧨 TNT ----------
  private tntKit() {
    const side = this.canvasTex('tntSide', 32, 32, (c) => {
      // Minecraft TNT: red block, white band with black "TNT", darker stripes
      c.fillStyle = '#c62b1f'; c.fillRect(0, 0, 32, 32);
      for (let x = 0; x < 32; x += 4) { c.fillStyle = x % 8 ? '#a8231a' : '#db3a2c'; c.fillRect(x, 0, 2, 32); }
      c.fillStyle = '#efe9dc'; c.fillRect(0, 11, 32, 10);
      c.fillStyle = '#1b1b1b';
      // pixel font T N T
      const px = (x: number, y: number) => c.fillRect(x, y, 1, 1);
      const T = (ox: number) => { for (let i = 0; i < 5; i++) px(ox + i, 13); for (let j = 13; j < 20; j++) px(ox + 2, j); };
      const Nn = (ox: number) => { for (let j = 13; j < 20; j++) { px(ox, j); px(ox + 4, j); } for (let i = 0; i < 4; i++) px(ox + 1 + i, 14 + i); };
      T(5); Nn(13); T(21);
    });
    const top = this.canvasTex('tntTop', 16, 16, (c) => {
      c.fillStyle = '#d9d2c2'; c.fillRect(0, 0, 16, 16);
      c.fillStyle = '#c62b1f'; c.fillRect(0, 0, 16, 3); c.fillRect(0, 13, 16, 3);
      c.fillStyle = '#3b3b3b'; c.fillRect(6, 6, 4, 4);
    });
    return this.cachedSet('tntKit', () => {
      const geo = new THREE.BoxGeometry(1.1, 1.1, 1.1);
      const sideMat = new THREE.MeshStandardMaterial({ map: side ?? undefined, color: side ? 0xffffff : 0xc62b1f, roughness: 0.75, metalness: 0 });
      const topMat = new THREE.MeshStandardMaterial({ map: top ?? undefined, color: top ? 0xffffff : 0xd9d2c2, roughness: 0.8 });
      const fuseGeo = new THREE.BoxGeometry(0.1, 0.34, 0.1);
      const fuseMat = new THREE.MeshStandardMaterial({ color: 0x6b5b45, roughness: 1 });
      const sparkGeo = new THREE.SphereGeometry(0.11, 8, 6);
      const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
      const flashGeo = new THREE.BoxGeometry(1.14, 1.14, 1.14);
      return { geo, sideMat, topMat, fuseGeo, fuseMat, sparkGeo, sparkMat, flashGeo };
    });
  }

  private spawnTnt(owner: Kart, scale = 1) {
    const kit = this.tntKit();
    const g = new THREE.Group();
    // box material order: +x -x +y -y +z -z
    const box = new THREE.Mesh(kit.geo, [kit.sideMat, kit.sideMat, kit.topMat, kit.topMat, kit.sideMat, kit.sideMat] as THREE.Material[]);
    box.position.y = 0.55;
    box.castShadow = true;
    g.add(box);
    const fuse = new THREE.Mesh(kit.fuseGeo, kit.fuseMat);
    fuse.position.y = 1.25;
    g.add(fuse);
    const spark = new THREE.Mesh(kit.sparkGeo, kit.sparkMat);
    spark.position.y = 1.44;
    g.add(spark);
    // white "about to blow" blink overlay (Minecraft primed-TNT flashing)
    const flash = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    this.disposables.push(flash);
    const fl = new THREE.Mesh(kit.flashGeo, flash);
    fl.position.y = 0.55;
    g.add(fl);
    g.scale.setScalar(scale);
    const back = owner.forward(new THREE.Vector3()).multiplyScalar(-2.0 * scale);
    g.position.copy(owner.pos).add(back).setY(owner.pos.y + 0.02);
    g.rotation.y = owner.heading;
    this.scene.add(g);
    // v3.4 (user: "تی ان تی وقتی من میندازم درحال روشن شدن باشه، وقتی یه ماشین
    // بهش میرسه منفجر بشه"): the TNT is now a LIT PROXIMITY TRAP. The fuse keeps
    // burning (sparks + hiss) and it only goes off when a car reaches it. It
    // blinks faster the closer a car gets (anticipation!). Safety net: after
    // 22s nobody came -> it blows on its own so the road never clogs.
    const e: Entity = { mesh: g, kind: 'tnt', owner, life: 22, sIdx: owner.sIdx, armed: 0.45, immuneT: 0.9, scale, flash, fuseSpark: spark, fuseSfxT: 2.6 };
    this.entities.push(e);
    const [v, pan] = this.spatial(g.position, 60, owner.isLocal);
    audio.play('tntPlace', 1, v, pan);
    audio.play('tntFuse', 1, v * 0.9, pan);
  }

  /** the TNT goes off: layered explosion, big radius, knock-up, 1.5 hearts */
  private tntBlast(e: Entity, racers: Kart[]) {
    const pos = e.mesh.position.clone();
    const sc = e.scale ?? 1;
    const R = 6.2 * sc;
    const [v, pan] = this.spatial(pos, 110);
    audio.impact(clamp(v, 0.35, 1), 'tnt', pan);
    audio.play('bomb', 0.8, v * 0.8, pan);
    this.shakeReq = Math.max(this.shakeReq, this.localKart ? clamp(0.8 - pos.distanceTo(this.localKart.pos) / 60, 0.1, 0.8) : 0.4);
    screenFlash('#ffd9a0', this.localKart && pos.distanceTo(this.localKart.pos) < 25 ? 0.45 : 0.15, 180);
    // blocky Minecraft blast: voxel debris + fire + smoke + shock rings
    this.debris.burst(pos.clone().setY(pos.y + 0.6), 30, '#c62b1f', 11, 0.32);
    this.debris.burst(pos.clone().setY(pos.y + 0.6), 14, '#efe9dc', 9, 0.26);
    this.particles.spawn({ count: 30, pos: pos.clone().setY(pos.y + 0.6), spread: 1.2, vel: new THREE.Vector3(0, 5, 0), velSpread: 9,
      life: 0.75, size: 1.3, sizeEnd: 0.2, color: '#ffb23d', alpha: 0.95, gravity: 4 });
    this.particles.spawn({ count: 18, pos: pos.clone().setY(pos.y + 1.0), spread: 1.6, vel: new THREE.Vector3(0, 2.5, 0), velSpread: 3,
      life: 1.4, size: 1.2, sizeEnd: 2.6, color: '#4a4a4a', alpha: 0.6, gravity: -1.2 });
    this.flareRing(pos, '#ffcf6a', R * 1.4, 0.45);
    this.flareRing(pos, '#ff5a2a', R * 0.9, 0.3);
    for (const r of racers) {
      if (r.finished) continue;
      const d = r.pos.distanceTo(pos);
      if (d > R) continue;
      const k = 1 - d / R;
      if (r.spinOut(1.1 + k * 0.5)) {
        this.onHit?.(r, 'tnt');
        r.damage(k > 0.45 ? 3 : 2);
        if (r.grounded) { r.vy = 6 + k * 5; r.grounded = false; }
        const side = Math.sign((r.pos.x - pos.x) * Math.cos(r.heading) - (r.pos.z - pos.z) * Math.sin(r.heading)) || 1;
        r.slide += side * (1.5 + k * 2.5);
      }
    }
    // chain reaction: other TNT / mines inside the blast go off too
    for (const o of this.entities) {
      if (o === e) continue;
      if (o.kind === 'tnt' && o.mesh.position.distanceTo(pos) < R * 0.8) o.life = Math.min(o.life, 0.12);
    }
  }

  // ---------- 🍌 BANANA PEEL ----------
  private bananaKit() {
    return this.cachedSet('bananaKit', () => {
      const peel = new THREE.MeshStandardMaterial({ color: 0xffd93a, roughness: 0.55, emissive: 0x3a2a00, emissiveIntensity: 0.25 });
      const inner = new THREE.MeshStandardMaterial({ color: 0xfff3b0, roughness: 0.7 });
      const tip = new THREE.MeshStandardMaterial({ color: 0x5a3a14, roughness: 0.9 });
      const flapGeo = new THREE.BoxGeometry(0.22, 0.08, 0.62);
      const stemGeo = new THREE.BoxGeometry(0.24, 0.5, 0.24);
      const tipGeo = new THREE.BoxGeometry(0.12, 0.14, 0.12);
      return { peel, inner, tip, flapGeo, stemGeo, tipGeo };
    });
  }

  private spawnBanana(owner: Kart, scale = 1) {
    const kit = this.bananaKit();
    const g = new THREE.Group();
    const stem = new THREE.Mesh(kit.stemGeo, kit.peel);
    stem.position.y = 0.3;
    g.add(stem);
    const tip = new THREE.Mesh(kit.tipGeo, kit.tip);
    tip.position.y = 0.6;
    g.add(tip);
    // 4 blocky peel flaps flopped open around the stem
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const f = new THREE.Group();
      const outer = new THREE.Mesh(kit.flapGeo, kit.peel);
      const inn = new THREE.Mesh(kit.flapGeo, kit.inner);
      inn.scale.set(0.7, 0.6, 0.85); inn.position.y = 0.05;
      outer.position.z = 0.3; inn.position.z = 0.3;
      f.add(outer); f.add(inn);
      f.position.y = 0.1;
      f.rotation.set(-0.35, a, 0);
      g.add(f);
    }
    g.scale.setScalar(1.3 * scale);
    const back = owner.forward(new THREE.Vector3()).multiplyScalar(-1.7 * scale);
    g.position.copy(owner.pos).add(back).setY(owner.pos.y + 0.02);
    this.scene.add(g);
    this.entities.push({ mesh: g, kind: 'banana', owner, life: 40, sIdx: owner.sIdx, armed: 0.25, immuneT: 1.2, scale });
    const [v, pan] = this.spatial(g.position, 45, owner.isLocal);
    audio.play('bananaDrop', 1, v, pan);
  }

  // ---------- 🛒 MINECART ----------
  private cartKit() {
    const face = this.canvasTex('cartFace', 16, 16, (c) => {
      c.fillStyle = '#8f979f'; c.fillRect(0, 0, 16, 16);
      for (let i = 0; i < 26; i++) { c.fillStyle = Math.random() < 0.5 ? '#7d858d' : '#a3abb3'; c.fillRect((i * 7) % 16, (i * 5) % 16, 1, 1); }
      c.fillStyle = '#3fae3a';                         // creeper face plate
      c.fillRect(3, 3, 10, 10);
      c.fillStyle = '#10300f';
      c.fillRect(4, 5, 3, 3); c.fillRect(9, 5, 3, 3); c.fillRect(7, 8, 2, 3); c.fillRect(6, 9, 1, 3); c.fillRect(9, 9, 1, 3);
    });
    return this.cachedSet('cartKit', () => {
      const iron = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.38, metalness: 0.75 });
      const dark = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.7, metalness: 0.3 });
      const faceMat = new THREE.MeshStandardMaterial({ map: face ?? undefined, color: face ? 0xffffff : 0x3fae3a, roughness: 0.45, metalness: 0.5 });
      const wood = new THREE.MeshStandardMaterial({ color: 0x7a5530, roughness: 0.9 });
      const rail = new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: 0.3, metalness: 0.85 });
      const floor = new THREE.BoxGeometry(1.5, 0.14, 2.0);
      const wallL = new THREE.BoxGeometry(0.14, 0.7, 2.0);
      const wallF = new THREE.BoxGeometry(1.5, 0.7, 0.14);
      const wheel = new THREE.BoxGeometry(0.16, 0.42, 0.42);
      const sleeper = new THREE.BoxGeometry(2.2, 0.08, 0.34);
      const railBar = new THREE.BoxGeometry(0.1, 0.1, 1.2);
      return { iron, dark, faceMat, wood, rail, floor, wallL, wallF, wheel, sleeper, railBar };
    });
  }

  private spawnMinecart(owner: Kart, racers: Kart[], scale = 1) {
    const kit = this.cartKit();
    const g = new THREE.Group();
    const body = new THREE.Group();
    const fl = new THREE.Mesh(kit.floor, kit.dark); fl.position.y = 0.4; body.add(fl);
    for (const sx of [-1, 1]) { const w = new THREE.Mesh(kit.wallL, kit.iron); w.position.set(sx * 0.68, 0.78, 0); w.castShadow = true; body.add(w); }
    const front = new THREE.Mesh(kit.wallF, kit.faceMat); front.position.set(0, 0.78, 0.93); body.add(front);
    const rear = new THREE.Mesh(kit.wallF, kit.iron); rear.position.set(0, 0.78, -0.93); body.add(rear);
    // coal load (it's a runaway mining cart)
    const coal = new THREE.Mesh(kit.floor, kit.dark); coal.scale.set(0.8, 2.2, 0.85); coal.position.y = 0.72; body.add(coal);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const wh = new THREE.Mesh(kit.wheel, kit.dark); wh.position.set(sx * 0.62, 0.22, sz * 0.6); body.add(wh);
    }
    g.add(body);
    g.scale.setScalar(1.15 * scale);
    const N = this.track.samples.length;
    const startIdx = (owner.sIdx + 3) % N;
    const s0 = this.track.samples[startIdx];
    const lane0 = clamp((owner.pos.x - s0.pos.x) * s0.left.x + (owner.pos.z - s0.pos.z) * s0.left.z, -s0.width / 2, s0.width / 2);
    g.position.copy(s0.pos).addScaledVector(s0.left, lane0);
    // target: nearest racer AHEAD (like the reference: "runs over the nearest racer")
    let target: Kart | null = null;
    let bestGap = Infinity;
    for (const r of racers) {
      if (r === owner || r.finished) continue;
      const gap = ((r.trackPos - owner.trackPos) + N * 2) % N;
      if (gap > 0.5 && gap < N * 0.6 && gap < bestGap) { bestGap = gap; target = r; }
    }
    const e: Entity = { mesh: g, kind: 'cart', owner, life: 7.5, sIdx: startIdx, target: target ?? undefined, scale,
      spd: Math.max(owner.speed + 8, 24), advance: 0, lane: lane0, clackT: 0, railT: 0, hitSet: new Set([owner]) };
    this.scene.add(g);
    this.entities.push(e);
    const [v, pan] = this.spatial(g.position, 70, owner.isLocal);
    audio.play('minecartLaunch', 1, v, pan);
    this.flareRing(g.position, '#c9d1d9', 2.8 * scale, 0.35);
  }

  /** short-lived rail pieces laid under the cart as it rolls (pooled) */
  private rails: { obj: THREE.Group; t: number }[] = [];
  private dropRail(pos: THREE.Vector3, heading: number) {
    const kit = this.cartKit();
    let slot = this.rails.find(r => r.t <= 0);
    if (!slot) {
      if (this.rails.length >= 28) slot = this.rails.reduce((a, b) => (a.t < b.t ? a : b));
      else {
        const obj = new THREE.Group();
        const sl = new THREE.Mesh(kit.sleeper, kit.wood); obj.add(sl);
        for (const sx of [-0.6, 0.6]) { const rb = new THREE.Mesh(kit.railBar, kit.rail); rb.position.set(sx, 0.08, 0); obj.add(rb); }
        this.scene.add(obj);
        this.temp.push(obj);
        slot = { obj, t: 0 };
        this.rails.push(slot);
      }
    }
    slot.t = 1.6;
    slot.obj.visible = true;
    slot.obj.position.copy(pos).setY(pos.y + 0.04);
    slot.obj.rotation.set(0, heading, 0);
    slot.obj.scale.setScalar(1);
  }
  private updateRails(dt: number) {
    for (const r of this.rails) {
      if (r.t <= 0) continue;
      r.t -= dt;
      if (r.t < 0.4) r.obj.scale.setScalar(Math.max(0.01, r.t / 0.4));
      if (r.t <= 0) r.obj.visible = false;
    }
  }

  /** the cart slams into a kart: launched + thrown sideways off the line */
  private cartHit(e: Entity, r: Kart): boolean {
    const [v, pan] = this.spatial(r.pos, 80);
    if (r.ghostT > 0) {
      this.particles.spawn({ count: 6, pos: r.pos.clone().setY(r.pos.y + 0.6), spread: 0.4, vel: new THREE.Vector3(0, 1, 0), velSpread: 1.2,
        life: 0.4, size: 0.3, sizeEnd: 0.05, color: '#cfe8ff', alpha: 0.7, gravity: -2 });
      return false;                                // phased straight through
    }
    const shielded = r.shieldT > 0;
    audio.play('minecartHit', 1, v, pan);
    audio.impact(clamp(v, 0.3, 1), 'metal', pan);
    this.debris.burst(e.mesh.position.clone().setY(e.mesh.position.y + 0.8), 18, '#9aa3ab', 9, 0.26);
    this.debris.burst(e.mesh.position.clone().setY(e.mesh.position.y + 0.8), 8, '#2c3036', 7, 0.2);
    if (r.spinOut(1.4)) {
      this.onHit?.(r, 'minecart');
      r.damage(3);
      if (r.grounded) { r.vy = 9.5; r.grounded = false; }
      const s = this.track.samples[r.sIdx] ?? this.track.samples[e.sIdx];
      const lat = (r.pos.x - s.pos.x) * s.left.x + (r.pos.z - s.pos.z) * s.left.z;
      r.slide += (lat >= (e.lane ?? 0) ? 1 : -1) * 4.2;   // thrown toward the verge
      r.speed *= 0.55;
      if (r.isLocal) this.shakeReq = Math.max(this.shakeReq, 0.75);
    } else if (shielded) {
      this.flareRing(r.pos, '#5ad0ff', 3.2, 0.4);
    }
    return true;                                   // the cart is wrecked
  }

  /** BLUE LIGHTNING STORM (v1.10 full rework — user spec):
   *  "قدرت رعد و برق رنگ آبی داشته باشه • برای هدفش اولین کاربر هست • داخل
   *  مسیر جلوی کاربر ۳ میدان بزرگ الکتریکی تشکیل میشه که محدودیت زمان دارن •
   *  وقتی کاربری بهشون میخوره همونی که خورده ناپدید میشه و دمیج بالایی داره •
   *  دونه دونه، یک دو سه، با صدای خفن رعد و برق و لرزش زمین"
   *
   *  → targets the current LEADER, drops THREE big time-limited electric
   *  fields along their path ahead (one by one — 1… 2… 3… — each with a
   *  cinematic thunder crack + camera/ground shake). ANY kart that drives
   *  into a field takes HUGE damage and THAT field discharges and vanishes.
   *  Ghost karts phase through untouched. */
  private zapLightning(owner: Kart, racers: Kart[], scale = 1) {
    const pv = racers.find(r => r.isLocal);
    const vol = owner.isLocal || !pv ? 1 : clamp(1 - owner.pos.distanceTo(pv.pos) / 90, 0.15, 0.8);
    // cast moment: blue sky flash + first thunder + caster ring
    screenFlash('#bfe8ff', 0.5, 190);
    audio.play('thunder', 1, vol, pv ? panOf(pv, owner.pos) : 0);
    this.shakeReq = Math.max(this.shakeReq, owner.isLocal ? 0.5 : 0.22);
    this.flareRing(owner.pos, '#4fc3ff', 6.5, 0.5);
    // TARGET = the current leader (user: "برای هدفش اولین کاربر هست")
    let leader: Kart | null = null;
    for (const r of racers) {
      if (r.finished) continue;
      if (!leader || r.trackPos > leader.trackPos) leader = r;
    }
    const tgt = leader ?? owner;
    const N = this.track.samples.length;
    const sm = this.track.length / N;                      // meters per sample
    const baseIdx = ((Math.round(tgt.trackPos) % N) + N) % N;
    // THREE zones ahead of the leader along THEIR path: ~35m, ~80m, ~125m
    const dists = [35, 80, 125];
    for (let i = 0; i < 3; i++) {
      const sIdx = (baseIdx + Math.round(dists[i] / sm)) % N;
      this.pendingFields.push({ t: 0.4 + i * 0.6, sIdx, owner, scale });
    }
  }

  /** queued field spawns (the "one by one — 1 2 3" timing) */
  private pendingFields: { t: number; sIdx: number; owner: Kart; scale: number }[] = [];

  /** process the pending field spawns (called every fixed tick from update) */
  private updatePendingFields(dt: number, racers: Kart[]) {
    for (let i = this.pendingFields.length - 1; i >= 0; i--) {
      const f = this.pendingFields[i];
      f.t -= dt;
      if (f.t > 0) continue;
      this.pendingFields.splice(i, 1);
      this.spawnField(f.sIdx, f.owner, f.scale, racers);
    }
  }

  /** materialize ONE giant electric field on the road (with its own thunder) */
  private spawnField(sIdx: number, owner: Kart, scale: number, racers: Kart[]) {
    const s = this.track.samples[sIdx];
    const laneJitter = rand(-0.22, 0.22);           // slightly off-center: a fast line CAN dodge
    const anchor = s.pos.clone().addScaledVector(s.left, laneJitter * s.width).setY(s.pos.y + 0.12);
    const R = 7.4 * scale;                          // BIG field (monster mode: giant)
    const group = new THREE.Group();
    group.position.copy(anchor);
    const mats: THREE.MeshBasicMaterial[] = [];
    const addMat = (m: THREE.MeshBasicMaterial) => { mats.push(m); this.disposables.push(m); return m; };
    // --- dome: half-sphere of crackling blue light ---
    const domeGeo = this.cachedGeo('efdome', () => new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2));
    const domeMat = addMat(new THREE.MeshBasicMaterial({ color: 0x3fa9ff, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.scale.set(R, R * 0.88, R);
    group.add(dome);
    // --- inner core column: bright center pillar ---
    const coreGeo = this.cachedGeo('efcore', () => new THREE.CylinderGeometry(0.5, 1.05, 5.2, 8, 1, true));
    const coreMat = addMat(new THREE.MeshBasicMaterial({ color: 0xaee6ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.y = 2.5;
    group.add(core);
    // --- 3 tilted arc rings spinning at different speeds (electric cage) ---
    const arcs: THREE.Mesh[] = [];
    const arcGeo = this.cachedGeo('efarc', () => new THREE.TorusGeometry(1, 0.055, 5, 26));
    for (let a = 0; a < 3; a++) {
      const am = addMat(new THREE.MeshBasicMaterial({ color: a === 1 ? 0xd6f2ff : 0x66c8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const arc = new THREE.Mesh(arcGeo, am);
      arc.scale.setScalar(R * (0.72 + a * 0.16));
      arc.rotation.set(Math.PI / 2 + (a - 1) * 0.42, a * 2.1, 0);
      group.add(arc);
      arcs.push(arc);
    }
    // --- ground warning ring (readability: DANGER zone on the asphalt) ---
    const ringGeo = this.cachedGeo('efring', () => new THREE.TorusGeometry(1, 0.09, 5, 34));
    const ringMat = addMat(new THREE.MeshBasicMaterial({ color: 0x2f9fe8, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(R);
    ring.position.y = 0.25;
    group.add(ring);
    this.scene.add(group);
    // spawn effects: thunder crack + flash + GROUND SHAKE (user: "یک دو سه با
    // صدای خفن رعد و برق و لرزش زمین")
    const pv = racers.find(r => r.isLocal);
    const vol = !pv ? 1 : clamp(1.15 - anchor.distanceTo(pv.pos) / 130, 0.25, 1);
    audio.play('thunder', 0.92, vol, pv ? panOf(pv, anchor) : 0);
    this.lightningBolt(anchor, false);
    this.shakeReq = Math.max(this.shakeReq, pv ? clamp(0.62 - anchor.distanceTo(pv.pos) / 90, 0.12, 0.62) : 0.3);
    screenFlash('#9fd8ff', 0.3, 150);
    this.debris.burst(anchor.clone().setY(anchor.y + 0.6), 10, '#7fd4ff', 7, 0.2);
    // life: TIME-LIMITED (user: "محدودیت زمان دارن") — 12s then it fades away
    const e: Entity = {
      mesh: group, kind: 'efield', owner, life: 12, sIdx,
      radius: R, mats, arcs, fieldPos: anchor, beepT: 0.2,
      domeMat, coreMat, ringMat,
    };
    this.entities.push(e);
  }

  /** a kart drove into an electric field: HUGE damage + that field vanishes */
  private fieldDischarge(victim: Kart, e: Entity, idx: number) {
    audio.play('zapHit', 1, victim.isLocal ? 1 : 0.55, this.localKart ? panOf(this.localKart, victim.pos) : 0);
    // HUGE damage (user: "دمیج بالای داره") — 3 half-hearts = 1.5 full hearts
    // v1.21: shield / ghost = NO damage (spec) — the field still discharges
    if (victim.spinOut(1.2)) { this.onHit?.(victim, 'lightning'); victim.damage(3); victim.speed *= 0.5; }
    this.lightningBolt(victim.pos, false);
    this.particles.spawn({
      count: 24, pos: e.fieldPos!.clone().setY(e.fieldPos!.y + 0.8), spread: 1.2,
      vel: new THREE.Vector3(0, 3, 0), velSpread: 6,
      life: 0.6, size: 0.5, sizeEnd: 0.06, color: '#7fd4ff', alpha: 0.95, gravity: 4,
    });
    this.debris.burst(victim.pos.clone().setY(victim.pos.y + 0.8), 14, '#aee6ff', 8, 0.22);
    this.flareRing(e.fieldPos!, '#4fc3ff', e.radius! * 0.9, 0.5);
    screenFlash('#9fd8ff', 0.42, 170);
    if (victim.isLocal) this.shakeReq = Math.max(this.shakeReq, 0.7);
    // only THE FIELD THAT WAS HIT disappears (user: "همونی که کاربر بهش خورده
    // ناپدید میشه") — the other zones keep crackling until their timer ends
    this.scene.remove(e.mesh);
    this.entities.splice(idx, 1);
  }


  /** 💥 EMP v3.1 shock visuals: charge core → violet energy DOME expanding to
   *  the real blast radius (fresnel + crawling electric bands shader) +
   *  spinning jagged ground ring + radial arcs. Pure visuals: the gameplay
   *  radius is unchanged. */
  private empShockFx(owner: Kart, blastR: number) {
    const o = owner.pos.clone();
    // charge core
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), this.addMat(0xf2e2ff, 1));
    this.fxAnim(core, 0.5, (k) => {
      core.position.copy(owner.pos).setY(owner.pos.y + 0.8);
      const sc = k < 0.3 ? 0.4 + (k / 0.3) * 1.6 : 2 + (k - 0.3) * 6;
      core.scale.setScalar(sc);
      (core.material as THREE.MeshBasicMaterial).opacity = k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
    });
    // energy dome
    const domeMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uA: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vP = position; vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uT; uniform float uA; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          float fres = pow(1.0 - abs(dot(vN, vV)), 2.0);
          float ang = atan(vP.z, vP.x);
          float bands = smoothstep(0.82, 1.0, sin(ang*18.0 + vP.y*9.0 - uT*22.0)) * 0.8
                      + smoothstep(0.9, 1.0, sin(vP.y*26.0 + uT*30.0 + sin(ang*7.0)*2.0)) * 0.6;
          vec3 col = mix(vec3(0.55,0.25,1.0), vec3(0.9,0.8,1.0), bands);
          float a = (fres*0.9 + bands*0.55 + 0.06) * uA;
          gl_FragColor = vec4(col, a);
        }`,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 18, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    this.fxAnim(dome, 0.7, (k, t) => {
      dome.position.copy(o).setY(o.y + 0.05);
      const e = 1 - Math.pow(1 - Math.min(1, k / 0.6), 3);
      dome.scale.set(blastR * e + 0.5, (blastR * e + 0.5) * 0.55, blastR * e + 0.5);
      domeMat.uniforms.uT.value = t;
      domeMat.uniforms.uA.value = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
    }, 0.12);
    // jagged ground ring
    const gr = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({
      map: this.electricRingTex(), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    gr.rotation.x = -Math.PI / 2;
    this.fxAnim(gr, 0.8, (k, t) => {
      gr.position.copy(o).setY(o.y + 0.15);
      gr.scale.setScalar(0.5 + blastR * (1 - Math.pow(1 - k, 2.4)));
      gr.rotation.z = t * 4;
      (gr.material as THREE.MeshBasicMaterial).opacity = 1 - k * k;
    }, 0.1);
    // radial arcs crackling out to the edge of the blast
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + rand(-0.3, 0.3);
      const to = o.clone().add(new THREE.Vector3(Math.cos(a) * blastR * 0.9, 0.3, Math.sin(a) * blastR * 0.9));
      const from = o.clone().setY(o.y + 0.8);
      setTimeout(() => this.arcBetween(from, to, i % 2 ? 0xc77dff : 0x9fd8ff, 0.28, 1.1), 90 + i * 25);
    }
  }

  /** v1.13 EMP REWORK (user: "پالس الکترومغناتیسی بنفش — ماشین بقیه خاموش بشه،
   *  اگه سپر یا روح دارن تاثیر نداشته باشه، افکت الکتریسیته داشته باشه"):
   *  a PURPLE electromagnetic burst that STALLS the engines of every kart in
   *  range — full engine shutdown (they coast to a stop and restart after a
   *  few seconds). Shielded/ghost karts are COMPLETELY unaffected (the shield
   *  is NOT consumed). It also fries any missile inside the blast — one of the
   *  four counterplays against a homing rocket (mine/EMP/ghost/shield). */
  private zapEmp(owner: Kart, racers: Kart[], scale = 1) {
    const pv = racers.find(r => r.isLocal);
    audio.play('emp', 1, owner.isLocal || !pv ? 1 : clamp(1 - owner.pos.distanceTo(pv.pos) / 70, 0.12, 0.8), owner.isLocal || !pv ? 0 : panOf(pv, owner.pos));
    screenFlash('#d9a8ff', 0.38, 170);
    const blastR = 9 * (1 + (scale - 1) * 0.8);   // MONSTER MODE: ~16m shockwave
    this.empShockFx(owner, blastR);
    // double expanding ring VFX (better shockwave feel)
    for (const delay of [0, 0.14]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.15, 6, 24),
        new THREE.MeshBasicMaterial({ color: 0xb45aff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.copy(owner.pos).setY(owner.pos.y + 0.4);
      this.scene.add(ring);
      this.trackTemp(ring);
      const startT = performance.now() / 1000 + delay;
      const anim = () => {
        const t = (performance.now() / 1000) - startT;
        if (!ring.parent || t > 0.6) { this.scene.remove(ring); return; }
        if (t < 0) { requestAnimationFrame(anim); return; }
        ring.scale.setScalar(1 + t * 22);
        (ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t / 0.6);
        requestAnimationFrame(anim);
      };
      anim();
    }
    // ELECTRIC EFFECT (user: "افکت الکتریسیته برقی داشته باشه"): purple arc
    // strands crackle out of the pulse core in every direction
    for (let i = 0; i < 3; i++) {
      const off = new THREE.Vector3(rand(-2, 2), 0.4, rand(-2, 2));
      this.lightningBolt(owner.pos.clone().add(off), true, 0xc77dff);
    }
    this.debris.burst(owner.pos.clone().setY(owner.pos.y + 0.5), 10, '#d29aff', 8, 0.2);
    // 💥 STALL ENGINES (the actual EMP effect — engine DEAD, not just slowed)
    for (const r of racers) {
      if (r === owner) continue;
      const d = r.pos.distanceTo(owner.pos);
      if (d < blastR) {
        if (r.stall(2.2)) {
          this.onHit?.(r, 'emp');
          // victim zap: purple strands + sparks around the dead engine
          this.lightningBolt(r.pos.clone().setY(r.pos.y + 0.4), true, 0xc77dff);
          // v3.1: a live arc JUMPS from the caster to every victim
          this.arcBetween(owner.pos.clone().setY(owner.pos.y + 0.9), r.pos.clone().setY(r.pos.y + 0.8), 0xc77dff, 0.45, 0.9);
          this.particles.spawn({
            count: 16, pos: r.pos.clone().setY(r.pos.y + 0.7), spread: 0.8,
            vel: new THREE.Vector3(0, 2, 0), velSpread: 3,
            life: 0.55, size: 0.3, sizeEnd: 0.05, color: '#c77dff', alpha: 0.95, gravity: 3,
          });
        }
      }
    }
    // 🔌 FRIES INCOMING MISSILES (user: the EMP must also be able to DEFLECT
    // the red orb — the pulse burns out the missile's guidance)
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.kind !== 'rocket' || e.deflected) continue;
      if (e.mesh.position.distanceTo(owner.pos) < blastR) {
        this.lightningBolt(e.mesh.position.clone(), true, 0xc77dff);
        this.particles.spawn({
          count: 12, pos: e.mesh.position.clone(), spread: 0.4,
          vel: new THREE.Vector3(0, 1.5, 0), velSpread: 2.5,
          life: 0.5, size: 0.32, sizeEnd: 0.05, color: '#d29aff', alpha: 0.95, gravity: 2,
        });
        this.scene.remove(e.mesh);
        this.entities.splice(i, 1);
        audio.play('zapHit', 1, pv ? clamp(1 - pv.pos.distanceTo(e.mesh.position) / 80, 0.2, 0.9) : 0.6, pv ? panOf(pv, e.mesh.position) : 0);
      }
    }
  }

  /** procedural lightning bolt VFX at position — 3 jittered strands + additive
   *  glow so the zap actually reads on a bright sky. v1.10: BLUE (the storm
   *  color) + optional `small` variant for the crackling mini-bolts inside
   *  electric fields. v1.13: `color` override — the EMP burns PURPLE. */
  private lightningBolt(pos: THREE.Vector3, small = false, color = 0x5ec1ff) {
    const h = small ? 8 : 18;
    for (let strand = 0; strand < 3; strand++) {
      const pts: THREE.Vector3[] = [];
      const top = pos.clone().add(new THREE.Vector3(rand(-2, 2) + strand * 0.4, h, rand(-2, 2)));
      const segs = small ? 5 : 7;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const p = top.clone().lerp(pos.clone().setY(pos.y + 0.5), t);
        if (i > 0 && i < segs) p.add(new THREE.Vector3(rand(-1.4, 1.4), 0, rand(-1.4, 1.4)));
        pts.push(p);
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: strand === 0 ? new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55).getHex() : color,
        transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const line = new THREE.Line(geo, mat);
      this.scene.add(line);
      this.disposables.push(geo, mat);
      const t0 = performance.now() + strand * 40;
      const anim = () => {
        const dt = performance.now() - t0;
        if (dt < 0) { requestAnimationFrame(anim); return; }
        if (dt > 260) { this.scene.remove(line); return; }
        mat.opacity = 1 - dt / 260;
        requestAnimationFrame(anim);
      };
      anim();
    }
  }

  explosion(pos: THREE.Vector3, radius: number, owner: Kart | null, racers: Kart[], src: ItemId = 'mine') {
    const pv = racers.find(r => r.isLocal);
    audio.play('bomb', 1, pv ? clamp(1.2 - pv.pos.distanceTo(pos) / 95, 0.2, 1) : 1, pv ? panOf(pv, pos) : 0);
    this.debris.burst(pos.clone().setY(pos.y + 0.5), 22, '#ff9a3d', 9, 0.3);
    this.particles.spawn({
      count: 26, pos, spread: 0.8, vel: new THREE.Vector3(0, 4, 0), velSpread: 7,
      life: 0.7, size: 0.9, sizeEnd: 0.1, color: '#ff9a3d', alpha: 0.9, gravity: 5,
    });
    // second white shock ring (better blast readability)
    this.flareRing(pos, '#ffd54f', radius * 1.6, 0.4);
    for (const r of racers) {
      if (r === owner) continue;
      const d = r.pos.distanceTo(pos);
      if (d < radius) {
        // v1.21: damage only when the hit LANDS — a shield/ghost blocks it fully
        if (r.spinOut(1.1)) { this.onHit?.(r, src); r.damage(2); }
      }
    }
  }

  /** fixed-step entity update */
  update(dt: number, racers: Kart[]) {
    const N = this.track.samples.length;
    this.localKart = racers.find(r => r.isLocal) ?? null;
    // queued lightning-field spawns (the 1… 2… 3… storm timing)
    this.updatePendingFields(dt, racers);
    this.updateRails(dt);
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.life -= dt;
      if (e.life <= 0) {
        if (e.kind === 'rocket' && e.audioId) audio.stopRocketLoop(e.audioId);
        if (e.kind === 'mine') {
          // mines expire silently with a fizzle (no free damage)
          this.particles.spawn({
            count: 8, pos: e.mesh.position.clone().setY(e.mesh.position.y + 0.2), spread: 0.4,
            vel: new THREE.Vector3(0, 1.5, 0), velSpread: 1.5,
            life: 0.4, size: 0.25, sizeEnd: 0.05, color: '#8a9098', alpha: 0.8, gravity: 3,
          });
        }
        if (e.kind === 'tnt') this.tntBlast(e, racers);
        if (e.kind === 'cart') {
          this.debris.burst(e.mesh.position.clone().setY(e.mesh.position.y + 0.6), 10, '#9aa3ab', 6, 0.2);
          const [cv, cp] = this.spatial(e.mesh.position, 60);
          audio.itemEnd('minecart', cv, cp);
        }
        if (e.kind === 'banana') {
          this.particles.spawn({ count: 6, pos: e.mesh.position.clone().setY(e.mesh.position.y + 0.2), spread: 0.3,
            vel: new THREE.Vector3(0, 1, 0), velSpread: 1, life: 0.35, size: 0.22, sizeEnd: 0.05, color: '#ffe14d', alpha: 0.8, gravity: 3 });
        }
        if (e.kind === 'efield') {
          // storm zones fizzle out with a soft electric puff when their time is up
          this.particles.spawn({
            count: 12, pos: e.fieldPos!.clone().setY(e.fieldPos!.y + 0.5), spread: 1.0,
            vel: new THREE.Vector3(0, 2, 0), velSpread: 3,
            life: 0.5, size: 0.4, sizeEnd: 0.05, color: '#7fd4ff', alpha: 0.8, gravity: -2,
          });
        }
        this.scene.remove(e.mesh);
        this.entities.splice(i, 1);
        continue;
      }
      switch (e.kind) {
        case 'rocket': {
          // DEFLECTED rockets (bounce off shield/magnet) fly away harmlessly
          if (e.deflected && e.dir) {
            e.mesh.position.addScaledVector(e.dir, 34 * dt);
            e.mesh.rotation.x += dt * 12;
            if (e.orb) (e.orb.material as THREE.MeshBasicMaterial).opacity = Math.max(0, e.life / 1.1) * 0.9;
            break;
          }
          // SPOOL UP (user: "هی سریع بشه، نسبت به سریع شدن موشک صدا هم تندتر
          // بیب بیب میکنه"): the missile accelerates the whole flight. v1.13:
          // 20 → 64 (75% of the old ceiling) so the "دید دید دید" warning is
          // genuinely survivable — mine / EMP / ghost / shield all work.
          // Fractional cursor (advance): Math.round used to THROW AWAY the
          // sub-sample part of the step, capping the missile at 1 sample/tick
          // and making it stall against fast targets on slow sim rates.
          // v3.2 SLOWER, FAIR MISSILE (user: "سرعتش کمتر کن … وقتی نیترو میزنم
          // از موشک جلو بیفتیم"): speed is in REAL m/s now and spools up to
          // ≈1.42× the victim's own top speed — it still hunts anyone driving
          // normally, but a NITRO burst (≈1.75×) genuinely outruns it.
          e.mps = Math.min(e.cap ?? 40, (e.mps ?? 26) + 7 * dt);
          e.spd = e.mps / (this.track.length / N);
          e.advance = (e.advance ?? 0) + e.spd * dt;
          const step = Math.floor(e.advance);
          e.advance -= step;
          // follow spline toward target (homing along track) — BACKWARD rockets
          // (fired while looking back) crawl the track the other way
          e.sIdx = ((e.sIdx + (e.backward ? -step : step)) % N + N) % N;
          const s = this.track.samples[e.sIdx];
          // LANE HOMING (BUGFIX v1.9): steer into the target's lane when the
          // cursor is within ~12 samples of them.
          let lane = 0;
          let tgtReal: THREE.Vector3 | null = null;
          if (e.target) {
            const tIdx = ((Math.round(e.target.trackPos) % N) + N) % N;
            const fwd = ((tIdx - e.sIdx) % N + N) % N;
            const near = e.backward ? (((e.sIdx - tIdx) % N + N) % N) < 12 : (fwd < 12 || fwd > N - 12);
            if (near) {
              const dx = e.target.pos.x - s.pos.x, dz = e.target.pos.z - s.pos.z;
              // clamp past the road edge a little so targets on the shoulder
              // are still trackable (road + curbs + ~1m of dirt)
              lane = clamp(dx * s.left.x + dz * s.left.z, -s.width / 2 - 1.2, s.width / 2 + 1.2);
              // v1.13 FINAL APPROACH: within 10 samples the kill cursor
              // converges on the victim's REAL position — the visible missile
              // physically dives onto the car instead of sailing past it.
              if (!e.backward && fwd < 10) {
                tgtReal = e.target.pos.clone().setY(e.target.pos.y + 0.5);
              }
            }
          }
          const targetPos = s.pos.clone().addScaledVector(s.left, lane).setY(s.pos.y + 0.7);
          if (tgtReal) targetPos.lerp(tgtReal, 0.75);
          e.mesh.position.lerp(targetPos, Math.min(1, dt * 10));
          e.mesh.lookAt(targetPos.clone().add(s.tan));
          // v1.14 whoosh follows the missile: closer = louder + brighter + panned
          if (e.audioId) {
            const pv2 = this.localKart;
            if (pv2) {
              const dRk = e.mesh.position.distanceTo(pv2.pos);
              // v1.20 (spec §17): smooth inverse-distance attenuation (no
              // hard 55 m on/off edge), air absorption (far = darker) and a
              // SUBTLE Doppler: closing in → pitch up, flying away → down.
              const prevD = (e as unknown as { _pd?: number })._pd ?? dRk;
              (e as unknown as { _pd?: number })._pd = dRk;
              const closing = (prevD - dRk) / Math.max(1e-3, dt);           // m/s toward the listener
              const vol = 0.17 / (1 + (dRk / 14) ** 2);
              const bright = 350 + 3800 / (1 + dRk / 10);
              const doppler = clamp(1 + closing / 260, 0.9, 1.1);
              audio.updateRocketLoop(e.audioId, vol, bright, panOf(pv2, e.mesh.position), doppler);
            } else audio.updateRocketLoop(e.audioId, 0.05, 900, 0);
          }
          // red orb pulses harder as it spools up (گوی نورانی قرمز)
          if (e.orb) {
            const heat = 0.75 + Math.sin(performance.now() / 60) * 0.15 + ((e.spd ?? 30) - 30) / 120;
            (e.orb.material as THREE.MeshBasicMaterial).opacity = clamp(heat, 0.6, 1);
            e.orb.scale.setScalar(1 + Math.sin(performance.now() / 90) * 0.12);
          }
          if (e.target) {
            const tgt = e.target;
            tgt.threatT = 1.2;                       // AI defensive brain trigger
            const tgtP = tgt.pos.clone().setY(tgt.pos.y + 0.5);
            // hit distance uses BOTH the (visually lagging) mesh AND the exact
            // spline cursor — the lerp follower trails the cursor by ~10
            // samples, which used to let the missile fly straight THROUGH a
            // moving target without ever entering the 2.2m hit radius.
            const d = Math.min(e.mesh.position.distanceTo(tgtP), targetPos.distanceTo(tgtP));
            if (d < 2.2 * (e.scale ?? 1)) {
              // 👻 GHOST (user v1.9: "وقتی روح فعال میشه باز موشک… کارساز نیست"):
              // the missile phases THROUGH — no hit, no explosion at all.
              if (tgt.ghostT > 0) {
                // spectral poof so the pass-through reads
                this.particles.spawn({
                  count: 6, pos: e.mesh.position.clone(), spread: 0.3,
                  vel: new THREE.Vector3(0, 1, 0), velSpread: 1.5,
                  life: 0.4, size: 0.3, sizeEnd: 0.05, color: '#cfe8ff', alpha: 0.7, gravity: -2,
                });
                break;
              }
              // 🛡️ SHIELD / 🧲 MAGNET DEFLECT (user v1.9: "سپر فعال باشه موشک دفع
              // بشه — با ضربه مغناطیسی هم موشک دفع بشه"): the missile RICOCHETS
              // away with a metallic ping instead of exploding.
              if (tgt.shieldT > 0 || tgt.magnetT > 0) {
                const wasShield = tgt.shieldT > 0;
                audio.play('deflect', 1, 1, this.localKart ? panOf(this.localKart, e.mesh.position) : 0);
                if (wasShield) { tgt.shieldT = 0; tgt.fx = 'hit'; tgt.fxT = 0.2; }
                tgt.bounce(2.2);
                this.flareRing(tgt.pos, wasShield ? '#5ad0ff' : '#ff5ad0', 3.4, 0.45);
                this.debris.burst(e.mesh.position.clone(), 10, wasShield ? '#9fe6ff' : '#ff8ae0', 7, 0.18);
                this.particles.spawn({
                  count: 14, pos: e.mesh.position.clone(), spread: 0.4,
                  vel: new THREE.Vector3(0, 2.5, 0), velSpread: 4,
                  life: 0.5, size: 0.3, sizeEnd: 0.05, color: wasShield ? '#9fe6ff' : '#ff8ae0', alpha: 0.95, gravity: 3,
                });
                e.deflected = true;
                e.target = undefined;
                e.life = Math.min(e.life, 1.1);
                e.dir = e.mesh.position.clone().sub(tgt.pos).setY(2.2).normalize();
                break;
              }
              // HIT: damage + explosion
              if (e.audioId) audio.stopRocketLoop(e.audioId);
              if (tgt.spinOut((e.scale ?? 1) > 1 ? 1.4 : 1.2)) this.onHit?.(tgt, 'rocket');
              tgt.damage(2);                       // 1 full heart of damage
              audio.play('bomb', 1, tgt.isLocal ? 1 : 0.7, tgt.isLocal || !this.localKart ? 0 : panOf(this.localKart, e.mesh.position));
              this.explosion(e.mesh.position, 3.2 * (e.scale ?? 1), e.owner, racers);
              this.scene.remove(e.mesh);
              this.entities.splice(i, 1);
              continue;
            }
            // v1.13 NEVER GIVE UP (user: "مهم نیست چقدر دور باشه، اون شکارش
            // میکنه"): the old drop rule watched the OWNER's progress — a fast
            // owner catching up to the target silently DISARMED a missile that
            // was one sample from impact. The hunt now only ends on impact,
            // deflection, or fuel exhaustion.
          }
          // 🧨 MINE COUNTERPLAY (v1.13, user: "کاربر بتونه موشک رو دفع کنه با
          // مین"): a missile that flies into an ARMED mine detonates it — both
          // are destroyed, the blast can still catch nearby karts.
          if (!e.deflected) {
            for (let m = this.entities.length - 1; m >= 0; m--) {
              const mine = this.entities[m];
              if ((mine.kind !== 'mine' && mine.kind !== 'tnt') || (mine.armed ?? 0) > 0) continue;
              if (mine.mesh.position.distanceTo(e.mesh.position) < 1.7 * (mine.scale ?? 1)) {
                if (mine.kind === 'tnt') this.tntBlast(mine, racers);
                else this.explosion(mine.mesh.position.clone(), 4.4 * (mine.scale ?? 1), null, racers, 'mine');
                this.scene.remove(mine.mesh);
                this.entities.splice(m, 1);
                // missile index shifted after the splice — re-locate it
                if (e.audioId) audio.stopRocketLoop(e.audioId);
                const ri = this.entities.indexOf(e);
                if (ri >= 0) { this.scene.remove(e.mesh); this.entities.splice(ri, 1); }
                break;
              }
            }
            if (!this.entities.includes(e)) continue; // missile died on the mine
          }
          if (e.flame) {
            const fk = 0.8 + Math.random() * 0.45;
            e.flame.scale.set((e.scale ?? 1) * (0.9 + Math.random() * 0.2), (e.scale ?? 1) * (0.9 + Math.random() * 0.2), (e.scale ?? 1) * fk * (0.8 + (e.mps ?? 30) / 60));
            e.flame.children[3].rotation.z += dt * 20;
            e.mesh.children[0].rotation.z += dt * 9;           // hull roll
          }
          // spiral sparks + hot smoke trail
          if (Math.random() < dt * 30) {
            const back = e.mesh.getWorldDirection(new THREE.Vector3()).multiplyScalar(-4);
            this.particles.spawn({ count: 1, pos: e.mesh.position.clone(), spread: 0.15, vel: back.setY(0.8), velSpread: 2.2, life: 0.35, size: 0.1, sizeEnd: 0.02, color: '#fff2b0', alpha: 1, gravity: 4 });
          }
          if (Math.random() < dt * 26) {
            this.particles.spawn({ count: 1, pos: e.mesh.position.clone(), spread: 0.25, vel: new THREE.Vector3(0, 0.9, 0), velSpread: 0.6, life: 1.1, size: 0.3, sizeEnd: 0.9, color: '#8a8f99', colorEnd: '#3a3d44', alpha: 0.45, gravity: -0.6, drag: 1.5 });
          }
          // exhaust smoke trail (denser, better rocket feel)
          if (Math.random() < dt * 44) {
            this.particles.spawn({
              count: 2, pos: e.mesh.position.clone(), spread: 0.2,
              vel: new THREE.Vector3(0, 0.6, 0), velSpread: 1.2,
              life: 0.5, size: 0.34, sizeEnd: 0.06, color: Math.random() < 0.5 ? '#ffd54f' : '#ff8a5c', alpha: 0.85, gravity: 0,
            });
          }
          break;
        }
        case 'ice': {
          // the orb shimmers (halo breathes + slight spin — alive)
          const sh = 0.85 + Math.sin(performance.now() / 110) * 0.15;
          const halo2 = e.mesh.children[1] as THREE.Mesh | undefined;
          if (halo2) halo2.scale.setScalar((e.scale ?? 1) * sh);
          e.mesh.rotation.y += dt * 3;
          if (e.freeFly) {
            // no-target shard: fly straight ahead, freeze anyone touched
            e.mesh.position.addScaledVector(e.dir ?? new THREE.Vector3(), 30 * dt);
            e.mesh.position.y -= 1.5 * dt;
            e.mesh.rotation.x += dt * 9; e.mesh.rotation.y += dt * 6;
            for (const r of racers) {
              if (r === e.owner || r.finished) continue;
              if (r.pos.distanceTo(e.mesh.position) < 1.5 * (e.scale ?? 1)) {
                this.iceHit(r, e);
                this.scene.remove(e.mesh);
                this.entities.splice(i, 1);
                break;
              }
            }
            break;
          }
          if (e.target) {
            const targetPos = e.target.pos.clone().setY(e.target.pos.y + 0.6);
            const dir = targetPos.clone().sub(e.mesh.position).normalize();
            e.mesh.position.addScaledVector(dir, 34 * dt);
            if (e.mesh.position.distanceTo(targetPos) < 1.4 * (e.scale ?? 1)) {
              this.iceHit(e.target, e);
              this.scene.remove(e.mesh);
              this.entities.splice(i, 1);
              continue;
            }
          } else {
            e.mesh.position.y -= 6 * dt;
          }
          break;
        }
        case 'mine': {
          // ALWAYS readable: beacon blinks, hazard ring pulses (user: players
          // must watch out for mines)
          const bt = performance.now() / 1000;
          if (e.beacon) {
            const on = Math.sin(bt * 7.5) > -0.25;
            (e.beacon.material as THREE.MeshBasicMaterial).opacity = on ? 1 : 0.12;
            e.beacon.scale.setScalar(on ? 1.3 : 0.85);
          }
          if (e.ring) {
            const k = 0.5 + Math.sin(bt * 4.5) * 0.5;
            (e.ring.material as THREE.MeshBasicMaterial).opacity = 0.22 + k * 0.5;
            e.ring.scale.setScalar(0.9 + k * 0.28);
          }
          if (e.armed && e.armed > 0) { e.armed -= dt; break; }
          // NEUTRAL trigger (user: "مهم نیست کی باشه، حتا اونی که کاشته باشه"):
          // ANY kart driving over it — the owner included — sets it off.
          // 👻 GHOST (v1.9): phased karts drive straight over it untouched.
          for (const r of racers) {
            if (r.finished || r.ghostT > 0) continue;
            const d = Math.hypot(r.pos.x - e.mesh.position.x, r.pos.z - e.mesh.position.z);
            if (d < 1.25 * (e.scale ?? 1) && Math.abs(r.pos.y - e.mesh.position.y) < 1.6) {
              this.explosion(e.mesh.position, 4.4 * (e.scale ?? 1), null, racers, 'mine'); // null owner = everyone in the blast
              this.scene.remove(e.mesh);
              this.entities.splice(i, 1);
              break;
            }
          }
          break;
        }
        case 'spring': {
          if (e.sprung !== undefined) {
            // firing animation: lid slams open, coil shoots up, then settles
            e.sprung -= dt;
            const k = 1 - Math.max(0, e.sprung) / 0.9;
            const open = k < 0.18 ? k / 0.18 : 1 - Math.max(0, (k - 0.55) / 0.45) * 0.35;
            if (e.plank) e.plank.rotation.x = -open * 1.9;
            if (e.coil) e.coil.scale.set(1, 0.05 + open * 1.0, 1);
            if (e.sprung <= 0) {
              this.debris.burst(e.mesh.position.clone().setY(e.mesh.position.y + 0.3), 8, '#a8743f', 4, 0.18);
              this.scene.remove(e.mesh);
              this.entities.splice(i, 1);
            }
            break;
          }
          if (e.armed && e.armed > 0) { e.armed -= dt; break; }
          for (const r of racers) {
            if (r.finished || r.ghostT > 0) continue;
            const d = Math.hypot(r.pos.x - e.mesh.position.x, r.pos.z - e.mesh.position.z);
            if (d < 1.35 * (e.scale ?? 1) && Math.abs(r.pos.y - e.mesh.position.y) < 1.4) {
              const [sv, sp] = this.spatial(e.mesh.position, 70);
              audio.play('megaJump', 0.85, sv, sp);
              audio.play('bonk', 0.7, sv * 0.8, sp);
              // the spring ALWAYS fires (the lid pops even on a shield) but
              // only an unprotected kart is launched + damaged
              if (r.spinOut(0.8)) {
                r.grounded = false;
                r.vy = 14.5 * Math.min(1.25, e.scale ?? 1);   // ≈4m apex, ~1.1s airtime
                r.damage(3);                                    // heavy damage
                this.onHit?.(r, 'jump');
              }
              this.flareRing(e.mesh.position, '#ffd08a', 3.2, 0.4);
              this.particles.spawn({
                count: 18, pos: e.mesh.position.clone().setY(e.mesh.position.y + 0.3), spread: 0.9,
                vel: new THREE.Vector3(0, 5, 0), velSpread: 3,
                life: 0.6, size: 0.35, sizeEnd: 0.06, color: '#e8c79a', alpha: 0.9, gravity: 9,
              });
              e.sprung = 0.9;
              break;
            }
          }
          break;
        }
        case 'efield': {
          const bt = performance.now() / 1000;
          // electric cage: arcs spin, dome breathes, core column flickers
          if (e.arcs) {
            for (let a = 0; a < e.arcs.length; a++) {
              e.arcs[a].rotation.z += dt * (1.4 + a * 0.9) * (a % 2 ? -1 : 1);
              e.arcs[a].rotation.x += dt * 0.5;
            }
          }
          const pulse = 0.72 + Math.sin(bt * 9.5) * 0.28;
          const flick = 0.82 + Math.sin(bt * 37) * 0.18;
          // final 2.5s: blink as a warning before the zone dies
          const dying = e.life < 2.5 ? (Math.sin(bt * 16) > 0 ? 1 : 0.25) : 1;
          if (e.domeMat) e.domeMat.opacity = (0.22 + pulse * 0.16) * dying;
          if (e.coreMat) e.coreMat.opacity = (0.32 + flick * 0.3) * dying;
          if (e.ringMat) e.ringMat.opacity = (0.5 + pulse * 0.4) * dying;
          if (e.mats) for (let m = 0; m < 3 && m < (e.arcs?.length ?? 0); m++) {
            e.mats[2 + m].opacity = (0.55 + Math.sin(bt * (11 + m * 5)) * 0.35) * dying;
          }
          // random mini-bolts crackling INSIDE the zone
          e.beepT = (e.beepT ?? 0.2) - dt;
          if (e.beepT <= 0) {
            e.beepT = 0.28 + Math.random() * 0.42;
            const off = new THREE.Vector3(rand(-e.radius! * 0.5, e.radius! * 0.5), 0, rand(-e.radius! * 0.5, e.radius! * 0.5));
            this.lightningBolt(e.fieldPos!.clone().add(off), true);
          }
          // ⚡ TRIGGER: ANY kart (owner included — these are live fields) that
          // touches the zone discharges it. 👻 Ghosts phase through.
          for (let r = 0; r < racers.length; r++) {
            const kart = racers[r];
            if (kart.finished || kart.ghostT > 0) continue;
            const d = Math.hypot(kart.pos.x - e.fieldPos!.x, kart.pos.z - e.fieldPos!.z);
            if (d < e.radius! + 1.1 && Math.abs(kart.pos.y - e.fieldPos!.y) < 3.4) {
              this.fieldDischarge(kart, e, i);
              break;
            }
          }
          break;
        }
        case 'tnt': {
          // v3.4 LIT PROXIMITY TNT: fuse burns forever, blink speed = how close
          // the nearest car is, contact = BOOM (short Minecraft white flash)
          const bt = performance.now() / 1000;
          const tsc = e.scale ?? 1;
          let near = 99;
          for (const r of racers) {
            if (r.finished || r.ghostT > 0) continue;
            if (r === e.owner && (e.immuneT ?? 0) > 0) continue;
            const d = Math.hypot(r.pos.x - e.mesh.position.x, r.pos.z - e.mesh.position.z);
            if (Math.abs(r.pos.y - e.mesh.position.y) < 2.2) near = Math.min(near, d);
          }
          const primed = e.life < 0.3;                       // touched: about to blow
          const rate = primed ? 40 : near < 8 ? 18 : near < 20 ? 10 : e.life < 2 ? 12 : 4;
          if (e.flash) e.flash.opacity = primed ? 0.85 : (Math.sin(bt * rate) > 0.2 ? 0.5 : 0);
          const swell = primed ? 1 + (0.3 - e.life) * 1.2 : 1 + Math.max(0, Math.sin(bt * rate * 0.5)) * 0.04;
          e.mesh.scale.setScalar(tsc * swell);
          if (e.fuseSpark) e.fuseSpark.scale.setScalar(0.8 + Math.random() * 0.9);
          if (Math.random() < dt * 34) {
            this.particles.spawn({ count: 1, pos: e.mesh.position.clone().setY(e.mesh.position.y + 1.45 * tsc), spread: 0.05,
              vel: new THREE.Vector3(0, 1.6, 0), velSpread: 1.8, life: 0.3, size: 0.13, sizeEnd: 0.02, color: Math.random() < 0.5 ? '#ffd36a' : '#ff7a2a', alpha: 1, gravity: 4 });
          }
          if (Math.random() < dt * 6) {
            this.particles.spawn({ count: 1, pos: e.mesh.position.clone().setY(e.mesh.position.y + 1.55 * tsc), spread: 0.05,
              vel: new THREE.Vector3(0, 1.1, 0), velSpread: 0.3, life: 0.8, size: 0.18, sizeEnd: 0.5, color: '#6b6b6b', alpha: 0.4, gravity: -1 });
          }
          // the fuse keeps hissing while it burns (only audible when close)
          e.fuseSfxT = (e.fuseSfxT ?? 2.6) - dt;
          if (e.fuseSfxT <= 0 && !primed) {
            e.fuseSfxT = 2.6;
            if (this.localKart && e.mesh.position.distanceTo(this.localKart.pos) < 35) {
              const [fv, fp] = this.spatial(e.mesh.position, 35);
              audio.play('tntFuse', 1, fv * 0.7, fp);
            }
          }
          if (e.immuneT && e.immuneT > 0) e.immuneT -= dt;
          if (e.armed && e.armed > 0) { e.armed -= dt; break; }
          // a car REACHES it -> it goes off (tiny primed flash first). ghosts pass.
          if (!primed && near < 1.7 * tsc) e.life = 0.18;
          break;
        }
        case 'banana': {
          if (e.immuneT && e.immuneT > 0) e.immuneT -= dt;
          e.mesh.rotation.y += dt * 0.4;
          if (e.armed && e.armed > 0) { e.armed -= dt; break; }
          for (const r of racers) {
            if (r.finished || r.ghostT > 0) continue;
            if (r === e.owner && (e.immuneT ?? 0) > 0) continue;
            const d = Math.hypot(r.pos.x - e.mesh.position.x, r.pos.z - e.mesh.position.z);
            if (d < 1.3 * (e.scale ?? 1) && Math.abs(r.pos.y - e.mesh.position.y) < 1.6) {
              const [v, pan] = this.spatial(e.mesh.position, 50);
              if (r.spinOut(1.05)) {
                this.onHit?.(r, 'banana');
                r.damage(1);
                r.slide += (r.id % 2 ? 1 : -1) * 2.2;       // deterministic slip direction
                audio.play('bananaSlip', 1, v, pan);
              } else audio.play('deflect', 1.2, v * 0.7, pan);
              this.debris.burst(e.mesh.position.clone().setY(e.mesh.position.y + 0.3), 8, '#ffd93a', 5, 0.14);
              this.scene.remove(e.mesh);
              this.entities.splice(i, 1);
              break;
            }
          }
          break;
        }
        case 'cart': {
          const sm = this.track.length / N;
          // rolls FAST along the road like it's on rails, speeding up a bit
          e.spd = Math.min(43, (e.spd ?? 30) + 6 * dt);   // v3.2: a NITRO burst outruns it
          e.advance = (e.advance ?? 0) + (e.spd / sm) * dt;
          const stepC = Math.floor(e.advance);
          e.advance -= stepC;
          e.sIdx = (e.sIdx + stepC) % N;
          const s = this.track.samples[e.sIdx];
          // lane homing toward the target once it's close on the track
          if (e.target && !e.target.finished) {
            const tIdx = ((Math.round(e.target.trackPos) % N) + N) % N;
            const fwd = ((tIdx - e.sIdx) % N + N) % N;
            if (fwd < 30 || fwd > N - 4) {
              const lat = (e.target.pos.x - s.pos.x) * s.left.x + (e.target.pos.z - s.pos.z) * s.left.z;
              e.lane = (e.lane ?? 0) + clamp(lat - (e.lane ?? 0), -9 * dt, 9 * dt);
            }
            e.target.threatT = Math.max(e.target.threatT, 0.4);
          }
          e.lane = clamp(e.lane ?? 0, -s.width / 2 + 0.6, s.width / 2 - 0.6);
          const tp = s.pos.clone().addScaledVector(s.left, e.lane).setY(s.pos.y + 0.02);
          e.mesh.position.lerp(tp, Math.min(1, dt * 14));
          e.mesh.rotation.y = Math.atan2(s.tan.x, s.tan.z);
          const body = e.mesh.children[0];
          if (body) { body.position.y = Math.abs(Math.sin(performance.now() / 55)) * 0.05; body.rotation.z = Math.sin(performance.now() / 80) * 0.03; }
          // rail pieces appear under it + metallic clack-clack
          e.railT = (e.railT ?? 0) - dt;
          if (e.railT <= 0) { e.railT = 0.06; this.dropRail(tp, e.mesh.rotation.y); }
          e.clackT = (e.clackT ?? 0) - dt;
          if (e.clackT <= 0) {
            e.clackT = clamp(2.6 / (e.spd ?? 30), 0.05, 0.14);
            const [v, pan] = this.spatial(e.mesh.position, 55);
            if (v > 0.12) audio.play('minecartClack', 0.9 + Math.random() * 0.2, v * 0.8, pan);
          }
          if (Math.random() < dt * 20) {
            this.particles.spawn({ count: 1, pos: e.mesh.position.clone().setY(e.mesh.position.y + 0.15), spread: 0.4,
              vel: new THREE.Vector3(0, 1.2, 0), velSpread: 1.6, life: 0.25, size: 0.1, sizeEnd: 0.02, color: '#ffe0a0', alpha: 1, gravity: 5 });
          }
          // run over whoever it touches (target first, anyone else in the way)
          let wrecked = false;
          for (const r of racers) {
            if (r.finished || e.hitSet!.has(r)) continue;
            const d = Math.hypot(r.pos.x - e.mesh.position.x, r.pos.z - e.mesh.position.z);
            if (d < 1.9 * (e.scale ?? 1) && Math.abs(r.pos.y - e.mesh.position.y) < 2.2) {
              e.hitSet!.add(r);
              if (this.cartHit(e, r)) { wrecked = true; break; }
            }
          }
          if (wrecked) { this.scene.remove(e.mesh); this.entities.splice(i, 1); }
          break;
        }
        case 'trap': {
          if (e.armed && e.armed > 0) { e.armed -= dt; break; }
          // glossy sheen sweep (better oil-slick readability)
          if (e.mat) {
            (e.mat as THREE.MeshBasicMaterial).opacity = 0.78 + Math.sin(performance.now() / 240) * 0.14;
          }
          for (const r of racers) {
            // FIX: the owner used to get caught by their own oil slick after
            // the arming delay — felt like the item "did not work". Owner is
            // now permanently immune to their own trap.
            if (r === e.owner || r.ghostT > 0) continue;   // 👻 ghost slides over oil too
            const d = Math.hypot(r.pos.x - e.mesh.position.x, r.pos.z - e.mesh.position.z);
            if (d < 1.7 * (e.scale ?? 1) && Math.abs(r.pos.y - e.mesh.position.y) < 2) {
              if (r.spinOut(0.9)) { this.onHit?.(r, 'trap'); r.damage(1); }   // half heart — a slip
              audio.play('trap', 1, this.localKart ? clamp(1.1 - this.localKart.pos.distanceTo(e.mesh.position) / 45, 0.25, 1) : 0.8, this.localKart ? panOf(this.localKart, e.mesh.position) : 0);
              this.particles.spawn({
                count: 8, pos: e.mesh.position.clone().setY(e.mesh.position.y + 0.2), spread: 0.6,
                vel: new THREE.Vector3(0, 1.5, 0), velSpread: 2,
                life: 0.4, size: 0.3, sizeEnd: 0.1, color: '#3a3f46', alpha: 0.9, gravity: 6,
              });
              this.scene.remove(e.mesh);
              this.entities.splice(i, 1);
              break;
            }
          }
          break;
        }
      }
    }
    // missile incoming warning (beeps + HUD flash) — runs off the same fixed
    // tick so the sound and the flash are perfectly in sync
    this.updateMissileWarn(dt);
  }

  private iceHit(target: Kart, e: Entity) {
    if (target.freeze(2.2)) this.onHit?.(target, 'ice');
    audio.play('freeze', 1, target.isLocal || !this.localKart ? 1 : clamp(1 - target.pos.distanceTo(this.localKart.pos) / 60, 0.3, 1), this.localKart ? panOf(this.localKart, target.pos) : 0);
    this.particles.spawn({
      count: 14, pos: e.mesh.position.clone(), spread: 0.5,
      vel: new THREE.Vector3(0, 2, 0), velSpread: 3,
      life: 0.5, size: 0.3, sizeEnd: 0.05, color: '#aee8ff', alpha: 0.9, gravity: 4,
    });
    this.flareRing(target.pos, '#aee8ff', 2.4, 0.4);
  }

  // ================= INCOMING WARNING v3.2 (rocket + minecart) =================
  // user: "اون فلش که عقب نشون میده و با صدا هماهنگه، ۵ ثانیه قبل از اینکه برسه
  // خبر بده، فلش کمی بزرگ‌تر بشه و متن حذف بشه — برای ریلی هم همین باشه ولی
  // فلشش متفاوت باشه". The ETA is now REAL: it integrates the threat's spool-up
  // AND subtracts the victim's own speed (the old estimate ignored that the
  // target is driving away, so it fired at the wrong moment). If you are
  // faster than the threat (NITRO!) there is no warning at all — you escaped.
  /** seconds until `e` reaches the player (Infinity = never / outrunning) */
  private threatEta(e: Entity, player: Kart): number {
    const N2 = this.track.samples.length;
    const sm = this.track.length / N2;                       // metres per sample
    const tIdx = ((Math.round(player.trackPos) % N2) + N2) % N2;
    let steps = ((tIdx - e.sIdx) % N2 + N2) % N2;
    if (e.backward) steps = (N2 - steps) % N2;
    if (steps > N2 * 0.75) return Infinity;                   // it's actually ahead of us
    let gap = steps * sm;                                     // metres along the road
    const vT = e.backward ? -Math.max(0, player.speed) : Math.max(0, player.speed);
    let v = e.kind === 'rocket' ? (e.mps ?? 26) : (e.spd ?? 30);
    const cap = e.kind === 'rocket' ? (e.cap ?? 40) : 43;
    const acc = e.kind === 'rocket' ? 7 : 6;
    let t = 0; const dt = 0.05;
    while (t < 7) {
      const close = v - vT;
      gap -= close * dt;
      if (gap <= 0) return t;
      v = Math.min(cap, v + acc * dt);
      t += dt;
    }
    return Infinity;
  }

  private updateMissileWarn(dt: number) {
    const W = this.missileWarn;
    const player = this.entities.length ? this.localKart : null;
    let best: Entity | null = null;
    let bestEta = Infinity;
    if (player && !player.finished) {
      for (const e of this.entities) {
        if (e.kind !== 'rocket' && e.kind !== 'cart') continue;
        if (e.deflected || e.target !== player) continue;
        const eta = this.threatEta(e, player);
        if (eta < bestEta) { bestEta = eta; best = e; }
      }
    }
    // 5 SECONDS BEFORE IMPACT — not a moment earlier
    if (!best || !player || bestEta > 5.0) {
      W.active = false;
      W.pulse = Math.max(0, W.pulse - dt * 3.2);
      if (this.warnEl) this.warnEl.style.opacity = '0';
      if (this.lockRing) this.lockRing.visible = false;
      return;
    }
    W.active = true;
    W.dist = best.mesh.position.distanceTo(player.pos);
    W.kind = best.kind === 'cart' ? 'cart' : 'rocket';
    W.eta = bestEta;
    // screen-relative angle: 0 = dead ahead, positive = right of the nose.
    const ang = Math.atan2(best.mesh.position.x - player.pos.x, best.mesh.position.z - player.pos.z);
    W.angleDeg = -wrapAngle(ang - player.heading) * 180 / Math.PI;
    // beep cadence driven by the REAL time left: 5 s → slow, 0 s → rapid
    const urgency = clamp(1 - bestEta / 5, 0, 1);
    best.beepT = (best.beepT ?? 0) - dt;
    if (best.beepT <= 0) {
      best.beepT = 0.62 - urgency * 0.52;
      const angR = W.angleDeg * Math.PI / 180;
      const rear = Math.abs(W.angleDeg) > 100;
      if (player.isLocal) {
        if (W.kind === 'cart') audio.cartDing(urgency, Math.sin(angR) * 0.9, rear);
        else audio.missileDing(urgency, Math.sin(angR) * 0.9, rear);
      }
      W.pulse = 1;                          // the arrow kicks on EVERY beep
    }
    W.pulse = Math.max(0, W.pulse - dt * 3.4);
    // red lock-on reticle on the road under the victim (rocket only)
    if (W.kind === 'rocket') this.updateLockRing(player, urgency, W.pulse); else if (this.lockRing) this.lockRing.visible = false;
    this.renderWarnUI();
  }

  /** ground reticle that tightens around the targeted player as the rocket closes in */
  private lockRing: THREE.Group | null = null;
  private updateLockRing(player: Kart, urgency: number, pulse: number) {
    if (!this.lockRing) {
      const g = new THREE.Group();
      const ringMat = new THREE.MeshBasicMaterial({ color: 0xff2a1f, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 1.78, 40), ringMat);
      ring.rotation.x = -Math.PI / 2;
      g.add(ring);
      for (let i = 0; i < 4; i++) {
        const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.7), ringMat);
        tick.rotation.x = -Math.PI / 2;
        const a = i * Math.PI / 2;
        tick.position.set(Math.cos(a) * 2.1, 0, Math.sin(a) * 2.1);
        tick.rotation.z = a + Math.PI / 2;
        g.add(tick);
      }
      this.disposables.push(ringMat);
      this.scene.add(g);
      this.trackDeep(g);
      this.lockRing = g;
    }
    const g = this.lockRing;
    g.visible = true;
    g.position.copy(player.pos).setY(player.pos.y + 0.08);
    g.rotation.y += 0.05 + urgency * 0.12;
    g.scale.setScalar(1.7 - urgency * 0.7 + pulse * 0.18);
  }

  /** DOM overlay: ONE big direction arrow (no text). Rocket = red missile
   *  arrow, minecart = amber rail chevron. Pulses with every beep. */
  private renderWarnUI() {
    const W = this.missileWarn;
    if (typeof document === 'undefined') return;
    if (!this.warnEl) {
      this.warnEl = document.createElement('div');
      this.warnEl.id = 'missile-warn';
      this.warnEl.style.opacity = '0';
      this.warnEl.innerHTML = `
        <div class="mw-rot"><div class="mw-arrow">
          <svg class="mw-rk" viewBox="0 0 100 120" width="84" height="100"><defs><linearGradient id="mwg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd0c4"/><stop offset=".35" stop-color="#ff3b2f"/><stop offset="1" stop-color="#a50c0c"/></linearGradient></defs>
            <path d="M50 4 L94 70 L66 70 L66 116 L34 116 L34 70 L6 70 Z" fill="url(#mwg)" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
            <circle cx="50" cy="52" r="9" fill="#fff"/></svg>
          <svg class="mw-ct" viewBox="0 0 110 120" width="92" height="100"><defs><linearGradient id="mwc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3b0"/><stop offset=".45" stop-color="#ffb300"/><stop offset="1" stop-color="#b86b00"/></linearGradient></defs>
            <path d="M55 6 L102 50 L80 50 L55 27 L30 50 L8 50 Z" fill="url(#mwc)" stroke="#2b1a00" stroke-width="5" stroke-linejoin="round"/>
            <path d="M55 46 L102 90 L80 90 L55 67 L30 90 L8 90 Z" fill="url(#mwc)" stroke="#2b1a00" stroke-width="5" stroke-linejoin="round"/>
            <rect x="30" y="100" width="50" height="7" rx="3" fill="#2b1a00"/><rect x="36" y="111" width="38" height="6" rx="3" fill="#2b1a00"/></svg>
        </div></div>`;
      document.body.appendChild(this.warnEl);
      this.warnArrow = this.warnEl.querySelector('.mw-rot');
      this.warnBanner = this.warnEl.querySelector('.mw-arrow');
    }
    const el = this.warnEl;
    el.style.opacity = '1';
    el.dataset.kind = W.kind;
    const a = Math.abs(W.angleDeg);
    el.dataset.dir = a > 110 ? 'rear' : a < 35 ? 'front' : W.angleDeg > 0 ? 'right' : 'left';
    const p = W.pulse;
    const u = clamp(1 - (W.eta ?? 5) / 5, 0, 1);
    if (this.warnArrow) this.warnArrow.style.transform = `rotate(${W.angleDeg.toFixed(1)}deg)`;
    if (this.warnBanner) {
      const glow = W.kind === 'cart' ? '255,179,0' : '255,45,45';
      this.warnBanner.style.transform = `translate(-50%, -100%) scale(${(1 + u * 0.25 + p * 0.35).toFixed(3)})`;
      this.warnBanner.style.filter = `drop-shadow(0 0 ${8 + p * 18}px rgba(${glow},${0.6 + p * 0.4}))`;
      this.warnBanner.style.opacity = String(0.7 + p * 0.3);
    }
  }

  /** the local kart (cached per tick by update()) */
  private localKart: Kart | null = null;
}
