// KUBO KARTS - POWERTRAIN v2 (v1.20): class-based performance profiles,
// engine archetypes, torque curve, RPM, engine load, transmission, surfaces.
//
// DESIGN RULES (user v1.20 spec, sections 6-10 / 27-28 / 34 / 47):
//  • NO fixed "class = X km/h" caps. Top speed EMERGES from the equilibrium of
//    engine drive force vs. aero drag + rolling resistance.
//  • SAME CLASS → SAME CORE PERFORMANCE: every car of a class is calibrated
//    to the class power-to-weight + top-end target. Per-car stats change the
//    FEEL (torque shape, gear count, grip, weight, drift) — not the core.
//  • DIFFERENT CLASS → DIFFERENT TIER: each class has more power + a higher
//    equilibrium speed than the one below. New tiers (D, S, S+ …) are just
//    new rows in CLASS_PROFILES.
//  • Throttle → Engine Load → RPM → Torque → Power → Acceleration → Speed.
//  • Graphics quality NEVER touches any of this (pure fixed-step math).
import type { CarDef, CarTier } from '../data/cars';
import { tierOf } from '../data/cars';

// ---------------------------------------------------------------------------
// CLASS PROFILES — the only place performance tiers are defined.
// vRef: class equilibrium speed on asphalt (m/s) — a CALIBRATION target for
// the drag model, never a clamp. pw: power-to-weight factor (launch punch).
// ---------------------------------------------------------------------------
export interface ClassProfile {
  id: string;
  rank: number;           // ordering (higher = faster tier)
  vRef: number;           // equilibrium speed target (m/s) on asphalt, no boost
  pw: number;             // peak drive accel potential in 1st gear (m/s²)
  hearts: number;         // half-hearts of health
  /** time (s) to reach 80 % of the class equilibrium speed — every car of the
   *  class is CALIBRATED to this, whatever its torque shape (core parity) */
  t80: number;
}
export const CLASS_PROFILES: Record<string, ClassProfile> = {
  // v3.2 FULL SPEED REDESIGN (user: "سرعت همه ماشین‌ها از نو طراحی بشه … سرعت
  // ماشین‌های رده پایین خیلی بده … هر سری یا هر گروه ماشین اختلاف جزئی داشته
  // باشن، مثل بازی‌های ماشینی"). Like real racing games:
  //  • the STARTER tier is already fun-fast (≈98 km/h, was 90)
  //  • each tier is a clear but modest step (~5 %): C 98 → B 103 → A 108 → S 114
  //  • inside a tier every car sits on a small ladder (up to +3 %, car.lad)
  //  • every SERIES (speed / accel / drift / heavy / balanced) has its own
  //    small personality: top-end vs launch (see SERIES below)
  //  • launch got quicker for everyone (t80 3.9 s → 3.5 s for starters)
  C: { id: 'C', rank: 1, vRef: 27.2, pw: 13.6, hearts: 6, t80: 3.5 },
  B: { id: 'B', rank: 2, vRef: 28.6, pw: 14.2, hearts: 8, t80: 3.4 },
  A: { id: 'A', rank: 3, vRef: 30.0, pw: 14.8, hearts: 10, t80: 3.3 },
  S: { id: 'S', rank: 4, vRef: 31.6, pw: 15.6, hearts: 12, t80: 3.1 },
};
/** series personality: [top-speed multiplier, launch-time multiplier] */
export const SERIES: Record<string, [number, number]> = {
  speed: [1.012, 1.04],      // highest top end, lazier launch
  accel: [0.994, 0.9],       // rockets off the line, a hair less top end
  drift: [1.0, 0.98],
  heavy: [0.99, 1.06],       // tanks: slow to wind up
  balanced: [1.004, 1.0],
};
/** intra-tier ladder: car.lad 0..1 → up to +3 % top speed */
export const TIER_SPREAD = 0.03;
export function tierLadder(def: CarDef): number {
  if (typeof def.lad === 'number') return Math.max(0, Math.min(1, def.lad));
  return 0.5;
}
export function classOf(def: CarDef): ClassProfile {
  return CLASS_PROFILES[tierOf(def) as CarTier] ?? CLASS_PROFILES.C;
}

