// KUBO KARTS - WORLD BUILDER v2 (full rebuild).
// Design goals (fixes old flooded-world bug):
//  - Land is ALWAYS above water inside the island ring; sea only at the far rim.
//  - Terraced, blocky terrain with rock/snow/sand zoning; corridor flat next to road.
//  - RoadField: spatial hash of road samples -> O(1) ground queries for terrain + physics.
//  - Bridges (rails + pillars), tunnels (arched roofs + lamps), jump ramps with lips.
//  - Theme landmarks at map center; rich on-land decoration placement.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng, clamp } from '../core/utils';
import type { ThemeDef } from './themes';
import { getDecoGeo, decoMaterial } from './deco';
import { makeWaterMaterial, makeLavaMaterial, makeItemBoxMaterial, makeItemBoxFrameMaterial, makeQuestionBillboardMaterial, makeDetailedVoxelMaterial } from '../gfx/materials';
import { roadTexture, roadNormalTexture } from '../gfx/textures';

export interface TrackSample {
  pos: THREE.Vector3; tan: THREE.Vector3; left: THREE.Vector3;
  width: number; progress: number; hasRoad: boolean;
}

export interface TrackData {
  samples: TrackSample[];
  length: number;
  itemBoxes: { sIdx: number; lane: number }[];
  boostPads: { sIdx: number; lane: number }[];
  hazards: { type: string; sIdx: number; lane: number; phase: number; y: number }[];
  startGrid: { pos: THREE.Vector3; heading: number }[];
  themeId: string;
  seed: number;
  laps: number;
  waterLevel: number;
  lavaLevel: number;
  groundAt: (x: number, z: number) => number;
  groundInfo: (x: number, z: number) => { h: number; d: number };
  jumpRanges: [number, number][];
  bridgeRanges: [number, number][];
  tunnelRanges: [number, number][];
  /** v2.0 POINT-TO-POINT tracks (MEGA RAMP): start and finish are NOT
   *  connected. Samples are rotated so the FINISH line sits at index 0 (the
   *  regular lap-wrap = finish crossing) and the segment seam→seam+1 is the
   *  physical dead end (runoff end ↔ start platform). */
  open?: boolean;
  seam?: number;
  /** sample index of the START line on open tracks (grid sits behind it) */
  startIdx?: number;
}

/** air themes: no island terrain, the road floats (sky gardens, mega ramp) */
export function isAirTheme(id: string): boolean { return id === 'sky' || id === 'megaramp'; }
/** true when segment i→i+1 is a real, drivable/renderable road segment */
export function segOk(data: { open?: boolean; seam?: number }, i: number): boolean {
  return !(data.open && data.seam !== undefined && i === data.seam);
}

// ================= layout generators =================
// Every generator returns a closed loop of control points + feature flags.
interface Layout {
  pts: THREE.Vector3[];
  width: number;
  elev: (t: number) => number;   // elevation profile over loop param 0..1 (must be periodic)
  bridges: [number, number][];   // loop param ranges (elevated over ground)
  tunnels: [number, number][];
  jumps: [number, number][];     // param ranges: gap in road
  pinch?: [number, number][];    // narrow sections
  /** v2.0: open (point-to-point) layout — control points carry their own Y */
  open?: boolean;
  runoff?: number;               // meters of road AFTER the finish line
  startAt?: number;              // meters from the first point to the start line
}
type Gen = (rng: () => number) => Layout;

const TAU = Math.PI * 2;
function smoothstep(a: number, b: number, x: number) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function ringLayout(rng: () => number, opts: {
  rBase?: number; rVar?: number; lobes?: number; wob?: number;
  elevAmp?: number; elevFreq?: number; tilt?: number; width?: number;
  bridges?: [number, number][]; tunnels?: [number, number][]; jumps?: [number, number][];
  pinch?: [number, number][];
}): Layout {
  const n = 16;
  // MEGA MAPS v3 (user v1.10: "همه مپ‌ها چند برابر بزرگ‌تر و پر جزئیات‌تر بشن
  // و همه متفاوت از هم باشند"): EVERY layout is scaled ~2x on top of the old
  // v2 pass, AND each generated instance gets a seed-based size jitter (±10%)
  // — the same gen on two different levels no longer produces the same ring.
  const MAP_SCALE = 1.95;
  const jitter = 0.9 + rng() * 0.2;
  const rBase = (opts.rBase ?? (128 + rng() * 36)) * MAP_SCALE * jitter;
  const rVar = (opts.rVar ?? (22 + rng() * 16)) * MAP_SCALE;
  const lobes = opts.lobes ?? 2;
  const wob = opts.wob ?? 0.5;
  const phase = rng() * TAU;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const a = t * TAU;
    const r = rBase + Math.sin(a * lobes + phase) * rVar + Math.sin(a * (lobes + 2) - phase) * rVar * wob * 0.5;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * (0.82 + rng() * 0.1);
    pts.push(new THREE.Vector3(x, 0, z));
  }
  const elevAmp = opts.elevAmp ?? 0;
  const elevFreq = opts.elevFreq ?? 2;
  return {
    pts, width: opts.width ?? 16,
    elev: (t) => elevAmp > 0 ? Math.sin(t * TAU * elevFreq + phase) * elevAmp + elevAmp * 0.6 : 0,
    bridges: opts.bridges ?? [], tunnels: opts.tunnels ?? [], jumps: opts.jumps ?? [],
    pinch: opts.pinch,
  };
}

const GENS: Record<string, Gen> = {
  // MEGA MAPS v3: each gen keeps its character but every layout got its own
  // road width + ~2x radius — so OVAL reads as a huge speedway, PINBALL as a
  // wide technical canyon of chicanes, MEGACITY as a grand metropolis circuit
  // (user: "همه متفاوت از هم باشند").
  oval: (rng) => ringLayout(rng, { rBase: 150, rVar: 12, lobes: 2, wob: 0.3, elevAmp: 3.2, elevFreq: 2, width: 18.5 }),
  kidney: (rng) => ringLayout(rng, { rBase: 134, rVar: 30, lobes: 1, wob: 1.2, elevAmp: 4.5, elevFreq: 2, width: 17 }),
  sCurves: (rng) => {
    const l = ringLayout(rng, { rBase: 142, rVar: 42, lobes: 3, wob: 0.9, elevAmp: 3.6, elevFreq: 3, width: 16 });
    l.pinch = [[0.18, 0.26], [0.55, 0.63]];
    return l;
  },
  figure8: (rng) => {
    // elevated crest crossing over the far side via bridge segment
    const l = ringLayout(rng, { rBase: 132, rVar: 20, lobes: 2, wob: 0.4, width: 17 });
    l.bridges = [[0.42, 0.58]];
    l.elev = (t) => t > 0.36 && t < 0.64 ? 7.2 * Math.sin((t - 0.36) / 0.28 * Math.PI) : 0;
    return l;
  },
  star: (rng) => {
    const l = ringLayout(rng, { rBase: 124, rVar: 46, lobes: 5, wob: 0.15, elevAmp: 3.4, elevFreq: 5, width: 15 });
    return l;
  },
  canyon: (rng) => {
    const l = ringLayout(rng, { rBase: 140, rVar: 36, lobes: 4, wob: 0.8, elevAmp: 5.5, elevFreq: 2, width: 16.5 });
    l.tunnels = [[0.3, 0.37]];
    return l;
  },
  highlands: (rng) => ringLayout(rng, { rBase: 130, rVar: 28, lobes: 2, wob: 0.6, elevAmp: 8.5, elevFreq: 2, width: 17.5 }),
  switchback: (rng) => {
    // climb up over half the loop, crest bridge, descend the other side
    const l = ringLayout(rng, { rBase: 134, rVar: 34, lobes: 2, wob: 0.7, width: 15.5 });
    l.elev = (t) => {
      const up = smoothstep(0.02, 0.4, t) * 12.5;
      const down = smoothstep(0.72, 0.98, t) * 12.5;
      return up - down + 0.5;
    };
    l.bridges = [[0.44, 0.56]];
    l.pinch = [[0.2, 0.3], [0.62, 0.72]];
    return l;
  },
  pretzel: (rng) => {
    const l = ringLayout(rng, { rBase: 124, rVar: 40, lobes: 3, wob: 1.1, elevAmp: 5.8, elevFreq: 3, width: 16 });
    l.jumps = [[0.5, 0.525]];
    return l;
  },
  coast: (rng) => {
    const l = ringLayout(rng, { rBase: 148, rVar: 24, lobes: 2, wob: 0.5, elevAmp: 2.2, elevFreq: 2, width: 18 });
    l.bridges = [[0.46, 0.6]]; // long bridge over the bay
    l.elev = (t) => t > 0.44 && t < 0.62 ? 4 * Math.sin((t - 0.44) / 0.18 * Math.PI) : 0;
    return l;
  },
  skyhop: (rng) => {
    const l = ringLayout(rng, { rBase: 124, rVar: 28, lobes: 3, wob: 0.6, elevAmp: 5.6, elevFreq: 3, width: 16 });
    l.jumps = [[0.3, 0.33], [0.68, 0.71]];
    return l;
  },
  pinball: (rng) => {
    const l = ringLayout(rng, { rBase: 132, rVar: 34, lobes: 6, wob: 0.7, elevAmp: 2.8, elevFreq: 4, width: 15 });
    l.pinch = [[0.1, 0.16], [0.35, 0.41], [0.6, 0.66], [0.85, 0.91]];
    return l;
  },
  // MEGACITY (v1.9 CRASH CITY): the BIGGEST layout in the game — now even
  // grander at ~2x scale with a wide 19m roadway sweeping across downtown.
  megacity: (rng) => {
    const l = ringLayout(rng, { rBase: 188, rVar: 36, lobes: 4, wob: 0.55, elevAmp: 3.8, elevFreq: 2, width: 19 });
    l.bridges = [[0.48, 0.62]];
    l.tunnels = [[0.14, 0.2]];
    l.elev = (t) => (t > 0.46 && t < 0.64 ? 7 * Math.sin((t - 0.46) / 0.18 * Math.PI) : 1.4 * Math.sin(t * TAU * 2) * 0.4);
    return l;
  },
};

// ================= v2.0 MEGA RAMP (point-to-point sky road) =================
// Reference-inspired stunt track: a floating asphalt ribbon high above the
// sea with a huge opening drop, a climbing 180° curl, a monster descent with a
// kicker, S-bends and a final plunge to the finish. START and FINISH are far
// apart and NOT connected (user: "از یه نقطه شروع بشه و از یه نقطه دیگه تمام
// بشه یعنی به هم وصل نباشن").
const MEGA_PTS: [number, number, number][] = [
  // A — start platform + opening drop
  [0, -60, 58], [0, 0, 58], [0, 70, 58], [0, 140, 55], [2, 215, 36], [6, 280, 25], [12, 325, 28],
  // B — sweeping right
  [40, 390, 25], [110, 430, 29], [190, 440, 34],
  // C — climbing 180° curl
  [260, 425, 40], [315, 385, 46], [335, 320, 51], [320, 255, 56], [270, 215, 60],
  // D — high straight, then the MONSTER descent + kicker
  [232, 150, 62], [222, 70, 63], [216, -20, 50], [211, -110, 29], [208, -170, 20], [206, -210, 24],
  // E — S-bends heading west
  [170, -270, 22], [110, -262, 24], [60, -310, 26], [0, -300, 29],
  // F — final climb, crest, plunge, finish + runoff
  [-60, -340, 38], [-130, -332, 48], [-190, -292, 45], [-235, -222, 25], [-255, -142, 21],
  [-264, -60, 21], [-270, 20, 21], [-274, 100, 21], [-276, 170, 21],
];
function megaLayout(rng: () => number, mirror: boolean, hMul: number): Layout {
  const sc = 1.25;
  const pts = MEGA_PTS.map(([x, z, y]) => new THREE.Vector3((mirror ? -x : x) * sc, 18 + (y - 18) * hMul + (rng() - 0.5) * 1.5, z * sc));
  return {
    pts, width: 17, elev: () => 0, bridges: [], tunnels: [], jumps: [],
    pinch: [[0.62, 0.66], [0.7, 0.73]],
    open: true, runoff: 170, startAt: 95,
  };
}
GENS.megaramp = (rng) => megaLayout(rng, false, 1);
GENS.megadrop = (rng) => megaLayout(rng, true, 1.18);

