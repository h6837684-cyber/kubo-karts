// KUBO KARTS - Procedural audio engine v3 — CLASSIC SFX RESTORED (v1.15).
// No binary assets - all sounds are synthesized. Fully offline.
//
// v1.15 (user: "میخوام صدا های قبلی بر گردونی ولی صدای ماشین بزار به همراه
// صدای موشک و 30 درصد صدای موشک بیشتر کن"):
//  1. ALL one-shot SFX recipes RESTORED to the classic v1.13 synth — the
//     exact sounds the player grew up with (simple, clean, arcade).
//  2. CAR SOUND stays v1.14: ENGINE v3 (4-gear RPM model + combustion
//     pulse-train through a soft-clip waveshaper + sub body + mechanical
//     whine + exhaust rasp + lumpy idle LFO) and DRIFT v2 (high-Q tire
//     squeal with 6Hz wobble + 26Hz tremolo over a gravel bed).
//  3. MISSILE SOUND stays v1.14 and is 30% LOUDER: live whoosh loops with
//     distance-driven gain/brightness/pan, plus launch / flyby / دید دید
//     warning one-shots all boosted ×1.3.
//  4. AMBIENCE BEDS — per-theme environmental layers (wind, birds, crickets,
//     lava rumble, cave drips, city hum) on the music-volume bus.
//  5. Reverb bus + panning kept for the ambience/missile paths only;
//     restored classic one-shots play dry + centered, exactly like v1.13.

import { EngineVoice, TireVoice, type EngineState } from './engineAudio';
import type { EngineProfile } from '../kart/powertrain';

export type { EngineState };

/** neutral fallback profile (menus / tests) */
function engineProfileFallback(): EngineProfile {
  return { kind: 'light', idleRpm: 1200, redline: 9000, torquePeak: 0.65, torqueWidth: 1.8, gears: 5, spread: 3.3, shiftTime: 0.11, revRate: 9, cylinders: 4, harmonics: [1, 0.55, 0.3, 0.12], exhaust: 0.5, intake: 0.5, mech: 0.35, lumpy: 0.25, electric: false, pops: 0.2 };
}

type SfxName =
  | 'click' | 'hover' | 'back' | 'error' | 'unlock' | 'coin' | 'reward'
  | 'countdown' | 'go' | 'itemPickup' | 'itemRoulette' | 'itemUse' | 'boxBreak'
  | 'lightning' | 'rocket' | 'rocketFire' | 'shield' | 'shieldBreak' | 'freeze' | 'trap' | 'bomb' | 'magnet' | 'emp'
  | 'boost' | 'boostPad' | 'jump' | 'land' | 'crash' | 'bonk' | 'splash' | 'lap'
  | 'win' | 'lose' | 'levelUp' | 'purchase' | 'driftCharge' | 'driftRelease' | 'checkPoint'
  | 'sputter' | 'repair'
  // v1.8: per-item identity sounds (user: "صدا و موسیقی بیشتر برای قدرت‌ها")
  | 'giantRoar' | 'ghostFx' | 'megaJump' | 'mineArm'
  // v1.9 missile overhaul (user: "قبلش صداش بیاد دید دید دید — هر دید دید فلش
  // بزرگ و پرنور بشه") + shield/magnet DEFLECT ricochet
  | 'rocketBeep' | 'deflect'
  // v1.10 blue lightning storm: big cinematic thunder for every electric
  // field spawn + a lighter zap when a field discharges onto a kart
  | 'thunder' | 'zapHit'
  // v1.21 new items: TNT / banana peel / minecart (each fully voiced)
  | 'tntPlace' | 'tntFuse' | 'bananaDrop' | 'bananaSlip' | 'minecartLaunch' | 'minecartClack' | 'minecartHit';

/** v1.11 (user: "میخوام برای همه صداهای بازی اسم بزاری"): every sound in the
 *  game has a NAME, shown in Settings → 🔊 Sound list with a preview button
 *  so the user can hear exactly what each named sound is. */
export const SOUND_NAMES: { key: SfxName; fa: string; en: string }[] = [
  { key: 'click', fa: 'کلیک دکمه', en: 'Button click' },
  { key: 'hover', fa: 'هاور دکمه', en: 'Button hover' },
  { key: 'back', fa: 'برگشت', en: 'Back' },
  { key: 'error', fa: 'خطا', en: 'Error' },
  { key: 'unlock', fa: 'باز شد', en: 'Unlock' },
  { key: 'coin', fa: 'سکه', en: 'Coin' },
  { key: 'reward', fa: 'جایزه', en: 'Reward' },
  { key: 'countdown', fa: 'شمارش معکوس', en: 'Countdown beep' },
  { key: 'go', fa: 'شروع! (گو)', en: 'GO!' },
  { key: 'itemPickup', fa: 'گرفتن قدرت', en: 'Power-up pickup' },
  { key: 'itemRoulette', fa: 'گردونه قدرت', en: 'Item roulette' },
  { key: 'itemUse', fa: 'استفاده از قدرت', en: 'Use power-up' },
  { key: 'boxBreak', fa: 'شکستن جعبه', en: 'Item box break' },
  { key: 'lightning', fa: 'آذرخش (رعد و برق)', en: 'Lightning' },
  { key: 'rocket', fa: 'پرواز موشک', en: 'Missile flyby' },
  { key: 'rocketFire', fa: 'شلیک موشک', en: 'Missile launch' },
  { key: 'rocketBeep', fa: 'هشدار موشک (دید دید)', en: 'Missile warning beep' },
  { key: 'shield', fa: 'سپر', en: 'Shield up' },
  { key: 'shieldBreak', fa: 'شکستن سپر', en: 'Shield break' },
  { key: 'deflect', fa: 'دفع (برخورد سپر/آهنربا)', en: 'Deflect ricochet' },
  { key: 'freeze', fa: 'یخ‌زدگی', en: 'Freeze' },
  { key: 'trap', fa: 'تله', en: 'Trap' },
  { key: 'bomb', fa: 'انفجار', en: 'Explosion' },
  { key: 'magnet', fa: 'آهنربا', en: 'Magnet' },
  { key: 'emp', fa: 'پالس الکترومغناطیس', en: 'EMP shockwave' },
  { key: 'boost', fa: 'بوست (توربو)', en: 'Boost' },
  { key: 'boostPad', fa: 'صفحه شتاب', en: 'Boost pad' },
  { key: 'jump', fa: 'پرش', en: 'Jump' },
  { key: 'megaJump', fa: 'پرش بزرگ (کنگروی)', en: 'Mega jump' },
  { key: 'land', fa: 'فرود', en: 'Landing' },
  { key: 'crash', fa: 'تصادف', en: 'Crash' },
  { key: 'bonk', fa: 'برخورد کوچک', en: 'Bonk' },
  { key: 'splash', fa: 'افتادن در آب', en: 'Splash' },
  { key: 'lap', fa: 'تمام شدن دور', en: 'Lap complete' },
  // v1.13: the 'finalLap' jingle was REMOVED entirely (user: the last-lap
  // sound was unbearable) — every lap now plays the same short 'lap' chime.
  { key: 'checkPoint', fa: 'چک‌پوینت', en: 'Checkpoint' },
  { key: 'win', fa: 'برد', en: 'Win' },
  { key: 'lose', fa: 'باخت', en: 'Lose' },
  { key: 'levelUp', fa: 'سطح بالاتر', en: 'Level up' },
  { key: 'purchase', fa: 'خرید', en: 'Purchase' },
  { key: 'driftCharge', fa: 'شارژ دریفت', en: 'Drift charge' },
  { key: 'driftRelease', fa: 'رها کردن دریفت', en: 'Drift release' },
  { key: 'sputter', fa: 'خاموشی موتور', en: 'Engine sputter' },
  { key: 'repair', fa: 'تعمیر', en: 'Repair' },
  { key: 'giantRoar', fa: 'غرش هیولا', en: 'Giant roar' },
  { key: 'ghostFx', fa: 'روح (شفاف شدن)', en: 'Ghost phase' },
  { key: 'mineArm', fa: 'فعال شدن مین', en: 'Mine arm' },
  { key: 'thunder', fa: 'رعد و برق بزرگ', en: 'Big thunder' },
  { key: 'zapHit', fa: 'برق‌گرفتگی', en: 'Zap hit' },
  { key: 'tntPlace', fa: 'گذاشتن تی‌ان‌تی', en: 'TNT placed' },
  { key: 'tntFuse', fa: 'فتیله تی‌ان‌تی', en: 'TNT fuse hiss' },
  { key: 'bananaDrop', fa: 'انداختن پوست موز', en: 'Banana drop' },
  { key: 'bananaSlip', fa: 'سُر خوردن روی موز', en: 'Banana slip' },
  { key: 'minecartLaunch', fa: 'راه افتادن واگن معدن', en: 'Minecart launch' },
  { key: 'minecartClack', fa: 'تق‌تق ریل واگن', en: 'Minecart rail clack' },
  { key: 'minecartHit', fa: 'برخورد واگن معدن', en: 'Minecart crash' },
];