// ---------------------------------------------------------------------------
// ENGINE ARCHETYPES — per-car engine personality (physics + audio).
// ---------------------------------------------------------------------------
export type EngineKind = 'light' | 'sport' | 'muscle' | 'heavy' | 'electric' | 'offroad' | 'hyper';

export interface EngineProfile {
  kind: EngineKind;
  idleRpm: number;
  redline: number;
  /** normalized rpm (0..1 of redline) where torque peaks */
  torquePeak: number;
  /** torque curve sharpness (higher = peakier / narrower band) */
  torqueWidth: number;
  gears: number;
  /** ratio spread 1st:top */
  spread: number;
  shiftTime: number;       // s — torque cut during a shift
  revRate: number;         // how quickly the free engine revs (1/s)
  // ---- audio character ----
  cylinders: number;       // firing-order pulses per rev /2 → base frequency
  harmonics: number[];     // relative strength of harmonic 1..n
  exhaust: number;         // exhaust rasp amount 0..1
  intake: number;          // intake/induction hiss 0..1
  mech: number;            // mechanical whine/roughness 0..1
  lumpy: number;           // idle lope 0..1
  electric: boolean;       // motor whine instead of combustion
  pops: number;            // overrun crackle probability on lift-off 0..1
}

const ENGINES: Record<EngineKind, EngineProfile> = {
  light:    { kind: 'light', idleRpm: 1400, redline: 9500, torquePeak: 0.66, torqueWidth: 1.8, gears: 5, spread: 3.3, shiftTime: 0.11, revRate: 9, cylinders: 2, harmonics: [1, 0.55, 0.3, 0.12], exhaust: 0.45, intake: 0.5, mech: 0.35, lumpy: 0.25, electric: false, pops: 0.15 },
  sport:    { kind: 'sport', idleRpm: 1000, redline: 8500, torquePeak: 0.72, torqueWidth: 2.0, gears: 6, spread: 3.6, shiftTime: 0.09, revRate: 8, cylinders: 6, harmonics: [1, 0.7, 0.45, 0.25, 0.12], exhaust: 0.6, intake: 0.55, mech: 0.3, lumpy: 0.1, electric: false, pops: 0.35 },
  muscle:   { kind: 'muscle', idleRpm: 750, redline: 6500, torquePeak: 0.42, torqueWidth: 1.4, gears: 4, spread: 2.9, shiftTime: 0.16, revRate: 5.5, cylinders: 8, harmonics: [1, 0.85, 0.35, 0.3, 0.1], exhaust: 0.95, intake: 0.35, mech: 0.25, lumpy: 0.85, electric: false, pops: 0.5 },
  heavy:    { kind: 'heavy', idleRpm: 700, redline: 5500, torquePeak: 0.38, torqueWidth: 1.3, gears: 5, spread: 3.4, shiftTime: 0.18, revRate: 4.5, cylinders: 6, harmonics: [1, 0.9, 0.5, 0.2], exhaust: 0.7, intake: 0.25, mech: 0.6, lumpy: 0.5, electric: false, pops: 0.1 },
  electric: { kind: 'electric', idleRpm: 0, redline: 14000, torquePeak: 0.08, torqueWidth: 0.9, gears: 1, spread: 1, shiftTime: 0, revRate: 14, cylinders: 0, harmonics: [1, 0.35, 0.18], exhaust: 0, intake: 0.1, mech: 0.2, lumpy: 0, electric: true, pops: 0 },
  offroad:  { kind: 'offroad', idleRpm: 850, redline: 7000, torquePeak: 0.5, torqueWidth: 1.5, gears: 5, spread: 3.5, shiftTime: 0.14, revRate: 6, cylinders: 4, harmonics: [1, 0.6, 0.5, 0.3], exhaust: 0.55, intake: 0.3, mech: 0.85, lumpy: 0.45, electric: false, pops: 0.2 },
  hyper:    { kind: 'hyper', idleRpm: 1100, redline: 9000, torquePeak: 0.7, torqueWidth: 1.7, gears: 7, spread: 3.8, shiftTime: 0.07, revRate: 10, cylinders: 12, harmonics: [1, 0.6, 0.55, 0.35, 0.2, 0.1], exhaust: 0.7, intake: 0.7, mech: 0.35, lumpy: 0.05, electric: false, pops: 0.45 },
};

