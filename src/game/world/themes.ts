// KUBO KARTS - 10 world themes with distinct palettes, props, hazards and mood.

export interface DecoSpec { type: string; density: number; scale?: [number, number]; }

export interface ThemeDef {
  id: string;
  name: string;
  night?: boolean;
  road: { base: string; edge: string; curbA: string; curbB: string; line: string };
  ground: { base: string; alt: string; accent: string };
  sky: { top: string; bottom: string; horizon: string; sun: string; sunIntensity: number; hemiSky: string; hemiGround: string };
  fog: { color: string; near: number; far: number };
  water?: { level: number; deep: string; shallow: string } | null;
  lava?: { level: number } | null;
  decos: DecoSpec[];
  mountains: string;
  mountainSnow?: string;
  hazard: 'none' | 'boulder' | 'geyser' | 'snowball' | 'saw' | 'ghost';
  ambience: 'leaves' | 'snow' | 'embers' | 'sparks' | 'dust' | 'none';
  jumpGap: boolean; // theme features gap jumps
  /** v1.11 night-neon palette: self-lit barrier strips + signage glow colors
   *  (street-racing mood — each night map gets its OWN colors) */
  neon?: string[];
}

export const THEMES: ThemeDef[] = [
  {
    id: 'grass', name: 'Verdant Valley',
    road: { base: '#6e5a44', edge: '#5a4a38', curbA: '#e84a3f', curbB: '#f2f2f2', line: '#f2f2f2' },
    ground: { base: '#67a03a', alt: '#7cb342', accent: '#4e8c2e' },
    sky: { top: '#3f8fe8', bottom: '#a8d8f8', horizon: '#cfeefe', sun: '#fff3d6', sunIntensity: 1.15, hemiSky: '#bfe0ff', hemiGround: '#6a8f4a' },
    fog: { color: '#a8d8f8', near: 70, far: 300 },
    water: { level: -2.8, deep: '#1565a8', shallow: '#59c4e8' },
    decos: [
      { type: 'treeRound', density: 1.0 }, { type: 'bush', density: 0.6 }, { type: 'flower', density: 0.5 },
      { type: 'house1', density: 0.12 }, { type: 'fence', density: 0.3 }, { type: 'rock', density: 0.25 },
      { type: 'windmill', density: 0.06 }, { type: 'treePine', density: 0.4 },
    ],
    mountains: '#5a8f4e', mountainSnow: '#e8f4ec',
    hazard: 'boulder', ambience: 'leaves', jumpGap: false,
  },
  {
    id: 'castle', name: 'Crown Keep',
    road: { base: '#7a7f88', edge: '#5f646d', curbA: '#c9a227', curbB: '#f2f2f2', line: '#c9a227' },
    ground: { base: '#5d8c46', alt: '#6d9c52', accent: '#4a7c3a' },
    sky: { top: '#4a7ce0', bottom: '#b8d0f0', horizon: '#dbe8fa', sun: '#fff3d6', sunIntensity: 1.1, hemiSky: '#b8ccf0', hemiGround: '#5d7a4a' },
    fog: { color: '#b8d0f0', near: 60, far: 280 },
    water: { level: -2.6, deep: '#28527a', shallow: '#4a8ac2' },
    decos: [
      { type: 'tower', density: 0.3 }, { type: 'house2', density: 0.2 }, { type: 'torch', density: 0.5 },
      { type: 'treeRound', density: 0.4 }, { type: 'flag', density: 0.4 }, { type: 'bush', density: 0.3 },
      { type: 'statue', density: 0.1 },
    ],
    mountains: '#6a7482', mountainSnow: '#d8e2ec',
    hazard: 'boulder', ambience: 'none', jumpGap: false,
  },
  {
    id: 'desert', name: 'Sunbaked Dunes',
    road: { base: '#b09468', edge: '#96794e', curbA: '#d97b29', curbB: '#f7ecd8', line: '#f7ecd8' },
    ground: { base: '#d9b877', alt: '#e5c98e', accent: '#c2a05e' },
    sky: { top: '#4aa0d8', bottom: '#ffe0b0', horizon: '#ffedc8', sun: '#fff0c0', sunIntensity: 1.3, hemiSky: '#ffe8c8', hemiGround: '#c2a05e' },
    fog: { color: '#f2ddb0', near: 60, far: 260 },
    water: null,
    decos: [
      { type: 'cactus', density: 0.9 }, { type: 'rock', density: 0.6 }, { type: 'ruinColumn', density: 0.35 },
      { type: 'pyramid', density: 0.08 }, { type: 'palm', density: 0.4 }, { type: 'skullRock', density: 0.12 },
    ],
    mountains: '#c98f4e',
    hazard: 'geyser', ambience: 'dust', jumpGap: false,
  },
  {
    id: 'snow', name: 'Frostbite Peaks',
    road: { base: '#9fb4c4', edge: '#8299ab', curbA: '#3f8fe8', curbB: '#f2f8fc', line: '#e8f4fc' },
    ground: { base: '#eef4f8', alt: '#ffffff', accent: '#c8d8e4' },
    sky: { top: '#6aa8e8', bottom: '#d8ecfa', horizon: '#eef8ff', sun: '#fff8e8', sunIntensity: 1.05, hemiSky: '#d8ecfa', hemiGround: '#c8d8e4' },
    fog: { color: '#d8ecfa', near: 45, far: 230 },
    water: { level: -3.0, deep: '#3a7cc2', shallow: '#8fd0f0' },
    decos: [
      { type: 'treePineSnow', density: 1.0 }, { type: 'snowman', density: 0.25 }, { type: 'iceCrystal', density: 0.35 },
      { type: 'rock', density: 0.3 }, { type: 'igloo', density: 0.1 },
    ],
    mountains: '#8fa8bc', mountainSnow: '#ffffff',
    hazard: 'snowball', ambience: 'snow', jumpGap: false,
  },
  {
    id: 'volcano', name: 'Ember Core',
    road: { base: '#4a3c38', edge: '#372c28', curbA: '#ff6d00', curbB: '#2a211e', line: '#ffb74d' },
    ground: { base: '#4a4038', alt: '#5a4c42', accent: '#372c28' },
    sky: { top: '#5a2020', bottom: '#c25a28', horizon: '#e88a3a', sun: '#ffc078', sunIntensity: 1.0, hemiSky: '#c27a4a', hemiGround: '#3a2c28' },
    fog: { color: '#c26a34', near: 50, far: 240 },
    lava: { level: -1.8 },
    decos: [
      { type: 'volcanoRock', density: 0.9 }, { type: 'lavaPool', density: 0.25 }, { type: 'emberTree', density: 0.4 },
      { type: 'obsidian', density: 0.4 }, { type: 'torch', density: 0.3 },
    ],
    mountains: '#6a3030', mountainSnow: '#ff8a3a',
    hazard: 'geyser', ambience: 'embers', jumpGap: false,
  },
  {
    id: 'cave', name: 'Echo Caverns',
    road: { base: '#565d6b', edge: '#424855', curbA: '#20c8d8', curbB: '#2a3040', line: '#7fe8ff' },
    ground: { base: '#3c424e', alt: '#4a5160', accent: '#2a3040' },
    sky: { top: '#141821', bottom: '#232a38', horizon: '#2e3646', sun: '#8899bb', sunIntensity: 0.55, hemiSky: '#3a4454', hemiGround: '#20242e' },
    fog: { color: '#20262f', near: 30, far: 170 },
    water: { level: -3.2, deep: '#0f3a52', shallow: '#1f6a8a' },
    decos: [
      { type: 'stalagmite', density: 0.9 }, { type: 'glowMushroom', density: 0.7 }, { type: 'crystalCluster', density: 0.5 },
      { type: 'rock', density: 0.5 },
    ],
    mountains: '#2a3040',
    hazard: 'saw', ambience: 'sparks', jumpGap: false,
  },
  {
    id: 'sky', name: 'Skyshard Isles',
    road: { base: '#9a8cc2', edge: '#7a6ca2', curbA: '#28e0a8', curbB: '#f2f2fc', line: '#f2f2fc' },
    ground: { base: '#7cb352', alt: '#8fc463', accent: '#5d8c3e' },
    sky: { top: '#3f6fe0', bottom: '#9ac8f5', horizon: '#cfe8ff', sun: '#fff8e0', sunIntensity: 1.2, hemiSky: '#c2dcff', hemiGround: '#8fae6a' },
    fog: { color: '#b8dcfa', near: 80, far: 340 },
    water: null,
    decos: [
      { type: 'floatIsland', density: 0.35 }, { type: 'cloud', density: 0.5 }, { type: 'treeRound', density: 0.5 },
      { type: 'crystalCluster', density: 0.25 }, { type: 'flower', density: 0.4 },
    ],
    mountains: '#7aa0d8', mountainSnow: '#ffffff',
    hazard: 'none', ambience: 'none', jumpGap: true,
  },
  {
    id: 'city', name: 'Neon Block City',
    night: true,
    // v1.11 per-map neon identity: hot pink + ice cyan street-race strip
    neon: ['#ff2d9a', '#22e6ff'],
    road: { base: '#3a3f4c', edge: '#2a2e38', curbA: '#e8459e', curbB: '#20c8d8', line: '#7fe8ff' },
    ground: { base: '#32363e', alt: '#3c414c', accent: '#262a32' },
    sky: { top: '#0c1020', bottom: '#28304e', horizon: '#3e4a72', sun: '#8899ff', sunIntensity: 0.4, hemiSky: '#3a4468', hemiGround: '#1c2028' },
    fog: { color: '#1a2030', near: 50, far: 260 },
    water: { level: -3.0, deep: '#0f2a4a', shallow: '#2a6a9a' },
    decos: [
      { type: 'building', density: 0.7 }, { type: 'neonSign', density: 0.5 }, { type: 'lamp', density: 0.6 },
      { type: 'billboard', density: 0.2 },
    ],
    mountains: '#1e2438',
    hazard: 'saw', ambience: 'sparks', jumpGap: false,
  },
  {
    // v1.9 NEW MAP (user: "یک مپ جدید و پرجزئیات خیلی بزرگ، داخل شب، حالت
    // کراش ماشینی، شهر مدرن، باکیفیت"): CRASH CITY — a giant modern night
    // metropolis turned demolition playground. Neon purple/cyan mood, wrecks,
    // barriers and cones everywhere, dense skyline, lamp-lit avenues.
    id: 'crashcity', name: 'Crash City',
    night: true,
    // v1.11 neon identity: demolition magenta / ice / ultra-violet
    neon: ['#ff2d78', '#18e0ff', '#b06aff'],
    road: { base: '#333946', edge: '#232833', curbA: '#ff2d78', curbB: '#18e0ff', line: '#b8f4ff' },
    ground: { base: '#2c3038', alt: '#343945', accent: '#20242c' },
    sky: { top: '#080b18', bottom: '#2a1e48', horizon: '#54307a', sun: '#b06aff', sunIntensity: 0.35, hemiSky: '#3c3060', hemiGround: '#181420' },
    fog: { color: '#181228', near: 55, far: 300 },
    decos: [
      { type: 'building', density: 1.15 }, { type: 'building', density: 0.8 }, { type: 'neonSign', density: 0.7 },
      { type: 'lamp', density: 0.85 }, { type: 'billboard', density: 0.35 }, { type: 'wreckCar', density: 0.28 },
      { type: 'barrier', density: 0.3 }, { type: 'cone', density: 0.4 }, { type: 'tireStack', density: 0.2 },
    ],
    mountains: '#241d38',
    hazard: 'none', ambience: 'sparks', jumpGap: false,
  },
  {
    // v1.11 NEW MAP (user: "میخوام شهر ماینکرفتی با تکنولوژی بالا باشه داداش
    // داخل مپ‌ها"): BLOCKTECH CITY — a Minecraft-style high-tech metropolis at
    // night. Chunky grass-block terrain, dense blocky towers, redstone-red /
    // emerald-green / diamond-cyan neon identity, glowing redstone lamps and
    // pixel-sign billboards everywhere.
    id: 'mccity', name: 'BlockTech City',
    night: true,
    neon: ['#54ff6a', '#ff4a4a', '#5ad0ff'],
    road: { base: '#454b57', edge: '#31363f', curbA: '#54e05e', curbB: '#1f2a20', line: '#a8ffb0' },
    ground: { base: '#5d8c46', alt: '#6d9c52', accent: '#4a7c3a' },
    sky: { top: '#0a1216', bottom: '#14323a', horizon: '#1f4a4a', sun: '#7fffd0', sunIntensity: 0.4, hemiSky: '#2a5450', hemiGround: '#152418' },
    fog: { color: '#122028', near: 50, far: 270 },
    decos: [
      { type: 'building', density: 1.0 }, { type: 'building', density: 0.7 }, { type: 'neonSign', density: 0.6 },
      { type: 'lamp', density: 0.8 }, { type: 'billboard', density: 0.4 }, { type: 'crate', density: 0.3 },
      { type: 'treeRound', density: 0.3 }, { type: 'glowMushroom', density: 0.35 }, { type: 'barrier', density: 0.2 },
    ],
    mountains: '#1c3020',
    hazard: 'none', ambience: 'sparks', jumpGap: false,
  },
  {
    id: 'ruins', name: 'Forgotten Ruins',
    road: { base: '#a89878', edge: '#8c7c5e', curbA: '#c9a227', curbB: '#e8dcc0', line: '#e8dcc0' },
    ground: { base: '#a89468', alt: '#b8a478', accent: '#8c7c50' },
    sky: { top: '#c88a4e', bottom: '#f0c890', horizon: '#f8e0b0', sun: '#fff0c8', sunIntensity: 1.15, hemiSky: '#f0d8b0', hemiGround: '#a08c5c' },
    fog: { color: '#e8cc9a', near: 55, far: 250 },
    water: null,
    decos: [
      { type: 'ruinColumn', density: 0.8 }, { type: 'brokenArch', density: 0.3 }, { type: 'statue', density: 0.3 },
      { type: 'palm', density: 0.3 }, { type: 'rock', density: 0.5 }, { type: 'vineTree', density: 0.4 },
    ],
    mountains: '#a8825a', mountainSnow: '#e8d8b0',
    hazard: 'ghost', ambience: 'dust', jumpGap: false,
  },
  {
    id: 'jungle', name: 'Wild Canopy',
    road: { base: '#5d6b46', edge: '#4a5538', curbA: '#f7a021', curbB: '#e8f4d8', line: '#e8f4d8' },
    ground: { base: '#4a7c3a', alt: '#5d9448', accent: '#37652a' },
    sky: { top: '#2fa07a', bottom: '#a8e0c8', horizon: '#c8f0dc', sun: '#fff8e0', sunIntensity: 1.1, hemiSky: '#b2e0c8', hemiGround: '#3d6a2e' },
    fog: { color: '#9ad4b8', near: 45, far: 240 },
    water: { level: -2.8, deep: '#1a6a4a', shallow: '#3aa87a' },
    decos: [
      { type: 'vineTree', density: 1.0 }, { type: 'tiki', density: 0.4 }, { type: 'bush', density: 0.8 },
      { type: 'flower', density: 0.5 }, { type: 'rock', density: 0.3 }, { type: 'tallPalm', density: 0.4 },
    ],
    mountains: '#3d6a3a', mountainSnow: '#a8d8b8',
    hazard: 'boulder', ambience: 'leaves', jumpGap: false,
  },
  {
    // v2.0 NEW WORLD — MEGA RAMP (user reference: stunt ramps floating in the
    // sky over the sea, red/white kerbs, checkered flags). POINT-TO-POINT:
    // one start, one finish, never connected.
    id: 'megaramp', name: 'Mega Ramp',
    road: { base: '#4b505b', edge: '#383d46', curbA: '#e53935', curbB: '#f5f5f5', line: '#f5f5f5' },
    ground: { base: '#5a7fa8', alt: '#6a8fb8', accent: '#48698c' },
    sky: { top: '#2f86e0', bottom: '#b9e2ff', horizon: '#eaf7ff', sun: '#fff6e0', sunIntensity: 1.25, hemiSky: '#cfe8ff', hemiGround: '#4a78a8' },
    fog: { color: '#cde9ff', near: 120, far: 520 },
    water: { level: -3.4, deep: '#0b5aa3', shallow: '#43b6ea' },
    decos: [{ type: 'cloud', density: 1 }],
    mountains: '#7fa8d0', mountainSnow: '#ffffff',
    hazard: 'none', ambience: 'none', jumpGap: false,
  },
  // ================= v3.3 PREMIUM MAPS (gems / VIP) =================
  {
    // 🍭 CANDY KINGDOM — kids' dream: pink juice sea, lollipops, cupcakes
    id: 'candy', name: 'Candy Kingdom',
    road: { base: '#b07aa8', edge: '#94608c', curbA: '#ff3f8e', curbB: '#ffffff', line: '#fff4fb' },
    ground: { base: '#8fe3b8', alt: '#a8f0c8', accent: '#6fd4a0' },
    sky: { top: '#ff8fd0', bottom: '#ffd6f0', horizon: '#fff0fa', sun: '#fff6e6', sunIntensity: 1.2, hemiSky: '#ffd0ee', hemiGround: '#8fd8b0' },
    fog: { color: '#ffd9f0', near: 70, far: 300 },
    water: { level: -2.8, deep: '#e0368a', shallow: '#ff9fd0' },
    decos: [
      { type: 'lollipop', density: 0.8 }, { type: 'candyCane', density: 0.6 }, { type: 'cupcake', density: 0.45 },
      { type: 'gumdrop', density: 0.9 }, { type: 'cloud', density: 0.3 }, { type: 'flower', density: 0.4 },
    ],
    mountains: '#ff9ad5', mountainSnow: '#ffffff',
    hazard: 'none', ambience: 'none', jumpGap: true,
  },
  {
    // 🌌 STAR GALAXY — neon space highway under a purple nebula
    id: 'galaxy', name: 'Star Galaxy',
    night: true,
    neon: ['#00f0ff', '#b400ff', '#ff3df0'],
    road: { base: '#2a2146', edge: '#1c1633', curbA: '#00f0ff', curbB: '#b400ff', line: '#e6d6ff' },
    ground: { base: '#1c1238', alt: '#241846', accent: '#140c2a' },
    sky: { top: '#03020c', bottom: '#2a0f5c', horizon: '#5a1f9a', sun: '#c89bff', sunIntensity: 0.45, hemiSky: '#4a2f80', hemiGround: '#120a24' },
    fog: { color: '#170c30', near: 60, far: 320 },
    water: null,
    decos: [
      { type: 'starPillar', density: 0.8 }, { type: 'ufo', density: 0.12 }, { type: 'planetRock', density: 0.6 },
      { type: 'crystalCluster', density: 0.7 }, { type: 'glowMushroom', density: 0.4 },
    ],
    mountains: '#241a48',
    hazard: 'none', ambience: 'sparks', jumpGap: true,
  },
  {
    // 🐉 DRAGON TEMPLE — red pagodas, golden lanterns, a river of lava
    id: 'dragon', name: 'Dragon Temple',
    road: { base: '#4a3230', edge: '#352422', curbA: '#e01818', curbB: '#ffc02e', line: '#ffd84a' },
    ground: { base: '#3e2a26', alt: '#4a322c', accent: '#2c1e1a' },
    sky: { top: '#3a0a10', bottom: '#d04a1c', horizon: '#ff8a2a', sun: '#ffc078', sunIntensity: 1.0, hemiSky: '#c85a3a', hemiGround: '#2c1c18' },
    fog: { color: '#b0401c', near: 55, far: 250 },
    lava: { level: -1.8 },
    decos: [
      { type: 'pagoda', density: 0.35 }, { type: 'dragonStatue', density: 0.3 }, { type: 'goldLantern', density: 0.7 },
      { type: 'volcanoRock', density: 0.5 }, { type: 'obsidian', density: 0.3 },
    ],
    mountains: '#5a1a14', mountainSnow: '#ff6a2a',
    hazard: 'geyser', ambience: 'embers', jumpGap: false,
  },
  {
    // 👑 ROYAL GOLD CITY — VIP-only night boulevard of gold towers
    id: 'royal', name: 'Royal Gold City',
    night: true,
    neon: ['#ffd24a', '#ff7a18', '#fff4d0'],
    road: { base: '#2c2a30', edge: '#1e1c22', curbA: '#ffc62e', curbB: '#141214', line: '#ffe9a8' },
    ground: { base: '#26221e', alt: '#2e2a24', accent: '#1a1714' },
    sky: { top: '#07060a', bottom: '#2e2012', horizon: '#6a4a1a', sun: '#ffd27a', sunIntensity: 0.45, hemiSky: '#5a4424', hemiGround: '#16120e' },
    fog: { color: '#1c150c', near: 55, far: 300 },
    decos: [
      { type: 'goldTower', density: 1.0 }, { type: 'building', density: 0.5 }, { type: 'crownStatue', density: 0.3 },
      { type: 'lamp', density: 0.8 }, { type: 'tallPalm', density: 0.3 }, { type: 'neonSign', density: 0.4 },
    ],
    mountains: '#221a10',
    hazard: 'none', ambience: 'sparks', jumpGap: false,
  },
];

export const themeById = (id: string): ThemeDef => THEMES.find(t => t.id === id) ?? THEMES[0];
