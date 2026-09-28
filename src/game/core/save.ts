// KUBO KARTS - Save system: versioned localStorage with checksum + backup slot + export/import

export interface CarCustom {
  paint: string;        // primary color hex
  paint2: string;       // secondary
  wheelStyle: number;
  wheelColor: string;
  spoiler: number;      // -1 none, else style idx
  decal: number;
  exhaust: number;
  boostColor: string;
  glow: string;         // emissive accent or ''
  upgrade: number;      // legacy total stage 0..3 (kept for migration)
  upgrades?: {          // WORKSHOP: per-part tuning 0..5 each (garage update)
    engine: number; turbo: number; tires: number; drift: number; armor: number;
  };
}

export interface LevelRecord { stars: number; best: number; done: boolean; }

export interface Settings {
  graphics: 'low' | 'medium' | 'high' | 'ultra';
  master: number; music: number; sfx: number;
  vibration: boolean;
  steerSens: number;        // 0.6..1.6
  steerMode: 'wheel' | 'buttons' | 'tilt';
  showFps: boolean;
  lang: 'en' | 'fa';
  mirrorSteer: boolean;
  autoGas: boolean;         // auto-accelerate (mobile friendly)
  wheelSize: number;        // steering wheel visual scale 0.8..1.3
  camera: 'chase' | 'fp';   // v1.8: first-person head-cam option
  itemsOn: boolean;         // v1.8: power-ups can be disabled from the menu
  /** v1.10 HUD LAYOUT EDITOR (user: "بتونه خودش تمام دکمه‌ها و چینش‌های داخل
   *  صفحه انجام بده… و بتونه بزرگ و کوچیک کنه"): per-group position offset
   *  (fractions of the viewport) + scale. Optional — empty = default layout. */
  hudLayout?: Record<string, { dx: number; dy: number; s: number }>;
  /** v1.22 HUD PRESET (user: "یه نسخه دیگه درست کنی که ساده باشه … به طور
   *  دیفالت اون باشه و بشه انتخاب کرد یکی از اون دو نسخه"): the SIMPLE preset
   *  packs the HUD tighter (speedometer under the item slots, smaller minimap,
   *  bigger pedals) and is the DEFAULT for every save. */
  hudPreset?: 'simple' | 'normal';
  /** v3 POWER-UPS PER MODE (user: "بشه خاموش کرد قدرت‌ها رو … برای بخش‌ها جز
   *  حالت چند نفره"): master switch for CAREER and QUICK RACE separately, plus
   *  individual power-ups the player switched OFF (single-player only). */
  itemsCareer?: boolean;
  itemsQuick?: boolean;
  itemsOff?: string[];
  /** v3.1: 'mystery' = yellow ? boxes (random), 'placed' = real items on the road */
  itemMode?: 'mystery' | 'placed';
}

export interface SaveData {
  version: number;
  name: string;
  xp: number;
  coins: number;
  gems: number;
  parts: number;
  selectedCar: string;
  selectedChar: string;
  ownedCars: string[];
  ownedChars: string[];
  ownedTrails: string[];
  custom: Record<string, CarCustom>;
  levels: Record<string, LevelRecord>;
  daily: { lastClaim: string; streak: number };
  challenges: { date: string; tasks: { id: string; p: number; claimed: boolean }[] };
  shopOffers: { date: string; items: string[] };
  stats: { races: number; wins: number; drifts: number; coins: number; items: number; playMs: number; mpWins: number };
  settings: Settings;
  tutorialDone: boolean;
  seenNews: string;
  /** v3: claimed achievement ids + real-money purchase log (store.ts) */
  achClaimed?: string[];
  purchases?: string[];
  /** v3.3: VIP pass expiry (epoch ms). While active: every car + every map */
  vipUntil?: number;
  /** v3.3: premium maps bought forever (gems) */
  ownedMaps?: string[];
  /** v3.3: daily challenge extras (bonus chest claimed / free reroll used — date keys) */
  chBonus?: string;
  chReroll?: string;
  /** v3.3: VIP daily gem drop claimed (date key) */
  vipDaily?: string;
  /** v3.3: first time the limited starter offer was seen (epoch ms) */
  offerSeen?: number;
  /** v3.5: season star chests opened on the map screen (keys like 's0_2') */
  seasonChests?: string[];
}

