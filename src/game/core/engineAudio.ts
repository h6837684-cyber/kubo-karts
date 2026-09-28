// KUBO KARTS - ENGINE AUDIO v4 (v1.20): layered, profile-driven engine voices
// + tire voice (rolling / drift / brake per surface). Pure WebAudio synthesis.
//
// Layers per LOCAL engine voice (spec §8):
//   1 idle     – combustion pulse, lumpy lope, slow random drift (never a loop)
//   2 low      – body band (lowpass)          ┐ equal-power crossfade by RPM
//   3 mid      – mid band (bandpass)          │ → the timbre CHANGES with revs,
//   4 high     – upper band (bandpass)        │   not just the pitch
//   5 redline  – rasp band + limiter chop     ┘
//   6 load     – extra waveshaper drive, scales with ENGINE LOAD (throttle × torque)
//   7 exhaust  – noise gated by the firing rate (real pulse), louder on load/boost
//   8 intake   – high hiss, throttle-dependent, cut on each gear shift
//   9 mech     – gear whine + valvetrain roughness
//  10 wind     – speed² air noise
// Electric profiles swap 1-7 for a motor/inverter whine.
// Everything is driven by: RPM, throttle, load, speed, gear, boost, drift.
import type { EngineProfile, SurfaceId } from '../kart/powertrain';
import { SURFACES } from '../kart/powertrain';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export interface EngineState {
  rpm: number;          // absolute rpm
  rpmN: number;         // rpm / redline
  throttle: number;     // 0..1
  load: number;         // 0..1
  speed: number;        // m/s
  gear: number;
  boost: boolean;
  drift: boolean;
  limiter: boolean;
  dead: boolean;
  shiftSeq: number;     // increments on every shift
  lastShift: number;    // +1 up / -1 down
}

function shaperCurve(drive: number): Float32Array {
  const n = 512; const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(drive * x) / Math.tanh(drive); }
  return c;
}

export class EngineVoice {
  private ctx: AudioContext;
  readonly out: GainNode;
  private pan: StereoPannerNode | null = null;
  private tone: GainNode;           // distance/occlusion brightness is applied here
  private toneLP: BiquadFilterNode;
  private oscs: OscillatorNode[] = [];
  private srcs: AudioBufferSourceNode[] = [];
  private harm: { o: OscillatorNode; g: GainNode; n: number }[] = [];
  private bands: { f: BiquadFilterNode; g: GainNode }[] = [];
  private loadGain!: GainNode; private loadShaper!: WaveShaperNode;
  private exhGain!: GainNode; private exhBP!: BiquadFilterNode; private exhGate!: GainNode; private exhLfo!: OscillatorNode;
  private intakeGain!: GainNode; private intakeBP!: BiquadFilterNode;
  private mechO!: OscillatorNode; private mechGain!: GainNode;
  private windGain!: GainNode; private windBP!: BiquadFilterNode;
  private idleLfo!: OscillatorNode; private idleDepth!: GainNode;
  private chopO: OscillatorNode | null = null; private chopD: GainNode | null = null;
  private evWhine: OscillatorNode | null = null; private evWhine2: OscillatorNode | null = null; private evGain: GainNode | null = null;
  private lastShiftSeq = 0;
  private prevThrottle = 0;
  private idleWander = 0;
  private idleWanderT = 0;
  private startT = -1;              // engine-start sequence clock
  readonly simple: boolean;
  alive = true;

