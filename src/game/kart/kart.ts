// KUBO KARTS - Arcade kart physics: drift + mini-turbo, boost, jumps, surfaces, spin-out.
// Fixed-step simulation. Track-aware via spline samples (fast, robust on mobile).
import * as THREE from 'three';
import { clamp, wrapAngle } from '../core/utils';
import { nearestSample, type TrackData } from '../world/track';
import { tierOf, type CarDef } from '../data/cars';
import type { CharDef } from '../data/characters';
import { Powertrain, SURFACES, type SurfaceId } from './powertrain';

export interface KartTraits {
  startBoost?: number;    // multiplier
  driftChargeMul?: number;
  offroadMul?: number;    // 1 = normal penalty, <1 reduced
  boostPadMul?: number;
  antiFreezeMul?: number; // frozen/emp duration multiplier
  airControl?: number;    // extra steering in air
  slipstreamMul?: number;
  ironBumper?: boolean;   // +30% knockback dealt, -20% taken
  boxRange?: number;      // item-box pickup radius multiplier (magno)
  itemLuck?: boolean;
}

export interface KartTunables {
  maxSpeed: number; accel: number; turnRate: number;
  driftTurn: number; chargeRate: number; weight: number;
  boostMul: number; boostTime: number; spinTime: number;
  offroadFactor: number;
  /** v1.20 tire grip limit on asphalt (m/s² of lateral acceleration) */
  grip: number;
}

export function tuneFrom(def: CarDef, traits: KartTraits): KartTunables {
  const s = def.stats;
  // TIER SPEED (user v1.9: "ماشین‌های رتبه بالا سرعت بیشتری دارن"): A-class
  // hypercars get a real top-speed edge over B and C — the ranking now MATTERS.
  // v1.20: maxSpeed below is only a PLACEHOLDER — the Kart constructor
  // overwrites it with the powertrain's emergent equilibrium speed (class-
  // based performance profile). No per-class km/h numbers live here anymore.
  const tier = tierOf(def);
  const tierSpeed = tier === 'S' ? 1.2 : tier === 'A' ? 0.8 : tier === 'B' ? 0.4 : 0;
  return {
    // SPEED REBALANCE v2 (user v1.10: "سرعت ماشین باید پایین‌تر و منطقی‌تر
    // باشه"): another notch down + a gentler stat curve. Top speeds now read
    // like real karts: starter ≈ 82 km/h, hypercar ≈ 100 km/h — the camera
    // keeps up, corners stay readable, boosts feel like a REAL burst.
    maxSpeed: 18.2 + s.speed * 0.92 + tierSpeed,
    accel: 9.0 + s.accel * 1.05,
    turnRate: 1.55 + s.handling * 0.105,
    driftTurn: 1.05 + s.drift * 0.075,
    chargeRate: (0.85 + s.drift * 0.13) * (traits.driftChargeMul ?? 1),
    weight: 0.65 + s.weight * 0.07,
    boostMul: 1.26 + s.boost * 0.032,
    boostTime: 1.05 + s.boost * 0.09,
    spinTime: Math.max(0.6, 1.5 - s.defense * 0.065),
    offroadFactor: 0.52 + (traits.offroadMul !== undefined ? (1 - traits.offroadMul) * 0.48 : 0),
    grip: 30 + s.handling * 1.6,
  };
}

/** WORKSHOP tuning (garage update): each part level feeds real physics knobs.
 *  engine→top speed+accel • turbo→boost power/duration • tires→grip+launch
 *  drift→charge speed+angle • armor→spin resistance+mass. */
export function applyTuning(kart: Kart, up: { engine: number; turbo: number; tires: number; drift: number; armor: number }) {
  // v1.20: every upgrade feeds the REAL model — no hidden speed multiplier
  // (the old "+4 % top speed full-build bonus" was removed: NO FAKE SPEED).
  //  engine → torque/power inside the class band (powertrain rebuild)
  //  turbo  → boost thrust + duration     tires → grip + steering
  //  drift  → drift charge + angle        armor → mass + spin resistance
  const T = kart.T;
  T.turnRate += up.tires * 0.055;
  T.grip += up.tires * 1.4;
  T.boostMul += up.turbo * 0.014;
  T.boostTime += up.turbo * 0.07;
  T.chargeRate += up.drift * 0.075;
  T.driftTurn += up.drift * 0.02;
  T.spinTime = Math.max(0.5, T.spinTime - up.armor * 0.09);
  T.weight += up.armor * 0.05;
  kart.tune = { engine: up.engine, turbo: up.turbo };
  kart.rebuildPowertrain();
  kart.pt.massF *= 1 + up.armor * 0.012;       // armour = real mass
}

export type KartFx = 'none' | 'drift1' | 'drift2' | 'boost' | 'land' | 'hit' | 'spin' | 'fall';

export class Kart {
  // --- identity ---
  def: CarDef;
  traits: KartTraits;
  T: KartTunables;
  isLocal = false;
  isRemote = false;
  id = 0;
  name = '';
  charDef: CharDef | null = null;

  // --- state ---
  pos = new THREE.Vector3();
  /** physics position at the START of this fixed step — render interpolation
   *  lerps between prevPos and pos with the loop's alpha so the kart GLIDES on
   *  high-refresh displays (user v1.9: "ماشین حالت گیلیچی داره، نرم باشه"). */
  prevPos = new THREE.Vector3();
  prevHeading = 0;
  heading = 0;             // yaw, radians. forward = (sin h, 0, cos h)
  speed = 0;               // signed forward speed
  vy = 0;
  grounded = true;
  slideDir = 0;            // lateral velocity sign
  slide = 0;               // lateral speed magnitude
  hopT = 0;

  drifting = false;
  driftDir = 0;
  driftCharge = 0;         // seconds accumulated
  driftTier = 0;           // 0,1,2
  driftHeld = false;