// theme -> preferred layouts (cycled by seed)
const THEME_GENS: Record<string, string[]> = {
  grass: ['oval', 'kidney', 'sCurves'],
  castle: ['figure8', 'canyon', 'oval'],
  desert: ['canyon', 'oval', 'pinball'],
  snow: ['highlands', 'kidney', 'sCurves'],
  volcano: ['canyon', 'pretzel', 'star'],
  cave: ['canyon', 'figure8', 'pinball'],
  sky: ['skyhop', 'figure8', 'star'],
  city: ['pinball', 'oval', 'sCurves'],
  crashcity: ['megacity'],
  mccity: ['megacity', 'pinball', 'kidney'],
  ruins: ['pretzel', 'coast', 'oval'],
  jungle: ['star', 'kidney', 'skyhop'],
  megaramp: ['megaramp', 'megadrop'],
  // v3.3 premium maps
  candy: ['kidney', 'sCurves', 'star'],
  galaxy: ['skyhop', 'figure8', 'star'],
  dragon: ['pretzel', 'canyon', 'star'],
  royal: ['megacity', 'pinball'],
};

/** loop layouts only (random picks for loop themes never land on an open gen) */
export const GEN_NAMES = Object.keys(GENS).filter(g => g !== 'megaramp' && g !== 'megadrop');

// ================= track data generation =================
export function generateTrackData(seed: number, opts: { genName?: string; laps: number; themeId: string; itemRows?: number }): TrackData {
  // defensive defaults: a malformed LevelDef must never poison the world math
  const safeSeed = Number.isFinite(seed) ? seed : 1234;
  const rng = makeRng(safeSeed);
  const themeId = opts.themeId || 'grass';
  const pool = THEME_GENS[themeId] ?? GEN_NAMES;
  const genName = opts.genName && GENS[opts.genName] ? opts.genName : pool[Math.floor(rng() * pool.length)] ?? 'oval';
  // open (point-to-point) gens only on the mega ramp world and vice versa
  const wantOpen = themeId === 'megaramp';
  let gName = genName;
  if (wantOpen && gName !== 'megaramp' && gName !== 'megadrop') gName = 'megaramp';
  if (!wantOpen && (gName === 'megaramp' || gName === 'megadrop')) gName = 'oval';
  const layout = (GENS[gName] ?? GENS.oval)(rng);
  const OPEN = !!layout.open;

  const curve = new THREE.CatmullRomCurve3(layout.pts, !OPEN, 'catmullrom', 0.5);
  const approxLen = curve.getLength();
  // MEGA MAPS v3: the sample cap grows again for the ~2x layouts — 2200
  // samples keep even a ~4.5km monster lap smooth (≈2m per sample).
  const N = Math.max(300, Math.min(2200, Math.round(approxLen / 1.5)));
  // island scale: the largest radial distance of the road ring — every rim / sea
  // / mountain band below is expressed RELATIVE to it so big tracks get big
  // islands (the old constants assumed ~70m rings and drowned the center)
  let maxR = 0;
  for (const p of layout.pts) maxR = Math.max(maxR, p.length());
  maxR = Math.max(70, maxR);

  // param-range helpers -> sample-index ranges
  const toRange = (r: [number, number]): [number, number] => [Math.floor(r[0] * N), Math.ceil(r[1] * N)];
  // COMPLETE ROADS (user v1.11: "جاده‌ها کامل جاده نیستن … میخوام جاده کامل
  // داشته باشه"): JUMP GAPS ARE GONE on every map. The ribbon is now one
  // continuous piece of asphalt from the start line to the finish line —
  // there is no "hole in the middle of the road" left to swallow a kart on
  // the lava map or anywhere else. The gap pit / fall-respawn machinery
  // stays in place (harmless no-op with zero ranges) so nothing else breaks.
  const jumpRanges: [number, number][] = [];
  const tunnelRanges = (layout.tunnels ?? []).map(toRange);
  const bridgeRanges = (layout.bridges ?? []).map(toRange);
  const pinchRanges = (layout.pinch ?? []).map(toRange);

  const inRanges = (ranges: [number, number][], i: number) => {
    for (const [a, b2] of ranges) if (i >= a && i <= b2) return true;
    return false;
  };

  // sample the curve
  const up = new THREE.Vector3(0, 1, 0);
  const samples: TrackSample[] = [];
  for (let i = 0; i < N; i++) {
    const t = OPEN ? i / (N - 1) : i / N;
    const pos = curve.getPointAt(t);
    if (!OPEN) pos.y = layout.elev(t);
    const tan = curve.getTangentAt(t);
    if (OPEN) tan.y = 0;          // flat tangent: lateral/along math stays metric on slopes
    tan.normalize();
    const left = new THREE.Vector3().crossVectors(up, tan).normalize();
    samples.push({ pos, tan, left, width: layout.width, progress: t, hasRoad: true });
  }

  // smooth elevation (circular) so slopes stay drivable
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < N; i++) {
      const p = samples[i];
      const a = samples[OPEN ? Math.max(0, i - 1) : (i - 1 + N) % N], b2 = samples[OPEN ? Math.min(N - 1, i + 1) : (i + 1) % N];
      p.pos.y = a.pos.y * 0.27 + p.pos.y * 0.46 + b2.pos.y * 0.27;
    }
  }

  // SINK ROOT-CAUSE FIX (v1.13, user: "جاده ناقصه / ماشین میره زیر زمین — برای
  // همه مپ‌ها ریشه‌یابی کن"): the auditor found the REAL reason roads
  // "disappear" on volcano / castle / jungle — the elevation profile dips the
  // road BELOW the island's guaranteed ground floor (water +2.0, lava +1.6).
  // groundHeight then correctly clamps the terrain UP to that floor, which
  // BURIES the road deck under up to +2.2m of ground/lava — the kart drives
  // into solid earth exactly where the road looks broken. Fix: clamp every
  // road sample to stay safely ABOVE the fluid floor (never under it).
  // (runs AFTER the water/lava constants are known — see below)
  // ramp lips at jumps: raise 4 samples before gap, dip 2 landing samples
  for (const [a, b2] of jumpRanges) {
    const g0 = ((a % N) + N) % N;
    for (let k = 1; k <= 4; k++) {
      const i = ((g0 - k) % N + N) % N;
      samples[i].pos.y += 0.62 * (1 - k / 5);
    }
    for (let k = 0; k < 3; k++) {
      const i = ((b2 + k) % N + N) % N;
      samples[i].pos.y -= 0.25;
    }
  }

  // width profile: base + corner widening + pinch narrow + start straight wide
  // WIDER ROADS (user v1.11: "جاده‌ها بزرگ‌تر باشند"): every map gains +2.6m
  // of asphalt so racing side-by-side never squeezes anyone off the road.
  const baseW = layout.width + 2.6;
  for (let i = 0; i < N; i++) {
    const t = i / N;
    let w = baseW * (1 + 0.1 * Math.sin(t * TAU * 3 + seed * 0.13));
    if (!OPEN && (t < 0.05 || t > 0.95)) w = Math.max(w, baseW * 1.18);       // start straight
    if (OPEN && (t < 0.07 || t > 0.9)) w = Math.max(w, baseW * 1.15);        // start platform + finish runoff
    if (inRanges(pinchRanges, i)) w = baseW * 0.78;
    samples[i].width = w;
  }
  // smooth width
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < N; i++) {
      const p = samples[i];
      const a = samples[OPEN ? Math.max(0, i - 1) : (i - 1 + N) % N], b2 = samples[OPEN ? Math.min(N - 1, i + 1) : (i + 1) % N];
      p.width = a.width * 0.3 + p.width * 0.4 + b2.width * 0.3;
    }
  }

  // road gaps at jumps — OBSOLETE (v1.11 complete roads): nothing to clear,
  // every sample keeps hasRoad=true.
  for (let i = 0; i < N; i++) {
    if (inRanges(jumpRanges, i)) samples[i].hasRoad = false;
  }

  // ===== ground field (shared by terrain mesh + physics) =====
  // v2.0.1 BUGFIX (user: "مگارمپ باگ داره"): the RoadField MUST be built AFTER
  // the open-track rotation below. The rotation is an in-place PERMUTATION of
  // the samples array; bins built before it stored (cell -> old index) pairs,
  // so after the permutation every query resolved to a sample at a DIFFERENT
  // position -> query() returned null everywhere -> groundAt() = -9999 on the
  // WHOLE mega ramp world (deck centre included!) -> kart.ts flagged 'fall'
  // every frame -> endless fall→respawn(+6 samples) loop -> karts crawled at
  // 0-13 km/h. Closed tracks never rotate, which is why only Mega Ramp broke.
  const theme = themeId;
  const waterLevel = isAirTheme(theme) ? -999 : -3.4;
  const lavaLevel = -1.6;

  // (SINK FIX — see note above the jump lips) clamp the road ABOVE the
  // fluid floor: water land floor = waterLevel+2.0, volcano lava floor =
  // lavaLevel+1.6. +0.55m of deck clearance so the ribbon never sinks even
  // 1cm under the terrain that groundHeight guarantees around it.
  {
    const waterFloor = waterLevel > -900 ? waterLevel + 2.0 : -9999;
    const lavaFloor = theme === 'volcano' ? lavaLevel + 1.6 : -9999;
    const minRoadY = Math.max(waterFloor, lavaFloor) + 0.55;
    for (let i = 0; i < N; i++) {
      if (samples[i].pos.y < minRoadY) samples[i].pos.y = minRoadY;
    }
  }

  // ===== v2.0 OPEN TRACK: rotate so the FINISH line is sample 0 =====
  // orig: [0 … start … finish … N-1(runoff end)]  →  new index = (orig − F) mod N
  // The lap-wrap (N-1 → 0) is now the finish crossing, and the physical dead
  // end (orig N-1 | orig 0) becomes the seam R-1 | R that no code bridges.
  let openInfo: { seam: number; startIdx: number } | null = null;
  if (OPEN) {
    const segLen = approxLen / (N - 1);
    const F = Math.max(10, N - 1 - Math.round((layout.runoff ?? 150) / segLen));
    const startOrig = Math.round((layout.startAt ?? 80) / segLen);
    const rotated = samples.slice(F).concat(samples.slice(0, F));
    for (let i = 0; i < N; i++) { samples[i] = rotated[i]; samples[i].progress = i / N; }
    const R = N - F;
    openInfo = { seam: R - 1, startIdx: R + startOrig };
  }

  // gap-aware ground: the terrain under a JUMP GAP dips into a shallow pit so
  // a failed jump becomes a visible hole + instant fall-respawn instead of
  // the kart getting wedged between two road lips at road level (user bug:
  // "جاده یه باگی داره، میرم داخلش")
  const inGap = (i: number) => jumpRanges.some(([a, b2]) => i >= a && i <= b2);
  // field construction lives HERE (after the rotation) — see the v2.0.1 note above
  const field = new RoadField(samples);
  const groundAt = (x: number, z: number): number => groundHeight(x, z, field, theme, waterLevel, lavaLevel, safeSeed, undefined, maxR, inGap);
  const groundInfo = (x: number, z: number): { h: number; d: number } => {
    const q = field.query(x, z, maxR + 130);
    const h = groundHeight(x, z, field, theme, waterLevel, lavaLevel, safeSeed, q, maxR, inGap);
    return { h, d: q ? q.d : 999 };
  };

  const data: TrackData = {
    samples, length: approxLen, themeId, seed: safeSeed, laps: opts.laps ?? 3,
    itemBoxes: [], boostPads: [], hazards: [], startGrid: [],
    waterLevel, lavaLevel, groundAt, groundInfo, jumpRanges, bridgeRanges, tunnelRanges,
  };
  if (openInfo) {
    data.open = true; data.seam = openInfo.seam; data.startIdx = openInfo.startIdx; data.laps = 1;
  }

  // ---- item box rows (avoid gaps & tight corners) ----
  // USER SPEC (§13): EXACTLY 5 power-up boxes across the road per row — spread
  // wide so racers pick a line. MEGA MAPS v3: the row count scales with lap
  // length (a 4km lap needs far more than 5 rows to keep boxes relevant).
  const rows = Math.min(22, Math.max(5, Math.round((opts.itemRows ?? 5) * clamp(approxLen / 1100, 1, 2.6))));
  for (let r = 0; r < rows; r++) {
    const sIdx = openInfo
      // open track: boxes only between the start line and the finish line
      ? Math.min(N - 20, openInfo.startIdx + 40 + Math.floor(((r + 0.5) / rows) * (N - 60 - openInfo.startIdx - 40)))
      : Math.floor(((r + 0.5) / rows) * N + rng() * 16) % N;
    if (!samples[sIdx].hasRoad) continue;
    for (const ln of [-0.72, -0.36, 0, 0.36, 0.72]) data.itemBoxes.push({ sIdx, lane: ln });
  }
  // ---- boost pads on straights (low curvature) — more pads for the bigger laps
  const padCount = 5 + Math.floor(rng() * 3) + Math.floor(approxLen / 1400);
  let placed = 0, guard = 0;
  while (placed < padCount && guard++ < 200) {
    const sIdx = openInfo ? openInfo.startIdx + 30 + Math.floor(rng() * (N - 50 - openInfo.startIdx - 30)) : Math.floor(rng() * N);
    const s0 = samples[sIdx], s1 = samples[(sIdx + 6) % N];
    if (!s0.hasRoad || !s1.hasRoad) continue;
    if (s0.pos.distanceTo(s1.pos) < 5.6) continue; // straight enough
    data.boostPads.push({ sIdx, lane: (rng() - 0.5) * 0.9 });
    placed++;
  }
  // NOTE: track coins were REMOVED by design — payouts are now rank-based at the
  // finish (see race.ts emitResults). Nothing collectible is spawned on the road.
  // ---- start grid ----
  for (let i = 0; i < 6; i++) {
    const back = 8 + Math.floor(i / 2) * 5;
    const sIdx = openInfo
      ? openInfo.startIdx - Math.round(back / (approxLen / N))
      : (N - Math.round(back / (approxLen / N))) % N;
    const s = samples[sIdx];
    const laneOff = (i % 2 === 0 ? -0.42 : 0.42) * s.width;
    data.startGrid.push({
      pos: s.pos.clone().add(s.left.clone().multiplyScalar(laneOff)),
      heading: Math.atan2(s.tan.x, s.tan.z),
    });
  }
  return data;
}