  constructor(ctx: AudioContext, dest: AudioNode, private noise: AudioBuffer, readonly prof: EngineProfile, opts: { simple?: boolean; spatial?: boolean } = {}) {
    this.ctx = ctx;
    this.simple = !!opts.simple;
    const t = ctx.currentTime;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.tone = ctx.createGain(); this.tone.gain.value = 1;
    this.toneLP = ctx.createBiquadFilter(); this.toneLP.type = 'lowpass'; this.toneLP.frequency.value = 16000; this.toneLP.Q.value = 0.5;
    this.tone.connect(this.toneLP); this.toneLP.connect(this.out);
    if (opts.spatial && typeof ctx.createStereoPanner === 'function') {
      this.pan = ctx.createStereoPanner(); this.out.connect(this.pan); this.pan.connect(dest);
    } else this.out.connect(dest);

    const P = prof;
    if (!P.electric) {
      // ---- combustion core: harmonic stack of the firing frequency ----
      const core = ctx.createGain(); core.gain.value = 1;
      const hs = this.simple ? P.harmonics.slice(0, 2) : P.harmonics;
      hs.forEach((amp, i) => {
        const o = ctx.createOscillator(); o.type = i === 0 ? 'sawtooth' : (i % 2 ? 'square' : 'triangle');
        const g = ctx.createGain(); g.gain.value = amp * (i === 0 ? 0.5 : 0.22);
        o.connect(g); g.connect(core); o.start(t);
        this.harm.push({ o, g, n: i + 1 }); this.oscs.push(o);
      });
      // idle lope LFO on the core level
      this.idleLfo = ctx.createOscillator(); this.idleLfo.type = 'sine'; this.idleLfo.frequency.value = 6;
      this.idleDepth = ctx.createGain(); this.idleDepth.gain.value = 0;
      this.idleLfo.connect(this.idleDepth); this.idleDepth.connect(core.gain); this.idleLfo.start(t); this.oscs.push(this.idleLfo);
      // soft clip
      const sh = ctx.createWaveShaper(); sh.curve = shaperCurve(1.8 + P.exhaust); sh.oversample = this.simple ? 'none' : '2x';
      core.connect(sh);
      // RPM bands: idle/low, mid, high, redline
      const bandDefs: [BiquadFilterType, number, number][] = this.simple
        ? [['lowpass', 700, 0.7]]
        : [['lowpass', 260, 0.8], ['bandpass', 700, 1.1], ['bandpass', 1700, 1.3], ['highpass', 3000, 0.9]];
      for (const [type, f, q] of bandDefs) {
        const bf = ctx.createBiquadFilter(); bf.type = type; bf.frequency.value = f; bf.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        sh.connect(bf); bf.connect(g); g.connect(this.tone);
        this.bands.push({ f: bf, g });
      }
      // limiter chop (redline bounce) — AM on the whole voice
      if (!this.simple) {
        this.chopO = ctx.createOscillator(); this.chopO.type = 'square'; this.chopO.frequency.value = 14;
        this.chopD = ctx.createGain(); this.chopD.gain.value = 0;
        this.chopO.connect(this.chopD); this.chopD.connect(this.tone.gain); this.chopO.start(t); this.oscs.push(this.chopO);
      }
      // load layer: harder drive path
      this.loadShaper = ctx.createWaveShaper(); this.loadShaper.curve = shaperCurve(5); this.loadShaper.oversample = 'none';
      const loadBP = ctx.createBiquadFilter(); loadBP.type = 'bandpass'; loadBP.frequency.value = 900; loadBP.Q.value = 0.9;
      this.loadGain = ctx.createGain(); this.loadGain.gain.value = 0;
      core.connect(this.loadShaper); this.loadShaper.connect(loadBP); loadBP.connect(this.loadGain); this.loadGain.connect(this.tone);
      // exhaust: noise gated at the firing rate
      const ex = this.noiseSrc(0.8);
      this.exhBP = ctx.createBiquadFilter(); this.exhBP.type = 'bandpass'; this.exhBP.frequency.value = 180; this.exhBP.Q.value = 1.2;
      this.exhGate = ctx.createGain(); this.exhGate.gain.value = 0.5;
      this.exhLfo = ctx.createOscillator(); this.exhLfo.type = 'square'; this.exhLfo.frequency.value = 30;
      const exhLfoD = ctx.createGain(); exhLfoD.gain.value = 0.5;
      this.exhLfo.connect(exhLfoD); exhLfoD.connect(this.exhGate.gain); this.exhLfo.start(t); this.oscs.push(this.exhLfo);
      this.exhGain = ctx.createGain(); this.exhGain.gain.value = 0;
      ex.connect(this.exhBP); this.exhBP.connect(this.exhGate); this.exhGate.connect(this.exhGain); this.exhGain.connect(this.tone);
    } else {
      // ---- electric motor: main whine + inverter tone ----
      this.evGain = ctx.createGain(); this.evGain.gain.value = 0;
      this.evWhine = ctx.createOscillator(); this.evWhine.type = 'triangle'; this.evWhine.frequency.value = 120;
      this.evWhine2 = ctx.createOscillator(); this.evWhine2.type = 'sine'; this.evWhine2.frequency.value = 2400;
      const g2 = ctx.createGain(); g2.gain.value = 0.25;
      this.evWhine.connect(this.evGain); this.evWhine2.connect(g2); g2.connect(this.evGain);
      this.evGain.connect(this.tone);
      this.evWhine.start(t); this.evWhine2.start(t); this.oscs.push(this.evWhine, this.evWhine2);
    }
    // intake hiss
    if (!this.simple) {
      const it = this.noiseSrc(1.1);
      this.intakeBP = ctx.createBiquadFilter(); this.intakeBP.type = 'bandpass'; this.intakeBP.frequency.value = 2600; this.intakeBP.Q.value = 0.8;
      this.intakeGain = ctx.createGain(); this.intakeGain.gain.value = 0;
      it.connect(this.intakeBP); this.intakeBP.connect(this.intakeGain); this.intakeGain.connect(this.tone);
      // mechanical whine (gearbox) + valvetrain
      this.mechO = ctx.createOscillator(); this.mechO.type = 'sawtooth'; this.mechO.frequency.value = 400;
      const mBP = ctx.createBiquadFilter(); mBP.type = 'bandpass'; mBP.frequency.value = 2200; mBP.Q.value = 4;
      this.mechGain = ctx.createGain(); this.mechGain.gain.value = 0;
      this.mechO.connect(mBP); mBP.connect(this.mechGain); this.mechGain.connect(this.tone); this.mechO.start(t); this.oscs.push(this.mechO);
      // wind
      const w = this.noiseSrc(0.9);
      this.windBP = ctx.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 700; this.windBP.Q.value = 0.5;
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      w.connect(this.windBP); this.windBP.connect(this.windGain); this.windGain.connect(this.out);
    }
  }

