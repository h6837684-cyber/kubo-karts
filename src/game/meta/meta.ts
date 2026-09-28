// KUBO KARTS - Meta game: XP/levels, economy, unlocks, upgrades, daily rewards,
// challenges, shop offers. Single source of truth mutating SaveData.
import type { SaveData } from '../core/save';
import { writeSave, defaultSave } from '../core/save';
import { CARS, carById, upgradeCost } from '../data/cars';
import { CHARACTERS, charById } from '../data/characters';
import { LEVELS, type LevelDef } from '../race/levels';
import { fmtTime } from '../core/utils';

/** v3.4 premium maps: gem price (0 = VIP-only). Psychology: 299 / 399 / 499 is
 *  a clean good-better-best ladder; the VIP-only gold city is the aspiration. */
export const PREMIUM_MAPS: Record<string, number> = { candy: 299, galaxy: 399, dragon: 499, royal: 0 };
export const VIP_DAILY_GEMS = 30;

export function xpForLevel(level: number): number {
  return Math.round(120 * Math.pow(level, 1.42));
}

export function levelFromXp(xp: number): { level: number; cur: number; need: number } {
  let level = 1;
  let acc = 0;
  while (level < 99) {
    const need = xpForLevel(level);
    if (xp < acc + need) return { level, cur: Math.floor(xp - acc), need };
    acc += need;
    level++;
  }
  return { level: 99, cur: 0, need: 1 };
}

export class Meta {
  constructor(public data: SaveData) {}

  save() { writeSave(this.data); }

  // ---------- profile ----------
  get levelInfo() { return levelFromXp(this.data.xp); }
  addXp(xp: number) { this.data.xp += Math.max(0, Math.round(xp)); }
  addCoins(c: number) { this.data.coins = Math.max(0, this.data.coins + Math.round(c)); }
  addGems(g: number) { this.data.gems = Math.max(0, this.data.gems + g); }
  addParts(p: number) { this.data.parts = Math.max(0, this.data.parts + p); }

  // ---------- v3.4 VIP PASS + PREMIUM MAPS + LEGEND PACK ----------
  /** VIP active right now? (vipUntil = epoch ms, set by the toman store) */
  isVip(): boolean { return (this.data.vipUntil ?? 0) > Date.now(); }
  /** whole days of VIP left (0 when inactive) */
  vipDaysLeft(): number { return this.isVip() ? Math.ceil(((this.data.vipUntil ?? 0) - Date.now()) / 86400000) : 0; }
  /** extend (or start) the pass — stacking a new pass adds on top */
  grantVip(days: number) {
    const from = Math.max(Date.now(), this.data.vipUntil ?? 0);
    this.data.vipUntil = from + days * 86400000;
    this.save();
  }
  /** VIP daily gem drop (claim once a day while active) */
  canClaimVipDaily(): boolean { return this.isVip() && this.data.vipDaily !== this.todayKey(); }
  claimVipDaily(): number {
    if (!this.canClaimVipDaily()) return 0;
    this.data.vipDaily = this.todayKey();
    this.addGems(VIP_DAILY_GEMS);
    this.save();
    return VIP_DAILY_GEMS;
  }
  /** VIP doubles race coins */
  coinMul(): number { return this.isVip() ? 2 : 1; }
  /** can the player DRIVE this car (bought forever, or VIP car + active pass)? */
  canDrive(id: string): boolean {
    if (this.ownsCar(id)) return true;
    const def = carById(id);
    return !!def.vip && this.isVip();
  }
  /** premium map access: bought forever, VIP (all maps) — royal is VIP-only */
  isMapPremium(themeId: string): boolean { return themeId in PREMIUM_MAPS; }
  ownsMap(themeId: string): boolean {
    if (!this.isMapPremium(themeId)) return true;
    if (this.isVip()) return true;
    return (this.data.ownedMaps ?? []).includes(themeId);
  }
  mapGemPrice(themeId: string): number { return PREMIUM_MAPS[themeId] ?? 0; }
  buyMap(themeId: string): boolean {
    const price = this.mapGemPrice(themeId);
    if (!price || (this.data.ownedMaps ?? []).includes(themeId) || this.data.gems < price) return false;
    this.data.gems -= price;
    (this.data.ownedMaps ??= []).push(themeId);
    this.save();
    return true;
  }
  /** LEGEND PACK: every "classic" premium car (all A-tier) + the 3 gem maps, forever */
  grantLegendPack() {
    for (const c of CARS) {
      if (c.vip || (c.tier ?? '') !== 'A' || this.ownsCar(c.id)) continue;
      this.data.ownedCars.push(c.id);
      this.data.custom[c.id] = defaultCustom(c.bodyColor, c.accentColor);
    }
    for (const m of Object.keys(PREMIUM_MAPS)) if (PREMIUM_MAPS[m] > 0 && !(this.data.ownedMaps ?? []).includes(m)) (this.data.ownedMaps ??= []).push(m);
    this.save();
  }
  /** a VIP car stays selected only while the pass runs — fall back safely */
  validateSelection() {
    if (!this.canDrive(this.data.selectedCar)) {
      const best = this.data.ownedCars.includes('kart_start') ? 'kart_start' : this.data.ownedCars[0];
      if (best) { this.data.selectedCar = best; this.save(); }
    }
  }