// ================= RoadField (spatial hash) =================
class RoadField {
  cell = 12;
  bins = new Map<string, number[]>();
  samples: TrackSample[];
  constructor(samples: TrackSample[]) {
    this.samples = samples;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const k = this.key(s.pos.x, s.pos.z);
      const arr = this.bins.get(k);
      if (arr) arr.push(i); else this.bins.set(k, [i]);
    }
  }
  private key(x: number, z: number) { return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; }
  /** nearest road sample info around (x,z). returns null if farther than maxD.
   *  search radius grows with maxD so BIG islands still find their road. */
  query(x: number, z: number, maxD = 260): { d: number; y: number; w: number; idx: number } | null {
    const bx = Math.floor(x / this.cell), bz = Math.floor(z / this.cell);
    let best = 1e9, bi = -1;
    const rMax = Math.min(20, Math.ceil(maxD / this.cell) + 1);
    for (let r = 1; r <= rMax; r++) {
      for (let ix = bx - r; ix <= bx + r; ix++) for (let iz = bz - r; iz <= bz + r; iz++) {
        if (r > 1 && Math.abs(ix - bx) !== r && Math.abs(iz - bz) !== r) continue; // ring only
        const arr = this.bins.get(`${ix},${iz}`);
        if (!arr) continue;
        for (const i of arr) {
          const s = this.samples[i];
          const dx = s.pos.x - x, dz = s.pos.z - z;
          const d = dx * dx + dz * dz;
          if (d < best) { best = d; bi = i; }
        }
      }
      if (bi >= 0 && Math.sqrt(best) < r * this.cell * 0.85) break; // good enough
    }
    if (bi < 0 || Math.sqrt(best) > maxD) return null;
    return { d: Math.sqrt(best), y: this.samples[bi].pos.y, w: this.samples[bi].width, idx: bi };
  }
}

// ================= terrain height (THE fix for the flooded world) =================
function groundHeight(x: number, z: number, field: RoadField, themeId: string, waterLevel: number, lavaLevel: number, seed: number, qPre?: { d: number; y: number; w: number; idx: number } | null, maxR = 70, inGap?: (i: number) => boolean): number {
  const q = qPre !== undefined ? qPre : field.query(x, z, maxR + 130);
  const isSky = isAirTheme(themeId);
  const noise = Math.sin(x * 0.021 + seed * 0.7) * Math.cos(z * 0.018 - seed * 0.4) * 1.7
    + Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05 + 2.1) * 0.9;
  let h = 1.6 + noise;

  if (q) {
    const corridor = q.w / 2 + 2.2;
    const roadLvl = q.y - 0.24;
    // MEGA RAMP: a floating deck — nothing but air (and the sea far below)
    // outside the road corridor
    if (themeId === 'megaramp' && q.d >= corridor) return -9999;
    if (q.d < corridor) {
      // PIT under jump gaps: road-less sample + close to the road line → the
      // ground drops ~2.6m below the deck, so falling short of a jump lands
      // you in an obvious hole (the race detects it and respawn-rescues you).
      if (inGap && inGap(q.idx) && q.d < q.w / 2 + 2.5) {
        h = Math.min(h, roadLvl - 2.6);
      } else {
        h = roadLvl;
      }
    } else {
      // gentle shoulder first (never above road +2.2 within 24m), then rolling hills
      const shoulder = roadLvl + 0.7 + Math.sin(x * 0.09 + z * 0.07) * 0.5;
      const t1 = smoothstep(corridor, corridor + 22, q.d);
      h = roadLvl * (1 - t1) + Math.max(shoulder, roadLvl + 0.4) * t1;
      // rolling hills grow with distance beyond the shoulder
      const t2 = smoothstep(corridor + 18, corridor + 64, q.d);
      h += t2 * (2.2 + noise * 1.6);
      // rim mountains beyond the island edge (scales with track radius so the
      // map center of BIG rings never turns into a mountain)
      const rim = smoothstep(maxR + 10, maxR + 64, q.d);
      h += rim * (11 + Math.sin(x * 0.05) * Math.cos(z * 0.043) * 7 + Math.sin(x * 0.017 + z * 0.02) * 4);
    }
  } else if (isSky) {
    return -9999;
  } else {
    h += 11 + Math.sin(x * 0.05) * Math.cos(z * 0.043) * 7;
  }

  // ---- WATER / LAVA GUARANTEE: land inside island never below fluid ----
  // Radial (island-centered) test — the old road-distance test could not tell
  // INSIDE the ring from OUTSIDE, so karts that drove far off-road found
  // "invisible land" past the visible terrain mesh (walking on water).
  const radial = Math.hypot(x, z);
  if (waterLevel > -900) {
    if (radial < maxR - 6) {
      h = Math.max(h, waterLevel + 2.0);   // island interior: always land above beach band
    } else {
      // beyond the island edge: beach -> sea floor (radially, matches mesh extent)
      const sink = smoothstep(maxR + 8, maxR + 40, radial);
      h = h * (1 - sink) + (waterLevel - 2.6) * sink;
    }
  }
  if (themeId === 'volcano') {
    if (radial < maxR - 6) h = Math.max(h, lavaLevel + 1.6);
  }

  // ---- terracing (blocky steps), kept low near the road corridor ----
  const near = q ? q.d < q.w / 2 + 7 : false;
  if (!near && h > (waterLevel > -900 ? waterLevel + 0.6 : -3)) {
    const step = 0.85;
    const stepped = Math.round(h / step) * step;
    if (q) {
      const maxNear = q.y + 1.9;
      h = q.d < q.w / 2 + 26 ? Math.min(stepped, Math.max(maxNear, waterLevel > -900 ? waterLevel + 2.0 : -3)) : stepped;
    } else {
      h = stepped;
    }
  }
  return h;
}

// ================= world mesh =================
export interface TrackWorld {
  group: THREE.Group;
  data: TrackData;
  boxMeshes: THREE.Object3D[];
  padMeshes: THREE.Object3D[];
  coinMeshes: THREE.InstancedMesh[];
  hazardMeshes: THREE.Object3D[];
  disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[];
  sampleAt: (idx: number) => TrackSample;
  cloudGroup?: THREE.Group | null;
  minimapCache?: { pts: [number, number][] };
  /** world positions of street lamps (v1.9): the race pools REAL PointLights
   *  onto the ones nearest the player for proper night-city lighting */
  lampPositions: THREE.Vector3[];
}

function q(v: number, g: number) { return Math.round(v / g) * g; }

