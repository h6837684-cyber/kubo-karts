// KUBO KARTS - GameApp: bootstrap, race lifecycle, multiplayer wiring, quality, resize.
import * as THREE from 'three';
import './ui/css/game.css';
import './ui/css/v3.css';
import './ui/css/v31.css';
import './ui/css/v32.css';
import './ui/css/v35.css';
import './ui/css/v36.css';
import './ui/css/v39-perf.css';   // v3.9 mobile compositor diet
import { loadSave, writeSave, exportSave, importSave, defaultSave, type SaveData } from './core/save';
import { t, setLang } from './core/lang';
import { audio } from './core/audio';
import { Meta, defaultCustom } from './meta/meta';
import { UIManager, el } from './ui/ui';
import { Showcase } from './ui/showcase';
import { registerMenuScreens } from './ui/screens';
import { registerGarageScreens, registerRaceOverlays, buildLobby, type LobbyState } from './ui/screens2';
import type { GameCtx } from './ui/ctx';
import { RaceManager, type RaceResult, type RacerConfig, type RaceHudData } from './race/race';
import { LEVELS, levelById, quickRaceConfig, levelDesc } from './race/levels';
import type { LevelDef } from './race/levels';
import { carById, CARS, tierOf } from './data/cars';
import { charById, CHARACTERS } from './data/characters';
import { THEMES } from './world/themes';
import { QUALITY_PROFILES, detectQuality, pixelRatioFor, shadowSoftFor } from './gfx/quality';
import { preloadHDTextures } from './gfx/textures';
import { MpClient, isApp, setHostName, hostIpProblem, type MpLobby, type MpSettings } from './net/client';
import { ITEMS, type ItemId } from './items/items';

const VERSION = '3.0.0';

class GameApp implements GameCtx {
  renderer: THREE.WebGLRenderer;
  meta: Meta;
  ui: UIManager;
  showcase = new Showcase();
  mp = new MpClient();
  race: RaceManager | null = null;
  private bootBar: HTMLElement;
  private bootTip: HTMLElement;
  private fpsEl: HTMLElement | null = null;
  private quality: 'low' | 'medium' | 'high' | 'ultra';
  private currentLevel: LevelDef | null = null;
  private isMpRace = false;
  private lobbyState: LobbyState | null = null;
  private remoteFinishes = new Map<string, number>();
  private awaitingRemoteResults = false;
  private lastRaceHud: RaceHudData | null = null;
  private pauseVisible = false;