const KEY = 'kubokarts.save.v1';
const KEY_BAK = 'kubokarts.save.v1.bak';
export const SAVE_VERSION = 1;

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    name: 'Player_01',
    xp: 0,
    coins: 500,
    gems: 25,
    parts: 0,
    selectedCar: 'kart_start',
    selectedChar: 'bolt',
    ownedCars: ['kart_start'],
    ownedChars: ['bolt', 'pip'],
    ownedTrails: ['trail_basic'],
    custom: {},
    levels: {},
    daily: { lastClaim: '', streak: 0 },
    challenges: { date: '', tasks: [] },
    shopOffers: { date: '', items: [] },
    stats: { races: 0, wins: 0, drifts: 0, coins: 0, items: 0, playMs: 0, mpWins: 0 },
    settings: {
      graphics: 'high', master: 0.9, music: 0.5, sfx: 1.0,
      vibration: true, steerSens: 1.0, steerMode: 'wheel', showFps: false,
      lang: 'fa', mirrorSteer: false, autoGas: false, wheelSize: 1.0,
      camera: 'chase', itemsOn: true,
      hudPreset: 'simple',
    },
    tutorialDone: false,
    seenNews: '',
  };
}

function checksum(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) | 0; }
  return (h >>> 0).toString(36);
}

export function loadSave(): SaveData {
  const tryParse = (raw: string | null): SaveData | null => {
    if (!raw) return null;
    const sep = raw.lastIndexOf('|');
    if (sep < 0) return null;
    const body = raw.slice(0, sep), sum = raw.slice(sep + 1);
    if (checksum(body) !== sum) return null;
    try {
      const data = JSON.parse(body) as SaveData;
      if (!data || typeof data !== 'object' || !data.version) return null;
      return migrate(data);
    } catch { return null; }
  };
  let data = tryParse(localStorage.getItem(KEY));
  if (!data) {
    data = tryParse(localStorage.getItem(KEY_BAK));
    if (data) { writeSave(data); return data; } // restore from backup
  }
  if (!data) { data = defaultSave(); writeSave(data); }
  return data;
}

function migrate(d: SaveData): SaveData {
  const def = defaultSave();
  // merge missing fields from default (forward-compat)
  const out = { ...def, ...d } as SaveData;
  out.settings = { ...def.settings, ...(d.settings || {}) };
  out.stats = { ...def.stats, ...(d.stats || {}) };
  out.version = SAVE_VERSION;
  // workshop migration: cars that had the legacy single upgrade stage get the
  // same amount of points spread across engine+turbo so nothing is lost
  for (const id of Object.keys(out.custom)) {
    const c = out.custom[id];
    if (!c.upgrades) {
      const eng = Math.min(5, (c.upgrade ?? 0) + 1);
      c.upgrades = { engine: eng, turbo: Math.min(5, c.upgrade ?? 0), tires: 0, drift: 0, armor: 0 };
    }
  }
  return out;
}

let lastWrite = 0;
export function writeSave(data: SaveData) {
  try {
    const prev = localStorage.getItem(KEY);
    if (prev) localStorage.setItem(KEY_BAK, prev); // rotate old -> backup
    const body = JSON.stringify(data);
    localStorage.setItem(KEY, body + '|' + checksum(body));
    lastWrite = Date.now();
  } catch { /* storage full/blocked */ }
}

export function sinceWrite() { return Date.now() - lastWrite; }

export function exportSave(data: SaveData): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(data))));
}

export function importSave(code: string): SaveData | null {
  try {
    const json = decodeURIComponent(escape(atob(code.trim())));
    const data = JSON.parse(json) as SaveData;
    if (!data.version) return null;
    return migrate(data);
  } catch { return null; }
}

export function wipeSave() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(KEY_BAK);
}