/** map a car to its engine personality (style / class / model hints) */
export function engineKindOf(def: CarDef): EngineKind {
  const st = def.model.style;
  if (st === 'ev' || def.id.includes('hover') || def.id === 'kart_ev') return 'electric';
  if (st === 'muscle') return 'muscle';
  if (st === 'bugatti' || st === 'mclaren' || st === 'lambo' || st === 'f40') return 'hyper';
  if (st === 'gt' || st === 'porsche' || st === 'aston' || st === 'wedge2') return 'sport';
  if (def.id.includes('buggy')) return 'offroad';
  if (def.cls === 'heavy' || def.id.includes('truck')) return 'heavy';
  if (tierOf(def) === 'A' || tierOf(def) === 'S') return 'hyper';
  if (tierOf(def) === 'B') return 'sport';
  return 'light';
}
export function engineProfileOf(def: CarDef): EngineProfile {
  const base = ENGINES[engineKindOf(def)];
  // tiny per-car detune so two cars of one archetype never sound identical
  let h = 0; for (let i = 0; i < def.id.length; i++) h = (h * 31 + def.id.charCodeAt(i)) | 0;
  const d = ((h >>> 0) % 1000) / 1000;           // 0..1 deterministic
  return { ...base, redline: Math.round(base.redline * (0.96 + d * 0.08)), idleRpm: Math.round(base.idleRpm * (0.95 + d * 0.1)) };
}

// ---------------------------------------------------------------------------
// SURFACES — grip, rolling resistance, drift behaviour, audio/VFX family.
// ---------------------------------------------------------------------------
export type SurfaceId = 'asphalt' | 'dirt' | 'grass' | 'stone' | 'ice' | 'snow' | 'wood' | 'sand' | 'mud';
export interface SurfaceDef { grip: number; roll: number; driftSlip: number; bump: number; tire: 'squeal' | 'gravel' | 'soft' | 'ice' | 'wood' }
export const SURFACES: Record<SurfaceId, SurfaceDef> = {
  asphalt: { grip: 1.0,  roll: 0.0,  driftSlip: 1.0,  bump: 0.0,  tire: 'squeal' },
  stone:   { grip: 0.94, roll: 0.25, driftSlip: 1.05, bump: 0.25, tire: 'squeal' },
  wood:    { grip: 0.9,  roll: 0.2,  driftSlip: 1.1,  bump: 0.35, tire: 'wood' },
  dirt:    { grip: 0.78, roll: 1.9,  driftSlip: 1.25, bump: 0.5,  tire: 'gravel' },
  grass:   { grip: 0.72, roll: 3.0,  driftSlip: 1.3,  bump: 0.4,  tire: 'soft' },
  sand:    { grip: 0.66, roll: 3.6,  driftSlip: 1.35, bump: 0.45, tire: 'gravel' },
  mud:     { grip: 0.6,  roll: 3.6,  driftSlip: 1.4,  bump: 0.6,  tire: 'soft' },
  snow:    { grip: 0.62, roll: 2.0,  driftSlip: 1.45, bump: 0.3,  tire: 'soft' },
  ice:     { grip: 0.45, roll: 0.3,  driftSlip: 1.8,  bump: 0.1,  tire: 'ice' },
};
/** road + off-road surface per world theme */
export function surfacesForTheme(themeId: string, lowGrip = false): { road: SurfaceId; off: SurfaceId } {
  let r: { road: SurfaceId; off: SurfaceId };
  switch (themeId) {
    case 'snow': r = { road: 'snow', off: 'snow' }; break;
    case 'desert': r = { road: 'asphalt', off: 'sand' }; break;
    case 'ruins': r = { road: 'stone', off: 'sand' }; break;
    case 'volcano': case 'cave': case 'castle': r = { road: 'stone', off: 'dirt' }; break;
    case 'jungle': r = { road: 'dirt', off: 'mud' }; break;
    case 'sky': r = { road: 'wood', off: 'grass' }; break;
    case 'city': case 'crashcity': case 'mccity': r = { road: 'asphalt', off: 'stone' }; break;
    default: r = { road: 'asphalt', off: 'grass' };
  }
  if (lowGrip) r = { road: 'ice', off: 'snow' };
  return r;
}