  // ---------- cars & characters ----------
  ownsCar(id: string) { return this.data.ownedCars.includes(id); }
  ownsChar(id: string) { return this.data.ownedChars.includes(id); }
  canBuyCar(id: string): { ok: boolean; reason: string } {
    const def = carById(id);
    if (this.ownsCar(id)) return { ok: false, reason: 'owned' };
    const lvl = this.levelInfo.level;
    void lvl;   // v3.2: cars are no longer level-locked — they are SOLD
    if (def.vip) return { ok: false, reason: 'vipOnly' };
    if (def.gemOnly) return this.data.gems >= (def.gemPrice ?? 0) ? { ok: true, reason: '' } : { ok: false, reason: 'notEnough' };
    if (def.gemPrice && this.data.gems < def.gemPrice && this.data.coins < def.price) return { ok: false, reason: 'notEnough' };
    if (!def.gemPrice && this.data.coins < def.price) return { ok: false, reason: 'notEnough' };
    return { ok: true, reason: '' };
  }
  buyCar(id: string): boolean {
    const def = carById(id);
    if (!this.canBuyCar(id).ok) return false;
    if (def.gemOnly || (def.gemPrice && this.data.coins < def.price && this.data.gems >= def.gemPrice)) this.data.gems -= def.gemPrice ?? 0;
    else this.data.coins -= def.price;
    this.data.ownedCars.push(id);
    this.data.custom[id] = defaultCustom(def.bodyColor, def.accentColor);
    this.save();
    return true;
  }
  canBuyChar(id: string): { ok: boolean; reason: string } {
    const def = charById(id);
    if (this.ownsChar(id)) return { ok: false, reason: 'owned' };
    const lvl = this.levelInfo.level;
    if (lvl < def.reqLevel) return { ok: false, reason: `unlockLevelN:${def.reqLevel}` };
    if (def.gemPrice && this.data.gems >= def.gemPrice) return { ok: true, reason: '' };
    if (this.data.coins < def.price && !def.gemPrice) return { ok: false, reason: 'notEnough' };
    if (def.gemPrice && this.data.coins < def.price && this.data.gems < def.gemPrice) return { ok: false, reason: 'notEnough' };
    return { ok: true, reason: '' };
  }
  buyChar(id: string): boolean {
    const def = charById(id);
    if (!this.canBuyChar(id).ok) return false;
    if (def.gemPrice && this.data.gems >= def.gemPrice && this.data.coins < def.price) this.data.gems -= def.gemPrice;
    else this.data.coins -= def.price;
    this.data.ownedChars.push(id);
    this.save();
    return true;
  }

  customFor(carId: string): import('../core/save').CarCustom {
    const def = carById(carId);
    if (!this.data.custom[carId]) this.data.custom[carId] = defaultCustom(def.bodyColor, def.accentColor);
    return this.data.custom[carId];
  }

  // ---------- upgrades (legacy single stage, kept for compatibility) ----------
  upgradeCar(carId: string): boolean {
    const c = this.customFor(carId);
    if (c.upgrade >= 3) return false;
    const cost = upgradeCost(c.upgrade);
    const partCost = 2 + c.upgrade * 3;
    if (this.data.coins < cost || this.data.parts < partCost) return false;
    this.data.coins -= cost;
    this.data.parts -= partCost;
    c.upgrade++;
    this.save();
    return true;
  }
  upgradePreview(carId: string): { cost: number; parts: number } {
    const c = this.customFor(carId);
    return { cost: upgradeCost(c.upgrade), parts: 2 + c.upgrade * 3 };
  }

  // ---------- WORKSHOP (big garage update): 5 tuning tracks x 5 levels ----------
  static WORKSHOP_MAX = 5;
  static TRACKS = ['engine', 'turbo', 'tires', 'drift', 'armor'] as const;

