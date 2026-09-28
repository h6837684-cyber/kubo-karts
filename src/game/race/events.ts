// KUBO KARTS v3.5 - MID-RACE EVENTS + LIVE STAGE GOAL helpers.
// user: "میخوا ببینی مشکل مرحله ها چیه چرا انقدر بی جون هست" / "نوار زندهٔ هدف
// مرحله و اتفاق‌های وسط مسیر". Why stages felt lifeless: between the start and
// the finish NOTHING happened — no small goals, no callouts, no surprises.
// Kids (and every good racing game) need a reward every 10-20 seconds:
//  • OVERTAKE CALLOUTS: every pass pops "+15" and pays coins (x2 on the last lap)
//  • MINI MISSIONS: every ~30s a 12-15s mission (pass a car, drift, use a
//    power-up, jump, don't get hit, hold 1st). Success = coins + a FREE NITRO
//  • LUCKY BOX: from lap 2 each new lap may drop a free power-up
//  • LAST LAP hype banner
// Single-player only (career + quick race). Multiplayer stays pure.
import { t, getLang } from '../core/lang';
import { faDigits } from '../core/utils';

export type MissionKind = 'overtake' | 'hold' | 'drift' | 'item' | 'nohit' | 'jump';

export interface EvSnap {
  raceMs: number; pos: number; total: number;
  drift: number; items: number; jumps: number; hp: number; spinouts: number;
  lap: number; laps: number; finalLap: boolean; hasJumps: boolean;
}
export interface MissionHud { txt: string; frac: number; left: number; state: 'run' | 'done' | 'fail'; kind: MissionKind }

interface Mission { kind: MissionKind; need: number; base: number; t: number; dur: number; state: 'run' | 'done' | 'fail'; showT: number; acc: number }

const N = (n: number | string) => (getLang() === 'fa' ? faDigits(n) : String(n));

export class RaceEvents {
  overtakes = 0;
  missionsDone = 0;
  coins = 0;
  mission: Mission | null = null;
  /** (text, gold) -> centre banner */
  onMsg: ((txt: string, gold: boolean) => void) | null = null;
  /** mission reward / lucky box */
  onReward: ((kind: 'nitro' | 'item') => void) | null = null;

  private next = 14000;          // first mission ~14s after GO
  private prevPos = -1;
  private prevLap = 1;
  private finalShown = false;
  private msgCool = 0;

  constructor(private itemsOn: boolean, private mul: number) {}

  private msg(txt: string, gold = true, force = false) {
    if (!force && this.msgCool > 0) return;
    this.msgCool = 1.2;
    this.onMsg?.(txt, gold);
  }

  update(dt: number, s: EvSnap) {
    if (this.msgCool > 0) this.msgCool -= dt;

    // ---- overtakes ----
    if (this.prevPos < 0) this.prevPos = s.pos;
    if (s.pos < this.prevPos && s.raceMs > 2500) {
      const n = this.prevPos - s.pos;
      const each = s.finalLap ? 30 : 15;
      this.overtakes += n;
      this.coins += Math.round(each * n * this.mul);
      if (!this.mission || this.mission.state !== 'run' || this.mission.kind !== 'overtake') this.msg(t('ev_pass', N(Math.round(each * n * this.mul))));
    }
    this.prevPos = s.pos;

    // ---- last lap hype ----
    if (s.finalLap && !this.finalShown && s.laps > 1) { this.finalShown = true; this.msg(t('ev_final'), true, true); }

    // ---- lucky box on a new lap ----
    if (s.lap > this.prevLap) {
      this.prevLap = s.lap;
      if (this.itemsOn && Math.random() < 0.6) { this.onReward?.('item'); this.msg(t('ev_gift'), true, true); }
    }

    // ---- mini missions ----
    const m = this.mission;
    if (m) {
      if (m.state === 'run') {
        m.t -= dt;
        const p = this.progress(m, s, dt);
        if (m.kind === 'nohit' && (s.spinouts > m.base || s.hp < m.acc)) this.fail(m);
        else if (m.kind === 'nohit' ? m.t <= 0 : p >= m.need) this.win(m);
        else if (m.t <= 0) this.fail(m);
      } else {
        m.showT -= dt;
        if (m.showT <= 0) { this.mission = null; this.next = s.raceMs + 22000 + Math.random() * 12000; }
      }
    } else if (s.raceMs >= this.next && (!s.finalLap || s.laps === 1)) {
      this.start(s);
    }
  }

  private pickKind(s: EvSnap): MissionKind {
    const pool: MissionKind[] = ['drift', 'nohit'];
    if (s.pos > 1) pool.push('overtake', 'overtake'); else pool.push('hold', 'hold');
    if (this.itemsOn) pool.push('item');
    if (s.hasJumps) pool.push('jump');
    return pool[Math.floor(Math.random() * pool.length)];
  }

  private start(s: EvSnap) {
    const kind = this.pickKind(s);
    const dur = kind === 'hold' || kind === 'nohit' ? 12 : 15;
    const need = kind === 'overtake' ? 1 : kind === 'hold' ? 1 : kind === 'drift' ? 3 : kind === 'item' ? 1 : kind === 'jump' ? 1 : 1;
    const base = kind === 'overtake' ? s.pos : kind === 'drift' ? s.drift : kind === 'item' ? s.items : kind === 'jump' ? s.jumps : kind === 'nohit' ? s.spinouts : 0;
    this.mission = { kind, need, base, t: dur, dur, state: 'run', showT: 0, acc: kind === 'nohit' ? s.hp : 0 };
    this.msg(t('ev_new'), true, true);
  }

  private progress(m: Mission, s: EvSnap, dt: number): number {
    switch (m.kind) {
      case 'overtake': return Math.max(0, m.base - s.pos);
      case 'drift': return s.drift - m.base;
      case 'item': return s.items - m.base;
      case 'jump': return s.jumps - m.base;
      case 'hold':
        // stay 1st for the whole window (a lost lead fails it)
        if (s.pos !== 1) { m.t = 0; return 0; }
        return m.t <= dt ? 1 : 0;
      case 'nohit': return m.dur - m.t;
    }
  }

  private win(m: Mission) {
    m.state = 'done'; m.showT = 1.8;
    this.missionsDone++;
    this.coins += Math.round(60 * this.mul);
    this.onReward?.('nitro');
    this.msg(t('ev_done'), true, true);
  }
  private fail(m: Mission) {
    m.state = 'fail'; m.showT = 1.4;
    this.msg(t('ev_fail'), false, true);
  }

  hud(s: EvSnap): MissionHud | null {
    const m = this.mission;
    if (!m) return null;
    let frac = 0;
    let txt = '';
    switch (m.kind) {
      case 'overtake': frac = Math.min(1, Math.max(0, m.base - s.pos) / m.need); txt = t('ev_m_overtake'); break;
      case 'hold': frac = 1 - m.t / m.dur; txt = t('ev_m_hold'); break;
      case 'drift': frac = Math.min(1, (s.drift - m.base) / m.need); txt = t('ev_m_drift', N(m.need)); break;
      case 'item': frac = Math.min(1, (s.items - m.base) / m.need); txt = t('ev_m_item'); break;
      case 'jump': frac = Math.min(1, (s.jumps - m.base) / m.need); txt = t('ev_m_jump'); break;
      case 'nohit': frac = 1 - m.t / m.dur; txt = t('ev_m_nohit'); break;
    }
    if (m.state === 'done') frac = 1;
    return { txt, frac, left: Math.max(0, Math.ceil(m.t)), state: m.state, kind: m.kind };
  }
}