// ---------------------------------------------------------------------------
// POWERTRAIN — per-kart state machine (fixed-step, deterministic).
// ---------------------------------------------------------------------------
export interface PowertrainTune {
  /** engine upgrade level 0..5 → broader torque + slightly more power */
  engine: number;
  /** turbo level 0..5 → boost thrust response */
  turbo: number;
}

const RES_ROLL = 0.55;      // base rolling resistance (m/s²)

export class Powertrain {
  eng: EngineProfile;
  cls: ClassProfile;
  ratios: number[] = [];    // rpm per (m/s) for each gear
  gear = 1;                 // 1-based; 0 = neutral, -1 = reverse
  rpm = 800;
  rpmN = 0;                 // rpm / redline (0..1+)
  load = 0;                 // engine load 0..1 (throttle × torque demand)
  throttle = 0;             // smoothed pedal 0..1
  shiftT = 0;               // >0 while shifting (torque cut)
  lastShift = 0;            // +1 upshift, -1 downshift (consumed by audio)
  shiftSeq = 0;             // increments on every shift (audio edge detect)
  limiter = false;          // bouncing off the rev limiter
  /** drive scale K (m/s² at τ=1 in top gear) — calibrated per car */
  K = 3.5;
  cDrag = 0.004;            // aero drag coefficient (per mass)
  boostThrust = 0;          // extra thrust while boosting (m/s²)
  massF = 1;                // relative mass (1 = class norm)
  /** calibrated equilibrium top speed on asphalt (m/s) — derived, not a cap */
  vTop = 25;
  vTopBoost = 32;

  constructor(def: CarDef, tune: PowertrainTune = { engine: 0, turbo: 0 }, boostMul = 1.3) {
    this.eng = engineProfileOf(def);
    this.cls = classOf(def);
    const s = def.stats;
    this.massF = 0.85 + s.weight * 0.03;         // weight 5 → 1.0
    // equal core performance per class: target vRef is the CLASS value; a car
    // may deviate by at most ±1.2 % from speed/accel flavour (feel, not tier)
    const flavour = ((s.speed - s.accel) / 10) * 0.006;
    const up = 1 + tune.engine * 0.008;           // garage engine: +0.8 %/lvl
    const ladder = 1 + tierLadder(def) * TIER_SPREAD;
    const ser = SERIES[def.cls] ?? [1, 1];
    this.vTop = this.cls.vRef * (1 + flavour) * ladder * up * ser[0];
    this.buildGears();
    // CORE PARITY: find the launch strength that gives this car the class
    // t80 (±1.5 % flavour, garage engine upgrade −1 %/lvl). An EV's instant
    // torque, a muscle car's low-end shove and a hypercar's top-end rush all
    // integrate to the SAME class acceleration — they just FEEL different.
    const t80Target = this.cls.t80 * (SERIES[def.cls]?.[1] ?? 1) * (1 + flavour) * (1 - tune.engine * 0.01);
    let lo = this.cls.pw * 0.4, hi = this.cls.pw * 2.5;
    for (let i = 0; i < 26; i++) {
      const m = (lo + hi) / 2;
      this.calibrate(m);
      if (this.timeTo80() > t80Target) lo = m; else hi = m;
    }
    this.calibrate((lo + hi) / 2);
    this.vTopBoost = this.vTop * boostMul * (1 + tune.turbo * 0.006);
    // boost thrust: the extra force that moves the equilibrium to vTopBoost
    this.boostThrust = this.resist(this.vTopBoost, 0) - this.driveAt(this.vTopBoost, 1, 0).a * 0.6;
    this.rpm = this.eng.idleRpm || 0;
  }