  static tuneCost(track: string, lvl: number): { coins: number; parts: number } {
    const coins = [600, 1400, 3000, 5600, 9500][lvl] ?? 0;
    const parts = [2, 4, 7, 11, 16][lvl] ?? 0;
    void track;
    return { coins, parts };
  }

  upgradesOf(carId: string): { engine: number; turbo: number; tires: number; drift: number; armor: number } {
    const c = this.customFor(carId);
    if (!c.upgrades) c.upgrades = { engine: 0, turbo: 0, tires: 0, drift: 0, armor: 0 };
    return c.upgrades;
  }

  buildLevel(carId: string): number {
    const u = this.upgradesOf(carId);
    return u.engine + u.turbo + u.tires + u.drift + u.armor;
  }

  canTune(carId: string, track: string): boolean {
    const u = this.upgradesOf(carId);
    const lvl = (u as unknown as Record<string, number>)[track] ?? 0;
    if (lvl >= Meta.WORKSHOP_MAX) return false;
    const cost = Meta.tuneCost(track, lvl);
    return this.data.coins >= cost.coins && this.data.parts >= cost.parts;
  }

  tuneCar(carId: string, track: string): boolean {
    if (!this.canTune(carId, track)) return false;
    const u = this.upgradesOf(carId);
    const lvl = (u as unknown as Record<string, number>)[track] ?? 0;
    const cost = Meta.tuneCost(track, lvl);
    this.data.coins -= cost.coins;
    this.data.parts -= cost.parts;
    (u as unknown as Record<string, number>)[track] = lvl + 1;
    this.save();
    return true;
  }

  /** effective stats incl. WORKSHOP tuning (drives the garage stat bars) */
  effStats(carId: string) {
    const def = carById(carId);
    const c = this.customFor(carId);
    const u = this.upgradesOf(carId);
    const full = u.engine + u.turbo + u.tires + u.drift + u.armor >= 25 ? 0.4 : 0;
    return {
      speed: Math.min(10, def.stats.speed + u.engine * 0.5 + full),
      accel: Math.min(10, def.stats.accel + u.engine * 0.25 + u.tires * 0.2 + full),
      handling: Math.min(10, def.stats.handling + u.tires * 0.5 + full),
      drift: Math.min(10, def.stats.drift + u.drift * 0.5 + full),
      weight: def.stats.weight,
      boost: Math.min(10, def.stats.boost + u.turbo * 0.55 + full),
      defense: Math.min(10, def.stats.defense + u.armor * 0.55),
    };
  }

  // ---------- levels ----------
  levelRecord(id: number) { return this.data.levels[String(id)] ?? { stars: 0, best: 0, done: false }; }
  isLevelUnlocked(id: number): boolean {
    if (id <= 1) return true;
    // v3.2 BUGFIX (screenshot: stage 3 empty, stage 4 locked, stage 5 open):
    // a stage is open when the previous one is cleared, when it already has a
    // record itself, or when ANY later stage was already cleared (old saves).
    const L = this.data.levels;
    if ((L[String(id - 1)]?.stars ?? 0) > 0 || L[String(id - 1)]?.done) return true;
    if ((L[String(id)]?.stars ?? 0) > 0) return true;
    for (const k of Object.keys(L)) if (+k > id && (L[k]?.stars ?? 0) > 0) return true;
    return false;
  }
  completeLevel(lv: LevelDef, stars: number, timeMs: number): { newRecord: boolean; firstClear: boolean } {
    const rec = this.levelRecord(lv.id);
    const firstClear = rec.stars === 0;
    const newRecord = rec.best === 0 || timeMs < rec.best;
    this.data.levels[String(lv.id)] = {
      stars: Math.max(rec.stars, stars),
      best: newRecord ? timeMs : rec.best,
      done: true,
    };
    this.save();
    return { newRecord, firstClear };
  }
  totalStars(): number {
    let n = 0;
    for (const k of Object.keys(this.data.levels)) n += this.data.levels[k].stars;
    return n;
  }
  nextLevel(): LevelDef | null {
    for (const lv of LEVELS) if ((this.data.levels[String(lv.id)]?.stars ?? 0) === 0 && this.isLevelUnlocked(lv.id)) return lv;
    return null;
  }