export function buildTrackWorld(data: TrackData, theme: ThemeDef, quality: 'low' | 'medium' | 'high' | 'ultra'): TrackWorld {
  const group = new THREE.Group();
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  const S = data.samples;
  const N = S.length;
  const rng = makeRng(data.seed ^ 0x9e3779b9);
  const decoDensity = quality === 'low' ? 0.5 : quality === 'medium' ? 0.75 : quality === 'ultra' ? 1.3 : 1;
  const isSky = theme.id === 'sky';
  const isMega = theme.id === 'megaramp';
  const SEA_Y = theme.water ? theme.water.level - 0.3 : -16;

  // ===== ROAD MESH (quantized blocky ribbon + curbs + dashes, textured asphalt) =====
  // ROAD-PRECISION PASS (user bug: "میرم داخل جاده" — the car sank into the
  // road): the mesh used to bridge EVERY 2nd sample, so on any elevation
  // change the visual surface cut a chord across the physics spline and the
  // kart clipped into/above the asphalt. Now the ribbon hugs EVERY sample
  // (step=1) and edge quantization is halved (0.5m → 0.25m) so visual and
  // physics surfaces agree to a couple of centimetres everywhere.
  const roadGeos: THREE.BufferGeometry[] = [];
  const step = 1;
  const sampleLen = data.length / N || 1;
  let curbFlip = 0;
  for (let i = 0; i < N; i += step) {
    const s0 = S[i], s1 = S[(i + step) % N];
    if (!s0.hasRoad || !s1.hasRoad) continue;
    if (!segOk(data, i)) continue;   // v2.0 open track: never bridge the dead end
    const w0 = s0.width / 2, w1 = s1.width / 2;
    const e0L = new THREE.Vector3(q(s0.pos.x + s0.left.x * w0, 0.25), s0.pos.y, q(s0.pos.z + s0.left.z * w0, 0.25));
    const e0R = new THREE.Vector3(q(s0.pos.x - s0.left.x * w0, 0.25), s0.pos.y, q(s0.pos.z - s0.left.z * w0, 0.25));
    const e1L = new THREE.Vector3(q(s1.pos.x + s1.left.x * w1, 0.25), s1.pos.y, q(s1.pos.z + s1.left.z * w1, 0.25));
    const e1R = new THREE.Vector3(q(s1.pos.x - s1.left.x * w1, 0.25), s1.pos.y, q(s1.pos.z - s1.left.z * w1, 0.25));
    const base = new THREE.Color(theme.road.base);
    base.multiplyScalar(1 + Math.sin(i * 0.7) * 0.035);
    roadGeos.push(quad(e0L, e0R, e1R, e1L, base, 0.08, i * sampleLen / 4, (i + step) * sampleLen / 4));
    // center dashes
    if (i % (step * 7) < step) {
      const d0a = s0.pos.clone().addScaledVector(s0.left, 0.2);
      const d0b = s0.pos.clone().addScaledVector(s0.left, -0.2);
      const d1a = s1.pos.clone().addScaledVector(s1.left, 0.2);
      const d1b = s1.pos.clone().addScaledVector(s1.left, -0.2);
      roadGeos.push(quad(d0a, d0b, d1b, d1a, new THREE.Color(theme.road.line), 0.1));
    }
    // edge curbs
    curbFlip = (curbFlip + 1) % 8;
    const curbC = new THREE.Color(curbFlip < 4 ? theme.road.curbA : theme.road.curbB);
    for (const sgn of [1, -1]) {
      const c0a = s0.pos.clone().addScaledVector(s0.left, sgn * (w0 + 0.6));
      const c0b = s0.pos.clone().addScaledVector(s0.left, sgn * (w0 + 0.04));
      const c1a = s1.pos.clone().addScaledVector(s1.left, sgn * (w1 + 0.6));
      const c1b = s1.pos.clone().addScaledVector(s1.left, sgn * (w1 + 0.04));
      roadGeos.push(quad(sgn > 0 ? c0a : c0b, sgn > 0 ? c0b : c0a, sgn > 0 ? c1b : c1a, sgn > 0 ? c1a : c1b, curbC, 0.14));
    }
  }
  const roadTex = roadTexture();
  roadTex.repeat.set(1, 1);
  // v3.9: shared singleton — NOT disposed per race any more (it was re-uploaded
  // + mip-mapped to the GPU at every race start = a hitch on the 2K pack)
  const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: roadTex });
  // v3.8: HD asphalt relief (normal map) from MEDIUM up — cheap, big visual win
  const roadN = quality !== 'low' ? roadNormalTexture() : null;
  if (roadN) { roadMat.normalMap = roadN; roadMat.normalScale.set(0.9, 0.9); }
  disposables.push(roadMat);
  if (roadGeos.length) {
    const roadGeo = mergeGeometries(roadGeos, false)!;
    roadGeos.forEach(g => g.dispose());
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    group.add(roadMesh);
    disposables.push(roadGeo);
  }

  // start line: checkered band (open tracks: this is the FINISH line; the
  // START band is painted separately at data.startIdx below)
  for (const bandIdx of data.open && data.startIdx !== undefined ? [2, data.startIdx] : [4]) {
    const s = S[bandIdx];
    const geos: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 2; k++) {
      for (let c = 0; c < 10; c++) {
        const t0 = c / 10 - 0.5, t1 = (c + 1) / 10 - 0.5;
        const a0 = s.pos.clone().addScaledVector(s.left, t0 * s.width).addScaledVector(s.tan, k * 1.4);
        const a1 = s.pos.clone().addScaledVector(s.left, t1 * s.width).addScaledVector(s.tan, k * 1.4);
        const b0 = s.pos.clone().addScaledVector(s.left, t0 * s.width).addScaledVector(s.tan, k * 1.4 + 1.4);
        const b1 = s.pos.clone().addScaledVector(s.left, t1 * s.width).addScaledVector(s.tan, k * 1.4 + 1.4);
        const col = (c + k) % 2 === 0 ? 0xf2f2f2 : 0x1c1c1c;
        geos.push(quad(a0, a1, b1, b0, new THREE.Color(col), 0.12));
      }
    }
    const g = mergeGeometries(geos, false)!;
    geos.forEach(x => x.dispose());
    disposables.push(g);
    group.add(new THREE.Mesh(g, roadMat));
  }

  // ===== BRIDGE / ELEVATED RAILS + PILLARS =====
  const railGeos: THREE.BufferGeometry[] = [];
  const pillarGeos: THREE.BufferGeometry[] = [];
  {
    const railC = new THREE.Color(theme.road.curbA).lerp(new THREE.Color('#dfe4ea'), 0.35);
    const pillarC = new THREE.Color('#7a7f88');
    const inBridge = (i: number) => data.bridgeRanges.some(([a, b2]) => i >= a && i <= b2);
    for (let i = 0; i < N; i++) {
      const s = S[i];
      if (!s.hasRoad) continue;
      const elevated = inBridge(i) || (s.pos.y - data.groundAt(s.pos.x, s.pos.z) > 1.8);
      if (!elevated) continue;
      const w = s.width / 2 + 1.05;   // v1.11: aligned with the new edge barriers
      for (const sgn of [1, -1]) {
        const p = s.pos.clone().addScaledVector(s.left, sgn * w);
        // rail post
        railGeos.push(quad(p.clone().addScaledVector(s.left, -0.18 * sgn), p.clone().addScaledVector(s.left, 0.18 * sgn),
          p.clone().addScaledVector(s.left, 0.18 * sgn).add(new THREE.Vector3(0, 0.95, 0)),
          p.clone().addScaledVector(s.left, -0.18 * sgn).add(new THREE.Vector3(0, 0.95, 0)), railC, 0));
        // top rail bar
        railGeos.push(quad(p.clone().addScaledVector(s.left, -0.14 * sgn).add(new THREE.Vector3(0, 0.95, 0)),
          p.clone().addScaledVector(s.left, 0.14 * sgn).add(new THREE.Vector3(0, 0.95, 0)),
          p.clone().addScaledVector(s.left, 0.14 * sgn).add(new THREE.Vector3(0, 1.15, 0)),
          p.clone().addScaledVector(s.left, -0.14 * sgn).add(new THREE.Vector3(0, 1.15, 0)), railC, 0));
      }
      // support pillar every 10 samples
      if (i % 10 === 0) {
        let g0 = data.groundAt(s.pos.x, s.pos.z);
        if (g0 < -9000) g0 = SEA_Y;          // air decks: pillars reach down to the sea / cloud layer
        const h = s.pos.y - g0;
        if (h > 1.6) {
          const c0 = s.pos.clone().addScaledVector(s.left, -1.1).setY(g0 - 0.4);
          const c1 = s.pos.clone().addScaledVector(s.left, 1.1).setY(g0 - 0.4);
          const t0 = s.pos.clone().addScaledVector(s.left, -1.1).setY(s.pos.y - 0.3);
          const t1 = s.pos.clone().addScaledVector(s.left, 1.1).setY(s.pos.y - 0.3);
          pillarGeos.push(quad(c0, c1, t1, t0, pillarC, 0));
        }
      }
    }
  }
  if (railGeos.length) {
    const g = mergeGeometries(railGeos, false)!;
    railGeos.forEach(x => x.dispose());
    const m = new THREE.Mesh(g, makeDetailedVoxelMaterial(0.42));
    m.castShadow = true;
    group.add(m);
    disposables.push(g);
  }
  if (pillarGeos.length) {
    const g = mergeGeometries(pillarGeos, false)!;
    pillarGeos.forEach(x => x.dispose());
    const m = new THREE.Mesh(g, makeDetailedVoxelMaterial(0.42));
    group.add(m);
    disposables.push(g);
  }

  // ===== TUNNEL ARCHES =====
  {
    const inTunnel = (i: number) => data.tunnelRanges.some(([a, b2]) => i >= a && i <= b2);
    const stoneMat = makeDetailedVoxelMaterial(0.5);
    const stone = new THREE.Color('#565d6b');
    const stoneD = new THREE.Color('#424855');
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xffd54f });
    const lampGeos: THREE.BufferGeometry[] = [];
    const archGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < N; i += 2) {
      const s = S[i];
      if (!s.hasRoad || !inTunnel(i)) continue;
      const w = s.width / 2 + 1.2;
      const h = 3.4;
      for (const sgn of [1, -1]) {
        const p = s.pos.clone().addScaledVector(s.left, sgn * w);
        // wall slab
        archGeos.push(quad(p.clone().addScaledVector(s.left, 0.5 * sgn), p.clone().addScaledVector(s.left, -0.5 * sgn),
          p.clone().addScaledVector(s.left, -0.5 * sgn).add(new THREE.Vector3(0, h, 0)),
          p.clone().addScaledVector(s.left, 0.5 * sgn).add(new THREE.Vector3(0, h, 0)), i % 4 < 2 ? stone : stoneD, 0));
      }
      // roof slab
      const l0 = s.pos.clone().addScaledVector(s.left, w).add(new THREE.Vector3(0, h, 0));
      const r0 = s.pos.clone().addScaledVector(s.left, -w).add(new THREE.Vector3(0, h, 0));
      const l1 = l0.clone().addScaledVector(s.tan, 2.4);
      const r1 = r0.clone().addScaledVector(s.tan, 2.4);
      archGeos.push(quad(l0, r0, r1, l1, stoneD, 0));
      // lamp every 12 samples
      if (i % 12 === 0) {
        const lp = s.pos.clone().add(new THREE.Vector3(0, h - 0.3, 0));
        lampGeos.push(quad(lp.clone().addScaledVector(s.left, -0.25), lp.clone().addScaledVector(s.left, 0.25),
          lp.clone().addScaledVector(s.left, 0.25).add(new THREE.Vector3(0, 0.35, 0)),
          lp.clone().addScaledVector(s.left, -0.25).add(new THREE.Vector3(0, 0.35, 0)), new THREE.Color(0xffd54f), 0));
      }
    }
    if (archGeos.length) {
      const g = mergeGeometries(archGeos, false)!;
      archGeos.forEach(x => x.dispose());
      const m = new THREE.Mesh(g, stoneMat);
      group.add(m);
      disposables.push(g, stoneMat);
    }
    if (lampGeos.length) {
      const g = mergeGeometries(lampGeos, false)!;
      lampGeos.forEach(x => x.dispose());
      const m = new THREE.Mesh(g, lampMat);
      group.add(m);
      disposables.push(g, lampMat);
    }
  }

  // ===== EDGE BARRIERS (user v1.11: "برای کل مپ‌ها کنار جاده‌ها مانع بزار و
  // نزار کاربر از جاده خارج بشه"): a continuous low wall runs along BOTH road
  // edges of EVERY map — the kart physically cannot leave the road anymore,
  // which also kills the whole family of "car sinks into the ground off-road"
  // bugs. NIGHT BONUS (user: "چراغ ها و نورپردازی خفن + حس مسابقه خیابونی"):
  // on night themes the wall's top cap is a self-lit NEON strip (per-theme
  // colors) — a glowing racing line wrapping the whole city.
  {
    const inTunnel = (i: number) => data.tunnelRanges.some(([a, b2]) => i >= a && i <= b2);
    const bodyGeos: THREE.BufferGeometry[] = [];
    const capGeos: THREE.BufferGeometry[] = [];
    const night = !!theme.night;
    const neonCols = (theme.neon && theme.neon.length ? theme.neon : [theme.road.curbA, theme.road.curbB]).map(c => new THREE.Color(c));
    const dayBody = new THREE.Color(theme.road.edge).lerp(new THREE.Color('#c8ccd4'), 0.42);
    const dayCapA = new THREE.Color('#f2f2f2');
    const lat = 1.1;                 // barrier line: wall face ≈ kart edge at clamp
    const H = 0.82;                  // wall height above the road deck
    for (let i = 0; i < N; i += 2) {
      const s0 = S[i], s1 = S[(i + 2) % N];
      if (!s0.hasRoad || !s1.hasRoad) continue;
      if (!segOk(data, i) || !segOk(data, i + 1)) continue;   // open track dead end
      if (inTunnel(i)) continue;     // tunnel walls already box the road in
      for (const sgn of [1, -1]) {
        const b0 = s0.pos.clone().addScaledVector(s0.left, sgn * (s0.width / 2 + lat));
        const b1 = s1.pos.clone().addScaledVector(s1.left, sgn * (s1.width / 2 + lat));
        // outer face (visible when looking from the road)
        bodyGeos.push(quad(
          b0.clone().add(new THREE.Vector3(0, H, 0)),
          b1.clone().add(new THREE.Vector3(0, H, 0)),
          b1.clone().add(new THREE.Vector3(0, -0.55, 0)),   // buried base: no gap over crests
          b0.clone().add(new THREE.Vector3(0, -0.55, 0)),
          dayBody, 0));
        // top cap — day: alternating red/white kerb blocks; night: NEON glow
        let capC: THREE.Color;
        if (night) capC = neonCols[(Math.floor(i / 6) + (sgn > 0 ? 0 : 1)) % neonCols.length];
        else capC = (Math.floor(i / 8) % 2 === 0) ? dayCapA : new THREE.Color(theme.road.curbA);
        capGeos.push(quad(
          b0.clone().addScaledVector(s0.left, -sgn * 0.22).add(new THREE.Vector3(0, H + 0.1, 0)),
          b1.clone().addScaledVector(s1.left, -sgn * 0.22).add(new THREE.Vector3(0, H + 0.1, 0)),
          b1.clone().add(new THREE.Vector3(0, H + 0.1, 0)),
          b0.clone().add(new THREE.Vector3(0, H + 0.1, 0)),
          capC, 0));
      }
    }
    if (bodyGeos.length) {
      const g = mergeGeometries(bodyGeos, false)!;
      bodyGeos.forEach(x => x.dispose());
      const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.castShadow = true;
      group.add(mesh);
      disposables.push(g, m);
    }
    if (capGeos.length) {
      const g = mergeGeometries(capGeos, false)!;
      capGeos.forEach(x => x.dispose());
      // night: MeshBasicMaterial = self-lit neon that ignores the darkness
      const m = night
        ? new THREE.MeshBasicMaterial({ vertexColors: true })
        : new THREE.MeshLambertMaterial({ vertexColors: true });
      group.add(new THREE.Mesh(g, m));
      disposables.push(g, m);
    }
  }

  // ===== TERRAIN (world-space detail texture + block seams) =====
  const terrain = isMega ? { geometry: null as THREE.BufferGeometry | null } : buildTerrain(data, theme, decoDensity);
  if (terrain.geometry) {
    const tMat = makeDetailedVoxelMaterial(0.55);
    (tMat as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
    disposables.push(tMat);
    const mesh = new THREE.Mesh(terrain.geometry, tMat);
    mesh.receiveShadow = true;
    group.add(mesh);
    disposables.push(terrain.geometry);
  }

  // ===== WATER / LAVA (sea at rim only; terrain guarantees land above) =====
  if (theme.water) {
    const geo = new THREE.PlaneGeometry(1500, 1500, 40, 40);
    geo.rotateX(-Math.PI / 2);
    const mat = makeWaterMaterial(theme.water.deep, theme.water.shallow);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = theme.water.level;
    group.add(m);
    disposables.push(geo, mat);
  }
  if (theme.lava) {
    const geo = new THREE.PlaneGeometry(1400, 1400, 32, 32);
    geo.rotateX(-Math.PI / 2);
    const mat = makeLavaMaterial();
    const m = new THREE.Mesh(geo, mat);
    m.position.y = theme.lava.level;
    group.add(m);
    disposables.push(geo, mat);
  }
  if (isSky) {
    // cloud sea far below
    const geo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', transparent: true, opacity: 0.85 });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = -16;
    group.add(m);
    disposables.push(geo, mat);
  }

  // ===== DECORATIONS (on-land, instanced) + landmarks =====
  const decoPlacements = placeDecorations(data, theme, rng, decoDensity);
  // ROADSIDE PROPS PASS (user v1.8: "داخل مپ‌ها چیزهای مختلف گذاشته باشی،
  // تنوع بالا داشته باشه"): flags, tire stacks, billboards, lamps, crates and
  // barrels line the track at regular intervals — every map gains roadside
  // furniture that also doubles as corner-reference markers.
  // v1.9: crash-city props (wrecked cars, barriers, cones) on the new map +
  // lamp position collection for the night lighting pool.
  const lampPositions: THREE.Vector3[] = [];
  {
    const night = theme.night || !!theme.night;
    const pool: string[] = ['flagpole', 'tireStack', 'crate', 'barrel', 'billboard'];
    if (night || theme.id === 'city' || theme.id === 'crashcity') pool.push('streetlamp', 'streetlamp');
    if (theme.id === 'grass' || theme.id === 'jungle') pool.push('crate');
    // CRASH CITY (new map): a demolition playground — wrecks, barriers, cones
    if (theme.id === 'crashcity') pool.push('wreckCar', 'barrier', 'cone', 'tireStack');
    // v3.3 premium maps: themed roadside furniture replaces the generic mix
    if (theme.id === 'candy') pool.splice(0, pool.length, 'candyCane', 'gumdrop', 'lollipop', 'candyCane', 'gumdrop');
    if (theme.id === 'galaxy') pool.splice(0, pool.length, 'starPillar', 'starPillar', 'planetRock', 'streetlamp');
    if (theme.id === 'dragon') pool.splice(0, pool.length, 'goldLantern', 'goldLantern', 'flagpole', 'barrel');
    if (theme.id === 'royal') pool.splice(0, pool.length, 'goldLantern', 'crownStatue', 'streetlamp', 'streetlamp', 'billboard');
    const roadProps: Record<string, { x: number; y: number; z: number; ry: number; s: number }[]> = {};
    const stride = Math.max(14, Math.round(24 / Math.max(0.5, decoDensity)));
    for (let i = 30; i < N - 12; i += stride) {
      const s = S[i];
      if (!s.hasRoad) continue;                       // never inside jump gaps
      if (Math.abs(s.pos.y - data.groundAt(s.pos.x, s.pos.z)) > 1.6) continue; // skip bridges
      const side = (Math.floor(i / stride) % 2 === 0) ? 1 : -1;
      const type = pool[Math.floor(rng() * pool.length)];
      const off = s.width / 2 + 2.6 + rng() * 1.8;    // just past the curbs
      const p = s.pos.clone().addScaledVector(s.left, side * off);
      const y = data.groundAt(p.x, p.z);
      if (y < -9000 || (theme.water && y < theme.water.level + 0.6) || (theme.lava && y < theme.lava.level + 0.6)) continue;
      (roadProps[type] ??= []).push({ x: p.x, y, z: p.z, ry: Math.atan2(s.tan.x, s.tan.z) + (rng() - 0.5) * 0.7, s: 0.9 + rng() * 0.5 });
    }
    for (const [type, spots] of Object.entries(roadProps)) decoPlacements[type] = (decoPlacements[type] ?? []).concat(spots);
    // LAMP POSITIONS (for the race's night lighting pool): theme lamp decos +
    // every roadside streetlamp
    for (const sp of decoPlacements['lamp'] ?? []) lampPositions.push(new THREE.Vector3(sp.x, sp.y, sp.z));
    for (const sp of decoPlacements['streetlamp'] ?? []) lampPositions.push(new THREE.Vector3(sp.x, sp.y, sp.z));
  }
  for (const [type, spots] of Object.entries(decoPlacements)) {
    const geo = getDecoGeo(type).geometry;
    if (!geo || !geo.attributes.position || geo.attributes.position.count === 0) continue;
    const inst = new THREE.InstancedMesh(geo, decoMaterial, Math.max(1, spots.length));
    const d = new THREE.Object3D();
    spots.forEach((sp, i) => {
      d.position.set(sp.x, sp.y, sp.z);
      d.rotation.y = sp.ry;
      d.scale.setScalar(sp.s);
      d.updateMatrix();
      inst.setMatrixAt(i, d.matrix);
    });
    inst.count = spots.length;
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = quality !== 'low';
    inst.frustumCulled = false;
    group.add(inst);
    disposables.push(inst.geometry as unknown as THREE.BufferGeometry);
  }

  // landmark(s) at map center
  for (const lm of landmarkFor(theme.id)) {
    const geo = getDecoGeo(lm.type).geometry;
    if (!geo || !geo.attributes.position || !geo.attributes.position.count) continue;
    const cx2 = lm.x, cz2 = lm.z;
    const inst = new THREE.InstancedMesh(geo, decoMaterial, 1);
    const d = new THREE.Object3D();
    d.position.set(cx2, data.groundAt(cx2, cz2) - 0.1, cz2);
    d.rotation.y = lm.ry;
    d.scale.setScalar(lm.s);
    d.updateMatrix();
    inst.setMatrixAt(0, d.matrix);
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    group.add(inst);
  }

  // ===== START GATE =====
  if (data.open && data.startIdx !== undefined) {
    // point-to-point: a START gate over the grid + a FINISH gate at the end
    group.add(buildStartGate(S[data.startIdx], theme, disposables, 'START'));
    group.add(buildStartGate(S[3], theme, disposables, 'FINISH'));
    group.add(buildMegaDressing(data, theme, disposables, SEA_Y));
  } else {
    group.add(buildStartGate(S[4], theme, disposables));
    // grandstand near start
    group.add(buildGrandstand(S[14], theme, data.groundAt, disposables));
  }

  // ===== ITEM BOXES / PADS (coins removed — rank-based rewards) =====
  // REALISTIC ITEM BOX v3 (user: "باکس‌ها واقعی‌تر بشن، شیدر و تکسچر داشته باشن"):
  // a physical prize box built from 3 parts —
  //   1. GLASS SHELL  textured shader (metal frame + glass pane + rivets,
  //      env reflection + sun glint), own material for the ghost lifecycle
  //   2. METAL EDGE FRAME  12 beveled beams merged into one mesh (per-box
  //      material so it can fade during the ghost phase)
  //   3. INNER "?" BILLBOARD  additive sprite that always faces the camera
  // Each box gets its OWN materials so it can animate the
  // break → ghost → respawn lifecycle independently.
  const boxGeo = new THREE.BoxGeometry(1.02, 1.02, 1.02);
  // frame: 12 edge beams (x/y/z aligned boxes) merged into ONE geometry
  const frameParts: THREE.BufferGeometry[] = [];
  const E = 1.02, T = 0.13, H = E / 2;
  for (const a of [-H, H]) {
    for (const b of [-H, H]) {
      const gx = new THREE.BoxGeometry(E + T, T, T); gx.translate(0, a, b); frameParts.push(gx);
      const gy = new THREE.BoxGeometry(T, E + T, T); gy.translate(a, 0, b); frameParts.push(gy);
      const gz = new THREE.BoxGeometry(T, T, E + T); gz.translate(a, b, 0); frameParts.push(gz);
    }
  }
  const frameGeo = mergeGeometries(frameParts, false) ?? frameParts[0];
  for (const f of frameParts) if (f !== frameGeo) f.dispose();
  const qGeo = new THREE.PlaneGeometry(0.74, 0.74);
  disposables.push(boxGeo, frameGeo, qGeo);
  const boxMeshes: THREE.Object3D[] = [];
  for (const ib of data.itemBoxes) {
    const s = S[ib.sIdx % N];
    const p = s.pos.clone().addScaledVector(s.left, ib.lane * s.width * 0.5);
    const boxGroup = new THREE.Group();
    const glass = new THREE.Mesh(boxGeo, makeItemBoxMaterial());
    const frameMat = makeItemBoxFrameMaterial();
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.castShadow = true;
    const qMat = makeQuestionBillboardMaterial();
    const qBill = new THREE.Mesh(qGeo, qMat);
    qBill.renderOrder = 2;
    boxGroup.add(glass, frame, qBill);
    boxGroup.position.copy(p).setY(p.y + 1.1);
    boxGroup.userData.spot = ib;
    boxGroup.userData.phase = 'active';   // active | breaking | ghost | spawning
    boxGroup.userData.t = 0;
    boxGroup.userData.glass = glass;      // race.ts drives uGhost via this
    boxGroup.userData.frame = frame;
    boxGroup.userData.qBill = qBill;
    disposables.push(glass.material as THREE.Material, frameMat, qMat);
    group.add(boxGroup);
    boxMeshes.push(boxGroup);
  }

  // ---- BOOST PADS v2 (user: "اون چیز آبی که سرعت میده رو بازسازی کن — پر
  // گرافیک‌تر و پرجزئیات‌تر"): dark slab + 3 animated chevron arrows (light
  // sweep toward travel) + glowing side rails. All pads share materials so
  // the sweep animates everywhere in sync at zero per-pad cost. ----
  const padMeshes: THREE.Object3D[] = [];
  const padBaseGeo = new THREE.BoxGeometry(3.2, 0.06, 4.4);
  const padBaseMat = new THREE.MeshLambertMaterial({ color: 0x0c2830, emissive: 0x06272e });
  const chevShape = new THREE.Shape();
  chevShape.moveTo(-1.05, 0.55); chevShape.lineTo(0, -0.2); chevShape.lineTo(1.05, 0.55);
  chevShape.lineTo(1.05, 0.02); chevShape.lineTo(0, -0.72); chevShape.lineTo(-1.05, 0.02);
  chevShape.closePath();
  const chevGeo = new THREE.ExtrudeGeometry(chevShape, { depth: 0.05, bevelEnabled: false });
  chevGeo.rotateX(-Math.PI / 2);   // lies flat; arrow tip points toward +Z (travel dir)
  const chevMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({
    color: 0x35e6ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const railGeo = new THREE.BoxGeometry(0.16, 0.1, 4.4);
  const railMat = new THREE.MeshBasicMaterial({ color: 0x1899b8, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false });
  disposables.push(padBaseGeo, padBaseMat, chevGeo, railGeo, ...chevMats, railMat);
  for (const bp of data.boostPads) {
    const s = S[bp.sIdx % N];
    const p = s.pos.clone().addScaledVector(s.left, bp.lane * s.width * 0.5);
    const g = new THREE.Group();
    const base = new THREE.Mesh(padBaseGeo, padBaseMat);
    base.position.y = 0.03;
    g.add(base);
    const chevs: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const ch = new THREE.Mesh(chevGeo, chevMats[i]);
      ch.position.set(0, 0.09, -1.3 + i * 1.2);
      g.add(ch);
      chevs.push(ch);
    }
    for (const sx of [-1, 1]) {
      const rail = new THREE.Mesh(railGeo, railMat);
      rail.position.set(sx * 1.62, 0.07, 0);
      g.add(rail);
    }
    g.position.copy(p).setY(p.y + 0.1);
    g.rotation.y = Math.atan2(s.tan.x, s.tan.z);
    g.userData.chevrons = chevs;
    group.add(g);
    padMeshes.push(g);
  }

  // ===== HAZARD MESHES =====
  const hazardMeshes: THREE.Object3D[] = [];
  for (const hz of data.hazards) {
    const s = S[hz.sIdx % N];
    let m: THREE.Object3D;
    if (hz.type === 'boulder' || hz.type === 'snowball') {
      const g = new THREE.Group();
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(hz.type === 'snowball' ? 1.5 : 1.2, 0), new THREE.MeshLambertMaterial({ color: hz.type === 'snowball' ? 0xffffff : 0x8a8f96, flatShading: true }));
      rock.castShadow = true;
      g.add(rock);
      m = g;
    } else if (hz.type === 'saw') {
      const g = new THREE.Group();
      const blade = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.18, 12), new THREE.MeshPhongMaterial({ color: 0xff4444, emissive: 0x661111 }));
      blade.rotation.x = Math.PI / 2;
      g.add(blade);
      m = g;
    } else if (hz.type === 'geyser') {
      const g = new THREE.Group();
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, 5, 8), new THREE.MeshLambertMaterial({ color: theme.lava ? 0xff6d00 : 0xd9b877, emissive: theme.lava ? 0xa83a00 : 0x000000, transparent: true, opacity: 0.85 }));
      col.position.y = 2.5;
      g.add(col);
      g.userData.col = col;
      m = g;
    } else {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 1.2), new THREE.MeshLambertMaterial({ color: 0xd8e8f8, transparent: true, opacity: 0.6, emissive: 0x334455 }));
      body.position.y = 1;
      g.add(body);
      m = g;
    }
    hz.y = s.pos.y;
    m.position.copy(s.pos);
    m.userData.hazard = hz;
    group.add(m);
    hazardMeshes.push(m);
  }

  // ===== DRIFTING CLOUD LAYER (outdoor themes) =====
  let cloudGroup: THREE.Group | null = null;
  if ((!isSky || isMega) && theme.id !== 'cave' && !theme.night) {
    cloudGroup = new THREE.Group();
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
    disposables.push(cloudMat);
    // spread scales with the track's own radius (big islands → wide sky)
    let skyR = 0;
    for (const s of S) skyR = Math.max(skyR, Math.hypot(s.pos.x, s.pos.z));
    for (let i = 0; i < (isMega ? 26 : 12); i++) {
      const cloud = new THREE.Group();
      const puffs = 3 + Math.floor(rng() * 3);
      for (let p = 0; p < puffs; p++) {
        const g = new THREE.BoxGeometry(6 + rng() * 10, 1.8 + rng() * 2.2, 4 + rng() * 7);
        disposables.push(g);
        const m = new THREE.Mesh(g, cloudMat);
        m.position.set((rng() - 0.5) * 9, (rng() - 0.5) * 1.4, (rng() - 0.5) * 6);
        cloud.add(m);
      }
      const spread = Math.max(240, skyR * 1.5);
      // mega ramp: clouds drift both ABOVE and BELOW the floating deck
      const cy = isMega ? (i % 3 === 0 ? 6 + rng() * 8 : 95 + rng() * 30) : 38 + rng() * 18;
      if (isMega) cloud.scale.setScalar(2.2 + rng() * 1.6);
      cloud.position.set((rng() - 0.5) * 2 * spread, cy, (rng() - 0.5) * 2 * spread);
      cloudGroup.add(cloud);
    }
    group.add(cloudGroup);
  }

  return {
    group, data, boxMeshes, padMeshes, coinMeshes: [], hazardMeshes, disposables,
    sampleAt: (idx: number) => S[((idx % N) + N) % N],
    cloudGroup,
    lampPositions,
  };
}

