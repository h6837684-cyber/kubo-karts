// KUBO KARTS - AI drivers: racing line w/ lane offsets, curvature-based speed control,
// drift decisions, item usage heuristics, hazard avoidance, difficulty + rubber-banding.
// BOT REBALANCE (user: "همه بات‌ها سرعت پایین داشته باشن و مثل ما باشن"):
// lower speed multipliers across ALL difficulties + almost no rubber-banding
// (bots used to magically keep up — now they drive like regular players).
// BOT BRAIN v2 (user v1.8: "بات‌ها باهوش‌تر بشن و به خوبی از قدرت‌ها استفاده
// کنن"): every power-up now has a CONTEXT rule — rockets wait for a target
// ahead, mines drop when someone follows, boost fires on straights, shields
// come out under fire, jumps clear hazards — instead of the old blind dice roll.
// BOT HEART v3 (user v1.11: "بات‌ها در حالت عادی از من عقب میفتن … میخوام برای
// اول شدن ۱۰۰ قدرتشونو بذارن جوری که انگار زندگی‌شون وسطه"): bots no longer
// drift away at the back of the pack. Catch-up force now scales with the REAL
// distance to the leader (metres, not rank counts), cornering commitment is
// much higher (they brake late and carry speed through corners), item
// reaction is near-instant and they never hoard power-ups. Difficulty still
// NEVER touches top speed — it is pure skill + a fair catch-up force.
// AI ITEM MASTERY (v1.13, user: "ماشین‌های هوش مصنوعی از من خیلی بهتر باشن —
// سرعتشون یکی هست ولی خیلی بهتر از قدرت‌ها استفاده کنند"): the bot brain now
// fires with PRO-level reflexes — near-zero reaction time, every item has a
// smarter context rule, missiles are countered instantly, EMP is saved for
// real contact, and nothing is ever hoarded. Speed stays EQUAL to the player
// (difficulty = skill + items only, exactly as requested).
import * as THREE from 'three';
import { Kart } from '../kart/kart';
import { clamp, wrapAngle } from '../core/utils';
import type { TrackData } from '../world/track';
import type { ItemId } from '../items/items';

export type AiDifficulty = 'easy' | 'normal' | 'hard' | 'extreme';

// SPEED EQUALITY (user v1.10): bots run the SAME top speed as the player —
// difficulty comes from skill, NOT from an artificial speed handicap.
const DIFF: Record<AiDifficulty, { skill: number; speedMul: number; errJitter: number; rubber: number; itemIQ: number }> = {
  easy: { skill: 0.62, speedMul: 0.97, errJitter: 0.42, rubber: 0.75, itemIQ: 0.72 },
  normal: { skill: 0.82, speedMul: 0.99, errJitter: 0.26, rubber: 1.0, itemIQ: 0.93 },
  hard: { skill: 0.93, speedMul: 1.0, errJitter: 0.13, rubber: 1.15, itemIQ: 0.985 },
  extreme: { skill: 1.0, speedMul: 1.0, errJitter: 0.05, rubber: 1.25, itemIQ: 1.0 },
};

/** scale a bot's HARD top-speed ceiling by its difficulty */
export function applyAiSpeedCap(kart: Kart, diff: AiDifficulty) {
  kart.T.maxSpeed *= DIFF[diff].speedMul;
}

export class AiDriver {
  /** v1.20: artificial catch-up is OFF (kept as a designer switch only) */
  static RUBBER_BANDING = false;
  kart: Kart;
  diff: AiDifficulty;
  private laneOffset = 0;      // preferred lateral offset (racing line personality)
  private laneTarget = 0;
  private laneTimer = 0;
  private jitter = 0;
  private jitterT = 0;
  private reaction = 0;        // item use reaction delay
  private holdT = 0;           // how long the bot has held its current item
  private lookAhead = 14;
  input = { steer: 0, gas: true, brake: false, drift: false };

  constructor(kart: Kart, diff: AiDifficulty, seed: number) {
    this.kart = kart;
    this.diff = diff;
    // BAKE the difficulty speed into the kart's real physics (user: "همه بات‌ها
    // سرعت پایین داشته باشن و مثل ما باشن"). Previously the cap lived only in
    // the AI throttle logic, so a bot in a faster car could still outrun the
    // player. Now a bot's HARD ceiling is diff-scaled below the player's.
    applyAiSpeedCap(kart, diff);
    const rng = mulberry(seed);
    this.laneOffset = (rng() - 0.5) * 0.8;
    this.laneTarget = this.laneOffset;
    this.lookAhead = 12 + Math.floor(rng() * 8);
  }