  // ---------- daily rewards ----------
  todayKey(): string { return new Date().toISOString().slice(0, 10); }
  canClaimDaily(): boolean { return this.data.daily.lastClaim !== this.todayKey(); }
  dailyDayIndex(): number {
    // streak day 1..7
    const streak = this.data.daily.streak;
    return ((streak % 7) + 7) % 7;
  }
  claimDaily(): { day: number; reward: { type: string; amount: number; label: string } } | null {
    if (!this.canClaimDaily()) return null;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (this.data.daily.lastClaim !== yesterday) this.data.daily.streak = 0;
    const day = (this.data.daily.streak % 7);
    const REWARDS = [
      { type: 'coins', amount: 300, label: '300 Coins' },
      { type: 'parts', amount: 3, label: '3 Parts' },
      { type: 'coins', amount: 600, label: '600 Coins' },
      { type: 'gems', amount: 10, label: '10 Gems' },
      { type: 'parts', amount: 6, label: '6 Parts' },
      { type: 'gems', amount: 20, label: '20 Gems' },
      { type: 'big', amount: 1500, label: '1,500 Coins + 15 Gems' },
    ];
    const reward = REWARDS[day];
    if (reward.type === 'coins') this.addCoins(reward.amount);
    if (reward.type === 'parts') this.addParts(reward.amount);
    if (reward.type === 'gems') this.addGems(reward.amount);
    if (reward.type === 'big') { this.addCoins(1500); this.addGems(15); }
    this.data.daily.streak++;
    this.data.daily.lastClaim = this.todayKey();
    this.save();
    return { day, reward };
  }

  // ---------- challenges (v3.5 redesign) ----------
  // user: "چالش‌های روزانه بهتر". Every day = 3 tasks: one EASY, one MEDIUM,
  // one HARD (hard pays gems). Finishing all 3 opens a BONUS CHEST, and one
  // free REROLL a day swaps a task you don't like. Psychology: an easy first
  // win (instant dopamine), a clear ladder, and a "complete the set" chest so
  // kids come back to finish the last one.
  static CH_TIERS: Record<'easy' | 'medium' | 'hard', string[]> = {
    easy: ['ch_race2', 'ch_items5', 'ch_drift20', 'ch_podium1', 'ch_overtake5'],
    medium: ['ch_win1', 'ch_jump10', 'ch_coins50', 'ch_event2', 'ch_overtake15', 'ch_stars2'],
    hard: ['ch_win3', 'ch_goal3', 'ch_event5', 'ch_drift60', 'ch_overtake30'],
  };
  static CH_BONUS = { gems: 10, coins: 800 };
  challengeTier(id: string): 'easy' | 'medium' | 'hard' {
    for (const k of ['easy', 'medium', 'hard'] as const) if (Meta.CH_TIERS[k].includes(id)) return k;
    return 'easy';
  }
  ensureChallenges() {
    const today = this.todayKey();
    const known = (id: string) => Object.values(Meta.CH_TIERS).some(l => l.includes(id));
    // new day, or an old save still holding the pre-v3.5 random pool -> fresh set
    if (this.data.challenges.date !== today || this.data.challenges.tasks.length !== 3
      || this.data.challenges.tasks.some(x => !known(x.id))) {
      if (this.data.challenges.date === today && this.data.challenges.tasks.some(x => x.claimed)) {
        // same day, old save with claimed tasks: keep them (never take a reward back)
        if (this.data.challenges.tasks.every(x => known(x.id))) return;
      }
      const pick = (l: string[]) => l[Math.floor(Math.random() * l.length)];
      this.data.challenges = {
        date: today,
        tasks: (['easy', 'medium', 'hard'] as const).map(k => ({ id: pick(Meta.CH_TIERS[k]), p: 0, claimed: false })),
      };
      this.save();
    }
  }
  challengeGoal(id: string): number {
    const goals: Record<string, number> = {
      ch_race2: 2, ch_items5: 5, ch_drift20: 20, ch_podium1: 1, ch_overtake5: 5,
      ch_win1: 1, ch_jump10: 10, ch_coins50: 750, ch_event2: 2, ch_overtake15: 15, ch_stars2: 2,
      ch_win3: 3, ch_goal3: 3, ch_event5: 5, ch_drift60: 60, ch_overtake30: 30, ch_mp1: 1,
    };
    return goals[id] ?? 1;
  }
  challengeReward(id: string): { coins: number; xp: number; gems: number; parts: number } {
    const tier = this.challengeTier(id);
    const m = this.coinMul();   // VIP doubles challenge coins too
    if (tier === 'hard') return { coins: 800 * m, xp: 180, gems: 8, parts: 0 };
    if (tier === 'medium') return { coins: 500 * m, xp: 110, gems: 0, parts: 3 };
    return { coins: 300 * m, xp: 60, gems: 0, parts: 0 };
  }
  progressChallenge(id: string, amount: number) {
    if (amount <= 0) return;
    this.ensureChallenges();
    const task = this.data.challenges.tasks.find(t2 => t2.id === id);
    if (task && !task.claimed) {
      task.p = Math.min(this.challengeGoal(id), task.p + amount);
      this.save();
    }
  }
  claimChallenge(id: string): boolean {
    this.ensureChallenges();
    const task = this.data.challenges.tasks.find(t2 => t2.id === id);
    if (task && task.p >= this.challengeGoal(id) && !task.claimed) {
      task.claimed = true;
      const r = this.challengeReward(id);
      this.addCoins(r.coins);
      this.addXp(r.xp);
      if (r.gems) this.addGems(r.gems);
      if (r.parts) this.addParts(r.parts);
      this.save();
      return true;
    }
    return false;
  }
  /** all 3 of today's tasks claimed -> the bonus chest opens (once a day) */
  canClaimChBonus(): boolean {
    this.ensureChallenges();
    return this.data.challenges.tasks.every(x => x.claimed) && this.data.chBonus !== this.todayKey();
  }
  chBonusClaimed(): boolean { return this.data.chBonus === this.todayKey(); }
  claimChBonus(): boolean {
    if (!this.canClaimChBonus()) return false;
    this.data.chBonus = this.todayKey();
    this.addGems(Meta.CH_BONUS.gems);
    this.addCoins(Meta.CH_BONUS.coins * this.coinMul());
    this.save();
    return true;
  }
  /** one free reroll a day: swap an unfinished task for another of the same tier */
  canReroll(): boolean { return this.data.chReroll !== this.todayKey(); }
  rerollChallenge(id: string): boolean {
    this.ensureChallenges();
    if (!this.canReroll()) return false;
    const i = this.data.challenges.tasks.findIndex(x => x.id === id);
    if (i < 0) return false;
    const task = this.data.challenges.tasks[i];
    if (task.claimed || task.p >= this.challengeGoal(id)) return false;
    const taken = this.data.challenges.tasks.map(x => x.id);
    const pool = Meta.CH_TIERS[this.challengeTier(id)].filter(x => !taken.includes(x));
    if (!pool.length) return false;
    this.data.challenges.tasks[i] = { id: pool[Math.floor(Math.random() * pool.length)], p: 0, claimed: false };
    this.data.chReroll = this.todayKey();
    this.save();
    return true;
  }
  /** unclaimed-but-finished tasks + bonus chest (menu badge) */
  challengesReady(): number {
    this.ensureChallenges();
    return this.data.challenges.tasks.filter(x => !x.claimed && x.p >= this.challengeGoal(x.id)).length + (this.canClaimChBonus() ? 1 : 0);
  }