  private noiseSrc(rate: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    s.playbackRate.value = rate; s.loopStart = Math.random() * 4; s.start(this.ctx.currentTime, Math.random() * 5);
    this.srcs.push(s); return s;
  }

  /** ENGINE START: starter-motor whirr → catch → rev flare → idle (§12) */
  playStart() {
    this.startT = 0;
    if (this.prof.electric) return;
    const ctx = this.ctx; const t = ctx.currentTime;
    // starter: pulsed low buzz
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(38, t); o.frequency.linearRampToValueAtTime(55, t + 0.55);
    const am = ctx.createOscillator(); am.type = 'square'; am.frequency.value = 11;
    const amD = ctx.createGain(); amD.gain.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.05);
    g.gain.setValueAtTime(0.09, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    am.connect(amD); amD.connect(g.gain); o.connect(lp); lp.connect(g); g.connect(this.out);
    o.start(t); am.start(t); o.stop(t + 0.7); am.stop(t + 0.7);
  }

  /** stereo pan + distance attenuation + brightness (remote karts / 3D) */
  setSpatial(pan: number, gain: number, bright: number) {
    const t = this.ctx.currentTime;
    if (this.pan) this.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.08);
    this.tone.gain.setTargetAtTime(clamp(gain, 0, 1.2), t, 0.1);
    this.toneLP.frequency.setTargetAtTime(clamp(bright, 400, 16000), t, 0.12);
  }

  update(st: EngineState, dt: number, masterGain = 1) {
    if (!this.alive) return;
    const vals = [st.rpm, st.rpmN, st.throttle, st.load, st.speed];
    if (!vals.every(Number.isFinite)) return;   // NaN guard (never poison the graph)
    const ctx = this.ctx; const t = ctx.currentTime; const P = this.prof;
    let rpm = st.rpm, rN = st.rpmN;
    // engine-start sequence overrides the first ~1.1 s
    if (this.startT >= 0) {
      this.startT += dt;
      const s = this.startT;
      if (s < 0.55) { rpm = 0; rN = 0; }
      else if (s < 0.85) { rN = 0.18 + (s - 0.55) * 1.2; rpm = rN * P.redline; }
      else if (s < 1.4) { rN = Math.max(st.rpmN, 0.54 - (s - 0.85) * 0.7); rpm = rN * P.redline; }
      else this.startT = -1;
    }
    const alive = !st.dead && (this.startT < 0 || this.startT >= 0.55);
    this.out.gain.setTargetAtTime(alive ? masterGain : 0, t, st.dead ? 0.15 : 0.06);
    if (!alive) return;

    // idle wander: tiny random-walk on idle rpm so idle never loops exactly
    this.idleWanderT -= dt;
    if (this.idleWanderT <= 0) { this.idleWanderT = 0.25 + Math.random() * 0.5; this.idleWander = (Math.random() - 0.5) * 0.06; }
    const idleness = clamp(1 - (rN - P.idleRpm / P.redline) * 6, 0, 1);
    rpm *= 1 + this.idleWander * idleness;

    const thr = st.throttle, load = st.load;
    const k = 0.045;                                    // smoothing time-constant

    if (!P.electric) {
      const fire = Math.max(8, (rpm / 60) * (P.cylinders / 2));   // firing frequency (Hz)
      const wob = st.drift ? Math.sin(t * 17) * 0.012 : 0;
      for (const h of this.harm) h.o.frequency.setTargetAtTime(fire * h.n * (1 + wob), t, k);
      // RPM-band crossfade (equal power)
      if (this.bands.length === 4) {
        const centers = [0.12, 0.4, 0.7, 0.98];
        const w = centers.map(c => Math.max(0, 1 - Math.abs(rN - c) / 0.32));
        const sum = Math.sqrt(w.reduce((a, b) => a + b * b, 0)) || 1;
        const lvl = 0.07 + load * 0.05 + (st.boost ? 0.02 : 0);
        const gains = [1.25, 1.0, 0.8, 0.55 + P.exhaust * 0.3];
        this.bands.forEach((b, i) => b.g.gain.setTargetAtTime((w[i] / sum) * lvl * gains[i], t, 0.06));
        // bands track the fundamental so the timbre follows revs
        this.bands[0].f.frequency.setTargetAtTime(clamp(fire * 3, 140, 900), t, k);
        this.bands[1].f.frequency.setTargetAtTime(clamp(fire * 5, 400, 2200), t, k);
        this.bands[2].f.frequency.setTargetAtTime(clamp(fire * 8, 900, 4200), t, k);
      } else {
        this.bands[0].g.gain.setTargetAtTime(0.09 + load * 0.05, t, 0.08);
        this.bands[0].f.frequency.setTargetAtTime(clamp(fire * 4 + thr * 400, 250, 2600), t, 0.08);
      }
      this.idleDepth.gain.setTargetAtTime(idleness * P.lumpy * 0.45, t, 0.2);
      this.idleLfo.frequency.setTargetAtTime(Math.max(2, fire / (P.cylinders || 1) * 0.5), t, 0.2);
      this.loadGain.gain.setTargetAtTime(load * load * 0.05 * (0.6 + P.exhaust * 0.6) * (st.boost ? 1.4 : 1), t, 0.07);
      // exhaust pulses at the firing rate, louder on load; lift-off = lighter
      this.exhLfo.frequency.setTargetAtTime(Math.min(fire, 180), t, k);
      this.exhBP.frequency.setTargetAtTime(clamp(110 + rN * 520 + (st.boost ? 250 : 0), 90, 1400), t, 0.08);
      const exhLvl = P.exhaust * (0.018 + load * 0.05 + (st.boost ? 0.03 : 0) + (1 - thr) * rN * 0.012);
      this.exhGain.gain.setTargetAtTime(exhLvl, t, 0.08);
      if (this.chopD) this.chopD.gain.setTargetAtTime(st.limiter ? 0.45 : 0, t, 0.02);
      // overrun pops/crackles on a sharp lift from high revs
      if (!this.simple && this.prevThrottle > 0.8 && thr < 0.3 && rN > 0.55 && Math.random() < P.pops + 0.2) this.crackle(3 + Math.floor(P.pops * 6));
    } else if (this.evGain && this.evWhine && this.evWhine2) {
      const f = 90 + rN * 1300;
      this.evWhine.frequency.setTargetAtTime(f, t, k);
      this.evWhine2.frequency.setTargetAtTime(1800 + rN * 5200, t, k);
      this.evGain.gain.setTargetAtTime(0.025 + load * 0.05 + rN * 0.03 + (st.boost ? 0.025 : 0), t, 0.06);
    }
    if (!this.simple) {
      // intake: throttle + rpm, cut on shift
      this.intakeBP.frequency.setTargetAtTime(1600 + rN * 3200, t, 0.08);
      this.intakeGain.gain.setTargetAtTime(P.intake * thr * (0.006 + rN * 0.022), t, 0.05);
      // gear whine rises with road speed in each gear
      const mechF = 300 + Math.abs(st.speed) * (40 + st.gear * 6);
      this.mechO.frequency.setTargetAtTime(mechF, t, k);
      this.mechGain.gain.setTargetAtTime(P.mech * (0.004 + rN * 0.012 + (1 - thr) * 0.004), t, 0.08);
      // wind ∝ speed²
      const v = Math.abs(st.speed);
      this.windBP.frequency.setTargetAtTime(400 + v * 30, t, 0.2);
      this.windGain.gain.setTargetAtTime(clamp((v / 30) ** 2 * 0.03 + (st.boost ? 0.015 : 0), 0, 0.06), t, 0.2);
      // gear shift transient
      if (st.shiftSeq !== this.lastShiftSeq) {
        this.lastShiftSeq = st.shiftSeq;
        this.shiftFx(st.lastShift);
      }
    }
    this.prevThrottle = thr;
  }

  /** GEAR SHIFT: intake cut + clunk + engine dip + exhaust burp (§11) */
  private shiftFx(dir: number) {
    const ctx = this.ctx; const t = ctx.currentTime; const P = this.prof;
    if (P.electric) return;
    // intake cut
    this.intakeGain.gain.cancelScheduledValues(t); this.intakeGain.gain.setValueAtTime(0.0001, t);
    this.loadGain.gain.cancelScheduledValues(t); this.loadGain.gain.setValueAtTime(0.0001, t);
    // mechanical click/clunk
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = dir > 0 ? 1900 : 1200; bp.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    n.connect(bp); bp.connect(g); g.connect(this.out); n.start(t, Math.random() * 4); n.stop(t + 0.08);
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(dir > 0 ? 180 : 140, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.06);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(0.03, t + 0.005); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(og); og.connect(this.out); o.start(t); o.stop(t + 0.1);
    // exhaust burp on upshift
    if (dir > 0 && P.exhaust > 0.4) this.crackle(2);
  }

  private crackle(count: number) {
    const ctx = this.ctx; const t0 = ctx.currentTime;
    for (let i = 0; i < count; i++) {
      const t = t0 + 0.02 + Math.random() * 0.25;
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500 + Math.random() * 900; bp.Q.value = 2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05 * this.prof.exhaust, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03 + Math.random() * 0.03);
      s.connect(bp); bp.connect(g); g.connect(this.out); s.start(t, Math.random() * 5); s.stop(t + 0.08);
    }
  }

  stop() {
    if (!this.alive) return;
    this.alive = false;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.08);
    const o = this.oscs, s = this.srcs;
    setTimeout(() => {
      for (const x of o) { try { x.stop(); } catch { /* stopped */ } }
      for (const x of s) { try { x.stop(); } catch { /* stopped */ } }
      try { this.out.disconnect(); } catch { /* gone */ }
    }, 450);
  }
}