function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color, y: number, vA = 0, vB = 1): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const arr = new Float32Array([
    a.x, a.y + y, a.z, b.x, b.y + y, b.z, c.x, c.y + y, c.z,
    a.x, a.y + y, a.z, c.x, c.y + y, c.z, d.x, d.y + y, d.z,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const nrm = new THREE.Vector3(0, 1, 0);
  const n = new Float32Array(18);
  for (let i = 0; i < 6; i++) { n[i * 3] = nrm.x; n[i * 3 + 1] = nrm.y; n[i * 3 + 2] = nrm.z; }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  const cols = new Float32Array(18);
  for (let i = 0; i < 6; i++) { cols[i * 3] = color.r; cols[i * 3 + 1] = color.g; cols[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  // uv: u across the quad (a=0,b=1,c=1,d=0), v along (vA→vB) — used by the road texture
  const uvs = new Float32Array([0, vA, 1, vA, 1, vB, 0, vA, 1, vB, 0, vB]);
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return g;
}

// ================= terrain mesh =================
function buildTerrain(data: TrackData, theme: ThemeDef, _density: number): { geometry: THREE.BufferGeometry | null } {
  const S = data.samples;
  const N = S.length;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const s of S) {
    minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
    minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
  }
  const isSky = theme.id === 'sky';
  const margin = isSky ? 20 : 62;
  minX -= margin; maxX += margin; minZ -= margin; maxZ += margin;
  // MEGA MAPS v3: the grid CELL grows with the island so even a ~4km megacity
  // stays under the cell budget — terrain density on screen barely changes,
  // and the cap is raised to match (the old 90k cap would return NULL terrain
  // on the new 2x layouts).
  const span = Math.max(maxX - minX, maxZ - minZ);
  const cell = Math.max(2.3, span / 420);
  const nx = Math.floor((maxX - minX) / cell), nz = Math.floor((maxZ - minZ) / cell);
  if (nx * nz > 190000) return { geometry: null };

  const posArr: number[] = []; const colArr: number[] = []; const nrmArr: number[] = [];
  const base = new THREE.Color(theme.ground.base);
  const alt = new THREE.Color(theme.ground.alt);
  const acc = new THREE.Color(theme.ground.accent);
  const dirt = new THREE.Color(theme.road.edge).multiplyScalar(0.9);
  const rock = new THREE.Color(theme.mountains);
  const snow = new THREE.Color(theme.mountainSnow ?? theme.mountains);
  const sand = new THREE.Color('#d9c08a');
  const wallC = new THREE.Color(theme.ground.accent).lerp(new THREE.Color(theme.road.edge), 0.55);
  const wl = theme.water ? theme.water.level : (theme.lava ? theme.lava.level : -999);
  const hasFluid = theme.water || theme.lava;
  const roadW0 = (S[0]?.width ?? 11) / 2;

  // pass 1: height grid + road distance (one combined query per cell)
  const hg = new Float32Array(nx * nz);
  const qd = new Float32Array(nx * nz);
  const cg: THREE.Color[] = new Array(nx * nz);
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const x = minX + ix * cell, z = minZ + iz * cell;
      const cx = x + cell / 2, cz = z + cell / 2;
      const gi = data.groundInfo(cx, cz);
      const h = gi.h;
      hg[ix * nz + iz] = h;
      if (h < -9000) { qd[ix * nz + iz] = 999; continue; }
      const qv = gi.d;
      qd[ix * nz + iz] = qv;
      // color zoning
      const n = Math.sin(cx * 0.13) * Math.cos(cz * 0.11) + Math.sin(cx * 0.031 + cz * 0.027) * 0.7;
      const c = base.clone().lerp(alt, clamp(n * 0.5 + 0.5, 0, 1));
      if (n > 0.82) c.lerp(acc, 0.5);
      // dirt shoulder: thin band at road edge only
      const dirtOuter = roadW0 + 3.2;
      if (qv < dirtOuter) c.lerp(dirt, clamp(1 - (qv - roadW0) / 3.2, 0, 1) * 0.75);
      // rock on rim mountains / steep height
      if (h > 7.5) c.lerp(rock, clamp((h - 7.5) / 8, 0, 0.85));
      if (h > 14) c.lerp(snow, clamp((h - 14) / 7, 0, 0.9));
      // beach sand near fluid level
      if (hasFluid && h < wl + 1.0) c.lerp(sand, clamp(1 - (h - wl) / 1.0, 0, 1) * 0.9);
      cg[ix * nz + iz] = c;
    }
  }

  // pass 2: emit top quads + cliff side walls between differing heights
  const pushWallQuad = (verts: number[], nrm: [number, number, number], c: THREE.Color) => {
    for (let i = 0; i < 6; i++) {
      posArr.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
      colArr.push(c.r * 0.82, c.g * 0.82, c.b * 0.82);
      nrmArr.push(nrm[0], nrm[1], nrm[2]);
    }
  };
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const h = hg[ix * nz + iz];
      if (h < -9000) continue;
      const c = cg[ix * nz + iz] ?? base;
      const x = minX + ix * cell, z = minZ + iz * cell;
      pushQuad(posArr, colArr, nrmArr,
        x, h, z, x + cell, h, z, x + cell, h, z + cell, x, h, z + cell, c);
      const x2 = x + cell, z2 = z + cell;
      // +X neighbor lower -> cliff wall at x2 (normal +X)
      if (ix + 1 < nx) {
        const hn = hg[(ix + 1) * nz + iz];
        if (hn > -9000 && hn < h - 0.05) {
          pushWallQuad([x2, h, z, x2, h, z2, x2, hn, z2, x2, h, z, x2, hn, z2, x2, hn, z], [1, 0, 0], c);
        }
      }
      // -X neighbor lower -> cliff wall at x (normal -X)
      if (ix > 0) {
        const hn = hg[(ix - 1) * nz + iz];
        if (hn > -9000 && hn < h - 0.05) {
          pushWallQuad([x, h, z, x, h, z2, x, hn, z2, x, h, z, x, hn, z2, x, hn, z], [-1, 0, 0], c);
        }
      }
      // +Z neighbor lower -> cliff wall at z2 (normal +Z)
      if (iz + 1 < nz) {
        const hn = hg[ix * nz + iz + 1];
        if (hn > -9000 && hn < h - 0.05) {
          pushWallQuad([x, h, z2, x2, h, z2, x2, hn, z2, x, h, z2, x2, hn, z2, x, hn, z2], [0, 0, 1], c);
        }
      }
      // -Z neighbor lower -> cliff wall at z (normal -Z)
      if (iz > 0) {
        const hn = hg[ix * nz + iz - 1];
        if (hn > -9000 && hn < h - 0.05) {
          pushWallQuad([x, h, z, x2, h, z, x2, hn, z, x, h, z, x2, hn, z, x, hn, z], [0, 0, -1], c);
        }
      }
      // skirt walls at grid boundary so the map edge never shows void
      const skirt = 3;
      if (ix === 0) pushWallQuad([x, h, z, x, h, z2, x, h - skirt, z2, x, h, z, x, h - skirt, z2, x, h - skirt, z], [-1, 0, 0], c);
      if (ix === nx - 1) pushWallQuad([x2, h, z, x2, h, z2, x2, h - skirt, z2, x2, h, z, x2, h - skirt, z2, x2, h - skirt, z], [1, 0, 0], c);
      if (iz === 0) pushWallQuad([x, h, z, x2, h, z, x2, h - skirt, z, x, h, z, x2, h - skirt, z, x, h - skirt, z], [0, 0, -1], c);
      if (iz === nz - 1) pushWallQuad([x, h, z2, x2, h, z2, x2, h - skirt, z2, x, h, z2, x2, h - skirt, z2, x, h - skirt, z2], [0, 0, 1], c);
    }
  }
  if (!posArr.length) return { geometry: null };
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrmArr, 3));
  g.computeBoundingSphere();
  return { geometry: g };
}