  // ---------- v3.5 SEASON CHESTS (map screen) ----------
  // 3 chests per season at 1/3, 2/3 and ALL stars. Gives every star a visible
  // purpose ("2 more stars to the gem chest!") — the classic goal-gradient hook.
  static SEASON_CHESTS = [
    { frac: 1 / 3, coins: 1000, gems: 0, parts: 5 },
    { frac: 2 / 3, coins: 1500, gems: 15, parts: 0 },
    { frac: 1, coins: 2500, gems: 40, parts: 15 },
  ];
  seasonStars(levels: LevelDef[]): { got: number; max: number } {
    return { got: levels.reduce((a, l) => a + this.levelRecord(l.id).stars, 0), max: levels.length * 3 };
  }
  chestNeed(levels: LevelDef[], k: number): number {
    return Math.ceil(levels.length * 3 * Meta.SEASON_CHESTS[k].frac);
  }
  chestState(seasonIdx: number, levels: LevelDef[], k: number): 'locked' | 'ready' | 'open' {
    if ((this.data.seasonChests ?? []).includes(`s${seasonIdx}_${k}`)) return 'open';
    return this.seasonStars(levels).got >= this.chestNeed(levels, k) ? 'ready' : 'locked';
  }
  claimChest(seasonIdx: number, levels: LevelDef[], k: number): boolean {
    if (this.chestState(seasonIdx, levels, k) !== 'ready') return false;
    const c = Meta.SEASON_CHESTS[k];
    (this.data.seasonChests ??= []).push(`s${seasonIdx}_${k}`);
    if (c.coins) this.addCoins(c.coins);
    if (c.gems) this.addGems(c.gems);
    if (c.parts) this.addParts(c.parts);
    this.save();
    return true;
  }

