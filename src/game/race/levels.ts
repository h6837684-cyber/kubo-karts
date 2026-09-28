// KUBO KARTS - Career campaign: 60 HAND-CRAFTED levels across 10 worlds.
// Every stage gets its own name (EN+FA), rule modifiers and rival car lineup —
// no more generated "THEME SUFFIX" repetition (user request: "مراحل تکراری نیست").
import { t, getLang } from '../core/lang';
import { faDigits } from '../core/utils';
import { THEMES } from '../world/themes';

export type ObjectiveType = 'finish1' | 'finish3' | 'time' | 'drift' | 'items' | 'survive' | 'clean';

/** gameplay modifiers a stage can mix (all really wired in race.ts / main.ts) */
export type LevelMod =
  | 'night'       // dark sky + dim sun (headlights glow)
  | 'lowgrip'     // slippery tarmac: less steering grip
  | 'turbostart'  // free boost the moment the race starts
  | 'itemstorm'   // double item boxes on the road
  | 'noitems'     // pure racing — item boxes disabled
  | 'fog'         // thick fog, low visibility
  | 'boss'        // a maxed-out rival joins the grid
  | 'gems'        // bonus gems for a top-3 finish
  | 'veteran';    // AI difficulty bumped to hard

export interface LevelDef {
  id: number;
  name: string;
  nameFa: string;
  themeId: string;
  laps: number;
  seed: number;
  genName?: string;
  difficulty: 'easy' | 'normal' | 'hard' | 'extreme';
  opponents: number;
  objective: { type: ObjectiveType; param?: number };
  rewardMul: number;
  unlockGems?: number;
  desc: string;
  mods: LevelMod[];
  rivals: string[];   // AI car ids used by THIS stage (varied per stage)
}

/** localized stage description from the objective */
export function levelDesc(lv: LevelDef): string {
  const o = lv.objective;
  switch (o.type) {
    case 'finish1': return t('obj_finish1');
    case 'finish3': return t('obj_finish3');
    case 'time': return t('obj_time', faDigits(String(o.param)));
    case 'drift': return t('obj_drift', faDigits(String(o.param)));
    case 'items': return t('obj_items', faDigits(String(o.param)));
    case 'survive': return t('obj_survive');
    case 'clean': return t('obj_clean');
  }
}

// rival car pools, themed per world tier (levels reference them by id)
const R = {
  starters: ['kart_start', 'kart_accel', 'kart_speed', 'kart_drift'],
  mixed: ['kart_accel', 'kart_speed', 'kart_drift', 'kart_heavy', 'kart_start'],
  drifters: ['kart_drift', 'kart_classic', 'kart_muscle', 'kart_accel', 'kart_ev'],
  offroad: ['kart_buggy', 'kart_heavy', 'kart_accel', 'kart_truck', 'kart_drift'],
  speed: ['kart_speed', 'kart_gt', 'kart_ev', 'kart_wedge', 'kart_classic'],
  elite: ['kart_gt', 'kart_wedge', 'kart_ev', 'kart_proto', 'kart_f40', 'kart_911'],
  heavy: ['kart_heavy', 'kart_truck', 'kart_muscle', 'kart_buggy', 'kart_proto'],
  exotic: ['kart_wedge', 'kart_proto', 'kart_aventador', 'kart_p1', 'kart_chiron', 'kart_db11', 'kart_aurelion', 'kart_vortexrs'],
};

interface Stage {
  name: string; nameFa: string; gen: string;
  diff: LevelDef['difficulty']; opp: number; laps?: number;
  obj: LevelDef['objective']; mods?: LevelMod[]; rivals: string[]; gems?: number;
}