  /** normalized torque curve τ(r), r = rpm/redline. Peaks at 1.0. */
  torque(r: number): number {
    const E = this.eng;
    if (E.electric) {
      // EV: flat torque, then constant-power fall-off (τ ∝ 1/r)
      return r < 0.35 ? 1 : Math.max(0.12, 0.35 / r);
    }
    const x = (r - E.torquePeak) * E.torqueWidth;
    let t = Math.exp(-x * x);                      // bell around the peak
    t = 0.42 + 0.58 * t;                           // engines never make zero torque in-band
    if (r > 0.94) t *= Math.max(0, 1 - (r - 0.94) * 9);   // fall-off into redline
    if (r < 0.12) t *= 0.55 + r * 3.7;            // bogging near idle
    return t;
  }

  private buildGears() {
    const E = this.eng;
    const n = Math.max(1, E.gears);
    // top gear reaches ~84 % of redline at vTop (headroom for boost/draft)
    const topRatio = (E.redline * (E.electric ? 0.78 : 0.84)) / this.vTop;
    this.ratios = [];
    for (let i = 0; i < n; i++) {
      const k = n === 1 ? 0 : (n - 1 - i) / (n - 1);
      this.ratios.push(topRatio * Math.pow(E.spread, k));
    }
  }

  /** drive acceleration at speed v in the BEST gear (or given gear) */
  driveAt(v: number, throttle: number, gearIdx: number | null = null): { a: number; rpm: number } {
    const n = this.ratios.length;
    let best = { a: 0, rpm: 0 };
    const gears = gearIdx === null ? [...Array(n).keys()] : [gearIdx];
    for (const g of gears) {
      const ratio = this.ratios[g];
      const rpm = Math.max(this.eng.idleRpm, Math.abs(v) * ratio);
      const r = rpm / this.eng.redline;
      if (r > 1.02) continue;
      const a = throttle * this.K * this.torque(r) * (ratio / this.ratios[n - 1]) / this.massF;
      if (a > best.a) best = { a, rpm };
    }
    return best;
  }

  /** resistive deceleration: rolling + aero + surface (m/s²) */
  resist(v: number, surfRoll: number): number {
    const av = Math.abs(v);
    return (RES_ROLL + surfRoll * Math.min(1, av / 4)) + this.cDrag * av * av;
  }

  /** calibrate K + cDrag so (a) 1st-gear peak accel ≈ launch and (b) the
   *  top-gear equilibrium lands at vTop. Top speed is therefore a PROPERTY of
   *  the force balance, not a clamp. */
  private calibrate(launch: number) {
    const n = this.ratios.length;
    const spreadAct = this.ratios[0] / this.ratios[n - 1];
    // peak torque in 1st (τ≈1) → K·spread/mass = launch
    this.K = (launch * this.massF) / (spreadAct * 1.0);
    // equilibrium at vTop in top gear
    const rTop = (this.vTop * this.ratios[n - 1]) / this.eng.redline;
    const aTop = this.K * this.torque(rTop) / this.massF;
    this.cDrag = Math.max(0.0008, (aTop - RES_ROLL) / (this.vTop * this.vTop));
  }

  /** quick deterministic sim: seconds to 80 % of vTop from standstill */
  private timeTo80(): number {
    const save = { g: this.gear, r: this.rpm, t: this.throttle, s: this.shiftT, q: this.shiftSeq };
    this.gear = 1; this.rpm = this.eng.idleRpm; this.throttle = 1; this.shiftT = 0;
    let v = 0, t = 0; const dt = 1 / 30;
    while (t < 14 && v < this.vTop * 0.8) {
      const a = this.step(dt, v, 1, { boost: false, stalled: false, grounded: true, wheelSlip: 0, reverse: false });
      v += (a - this.resist(v, 0)) * dt; t += dt;
    }
    this.gear = save.g; this.rpm = save.r; this.throttle = save.t; this.shiftT = save.s; this.shiftSeq = save.q;
    return t;
  }