  // ---------- shop ----------
  ensureShopOffers(): string[] {
    const today = this.todayKey();
    if (this.data.shopOffers.date !== today || !this.data.shopOffers.items.length) {
      const pool = CARS.filter(c => !this.ownsCar(c.id) && c.price > 0 && !c.gemOnly).map(c => 'car:' + c.id);
      pool.push('bundle:starter', 'bundle:parts', 'bundle:gem');
      const picks: string[] = [];
      while (picks.length < 3 && pool.length) {
        const i = Math.floor(Math.random() * pool.length);
        picks.push(pool.splice(i, 1)[0]);
      }
      this.data.shopOffers = { date: today, items: picks };
      this.save();
    }
    return this.data.shopOffers.items;
  }
  buyBundle(id: string): boolean {
    const PRICES: Record<string, { coins?: number; gems?: number }> = {
      'bundle:starter': { coins: 1500 },
      'bundle:parts': { coins: 2200 },
      'bundle:gem': { gems: 60 },
    };
    const p = PRICES[id];
    if (!p) return false;
    if (p.coins && this.data.coins < p.coins) return false;
    if (p.gems && this.data.gems < p.gems) return false;
    if (p.coins) this.data.coins -= p.coins;
    if (p.gems) this.data.gems -= p.gems;
    if (id === 'bundle:starter') { this.addParts(8); this.addGems(10); }
    if (id === 'bundle:parts') this.addParts(15);
    if (id === 'bundle:gem') { this.addCoins(5000); this.addParts(10); }
    this.save();
    return true;
  }

  // ---------- race result application ----------
  applyRaceResult(r: { position: number; coins: number; xp: number; parts: number; gems: number; driftTime: number }, levelId: number) {
    const beforeLevel = this.levelInfo.level;
    this.addCoins(r.coins);
    this.addXp(r.xp);
    this.addParts(r.parts);
    this.addGems(r.gems);
    this.data.stats.races++;
    if (r.position === 1) this.data.stats.wins++;
    this.data.stats.coins += r.coins;
    if (levelId > 0) this.progressChallenge('ch_race2', 1);
    if (r.position === 1) { this.progressChallenge('ch_win1', 1); this.progressChallenge('ch_win3', 1); }
    if (r.position <= 3) this.progressChallenge('ch_podium1', 1);
    if (levelId > 0) {
      const goalCoins = 750; // rank-based earnings accumulate across races
      this.progressChallenge('ch_coins50', Math.min(goalCoins, r.coins));
      const before = this.totalStars();
      void before;
    }
    const afterLevel = this.levelInfo.level;
    this.save();
    return { leveledUp: afterLevel > beforeLevel, newLevel: afterLevel };
  }
  trackDrift(seconds: number) { this.progressChallenge('ch_drift20', Math.round(seconds)); this.trackDriftLong(seconds); }
  trackItemsUsed(n: number) { this.progressChallenge('ch_items5', n); }
  trackStars(n: number) { this.progressChallenge('ch_stars2', n); }
  trackMultiplayer() { this.progressChallenge('ch_mp1', 1); }
  trackJumps(n: number) { this.progressChallenge('ch_jump10', n); }
  /** v3.5 race-event trackers (overtakes, mid-race missions, stage goals) */
  trackOvertakes(n: number) { for (const id of ['ch_overtake5', 'ch_overtake15', 'ch_overtake30']) this.progressChallenge(id, n); }
  trackEvents(n: number) { this.progressChallenge('ch_event2', n); this.progressChallenge('ch_event5', n); }
  trackGoal() { this.progressChallenge('ch_goal3', 1); }
  trackDriftLong(seconds: number) { this.progressChallenge('ch_drift60', Math.round(seconds)); }

  fmtBest(levelId: number): string {
    const rec = this.levelRecord(levelId);
    return rec.best ? fmtTime(rec.best) : '--:--';
  }

  resetAll() {
    this.data = defaultSave();
    this.save();
  }
}

export function defaultCustom(body: string, accent: string): import('../core/save').CarCustom {
  return {
    paint: body, paint2: accent, wheelStyle: 0, wheelColor: '#1c1c1c',
    spoiler: -1, decal: 0, exhaust: 1, boostColor: '#ff9a3d', glow: '', upgrade: 0,
    upgrades: { engine: 0, turbo: 0, tires: 0, drift: 0, armor: 0 },
  };
}