/** 10 worlds x 6 hand-crafted stages */
const WORLDS: Record<string, Stage[]> = {
  grass: [
    { name: 'First Puddle', nameFa: 'برکه اول', gen: 'oval', diff: 'easy', opp: 3, obj: { type: 'finish3' }, rivals: R.starters },
    { name: 'Flower Sprint', nameFa: 'اسپرینت گل‌ها', gen: 'kidney', diff: 'easy', opp: 4, obj: { type: 'time', param: 150 }, rivals: R.starters },
    { name: 'Windmill Curves', nameFa: 'پیچ‌های آسیاب', gen: 'sCurves', diff: 'easy', opp: 4, obj: { type: 'drift', param: 10 }, rivals: R.mixed },
    { name: 'Moonlit Meadow', nameFa: 'چمنِ مهتابی', gen: 'oval', diff: 'normal', opp: 4, obj: { type: 'finish3' }, mods: ['night'], rivals: R.mixed },
    { name: 'Pollen Storm', nameFa: 'طوفان گرده', gen: 'kidney', diff: 'normal', opp: 5, obj: { type: 'items', param: 3 }, mods: ['itemstorm'], rivals: R.mixed },
    { name: 'Valley Grand Prix', nameFa: 'گرندپری دره', gen: 'sCurves', diff: 'hard', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.speed, gems: 5 },
  ],
  castle: [
    { name: 'Drawbridge Dash', nameFa: 'تاخت پل کشویی', gen: 'figure8', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.mixed },
    { name: "Squire's Trial", nameFa: 'آزمون شوالیه', gen: 'canyon', diff: 'normal', opp: 4, obj: { type: 'time', param: 165 }, rivals: R.mixed },
    { name: 'Torchlight Tour', nameFa: 'گردش مشعل‌ها', gen: 'oval', diff: 'normal', opp: 5, obj: { type: 'finish3' }, mods: ['night'], rivals: R.drifters },
    { name: 'Battering Ram', nameFa: 'دژکوب', gen: 'figure8', diff: 'normal', opp: 5, obj: { type: 'clean' }, mods: ['veteran'], rivals: R.heavy },
    { name: 'Moat Fog', nameFa: 'مه خندق', gen: 'canyon', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['fog'], rivals: R.drifters },
    { name: 'Crown Grand Prix', nameFa: 'گرندپری تاج', gen: 'sCurves', diff: 'hard', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.elite, gems: 6 },
  ],
  desert: [
    { name: 'Dune Warm-up', nameFa: 'گرم‌کردن تپه‌ها', gen: 'oval', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.offroad },
    { name: 'Mirage Run', nameFa: 'دویدنِ سراب', gen: 'canyon', diff: 'normal', opp: 4, obj: { type: 'time', param: 170 }, mods: ['fog'], rivals: R.offroad },
    { name: 'Scarab Storm', nameFa: 'طوفان سوسک', gen: 'pinball', diff: 'normal', opp: 5, obj: { type: 'items', param: 4 }, mods: ['itemstorm'], rivals: R.drifters },
    { name: "Pharaoh's Challenge", nameFa: 'چالش فرعون', gen: 'canyon', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['veteran'], rivals: R.elite },
    { name: 'Oasis Ice', nameFa: 'واحهٔ یخ‌زده', gen: 'pinball', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['lowgrip'], rivals: R.drifters },
    { name: 'Sphinx Grand Prix', nameFa: 'گرندپری ابوالهول', gen: 'oval', diff: 'hard', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.elite, gems: 7 },
  ],
  snow: [
    { name: 'First Flakes', nameFa: 'اولین برف‌ها', gen: 'highlands', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.offroad },
    { name: 'Iceline', nameFa: 'خط یخ', gen: 'kidney', diff: 'normal', opp: 4, obj: { type: 'drift', param: 14 }, mods: ['lowgrip'], rivals: R.drifters },
    { name: 'Blizzard Sprint', nameFa: 'اسپرینت برف‌بوران', gen: 'sCurves', diff: 'normal', opp: 5, obj: { type: 'time', param: 175 }, mods: ['fog'], rivals: R.offroad },
    { name: 'Aurora Night', nameFa: 'شب شفق قطبی', gen: 'highlands', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['night'], rivals: R.speed },
    { name: 'Yeti Territory', nameFa: 'سرزمین یتی', gen: 'kidney', diff: 'hard', opp: 5, obj: { type: 'survive' }, mods: ['veteran'], rivals: R.heavy },
    { name: 'Summit Grand Prix', nameFa: 'گرندپری قله', gen: 'sCurves', diff: 'hard', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.elite, gems: 8 },
  ],
  volcano: [
    { name: 'Warm Crater', nameFa: 'دهانهٔ گرم', gen: 'canyon', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.offroad },
    { name: 'Ashfall', nameFa: 'بارش خاکستر', gen: 'star', diff: 'normal', opp: 5, obj: { type: 'finish3' }, mods: ['fog'], rivals: R.heavy },
    { name: 'Lava Leap', nameFa: 'پرش از گدازه', gen: 'pretzel', diff: 'hard', opp: 5, obj: { type: 'drift', param: 15 }, rivals: R.drifters },
    { name: 'Eruption Eve', nameFa: 'شب فوران', gen: 'canyon', diff: 'hard', opp: 5, obj: { type: 'survive' }, mods: ['veteran'], rivals: R.heavy },
    { name: 'Magma Rush', nameFa: 'هجوم ماگما', gen: 'star', diff: 'hard', opp: 5, obj: { type: 'items', param: 4 }, mods: ['itemstorm'], rivals: R.speed },
    { name: 'Core Grand Prix', nameFa: 'گرندپری هسته', gen: 'pretzel', diff: 'extreme', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.elite, gems: 9 },
  ],
  cave: [
    { name: 'Echo Entrance', nameFa: 'ورود پژواک', gen: 'canyon', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.mixed },
    { name: 'Crystal Dark', nameFa: 'تاریکی بلور', gen: 'figure8', diff: 'normal', opp: 4, obj: { type: 'finish3' }, mods: ['night'], rivals: R.drifters },
    { name: 'Stalactite Sprint', nameFa: 'اسپرینت سنگ‌ها', gen: 'pinball', diff: 'normal', opp: 5, obj: { type: 'time', param: 180 }, rivals: R.speed },
    { name: 'Lost in Mist', nameFa: 'گم‌شده در مه', gen: 'canyon', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['fog'], rivals: R.drifters },
    { name: 'Bats & Boxes', nameFa: 'خفاش و جعبه', gen: 'figure8', diff: 'hard', opp: 5, obj: { type: 'items', param: 5 }, mods: ['itemstorm'], rivals: R.speed },
    { name: 'Depths Grand Prix', nameFa: 'گرندپری اعماق', gen: 'pinball', diff: 'extreme', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.elite, gems: 10 },
  ],
  sky: [
    { name: 'Cloud Landing', nameFa: 'فرود روی ابر', gen: 'skyhop', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.speed },
    { name: 'Rainbow Ring', nameFa: 'حلقه رنگین‌کمان', gen: 'star', diff: 'normal', opp: 5, obj: { type: 'drift', param: 16 }, rivals: R.drifters },
    { name: 'Thin Air', nameFa: 'هوای رقیق', gen: 'skyhop', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['lowgrip'], rivals: R.speed },
    { name: 'Starlight Soar', nameFa: 'پرواز ستاره‌ها', gen: 'figure8', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['night'], rivals: R.elite },
    { name: 'Wind Tunnel', nameFa: 'تونل باد', gen: 'star', diff: 'hard', opp: 5, obj: { type: 'clean' }, mods: ['veteran'], rivals: R.elite },
    { name: 'Heaven Grand Prix', nameFa: 'گرندپری آسمان', gen: 'skyhop', diff: 'extreme', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.exotic, gems: 11 },
  ],
  city: [
    { name: 'Neon Warm-up', nameFa: 'گرم‌کردن نئون', gen: 'pinball', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.speed },
    { name: 'Rush Hour', nameFa: 'ساعت شلوغی', gen: 'oval', diff: 'normal', opp: 5, obj: { type: 'items', param: 4 }, mods: ['itemstorm'], rivals: R.speed },
    { name: 'Blackout', nameFa: 'قطع برق', gen: 'sCurves', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['night'], rivals: R.elite },
    { name: 'Rainy Grip', nameFa: 'آسفالت بارانی', gen: 'pinball', diff: 'hard', opp: 5, obj: { type: 'drift', param: 18 }, mods: ['lowgrip'], rivals: R.drifters },
    { name: 'Uptown Fog', nameFa: 'مه اونتاون', gen: 'oval', diff: 'hard', opp: 5, obj: { type: 'time', param: 190 }, mods: ['fog'], rivals: R.elite },
    { name: 'Midnight Grand Prix', nameFa: 'گرندپری نیمه‌شب', gen: 'sCurves', diff: 'extreme', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.exotic, gems: 12 },
  ],
  // v1.9 NEW WORLD — CRASH CITY (user: "یک مپ جدید و پرجزئیات خیلی بزرگ، داخل
  // شب، حالت کراش ماشینی، شهر مدرن"): the giant night metropolis.
  crashcity: [
    { name: 'Downtown Entry', nameFa: 'ورود به مرکز شهر', gen: 'megacity', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.speed },
    { name: 'Wreck Alley', nameFa: 'کوچهٔ آوار', gen: 'megacity', diff: 'normal', opp: 5, obj: { type: 'items', param: 4 }, mods: ['itemstorm'], rivals: R.speed },
    { name: 'Overpass Rush', nameFa: 'شتاب روی پل رو', gen: 'megacity', diff: 'hard', opp: 5, obj: { type: 'time', param: 200 }, rivals: R.elite },
    { name: 'Demolition Night', nameFa: 'شب تخریب', gen: 'megacity', diff: 'hard', opp: 5, obj: { type: 'survive' }, mods: ['veteran'], rivals: R.heavy },
    { name: 'Neon Storm', nameFa: 'طوفان نئون', gen: 'megacity', diff: 'hard', opp: 5, obj: { type: 'drift', param: 20 }, mods: ['itemstorm'], rivals: R.exotic },
    { name: 'Crash City Grand Prix', nameFa: 'گرندپری کراش‌سیتی', gen: 'megacity', diff: 'extreme', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.exotic, gems: 14 },
  ],
  // v1.11 BLOCKTECH CITY (user: "شهر ماینکرفتی با تکنولوژی بالا"): a chunky
  // high-tech block metropolis at night — 6 new career stages
  mccity: [
    { name: 'Block Avenue', nameFa: 'بلوار بلوکی', gen: 'megacity', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.speed },
    { name: 'Redstone Rush', nameFa: 'شتاب ردستون', gen: 'pinball', diff: 'normal', opp: 5, obj: { type: 'items', param: 4 }, rivals: R.speed },
    { name: 'Creeper Corners', nameFa: 'پیچ‌های کریپری', gen: 'pinball', diff: 'hard', opp: 5, obj: { type: 'drift', param: 18 }, rivals: R.elite },
    { name: 'Emerald Circuit', nameFa: 'مدار زمردی', gen: 'kidney', diff: 'hard', opp: 5, obj: { type: 'time', param: 190 }, mods: ['lowgrip'], rivals: R.heavy },
    { name: 'Tech Tower Loop', nameFa: 'حلقهٔ برج فناوری', gen: 'megacity', diff: 'hard', opp: 5, obj: { type: 'survive' }, mods: ['itemstorm'], rivals: R.exotic },
    { name: 'BlockTech Grand Prix', nameFa: 'گرندپری بلوک‌تک', gen: 'megacity', diff: 'extreme', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.exotic, gems: 14 },
  ],
  ruins: [
    { name: 'Broken Gate', nameFa: 'دروازهٔ شکسته', gen: 'pretzel', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.mixed },
    { name: 'Silhouettes', nameFa: 'سایه‌ها', gen: 'coast', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['night'], rivals: R.speed },
    { name: 'Dust Devil', nameFa: 'گردباد', gen: 'oval', diff: 'hard', opp: 5, obj: { type: 'time', param: 195 }, mods: ['fog'], rivals: R.speed },
    { name: 'Trap Tombs', nameFa: 'مقبرهٔ تله‌دار', gen: 'pretzel', diff: 'hard', opp: 5, obj: { type: 'survive' }, mods: ['veteran'], rivals: R.heavy },
    { name: 'Ancient Ice', nameFa: 'یخ باستانی', gen: 'coast', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['lowgrip'], rivals: R.drifters },
    { name: 'Relic Grand Prix', nameFa: 'گرندپری یادگار', gen: 'pretzel', diff: 'extreme', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'gems'], rivals: R.exotic, gems: 13 },
  ],
  jungle: [
    { name: 'Vine Entry', nameFa: 'ورود به لیان‌ها', gen: 'star', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.offroad },
    { name: 'Canopy Mist', nameFa: 'مه تاج‌پوش', gen: 'kidney', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['fog'], rivals: R.offroad },
    { name: 'Firefly Flight', nameFa: 'پرواز کرم شب‌تاب', gen: 'skyhop', diff: 'hard', opp: 5, obj: { type: 'drift', param: 18 }, mods: ['night'], rivals: R.drifters },
    { name: 'Jaguar Hunt', nameFa: 'شکار جگوار', gen: 'star', diff: 'extreme', opp: 5, obj: { type: 'finish3' }, mods: ['veteran', 'turbostart'], rivals: R.elite },
    { name: 'Monsoon Boxes', nameFa: 'جعبه‌های موسون', gen: 'kidney', diff: 'extreme', opp: 5, obj: { type: 'items', param: 5 }, mods: ['itemstorm'], rivals: R.speed },
    { name: 'Jungle Crown', nameFa: 'تاج جنگل', gen: 'sCurves', diff: 'extreme', opp: 4, laps: 3, obj: { type: 'finish1' }, mods: ['boss', 'turbostart', 'gems'], rivals: R.exotic, gems: 15 },
  ],
  // v2.0 NEW WORLD — MEGA RAMP: point-to-point sky stunt roads (1 run each)
  megaramp: [
    { name: 'First Drop', nameFa: 'اولین سقوط', gen: 'megaramp', diff: 'normal', opp: 4, obj: { type: 'finish3' }, rivals: R.speed },
    { name: 'Cloud Carver', nameFa: 'ابرشکاف', gen: 'megadrop', diff: 'normal', opp: 5, obj: { type: 'time', param: 120 }, rivals: R.speed },
    { name: 'Kicker Madness', nameFa: 'جنون پرش', gen: 'megaramp', diff: 'hard', opp: 5, obj: { type: 'items', param: 3 }, mods: ['itemstorm'], rivals: R.elite },
    { name: 'Sunset Plunge', nameFa: 'شیرجهٔ غروب', gen: 'megadrop', diff: 'hard', opp: 5, obj: { type: 'finish3' }, mods: ['fog'], rivals: R.elite },
    { name: 'Thin Ice Sky', nameFa: 'آسمان لغزنده', gen: 'megaramp', diff: 'hard', opp: 5, obj: { type: 'clean' }, mods: ['lowgrip'], rivals: R.exotic },
    { name: 'Mega Ramp Grand Prix', nameFa: 'گرندپری مگارمپ', gen: 'megadrop', diff: 'extreme', opp: 5, obj: { type: 'finish1' }, mods: ['boss', 'gems', 'turbostart'], rivals: R.exotic, gems: 16 },
  ],
};