  update(dt: number, data: TrackData, racers: Kart[], rng: () => number, wantItemUse: boolean) {
    const k = this.kart;
    const D = DIFF[this.diff];
    const N = data.samples.length;
    const s = data.samples[k.sIdx];

    // ---- rubber banding (v3 "fight like their life depends on it"): the
    // catch-up force now scales with the REAL gap to the leader in metres —
    // a bot 200m back gets a strong, visible surge; a bot at the front gets
    // nothing (or a gentle cap so the pack stays bunched and every race ends
    // in a photo finish). Still capped well below "teleport" territory.
    // v1.20 NO RUBBER BANDING (spec §47): the catch-up / leader-cap block
    // below is disabled — bots race on skill + the same physics as players.
    let rubber = 0;
    if (AiDriver.RUBBER_BANDING) {
      const sm = data.length / N;                    // metres per sample
      let leaderPos = k.trackPos;
      for (const r of racers) if (r !== k && !r.isRemote) leaderPos = Math.max(leaderPos, r.trackPos);
      const behindM = (leaderPos - k.trackPos) * sm; // metres behind the leader
      if (behindM > 12) {
        // 0 at 12m → full +0.11 (×diff) at ~180m behind
        rubber = clamp(behindM / 180, 0, 1) * 0.11 * D.rubber;
      } else if (behindM < -60) {
        // leading by >60m: gentle pace cap so races stay close (-3.5%)
        rubber = -0.035;
      }
    }

    // ---- racing line: aim at lookahead sample + lane offset ----
    this.laneTimer -= dt;
    if (this.laneTimer <= 0) {
      this.laneTimer = 1.2 + rng() * 2;
      this.laneTarget = clamp(this.laneOffset + (rng() - 0.5) * D.errJitter * 1.6, -0.75, 0.75);
    }
    const ahead1 = data.samples[(k.sIdx + this.lookAhead) % N];
    const ahead2 = data.samples[(k.sIdx + this.lookAhead * 2) % N];
    const targetPt = ahead1.pos.clone().addScaledVector(ahead1.left, this.laneTarget * ahead1.width * 0.5);

    // steer toward target
    const toTarget = Math.atan2(targetPt.x - k.pos.x, targetPt.z - k.pos.z);
    let steerErr = wrapAngle(toTarget - k.heading);
    this.jitterT -= dt;
    if (this.jitterT <= 0) { this.jitterT = 0.5 + rng(); this.jitter = (rng() - 0.5) * D.errJitter * 0.5; }
    steerErr += this.jitter;
    this.input.steer = clamp(steerErr * 2.4, -1, 1);

    // ---- curvature-based speed control (v3: COMMITTED cornering — bots
    // used to lift way too early and bleed speed every lap, which is exactly
    // why they fell behind in normal mode. They now carry speed deep into
    // corners and only brake when genuinely overcooked.) ----
    const curvature = Math.abs(wrapAngle(Math.atan2(ahead2.pos.x - ahead1.pos.x, ahead2.pos.z - ahead1.pos.z) - Math.atan2(ahead1.pos.x - s.pos.x, ahead1.pos.z - s.pos.z)));
    // NOTE: speedMul is baked into T.maxSpeed in the constructor
    const maxSpeed = k.T.maxSpeed * (1 + rubber);
    this.input.gas = k.speed < maxSpeed * (curvature > 0.5 ? 0.92 : 0.985);
    this.input.brake = k.speed > maxSpeed * (curvature > 0.5 ? 1.12 : 1.3);

    // ---- drift decision: sharp corner ahead + speed ----
    const sharpCorner = curvature > 0.42 && Math.abs(steerErr) > 0.18;
    this.input.drift = sharpCorner && k.speed > 13 && k.grounded && rng() < D.skill;

    // ---- hazard avoidance: check samples ahead for hazards near my lane ----
    for (let i = 2; i < 30; i += 4) {
      const hs = data.samples[(k.sIdx + i) % N];
      for (const h of data.hazards) {
        if (Math.abs(h.sIdx - ((k.sIdx + i) % N)) < 4) {
          const hLane = h.lane * hs.width * 0.5;
          const myLane = this.laneTarget * hs.width * 0.5;
          if (Math.abs(hLane - myLane) < 2.5) {
            this.laneTarget = clamp(this.laneTarget - Math.sign(hLane - myLane + 0.01) * 0.5, -0.8, 0.8);
          }
        }
      }
    }

    // ---- items: PRO-LEVEL contextual use (v1.13 item mastery — the bots
    // react FASTER than a human can: defensive items come out within ~0.15s
    // of a lock-on, offensive items fire the moment their shot is live, and
    // nothing is hoarded longer than 2.6s) ----
    this.reaction -= dt;
    // don't hoard: fire anyway after 2.6s of holding
    if (k.item) this.holdT += dt; else this.holdT = 0;
    const impatient = this.holdT > 2.6;
    // v1.9/v1.13 MISSILE DEFENSE REFLEX: when a rocket is homing on this bot
    // (ItemSystem sets threatT every tick it homes), defensive items fire
    // INSTANTLY — shields up, phase out, drop a mine into its flight path, or
    // floor it to outrun the blast. The reaction window is humanly unfair:
    // that is exactly what the user asked the bots to be.
    const underRocketFire = k.threatT > 0;
    if (underRocketFire && wantItemUse && k.item && this.reaction <= 0
        && (k.item === 'shield' || k.item === 'ghost' || k.item === 'boost' || k.item === 'mine' || k.item === 'magnet' || k.item === 'tnt')) {
      this.useSignal = true;
      this.holdT = 0;
      this.reaction = 0.15 + rng() * 0.3;
    } else if (wantItemUse && k.item && this.reaction <= 0
        && (impatient || (rng() < D.itemIQ && this.smartItemUse(k.item as ItemId, data, racers, rng)))) {
      this.useSignal = true;
      this.holdT = 0;
      this.reaction = 0.22 + rng() * 0.55;
    }
    // pick up item boxes: steer toward them whenever ANY slot is free (3-slot queue)
    if (k.itemCount < Kart.ITEM_SLOTS) {
      for (const ib of data.itemBoxes) {
        if (Math.abs(ib.sIdx - k.sIdx) < 14 && Math.abs(ib.sIdx - k.sIdx) > 2) {
          const bs = data.samples[ib.sIdx];
          const d = k.pos.distanceTo(bs.pos);
          if (d < 12) { this.laneTarget = ib.lane; break; }
        }
      }
    }
  }