  boostT = 0;
  /** v3.2 NITRO item: >0 while the big nitro burst is active (on top of boostT) */
  nitroT = 0;
  /** v3.1 SPEED BREAKER (user: "فرد بتونه سرعت بشکونه و از حد ماشینش فراتر
   *  بره با مستقیم رفتن"): 0..1, builds while you hold a clean straight line
   *  at full throttle near top speed — adds real thrust past the car's
   *  normal equilibrium (≈ +11 % at full charge). Any hard steer, drift,
   *  brake or grass bleeds it off. */
  overdrive = 0;
  /** v3.1 SLIPSTREAM: 0..1, set every tick by the race when you tuck in
   *  behind a rival (cone behind their bumper). Adds up to ≈ +8 % top end. */
  draft = 0;
  draftTarget = 0;
  boostTotal = 0;
  padCooldown = 0;

  frozenT = 0; spunT = 0; spinAnim = 0;
  shieldT = 0; giantT = 0; magnetT = 0; invulT = 0;
  ghostT = 0;                  // 👻 phase-out: untouchable + passes through rivals
  stallT = 0;                  // 💥 EMP: engine DEAD (no gas, coasts to a stop)

  // --- HEALTH (user v1.9: "نوار جون شبیه قلب‌های ماینکرفت — ماشین‌های رتبه
  // بالا نوار جون بهتر و سرعت بیشتر دارن") — measured in HALF-hearts so a
  // heart can deplete in halves exactly like Minecraft. Tier C = 3 hearts,
  // B = 4 hearts, A = 5 hearts. Hitting 0 → breakdown → repaired with full HP.
  maxHp = 6;
  hp = 6;
  hurtT = 0;                   // seconds since last damage (gates regen + HUD flash)
  regenT = 7;
  threatT = 0;                 // >0: a missile is homing on ME (AI defensive logic)

  // --- BREAKDOWN (user: random engine failure → full stop → respawn → falls behind)
  breakdownWarn = 0;           // >0: smoke warning countdown before the stall
  breakdownT = 0;              // >0: stalled — engine dead, car coasts to a stop
  breakdownRollT = 14;         // seconds until the next breakdown chance roll
  breakdownDone = false;       // max one breakdown per race per kart

  // --- track tracking ---
  sIdx = 0;                // nearest sample index
  lap = 0;                 // completed laps
  trackPos = 0;            // total progress in samples (lap*N + idx)
  lastTrackPos = 0;
  wrongWay = false;
  lateral = 0;             // lateral offset from center (meters)
  surfaceRoad = true;
  finished = false;
  finishTime = 0;
  respawnCooldown = 0;

  // --- fx state (read by race/visuals) ---
  fx: KartFx = 'none';
  fxT = 0;
  engineRatio = 0;
  driftIntensity = 0;
  airTime = 0;
  // --- power-up QUEUE: up to 3 items, FIFO (user: "تا سه تا قدرت بشه گرفت —
  // سه دکمه، هر کدوم آیتم خودش رو فعال می‌کنه") — `item` stays as a compat
  // getter/setter mapped onto the queue so AI/net/roulette code is unchanged.
  static ITEM_SLOTS = 3;
  items: (string | null)[] = [null, null, null];
  itemCooldown = 0;
  stuckT = 0;                   // anti-stall: gas held + grounded + not moving
  usedMagnet = false;           // for finish bonus

  // --- v1.20 POWERTRAIN + TIRE + SUSPENSION MODEL ---
  /** engine / gearbox / RPM / load — the single source of truth for drive force */
  pt!: Powertrain;
  tune = { engine: 0, turbo: 0 };
  /** which surface the road / the off-road terrain is on this map */
  surfaceMap: { road: SurfaceId; off: SurfaceId } = { road: 'asphalt', off: 'grass' };
  surface: SurfaceId = 'asphalt';
  // telemetry (read by HUD, audio, debug overlay, camera)
  throttle = 0;          // 0..1 pedal actually applied
  braking = false;
  slipAngle = 0;         // rad — tire slip (drift + understeer)
  gripNow = 1;           // 0..1 fraction of grip in use
  latAccel = 0;          // m/s²
  longAccel = 0;         // m/s²
  /** suspension state (spring-damper): pitch (+nose down), roll (+right), heave (m) */
  susp = { pitch: 0, pitchV: 0, roll: 0, rollV: 0, heave: 0, heaveV: 0 };
  private prevSpeedPhys = 0;
  /** v2.1 road height one physics step ago (NaN = unknown → re-seed) */
  private prevRoadY = NaN;
  /** v2.1 deck slope along the kart's nose (rise/run) — visuals pitch the car with the road */
  roadSlope = 0;
  /** >0 on steps where the kart is pressed into a road barrier (m/s into it) */
  wallHit = 0;
  /** v1.22 race-side lap bookkeeping: highest lap-floor already announced.
   *  The old code compared against kart.lap, which kart.ts recomputes EVERY
   *  frame — that re-fired the lap event ~60×/s (the endless chime spam the
   *  user reported as "صدای دور آخر هی صدا میده الکی"). */
  lastLapFloor = -1;

  private tmp = new THREE.Vector3();

  constructor(def: CarDef, traits: KartTraits = {}) {
    this.def = def;
    this.traits = traits;
    this.T = tuneFrom(def, traits);
    this.rebuildPowertrain();
    // hearts per class profile: C=3 ♥, B=4 ♥, A=5 ♥ (half-heart units)
    this.maxHp = this.pt.cls.hearts;
    this.hp = this.maxHp;
    this.prevPos.copy(this.pos);
  }

  /** (re)build the powertrain from car + garage tune. T.maxSpeed becomes the
   *  EMERGENT equilibrium speed (reference for AI, HUD ratios, camera). */
  rebuildPowertrain() {
    this.pt = new Powertrain(this.def, this.tune, this.T.boostMul);
    this.T.maxSpeed = this.pt.vTop;
  }