/** approximate distance to road via sample scan (color only, coarse) */
function roadDistAt(data: TrackData, x: number, z: number): number {
  let best = 1e9;
  const S = data.samples;
  for (let i = 0; i < S.length; i += 4) {
    const dx = S[i].pos.x - x, dz = S[i].pos.z - z;
    const d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function pushQuad(p: number[], c: number[], n: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, x3: number, y3: number, z3: number, col: THREE.Color) {
  // winding order MUST face +Y (up): tris [0,3,2] and [0,2,1]
  const verts = [x0, y0, z0, x3, y3, z3, x2, y2, z2, x0, y0, z0, x2, y2, z2, x1, y1, z1];
  for (let i = 0; i < 6; i++) {
    p.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
    c.push(col.r, col.g, col.b);
    n.push(0, 1, 0);
  }
}

// ================= decorations =================
function placeDecorations(data: TrackData, theme: ThemeDef, rng: () => number, density: number): Record<string, { x: number; y: number; z: number; ry: number; s: number }[]> {
  const out: Record<string, { x: number; y: number; z: number; ry: number; s: number }[]> = {};
  const S = data.samples;
  const N = S.length;
  // MEGA MAPS v3 (user: "پر جزئیات‌تر بشن"): prop budget scales with lap
  // length so detail DENSITY stays constant — big maps are genuinely denser,
  // not sparser. Props are InstancedMeshes so this is cheap.
  const lenFac = clamp(N / 700, 1, 3);
  const total = Math.floor(230 * density * lenFac);
  const specs = theme.decos;
  const sumDensity = specs.reduce((a, s) => a + s.density, 0);
  const isSky = theme.id === 'sky';
  const wl = theme.water ? theme.water.level : -999;
  for (const spec of specs) {
    const count = Math.floor((spec.density / sumDensity) * total) + 1;
    const list: { x: number; y: number; z: number; ry: number; s: number }[] = out[spec.type] ?? (out[spec.type] = []);
    for (let i = 0; i < count; i++) {
      const sIdx = Math.floor(rng() * N);
      // keep the start area clean for the countdown camera + grandstand
      if (sIdx < 34 || sIdx > N - 12) continue;
      const s = S[sIdx];
      const side = rng() > 0.5 ? 1 : -1;
      const off = s.width / 2 + 8 + rng() * 28;
      const scale = (spec.scale ? spec.scale[0] + rng() * (spec.scale[1] - spec.scale[0]) : 0.8 + rng() * 0.7);
      const p = s.pos.clone().addScaledVector(s.left, side * off);
      const y = data.groundAt(p.x, p.z);
      if (y < -9000) { if (isSky && rng() > 0.82) { /* rare floating deco */ } else continue; }
      if (y < -9000) continue;
      if (wl > -900 && y < wl + 0.6) continue;   // never in the sea
      if (theme.lava && y < theme.lava.level + 0.6) continue;
      list.push({ x: p.x, y, z: p.z, ry: rng() * Math.PI * 2, s: scale });
    }
  }
  // far scattered depth decos (outside the island too — trees on hills)
  if (!isSky) {
    const farList: { x: number; y: number; z: number; ry: number; s: number }[] = out[specs[0].type] ?? (out[specs[0].type] = []);
    for (let i = 0; i < 46 * density * lenFac; i++) {
      const s = S[Math.floor(rng() * N)];
      const side = rng() > 0.5 ? 1 : -1;
      const off = 34 + rng() * 60;
      const p = s.pos.clone().addScaledVector(s.left, side * off);
      const y = data.groundAt(p.x, p.z);
      if (y < -9000) continue;
      if (wl > -900 && y < wl + 0.6) continue;
      if (theme.lava && y < theme.lava.level + 0.6) continue;
      farList.push({ x: p.x, y, z: p.z, ry: rng() * Math.PI * 2, s: 1 + rng() * 1.3 });
    }
  }
  return out;
}

// ================= theme landmarks =================
function landmarkFor(themeId: string): { type: string; x: number; z: number; ry: number; s: number }[] {
  // landmarks sit near the track centroid (inside the loop)
  switch (themeId) {
    case 'grass': return [{ type: 'windmill', x: 8, z: 6, ry: 0.4, s: 2.4 }, { type: 'house1', x: -16, z: 10, ry: 1.1, s: 1.6 }];
    case 'castle': return [{ type: 'tower', x: 0, z: 0, ry: 0, s: 4.2 }, { type: 'tower', x: 14, z: 12, ry: 0.8, s: 2.6 }];
    case 'desert': return [{ type: 'pyramid', x: 4, z: -6, ry: 0.3, s: 3.2 }];
    case 'snow': return [{ type: 'igloo', x: 6, z: 8, ry: 0.5, s: 2.4 }, { type: 'snowman', x: -10, z: 14, ry: 2, s: 1.8 }];
    case 'volcano': return [{ type: 'volcanoRock', x: 0, z: 0, ry: 0.2, s: 5.5 }, { type: 'obsidian', x: 18, z: -8, ry: 1, s: 3 }];
    case 'cave': return [{ type: 'stalagmite', x: 0, z: 4, ry: 0, s: 5 }, { type: 'crystalCluster', x: 14, z: 10, ry: 0.7, s: 3 }];
    case 'sky': return [{ type: 'floatIsland', x: 10, z: 0, ry: 0.4, s: 3.4 }, { type: 'cloud', x: -20, z: 16, ry: 0, s: 3 }];
    case 'city': return [{ type: 'building', x: 0, z: 0, ry: 0.2, s: 4.4 }, { type: 'building', x: 20, z: 14, ry: 1.2, s: 3.2 }];
    // CRASH CITY: a downtown skyline + the demolition square (crane + wrecks)
    case 'crashcity': return [
      { type: 'building', x: 0, z: 0, ry: 0.2, s: 5.4 }, { type: 'building', x: 24, z: 12, ry: 1.2, s: 3.8 },
      { type: 'building', x: -22, z: -14, ry: 0.7, s: 3.2 }, { type: 'wreckCar', x: 12, z: -12, ry: 0.9, s: 2.2 },
      { type: 'barrier', x: -10, z: 16, ry: 0.4, s: 2.4 }, { type: 'cone', x: 4, z: 18, ry: 0, s: 2 },
    ];
    // BLOCKTECH CITY: a creeper-sized downtown core — twin tech towers with a
    // redstone lamp plaza and glowing mushrooms between them
    case 'mccity': return [
      { type: 'building', x: 0, z: 0, ry: 0.2, s: 5.0 }, { type: 'building', x: 20, z: 14, ry: 1.2, s: 3.4 },
      { type: 'building', x: -20, z: -12, ry: 0.7, s: 3.0 }, { type: 'crate', x: 10, z: 14, ry: 0.4, s: 1.8 },
      { type: 'glowMushroom', x: -8, z: 16, ry: 0, s: 2.2 },
    ];
    case 'ruins': return [{ type: 'brokenArch', x: 4, z: 0, ry: 0.2, s: 3 }, { type: 'statue', x: -12, z: 12, ry: 2.2, s: 2.2 }];
    case 'jungle': return [{ type: 'tiki', x: 6, z: 4, ry: 0.4, s: 3 }, { type: 'vineTree', x: -14, z: 12, ry: 1.4, s: 2.6 }];
    default: return [];
  }
}

// ================= start gate + grandstand =================
type Disposable = THREE.BufferGeometry | THREE.Material | THREE.Texture;

function buildStartGate(s: TrackSample, theme: ThemeDef, disposables: Disposable[], label = 'KUBO KARTS'): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x37474f });
  const matAccent = new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.road.curbA) });
  const w = s.width / 2 + 1.6;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 8, 1.5), mat);
    pillar.position.copy(s.pos.clone().addScaledVector(s.left, side * w)).setY(s.pos.y + 4);
    pillar.castShadow = true;
    g.add(pillar);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 1.9), matAccent);
    cap.position.copy(pillar.position).setY(s.pos.y + 8.2);
    g.add(cap);
    // checker blocks on pillar
    for (let k = 0; k < 4; k++) {
      const chk = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.5, 1.56), new THREE.MeshLambertMaterial({ color: k % 2 ? 0xf2f2f2 : 0x1c1c1c }));
      chk.position.copy(pillar.position).setY(s.pos.y + 0.9 + k * 1.7);
      g.add(chk);
    }
  }
  // banner: checkered strip + logo
  const bannerCanvas = document.createElement('canvas');
  bannerCanvas.width = 256; bannerCanvas.height = 64;
  const ctx = bannerCanvas.getContext('2d')!;
  const sq = 16;
  for (let x = 0; x < 256 / sq; x++) for (let y = 0; y < 64 / sq; y++) {
    ctx.fillStyle = (x + y) % 2 === 0 ? '#f2f2f2' : '#1c1c1c';
    ctx.fillRect(x * sq, y * sq, sq, sq);
  }
  ctx.fillStyle = 'rgba(20,24,30,0.88)';
  ctx.fillRect(48, 12, 160, 40);
  ctx.fillStyle = '#ffd54f';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, 128, 41);
  const tex = new THREE.CanvasTexture(bannerCanvas);
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(w * 2, 2.4), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  banner.position.copy(s.pos).setY(s.pos.y + 6.6);
  banner.rotation.y = Math.atan2(s.tan.x, s.tan.z) + Math.PI;
  g.add(banner);
  disposables.push(mat, matAccent, tex, banner.material as THREE.Material);
  return g;
}