  constructor() {
    // renderer
    // v3.8: MSAA follows the saved preset (a WebGL context can't toggle it later)
    const preSave = loadSave();
    const preQ = (preSave.settings as { gfxDetected39?: boolean }).gfxDetected39 ? preSave.settings.graphics : 'low';
    this.renderer = new THREE.WebGLRenderer({
      antialias: (QUALITY_PROFILES[preQ] ?? QUALITY_PROFILES.low).antialias,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = shadowSoftFor(preQ) ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.domElement.id = 'game-canvas';
    document.getElementById('game-root')!.prepend(this.renderer.domElement);

    // save + meta
    const save = loadSave();
    this.meta = new Meta(save);
    setLang(save.settings.lang);
    // v1.20: first boot picks a preset from the device (GPU / cores / RAM /
    // screen); the player can override it in Settings at any time.
    if (!(save.settings as { gfxDetected39?: boolean }).gfxDetected39) {
      save.settings.graphics = detectQuality(this.renderer);
      (save.settings as { gfxDetected39?: boolean }).gfxDetected39 = true;
      writeSave(save);
    }
    this.quality = save.settings.graphics;

    // audio
    audio.init();
    audio.setMasterVol(save.settings.master);
    audio.setMusicVol(save.settings.music);
    audio.setSfxVol(save.settings.sfx);
    audio.musicOn = save.settings.music > 0.01;
    audio.sfxOn = save.settings.sfx > 0.01;

    // ui
    this.ui = new UIManager(document.getElementById('game-ui')!, this.meta, input);
    this.ui.hud.setSensitivity(save.settings.steerSens);
    this.ui.hud.setAutoGas(save.settings.autoGas);
    this.ui.hud.setMirror(save.settings.mirrorSteer ?? false);
    this.ui.hud.setSteerMode(save.settings.steerMode === 'buttons' ? 'buttons' : 'wheel');
    this.ui.hud.setWheelSize(save.settings.wheelSize ?? 1.0);

    // boot screen (localized — Persian default)
    const boot = el('div', '', document.getElementById('game-ui')!);
    boot.id = 'boot';
    el('div', 'boot-logo', boot, 'KUBO KARTS');
    el('div', 'boot-sub', boot, t('bootSub'));
    const barWrap = el('div', 'boot-bar', boot);
    this.bootBar = el('div', '', barWrap);
    this.bootTip = el('div', 'boot-tip', boot, '');
    const tips = [t('bootTip1'), t('bootTip2'), t('bootTip3'), t('bootTip4'), t('bootTip5')];
    this.bootTip.textContent = tips[Math.floor(Math.random() * tips.length)];

    const cvs = document.getElementById('game-canvas');
    if (cvs) this.showcase.setDragCallbacks(cvs);

    // resize
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
    this.resize();

    // resume audio on first interaction
    const resumeAudio = () => { audio.resume(); };
    window.addEventListener('pointerdown', resumeAudio, { once: true });
    window.addEventListener('keydown', resumeAudio, { once: true });

    this.mpSetup();
  }

  // ---------- boot ----------
  async boot() {
    const gq = this.meta.data.settings.graphics;
    await preloadHDTextures(6000, gq === 'high' || gq === 'ultra');   // v3.9: 2K pack on High/Ultra
    const steps: [string, () => void][] = [
      ['Building voxel models…', () => this.showcase.setTheme('grass')],
      ['Painting karts…', () => { this.showcase.setCar(this.meta.data.selectedCar, this.meta.customFor(this.meta.data.selectedCar)); this.showcase.setChar(this.meta.data.selectedChar); }],
      ['Final checks…', () => {
        registerMenuScreens(this.ui, this);
        registerGarageScreens(this.ui, this);
        registerRaceOverlays(this.ui, this);
      }],
    ];
    for (let i = 0; i < steps.length; i++) {
      this.bootBar.style.width = `${((i + 1) / (steps.length + 1)) * 100}%`;
      await new Promise(r => setTimeout(r, 60));
      const step = steps[i][1];
      try { step(); } catch (e) { console.error('boot step failed', String(steps[i][0]), e); }
    }
    this.bootBar.style.width = '100%';
    // quality apply
    this.applyQuality();
    await new Promise(r => setTimeout(r, 250));
    // fade out boot
    const bootEl = document.getElementById('boot');
    if (bootEl) {
      bootEl.style.transition = 'opacity 0.4s';
      bootEl.style.opacity = '0';
      setTimeout(() => bootEl.remove(), 450);
    }
    try {
      // MUSIC REMOVED (v1.10): the repeating chiptune loop is gone for good —
      // menus are now quiet except UI sounds (user: "میخوام کامل حذف بشه")
      this.ui.show('menu');
    } catch (e) {
      console.error('[kubo] menu show failed', e);
    }
    this.startShowcaseLoop();
    // tutorial hint for first time
    if (!this.meta.data.tutorialDone) {
      this.meta.data.tutorialDone = true;
      this.meta.save();
    }
  }

  private showcaseRunning = false;
  private startShowcaseLoop() {
    if (this.showcaseRunning) return;
    this.showcaseRunning = true;
    let last = performance.now();
    const tick = (now: number) => {
      requestAnimationFrame(tick);
      // v3.9: menus never need more than ~60 fps (120 Hz phones were rendering
      // the garage twice per frame → heat → throttling before the race even started)
      if (now - last < 1000 / 62) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (this.race) return; // race owns renderer
      this.showcase.update(dt);
      this.updateFps(dt);
      this.showcase.render(this.renderer);
    };
    requestAnimationFrame(tick);
  }

  // ---------- ctx ----------
  carList() { return CARS; }
  startLevel(level: LevelDef) { this.launchRace(level, false); }
  startQuickRace(themeId: string, laps = 3) {
    // v3.5 premium map guard (the quick-race screen locks them too)
    if (!this.meta.ownsMap(themeId)) { this.ui.toast(t('mapLockedHost'), 'bad'); return; }
    const ti = THEMES.findIndex(t2 => t2.id === themeId);
    this.launchRace(quickRaceConfig(ti, laps), false);
  }
  /** v1.8: single-player POWER-UPS toggle (settings) — off strips the item
   *  boxes from every non-MP race, exactly like the 'noitems' stage rule */
  private applyItemsSetting(level: LevelDef): LevelDef {
    const S = this.meta.data.settings;
    // v3: separate switches for CAREER (level id > 0) and QUICK RACE (id 0).
    // Both fall back to the legacy global switch for old saves.
    const legacy = S.itemsOn ?? true;
    const on = level.id > 0 ? (S.itemsCareer ?? legacy) : (S.itemsQuick ?? legacy);
    if (on) return level;
    if (level.mods?.includes('noitems')) return level;
    return { ...level, mods: [...(level.mods ?? []), 'noitems'] as typeof level.mods };
  }
  hostRoom(_name: string, _settings: MpSettings) { void _name; this.hostRoomFlow(_settings); }
  joinRoom(addr: string, _name: string) { void _name; this.joinRoomFlow(addr); }
  setLobbyCar(carId: string) { this.mp.sel(carId, this.meta.data.selectedChar); }
  setLobbyChar(charId: string) { this.mp.sel(this.meta.data.selectedCar, charId); }
  hostChangeSettings(s: Partial<MpSettings>) { this.mp.setSettings(s); }
  applyQuality() {
    const q = this.meta.data.settings.graphics;
    this.quality = q;
    const QP = QUALITY_PROFILES[q] ?? QUALITY_PROFILES.high;
    this.renderer.setPixelRatio(pixelRatioFor(q));
    this.renderer.shadowMap.enabled = QP.shadows;
    this.renderer.shadowMap.type = shadowSoftFor(q) ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.toneMappingExposure = QP.toneExposure;
    this.resize();
  }
  applyFpsSetting() {
    const show = this.meta.data.settings.showFps;
    if (show && !this.fpsEl) {
      this.fpsEl = el('div', '', document.getElementById('game-ui')!);
      this.fpsEl.id = 'fps-counter';
    } else if (!show && this.fpsEl) {
      this.fpsEl.remove();
      this.fpsEl = null;
    }
  }
  exportSave(): string { return exportSave(this.meta.data); }
  importSave(code: string): boolean {
    const data = importSave(code);
    if (!data) return false;
    writeSave(data);
    return true;
  }
  resetSave() {
    const fresh: SaveData = defaultSave();
    // keep settings
    fresh.settings = this.meta.data.settings;
    writeSave(fresh);
  }

  private fpsAcc = 0; private fpsFrames = 0;
  private updateFps(dt: number) {
    if (!this.fpsEl) return;
    this.fpsAcc += dt; this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} FPS`;
      this.fpsAcc = 0; this.fpsFrames = 0;
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.showcase.resize(w, h);
  }

  // ---------- race lifecycle ----------
  private showLoadOverlay(): { root: HTMLElement; label: HTMLElement } {
    const root = el('div', '');
    root.id = 'race-load';
    el('div', 'rl-spinner', root);
    const label = el('div', 'rl-label', root, t('generatingTrack'));
    document.getElementById('game-ui')!.appendChild(root);
    return { root, label };
  }

  private launchRace(level: LevelDef, isMp: boolean, mpPlayers?: { id: string; name: string; isLocal: boolean; car?: string; char?: string }[], mpOpts?: { bots: number; items: string[]; itemMode?: 'mystery' | 'placed' }) {
    audio.stopMusic();
    audio.resume();
    // power-ups OFF (single-player only — MP keeps the host's own whitelist)
    if (!isMp) level = this.applyItemsSetting(level);
    this.currentLevel = level;
    this.isMpRace = isMp;
    this.ui.clearScreens();
    this.closeRace();

    const quality = this.quality;
    const race = new RaceManager(this.renderer, input, level, quality, isMp);
    this.race = race;
    // QA hook (browser tests): lets the automated harness drive the race sim
    (window as unknown as { __kuboRace?: RaceManager }).__kuboRace = race;
    // v1.8: first-person head-cam (settings → CAMERA → FIRST PERSON)
    race.firstPerson = this.meta.data.settings.camera === 'fp';
    // v3.1 ITEM MODE: MP uses the host's pick, solo uses Settings
    race.itemMode = (isMp ? mpOpts?.itemMode : this.meta.data.settings.itemMode) === 'placed' ? 'placed' : 'mystery';
    // host's power-up whitelist for item boxes (multiplayer setting)
    if (isMp && mpOpts && Array.isArray(mpOpts.items) && mpOpts.items.length > 0) {
      race.enabledItems = new Set(mpOpts.items as ItemId[]);
    }
    // v3: single-player per-power-up switches (Items screen). Keep at least one.
    if (!isMp) {
      const off = this.meta.data.settings.itemsOff ?? [];
      if (off.length) {
        const all = Object.keys(ITEMS) as ItemId[];
        const keep = all.filter(id => !off.includes(id));
        if (keep.length) race.enabledItems = new Set(keep);
      }
    }

    // loading overlay while the world builds
    const load = this.showLoadOverlay();

    // racer configs
    const configs: RacerConfig[] = [];
    const myCar = carById(this.meta.data.selectedCar);
    const myChar = charById(this.meta.data.selectedChar);
    const myCustom = this.meta.customFor(this.meta.data.selectedCar);
    configs.push({
      name: this.meta.data.name, carDef: myCar, charDef: myChar, custom: myCustom,
      isLocal: true, traits: traitsFor(myChar.id),
    });
    if (isMp && mpPlayers) {
      for (const p of mpPlayers) {
        if (p.isLocal) continue;
        // everyone races with the car & character THEY picked in the lobby
        const carDef = carById(p.car ?? this.lobbyCar.get(p.id) ?? 'kart_start');
        const charDef = charById(p.char ?? this.lobbyChar.get(p.id) ?? 'bolt');
        configs.push({ name: p.name, carDef, charDef, isLocal: false, isRemote: true, netId: p.id, traits: {} });
      }
      // host-configured BOT racers (user spec: "how many bots") — v1.10: bots
      // drive cars of the SAME TIER as the local player's car (هم‌رده)
      const bots = mpOpts?.bots ?? 0;
      const myTier = tierOf(myCar);
      const botPool = MP_BOT_CARS.filter(id => tierOf(carById(id)) === myTier);
      const pool2 = botPool.length ? botPool : MP_BOT_CARS;
      for (let i = 0; i < bots; i++) {
        const carDef = carById(pool2[i % pool2.length]);
        const charDef = CHARACTERS[(i * 3 + 1) % CHARACTERS.length];
        configs.push({ name: MP_BOT_NAMES[i % MP_BOT_NAMES.length], carDef, charDef, isLocal: false, diff: 'normal', traits: {} });
      }
    } else {
      const names = ['BLAZE', 'RUKA', 'PISTON', 'WILLOW', 'JETT'];
      const diff: 'easy' | 'normal' | 'hard' | 'extreme' =
        level.mods?.includes('veteran') ? 'hard' : level.difficulty;
      // SAME-TIER MATCHMAKING (v1.10, user: "میخوام داخل مسابقه با ماشین‌های
      // هم‌رده باشه"): every AI kart comes from the SAME performance tier as
      // the player's car — a C-class starter races starters, an A-class
      // hypercar races hypercars. Fallback to the raw pool if a tier is thin.
      const myTier2 = tierOf(myCar);
      for (let i = 0; i < level.opponents; i++) {
        const poolId = this.aiCarFor(i, level);
        const carDef = carById(tierOf(carById(poolId)) === myTier2 ? poolId : this.aiCarFor(i, level, myTier2));
        const charDef = CHARACTERS[(i * 3 + level.id) % CHARACTERS.length];
        // SPEED EQUALITY (v1.10, user: "چرا سرعت ماشین من از بات‌ها بیشتره؟
        // میخوام یک سان باشه"): bots get the SAME garage tuning levels as the
        // player's car, so upgrades no longer make the player rocket past
        // everyone — races stay close and logical.
        configs.push({
          name: names[i % names.length], carDef, charDef, isLocal: false, diff,
          traits: {},
          custom: { ...defaultCustom(carDef.bodyColor, carDef.accentColor), upgrades: { ...(myCustom.upgrades ?? { engine: 0, turbo: 0, tires: 0, drift: 0, armor: 0 }) } },
        });
      }
      // BOSS stage rule: one maxed-out rival in the meanest machine, fully tuned
      if (level.mods?.includes('boss')) {
        const carDef = carById(level.id >= 30 ? 'kart_proto' : 'kart_wedge');
        const charDef = CHARACTERS[(level.id * 7) % CHARACTERS.length];
        configs.push({
          name: t('boss'), carDef, charDef, isLocal: false, diff: 'extreme',
          traits: { driftChargeMul: 1.3 },
          custom: { ...defaultCustom(carDef.bodyColor, carDef.accentColor), upgrades: { engine: 5, turbo: 5, tires: 5, drift: 5, armor: 5 } },
        });
      }
    }

    race.setup(configs, (label) => { load.label.textContent = label; }).then(() => {
      load.root.remove();
      // wire hud
      this.ui.hud.attach(race);
      race.onHud = (h) => {
        this.lastRaceHud = h;
        this.ui.hud.update(h);
      };
      race.onResults = (r) => this.handleResults(r);
      race.onPauseRequest = () => this.requestPause();
      if (isMp) {
        race.netSend = (msg) => this.mp.sendState(msg as unknown as Record<string, unknown>);
        this.mp.onPeerState = (id, s) => race.applyNetState(id, s as never);
        // v1.21: items + finish times + live RTT over the network
        race.onLocalItem = (it, back) => this.mp.sendItem(it, back);
        race.onLocalFinish = (ms) => this.mp.sendFinish(ms);
        race.rttProvider = () => this.mp.rttMs;
        this.mp.onPeerItem = (id, it, back) => race.remoteUseItem(id, it as ItemId, back);
        this.mp.onPeerFinish = (id, timeMs) => {
          this.remoteFinishes.set(id, timeMs);
          const k = race.remoteKarts.get(id);
          if (k) { k.finished = true; k.finishTime = timeMs; }
        };
      }
      race.loop.start();
      if (isMp) this.meta.trackMultiplayer();
    });
  }

  private aiCarFor(idx: number, level: LevelDef, tier?: import('./data/cars').CarTier): string {
    // each hand-crafted stage brings its OWN rival car lineup (creativity pass):
    // themed pools escalate across the career and mix the new sports cars in.
    // v1.10: an optional `tier` filter keeps rivals in the player's class.
    const pool = level.rivals && level.rivals.length
      ? level.rivals
      : level.id < 5 ? ['kart_start', 'kart_accel']
      : level.id < 15 ? ['kart_start', 'kart_accel', 'kart_speed', 'kart_drift', 'kart_ev']
      : ['kart_speed', 'kart_drift', 'kart_heavy', 'kart_buggy', 'kart_classic', 'kart_accel', 'kart_muscle', 'kart_gt', 'kart_ev', 'kart_wedge'];
    if (tier) {
      const same = pool.filter(id => tierOf(carById(id)) === tier);
      if (same.length) return same[idx % same.length];
      return pool[idx % pool.length];
    }
    return pool[idx % pool.length];
  }
  private mpBotChar(id: string): string {
    return this.lobbyChar.get(id) ?? 'bolt';
  }
  private mpBotCar(id: string): string {
    return this.lobbyCar.get(id) ?? 'kart_start';
  }
  private lobbyChar = new Map<string, string>();
  private lobbyCar = new Map<string, string>();

  private handleResults(r: RaceResult) {
    const lv = this.currentLevel;
    // meta
    let record = false;
    let objectiveText = '';
    if (lv) {
      objectiveText = levelDesc(lv);
      // v3.2 BUGFIX: the stage is saved whenever you earn ANY star (podium or
      // goal) — it used to save ONLY when the goal was met, so a podium finish
      // kept the next stage locked.
      if (r.stars > 0) {
        const { newRecord } = this.meta.completeLevel(lv, r.stars, r.timeMs);
        record = newRecord;
        this.meta.trackStars(r.stars);
      }
    }
    // GEM RUN stage rule: top-3 finish pays bonus gems
    if (lv?.mods?.includes('gems') && r.position <= 3) r.gems += lv.unlockGems ?? 3;
    if (this.isMpRace && r.position === 1) this.meta.data.stats.mpWins++;
    // v3.4 VIP pass: double race coins (applied here so the results screen shows it)
    if (this.meta.isVip()) r.coins = Math.round(r.coins * this.meta.coinMul());
    const applied = this.meta.applyRaceResult(r, lv?.id ?? 0);
    this.meta.trackItemsUsed(r.itemsUsed);
    this.meta.trackDrift(r.driftTime);
    // v3.5 new daily-task trackers (jumps were never counted before -> "10 jumps" was impossible)
    this.meta.trackJumps(r.jumps ?? 0);
    if (!this.isMpRace) { this.meta.trackOvertakes(r.overtakes ?? 0); this.meta.trackEvents(r.missions ?? 0); }
    if (lv && r.objectiveDone) this.meta.trackGoal();
    // stop race
    this.closeRace(true);
    // results screen
    this.ui.show('results', {
      ...r, levelId: lv?.id ?? 0, objectiveText, isMp: this.isMpRace, record,
    });
    if (applied.leveledUp) {
      setTimeout(() => { audio.play('levelUp'); this.ui.toast(`${t('level')} ${applied.newLevel}!`, 'good'); }, 900);
      // cars unlock at specific levels (like characters): announce the new machines
      setTimeout(() => {
        for (const car of CARS) {
          if (car.reqLevel === applied.newLevel) {
            audio.play('unlock');
            this.ui.toast(t('carUnlockToast', car.name), 'good');
          }
        }
      }, 1800);
    }
    if (navigator.vibrate && this.meta.data.settings.vibration && r.position === 1) navigator.vibrate([60, 40, 60]);
  }

  closeRace(keepHud = false) {
    if (this.race) {
      this.race.dispose();
      this.race = null;
    }
    this.ui.hud.detach();
    void keepHud;
    this.mp.onPeerState = null;
    this.mp.onPeerFinish = null;
    this.mp.onPeerItem = null;
    this.remoteFinishes.clear();
    this.renderer.clear();
  }

  resumeRace() { this.setPause(false); }
  restartRace() {
    const lv = this.currentLevel;
    const mp = this.isMpRace;
    this.closeRace();
    if (lv) this.launchRace({ ...lv, seed: mp ? lv.seed : Math.floor(Math.random() * 99999) }, mp);
  }
  quitRace() {
    this.closeRace();
    this.currentLevel = null;
    // v1.11 MP: quitting frees the room slot right away (the socket no longer
    // sits in a started room that blocks the next server creation)
    if (this.isMpRace) this.mp.quitRoom();
    this.isMpRace = false;
    this.ui.show(this.lobbyState ? 'mp' : 'menu');
  }
  nextLevel() {
    const idx = LEVELS.findIndex(l => l.id === this.currentLevel?.id);
    const next = LEVELS[idx + 1];
    if (next) this.startLevel(next);
    else this.ui.show('menu');
  }
  backToLobby() {
    this.closeRace();
    if (this.lobbyState) {
      // v1.11: the HOST reopening the lobby un-bricks the room — joiners can
      // enter the same address again (user: MP server creation kept failing)
      this.mp.reopen();
      this.ui.show('mp');
      // rebuild the lobby UI (the 'mp' screen's onShow defaults to the home grid)
      buildLobby(this.ui, this, this.lobbyState);
    } else {
      this.ui.show('menu');
    }
  }

  requestPause() {
    if (this.race && !this.pauseVisible) this.setPause(true);
  }
  setPause(on: boolean) {
    this.pauseVisible = on;
    if (on && this.race) {
      this.race.loop.stop();
      audio.setDrift(false, 0);
      this.ui.show('pause');
    } else if (!on && this.race) {
      this.ui.closeCurrent();
      this.race.loop.start();
    }
  }

  // ---------- multiplayer ----------
  private mpSetup() {
    this.mp.onLobby = (l: MpLobby) => {
      this.lobbyState = {
        code: l.code,
        // v1.21: the server's isHost flag (host migration safe), not list order
        isHost: l.players.find(p => p.id === this.mp.myId)?.isHost ?? false,
        meReady: l.players.find(p => p.id === this.mp.myId)?.ready ?? false,
        players: l.players.map(p => ({
          id: p.id, name: p.name, char: p.char, car: p.car, color: p.color,
          isHost: p.isHost, isMe: p.id === this.mp.myId, ready: p.ready,
        })),
        settings: l.settings,
        themeName: THEMES.find(t2 => t2.id === l.settings.theme)?.name ?? l.settings.theme,
        hostCars: (l.hostCars ?? []).slice(),
      };
      // remember each player's lobby picks so the race spawns their car/char
      this.lobbyChar.clear();
      this.lobbyCar.clear();
      for (const p of l.players) { this.lobbyChar.set(p.id, p.char); this.lobbyCar.set(p.id, p.car); }
      if (this.ui.current === 'mp') buildLobby(this.ui, this, this.lobbyState);
    };
    this.mp.onStart = (info) => {
      // build race with remote players + host-configured bots + host item whitelist
      const players = info.players.map(p => ({
        id: p.id, name: p.name, isLocal: p.id === this.mp.myId, car: p.car, char: p.char,
      }));
      this.launchRace({
        id: 0, name: 'MULTIPLAYER', nameFa: 'چندنفره', themeId: info.theme, laps: info.laps,
        seed: info.seed, difficulty: 'normal', opponents: players.length - 1,
        objective: { type: 'finish1' }, rewardMul: 1.2, desc: 'Win the race',
        mods: [], rivals: [],
      }, true, players, { bots: info.bots ?? 0, items: info.items ?? [], itemMode: info.itemMode ?? 'mystery' });
    };
    this.mp.onPlayerJoined = (name) => {
      // user request: the joiner's NAME must be visible to everyone
      this.ui.toast(t('playerJoined', name), 'good');
    };
    this.mp.onDisconnect = () => {
      this.ui.toast(t('connectionLost'), 'bad');
      this.lobbyState = null;
      // if we were not mid-race, drop back to the MP home screen
      if (!this.race && this.ui.current === 'mp') this.ui.show('mp');
    };
    this.mp.onHostChanged = () => {
      this.ui.toast(t('youAreHost'), 'good');
    };
    this.mp.onError = (m) => {
      this.ui.toast(m === 'NO_SERVER' ? t('noServerFound') : m, 'bad');
      if (m === 'NO_SERVER' && this.ui.current === 'mp') this.ui.show('mp');
    };
    this.mp.onPeerLeft = (_id, name) => this.ui.toast(t('playerLeft', name), 'bad');
    // v1.21 RECONNECT feedback (no more silent failure)
    this.mp.onReconnecting = (n) => this.ui.toast(`${t('mpReconnecting')} (${n})`, '');
    this.mp.onReconnected = () => this.ui.toast(t('mpReconnected'), 'good');
    this.mp.onPeerLost = (_id, name) => this.ui.toast(t('mpPeerLost', name), 'bad');
    this.mp.onPeerBack = (_id, name) => this.ui.toast(t('mpPeerBack', name), 'good');
  }

  private async hostRoomFlow(settings: MpSettings) {
    try {
      this.ui.toast(isApp() ? t('mpStartingServer') : t('connecting'), '');
      setHostName(this.meta.data.name);   // v3.8: shown in friends' auto-discovery list
      await this.mp.connectHost();
      this.mp.create(this.meta.data.name, this.meta.data.selectedChar, this.meta.data.selectedCar, settings, CARS.filter(c => this.meta.canDrive(c.id)).map(c => c.id));
    } catch {
      // v1.13: the client ALREADY self-healed (restarted the mp service) before
      // throwing — tell the user to simply tap again instead of reading docs.
      // v3.7 APK: the phone itself could not open its server port.
      this.ui.toast(isApp() ? (hostIpProblem() === 'no-plugin' ? `${t('lanNoPlugin')} — ${t('lanNoPluginHint')}` : t('mpHostFailedApp')) : t('mpOffline'), 'bad');
    }
  }
  private async joinRoomFlow(addr: string) {
    try {
      this.ui.toast(t('connecting'), '');
      // v3.7 APK: an empty address has nothing to dial (there is no "this site")
      if (isApp() && !addr.trim()) { this.ui.toast(t('mpNeedAddr'), 'bad'); return; }
      await this.mp.connect(addr || undefined);
      this.mp.join(this.meta.data.name, this.meta.data.selectedChar, this.meta.data.selectedCar);
    } catch {
      this.ui.toast(isApp() ? t('mpOfflineApp') : t('mpOffline'), 'bad');
    }
  }
  toggleReady() {
    if (this.lobbyState) this.mp.setReady(!this.lobbyState.meReady);
  }
  hostStartRace() { this.mp.startRace(); }
  leaveMp() {
    this.mp.leave();
    this.lobbyState = null;
  }
}

// identity pools for host-configured multiplayer BOT racers
const MP_BOT_NAMES = ['REX-BOT', 'ZOE-BOT', 'MAX-BOT', 'LUNA-BOT'];
const MP_BOT_CARS = ['kart_speed', 'kart_drift', 'kart_heavy', 'kart_accel', 'kart_gt', 'kart_muscle'];

function traitsFor(charId: string): Record<string, number | boolean> {
  switch (charId) {
    case 'bolt': return { startBoost: 1.2 };
    case 'pip': return { itemLuck: true };
    case 'moss': return { offroadMul: 0.5 };
    case 'tiko': return { driftChargeMul: 1.25 };
    case 'ember': return { boostPadMul: 1.25 };
    case 'glacier': return { antiFreezeMul: 0.6 };
    case 'magno': return { boxRange: 2.4 };
    case 'blocksley': return { ironBumper: true };
    case 'nova': return { airControl: 2.2 };
    case 'vex': return { slipstreamMul: 2 };
    default: return {};
  }
}


// ================= input singleton =================
import { InputSystem } from './core/input';
const input: InputSystem = ((window as unknown as { __kuboInput?: InputSystem }).__kuboInput ??= (() => {
  const inp = new InputSystem();
  inp.attach();
  return inp;
})());


// ================= boot =================
// guard against double-mount (HMR / re-import) — a second GameApp would
// overlay a fresh menu on top of a running race.
const w = window as unknown as { __kuboApp?: GameApp };
if (!w.__kuboApp) {
  const app = new GameApp();
  w.__kuboApp = app;
  app.boot().then(() => app.applyFpsSetting());
}