  /** damage in HALF-hearts. MONSTER MODE (user: "اگه قدرت هیولا فعال باشه دمیج
   *  کمتری بخورم"): a giant kart takes half damage (rounded up). Returns true
   *  when this hit emptied the bar (the race turns that into a breakdown). */
  damage(amount: number): boolean {
    if (this.finished || this.invulT > 0) return false;
    const dmg = this.giantT > 0 ? Math.max(1, Math.ceil(amount / 2)) : amount;
    this.hp = Math.max(0, this.hp - dmg);
    this.hurtT = 0.01;
    this.regenT = 7;
    return this.hp <= 0;
  }

  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /** first queued item (compat: AI + remote sync read this) */
  get item(): string | null {
    return this.items.find(i => i !== null) ?? null;
  }
  /** push an item into the first free slot (compat: roulette writes this) */
  set item(v: string | null) {
    if (v === null) { this.clearItems(); return; }
    const free = this.items.indexOf(null);
    if (free >= 0) this.items[free] = v;
  }
  /** count of queued power-ups */
  get itemCount(): number {
    return this.items.reduce((n, i) => n + (i ? 1 : 0), 0);
  }
  hasFreeSlot(): boolean { return this.items.some(i => i === null); }
  clearItems() { this.items = [null, null, null]; }
  /** take the item in a specific slot (HUD button i) — null if empty.
   *  NO compaction: the user wants slot identity preserved — "بزنی اولی اولی
   *  فعال میشه، دومی دومی، سومی سومی" — so each button always fires ITS slot. */
  takeSlot(idx: number): string | null {
    if (idx < 0 || idx >= this.items.length) return null;
    const v = this.items[idx];
    this.items[idx] = null;
    return v;
  }

  placeAtGrid(grid: { pos: THREE.Vector3; heading: number }) {
    this.pos.copy(grid.pos);
    this.heading = grid.heading;
    this.prevPos.copy(this.pos);
    this.prevHeading = this.heading;
    this.speed = 0; this.vy = 0; this.slide = 0;
    this.grounded = true;
  }