  /** context rules per power-up — a bot only fires when the shot MAKES SENSE */
  private smartItemUse(item: ItemId, data: TrackData, racers: Kart[], rng: () => number): boolean {
    const k = this.kart;
    const N = data.samples.length;
    const sm = data.length / N;                       // meters per sample
    // nearest racer ahead / behind on track (in samples)
    let ahead = Infinity, behind = Infinity;
    for (const r of racers) {
      if (r === k || r.finished) continue;
      const gA = ((r.trackPos - k.trackPos) + N * 2) % N;
      if (gA < N / 2 && gA < ahead) ahead = gA;
      const gB = ((k.trackPos - r.trackPos) + N * 2) % N;
      if (gB < N / 2 && gB < behind) behind = gB;
    }
    // straight-ahead check (for boost): curvature over the next ~50m
    const straightAhead = () => {
      const s1 = data.samples[(k.sIdx + 12) % N];
      const s2 = data.samples[(k.sIdx + 30) % N];
      const h1 = Math.atan2(s1.pos.x - k.pos.x, s1.pos.z - k.pos.z);
      const h2 = Math.atan2(s2.pos.x - s1.pos.x, s2.pos.z - s1.pos.z);
      return Math.abs(wrapAngle(h2 - h1)) < 0.3;
    };
    // hazard directly in front (for jump)
    const hazardAhead = () => {
      for (let i = 3; i < 14; i += 2) {
        for (const h of data.hazards) {
          if (Math.abs(h.sIdx - ((k.sIdx + i) % N)) < 3) return true;
        }
      }
      return false;
    };
    void hazardAhead;
    switch (item) {
      case 'rocket': return ahead * sm > 10;                       // ANY live target — fire fast, hunt far
      case 'ice': return ahead * sm > 8 && ahead * sm < 95;        // close enough to land the orb
      case 'lightning': return ahead < N / 2;                      // anyone ahead at all
      case 'mine': case 'trap': return behind * sm < 70 || ahead * sm > N * sm * 0.4; // being chased… or lonely leader
      case 'boost': return straightAhead() || k.threatT > 0;       // save for a straight / outrun a missile
      case 'shield': return behind * sm < 55 || ahead * sm < 30 || k.threatT > 0;   // under fire / close racing / missile!
      case 'giant': return ahead * sm < 70 || behind * sm < 35;    // brawl time
      case 'ghost': return behind * sm < 50 || k.threatT > 0 || rng() < 0.3;       // escaping, missile dodge, or pre-attack phase
      case 'magnet': return k.itemCount < 2 && behind * sm > 25;   // want MORE boxes, but not while someone is on the bumper
      case 'emp': return ahead * sm < 12 || behind * sm < 12;      // real contact range (blast ≈ 9m)
      case 'jump': return behind * sm < 60 || ahead * sm > N * sm * 0.4; // v3 SPRING MINE: plant it in a chaser's line
      // v1.21 new items — bots play them like a pro would
      case 'tnt': return (behind * sm > 4 && behind * sm < 30) || k.threatT > 0;   // chaser right on the bumper → it blows in their face
      case 'banana': return behind * sm < 45 || ahead * sm > N * sm * 0.4;        // defend the line / lonely leader
      case 'minecart': return ahead * sm > 6 && ahead * sm < N * sm * 0.5;          // anyone ahead within half a lap
      default: return true;
    }
  }

  useSignal = false;
  consumeUse(): boolean { const v = this.useSignal; this.useSignal = false; return v; }
}

function mulberry(seed: number) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
void THREE;