/** v2.0 MEGA RAMP dressing: deck skirts (the floating road reads as a thick
 *  slab), checkered + red race flags on poles along both barriers (reference
 *  look), and chunky END WALLS with hazard stripes at both dead ends. */
function buildMegaDressing(data: TrackData, theme: ThemeDef, disposables: Disposable[], seaY: number): THREE.Group {
  const g = new THREE.Group();
  const S = data.samples, N = S.length;
  const skirt: THREE.BufferGeometry[] = [];
  const skirtC = new THREE.Color('#2b3038');
  const skirtC2 = new THREE.Color('#e53935');
  for (let i = 0; i < N; i += 2) {
    if (!segOk(data, i) || !segOk(data, i + 1)) continue;
    const s0 = S[i], s1 = S[(i + 2) % N];
    for (const sgn of [1, -1]) {
      const a = s0.pos.clone().addScaledVector(s0.left, sgn * (s0.width / 2 + 1.25));
      const b = s1.pos.clone().addScaledVector(s1.left, sgn * (s1.width / 2 + 1.25));
      skirt.push(quad(a.clone().add(new THREE.Vector3(0, -0.5, 0)), b.clone().add(new THREE.Vector3(0, -0.5, 0)),
        b.clone().add(new THREE.Vector3(0, -2.4, 0)), a.clone().add(new THREE.Vector3(0, -2.4, 0)), (Math.floor(i / 8) % 2) ? skirtC : skirtC2, 0));
    }
    // underside slab
    const l0 = s0.pos.clone().addScaledVector(s0.left, s0.width / 2 + 1.25).add(new THREE.Vector3(0, -2.4, 0));
    const r0 = s0.pos.clone().addScaledVector(s0.left, -(s0.width / 2 + 1.25)).add(new THREE.Vector3(0, -2.4, 0));
    const l1 = s1.pos.clone().addScaledVector(s1.left, s1.width / 2 + 1.25).add(new THREE.Vector3(0, -2.4, 0));
    const r1 = s1.pos.clone().addScaledVector(s1.left, -(s1.width / 2 + 1.25)).add(new THREE.Vector3(0, -2.4, 0));
    skirt.push(quad(r0, l0, l1, r1, skirtC, 0));
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  disposables.push(mat);
  if (skirt.length) {
    const geo = mergeGeometries(skirt, false)!;
    skirt.forEach(x => x.dispose());
    disposables.push(geo);
    g.add(new THREE.Mesh(geo, mat));
  }
  // flags: pole + banner every ~22 samples on alternating sides
  const flagTex = (kind: number) => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 96;
    const x = c.getContext('2d')!;
    if (kind === 0) {
      for (let yy = 0; yy < 6; yy++) for (let xx = 0; xx < 4; xx++) { x.fillStyle = (xx + yy) % 2 ? '#111' : '#f5f5f5'; x.fillRect(xx * 16, yy * 16, 16, 16); }
    } else {
      x.fillStyle = kind === 1 ? '#e53935' : '#1e88e5'; x.fillRect(0, 0, 64, 96);
      x.fillStyle = '#fff'; x.fillRect(0, 70, 64, 10);
      x.fillStyle = '#111'; for (let xx = 0; xx < 4; xx++) x.fillRect(xx * 16 + (xx % 2) * 0, 80, 8, 16);
    }
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; disposables.push(tx); return tx;
  };
  const flagMats = [0, 1, 2].map(k => { const m = new THREE.MeshLambertMaterial({ map: flagTex(k), side: THREE.DoubleSide }); disposables.push(m); return m; });
  const poleGeo = new THREE.BoxGeometry(0.16, 5.2, 0.16); disposables.push(poleGeo);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xdfe4ea }); disposables.push(poleMat);
  const flagGeo = new THREE.PlaneGeometry(1.5, 2.3); flagGeo.translate(0.75, 0, 0); disposables.push(flagGeo);
  let k = 0;
  for (let i = 6; i < N - 6; i += 22) {
    if (!segOk(data, i)) continue;
    const s = S[i];
    const side = (k % 2) ? 1 : -1;
    const base = s.pos.clone().addScaledVector(s.left, side * (s.width / 2 + 1.9));
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.copy(base).setY(base.y + 2.6);
    g.add(pole);
    const flag = new THREE.Mesh(flagGeo, flagMats[k % 3]);
    flag.position.copy(base).setY(base.y + 4.0);
    flag.rotation.y = Math.atan2(s.tan.x, s.tan.z) + Math.PI / 2 * (side > 0 ? 1 : -1) + 0.3;
    g.add(flag);
    k++;
  }
  // END WALLS at both dead ends (runoff end + behind the start grid)
  if (data.seam !== undefined) {
    const wallMat = new THREE.MeshLambertMaterial({ map: (() => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 32;
      const x = c.getContext('2d')!;
      for (let i2 = 0; i2 < 16; i2++) { x.fillStyle = i2 % 2 ? '#111' : '#ffc400'; x.beginPath(); x.moveTo(i2 * 12 - 16, 32); x.lineTo(i2 * 12, 0); x.lineTo(i2 * 12 + 12, 0); x.lineTo(i2 * 12 - 4, 32); x.fill(); }
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; disposables.push(tx); return tx;
    })() });
    disposables.push(wallMat);
    for (const idx of [data.seam, (data.seam + 1) % N]) {
      const s = S[idx];
      const w = s.width + 3.4;
      const geo = new THREE.BoxGeometry(w, 2.4, 1.2); disposables.push(geo);
      const m = new THREE.Mesh(geo, wallMat);
      const dir = idx === data.seam ? 1 : -1;
      m.position.copy(s.pos).addScaledVector(s.tan, dir * 1.6).setY(s.pos.y + 0.9);
      m.rotation.y = Math.atan2(s.tan.x, s.tan.z);
      m.castShadow = true;
      g.add(m);
    }
  }
  void theme; void seaY;
  return g;
}