// ---------------------------------------------------------------------------
// TIRE VOICE — rolling noise, drift/skid and brake scrub per SURFACE (§13/14/34)
// ---------------------------------------------------------------------------
export class TireVoice {
  private ctx: AudioContext;
  private out: GainNode;
  private roll: { bp: BiquadFilterNode; g: GainNode };
  private skid: { bp: BiquadFilterNode; g: GainNode; wob: OscillatorNode; wobD: GainNode };
  private grit: { lp: BiquadFilterNode; g: GainNode };
  private brake: { bp: BiquadFilterNode; g: GainNode };
  private absO: OscillatorNode; private absD: GainNode;
  private srcs: AudioBufferSourceNode[] = [];
  private oscs: OscillatorNode[] = [];
  private pan: StereoPannerNode | null = null;

  constructor(ctx: AudioContext, dest: AudioNode, noise: AudioBuffer) {
    this.ctx = ctx;
    this.out = ctx.createGain(); this.out.gain.value = 1;
    if (typeof ctx.createStereoPanner === 'function') { this.pan = ctx.createStereoPanner(); this.out.connect(this.pan); this.pan.connect(dest); }
    else this.out.connect(dest);
    const src = (rate: number) => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.playbackRate.value = rate; s.start(ctx.currentTime, Math.random() * 5); this.srcs.push(s); return s; };
    // rolling
    { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 300; bp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0; src(0.7).connect(bp); bp.connect(g); g.connect(this.out); this.roll = { bp, g }; }
    // skid / squeal
    { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1150; bp.Q.value = 7;
      const g = ctx.createGain(); g.gain.value = 0;
      const wob = ctx.createOscillator(); wob.frequency.value = 6.2; const wobD = ctx.createGain(); wobD.gain.value = 90;
      wob.connect(wobD); wobD.connect(bp.frequency); wob.start(); this.oscs.push(wob);
      src(1).connect(bp); bp.connect(g); g.connect(this.out); this.skid = { bp, g, wob, wobD }; }
    // gravel / grit bed
    { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 0.6;
      const g = ctx.createGain(); g.gain.value = 0; src(0.93).connect(lp); lp.connect(g); g.connect(this.out); this.grit = { lp, g }; }
    // brake friction + ABS pulsing
    { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 2.5;
      const g = ctx.createGain(); g.gain.value = 0; src(1.2).connect(bp); bp.connect(g); g.connect(this.out); this.brake = { bp, g }; }
    this.absO = ctx.createOscillator(); this.absO.type = 'square'; this.absO.frequency.value = 16;
    this.absD = ctx.createGain(); this.absD.gain.value = 0;
    this.absO.connect(this.absD); this.absD.connect(this.brake.g.gain); this.absO.start(); this.oscs.push(this.absO);
  }

  update(p: { speed: number; slip: number; drifting: boolean; braking: boolean; surface: SurfaceId; grounded: boolean; lateralSide: number }) {
    const t = this.ctx.currentTime;
    const v = Math.abs(p.speed);
    const S = SURFACES[p.surface];
    const on = p.grounded ? 1 : 0;
    const vN = clamp(v / 28, 0, 1.3);
    // rolling noise: road = soft hum, gravel/sand = rough
    const rough = S.tire === 'gravel' || S.tire === 'soft' ? 1 : S.tire === 'wood' ? 0.6 : 0.25;
    this.roll.bp.frequency.setTargetAtTime(S.tire === 'wood' ? 380 : S.tire === 'ice' ? 1800 : 220 + vN * 300, t, 0.1);
    this.roll.g.gain.setTargetAtTime(on * vN * (0.006 + rough * 0.022), t, 0.1);
    // skid intensity = slip angle × speed (drift, understeer) — surface voiced
    const skidI = on * clamp(p.slip * 2.4, 0, 1) * clamp(v / 12, 0, 1) * (p.drifting || p.slip > 0.12 ? 1 : 0);
    let f = 1150, q = 7, sq = 1, gr = 0.3;
    switch (S.tire) {
      case 'squeal': f = 1000 + skidI * 500; q = 6 + skidI * 3; sq = 1; gr = 0.25; break;
      case 'gravel': f = 700; q = 1.2; sq = 0.25; gr = 1.3; break;
      case 'soft': f = 600; q = 1.5; sq = 0.3; gr = 0.9; break;
      case 'ice': f = 3200; q = 3; sq = 0.7; gr = 0.1; break;
      case 'wood': f = 850; q = 2.5; sq = 0.5; gr = 0.6; break;
    }
    this.skid.bp.frequency.setTargetAtTime(f, t, 0.05);
    this.skid.bp.Q.setTargetAtTime(q, t, 0.1);
    this.skid.g.gain.setTargetAtTime(skidI * 0.11 * sq, t, 0.05);
    this.skid.wobD.gain.setTargetAtTime(S.tire === 'squeal' ? 110 : 30, t, 0.2);
    this.grit.lp.frequency.setTargetAtTime(S.tire === 'gravel' ? 900 : 420, t, 0.1);
    this.grit.g.gain.setTargetAtTime(skidI * 0.06 * gr, t, 0.05);
    // brake: friction hiss + tire scrub; ABS chatter on low grip / hard stops
    const brakeI = p.braking && on ? clamp(v / 20, 0, 1) : 0;
    this.brake.bp.frequency.setTargetAtTime(1800 + vN * 1400, t, 0.05);
    this.brake.g.gain.setTargetAtTime(brakeI * 0.035, t, 0.04);
    const abs = brakeI > 0.6 && S.grip < 0.8 ? brakeI * 0.02 : 0;
    this.absD.gain.setTargetAtTime(abs, t, 0.05);
    if (brakeI > 0.4) { this.skid.g.gain.setTargetAtTime(Math.max(skidI * 0.11 * sq, brakeI * 0.035 * sq), t, 0.05); }
    // spatial: skid sits toward the sliding side
    if (this.pan) this.pan.pan.setTargetAtTime(clamp(p.lateralSide * 0.35, -0.5, 0.5), t, 0.1);
  }

  stop() {
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.08);
    const s = this.srcs, o = this.oscs;
    setTimeout(() => { for (const x of s) { try { x.stop(); } catch { /* */ } } for (const x of o) { try { x.stop(); } catch { /* */ } } try { this.out.disconnect(); } catch { /* */ } }, 400);
  }
}