function buildLevels(): LevelDef[] {
  const levels: LevelDef[] = [];
  let id = 0;
  for (const theme of THEMES) {
    const stages = WORLDS[theme.id] ?? [];
    stages.forEach((st, idx) => {
      id++;
      levels.push({
        id,
        name: st.name,
        nameFa: st.nameFa,
        themeId: theme.id,
        laps: theme.id === 'megaramp' ? 1 : (st.laps ?? (id < 5 ? 2 : idx === 5 ? 3 : 2)),
        seed: 1000 + id * 77 + idx * 13,
        genName: st.gen,
        difficulty: st.diff,
        opponents: st.opp,
        objective: st.obj,
        rewardMul: 1 + id * 0.12,
        unlockGems: st.gems,
        desc: '',                     // localized on demand via levelDesc()
        mods: st.mods ?? [],
        rivals: st.rivals,
      });
    });
  }
  return levels;
}

export const LEVELS: LevelDef[] = buildLevels();
export const levelById = (id: number): LevelDef => LEVELS[id - 1] ?? LEVELS[0];
/** localized stage name (Persian default) */
export function levelName(lv: LevelDef): string {
  return getLang() === 'fa' ? lv.nameFa : lv.name;
}

// quick race: random level-styled config (also gets a random mod for variety)
// v1.11: laps is user-selectable 1..8 (user: "تعداد دورها هم قابل تغییر باشه")
export function quickRaceConfig(themeIdx: number, laps = 3): LevelDef {
  const t2 = THEMES[themeIdx % THEMES.length];
  const pool = LEVELS.filter(l => l.themeId === t2.id);
  const base = pool[Math.floor(Math.random() * pool.length)] ?? LEVELS[0];
  // v3.4 BUGFIX: the premium maps (candy / galaxy / dragon / royal) have no
  // career stages, so the fallback LEVELS[0] silently loaded GRASS instead of
  // the chosen map. Always race on the picked theme; with no stage of its own
  // the track layout comes from the theme's own layout pool.
  const own = pool.length > 0;
  return {
    ...base,
    themeId: t2.id,
    genName: own ? base.genName : '',
    name: own ? base.name : t2.name, nameFa: own ? base.nameFa : t('theme_' + t2.id),
    id: 0, laps: t2.id === 'megaramp' ? 1 : Math.min(8, Math.max(1, Math.round(laps))), seed: Math.floor(Math.random() * 99999),
    difficulty: 'normal', opponents: 5,
    objective: { type: 'finish3' }, rewardMul: 1.1,
    mods: base.mods.filter(m => m === 'night' || m === 'lowgrip' || m === 'itemstorm'),
  };
}