function buildGrandstand(s: TrackSample, theme: ThemeDef, groundAt: (x: number, z: number) => number, disposables: Disposable[]): THREE.Group {
  const g = new THREE.Group();
  const structMat = new THREE.MeshLambertMaterial({ color: 0x454c55 });
  const seatColors = [0xe84a3f, 0xf7d154, 0x2f7de0, 0x67c23a];
  // 3-step stand on one side of the road (kept clear of the drivable shoulder)
  const side = 1;
  for (let step = 0; step < 3; step++) {
    const off = (s.width / 2 + 8) + step * 1.4;
    const bench = new THREE.Mesh(new THREE.BoxGeometry(14, 0.8 + step * 0.9, 1.3), structMat);
    const p = s.pos.clone().addScaledVector(s.left, side * off);
    bench.position.set(p.x, p.y + (0.8 + step * 0.9) / 2, p.z);
    bench.rotation.y = Math.atan2(s.tan.x, s.tan.z);
    g.add(bench);
    // seated crowd blocks
    for (let c = -5; c <= 5; c++) {
      const cm = new THREE.MeshLambertMaterial({ color: seatColors[Math.floor(Math.abs(c * 2.7 + step)) % seatColors.length] });
      const fan = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.7), cm);
      const fp = s.pos.clone().addScaledVector(s.tan, c * 1.25).addScaledVector(s.left, side * off);
      fan.position.set(fp.x, p.y + (0.8 + step * 0.9) + 0.45, fp.z);
      fan.rotation.y = Math.atan2(s.tan.x, s.tan.z);
      g.add(fan);
    }
  }
  // roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(15, 0.3, 5), new THREE.MeshLambertMaterial({ color: new THREE.Color(theme.road.curbA) }));
  const rp = s.pos.clone().addScaledVector(s.left, side * (s.width / 2 + 9.8)).add(new THREE.Vector3(0, 5.6, 0));
  roof.position.set(rp.x, rp.y, rp.z);
  roof.rotation.y = Math.atan2(s.tan.x, s.tan.z);
  g.add(roof);
  void groundAt;
  disposables.push(structMat);
  return g;
}

// ================= minimap =================
export function minimapPath(data: TrackData): { pts: [number, number][]; breakAt?: number } {
  const pts: [number, number][] = [];
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const s of data.samples) {
    minX = Math.min(minX, s.pos.x); maxX = Math.max(maxX, s.pos.x);
    minZ = Math.min(minZ, s.pos.z); maxZ = Math.max(maxZ, s.pos.z);
  }
  const span = Math.max(maxX - minX, maxZ - minZ) || 1;
  for (let i = 0; i < data.samples.length; i += 6) {
    const s = data.samples[i];
    pts.push([(s.pos.x - minX) / span, (s.pos.z - minZ) / span]);
  }
  // open track: the polyline must NOT connect the runoff end to the start
  if (data.open && data.seam !== undefined) return { pts, breakAt: Math.floor(data.seam / 6) + 1 };
  return { pts };
}

/** Find nearest sample index around a hint (local search) */
export function nearestSample(data: TrackData, pos: THREE.Vector3, hint: number, search = 30): number {
  const N = data.samples.length;
  let best = hint, bestD = Infinity;
  for (let k = -search; k <= search; k++) {
    const i = ((hint + k) % N + N) % N;
    const s = data.samples[i];
    const dx = s.pos.x - pos.x, dz = s.pos.z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/** Full-track nearest sample (spawn/init only — O(N), not for per-frame use). */
export function nearestSampleGlobal(data: TrackData, pos: THREE.Vector3): number {
  const N = data.samples.length;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < N; i++) {
    const s = data.samples[i];
    const dx = s.pos.x - pos.x, dz = s.pos.z - pos.z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Nearest sample that actually HAS road, searching backward (then forward)
 * from idx. Used for respawns: dropping a kart onto a jump-gap or void
 * sample caused infinite fall loops.
 */
export function nearestRoadSample(data: TrackData, idx: number): number {
  const N = data.samples.length;
  const i0 = ((idx % N) + N) % N;
  if (data.samples[i0].hasRoad) return i0;
  for (let k = 1; k < N; k++) {
    const b = ((i0 - k) % N + N) % N;
    if (data.samples[b].hasRoad) return b;
    const f = (i0 + k) % N;
    if (data.samples[f].hasRoad) return f;
  }
  return i0;
}

/**
 * Forward-only road search: the FIRST road sample at or after idx. Used by
 * fall-respawns — a kart that dropped into a jump-gap pit must respawn PAST
 * the gap, not before it (the old backward search put it right back at the
 * take-off lip with too little runway → endless fall loop).
 */
export function nearestRoadSampleForward(data: TrackData, idx: number): number {
  const N = data.samples.length;
  const i0 = ((idx % N) + N) % N;
  // v2.0.1 OPEN TRACK: never search ACROSS the dead end. Physical order is
  // (seam+1 … N-1, 0 … seam) — the array wrap N-1→0 is the CONNECTED finish
  // crossing, while seam→seam+1 is the void gap. Unwrap so that indices
  // ≤ seam sit AFTER the wrap, then scan strictly forward up to the dead end;
  // a kart that falls in the runoff respawns behind the wall, never teleports
  // through it onto the road start.
  if (data.open && data.seam !== undefined) {
    const seam = data.seam;
    const u0 = i0 > seam ? i0 : i0 + N;
    const uMax = seam + N;
    for (let u = u0; u <= uMax; u++) {
      const f = u >= N ? u - N : u;
      if (data.samples[f].hasRoad) return f;
    }
    return nearestRoadSample(data, i0);
  }
  for (let k = 0; k < N; k++) {
    const f = (i0 + k) % N;
    if (data.samples[f].hasRoad) return f;
  }
  return i0;
}