/** min seconds between two plays of the same sound (anti machine-gun) */
const COOLDOWN: Partial<Record<SfxName, number>> = {
  boxBreak: 0.09, itemPickup: 0.09, itemRoulette: 0.4, land: 0.12, splash: 0.15,
  crash: 0.1, bonk: 0.08, boost: 0.1, boostPad: 0.15, checkPoint: 0.1,
  lap: 0.5, driftCharge: 0.12, driftRelease: 0.2, coin: 0.05,
  lightning: 0.15, bomb: 0.15, rocket: 0.12, freeze: 0.12, emp: 0.15,
  thunder: 0.28, zapHit: 0.2,
  minecartClack: 0.045, bananaSlip: 0.15, tntPlace: 0.1, minecartHit: 0.12,
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  // v1.20 BUS MIXER: MASTER ▸ { MUSIC, SFX, ENGINE, AMBIENCE, UI, VOICE, PRIORITY }
  // each bus has volume + mute; *Duck nodes are the sidechain ducking stage.
  private engineBus!: GainNode;
  private uiBus!: GainNode;
  private voiceBus!: GainNode;
  private priorityBus!: GainNode;   // missile warning / countdown: never ducked
  private ambDuck!: GainNode; private musicDuck!: GainNode; private engineDuck!: GainNode; private sfxDuck!: GainNode;
  busVol = { engine: 1, ui: 1, voice: 1, ambience: 1 };
  busMute = { engine: false, ui: false, voice: false };
  private reverb!: ConvolverNode;
  private noiseBuf: AudioBuffer | null = null;
  vol = { master: 0.9, sfx: 1.0, music: 0.55 };
  musicOn = true; sfxOn = true;
  private musicTimer: number | null = null;
  private lastPlay = new Map<string, number>();
  private voices = 0;
  /** per-play volume multiplier (distance gating). play() sets it, env() consumes it. */
  private playVol = 1;

  init() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      // master -> compressor -> destination : kills clipping distortion
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 24;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.vol.master;
      this.master.connect(comp);
      const mk = (dest: AudioNode, v = 1) => { const g = this.ctx!.createGain(); g.gain.value = v; g.connect(dest); return g; };
      this.sfxDuck = mk(this.master); this.musicDuck = mk(this.master); this.ambDuck = mk(this.master); this.engineDuck = mk(this.master);
      this.sfxBus = mk(this.sfxDuck, this.vol.sfx);
      this.musicBus = mk(this.musicDuck, this.vol.music);
      this.ambBus = mk(this.ambDuck, this.vol.music * 0.6);
      this.engineBus = mk(this.engineDuck, this.vol.sfx);
      this.uiBus = mk(this.master, this.vol.sfx);
      this.voiceBus = mk(this.master, this.vol.sfx);
      this.priorityBus = mk(this.master, this.vol.sfx);
      // GLOBAL REVERB: procedurally generated impulse response — a decaying
      // diffuse noise tail. Wet sends per sound make the world sound like a
      // SPACE instead of a phone speaker.
      this.reverb = this.ctx.createConvolver();
      const irLen = Math.floor(this.ctx.sampleRate * 2.3);
      const ir = this.ctx.createBuffer(2, irLen, this.ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = ir.getChannelData(ch);
        for (let i = 0; i < irLen; i++) {
          const k = i / irLen;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.6) * (i < 90 ? i / 90 : 1);
        }
      }
      this.reverb.buffer = ir;
      const revOut = this.ctx.createGain(); revOut.gain.value = 0.9;
      this.reverb.connect(revOut); revOut.connect(this.master);
      // 6-second noise buffer — seamless bed loops (no 1.2s heartbeat rhythm)
      const len = this.ctx.sampleRate * 6;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { /* audio unavailable */ }
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  setMasterVol(v: number) { this.vol.master = v; if (this.master) this.master.gain.value = v; }
  setSfxVol(v: number) {
    this.vol.sfx = v;
    if (this.sfxBus) this.sfxBus.gain.value = v;
    if (this.engineBus) this.engineBus.gain.value = v * this.busVol.engine * (this.busMute.engine ? 0 : 1);
    if (this.uiBus) this.uiBus.gain.value = v * this.busVol.ui * (this.busMute.ui ? 0 : 1);
    if (this.voiceBus) this.voiceBus.gain.value = v * this.busVol.voice * (this.busMute.voice ? 0 : 1);
    if (this.priorityBus) this.priorityBus.gain.value = Math.max(0.35, v);   // warnings stay audible
  }
  setMusicVol(v: number) {
    this.vol.music = v;
    if (this.musicBus) this.musicBus.gain.value = v;
    if (this.ambBus) this.ambBus.gain.value = v * 0.6;
  }

  private now() { return this.ctx ? this.ctx.currentTime : 0; }

  /** One-shot output channel: panning + reverb send in one grab.
   *  pan -1..1 (right positive), wet 0..1 reverb fraction. */
  private strip(pan = 0, wet = 0, dest?: AudioNode): GainNode {
    const g = this.ctx!.createGain();
    const out = dest || this.sfxBus;
    // v1.21 BUGFIX: the tail used to start as `out`, so a CENTERED strip ran
    // `out.connect(out)` — a zero-delay feedback cycle that WebAudio mutes,
    // silencing the whole SFX bus after the first centered impact/ding.
    let tail: AudioNode = g;
    if (Math.abs(pan) > 0.01 && typeof this.ctx!.createStereoPanner === 'function') {
      const p = this.ctx!.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      tail = p;
    }
    tail.connect(out);
    if (wet > 0.001) {
      const s = this.ctx!.createGain();
      s.gain.value = wet;
      g.connect(s); s.connect(this.reverb);
    }
    return g;
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number, sustain = 0, rel = 0.05) {
    peak *= this.playVol;
    if (peak <= 0.0001) { g.gain.value = 0; return; }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t + a);
    if (sustain > 0) {
      g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.6), t + a + d);
      g.gain.setValueAtTime(Math.max(0.0001, peak * 0.6), t + a + d + sustain);
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d + sustain + rel);
    } else {
      g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    }
  }

  private tone(freq: number, type: OscillatorType, t: number, dur: number, peak: number, slideTo?: number, dest?: AudioNode, attack = 0.005) {
    if (!this.ctx) return;
    if (this.voices > 34) return;
    this.voices++;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    this.env(g, t, attack, peak, dur);
    o.connect(g); g.connect(dest || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.1);
    o.onended = () => { this.voices--; };
  }

  private noise(t: number, dur: number, peak: number, filterType: BiquadFilterType, f0: number, f1: number, q = 1, dest?: AudioNode, attack = 0.005) {
    if (!this.ctx || !this.noiseBuf) return;
    if (this.voices > 34) return;
    this.voices++;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    src.playbackRate.value = 0.92 + Math.random() * 0.16; // decorrelate stacks
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(10, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = this.ctx.createGain();
    this.env(g, t, attack, peak, dur);
    src.connect(f); f.connect(g); g.connect(dest || this.sfxBus);
    src.start(t); src.stop(t + dur + 0.1);
    src.onended = () => { this.voices--; };
  }

  // ---------- helper kit ----------

  /** debris / electric crackle: N tiny noise ticks scattered in time
   *  (kept for the v1.14 missile launch recipe) */
  private crackle(t: number, dur: number, count: number, peak: number, dest?: AudioNode, f0 = 2400, f1 = 6800) {
    for (let i = 0; i < count; i++) {
      const tt = t + Math.random() * dur;
      this.noise(tt, 0.012 + Math.random() * 0.028, peak * (0.4 + Math.random() * 0.6),
        'highpass', f0, f1 * (0.7 + Math.random() * 0.6), 2, dest);
    }
  }

  // ============================================================
  // PLAY — v1.15: the CLASSIC v1.13 one-shot recipes are back
  // (exact restore, dry + centered). Exceptions (user request): the CAR
  // sound and the MISSILE sound stay v1.14 — the missile one-shots below
  // are the v1.14 recipes boosted ×1.3 (30% louder).
  // ============================================================
  play(name: SfxName, pitch = 1, vol = 1, pan = 0) {
    if (!this.ctx || !this.sfxOn) return;
    if (vol <= 0.001) return;
    this.playVol = vol;
    const cd = COOLDOWN[name];
    if (cd) {
      const last = this.lastPlay.get(name) ?? -99;
      const now = this.now();
      if (now - last < cd) return;
      this.lastPlay.set(name, now);
    }
    const t = this.now() + 0.001;
    const N = 261.63 * pitch; // C4
    const S = (p = pan, w = 0) => this.strip(p, w);
    switch (name) {
      // ================= UI (classic v1.13) =================
      case 'click': this.tone(2200 * pitch, 'square', t, 0.05, 0.1, 1400, this.uiBus); break;
      case 'hover': this.tone(1600 * pitch, 'sine', t, 0.04, 0.045, undefined, this.uiBus); break;
      case 'back': this.tone(700 * pitch, 'square', t, 0.07, 0.09, 400, this.uiBus); break;
      case 'error': this.tone(220, 'sawtooth', t, 0.12, 0.1, 140); this.tone(210, 'sawtooth', t + 0.1, 0.16, 0.1, 120); break;
      case 'unlock':
        [N, N * 1.25, N * 1.5, N * 2].forEach((f, i) => this.tone(f, 'triangle', t + i * 0.07, 0.14, 0.13));
        break;
      case 'coin': this.tone(N * 2, 'square', t, 0.06, 0.1); this.tone(N * 2.5, 'square', t + 0.06, 0.14, 0.1); break;
      case 'reward':
        [N, N * 1.25, N * 1.5, N * 2, N * 2.5].forEach((f, i) => this.tone(f, 'triangle', t + i * 0.08, 0.18, 0.13));
        break;
      case 'countdown': this.tone(440 * pitch, 'square', t, 0.12, 0.2, undefined, this.priorityBus); this.duck('amb', 0.5, 0.4); break;
      case 'go': this.tone(880, 'square', t, 0.4, 0.24, 1100); this.noise(t, 0.3, 0.1, 'highpass', 800, 4000); break;
      // ================= items (classic v1.13) =================
      case 'itemPickup': this.tone(N * 1.5, 'sine', t, 0.08, 0.14, N * 2); this.tone(N * 2, 'sine', t + 0.07, 0.12, 0.14, N * 3); break;
      case 'boxBreak':
        // item box shatters: glassy pop + rising chime
        this.noise(t, 0.12, 0.2, 'highpass', 1800, 5200);
        this.tone(320 * pitch, 'square', t, 0.07, 0.1, 180);
        this.tone(780 * pitch, 'triangle', t + 0.05, 0.1, 0.12);
        this.tone(1170 * pitch, 'triangle', t + 0.12, 0.14, 0.11);
        this.tone(1560 * pitch, 'sine', t + 0.19, 0.18, 0.1);
        break;
      case 'itemRoulette':
        // softened ratchet (accelerating sine ticks)
        for (let i = 0; i < 6; i++) this.tone(700 + (i % 2) * 350, 'sine', t + i * 0.055, 0.04, 0.05);
        break;
      case 'itemUse': this.noise(t, 0.15, 0.15, 'bandpass', 400, 2400, 2); this.tone(500, 'square', t, 0.1, 0.08, 900); break;
      case 'lightning':
        this.noise(t, 0.5, 0.32, 'highpass', 3000, 300); this.noise(t, 0.25, 0.24, 'lowpass', 4000, 200);
        this.tone(120, 'sawtooth', t, 0.4, 0.2, 40); break;
      // ---- MISSILE SOUND: v1.14 recipes kept, ×1.3 = 30% LOUDER (v1.15) ----
      case 'rocket': {
        // one-shot flyby fallback (live loops use startRocketLoop below)
        const d = S(pan, 0.12);
        this.noise(t, 0.7, 0.22, 'bandpass', 2400, 320, 2.2, d, 0.05);
        this.tone(210, 'sawtooth', t, 0.6, 0.09, 82, d, 0.06);
        break;
      }
      case 'rocketFire': {
        // launch: deep ignition whoosh + flame crackle (×1.3)
        const d = S(pan, 0.18);
        this.noise(t, 0.5, 0.26, 'lowpass', 3600, 320, 0.9, d, 0.015);
        this.tone(90, 'sawtooth', t, 0.34, 0.18, 330, d, 0.02);
        this.crackle(t + 0.05, 0.45, 8, 0.065, d, 1400, 3400);
        break;
      }
      case 'rocketBeep': {
        // lock-on sonar "دید" with slapback echo (×1.3)
        const d = S(pan, 0.2);
        this.tone(1560 * pitch, 'square', t, 0.06, 0.13, 1020 * pitch, d);
        this.tone(2340 * pitch, 'sine', t + 0.012, 0.045, 0.058, undefined, d);
        this.tone(1560 * pitch, 'square', t + 0.13, 0.05, 0.046, 1020 * pitch, d);
        break;
      }
      case 'shield':
        [N * 2, N * 2.4, N * 3].forEach((f, i) => this.tone(f, 'sine', t + i * 0.05, 0.3, 0.08, f * 1.2)); break;
      case 'shieldBreak': this.noise(t, 0.3, 0.22, 'highpass', 2000, 6000); this.tone(1800, 'triangle', t, 0.2, 0.12, 400); break;
      case 'deflect':
        // metal ricochet ping + shimmer (shield/magnet bounced the missile)
        this.tone(1900, 'triangle', t, 0.18, 0.14, 620);
        this.tone(2850, 'sine', t + 0.05, 0.22, 0.08, 1100);
        this.noise(t, 0.18, 0.1, 'highpass', 3200, 7000);
        break;
      case 'freeze': this.tone(2200, 'sine', t, 0.35, 0.12, 500); this.noise(t, 0.3, 0.12, 'highpass', 4000, 8000); break;
      case 'trap': this.noise(t, 0.2, 0.16, 'lowpass', 800, 200); this.tone(150, 'square', t, 0.15, 0.1, 80); break;
      case 'bomb': this.noise(t, 0.6, 0.38, 'lowpass', 3000, 100); this.tone(90, 'sine', t, 0.5, 0.3, 30); break;
      case 'magnet': this.tone(600, 'sine', t, 0.3, 0.1, 1200); this.tone(900, 'sine', t + 0.1, 0.3, 0.08, 1600); break;
      case 'emp': this.tone(80, 'sawtooth', t, 0.5, 0.22, 800); this.noise(t, 0.4, 0.18, 'bandpass', 200, 4000, 4); break;
      case 'zapHit':
        // a kart touched an electric field: sharp electric discharge
        this.noise(t, 0.3, 0.3, 'highpass', 1800, 300);
        this.tone(2200, 'square', t, 0.16, 0.16, 160);
        this.tone(90, 'sawtooth', t + 0.02, 0.45, 0.24, 30);
        break;
      case 'boost': this.noise(t, 0.5, 0.22, 'bandpass', 400, 3500, 2); this.tone(180, 'sawtooth', t, 0.45, 0.16, 520); break;
      case 'boostPad': this.tone(500, 'square', t, 0.18, 0.13, 1200); this.noise(t, 0.25, 0.11, 'highpass', 800, 4000); break;
      case 'jump': this.tone(300 * pitch, 'square', t, 0.18, 0.12, 700 * pitch); break;
      case 'land': this.tone(140 * pitch, 'sine', t, 0.12, 0.18, 60); this.noise(t, 0.1, 0.1, 'lowpass', 900, 200); break;
      case 'crash': this.noise(t, 0.35, 0.28, 'lowpass', 2500, 200); this.tone(110, 'square', t, 0.2, 0.18, 50); break;
      case 'bonk': this.tone(200 * pitch, 'square', t, 0.1, 0.15, 100); break;
      case 'splash': this.noise(t, 0.4, 0.22, 'bandpass', 1200, 300, 1.5); break;
      case 'lap': [N, N * 1.25, N * 1.5].forEach((f, i) => this.tone(f, 'triangle', t + i * 0.09, 0.15, 0.15)); break;
      // ('finalLap' removed in v1.13 — the last-lap jingle is gone for good)
      case 'checkPoint': this.tone(N * 1.5, 'sine', t, 0.1, 0.1, N * 2); break;
      case 'sputter':
        // engine breakdown: dying chug-chug-chug (3 falling coughs + rattle)
        for (let i = 0; i < 3; i++) {
          this.tone(120 - i * 22, 'square', t + i * 0.16, 0.13, 0.16, 60);
          this.noise(t + i * 0.16, 0.1, 0.1, 'lowpass', 900 - i * 200, 150);
        }
        break;
      case 'repair':
        // ratchet wrench + ready chirp
        for (let i = 0; i < 4; i++) this.tone(900, 'square', t + i * 0.06, 0.04, 0.07, 1400);
        this.tone(N * 2, 'triangle', t + 0.3, 0.2, 0.12);
        break;
      case 'win':
        [N, N * 1.25, N * 1.5, N * 2, N * 1.5, N * 2, N * 2.5, N * 2].forEach((f, i) =>
          this.tone(f, 'triangle', t + i * 0.13, 0.22, 0.17));
        [N / 2, N / 2, N * 0.75, N].forEach((f, i) => this.tone(f, 'square', t + i * 0.26, 0.24, 0.08));
        break;
      case 'lose':
        [N * 1.5, N * 1.25, N, N * 0.75].forEach((f, i) => this.tone(f, 'sawtooth', t + i * 0.18, 0.25, 0.1));
        break;
      case 'levelUp':
        [N, N * 1.5, N * 2, N * 3].forEach((f, i) => this.tone(f, 'triangle', t + i * 0.1, 0.25, 0.17));
        break;
      case 'purchase': this.tone(N, 'square', t, 0.08, 0.12); this.tone(N * 1.5, 'square', t + 0.08, 0.16, 0.12); break;
      case 'driftCharge': this.tone(800 + pitch * 600, 'sine', t, 0.06, 0.04); break;
      case 'driftRelease': this.noise(t, 0.3, 0.2, 'bandpass', 900, 2600, 2); this.tone(400, 'sawtooth', t, 0.25, 0.12, 1000); break;
      // ---- v1.8 power-up identity sounds (classic) ----
      case 'giantRoar':
        // monster transform: rising beast growl (low saw sweep) + stomp thud
        this.tone(70, 'sawtooth', t, 0.55, 0.26, 240);
        this.tone(46, 'square', t + 0.1, 0.45, 0.2, 90);
        this.noise(t + 0.05, 0.4, 0.16, 'lowpass', 700, 120);
        this.tone(60, 'sine', t + 0.42, 0.3, 0.26, 34);
        break;
      case 'ghostFx':
        // phantom phase-out: airy descending whistle + breathy hiss
        this.tone(1450, 'sine', t, 0.5, 0.1, 420);
        this.tone(720, 'sine', t + 0.12, 0.4, 0.07, 300);
        this.noise(t, 0.5, 0.07, 'highpass', 2600, 6000);
        break;
      case 'megaJump':
        // spring boing: fast upward gliss + airy release
        this.tone(190, 'sine', t, 0.28, 0.2, 780);
        this.tone(380, 'triangle', t + 0.08, 0.24, 0.12, 1200);
        this.noise(t + 0.1, 0.16, 0.08, 'highpass', 1400, 3600);
        break;
      case 'mineArm':
        // mine plant: metallic clank + two arming beeps
        this.noise(t, 0.1, 0.16, 'bandpass', 900, 2200, 2);
        this.tone(1180, 'square', t + 0.18, 0.07, 0.09);
        this.tone(1180, 'square', t + 0.34, 0.09, 0.09);
        break;
      // ---- v1.10 BLUE LIGHTNING STORM (classic thunder) ----
      // ---- v1.21 new items ----
      case 'tntPlace': {
        const d = S(pan, 0.08);
        this.noise(t, 0.09, 0.2, 'lowpass', 1400, 300, 1, d);       // block thud on the road
        this.tone(120, 'sine', t, 0.12, 0.2, 60, d);
        this.tone(2400, 'square', t + 0.05, 0.03, 0.05, undefined, d);  // flint 'tsk'
        break;
      }
      case 'tntFuse': {
        // Minecraft primed-TNT hiss: long airy fizz that brightens as it burns down
        const d = S(pan, 0.05);
        this.noise(t, 2.6, 0.08, 'highpass', 3200, 7200, 0.7, d, 0.02);
        this.crackle(t, 2.5, 22, 0.05, d, 3000, 8000);
        break;
      }
      case 'bananaDrop': {
        const d = S(pan, 0.05);
        this.tone(520, 'triangle', t, 0.08, 0.14, 300, d);           // cartoon 'plip'
        this.noise(t + 0.03, 0.08, 0.08, 'bandpass', 1500, 800, 3, d);
        break;
      }
      case 'bananaSlip': {
        const d = S(pan, 0.1);
        this.tone(900, 'sine', t, 0.45, 0.14, 180, d);               // descending 'wheee'
        this.tone(1350, 'sine', t + 0.03, 0.4, 0.06, 260, d);
        this.noise(t, 0.5, 0.14, 'bandpass', 2600, 900, 5, d);      // tire squeal smear
        this.tone(160, 'square', t + 0.1, 0.12, 0.08, 90, d);        // squish
        break;
      }
      case 'minecartLaunch': {
        const d = S(pan, 0.12);
        this.noise(t, 0.2, 0.2, 'bandpass', 700, 2400, 2, d);        // iron shove
        [310, 740, 1190].forEach((f, k) => this.tone(f, 'triangle', t + 0.02, 0.35, 0.09 - k * 0.02, f * 0.97, d));
        this.tone(90, 'sawtooth', t + 0.05, 0.4, 0.12, 150, d);      // rumble spin-up
        break;
      }
      case 'minecartClack': {
        // wheel over a rail joint: short metallic tick + low knock
        const d = S(pan, 0.03);
        this.noise(t, 0.025, 0.12 * pitch, 'bandpass', 2200 * pitch, 1600, 6, d);
        this.tone(180 * pitch, 'square', t, 0.03, 0.05, 120, d);
        break;
      }
      case 'minecartHit': {
        const d = S(pan, 0.2);
        this.noise(t, 0.35, 0.34, 'lowpass', 3200, 220, 0.9, d);
        [410, 980, 1720].forEach((f, k) => this.tone(f, 'triangle', t, 0.5, 0.12 - k * 0.03, f * 0.9, d));
        this.crackle(t + 0.03, 0.3, 10, 0.08, d, 1500, 5000);
        break;
      }
      case 'thunder':
        // initial CRACK + rolling RUMBLE body + far echo tail
        this.noise(t, 0.14, 0.34, 'highpass', 2600, 600);
        this.tone(140, 'sawtooth', t, 0.22, 0.2, 46);
        this.noise(t + 0.05, 1.5, 0.4, 'lowpass', 900, 55, 0.8);
        this.tone(64, 'sine', t + 0.08, 1.2, 0.3, 26);
        this.noise(t + 0.5, 1.1, 0.16, 'lowpass', 500, 40, 0.6);
        break;
    }
  }

  // ============================================================
  // ENGINE v4 (v1.20) — layered, per-car EngineProfile voices.
  // The local car gets a full 10-layer voice (see engineAudio.ts); up to 3
  // nearby remote/AI cars get SIMPLE spatial voices (approx. RPM, throttle,
  // position) so several karts stay distinguishable without voice blow-up.
  // ============================================================
  private engineVoice: EngineVoice | null = null;
  private tireVoice: TireVoice | null = null;
  private remoteVoices = new Map<number, EngineVoice>();
  private legacyShift = 0;

  /** start the LOCAL engine for a given car profile (+ start-up sequence) */
  startEngine(profile?: EngineProfile) {
    if (!this.ctx || !this.noiseBuf || this.engineVoice) return;
    const prof = profile ?? engineProfileFallback();
    this.engineVoice = new EngineVoice(this.ctx, this.engineBus, this.noiseBuf, prof);
    this.engineVoice.playStart();
    this.tireVoice = new TireVoice(this.ctx, this.engineBus, this.noiseBuf);
  }

  /** v1.20 main entry: full physical engine state from the powertrain */
  updateEngineState(st: EngineState, dt: number) {
    if (!this.engineVoice) return;
    this.engineVoice.update(st, dt);
    this.engineTelemetry = st;
  }
  engineTelemetry: EngineState | null = null;

  /** tire layer: rolling / drift / brake per surface */
  updateTires(p: Parameters<TireVoice['update']>[0]) { this.tireVoice?.update(p); }

  /** legacy API (menus / old call-sites): approximate a state from a ratio */
  updateEngine(speedRatio: number, boost: boolean, drifting: boolean, opts?: { dead?: boolean }) {
    if (!this.engineVoice || !Number.isFinite(speedRatio)) return;
    const rr = clamp(speedRatio, 0, 1.3);
    const P = this.engineVoice.prof;
    const rN = 0.15 + (rr * 4 % 1) * 0.7;
    this.engineVoice.update({ rpm: rN * P.redline, rpmN: rN, throttle: 1, load: 0.7, speed: rr * 25, gear: 1 + Math.floor(rr * 4),
      boost, drift: drifting, limiter: false, dead: !!opts?.dead, shiftSeq: this.legacyShift, lastShift: 1 }, 1 / 60);
  }

  /** remote / AI engines: simplified spatial voices for the nearest karts */
  updateRemoteEngine(id: number, prof: EngineProfile, st: EngineState, pan: number, dist: number, behind: boolean, dt: number) {
    if (!this.ctx || !this.noiseBuf) return;
    let v = this.remoteVoices.get(id);
    if (!v) {
      if (this.remoteVoices.size >= 3) return;
      v = new EngineVoice(this.ctx, this.engineBus, this.noiseBuf, prof, { simple: true, spatial: true });
      this.remoteVoices.set(id, v);
    }
    // inverse-distance attenuation + air absorption (far = darker) + rear shadow
    const gain = clamp(1 / (1 + (dist / 9) ** 2), 0, 1) * 0.8;
    const bright = 16000 / (1 + dist / 12) * (behind ? 0.55 : 1);
    v.setSpatial(pan, gain, bright);
    v.update(st, dt, 0.9);
  }
  /** drop remote voices not in the keep-set (voice budget management) */
  pruneRemoteEngines(keep: Set<number>) {
    for (const [id, v] of this.remoteVoices) if (!keep.has(id)) { v.stop(); this.remoteVoices.delete(id); }
  }

  stopEngine() {
    this.engineVoice?.stop(); this.engineVoice = null;
    this.tireVoice?.stop(); this.tireVoice = null;
    for (const v of this.remoteVoices.values()) v.stop();
    this.remoteVoices.clear();
    this.engineTelemetry = null;
  }

  /** legacy drift API → routed into the tire voice (asphalt default) */
  setDrift(active: boolean, intensity: number) {
    if (!this.tireVoice) return;
    if (!active) return; // v1.20: tires are updated continuously via updateTires()
    this.tireVoice.update({ speed: 20, slip: intensity * 0.4, drifting: true, braking: false, surface: 'asphalt', grounded: true, lateralSide: 0 });
  }

  // ============================================================
  // MISSILE WARNING v2 (v1.20, spec §16) — the CLASSIC clear bell DING.
  // Bypasses the voice cap + cooldowns (must never be swallowed by the
  // anti-spam logic), routed on the priority bus, panned to the missile's
  // real side; a missile BEHIND is darker/duller (rear impression).
  // ============================================================
  missileDing(urgency: number, pan: number, rear: boolean) {
    if (!this.ctx || !this.sfxOn) return;
    const ctx = this.ctx; const t = ctx.currentTime + 0.001;
    const u = clamp(urgency, 0, 1);
    const out = ctx.createGain(); out.gain.value = 1;
    let tail: AudioNode = this.priorityBus;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(tail); tail = p;
    }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = rear ? 2600 : 12000; lp.Q.value = 0.6;
    lp.connect(tail); out.connect(lp);
    const f0 = 1320 * (1 + u * 0.35);                  // pitch / urgency rises as it closes in
    const peak = 0.16 + u * 0.1;
    const dur = 0.32 - u * 0.16;
    // bell: fundamental + inharmonic partials, instant attack, exp decay
    const partials: [number, number][] = [[1, 1], [2.76, 0.42], [5.4, 0.18]];
    for (const [m, a] of partials) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f0 * m;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak * a, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur / (m > 1 ? m * 0.6 : 1));
      o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
    }
    // duck the ambience a little on every ding so it always cuts through
    this.duck('amb', 0.45, 0.25);
  }

  /** v3.2 MINECART warning: a lower double "clang-clang" railway bell —
   *  clearly different from the rocket ding, same urgency ramp. */
  cartDing(urgency: number, pan: number, rear: boolean) {
    if (!this.ctx || !this.sfxOn) return;
    const ctx = this.ctx; const t0 = ctx.currentTime + 0.001;
    const u = clamp(urgency, 0, 1);
    let tail: AudioNode = this.priorityBus;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); p.connect(tail); tail = p;
    }
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = rear ? 2200 : 7000; lp.connect(tail);
    const f0 = 620 * (1 + u * 0.3);
    const peak = 0.13 + u * 0.08;
    for (const [dt, fm] of [[0, 1], [0.085, 0.8]] as [number, number][]) {
      const t = t0 + dt;
      for (const [m, a] of [[1, 1], [2.02, 0.5], [3.9, 0.22]] as [number, number][]) {
        const o = ctx.createOscillator(); o.type = m === 1 ? 'triangle' : 'sine'; o.frequency.value = f0 * fm * m;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak * a, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22 - u * 0.08);
        o.connect(g); g.connect(lp); o.start(t); o.stop(t + 0.3);
      }
    }
    this.duck('amb', 0.45, 0.25);
  }

  // ============================================================
  // COLLISION / IMPACT v2 (spec §15): intensity + material aware
  // ============================================================
  impact(intensity: number, material: 'body' | 'wall' | 'metal' | 'wood' | 'stone' | 'tnt', pan = 0) {
    if (!this.ctx || !this.sfxOn) return;
    const i = clamp(intensity, 0, 1);
    if (i < 0.04) return;
    const key = 'impact_' + material;
    const now = this.now();
    if (now - (this.lastPlay.get(key) ?? -9) < 0.07) return;
    this.lastPlay.set(key, now);
    const t = now + 0.001;
    const d = this.strip(pan, 0.08 + i * 0.12);
    const pk = 0.08 + i * 0.26;
    switch (material) {
      case 'body':
        this.noise(t, 0.08 + i * 0.12, pk * 0.8, 'lowpass', 1600 + i * 2000, 300, 0.8, d);
        this.tone(140 - i * 40, 'square', t, 0.06 + i * 0.08, pk * 0.5, 60, d);
        break;
      case 'wall':
        this.noise(t, 0.12 + i * 0.2, pk, 'bandpass', 900 + i * 900, 200, 1.1, d);
        this.tone(95, 'sine', t, 0.15 + i * 0.2, pk * 0.7, 45, d);   // low resonance
        break;
      case 'metal':
        this.noise(t, 0.06, pk * 0.6, 'highpass', 2500, 5000, 1, d);
        [520, 1210, 1960].forEach((f, k) => this.tone(f * (1 + i * 0.1), 'triangle', t, 0.25 + i * 0.3, pk * (0.35 - k * 0.08), f * 0.98, d));
        break;
      case 'wood':
        this.noise(t, 0.07 + i * 0.06, pk * 0.8, 'bandpass', 700, 380, 3, d);
        this.tone(230, 'triangle', t, 0.08, pk * 0.4, 160, d);
        break;
      case 'stone':
        this.noise(t, 0.1 + i * 0.15, pk, 'lowpass', 2400, 180, 0.9, d);
        this.tone(70, 'sine', t, 0.12, pk * 0.6, 40, d);
        this.crackle(t + 0.02, 0.15, 3 + Math.floor(i * 5), pk * 0.25, d, 1500, 4200);
        break;
      case 'tnt':
        this.noise(t, 0.9, 0.42, 'lowpass', 4200, 90, 0.7, this.strip(pan, 0.35));
        this.tone(70, 'sine', t, 0.7, 0.34, 26, d);
        this.crackle(t + 0.05, 0.6, 12, 0.08, d, 900, 3800);
        break;
    }
    if (i > 0.45) this.duck('amb', 0.35, 0.5);
  }

  /** power-up END cue (shield/giant/ghost/magnet/boost wear off) — §18 */
  itemEnd(item: string, vol = 1, pan = 0) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.now() + 0.001;
    const sig: Record<string, [number, OscillatorType]> = {
      shield: [1400, 'triangle'], giant: [180, 'sawtooth'], ghost: [900, 'sine'], magnet: [700, 'sine'], boost: [420, 'sawtooth'],
      minecart: [260, 'triangle'], banana: [700, 'triangle'], tnt: [150, 'square'],
    };
    const [f, type] = sig[item] ?? [600, 'sine'];
    this.playVol = vol;
    const d = this.strip(pan, 0.05);
    this.tone(f, type, t, 0.22, 0.09, f * 0.55, d);
    this.tone(f * 1.5, 'sine', t + 0.06, 0.18, 0.05, f * 0.7, d);
  }
  /** per-item PICKUP signature: shared pickup chime + item-coloured tail */
  itemPickupFor(item: string) {
    if (!this.ctx || !this.sfxOn) return;
    this.play('itemPickup');
    const t = this.now() + 0.12;
    const f: Record<string, number> = { boost: 520, shield: 1200, rocket: 300, lightning: 1800, ice: 2100, trap: 180, mine: 240, magnet: 760, emp: 140, giant: 110, ghost: 980, jump: 640, tnt: 200, banana: 880, minecart: 420 };
    // per-item timbre so every pickup is recognisable by ear alone
    const wave: Record<string, OscillatorType> = { boost: 'sawtooth', rocket: 'square', emp: 'sawtooth', giant: 'sawtooth', tnt: 'square', minecart: 'square', trap: 'square', mine: 'square' };
    const base = f[item] ?? 600;
    this.playVol = 0.8;
    this.tone(base, wave[item] ?? 'triangle', t, 0.1, 0.07, base * 1.3);
    this.tone(base * 2, 'sine', t + 0.08, 0.09, 0.04, base * 2.6);
  }

  // ---------- BUS MIXER (spec §38) ----------
  /** temporarily lower a bus (sidechain-style) and let it recover */
  duck(bus: 'amb' | 'music' | 'engine' | 'sfx', amount: number, seconds: number) {
    if (!this.ctx) return;
    const node = bus === 'amb' ? this.ambDuck : bus === 'music' ? this.musicDuck : bus === 'engine' ? this.engineDuck : this.sfxDuck;
    if (!node) return;
    const t = this.now();
    node.gain.cancelScheduledValues(t);
    node.gain.setTargetAtTime(clamp(1 - amount, 0, 1), t, 0.03);
    node.gain.setTargetAtTime(1, t + seconds, 0.25);
  }
  setBusVol(bus: 'engine' | 'ui' | 'voice' | 'ambience', v: number) {
    this.busVol[bus] = clamp(v, 0, 1.5);
    const n = bus === 'engine' ? this.engineBus : bus === 'ui' ? this.uiBus : bus === 'voice' ? this.voiceBus : this.ambBus;
    if (n) n.gain.value = bus === 'ambience' ? this.busVol.ambience * this.vol.music * 0.6 : this.busVol[bus] * (this.busMute[bus] ? 0 : 1);
  }
  muteBus(bus: 'engine' | 'ui' | 'voice', m: boolean) { this.busMute[bus] = m; this.setBusVol(bus, this.busVol[bus]); }
  /** live voice estimate for the debug overlay */
  get voiceCount(): number { return this.voices + this.remoteVoices.size * 4 + (this.engineVoice ? 14 : 0) + (this.tireVoice ? 5 : 0) + this.rocketLoops.size; }

  // ---------- MISSILE LOOPS — every rocket owns a live whoosh ----------
  // items.ts feeds distance/brightness/pan every frame: the missile swells
  // and brightens as it closes in (approach feel without real doppler math).
  private rocketLoops = new Map<string, { src: AudioBufferSourceNode; bp: BiquadFilterNode; g: GainNode; pan: StereoPannerNode | null }>();

  startRocketLoop(id: string) {
    if (!this.ctx || !this.noiseBuf || this.rocketLoops.has(id) || this.rocketLoops.size >= 4) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true; src.playbackRate.value = 1.15;
    const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 1.3;
    const g = this.ctx.createGain(); g.gain.value = 0;
    let pan: StereoPannerNode | null = null;
    if (this.ctx.createStereoPanner) { pan = this.ctx.createStereoPanner(); }
    src.connect(bp); bp.connect(g);
    if (pan) { g.connect(pan); pan.connect(this.sfxBus); } else g.connect(this.sfxBus);
    src.start();
    this.rocketLoops.set(id, { src, bp, g, pan });
  }

  updateRocketLoop(id: string, vol: number, bright: number, pan = 0, doppler = 1) {
    const L = this.rocketLoops.get(id);
    if (!L || !this.ctx) return;
    if (!Number.isFinite(vol) || !Number.isFinite(bright)) return;
    const t = this.now();
    // v1.15: missile sounds 30% louder (user: "30 درصد صدای موشک بیشتر کن")
    L.g.gain.setTargetAtTime(clamp(vol * 1.3, 0, 0.26), t, 0.08);
    L.bp.frequency.setTargetAtTime(clamp(bright, 250, 4200), t, 0.12);
    if (L.pan) L.pan.pan.setTargetAtTime(clamp(pan, -1, 1), t, 0.1);
    L.src.playbackRate.setTargetAtTime(1.15 * clamp(doppler, 0.85, 1.15), t, 0.15);
  }

  stopRocketLoop(id: string) {
    const L = this.rocketLoops.get(id);
    if (!L) return;
    this.rocketLoops.delete(id);
    if (!this.ctx) return;
    const t = this.now();
    L.g.gain.setTargetAtTime(0, t, 0.1);
    setTimeout(() => { try { L.src.stop(); } catch { /* stopped */ } }, 350);
  }

  // ---------- AMBIENCE — per-theme environmental beds ----------
  // Tied to the MUSIC volume bus (user-controllable, never clipped by sfx).
  // Each theme family gets wind + its own life: birds, crickets, lava
  // rumble, cave drips, city hum, traffic swells.
  private ambNodes: { srcs: AudioBufferSourceNode[]; oscs: OscillatorNode[]; gains: GainNode[]; timers: number[]; alive: () => boolean } | null = null;

  startAmbience(themeId: string, night: boolean) {
    this.stopAmbience();
    if (!this.ctx || !this.noiseBuf) return;
    const st: { srcs: AudioBufferSourceNode[]; oscs: OscillatorNode[]; gains: GainNode[]; timers: number[]; alive: () => boolean } = {
      srcs: [], oscs: [], gains: [], timers: [], alive: () => this.ambNodes === st,
    };
    this.ambNodes = st;

    const bed = (type: BiquadFilterType, f: number, q: number, gain: number, rate = 1) => {
      const src = this.ctx!.createBufferSource();
      src.buffer = this.noiseBuf!; src.loop = true; src.playbackRate.value = rate;
      const flt = this.ctx!.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const g = this.ctx!.createGain(); g.gain.value = 0;
      src.connect(flt); flt.connect(g); g.connect(this.ambBus);
      src.start();
      g.gain.setTargetAtTime(gain, this.now(), 1.2); // slow fade-in
      st.srcs.push(src); st.gains.push(g);
      return { flt, g };
    };
    const lfo = (target: AudioParam, hz: number, depth: number) => {
      const o = this.ctx!.createOscillator(); o.type = 'sine'; o.frequency.value = hz;
      const dg = this.ctx!.createGain(); dg.gain.value = depth;
      o.connect(dg); dg.connect(target); o.start();
      st.oscs.push(o);
    };
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => { if (st.alive()) fn(); }, ms);
      st.timers.push(id);
    };
    const every = (fn: () => void, minMs: number, maxMs: number) => {
      const tick = () => { if (!st.alive()) return; fn(); later(tick, minMs + Math.random() * (maxMs - minMs)); };
      later(tick, 600 + Math.random() * 1600);
    };
    const FAM: Record<string, string> = {
      grass: 'meadow', castle: 'meadow', jungle: 'jungle', volcano: 'volcano',
      cave: 'cave', sky: 'sky', snow: 'snow', desert: 'desert', ruins: 'desert',
      city: 'city', crashcity: 'city', mccity: 'city',
    };
    const fam = FAM[themeId] ?? 'meadow';

    // --- one-shot ambient events ---
    const birdChirp = () => {
      const d = this.strip((Math.random() * 2 - 1) * 0.7, 0.18, this.ambBus);
      const f = 2400 + Math.random() * 1300;
      const n = 2 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) this.tone(f, 'sine', this.now() + k * 0.09, 0.05, 0.035, f * (0.75 + Math.random() * 0.5), d, 0.012);
    };
    const crickets = (rate = 1) => {
      const d = this.strip((Math.random() * 2 - 1) * 0.5, 0.06, this.ambBus);
      for (let k = 0; k < 3; k++) this.tone(4300, 'sine', this.now() + k * 0.07 / rate, 0.022, 0.02, undefined, d, 0.006);
    };
    const drip = () => {
      const d = this.strip((Math.random() * 2 - 1) * 0.6, 0.55, this.ambBus); // heavy cave echo
      this.tone(1750 + Math.random() * 350, 'sine', this.now(), 0.07, 0.05, 1150, d, 0.004);
    };
    const eruption = () => {
      const d = this.strip(0, 0.2, this.ambBus);
      this.noise(this.now(), 1.8, 0.08, 'lowpass', 150, 55, 0.8, d, 0.25);
      this.tone(46, 'sine', this.now(), 1.4, 0.06, 27, d, 0.2);
    };
    const trafficSwell = () => {
      const d = this.strip((Math.random() * 2 - 1) * 0.6, 0.12, this.ambBus);
      this.noise(this.now(), 2.2, 0.02, 'bandpass', 420, 900, 1.2, d, 0.6);
    };

    // --- beds per family ---
    if (fam === 'meadow') {
      const w = bed('lowpass', 380, 0.4, 0.022); lfo(w.flt.frequency, 0.07, 90);
      if (night) every(() => crickets(), 850, 1600); else every(() => birdChirp(), 2400, 6500);
    } else if (fam === 'jungle') {
      const w = bed('lowpass', 300, 0.4, 0.018); lfo(w.flt.frequency, 0.06, 70);
      bed('bandpass', 5200, 9, 0.008); // insect layer
      if (night) every(() => crickets(1.35), 700, 1400); else every(() => birdChirp(), 1500, 4200);
    } else if (fam === 'volcano') {
      const w = bed('lowpass', 220, 0.4, 0.018); lfo(w.flt.frequency, 0.05, 60);
      bed('lowpass', 85, 0.6, 0.05); // deep lava rumble
      every(() => eruption(), 7000, 14000);
    } else if (fam === 'cave') {
      const w = bed('lowpass', 240, 0.4, 0.012); lfo(w.flt.frequency, 0.05, 60);
      every(() => drip(), 1500, 3800);
    } else if (fam === 'sky') {
      const w = bed('bandpass', 950, 0.4, 0.024); lfo(w.flt.frequency, 0.08, 220);
    } else if (fam === 'city') {
      bed('lowpass', 130, 0.5, 0.024); // urban hum
      every(() => trafficSwell(), 5500, 11000);
      if (night) every(() => crickets(1.1), 1600, 3200); // far outskirts crickets
    } else if (fam === 'desert') {
      const w = bed('bandpass', 520, 0.4, 0.026); lfo(w.flt.frequency, 0.06, 180);
    } else { // snow
      const w = bed('lowpass', 560, 0.4, 0.03); lfo(w.flt.frequency, 0.07, 170);
    }
  }

  stopAmbience() {
    const st = this.ambNodes;
    if (!st || !this.ctx) { this.ambNodes = null; return; }
    this.ambNodes = null;
    st.timers.forEach(id => clearTimeout(id));
    // graceful: fade every bed gain down, then stop sources + LFOs
    const t = this.now();
    for (const g of st.gains) g.gain.setTargetAtTime(0, t, 0.25);
    setTimeout(() => {
      for (const s2 of st.srcs) { try { s2.stop(); } catch { /* stopped */ } }
      for (const o of st.oscs) { try { o.stop(); } catch { /* stopped */ } }
    }, 900);
  }

  // ---------- MUSIC: REMOVED (v1.10) ----------
  // The chiptune sequencer WAS the "repeating annoying sound" — deleted for
  // good. startMusic() stays a no-op so old call sites keep working.
  startMusic(_themeId?: number) {
    void _themeId;
    this.stopMusic();
  }

  stopMusic() {
    if (this.musicTimer !== null) { clearTimeout(this.musicTimer); this.musicTimer = null; }
  }
}

export const audio = new AudioSys();

// QA hook (headless tests): lets the harness drive + inspect the audio engine
if (typeof window !== 'undefined') {
  (window as unknown as { __kuboAudio?: AudioSys }).__kuboAudio = audio;
}