  /** main fixed-step update. dt = 1/60 */
  update(dt: number, input: { steer: number; gas: boolean; brake: boolean; drift: boolean }, data: TrackData, rng: () => number) {
    // capture pre-step state for render interpolation (smooth ride on 120Hz)
    this.prevPos.copy(this.pos);
    this.prevHeading = this.heading;
    this.fxT -= dt;
    if (this.fxT <= 0) this.fx = 'none';
    const T = this.T;
    const N = data.samples.length;

    // --- timers ---
    if (this.frozenT > 0) this.frozenT -= dt;
    if (this.spunT > 0) this.spunT -= dt;
    if (this.stallT > 0) this.stallT -= dt;
    if (this.shieldT > 0) this.shieldT -= dt;
    if (this.giantT > 0) this.giantT -= dt;
    if (this.ghostT > 0) this.ghostT -= dt;
    if (this.magnetT > 0) this.magnetT -= dt;
    if (this.invulT > 0) this.invulT -= dt;
    if (this.itemCooldown > 0) this.itemCooldown -= dt;
    if (this.padCooldown > 0) this.padCooldown -= dt;
    if (this.respawnCooldown > 0) this.respawnCooldown -= dt;
    if (this.hopT > 0) this.hopT -= dt;
    if (this.threatT > 0) this.threatT -= dt;
    // --- health regen (Minecraft-style: heal after a calm stretch) ---
    if (this.hurtT > 0) this.hurtT += dt;
    if (this.hurtT > 6) this.hurtT = 0;
    if (this.hp < this.maxHp && this.hurtT === 0 && this.hp > 0) {
      this.regenT -= dt;
      if (this.regenT <= 0) { this.hp = Math.min(this.maxHp, this.hp + 1); this.regenT = 7; }
    }

    const disabled = this.frozenT > 0 || this.spunT > 0 || this.finished;
    // point-to-point finish: coast to a clean stop inside the runoff
    if (this.finished && data.open) this.speed *= Math.max(0, 1 - 1.6 * dt);
    let steer = disabled ? 0 : input.steer;
    const gas = !disabled && input.gas;
    const brake = !disabled && input.brake;
    const driftBtn = !disabled && input.drift;

    // --- track sampling ---
    this.sIdx = nearestSample(data, this.pos, this.sIdx, 24);
    const s = data.samples[this.sIdx];
    // lateral offset
    const dx = this.pos.x - s.pos.x, dz = this.pos.z - s.pos.z;
    this.lateral = dx * s.left.x + dz * s.left.z;
    const halfW = s.width / 2 + 0.8;
    this.surfaceRoad = Math.abs(this.lateral) < halfW && s.hasRoad;

    // --- wrong way detection ---
    const f = this.forward(this.tmp);
    const dot = f.x * s.tan.x + f.z * s.tan.z;
    this.wrongWay = dot < -0.35 && this.speed > 3;

    // --- progress ---
    // v1.22 ROOT-CAUSE FIX (user: "وقتی به خط شروع میرسم دور حساب نمیشه … برای
    // همه مپ‌ها درست کن چون همشون مشکل دارن"): trackPos must count SAMPLES
    // CROSSED — one physical lap must advance it by exactly N (= samples per
    // lap). The old formula multiplied the sample delta by speed·dt (a
    // seconds-per-frame mess): each sample boundary added ≈ 0.1–0.24 units
    // instead of 1, so after a full lap trackPos reached only ≈ 0.2·N and
    // floor(trackPos / N) NEVER rolled over — on every map, at any speed.
    // Now: +1 per sample crossed (signed), so the lap increments EXACTLY on
    // the start-line crossing, reverse driving un-counts it, and respawns
    // (which re-anchor sIdx a few samples ahead) shift trackPos correctly.
    this.lastTrackPos = this.trackPos;
    const sIdxDist = (((this.sIdx - (this.lastTrackPos % N)) % N) + N) % N;
    const forwardStep = sIdxDist > N / 2 ? sIdxDist - N : sIdxDist;
    if (!this.finished) this.trackPos += forwardStep;
    this.lap = Math.floor(this.trackPos / N);

    // --- anti-stall watchdog (gas held but kart pinned) ---
    if (!disabled && gas && this.grounded && Math.abs(this.speed) < 1.2 && Math.abs(this.vy) < 1) {
      this.stuckT += dt;
    } else {
      this.stuckT = 0;
    }

    // --- surfaces (v1.20: grip + rolling resistance per material) ---
    this.surface = this.surfaceRoad ? this.surfaceMap.road : this.surfaceMap.off;
    const surf = SURFACES[this.surface];
    let surfRoll = surf.roll;
    if (!this.surfaceRoad && this.traits.offroadMul !== undefined) surfRoll *= this.traits.offroadMul;

    // --- ⚡ speed breaker charge (straight line, full gas, near top) ---
    {
      // v3.2: fully AUTOMATIC, no HUD (user: "خودکار باشه بدون اینکه بگی … مثل
      // دنیای واقعی با مستقیم رفتن"): hold a straight line at full gas and the
      // car keeps pulling past its normal top speed (up to ≈ +14 %). Gentle
      // steering keeps it; only hard steering / drift / brake / grass bleed it.
      const nearTop = this.speed > this.pt.vTop * 0.8;
      const clean = gas && !brake && this.grounded && !this.drifting && this.surfaceRoad
        && Math.abs(steer) < 0.36 && nearTop && this.stallT <= 0 && this.breakdownT <= 0;
      if (clean) this.overdrive = Math.min(1, this.overdrive + dt / 2.1);
      else if (!this.grounded && this.overdrive > 0) this.overdrive = Math.max(0, this.overdrive - dt * 0.1); // jumps keep it
      else this.overdrive = Math.max(0, this.overdrive - dt * (Math.abs(steer) > 0.65 || brake || this.drifting ? 1.4 : 0.45));
      // slipstream eases in/out (race sets draftTarget each tick)
      this.draft += (this.draftTarget - this.draft) * Math.min(1, dt * (this.draftTarget > this.draft ? 1.4 : 3.5));
    }

    // --- boost timer ---
    const boosting = this.boostT > 0;
    if (boosting) this.boostT -= dt;
    if (this.nitroT > 0) this.nitroT -= dt;

    // --- POWERTRAIN: throttle → load → RPM → torque → drive accel ---
    const dead = this.stallT > 0 || this.breakdownT > 0;
    const reversing = brake && this.speed < 0.5;
    this.throttle = gas && !dead ? 1 : 0;
    const wheelSlip = this.drifting ? clamp(this.slipAngle * 2.2, 0, 1) : 0;
    const driveA = this.pt.step(dt, this.speed, this.throttle, {
      boost: boosting && !dead, stalled: dead, grounded: this.grounded, wheelSlip, reverse: reversing,
    });
    this.braking = false;

    // --- longitudinal dynamics ---
    if (this.spunT > 0) {
      this.speed *= 1 - 2.4 * dt;          // tires locked sideways: heavy scrub
      this.spinAnim += dt * 11;
    } else if (this.frozenT > 0) {
      this.speed *= 1 - 1.8 * dt;          // wheels frozen solid
    } else {
      if (brake && this.speed > 0.5) {
        // brakes: limited by surface grip (ice = long stopping distance)
        this.speed -= 26 * Math.sqrt(surf.grip) * dt;
        this.braking = true;
      } else if (reversing) {
        this.speed = Math.max(-this.pt.vTop * 0.42, this.speed - 9 * Math.sqrt(surf.grip) * dt);
      } else if (this.grounded) {
        this.speed += driveA * dt;
        // ⚡ SPEED BREAKER + SLIPSTREAM: constant extra thrust (fraction of the
        // resistance AT the car's own top speed) so the equilibrium moves
        // above vTop. Quadratic drag keeps it bounded (≈ vTop·√(1+f)).
        if (this.throttle > 0 && !dead) {
          const f = this.overdrive * 0.3 + this.draft * 0.17 * (this.traits.slipstreamMul ?? 1);
          if (f > 0) this.speed += this.pt.resist(this.pt.vTop, 0) * f * dt;
        }
        // 🔵 NITRO (v3.2): a much bigger push than a drift/pad boost — the
        // equilibrium jumps to ≈ 1.75× the car's top speed, fast enough to
        // outrun a homing rocket or the runaway minecart.
        if (this.nitroT > 0 && !dead) {
          const tail = Math.min(1, this.nitroT / 0.6);            // smooth fade-out
          this.speed += Math.max(0, this.pt.resist(this.pt.vTop * 1.75, 0) - this.pt.boostThrust) * tail * dt;
        }
        // 🦖 giant: bigger engine torque (real extra thrust, not a speed cap)
        if (this.giantT > 0 && this.throttle > 0) this.speed += this.pt.resist(this.speed, 0) * 0.28 * dt;
      }
      // rolling + aero + surface resistance — top speed EMERGES from here
      const res = this.pt.resist(this.speed, this.grounded ? surfRoll : 0) * (this.grounded ? 1 : 0.35);
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), res * dt);
    }

    // --- steering ---
    const speedFrac = clamp(Math.abs(this.speed) / T.maxSpeed, 0, 1);
    const steerPow = clamp(Math.abs(this.speed) / 6, 0, 1); // no turning when stopped
    let turn = 0;
    const gripLimit = T.grip * surf.grip;                    // m/s² available
    let understeerSlip = 0;
    if (this.drifting) {
      // drift: base rotation in drift dir, steering modulates tightness
      const tighten = 0.5 + (steer * this.driftDir * 0.5 + 0.5) * 0.72;
      turn = this.driftDir * T.driftTurn * tighten * steerPow;
      // v1.20: speed loss is a RESULT of tire slip — scrub ∝ slip angle² ×
      // speed × surface friction. A clean, committed drift (small slip)
      // keeps momentum; a sloppy wide one bleeds speed. (Old code: flat 12 %/s.)
      const scrub = this.slipAngle * this.slipAngle * Math.abs(this.speed) * 1.25 * surf.grip / this.pt.massF;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), scrub * dt);
    } else {
      turn = steer * T.turnRate * steerPow * (0.55 + 0.45 * (1 - speedFrac * 0.4));
      if (this.speed < 0) turn = -turn;
      // TRACTION LIMIT: lateral demand v·ω beyond the tire grip → the front
      // washes out (less yaw) and the scrubbing tires shed speed naturally.
      const demand = Math.abs(this.speed * turn);
      if (this.grounded && demand > gripLimit && demand > 0.01) {
        const excess = demand - gripLimit;
        turn *= gripLimit / demand + (1 - gripLimit / demand) * 0.35;
        understeerSlip = Math.atan2(excess, gripLimit);
        this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), excess * 0.22 * dt / this.pt.massF);
      }
    }
    this.latAccel = this.speed * turn;
    this.gripNow = clamp(Math.abs(this.latAccel) / Math.max(1, gripLimit), 0, 1.5);
    if (!this.grounded && this.traits.airControl) turn += steer * this.traits.airControl * dt * 0.9;
    this.heading += turn * dt;

    // --- drift lifecycle ---
    if (!disabled && driftBtn && !this.drifting && this.grounded && Math.abs(this.speed) > 11 && Math.abs(steer) > 0.25) {
      this.drifting = true;
      this.driftDir = Math.sign(steer);
      this.driftCharge = 0;
      this.driftTier = 0;
      this.hopT = 0.22;
      this.vy = 4.0;   // softer hop (user: "تکون‌ها کمتر و واقعی‌تر")
      this.grounded = false;
      this.fx = 'drift1'; this.fxT = 0.2;
    }
    if (this.drifting) {
      this.driftCharge += dt * T.chargeRate * (Math.abs(steer) > 0.3 ? 1.15 : 0.8);
      const newTier = this.driftCharge > 1.7 ? 2 : this.driftCharge > 0.85 ? 1 : 0;
      if (newTier !== this.driftTier) {
        this.driftTier = newTier;
        this.fx = newTier === 2 ? 'drift2' : 'drift1';
        this.fxT = 0.15;
      }
      if (!driftBtn || Math.abs(this.speed) < 6 || this.spunT > 0) {
        // release
        if (this.driftTier > 0) {
          this.boostT = Math.max(this.boostT, this.driftTier === 2 ? T.boostTime * 1.5 : T.boostTime * 0.8);
          this.boostTotal += this.driftTier === 2 ? T.boostTime * 1.5 : T.boostTime * 0.8;
          this.fx = 'boost'; this.fxT = 0.3;
        }
        this.drifting = false;
        this.driftCharge = 0;
        this.driftTier = 0;
      }
    }

    // --- lateral slide (drift feel) ---
    // slide angle: holding INTO the drift keeps it tight (skill), neutral /
    // counter-steer opens it up; low-grip surfaces slide further.
    const steerInto = this.drifting ? clamp(steer * this.driftDir, -1, 1) : 0;
    const slideK = 0.17 + this.driftCharge * 0.06 + (1 - steerInto) * 0.07;
    const targetSlide = this.drifting ? this.driftDir * Math.abs(this.speed) * slideK * Math.sqrt(surf.driftSlip) : 0;
    this.slide += (targetSlide - this.slide) * Math.min(1, (this.drifting ? 6 : 10 * surf.grip) * dt);
    this.slipAngle = Math.max(Math.atan2(Math.abs(this.slide), Math.max(1, Math.abs(this.speed))), understeerSlip);
    this.driftIntensity = this.drifting ? clamp(this.driftCharge / 1.7, 0.3, 1) : Math.max(0, this.driftIntensity - dt * 3);

    // --- integrate position ---
    const fwd = this.forward(this.tmp);
    const leftX = Math.cos(this.heading), leftZ = -Math.sin(this.heading); // left vector
    const vx = fwd.x * this.speed + leftX * this.slide;
    const vz = fwd.z * this.speed + leftZ * this.slide;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;

    // recompute nearest + lateral after move (for walls & ground)
    this.sIdx = nearestSample(data, this.pos, this.sIdx, 24);
    const s2 = data.samples[this.sIdx];
    const dx2 = this.pos.x - s2.pos.x, dz2 = this.pos.z - s2.pos.z;
    const lat2 = dx2 * s2.left.x + dz2 * s2.left.z;
    const halfW2 = s2.width / 2 + 0.6;
    const groundBelow = data.groundAt ? data.groundAt(this.pos.x, this.pos.z) : s2.pos.y - 2;
    const voidBelow = groundBelow < -9000; // sky theme: no terrain off-road
    // UNIVERSAL ROAD WALLS (user v1.11: "برای کل مپ‌ها کنار جاده‌ها مانع بزار
    // و نزار کاربر از جاده خارج بشه"): every map has real barrier walls along
    // both road edges and the physics enforces them EVERYWHERE — grounded or
    // airborne, flat or elevated. The old logic only guarded elevated road
    // sections, which is why karts could wander off onto the terrain and
    // disappear into it. Wall contact scrubs a little speed and reflects the
    // lateral slide — a soft, readable bounce, never a dead stop.
    const latAbs2 = Math.abs(lat2);
    const wallLat = s2.width / 2 + 0.55;   // kart centre clamp (edge ≈ wall face)
    this.wallHit = 0;
    if (s2.hasRoad && latAbs2 > wallLat) {
      const sgn = Math.sign(lat2) || 1;
      // impact speed into the barrier (for audio/camera): lateral velocity
      // component along the road normal
      const nx = s2.left.x * sgn, nz = s2.left.z * sgn;
      this.wallHit = Math.max(0.01, vx * nx + vz * nz);
      const clamped = sgn * wallLat;
      this.pos.x = s2.pos.x + s2.left.x * clamped;
      this.pos.z = s2.pos.z + s2.left.z * clamped;
      // v1.22 DEFLECT-AND-GLANCE (user: "وقتی به دیوارها بخوری به جای اینکه
      // گیر کنیم منحرف بشیم"): the old code only clamped the position, so a
      // kart whose nose pointed INTO the wall pushed into it every frame and
      // ground to a pinned stop. Two-part arcade fix (Mario-Kart feel):
      //  1) DEFLECT — project the forward vector onto the wall plane and
      //     re-aim the heading along it (keeping the racing direction), so the
      //     kart keeps moving ALONG the barrier instead of pressing into it.
      //  2) BOUNCE — a one-time gentle outward impulse + speed scrub, scaled
      //     by the impact speed. Never a dead stop, never a sticky grind.
      const fxw = Math.sin(this.heading), fzw = Math.cos(this.heading);
      const intoWall = fxw * nx + fzw * nz;
      let px = fxw - intoWall * nx, pz = fzw - intoWall * nz;
      const pl = Math.hypot(px, pz);
      if (pl > 0.12) {
        // heading mostly parallel-ish → slide along the wall
        this.heading = Math.atan2(px / pl, pz / pl);
      } else if (intoWall > 0) {
        // near head-on → pivot onto the tangent (keeping travel direction)
        const alongTan = s2.tan.x * fxw + s2.tan.z * fzw;
        const dir = alongTan >= 0 ? 1 : -1;
        this.heading = Math.atan2(s2.tan.x * dir, s2.tan.z * dir);
      }
      // existing slide reflection FIRST (old behaviour), then the outward
      // bounce impulse ON TOP — order matters, reflecting after the impulse
      // would flip the bounce back into the wall.
      if (this.grounded) {
        this.speed *= Math.max(0, 1 - 1.5 * dt);
        this.slide *= this.drifting ? -0.35 : -0.45;
      } else {
        this.slide *= -0.4;
      }
      // outward bounce impulse (world → kart-local lateral/forward split)
      const bounce = Math.min(2.6, 1.1 + this.wallHit * 0.1) * (this.grounded ? 1 : 0.55);
      const kx = Math.cos(this.heading), kz = -Math.sin(this.heading); // kart left
      this.slide += (-nx * bounce) * kx + (-nz * bounce) * kz;
      this.speed *= clamp(1 - this.wallHit * 0.012, 0.86, 1);   // gentle scrub
    }

    // v2.0 OPEN TRACK END CAPS: solid walls at the runoff end and behind the
    // start grid — the kart bounces back instead of driving into thin air
    if (data.open && data.seam !== undefined) {
      const eA = data.seam, eB = (data.seam + 1) % N;
      if (this.sIdx === eA || this.sIdx === eB) {
        const sE = data.samples[this.sIdx];
        const al = (this.pos.x - sE.pos.x) * sE.tan.x + (this.pos.z - sE.pos.z) * sE.tan.z;
        if ((this.sIdx === eA && al > -0.4) || (this.sIdx === eB && al < 0.4)) {
          const lim = this.sIdx === eA ? -0.4 : 0.4;
          this.pos.x += sE.tan.x * (lim - al);
          this.pos.z += sE.tan.z * (lim - al);
          if (Math.abs(this.speed) > 2) this.wallHit = Math.max(this.wallHit, Math.abs(this.speed) * 0.5);
          this.speed *= -0.25;
          this.slide *= 0.5;
        }
      }
    }

    // --- vertical / ground follow ---
    // SMOOTH ROAD HEIGHT (user: "at high speed the car looks like it's shaking"):
    // the old code snapped pos.y to the NEAREST spline sample's height. Samples
    // sit ~1.5m apart, so at 30 m/s the kart crossed ~20 height steps per second
    // and the follow-filter turned each step into a visible shudder. We now
    // project the kart onto the track segment (this sample → next/prev sample)
    // and interpolate the road height continuously — butter-smooth at any speed.
    const sampleLen = Math.max(0.4, data.length / N);
    const along = dx2 * s2.tan.x + dz2 * s2.tan.z;   // signed meters along track dir
    let nIdx = along >= 0 ? (this.sIdx + 1) % N : (this.sIdx - 1 + N) % N;
    // v2.0 point-to-point: never interpolate across the dead end
    if (data.open && data.seam !== undefined && ((along >= 0 && this.sIdx === data.seam) || (along < 0 && this.sIdx === (data.seam + 1) % N))) nIdx = this.sIdx;
    const sN = data.samples[nIdx];
    // OFF-ROAD GROUND FIX: far off the road the kart must follow the TERRAIN,
    // not the nearest road sample's height (the old road-sample follow let a
    // kart "sail" over the sea at road height, never triggering the plunge
    // respawn). Road height only applies within a small shoulder band.
    const offRoad = !s2.hasRoad || latAbs2 > halfW2 + 3.5;
    // v1.13 SINK HARDENING (user: "برای همه مپ‌ها ریشه‌یابی کن ببین چرا ماشین
    // میره زیر زمین"): the old acceptance window `|along| < 1.4 × AVERAGE
    // sample spacing` fell back to the TERRAIN height whenever the projection
    // onto the nearest sample exceeded it (tight curves, non-uniform spans,
    // bridge crests). On elevated/hilly sections the terrain under the deck is
    // METRES below the road — the kart instantly plummeted "under the ground".
    // Now: while the kart is on/over the road it ALWAYS rides a road-derived
    // height. The interpolation uses the LOCAL segment length, and when the
    // neighbour sample is unusable we clamp to the nearest sample's deck —
    // terrain can only be picked genuinely OFF the road.
    const localSeg = Math.max(0.5, s2.pos.distanceTo(sN.pos));
    let roadY: number;
    if (!offRoad && sN.hasRoad && Math.abs(along) < Math.max(sampleLen * 1.6, localSeg * 1.9)) {
      // +0.08 = the road quad's own lift above the spline (visual==physics).
      // f ≤ 1 = lerp inside the segment, f > 1 = smooth extrapolation past it.
      const f = clamp(Math.abs(along) / localSeg, 0, 1.9) * Math.sign(along || 1);
      roadY = s2.pos.y + (sN.pos.y - s2.pos.y) * f + 0.08;
    } else if (!offRoad) {
      // on the road but the neighbour is unusable → the nearest deck is the
      // truth (≤ a couple of dm away on any sane map). NEVER the terrain.
      roadY = s2.pos.y + 0.08;
    } else {
      // shoulder band: hug the terrain (was -0.2 → the kart visibly sank into
      // the dirt shoulder; terrain quads render at exactly groundAt)
      roadY = voidBelow ? -9999 : groundBelow - 0.1;
    }
    const prevY = this.pos.y;
    // v2.1 DOWNHILL FIX (user: "داخل مگا مپ ماشین وقتی میاد پایین خوب نمیتونه
    // حرکت کنه"): the old launch test compared the ROAD height against the
    // kart's LAGGED height (exponential follow sits ~0.2m above the deck on a
    // descent) and divided that offset by dt → every downhill frame looked
    // like "the road fell away" and the kart kept launching: 170+ micro-hops
    // per lap, no traction in the air (no drive, no grip), speed bleeding
    // from 77 to 61 km/h exactly on the descents. Now the launch rule uses
    // the ROAD's own vertical velocity (deck height step-to-step): the kart
    // only leaves the ground when following the deck would need a downward
    // acceleration stronger than gravity (a real crest / kicker lip).
    // Road vertical velocity is ANALYTIC: deck slope × speed along the track
    // (the deck height itself is piecewise-linear, so differentiating it per
    // step is noisy → false launches). Launch needs real downward CURVATURE:
    // v² · κ larger than an arcade threshold (only true crests / kickers).
    const slopeT = !offRoad && sN.hasRoad && nIdx !== this.sIdx
      ? ((sN.pos.y - s2.pos.y) / localSeg) * (along >= 0 ? 1 : -1) : 0;   // rise per metre along +tan
    const align = Math.sin(this.heading) * s2.tan.x + Math.cos(this.heading) * s2.tan.z;
    const vt = this.speed * align;                                         // m/s along +tan
    const roadV = clamp(slopeT * vt, -32, 32);
    const roadKnown = !offRoad && roadY > -9000;
    let kappa = 0;
    if (roadKnown) {
      const stp = vt >= 0 ? 1 : -1;
      const j0 = this.sIdx, j1 = j0 + stp, j2 = j0 + 2 * stp;
      const okIdx = (j: number) => data.open ? j >= 0 && j < N : true;
      if (okIdx(j1) && okIdx(j2)) {
        const A = data.samples[j0], B = data.samples[(j1 + N) % N], C = data.samples[(j2 + N) % N];
        const hAB = Math.max(0.5, Math.hypot(B.pos.x - A.pos.x, B.pos.z - A.pos.z));
        const hBC = Math.max(0.5, Math.hypot(C.pos.x - B.pos.x, C.pos.z - B.pos.z));
        if (B.hasRoad && C.hasRoad) kappa = ((C.pos.y - B.pos.y) / hBC - (B.pos.y - A.pos.y) / hAB) / hBC;
      }
    }
    this.prevRoadY = roadY;
    if (this.grounded) this.roadSlope = clamp(slopeT * align, -0.6, 0.6);
    if (this.grounded) {
      if (roadKnown && kappa < 0 && vt * vt * -kappa > 4.5 && Math.abs(this.speed) > 8) {
        this.grounded = false;              // crest / kicker lip → real take-off
        this.vy = Math.max(roadV, 0) + Math.min(3, Math.abs(vt) * 0.09);   // small lip pop
      } else {
        // fast exponential follow merges any remaining micro-steps into a glide
        // feed-forward the deck's own vertical speed first → no lag: the kart
        // no longer floats ~0.3m above the asphalt on long descents
        const followK = Math.min(1, 20 * dt);
        if (roadKnown) this.pos.y += roadV * dt;
        this.pos.y += (roadY - this.pos.y) * followK;
        this.vy = roadKnown ? roadV : clamp((this.pos.y - prevY) / dt, -20, 20);
      }
      // SLOPE GRAVITY: downhill really pulls the kart forward, uphill costs a
      // little speed (arcade-weighted so every climb stays drivable).
      if (this.grounded && slopeT !== 0) {
        const slopeAlongMotion = clamp(slopeT * align * Math.sign(this.speed || 1), -0.6, 0.6);
        const gK = slopeAlongMotion < 0 ? 9.8 * 0.62 : 9.8 * 0.32;
        this.speed -= Math.sign(this.speed || 1) * slopeAlongMotion * gK * dt;
      }
    }
    // GAP FALL-THROUGH (kept for non-road samples; with v1.11 complete roads
    // this is dormant on every stock map)
    if (!s2.hasRoad && !voidBelow && latAbs2 < halfW2 + 2.5
        && this.pos.y < s2.pos.y - 0.8 && this.respawnCooldown <= 0 && !this.finished) {
      this.fx = 'fall'; this.fxT = 0.4;
    }
    if (!this.grounded) {
      this.vy -= 26 * dt;
      this.pos.y += this.vy * dt;
      this.airTime += dt;
      if (this.pos.y <= roadY) {
        this.pos.y = roadY;
        // v2.1: touchdown matches the DECK's vertical velocity (landing on a
        // descent no longer zeroes vy → no instant re-launch / hop chain)
        const deckV = roadKnown ? Math.min(roadV, 0) : 0;
        const impact = -(this.vy - deckV);
        this.grounded = true;
        this.vy = deckV;
        if (impact > 4) { this.fx = 'land'; this.fxT = 0.15; }
        this.landImpact(impact);
        if (this.airTime > 0.35) this.airTime = 0; else this.airTime = 0;
      }
    } else {
      this.airTime = 0;
    }

    // --- fell off world (into void or far below terrain) ---
    if (!s2.hasRoad && !voidBelow && this.pos.y < groundBelow - 6) {
      this.fx = 'fall'; this.fxT = 0.4;
    }
    // v2.0.1 BUGFIX (user: "مگارمپ باگ داره"): void-fall requires being OFF
    // the road deck. A kart riding the deck (on-road sample, within the
    // shoulder band) must NEVER be flagged 'fall' just because the terrain
    // beneath the floating road is void — that false positive caused the
    // endless fall→respawn loop on the Mega Ramp world. Real falls are still
    // caught by the fluid check (sea level) and the pos.y < -16 floor.
    if (this.pos.y < -16 || (voidBelow && offRoad)) {
      this.fx = 'fall'; this.fxT = 0.4;
    }

    // ANTI-SINK GUARD (user v1.11: "مشکل داخل زمین رفتن ماشین رو حل کن و ببین
    // چرا این اتفاق میفته"): the visual terrain is blocky/terraced while the
    // physics height is smooth — far off-road those two can disagree and the
    // kart could grind UNDER the visible ground. If the kart is ever clearly
    // below the terrain surface, pop it back on top instantly.
    if (this.grounded && !voidBelow && this.pos.y < groundBelow - 1.4) {
      this.pos.y = groundBelow + 0.02;
      this.vy = Math.max(this.vy, 0);
    }
    // v1.13 ANTI-SINK ON THE ROAD: same guarantee versus the ROAD DECK — if the
    // kart is within the road corridor but clearly BELOW the deck (the last
    // possible sinking path: a stale fall, an interpolated dip, a respawn
    // edge case), lift it straight back onto the asphalt.
    if (!offRoad && roadY > -9000 && this.pos.y < roadY - 1.2) {
      this.pos.y = roadY + 0.02;
      if (this.vy < 0) this.vy = 0;
      this.grounded = true;
    }

    // --- engine ratio for audio/camera (legacy consumers) ---
    this.engineRatio = this.stallT > 0 ? 0 : clamp(Math.abs(this.speed) / T.maxSpeed, 0, 1.3);

    // --- SUSPENSION: spring-damper on pitch / roll / heave ---
    this.longAccel = (this.speed - this.prevSpeedPhys) / dt;
    this.prevSpeedPhys = this.speed;
    this.stepSuspension(dt, surf.bump);

    void rng;
  }

  /** critically-under-damped springs driven by real accelerations:
   *  braking → nose dives, throttle → rear squats, cornering → body rolls,
   *  landing → compression then rebound, rough surfaces → small bumps. */
  private stepSuspension(dt: number, bump: number) {
    const S = this.susp;
    const m = this.pt.massF;
    const k = 120 / m, c = 13 / Math.sqrt(m);            // heavier = softer, slower
    const pitchT = this.grounded ? clamp(-this.longAccel * 0.0045, -0.06, 0.075) : -0.03;
    const rollT = this.grounded ? clamp(-this.latAccel * 0.0032, -0.1, 0.1) : 0;
    const bumpT = this.grounded && bump > 0
      ? Math.sin(this.trackPos * 2.7) * Math.sin(this.trackPos * 1.13) * bump * 0.02 * clamp(Math.abs(this.speed) / 20, 0, 1)
      : 0;
    S.pitchV += ((pitchT - S.pitch) * k - S.pitchV * c) * dt; S.pitch += S.pitchV * dt;
    S.rollV += ((rollT - S.roll) * k - S.rollV * c) * dt; S.roll += S.rollV * dt;
    S.heaveV += ((bumpT - S.heave) * k * 1.4 - S.heaveV * c) * dt; S.heave += S.heaveV * dt;
    S.pitch = clamp(S.pitch, -0.12, 0.12); S.roll = clamp(S.roll, -0.16, 0.16); S.heave = clamp(S.heave, -0.12, 0.08);
  }
  /** landing impact → heave compression (called on touchdown) */
  private landImpact(impact: number) {
    this.susp.heaveV -= clamp(impact * 0.09, 0, 1.4) / this.pt.massF;
    this.susp.pitchV += clamp(impact * 0.02, 0, 0.3);
  }

  /** external effects */
  applyBoost(seconds: number, power = 1) {
    this.boostT = Math.max(this.boostT, seconds * power);
    this.fx = 'boost'; this.fxT = 0.25;
  }
  /** v3.2 NITRO: instant kick + long, strong burst */
  applyNitro(seconds: number) {
    this.applyBoost(seconds);
    this.nitroT = Math.max(this.nitroT, seconds);
    if (this.grounded && this.speed > 0) this.speed += 4.5;     // the "punch in the back"
    this.overdrive = 1;
  }
  spinOut(power = 1) {
    if (this.shieldT > 0) { this.shieldT = 0; this.fx = 'hit'; this.fxT = 0.2; return false; }
    if (this.invulT > 0 || this.ghostT > 0) return false;
    // MONSTER MODE = DAMAGE RESISTANCE (user v1.9: "داخل حالت هیولا دمیج کمتری
    // بگیرم") — giant karts are no longer FULLY immune (that felt unfair the
    // other way); they resist: spin power halved.
    if (this.giantT > 0) power *= 0.45;
    this.spunT = this.T.spinTime * power;
    this.nitroT = 0;
    this.spinAnim = 0;
    this.drifting = false;
    this.fx = 'spin'; this.fxT = this.T.spinTime;
    return true;
  }
  freeze(seconds: number) {
    if (this.shieldT > 0) { this.shieldT = 0; return false; }
    if (this.invulT > 0 || this.ghostT > 0) return false;
    this.frozenT = seconds * (this.traits.antiFreezeMul ?? 1);
    this.fx = 'hit'; this.fxT = 0.2;
    return true;
  }
  shock(speedLoss: number) {
    if (this.shieldT > 0) { this.shieldT = 0; return false; }
    if (this.invulT > 0 || this.ghostT > 0) return false;
    if (this.giantT > 0) speedLoss = speedLoss * 0.5 + 0.5;   // monster resists speed cuts
    this.speed *= speedLoss;
    // deterministic kick (was Math.random — NO random physics, MP-consistent)
    this.slide += ((Math.floor(this.trackPos) + this.id) % 2 === 0 ? 1 : -1) * 2.4;
    this.fx = 'hit'; this.fxT = 0.2;
    return true;
  }
  /** 💥 EMP ENGINE SHUTDOWN (v1.13, user: "ماشینشونو خاموش کنه — اگه محافظ یا
   *  روح دارن تاثیر نداشته باشه"): full engine stall. Shield/ghost karts are
   *  COMPLETELY unaffected and the shield is NOT consumed (unlike spinOut —
   *  the pulse simply grounds around them). Monster mode halves the duration.
   *  Returns true when the stall took hold. */
  stall(seconds: number): boolean {
    if (this.shieldT > 0 || this.ghostT > 0) return false;
    if (this.invulT > 0) return false;
    const dur = this.giantT > 0 ? seconds * 0.5 : seconds;
    this.stallT = Math.max(this.stallT, dur * (this.traits.antiFreezeMul ?? 1));
    this.fx = 'hit'; this.fxT = 0.2;
    this.drifting = false;
    return true;
  }
  bounce(power: number) {
    this.slide += power;
    this.speed *= 0.82;
    this.fx = 'hit'; this.fxT = 0.15;
  }

  respawn(s: { pos: THREE.Vector3; heading: number }) {
    this.pos.copy(s.pos);
    this.pos.y += 0.5;
    this.heading = s.heading;
    this.prevPos.copy(this.pos);   // no interpolation smear across teleport
    this.prevHeading = this.heading;
    this.speed = 0; this.vy = 0; this.slide = 0;
    this.prevRoadY = NaN;
    this.drifting = false; this.driftCharge = 0; this.driftTier = 0;
    this.grounded = true;
    this.frozenT = 0; this.spunT = 0;
    this.invulT = 1.6;
    this.respawnCooldown = 0.5;
    this.stuckT = 0;
  }
}