  /** equilibrium speed on a surface (bisection) — used for HUD/AI reference */
  equilibrium(surfRoll: number, boost = false): number {
    let lo = 0, hi = this.vTopBoost * 1.5;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      const net = this.driveAt(m, 1).a + (boost ? this.boostThrust : 0) - this.resist(m, surfRoll);
      if (net > 0) lo = m; else hi = m;
    }
    return lo;
  }

  /**
   * One fixed step. Returns the longitudinal acceleration from the engine
   * (drive − engine-braking). Resistances are applied by the caller.
   */
  step(dt: number, v: number, throttleIn: number, opts: { boost: boolean; stalled: boolean; grounded: boolean; wheelSlip: number; reverse: boolean }): number {
    const E = this.eng;
    const n = this.ratios.length;
    // pedal smoothing (no digital on/off feel for audio + load)
    this.throttle += (throttleIn - this.throttle) * Math.min(1, dt * 14);
    if (opts.stalled) {
      this.rpm += (0 - this.rpm) * Math.min(1, dt * 3);
      this.rpmN = this.rpm / E.redline; this.load = 0; this.limiter = false;
      return 0;
    }
    if (opts.reverse) {
      this.gear = -1;
      const target = E.idleRpm + Math.abs(v) * this.ratios[0] * 0.9;
      this.rpm += (target - this.rpm) * Math.min(1, dt * 10);
      this.rpmN = this.rpm / E.redline;
      this.load = this.throttle * 0.6;
      return 0;
    }
    if (this.gear < 1) this.gear = 1;
    const av = Math.max(0, v);

    // ---- automatic transmission ----
    if (this.shiftT > 0) this.shiftT -= dt;
    else if (n > 1) {
      const rNow = (av * this.ratios[this.gear - 1]) / E.redline;
      if (this.gear < n && rNow > 0.93 && this.throttle > 0.3) {
        this.gear++; this.shiftT = E.shiftTime; this.lastShift = 1; this.shiftSeq++;
      } else if (this.gear > 1) {
        const rDown = (av * this.ratios[this.gear - 2]) / E.redline;
        if (rDown < (this.throttle > 0.5 ? 0.78 : 0.55)) {
          this.gear--; this.shiftT = E.shiftTime * 0.8; this.lastShift = -1; this.shiftSeq++;
        }
      }
    }
    const ratio = this.ratios[this.gear - 1];

    // ---- RPM: locked to wheels, clutch-slip near standstill, wheelspin ----
    const wheelRpm = av * ratio;
    const launchRpm = E.idleRpm + this.throttle * E.redline * (E.electric ? 0 : 0.42);
    let target = Math.max(wheelRpm, av < 7 ? launchRpm * (1 - av / 7) + wheelRpm * (av / 7) : wheelRpm, E.idleRpm);
    target += opts.wheelSlip * E.redline * 0.12 * this.throttle;       // drift / wheelspin flare
    if (!opts.grounded) target = E.idleRpm + this.throttle * E.redline * 0.95; // free rev in the air
    if (this.shiftT > 0) target *= this.lastShift > 0 ? 0.985 : 1.02;   // brief hang, then drop
    const rate = opts.grounded ? 22 : E.revRate;
    this.rpm += (target - this.rpm) * Math.min(1, dt * rate);
    this.limiter = this.rpm >= E.redline * 0.995 && this.throttle > 0.5;
    if (this.limiter) this.rpm = E.redline * (0.985 + ((this.shiftSeq + Math.floor(this.rpm)) % 2) * 0.012);
    this.rpmN = this.rpm / E.redline;

    // ---- torque → drive acceleration ----
    const r = Math.min(1.05, Math.max(0.01, (Math.max(wheelRpm, E.idleRpm)) / E.redline));
    const tq = this.torque(r);
    let a = this.throttle * this.K * tq * (ratio / this.ratios[n - 1]) / this.massF;
    if (wheelRpm > E.redline * 1.0) a = 0;                 // limiter: no drive past redline
    if (this.shiftT > 0) a *= 0.15;                        // torque cut during the shift
    if (opts.boost) a += this.boostThrust * (0.8 + this.throttle * 0.2);
    // engine braking when off-throttle (stronger in low gears)
    const engBrake = (1 - this.throttle) * 0.9 * (ratio / this.ratios[n - 1]) * Math.min(1, av / 3) / this.massF;
    // engine load: how hard the engine is working vs. what it could give
    this.load = Math.min(1, this.throttle * (0.35 + 0.65 * tq) + (opts.boost ? 0.25 : 0));
    return a - (E.electric ? engBrake * 0.6 : engBrake);
  }
}
