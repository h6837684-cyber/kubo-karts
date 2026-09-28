// KUBO KARTS - Race manager: assembles world+karts, runs the race simulation,
// camera director, item/coin/hazard logic, positions, laps, results & rewards.
import * as THREE from 'three';
import { GameLoop } from '../core/loop';
import { InputSystem } from '../core/input';
import { audio } from '../core/audio';
import { DBG } from '../core/debug';
import { QUALITY_PROFILES, AdaptiveResolution, pixelRatioFor, IS_MOBILE } from '../gfx/quality';
import { Particles, Debris } from '../gfx/particles';
import { WeatherFX } from '../gfx/weather';
import { G, makeSkyMaterial } from '../gfx/materials';
import { generateTrackData, buildTrackWorld, type TrackData, type TrackWorld, minimapPath, nearestSampleGlobal, nearestRoadSample, nearestRoadSampleForward } from '../world/track';
import { themeById, type ThemeDef } from '../world/themes';
import { Kart, applyTuning, type KartTraits } from '../kart/kart';
import { surfacesForTheme, SURFACES, type SurfaceId } from '../kart/powertrain';
const SURFACES_ROLL = (id: SurfaceId) => SURFACES[id].roll;
import { KartVisual } from '../kart/visuals';
import { AiDriver, applyAiSpeedCap } from '../ai/driver';
import { levelDesc } from './levels';
import { RaceEvents, type MissionHud } from './events';
import { getLang } from '../core/lang';
import { faDigits } from '../core/utils';
import { ItemSystem, rollItem, type ItemId, ITEMS } from '../items/items';
import { type ItemMode, pickPlacedItem, buildItemToken, animateToken, disposeToken } from '../items/placed';
import type { CarDef } from '../data/cars';
import type { CharDef } from '../data/characters';
import { charById } from '../data/characters';
import { clamp, damp, rand, makeRng, fmtTime } from '../core/utils';
import { t } from '../core/lang';
import type { LevelDef } from './levels';

export interface RacerConfig {
  name: string;
  carDef: CarDef;
  charDef: CharDef;
  custom?: import('../core/save').CarCustom;
  isLocal: boolean;
  isRemote?: boolean;
  diff?: 'easy' | 'normal' | 'hard' | 'extreme';
  traits?: KartTraits;
  netId?: string;
}

export interface RaceHudData {
  countdown: number;      // -1 = racing, 0..3 countdown value
  goFlash: number;
  position: number;
  totalRacers: number;
  lap: number;
  laps: number;
  timeMs: number;
  racers: { name: string; pos: number; isLocal: boolean; iconColor: string; finished: boolean }[];
  wrongWay: boolean;
  finalLap: boolean;
  recovered: boolean;     // anti-stall rescue just happened
  hudMsg?: string;        // generic center message (breakdown / repair …)
  driftCharge: number;    // 0..1
  driftTier: number;
  item: ItemId | null;
  itemCooldown: number;
  /** power-up QUEUE — 3 slots (user: up to 3 power-ups, one button each) */
  items: (ItemId | null)[];
  /** HEALTH (v1.9): Minecraft-style hearts — hp in half-hearts, maxHp set by
   *  the car's tier (C=3 ♥, B=4 ♥, A=5 ♥) */
  hp: number;
  maxHp: number;
  hurtFlash: boolean;
  boost: boolean;         // boost active (speed vignette fx)
  speedFrac: number;      // speed ratio 0..1.3 (HUD fx)
  minimapRacers: { x: number; z: number; isLocal: boolean; color: string }[];
  finished: boolean;
  // ---- v1.20 instrument cluster (all straight from the physics model) ----
  kmh: number;            // |speed| × 3.6 — REAL physics speed, no multiplier
  rpm: number;
  rpmN: number;           // rpm / redline
  redline: number;        // from the car's EngineProfile
  gear: number;           // -1 = R
  electric: boolean;
  limiter: boolean;
  /** v3.1: speed-breaker charge 0..1 and slipstream 0..1 (HUD badges) */
  overdrive?: number;
  draft?: number;
  /** development telemetry (Debug overlay) */
  dbg?: RaceDebugData;
  /** v3.5 LIVE STAGE GOAL bar (career) + mid-race mission chip */
  goal?: GoalHud | null;
  mission?: MissionHud | null;
}

export interface GoalHud { txt: string; frac: number; state: 'run' | 'ok' | 'done' | 'fail' }

export interface RaceDebugData {
  fps: number; frameMs: number; physMs: number; rttMs: number;
  speed: number; targetSpeed: number; rpm: number; gear: number; throttle: number; brake: boolean;
  drift: boolean; slipDeg: number; grip: number; surface: string; boost: number; load: number;
  voices: number; cls: string; engine: string; quality: string;
}

export interface RaceResult {
  position: number;
  total: number;
  timeMs: number;
  coins: number;
  xp: number;
  parts: number;
  gems: number;
  stars: number;
  objectiveDone: boolean;
  driftTime: number;
  bestLapMs: number;
  itemsUsed: number;
  jumps: number;
  /** v3.5 race events */
  overtakes?: number;
  missions?: number;
  eventCoins?: number;
}

type RaceState = 'countdown' | 'racing' | 'playerFinished' | 'done';

export class RaceManager {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  loop: GameLoop;
  input: InputSystem;

  world!: TrackWorld;
  data!: TrackData;
  theme!: ThemeDef;
  level: LevelDef;
  racers: Kart[] = [];
  visuals = new Map<Kart, KartVisual>();
  ais = new Map<Kart, AiDriver>();
  player!: Kart;
  playerVisual!: KartVisual;
  items!: ItemSystem;
  particles = new Particles(false);
  debris = new Debris();
  sun!: THREE.DirectionalLight;

  state: RaceState = 'countdown';
  countdownT = 3.9;
  raceTime = 0;
  onResults: ((r: RaceResult) => void) | null = null;
  onHud: ((h: RaceHudData) => void) | null = null;
  onPauseRequest: (() => void) | null = null;
  netSend: ((msg: NetState) => void) | null = null;
  /** v1.21 MP: local player fired an item / crossed the line / live RTT */
  onLocalItem: ((item: ItemId, backward: boolean) => void) | null = null;
  onLocalFinish: ((timeMs: number) => void) | null = null;
  rttProvider: (() => number) | null = null;
  netApply: ((msg: NetMsg) => void) | null = null;
  isMulti = false;
  /** multiplayer host setting: which power-ups may come out of item boxes */
  enabledItems: Set<ItemId> | null = null;
  /** v3.1 ITEM MODE (settings + MP host): 'mystery' = yellow ? boxes with a
   *  random roll, 'placed' = the real item floats on the road (you see it) */
  itemMode: ItemMode = 'mystery';
  private placedTokens = new Set<THREE.Object3D>();
  /** FIRST-PERSON (v1.8 settings): head-cam instead of chase-cam */
  firstPerson = false;
  weather = new WeatherFX();
  /** CITY NIGHT LIGHTING (v1.9): a small pool of real PointLights that snap
   *  to the nearest streetlamps around the player — pools of warm light on
   *  the asphalt as you drive the night city (user: "برای مپ‌های شهر نورپردازی
   *  کن — چراغ برای خیابون و بیلبورد"). */
  lampLights: THREE.PointLight[] = [];
  private activeLamps: THREE.Vector3[] = [];
  private lampTimer = 0;

  /** v3.5 mid-race missions / overtake callouts (single-player only) */
  events: RaceEvents | null = null;
  private goalPrev: GoalHud['state'] = 'run';
  // stats
  driftTimeAcc = 0;
  itemsUsed = 0;
  spinouts = 0;
  jumpCount = 0;
  bestLapMs = 0;
  lapStartMs = 0;
  quality: 'low' | 'medium' | 'high' | 'ultra' = 'high';

  private camShake = 0;
  private camFov = 62;
  private mods = new Set<string>();
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  private rng = makeRng(12345);
  private lastHud = 0;
  private itemRouletteT = 0;
  /** boxes broken but not yet rolled (user: 3-slot queue — EVERY box must
   *  roll an item, even when grabbed back-to-back while slots are busy) */
  private pendingRolls = 0;
  private recoverMsgT = 0;
  /** generic center-HUD message (breakdowns, repairs, …) */
  hudMsg = '';
  private hudMsgT = 0;
  remoteKarts = new Map<string, Kart>();
  private finishedCount = 0;
  private finishOrder: Kart[] = [];
  private resultTimer = 0;
  private sunTarget = new THREE.Object3D();
  private startBoostWindow = -1;
  private skyDome: THREE.Mesh | null = null;
  /** night flag (stage rule or theme) — drives headlight auto-on + beam FX.
   *  v1.13: becomes true ALSO while the player is inside a TUNNEL on a day map
   *  (auto darkness = auto lights, user: "برای تاریکی خودکار فعال بشه و وقتی
   *  نور هست خودش غیرفعال بشه"). */
  isNight = false;
  /** v1.13: does this map have tunnels at all? (the light button shows too) */
  hasTunnels = false;
  private tunnelDark = false;   // player currently inside a tunnel on a day map
  private prevLookBack = false;

  constructor(renderer: THREE.WebGLRenderer, input: InputSystem, level: LevelDef, quality: RaceManager['quality'], mpMode = false) {
    this.renderer = renderer;
    this.input = input;
    this.level = level;
    this.quality = quality;
    this.mpMode = mpMode;
    this.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 800);
    this.loop = new GameLoop(dt => {
      const t0 = performance.now();
      this.update(dt);
      this.physMs = this.physMs * 0.92 + (performance.now() - t0) * 0.08;   // debug: physics cost
    }, (a, fdt) => {
      this.frameMs = this.frameMs * 0.9 + fdt * 1000 * 0.1;
      // dynamic resolution (cosmetic): protect FPS / input latency first
      if (QUALITY_PROFILES[this.quality].adaptive && this.adaptiveRes.update(this.frameMs, fdt, GameLoop.refreshHz >= 100 ? 2000 / GameLoop.refreshHz : 1000 / 60)) {
        this.renderer.setPixelRatio(pixelRatioFor(this.quality, this.adaptiveRes.scale));
      }
      this.render(a, fdt);
    });
  }

  private mpMode = false;
  /** v1.20: random AI breakdowns violate "no random physics" — kept only as a
   *  switch for designers, OFF by default */
  static RANDOM_AI_BREAKDOWNS = false;

  async setup(racerConfigs: RacerConfig[], onProgress?: (label: string) => void) {
    const step = async (label: string) => {
      onProgress?.(label);
      await new Promise(r => setTimeout(r, 30));
    };
    const theme = themeById(this.level.themeId);
    this.theme = theme;
    // stage rule modifiers (60 hand-crafted stages — creative careers)
    this.mods = new Set((this.level as { mods?: string[] }).mods ?? []);
    const mods = this.mods;
    await step(t('generatingTrack'));
    const itemRows = mods.has('noitems') ? 0 : mods.has('itemstorm') ? 12 : 6;
    this.data = generateTrackData(this.level.seed, { genName: this.level.genName, laps: this.level.laps, themeId: this.level.themeId, itemRows });
    this.data.hazards = [];
    if (theme.hazard !== 'none' && this.level.id > 6) {
      const hCount = this.level.id > 40 ? 4 : this.level.id > 20 ? 3 : 2;
      const N = this.data.samples.length;
      for (let i = 0; i < hCount; i++) {
        this.data.hazards.push({
          type: theme.hazard, sIdx: Math.floor((i + 0.7) / hCount * N), lane: rand(-0.5, 0.5), phase: rand(0, Math.PI * 2), y: 0,
        });
      }
    }

    // world
    await step(t('buildingWorld'));
    this.world = buildTrackWorld(this.data, theme, this.quality);
    this.scene.add(this.world.group);
    if (this.itemMode === 'placed') this.setupPlacedItems();
    // sky
    await step(t('paintingSky'));
    const night = mods.has('night') || !!theme.night;
    this.isNight = night;   // visuals read this (headlights auto-on)
    // v1.13 AUTO LIGHTS: maps with tunnels flip the lights automatically while
    // the player is inside the dark (see the per-tick check in update())
    this.hasTunnels = this.data.tunnelRanges.length > 0;
    const skyGeo = new THREE.SphereGeometry(600, 16, 12);
    const skyMat = makeSkyMaterial(theme.sky.top, theme.sky.bottom, theme.sky.horizon, night);
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.frustumCulled = false;
    this.scene.add(sky);
    this.skyDome = sky;
    this.disposables.push(skyGeo, skyMat);

    // lights
    const hemi = new THREE.HemisphereLight(new THREE.Color(theme.sky.hemiSky), new THREE.Color(theme.sky.hemiGround), night ? 0.32 : 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(new THREE.Color(theme.sky.sun), night ? theme.sky.sunIntensity * 0.16 : theme.sky.sunIntensity);
    sun.position.set(50, 15, 32);
    if (this.quality !== 'low') {
      sun.castShadow = true;
      const sh = QUALITY_PROFILES[this.quality].shadowMap;
      sun.shadow.mapSize.set(sh, sh);
      // v3.9: phones get a tighter box (±38 m) = ~1.7× sharper shadows for
      // the same map size; fog hides the far edge anyway
      const ext = IS_MOBILE ? 38 : 50;
      sun.shadow.camera.left = -ext; sun.shadow.camera.right = ext;
      sun.shadow.camera.top = ext; sun.shadow.camera.bottom = -ext;
      sun.shadow.normalBias = 0.02;
      sun.shadow.camera.far = 300;
      sun.shadow.bias = -0.0018;
    }
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
    // sync sky-shader sun disc with the light direction (constant offset, low
    // enough elevation to actually be visible from the chase camera)
    G.sunDir.value.set(50, 15, 32).normalize();
    if (night) this.scene.add(new THREE.AmbientLight(0x4a5a78, 0.72));   // v1.9: brighter night base (city readability)

    // fog (THICK FOG stage rule: visibility drops hard; NIGHT: fog goes dark
    // so the world fades into the night sky instead of day haze)
    const fogColor = new THREE.Color(theme.fog.color);
    if (night) fogColor.multiplyScalar(0.10);
    // draw distance scales with the quality preset (cosmetic only)
    const dd = QUALITY_PROFILES[this.quality].drawDistance;
    const fogNear = (mods.has('fog') ? theme.fog.near * 0.45 : theme.fog.near) * dd;
    const fogFar = (mods.has('fog') ? Math.max(60, theme.fog.far * 0.5) : theme.fog.far) * dd;
    this.scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);
    G.fogColor.value.copy(fogColor);
    G.fogNear.value = fogNear;
    G.fogFar.value = fogFar;
    this.renderer.setClearColor(fogColor);

    // WEATHER FX (v1.8 bonus: "افکت باران/برف"): snow for the snow world,
    // rain on night city/jungle/ruins stages
    this.weather.spawn(this.scene, WeatherFX.kindFor(theme.id, night), QUALITY_PROFILES[this.quality].vfx);

    // CITY NIGHT LIGHTING pool (see lampLights comment) — only where lamps exist
    if (night && this.world.lampPositions.length) {
      const nLights = Math.max(1, QUALITY_PROFILES[this.quality].lampLights);
      for (let i = 0; i < nLights; i++) {
        const L = new THREE.PointLight(0xffd9a0, 0, 24, 1.7);
        this.scene.add(L);
        this.lampLights.push(L);
      }
    }

    // particles
    this.particles.density = QUALITY_PROFILES[this.quality].particles;
    this.debris.density = this.particles.density;
    this.scene.add(this.particles.points);
    this.scene.add(this.debris.mesh);

    // karts — RANDOM GRID (user v1.10: "وقتی هنوز مسابقه شروع نشده جای ماشین
    // رندوم باشه"): every race shuffles the 6 grid slots, so you no longer
    // always start in the same pole/last position. kart.id/AI seeds stay
    // sequential (stable behavior) — only the STARTING SPOT is random.
    const gridOrder = this.data.startGrid.map((_, i) => i);
    for (let i = gridOrder.length - 1; i > 0; i--) {
      // Math.random (NOT this.rng — that one is fixed-seed and would shuffle
      // identically every race, defeating the randomness)
      const j = Math.floor(Math.random() * (i + 1));
      [gridOrder[i], gridOrder[j]] = [gridOrder[j], gridOrder[i]];
    }
    let gridIdx = 0;
    for (const cfg of racerConfigs) {
      const traits: KartTraits = cfg.traits ?? {};
      const kart = new Kart(cfg.carDef, traits);
      // WORKSHOP tuning: the player's garage upgrades feed real physics knobs.
      // v1.20 MP FAIRNESS: in multiplayer every kart runs its car's STOCK
      // class profile (no garage upgrades) — class tiers still matter
      // (A > B > C), but within a class the result is pure driver skill.
      if (cfg.custom?.upgrades && !this.mpMode) applyTuning(kart, cfg.custom.upgrades);
      // v1.20 SURFACES: road/off-road material per world (grip, rolling
      // resistance, tire audio, particles) — ICE GRIP rule turns roads to ice
      kart.surfaceMap = surfacesForTheme(theme.id, mods.has('lowgrip'));
      kart.name = cfg.name;
      kart.charDef = cfg.charDef;
      kart.isLocal = cfg.isLocal;
      kart.id = gridIdx;
      const grid = this.data.startGrid[gridOrder[gridIdx % gridOrder.length] % 6];
      kart.placeAtGrid({ pos: grid.pos.clone(), heading: grid.heading });
      // BUGFIX (progress/lap system): sIdx must start at the kart's REAL sample
      // and trackPos must satisfy trackPos % N == sIdx, otherwise the progress
      // controller injects a bogus half-lap offset at GO.
      const gs = nearestSampleGlobal(this.data, kart.pos);
      kart.sIdx = gs;
      // v2.0 open (point-to-point) tracks: the finish line is sample 0, so the
      // grid starts at trackPos = gs and the ONE wrap to 0 = the finish.
      kart.trackPos = this.data.open ? gs : gs - this.data.samples.length;
      kart.lastTrackPos = kart.trackPos;
      this.racers.push(kart);
      // v3.8 PERF: the boost PointLight used to be created for EVERY kart
      // (8 karts = 8 extra lights evaluated for every pixel of the screen, all
      // race long, even at intensity 0). Now only the local player gets it,
      // and only on HIGH/ULTRA.
      const hiFx = this.quality === 'high' || this.quality === 'ultra';
      const vis = new KartVisual(kart, cfg.custom, !!cfg.isLocal && hiFx);
      vis.quality = this.quality;
      if (cfg.isLocal) {
        // real headlight/underglow lights are added NOW (loading) — never mid-race
        const needDark = night || this.hasTunnels;
        vis.prepareLights(night || (this.hasTunnels && hiFx), needDark && hiFx);
      }
      if (night) vis.setNight(true);   // user: headlights ON when it's night
      this.scene.add(vis.root);
      this.visuals.set(kart, vis);
      if (cfg.isLocal) { this.player = kart; this.playerVisual = vis; }
      else if (cfg.isRemote && cfg.netId) { this.remoteKarts.set(cfg.netId, kart); }
      else {
        const ai = new AiDriver(kart, cfg.diff ?? this.level.difficulty, 77 + gridIdx * 31);
        this.ais.set(kart, ai);
      }
      gridIdx++;
    }

    // ICE GRIP stage rule: everyone's steering gets loose (applies AFTER karts exist)
    if (mods.has('lowgrip')) {
      // v1.20: the ice surface (kart.surfaceMap) now provides the real grip
      // loss; only a gentle steering-rate trim is kept on top of it.
      for (const kart of this.racers) {
        kart.T.turnRate *= 0.9;
        kart.T.driftTurn *= 0.97;
      }
    }

    // MULTIPLAYER SPEED PARITY (user: "وقتی چندنفره با وای‌فای هست همه بازیکن‌ها
    // سرعت یکسانی داشته باشن"): every kart — local, remote, MP bots — gets the
    // EXACT same physics profile (the local player's), so no car is faster by
    // design. Garage tuning and car choice stay cosmetic in MP races.
    // v1.20: REPLACED by class-based fairness (see kart creation above):
    // copying the local player's tunables onto everyone erased the A/B/C
    // hierarchy. Now each kart keeps its own STOCK class profile in MP —
    // same class ⇒ identical core performance, different class ⇒ real tier.
    // Remote karts are rendered from network snapshots (position authority
    // stays with their owner), so latency can never add speed.
    void applyAiSpeedCap;

    // items
    this.items = new ItemSystem(this.scene, this.particles, this.debris, this.data);
    this.items.onHit = (kart, item) => {
      if (kart === this.player) { this.camShake = 0.5; audio.play('bonk'); this.spinouts++; }
    };

    // music: REMOVED during races (user: "یه صدا هست که هی تکرار میشه وقتی
    // داری مسابقه میدی — میخوام حذف باشه"). The looping chiptune sequencer WAS
    // that repeating sound. Races now run on engine + SFX only; the menu keeps
    // its music.
    audio.stopMusic();
    audio.startEngine(this.player?.pt.eng);
    // v1.14 AMBIENCE: per-theme environmental bed (wind/birds/crickets/rumble/
    // drips/city hum) on the music-volume bus — the world is no longer silent
    audio.startAmbience(this.theme.id, this.isNight);
    // v3.8 PERF: compile every shader NOW (behind the loading screen) instead
    // of the first time each object appears on screen — removes the hitches
    // in the first seconds of a race.
    try { this.renderer.compile(this.scene, this.camera); } catch { /* old GPU driver */ }
  }

  /** seconds before a picked-up item box reappears ("about a lap feel") */
  static BOX_RESPAWN_S = 15;

  /** REAL ITEMS mode: swap every box's glass/frame/? for the actual item */
  private setupPlacedItems() {
    this.world.boxMeshes.forEach((obj, i) => {
      const ud = obj.userData as { glass: THREE.Object3D; frame: THREE.Object3D; qBill: THREE.Object3D; spotIdx?: number; gen?: number };
      ud.glass.visible = false; ud.frame.visible = false; ud.qBill.visible = false;
      ud.spotIdx = i; ud.gen = 0;
      this.placeToken(obj);
    });
  }
  private placeToken(obj: THREE.Object3D) {
    const ud = obj.userData as { spotIdx: number; gen: number; token?: THREE.Object3D; placedItem?: ItemId };
    if (ud.token) { this.placedTokens.delete(ud.token); disposeToken(ud.token); }
    const id = pickPlacedItem(this.level.seed ?? 1, ud.spotIdx, ud.gen, this.enabledItems);
    const tok = buildItemToken(id);
    obj.add(tok);
    obj.rotation.set(0, 0, 0);
    ud.token = tok; ud.placedItem = id;
    this.placedTokens.add(tok);
  }

  dispose() {
    for (const tk of this.placedTokens) disposeToken(tk);
    this.placedTokens.clear();
    this.loop.stop();
    audio.stopEngine();
    audio.setDrift(false, 0);
    audio.stopMusic();
    audio.stopAmbience();
    this.items?.dispose();
    this.weather.dispose();
    this.scene.clear();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    if (this.world) for (const d of this.world.disposables) d.dispose();
    // v3.1: per-kart material clones (see KartVisual ghost registry)
    for (const vis of this.visuals.values()) { for (const m of vis.ownedMats) m.dispose(); vis.ownedMats = []; }
  }

  /** v1.14 spatial audio: stereo pan of a world position vs the player's
   *  heading (right = positive). AI events happen AROUND you, not in mono. */
  private panToward(pos: THREE.Vector3): number {
    const p = this.player;
    if (!p) return 0;
    const dx = pos.x - p.pos.x, dz = pos.z - p.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.001) return 0;
    // right vector = (-cos h, sin h); forward = (sin h, cos h)
    const pan = (dx / d) * -Math.cos(p.heading) + (dz / d) * Math.sin(p.heading);
    return clamp(pan, -1, 1) * 0.75;
  }

  // ================= UPDATE (fixed 60hz) =================
  private update(dt: number) {
    G.time.value += dt;
    if (this.recoverMsgT > 0) this.recoverMsgT -= dt;
    if (this.hudMsgT > 0) { this.hudMsgT -= dt; if (this.hudMsgT <= 0) this.hudMsg = ''; }

    // countdown state machine
    if (this.state === 'countdown') {
      const prev = Math.ceil(this.countdownT);
      this.countdownT -= dt;
      const cur = Math.ceil(this.countdownT);
      if (cur !== prev && cur >= 1 && cur <= 3) audio.play('countdown', cur === 3 ? 0.8 : cur === 2 ? 0.9 : 1);
      if (this.countdownT <= 0.5 && this.startBoostWindow < 0) this.startBoostWindow = 0.5;
      if (this.countdownT <= 0) {
        // v3.1 p2: show the STAGE GOAL at GO (it was only revealed on the results screen,
        // so every stage felt like the same plain race)
        if (this.level.id > 0) { this.hudMsg = '🎯 ' + levelDesc(this.level); this.hudMsgT = 3.5; }
        this.state = 'racing';
        audio.play('go');
        // start boost: gas held during last 0.5s — or FREE for turbo-start stages
        if (this.mods.has('turbostart')) {
          this.player.applyBoost(1.1);
          this.particles.spawn({
            count: 16, pos: this.player.pos.clone(), spread: 0.5,
            vel: new THREE.Vector3(0, 1.5, 0), velSpread: 2.5,
            life: 0.5, size: 0.35, sizeEnd: 0.9, color: '#ffd54f', alpha: 0.9, gravity: 0,
          });
        } else if (this.input.state.gas) {
          const power = (this.player.traits.startBoost ?? 1);
          this.player.applyBoost(0.85 * power);
        }
        this.lapStartMs = 0;
      }
    } else if (this.state === 'racing' || this.state === 'playerFinished') {
      this.raceTime += dt * 1000;
    }

    const racing = this.state === 'racing';

    // v1.13 AUTO HEADLIGHTS (user: "برای همه مپ‌های تاریک یا تاریکی خودکار
    // فعال بشه — وقتی نور هست خودش غیرفعال بشه"): on DAY maps the lights flip
    // on automatically while the player is inside a TUNNEL and back off the
    // moment the sky is visible again. Night maps are always dark.
    if (!this.isNight || this.tunnelDark) {
      const p = this.player;
      const inT = p ? this.data.tunnelRanges.some(([a, b]) => p.sIdx >= a && p.sIdx <= b) : false;
      if (inT !== this.tunnelDark) {
        this.tunnelDark = inT;
        this.isNight = inT || !!this.theme?.night || this.mods.has('night');
        for (const vis of this.visuals.values()) vis.setNight(this.isNight);
      }
    }

    // --- player input ---
    this.input.sample(dt);
    if (this.input.consumePause()) this.onPauseRequest?.();
    // During countdown physics is FROZEN (no creeping): gas is only sampled at GO
    // for the start-boost, so holding it early no longer gives a head start.
    const playerInput = this.state === 'countdown'
      ? { steer: this.input.state.steer * 0.2, gas: false, brake: false, drift: false }
      : racing || this.state === 'playerFinished'
        ? { steer: this.input.state.steer, gas: this.input.state.gas && this.state === 'racing', brake: this.input.state.brake, drift: this.input.state.drift && this.state === 'racing' }
        : { steer: 0, gas: false, brake: true, drift: false };

    // --- AI inputs ---
    for (const [kart, ai] of this.ais) {
      if (kart.finished) { ai.update(dt, this.data, this.racers, this.rng, false); continue; }
      ai.update(dt, this.data, this.racers, this.rng, racing && kart.item !== null);
      if (ai.consumeUse() && kart.item && racing) this.useItem(kart);
    }

    // --- physics ---
    for (const kart of this.racers) {
      let inp = kart === this.player ? playerInput : (this.ais.get(kart)?.input ?? { steer: 0, gas: true, brake: false, drift: false });
      if (this.state === 'countdown' && kart !== this.player) {
        // AI karts stay locked on the grid until GO (no brake: brake at 0 = reverse!)
        inp = { steer: 0, gas: false, brake: false, drift: false };
      }
      if (kart.breakdownT > 0) {
        // BREAKDOWN: engine is dead — no gas, no drift, car coasts to a FULL stop
        inp = { steer: inp.steer * 0.3, gas: false, brake: false, drift: false };
      }
      if (kart.isRemote) {
        // remote karts: interpolation instead of physics (handled in net update)
        continue;
      }
      kart.update(dt, inp, this.data, this.rng);
      // brake lights follow the PHYSICS brake state (no flicker: the flag is
      // true for every step the brake is actually decelerating the kart)
      (kart as unknown as { _braking: boolean })._braking = kart.braking || (inp.brake && kart.speed > 0.5);

      // HEALTH → BREAKDOWN (v1.9 health bar): a kart whose hearts hit zero
      // breaks down (smoking stall, like the engine-failure system) and is
      // repaired on the road ahead with a FULL bar (kart.hp = maxHp there).
      if (racing && !kart.finished && kart.hp <= 0 && kart.breakdownT <= 0 && kart.breakdownWarn <= 0) {
        kart.breakdownT = kart === this.player ? 2.0 : 2.6;
        kart.breakdownDone = true;
        if (kart === this.player) {
          this.hudMsg = t('carWrecked');
          this.hudMsgT = 2.2;
          audio.play('crash');
          this.camShake = 0.55;
        }
      }

      // AI item roll landed (see updatePickups) — fill the bot's queue
      const aiRoll = kart as unknown as { _aiRollT?: number };
      if (aiRoll._aiRollT !== undefined && aiRoll._aiRollT > 0) {
        aiRoll._aiRollT -= dt;
        if (aiRoll._aiRollT <= 0) {
          delete aiRoll._aiRollT;
          if (racing && kart.hasFreeSlot()) {
            kart.item = rollItem(this.positionOf(kart), this.racers.length, !!kart.traits.itemLuck, this.enabledItems) as ItemId;
          }
        }
      }

      // lap/finish — v1.22 REWRITE (user: "وقتی به خط شروع میرسم دور حساب
      // نمیشه … برای همه مپ‌ها درست کن" + "صدای دور آخر کامل قطع کنی که هی
      // صدا میده الکی"). Two bugs lived here:
      //  1) The lap event fired by comparing kart.lap with lapNow — but kart.ts
      //     recomputes kart.lap EVERY frame, so the compare re-succeeded ~60×/s
      //     and the 'lap' chime spammed non-stop. Now a per-kart lastLapFloor
      //     tracks the announced lap; the event fires ONCE per real crossing.
      //  2) With the kart.ts trackPos fix (samples crossed), lapNow rolls over
      //     EXACTLY at the start line, so laps count on every map.
      //  And per the user's request the lap chime is GONE completely — no
      //  sound on any lap, final or otherwise. Lap timing/best-lap stay.
      const totalSamples = this.data.samples.length * this.data.laps;
      const lapNow = Math.floor(kart.trackPos / this.data.samples.length);
      if (kart.trackPos > 0 && lapNow > kart.lastLapFloor) {
        kart.lastLapFloor = lapNow;
        kart.lap = Math.min(lapNow + 1, this.data.laps);
        if (kart === this.player && lapNow > 0) {
          const lapMs = this.raceTime - this.lapStartMs;
          if (this.lapStartMs > 0 && (this.bestLapMs === 0 || lapMs < this.bestLapMs)) this.bestLapMs = lapMs;
          this.lapStartMs = this.raceTime;
          // v1.22: NO lap sound at all anymore (user request — completely cut).
        }
      }
      if (!kart.finished && kart.trackPos >= totalSamples) {
        kart.finished = true;
        kart.finishTime = this.raceTime;
        this.finishOrder.push(kart);
        this.finishedCount++;
        if (kart === this.player) {
          this.onLocalFinish?.(this.raceTime);
          this.state = 'playerFinished';
          this.resultTimer = 2.2;
          audio.play('win');
        } else if (!kart.isRemote) {
          audio.play('checkPoint');
        }
      }

      // plunged into fluid (sea/lava) → force fall/respawn
      if (kart.respawnCooldown <= 0) {
        const fluid = this.theme.water ? this.theme.water.level : this.theme.lava ? this.theme.lava.level : -999;
        if (fluid > -900 && kart.pos.y < fluid + 0.3) {
          kart.fx = 'fall'; kart.fxT = 0.4;
          if (kart === this.player) {
            this.camShake = 0.6;
            this.particles.spawn({
              count: 14, pos: kart.pos.clone(), spread: 0.6,
              vel: new THREE.Vector3(0, 3, 0), velSpread: 3,
              life: 0.5, size: 0.5, sizeEnd: 1.2,
              color: this.theme.lava ? '#ff6d00' : '#8fd0f0', alpha: 0.8, gravity: 7,
            });
          }
        }
      }

      // fell off → respawn ON THE ROAD AHEAD (forward search: a kart that
      // dropped into a jump-gap pit continues AFTER the gap instead of being
      // re-dropped at the take-off lip with no runway → endless loop)
      if (kart.fx === 'fall' && kart.respawnCooldown <= 0) {
        const N2 = this.data.samples.length;
        const idxInLap = ((kart.trackPos % N2) + N2) % N2;
        const roadIdx = nearestRoadSampleForward(this.data, Math.floor(idxInLap) + 6);
        const s = this.data.samples[roadIdx];
        kart.respawn({ pos: s.pos.clone(), heading: Math.atan2(s.tan.x, s.tan.z) });
        kart.sIdx = roadIdx;   // v1.13: re-anchor the sample cursor (no stale window)
        if (kart === this.player) { this.camShake = 0.6; audio.play('crash'); }
      }

      // --- BREAKDOWN (user: random engine failure → full stop → respawn →
      //     falls a bit behind — leaders are more likely, once per race) ---
      if (racing && !kart.finished && kart.breakdownT > 0) {
        // stalled: engine dead, hard decel to a FULL stop, smoke from the hood
        kart.breakdownT -= dt;
        kart.speed *= Math.max(0, 1 - dt * 3.4);
        kart.stuckT = 0; // keep the anti-stall rescue out of this
        kart.drifting = false;
        if (Math.random() < dt * 26) {
          this.particles.spawn({
            count: 1, pos: kart.pos.clone().add(new THREE.Vector3(0, 0.9, 0.4)), spread: 0.25,
            vel: new THREE.Vector3(0, 1.6, 0), velSpread: 0.6,
            life: 0.9, size: 0.35, sizeEnd: 1.0, color: '#565b62', alpha: 0.6, gravity: -1.2,
          });
        }
        if (kart.breakdownT <= 0) {
          // repaired → respawn on the road ahead (the pack drives past)
          const fixIdx = nearestRoadSample(this.data, kart.sIdx + 6);
          const s = this.data.samples[fixIdx];
          kart.respawn({ pos: s.pos.clone(), heading: Math.atan2(s.tan.x, s.tan.z) });
          kart.sIdx = fixIdx;   // v1.13: re-anchor the sample cursor
          kart.hp = kart.maxHp;   // full health after the pit repair (v1.9 hearts)
          kart.hurtT = 0;
          if (kart === this.player) {
            this.hudMsg = '\u200b' + t('repaired');
            this.hudMsgT = 1.6;
            audio.play('repair');
          }
        }
      } else if (racing && !kart.finished && kart.breakdownWarn > 0) {
        kart.breakdownWarn -= dt;
        kart.stuckT = 0;
        if (Math.random() < dt * 16) {
          this.particles.spawn({
            count: 1, pos: kart.pos.clone().add(new THREE.Vector3(0, 0.8, 0.4)), spread: 0.2,
            vel: new THREE.Vector3(0, 1.2, 0), velSpread: 0.5,
            life: 0.7, size: 0.22, sizeEnd: 0.7, color: '#7a7f86', alpha: 0.5, gravity: -1.5,
          });
        }
        if (kart.breakdownWarn <= 0) {
          kart.breakdownT = kart === this.player ? 2.0 : 2.6;
          const name2 = kart === this.player ? this.player.name : kart.name;
          this.hudMsg = `${name2} — ${t('breakdown')}`;
          this.hudMsgT = 2.2;
          if (kart === this.player) { audio.play('sputter'); this.camShake = 0.3; }
          else if (kart.pos.distanceTo(this.player.pos) < 40) audio.play('sputter', 0.8, 0.8, this.panToward(kart.pos));
        }
      } else if (racing && !kart.finished && !kart.breakdownDone && kart.breakdownWarn <= 0
                 && kart.breakdownT <= 0 && this.raceTime > 18000 && !kart.isRemote) {
        // RANDOM BREAKDOWN ROLL — v1.11: the LOCAL PLAYER is fully exempt now.
        // (user: "چرا یک دفعه ماشین خراب میشه وقتی جون‌ها هنوز کم نشدن؟" — a
        // random stall with a FULL health bar read exactly like a bug. The
        // player's car now only breaks down when its HEARTS actually hit
        // zero, which is honest and readable.) AI karts keep rare random
        // failures for drama, at a much lower rate so they don't fall behind.
        // v1.20 NO RANDOM PHYSICS: random AI engine failures are disabled
        // (spec §47). Breakdowns now ONLY happen when hearts reach zero.
        if (kart !== this.player && RaceManager.RANDOM_AI_BREAKDOWNS) {
          kart.breakdownRollT -= dt;
          if (kart.breakdownRollT <= 0) {
            kart.breakdownRollT = 14 + Math.random() * 14;
            const rank = this.positionOf(kart);
            const base = rank <= 2 ? 0.10 : 0.045;
            if (Math.random() < base) {
              kart.breakdownWarn = 1.0;
              kart.breakdownDone = true;
            }
          }
        }
      }

      // --- anti-stall rescue: gas held, grounded, pinned for 2.5s → warp to road ahead ---
      if (racing && !kart.finished && kart.stuckT > 2.5 && kart.respawnCooldown <= 0) {
        const rescueIdx = nearestRoadSample(this.data, kart.sIdx + 10);
        const s = this.data.samples[rescueIdx];
        kart.respawn({ pos: s.pos.clone(), heading: Math.atan2(s.tan.x, s.tan.z) });
        kart.sIdx = rescueIdx;   // v1.13: re-anchor the sample cursor
        if (kart === this.player) {
          this.camShake = 0.35;
          this.recoverMsgT = 1.4;
          audio.play('checkPoint');
          this.particles.spawn({
            count: 12, pos: kart.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), spread: 0.5,
            vel: new THREE.Vector3(0, 2, 0), velSpread: 2,
            life: 0.5, size: 0.3, sizeEnd: 0.9, color: '#8fe3ff', alpha: 0.9, gravity: 0,
          });
        }
      }
    }

    // --- interactions (boxes, pads, coins, hazards, collisions) ---
    if (racing || this.state === 'playerFinished') {
      this.updateSlipstream();
      this.updatePickups(dt);
      this.updateHazards(dt);
      this.updateCollisions();
      this.items.update(dt, this.racers);
      // GROUND SHAKE (v1.10 lightning storm): the item system raises
      // shakeReq on every thunder spawn / field discharge — the camera catches it
      if (this.items.shakeReq > 0) {
        this.camShake = Math.max(this.camShake, this.items.shakeReq);
        this.items.shakeReq = 0;
      }
    }

    // --- item roulette / use (3-slot queue) ---
    // FIX (user: "چرا داخل این سه مربع فقط میشه یه قدرت گرفت؟ دومی و سومی کار
    // نمی‌کنن"): the old gate `pendingItem === null` blocked every roulette
    // after the first — pendingItem was never cleared once the roll landed,
    // so boxes 2 and 3 broke but NEVER rolled an item. The countdown is now
    // self-gating: each player box-break arms the timer + queue, and the roll
    // fires exactly once per box (rapid multi-box gets quick back-to-back rolls).
    if (this.itemRouletteT > 0) {
      this.itemRouletteT -= dt;
      if (this.itemRouletteT <= 0) {
        if (racing && this.pendingRolls > 0 && this.player.hasFreeSlot()) {
          const rank = this.positionOf(this.player);
          const got = rollItem(rank, this.racers.length, !!this.player.traits.itemLuck, this.enabledItems) as ItemId;
          this.player.item = got;
          // v1.21: the per-item pickup signature is finally WIRED (it existed
          // but the roulette still played the generic chime)
          audio.itemPickupFor(got);
        }
        this.pendingRolls = Math.max(0, this.pendingRolls - 1);
        if (this.pendingRolls > 0 && this.player.hasFreeSlot()) this.itemRouletteT = 0.4; // next queued roll
      }
    }

    // player item use — SLOT BUTTONS (user: "بزنی اولی اولی فعال میشه، دومی
    // دومی، سومی سومی") + generic E/Enter uses the first queued item
    // LOOK-BACK + ROCKET (user: eye button held → rocket flies BACKWARD to
    // the racers behind) — resolved per-call inside useItem/useItemSlot
    if (racing) {
      const slot = this.input.consumeItemSlot();
      if (slot >= 0) this.useItemSlot(this.player, slot);
      else if (this.player.item && this.input.consumeItem()) this.useItem(this.player);
    } else { this.input.consumeItemSlot(); this.input.consumeItem(); }

    // --- drift stats + audio ---
    if (this.player.drifting && this.player.grounded) this.driftTimeAcc += dt;
    if (this.player.fx === 'land' && this.player.fxT > 0.13 && this.player.airTime === 0 && this.player.grounded) this.jumpCount++;
    this.updateVehicleAudio(dt);
    const fx = this.player.fx;
    const fxJustStarted = fx !== this.prevPlayerFx;
    this.prevPlayerFx = fx;
    if (fxJustStarted) {
      if (fx === 'boost' && this.player.fxT > 0.24) audio.play('driftRelease');
      if (fx === 'drift1' && this.player.fxT > 0.14) audio.play('driftCharge', this.player.driftTier + 1);
      if (fx === 'land') audio.play('land');
      if (fx === 'fall') audio.play('splash');
    }

    // --- positions ---
    this.rankRacers();

    // --- v3.5 mid-race events + live stage goal ---
    if (racing && !this.player.finished) this.updateEvents(dt);

    // --- remote kart interpolation ---
    this.interpolateRemote(dt);

    // --- net broadcast (12hz) ---
    if (this.netSend) {
      this.netAccum += dt;
      // v3.8: 20 Hz (was effectively 10 Hz: the '>' + reset-to-0 skipped a tick)
      if (this.netAccum >= 1 / 20 - 1e-6) {
        this.netAccum -= 1 / 20;
        if (this.netAccum > 1 / 20) this.netAccum = 0;
        this.netSend({
          t: 's',
          ts: Math.round(performance.now()),
          p: [+this.player.pos.x.toFixed(2), +this.player.pos.y.toFixed(2), +this.player.pos.z.toFixed(2)],
          h: +this.player.heading.toFixed(2),
          v: +this.player.speed.toFixed(1),
          d: this.player.drifting ? this.player.driftDir : 0,
          b: this.player.boostT > 0,
          tp: +this.player.trackPos.toFixed(1),
          it: this.player.item,
          f: this.player.finished,
        });
      }
    }

    // --- finish → results ---
    if (this.state === 'playerFinished') {
      this.resultTimer -= dt;
      if (this.resultTimer <= 0) {
        this.state = 'done';
        this.emitResults();
      }
    }
    // safety: race timeout
    if (this.raceTime > 1000 * 60 * 8) { this.state = 'done'; this.emitResults(); }
  }

  private netAccum = 0;

  private useItem(kart: Kart) {
    const item = kart.item as ItemId;
    if (!item) return;
    // look-back rockets are a PLAYER move only (AI always fires forward)
    this.items.backwardHint = kart === this.player && this.input.state.lookBack === true;
    // pop the FIRST queued slot (compat path for AI + generic E key)
    const idx = kart.items.findIndex(i => i === item);
    kart.takeSlot(idx);
    kart.itemCooldown = 0;
    if (kart === this.player) { this.itemsUsed++; this.onLocalItem?.(item, this.items.backwardHint); }
    this.items.use(kart, item, this.racers);
  }

  /** v1.21 MP: a remote racer fired a power-up — simulate it here too so
   *  everyone SEES it and the local kart can be hit by it */
  remoteUseItem(netId: string, item: ItemId, backward: boolean) {
    const k = this.remoteKarts.get(netId);
    if (!k || this.state !== 'racing' && this.state !== 'playerFinished') return;
    this.items.backwardHint = backward;
    this.items.use(k, item, this.racers);
    this.items.backwardHint = false;
  }

  /** HUD slot button i pressed → fire exactly THAT slot (user spec) */
  useItemSlot(kart: Kart, idx: number) {
    const item = kart.takeSlot(idx) as ItemId | null;
    if (!item) return;
    // look-back rockets are a PLAYER move only (AI always fires forward)
    this.items.backwardHint = kart === this.player && this.input.state.lookBack === true;
    kart.itemCooldown = 0;
    if (kart === this.player) { this.itemsUsed++; this.onLocalItem?.(item, this.items.backwardHint); }
    this.items.use(kart, item, this.racers);
  }

  private updatePickups(dt: number) {
    // ---- item boxes: break (sound+fx+fade) → ghost → timed respawn ----
    // v3: each box is a GROUP { glass shader, metal frame, "?" billboard }
    const RESPAWN = RaceManager.BOX_RESPAWN_S;
    for (const obj of this.world.boxMeshes) {
      const g = obj as THREE.Group;
      const ud = g.userData as {
        phase: string; t: number; baseY?: number;
        glass: THREE.Mesh; frame: THREE.Mesh; qBill: THREE.Mesh;
        token?: THREE.Object3D; placedItem?: ItemId; gen?: number;
      };
      const placed = !!ud.token;
      if (ud.baseY === undefined) ud.baseY = g.position.y;
      ud.t += dt;
      const glassMat = ud.glass.material as THREE.ShaderMaterial;
      const frameMat = ud.frame.material as THREE.MeshLambertMaterial;
      const qMat = ud.qBill.material as THREE.MeshBasicMaterial;
      // inner "?" always faces the camera (a real glowing token inside glass)
      ud.qBill.quaternion.copy(this.camera.quaternion);
      switch (ud.phase) {
        case 'breaking': {
          // shrink + spin fast, then become a faint ghost
          const k = Math.min(1, ud.t / 0.22);
          g.scale.setScalar(Math.max(0.03, 1 - k));
          g.rotation.y += dt * 14;
          if (k >= 1) {
            ud.phase = 'ghost'; ud.t = 0;
            if (ud.token) ud.token.visible = false;
            glassMat.uniforms.uGhost.value = 1;
            frameMat.opacity = 0.12;
            qMat.opacity = 0;
          }
          continue;
        }
        case 'ghost': {
          g.scale.setScalar(0.62);
          g.rotation.y += dt * 0.7;
          g.position.y = ud.baseY + Math.sin(ud.t * 1.6 + g.position.x) * 0.06;
          if (ud.t >= RESPAWN) {
            ud.phase = 'spawning'; ud.t = 0;
            if (placed) { ud.gen = (ud.gen ?? 0) + 1; this.placeToken(g); }
            glassMat.uniforms.uGhost.value = 0;
            frameMat.opacity = 1;
            qMat.opacity = 1;
          }
          continue;
        }
        case 'spawning': {
          // pop-in bounce
          const k = Math.min(1, ud.t / 0.35);
          const s = 0.4 + Math.sin(k * Math.PI) * 0.75 + k * 0.2;
          g.scale.setScalar(Math.min(1.15, s));
          if (k >= 1) { g.scale.setScalar(1); ud.phase = 'active'; ud.t = 0; }
          continue;
        }
      }
      // active: bob + spin + pickup checks
      if (placed) {
        // real item: the token animates itself (spin/bob/flame/halo)
        animateToken(ud.token!, ud.t + g.position.x, dt, this.camera);
      } else {
        g.rotation.y += dt * 1.6;
        g.rotation.x = Math.sin(ud.t * 1.3 + g.position.z) * 0.14;
        g.position.y = ud.baseY + Math.sin(ud.t * 2.5 + g.position.x) * 0.1;
      }
      // sparkles near the player (premium ambient detail, throttled)
      if (this.player.pos.distanceToSquared(g.position) < 1600 && Math.random() < dt * 1.5) {
        this.particles.spawn({
          count: 1, pos: g.position.clone().add(new THREE.Vector3(rand(-0.6, 0.6), rand(-0.4, 0.8), rand(-0.6, 0.6))),
          spread: 0.1, vel: new THREE.Vector3(0, 0.7, 0), velSpread: 0.3,
          life: 0.55, size: 0.1, sizeEnd: 0.02, color: '#fff3c0', alpha: 0.95, gravity: -1.5,
        });
      }
      // MAGNET power-up (was invisible → felt broken): boxes within 9m now
      // physically drift toward the magnet kart, so the power visibly works.
      for (const mk of this.racers) {
        if (mk.magnetT <= 0 || !mk.hasFreeSlot()) continue;
        const dx = mk.pos.x - g.position.x, dz = mk.pos.z - g.position.z;
        const dm = Math.hypot(dx, dz);
        if (dm < 9 && dm > 0.4) {
          const pull = (1 - dm / 9) * 8.5 * dt;
          g.position.x += (dx / dm) * pull;
          g.position.z += (dz / dm) * pull;
          if (mk === this.player && Math.random() < dt * 8) {
            this.particles.spawn({
              count: 1, pos: g.position.clone(), spread: 0.2,
              vel: new THREE.Vector3(0, 0.8, 0), velSpread: 0.5,
              life: 0.35, size: 0.16, sizeEnd: 0.02, color: '#ff8ae0', alpha: 0.9, gravity: -2,
            });
          }
        }
      }
      for (const kart of this.racers) {
        // 3-SLOT QUEUE (user: "تا سه تا قدرت بشه گرفت"): boxes can be picked
        // while slots are free — full queue passes through
        if (!kart.hasFreeSlot()) continue;
        const radius = 1.6 * (kart.traits.boxRange ?? 1) * (kart.magnetT > 0 ? 2.0 : 1);
        const d = Math.hypot(kart.pos.x - g.position.x, kart.pos.z - g.position.z);
        if (d < radius && Math.abs(kart.pos.y - g.position.y) < 2.2) {
          // break!
          ud.phase = 'breaking'; ud.t = 0;
          if (placed && ud.placedItem) {
            // REAL ITEM: no roulette — you get exactly what you drove into
            const got = ud.placedItem;
            if (kart === this.player) { this.player.item = got; audio.itemPickupFor(got); }
            else {
              kart.item = got;
              if (kart.pos.distanceTo(this.player.pos) < 30) audio.play('boxBreak', 0.82, 0.6, this.panToward(kart.pos));
            }
          } else if (kart.hasFreeSlot()) {
            kart.itemCooldown = 0.9; // roulette delay
            if (kart === this.player) {
              // arm the self-gated roulette + queue this box's roll (3-slot cap)
              this.itemRouletteT = 0.9;
              if (this.pendingRolls < Kart.ITEM_SLOTS) this.pendingRolls++;
              audio.play('boxBreak');
            } else {
              // AI roll: bots get their item 0.9s after the break (the OLD
              // roulette rewrite only rolled for the player — bots silently
              // never received anything, which is why they seemed "too dumb
              // to use power-ups": they had NONE)
              (kart as unknown as { _aiRollT?: number })._aiRollT = 0.9;
              if (kart.pos.distanceTo(this.player.pos) < 30) audio.play('boxBreak', 0.82, 0.9, this.panToward(kart.pos));
            }
          }
          this.particles.spawn({
            count: 12, pos: g.position.clone(), vel: new THREE.Vector3(0, 2, 0), velSpread: 3,
            life: 0.45, size: 0.32, sizeEnd: 0.05, color: '#ffd54f', alpha: 0.95,
          });
          this.particles.spawn({
            count: 6, pos: g.position.clone(), vel: new THREE.Vector3(0, 1.4, 0), velSpread: 2.2,
            life: 0.5, size: 0.2, sizeEnd: 0.04, color: '#bfe9ff', alpha: 0.9, gravity: 5,
          });
          this.debris.burst(g.position.clone(), 6, '#ffe45a', 5, 0.16);
          break;
        }
      }
    }
    // boost pads v2: animated light sweep across the chevrons + pickup
    for (const pad of this.world.padMeshes) {
      const chevs = pad.userData.chevrons as THREE.Mesh[] | undefined;
      if (chevs) {
        const t = G.time.value * 7;
        for (let ci = 0; ci < chevs.length; ci++) {
          // each arrow flares in sequence toward the travel direction
          const k = Math.sin(t - ci * 1.05) * 0.5 + 0.5;
          (chevs[ci].material as THREE.MeshBasicMaterial).opacity = 0.3 + k * 0.65;
        }
      }
      for (const kart of this.racers) {
        const d = Math.hypot(kart.pos.x - pad.position.x, kart.pos.z - pad.position.z);
        if (d < 2 && Math.abs(kart.pos.y - pad.position.y) < 1.5 && kart.padCooldown <= 0) {
          kart.padCooldown = 1;
          kart.applyBoost(1.15 * (kart.traits.boostPadMul ?? 1));
          if (kart === this.player) audio.play('boostPad');
        }
      }
    }
    // NOTE: track coins were removed — rewards are rank-based (emitResults).
  }

  private updateHazards(dt: number) {
    for (const mesh of this.world.hazardMeshes) {
      const hz = mesh.userData.hazard as { type: string; sIdx: number; lane: number; phase: number; y: number };
      const s = this.data.samples[hz.sIdx];
      const t = this.raceTime / 1000 + hz.phase;
      if (hz.type === 'boulder' || hz.type === 'snowball') {
        const lane = Math.sin(t * 0.9) * s.width * 0.45;
        const p = s.pos.clone().addScaledVector(s.left, lane);
        mesh.position.set(p.x, s.pos.y + (hz.type === 'snowball' ? 1.4 : 1.1), p.z);
        mesh.rotation.z += dt * 3;
        mesh.rotation.x += dt * 2;
      } else if (hz.type === 'saw') {
        const lane = Math.sin(t * 0.7) * s.width * 0.5;
        const p = s.pos.clone().addScaledVector(s.left, lane);
        mesh.position.set(p.x, s.pos.y + 0.7, p.z);
        mesh.rotation.y += dt * 12;
      } else if (hz.type === 'geyser') {
        const col = mesh.userData.col as THREE.Mesh;
        const cycle = (t * 0.4) % 1;
        const active = cycle < 0.35;
        const scale = active ? 0.4 + Math.sin(cycle / 0.35 * Math.PI) * 1.1 : 0.01;
        col.scale.y = damp(col.scale.y, scale, 10, dt);
        col.position.y = 2.5 * col.scale.y;
        mesh.position.set(s.pos.x, s.pos.y, s.pos.z);
        if (active && Math.random() < dt * 20) {
          this.particles.spawn({
            count: 2, pos: mesh.position.clone().setY(mesh.position.y + 3 * scale), vel: new THREE.Vector3(0, 6, 0), velSpread: 2,
            life: 0.5, size: 0.4, sizeEnd: 0.1, color: this.theme.lava ? '#ff6d00' : '#e0c080', alpha: 0.8, gravity: 8,
          });
        }
      } else if (hz.type === 'ghost') {
        const lane = Math.sin(t * 0.5) * s.width * 0.4;
        const p = s.pos.clone().addScaledVector(s.left, lane);
        mesh.position.set(p.x, s.pos.y + Math.sin(t * 1.4) * 0.4, p.z);
        mesh.rotation.y += dt * 0.8;
      }
      // collision
      const danger = hz.type === 'geyser' ? ((t * 0.4) % 1) < 0.3 : true;
      if (danger) {
        for (const kart of this.racers) {
          const d = Math.hypot(kart.pos.x - mesh.position.x, kart.pos.z - mesh.position.z);
          const r = hz.type === 'snowball' ? 2.1 : hz.type === 'geyser' ? 1.6 : 1.7;
          if (d < r && Math.abs(kart.pos.y - mesh.position.y) < 2.4 && kart.invulT <= 0) {
            if (hz.type === 'geyser') {
              if (kart.shock(0.5) && kart === this.player) { this.camShake = 0.4; audio.play('bonk'); }
              kart.vy = 9; kart.grounded = false;
            } else {
              if (kart.spinOut(1) && kart === this.player) { this.camShake = 0.5; audio.play('crash'); }
            }
            kart.damage(1);   // track hazards hurt the health bar too (v1.9)
            kart.invulT = 1.2;
          }
        }
      }
    }
  }

  private updateCollisions() {
    for (let i = 0; i < this.racers.length; i++) {
      for (let j = i + 1; j < this.racers.length; j++) {
        const a = this.racers[i], b = this.racers[j];
        // 👻 GHOST phase-out: phased karts pass through everyone
        if (a.ghostT > 0 || b.ghostT > 0) continue;
        if (a.isRemote || b.isRemote) {
          // still allow push but gentler
        }
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        const minD = 1.7 * ((a.giantT > 0 ? 1.5 : 1) + (b.giantT > 0 ? 1.5 : 1)) * 0.5 + 0.6;
        if (d < minD && d > 0.001 && Math.abs(a.pos.y - b.pos.y) < 1.6) {
          const push = (minD - d) / 2;
          const nx = dx / d, nz = dz / d;
          const wa = a.T.weight * (a.traits.ironBumper ? 1.3 : 1);
          const wb = b.T.weight * (b.traits.ironBumper ? 1.3 : 1);
          const total = wa + wb;
          // v3.4 PLOW (user: "وقتی بزرگ میشم و به یکی میخورم گیر میکنم — میخوام
          // همه رو بزنم کنار، وقتی نیترو میزنم همه رو با سرعت بزنم کنار"):
          // the old giant crush did `speed *= 0.95` EVERY frame and skipped the
          // separation, so a shielded / invulnerable / already-spinning rival
          // glued the monster to its bumper until it crawled to a stop. Now the
          // monster (or a nitro/boost kart that is clearly faster) never loses
          // speed: the rival is shoved fully out of the way, launched sideways
          // and a little into the air.
          const plowA = this.plowPower(a, b), plowB = this.plowPower(b, a);
          if (plowA > 0 && plowA >= plowB) { this.plow(a, b, plowA, d, minD); continue; }
          if (plowB > 0) { this.plow(b, a, plowB, d, minD); continue; }
          a.pos.x -= nx * push * (wb / total) * 2; a.pos.z -= nz * push * (wb / total) * 2;
          b.pos.x += nx * push * (wa / total) * 2; b.pos.z += nz * push * (wa / total) * 2;
          // knockback scaled by relative speed & weight difference
          const relSpeed = Math.abs(a.speed - b.speed) + Math.min(Math.abs(a.speed), Math.abs(b.speed)) * 0.3;
          if (relSpeed > 9) {
            const heavySide = wa > wb * 1.25 ? b : wb > wa * 1.25 ? a : null;
            // v1.20 deterministic (no coin-flip physics): heavier wins, else
            // the SLOWER kart takes the knock (it was hit by the faster one)
            const victim = heavySide ?? (a.speed < b.speed ? a : b);
            if (victim.invulT <= 0) {
              victim.bounce(relSpeed * 0.07);
              victim.invulT = 0.7;
              const hitI = clamp(relSpeed / 26, 0.15, 1);
              if (victim === this.player) { this.camShake = Math.min(0.35, relSpeed * 0.02); audio.impact(hitI, 'body'); }
              else if ((victim === a ? b : a) === this.player) audio.impact(hitI * 0.8, 'body', this.panToward(victim.pos));
            }
          } else {
            a.slide -= nx * 2 * (wb / total); b.slide += nx * 2 * (wa / total);
          }
        }
      }
    }
  }

  /** v3.4: how hard kart P plows through V (0 = normal bump). Monster mode
   *  always plows a normal-size kart; nitro/boost plows when P is clearly
   *  faster (two boosting karts just bump like normal). */
  private plowPower(p: Kart, v: Kart): number {
    if (p.giantT > 0 && v.giantT <= 0) return 2;
    if (v.giantT > 0) return 0;
    const pBoost = p.nitroT > 0 ? 1.4 : p.boostT > 0 ? 1 : 0;
    if (pBoost === 0) return 0;
    const vBoost = v.nitroT > 0 ? 1.4 : v.boostT > 0 ? 1 : 0;
    if (vBoost >= pBoost) return 0;
    return p.speed > v.speed + 2.5 ? pBoost : 0;
  }

  private plow(p: Kart, v: Kart, power: number, d: number, minD: number) {
    // side = which side of the plower's nose the victim is on
    const Lx = Math.cos(p.heading), Lz = -Math.sin(p.heading);
    const rx = v.pos.x - p.pos.x, rz = v.pos.z - p.pos.z;
    let side = Math.sign(rx * Lx + rz * Lz);
    if (side === 0) side = v.id % 2 ? 1 : -1;
    // shove direction: mostly sideways, a bit along the contact normal
    const nx = rx / Math.max(1e-3, d), nz = rz / Math.max(1e-3, d);
    let sx = Lx * side + nx * 0.45, sz = Lz * side + nz * 0.45;
    const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
    const overlap = minD - d + 0.2;
    // the VICTIM moves the full overlap; the plower keeps its line + speed
    v.pos.x += sx * overlap; v.pos.z += sz * overlap;
    // sideways launch in the victim's own frame (slide = its left axis)
    const vLx = Math.cos(v.heading), vLz = -Math.sin(v.heading);
    const kick = (power >= 2 ? 9 : 5.5 + power * 2) * Math.min(1.4, 0.6 + Math.abs(p.speed) / 30);
    v.slide += (sx * vLx + sz * vLz) * kick;
    if (v.invulT > 0) return;        // already hit this contact: just keep shoving
    const hit = v.spinOut(power >= 2 ? 0.9 : 0.65);
    if (v.grounded) { v.vy = power >= 2 ? 6.5 : 4.2; v.grounded = false; }
    if (hit) v.damage(power >= 2 ? 2 : 1);
    v.speed *= power >= 2 ? 0.55 : 0.7;
    v.invulT = 0.6;
    // feedback: blocky debris in the victim's colour + sparks
    const hp = v.pos.clone().setY(v.pos.y + 0.7);
    this.debris.burst(hp, 10, v.def.bodyColor, 7, 0.2);
    this.particles.spawn({ count: 10, pos: hp, spread: 0.4, vel: new THREE.Vector3(0, 2.5, 0), velSpread: 6,
      life: 0.3, size: 0.18, sizeEnd: 0.03, color: '#ffd36a', alpha: 1, gravity: 8 });
    const isP = p === this.player, isV = v === this.player;
    if (isP || isV) {
      this.camShake = Math.max(this.camShake, isP ? 0.25 : 0.45);
      audio.impact(isP ? 0.8 : 1, 'body', isP ? 0 : this.panToward(p.pos));
    }
  }

  // ============================================================
  // v1.20 VEHICLE AUDIO — every sound driven by the physical state:
  // local engine (RPM/load/gear/boost), tires (surface/slip/brake), wall
  // impacts, power-up end cues, and up to 3 nearest rival engines in 3D.
  // ============================================================
  private prevWall = 0;
  private prevTimers = { shield: 0, giant: 0, ghost: 0, magnet: 0, boost: 0 };
  private updateVehicleAudio(dt: number) {
    const p = this.player;
    const pt = p.pt;
    audio.updateEngineState({
      rpm: pt.rpm, rpmN: pt.rpmN, throttle: pt.throttle, load: pt.load, speed: p.speed, gear: pt.gear,
      boost: p.boostT > 0, drift: p.drifting, limiter: pt.limiter,
      dead: p.stallT > 0 || p.breakdownT > 0, shiftSeq: pt.shiftSeq, lastShift: pt.lastShift,
    }, dt);
    audio.updateTires({ speed: p.speed, slip: p.slipAngle, drifting: p.drifting, braking: p.braking,
      surface: p.surface, grounded: p.grounded, lateralSide: -Math.sign(p.slide) });
    // wall impact (edge-triggered, intensity = speed into the barrier)
    if (p.wallHit > 0 && this.prevWall <= 0) {
      const mat = this.theme.id === 'sky' ? 'wood' : ['city', 'crashcity', 'mccity'].includes(this.theme.id) ? 'metal' : 'wall';
      audio.impact(clamp(p.wallHit / 14, 0.1, 1), mat, p.lateral > 0 ? -0.5 : 0.5);
    }
    this.prevWall = p.wallHit;
    // power-up END cues
    const T = this.prevTimers;
    const now = { shield: p.shieldT, giant: p.giantT, ghost: p.ghostT, magnet: p.magnetT, boost: p.boostT };
    for (const k of Object.keys(now) as (keyof typeof now)[]) {
      if (T[k] > 0 && now[k] <= 0 && k !== 'boost') audio.itemEnd(k);
      T[k] = now[k];
    }
    // rival engines: nearest 3 non-local karts, spatialised
    const cands = this.racers.filter(k => k !== p && !k.finished)
      .map(k => ({ k, d: k.pos.distanceTo(p.pos) })).filter(o => o.d < 70)
      .sort((a, b) => a.d - b.d).slice(0, 3);
    const keep = new Set<number>();
    for (const { k, d } of cands) {
      keep.add(k.id);
      if (k.isRemote) {
        // remote karts carry no engine state over the wire: estimate throttle
        // from their interpolated acceleration and run their OWN powertrain
        const acc = (k.speed - ((k as unknown as { _ps?: number })._ps ?? k.speed)) / Math.max(1e-3, dt);
        (k as unknown as { _ps?: number })._ps = k.speed;
        k.pt.step(dt, k.speed, acc > -0.5 ? 1 : 0.1, { boost: k.boostT > 0, stalled: false, grounded: true, wheelSlip: k.drifting ? 0.4 : 0, reverse: false });
      }
      const fwd = Math.atan2(k.pos.x - p.pos.x, k.pos.z - p.pos.z) - p.heading;
      const rel = Math.atan2(Math.sin(fwd), Math.cos(fwd));
      audio.updateRemoteEngine(k.id, k.pt.eng, {
        rpm: k.pt.rpm, rpmN: k.pt.rpmN, throttle: k.pt.throttle, load: k.pt.load, speed: k.speed, gear: k.pt.gear,
        boost: k.boostT > 0, drift: k.drifting, limiter: false, dead: k.stallT > 0 || k.breakdownT > 0,
        shiftSeq: k.pt.shiftSeq, lastShift: k.pt.lastShift,
      }, -Math.sin(rel), d, Math.abs(rel) > Math.PI / 2, dt);
    }
    audio.pruneRemoteEngines(keep);
  }

  private rankOrder: Kart[] = [];
  /** v3.1 SLIPSTREAM (real racing-game drafting): tuck in 3–17 m behind a
   *  rival, roughly in line with them, at speed → draftTarget ramps to 1.
   *  The character trait slipstreamMul (Vex) finally does something too. */
  private updateSlipstream() {
    const tmpF = new THREE.Vector3();
    for (const k of this.racers) {
      let best = 0;
      if (k.speed > 12 && k.grounded && !k.finished) {
        k.forward(tmpF);
        for (const o of this.racers) {
          if (o === k || o.speed < 10) continue;
          const dx = o.pos.x - k.pos.x, dz = o.pos.z - k.pos.z;
          const along = dx * tmpF.x + dz * tmpF.z;
          if (along < 3 || along > 17) continue;
          const side = Math.abs(dx * tmpF.z - dz * tmpF.x);
          if (side > 1.9) continue;
          const v = (1 - (along - 3) / 14) * (1 - side / 1.9 * 0.5);
          if (v > best) best = v;
        }
      }
      k.draftTarget = clamp(best * 1.25, 0, 1);
    }
  }

  private rankRacers() {
    this.rankOrder = this.racers.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.trackPos - a.trackPos;
    });
    this.rankOrder.forEach((k, i) => { (k as unknown as { rank: number }).rank = i + 1; });
  }
  positionOf(k: Kart): number { return (k as unknown as { rank?: number }).rank ?? this.racers.length; }

  /** v3.8 SMOOTH REMOTE KARTS. The old code stamped snapshots with their
   *  ARRIVAL time and rendered only 110 ms behind at ~10 Hz — on phone Wi-Fi
   *  packets arrive in bursts, so remote karts froze, then teleported (the
   *  "lag" players saw). Now: 20 Hz snapshots stamped with the SENDER clock,
   *  mapped onto our clock through a slowly-tracked offset (jitter removed),
   *  rendered 120 ms behind, with short velocity extrapolation if a packet
   *  is late, and gentle error blending instead of hard snaps. */
  private interpolateRemote(dt: number) {
    const now = performance.now();
    const target = now - Race_NET_DELAY_MS;
    for (const [netId, kart] of this.remoteKarts) {
      const buf = this.remoteBufs.get(netId);
      if (!buf || !buf.length) continue;
      let px: number, py: number, pz: number, h: number, v: number, tp: number;
      const last = buf[buf.length - 1];
      if (buf.length >= 2 && target <= last.t) {
        let a = buf[0], b = buf[1];
        for (let i = 0; i < buf.length - 1; i++) {
          if (buf[i + 1].t >= target) { a = buf[i]; b = buf[i + 1]; break; }
        }
        const span = Math.max(1, b.t - a.t);
        const t = clamp((target - a.t) / span, 0, 1);
        px = a.p[0] + (b.p[0] - a.p[0]) * t;
        py = a.p[1] + (b.p[1] - a.p[1]) * t;
        pz = a.p[2] + (b.p[2] - a.p[2]) * t;
        h = a.h + shortAngle(a.h, b.h) * t;
        v = a.v + (b.v - a.v) * t;
        tp = a.tp + (b.tp - a.tp) * t;
      } else {
        // late packet: dead-reckon along the last heading for up to 180 ms
        const ex = clamp((target - last.t) / 1000, 0, 0.18);
        px = last.p[0] + Math.sin(last.h) * last.v * ex;
        py = last.p[1];
        pz = last.p[2] + Math.cos(last.h) * last.v * ex;
        h = last.h; v = last.v; tp = last.tp;
      }
      // blend toward the target instead of snapping (big gaps = real teleport)
      const dx = px - kart.pos.x, dy = py - kart.pos.y, dz = pz - kart.pos.z;
      const err2 = dx * dx + dy * dy + dz * dz;
      const k = err2 > 36 ? 1 : 1 - Math.exp(-dt * 22);
      kart.pos.x += dx * k;
      kart.pos.y += dy * k;
      kart.pos.z += dz * k;
      kart.heading += shortAngle(kart.heading, h) * (err2 > 36 ? 1 : 1 - Math.exp(-dt * 20));
      kart.speed = v;
      kart.trackPos = tp;
      const b = last;
      kart.drifting = b.d !== 0;
      kart.boostT = b.b ? 0.2 : 0;
      kart.engineRatio = clamp(Math.abs(kart.speed) / kart.T.maxSpeed, 0, 1.3);
      // remote queue mirror: the snapshot only carries the remote's FIRST item
      // (b.it). Re-writing it every snapshot would push a phantom copy
      // into the next free slot each time — mirror by diffing instead.
      if ((kart.item ?? null) !== (b.it ?? null)) {
        kart.clearItems();
        if (b.it) kart.item = b.it;
      }
      kart.finished = b.f;
    }
  }

  remoteBufs = new Map<string, { t: number; p: number[]; h: number; v: number; d: number; b: boolean; tp: number; it: string | null; f: boolean }[]>();
  /** v3.8: per-peer (localClock - senderClock) estimate */
  private netOffsets = new Map<string, number>();

  applyNetState(netId: string, msg: NetState) {
    let buf = this.remoteBufs.get(netId);
    if (!buf) { buf = []; this.remoteBufs.set(netId, buf); }
    const { t, ts, ...rest } = msg;
    void t;
    const recv = performance.now();
    let stamp = recv;
    if (typeof ts === 'number') {
      // offset = the FASTEST observed path (min latency); drifts up slowly so
      // a clock change or route change is followed within a few seconds
      const sample = recv - ts;
      const prev = this.netOffsets.get(netId);
      const off = prev === undefined || sample < prev ? sample : prev + Math.min(sample - prev, 0.1);
      this.netOffsets.set(netId, off);
      stamp = ts + off;
    }
    // drop out-of-order packets (UDP-like reordering over Wi-Fi retries)
    if (buf.length && stamp <= buf[buf.length - 1].t) return;
    buf.push({ t: stamp, ...rest });
    if (buf.length > 20) buf.shift();
  }

  // ================= RENDER =================
  private camTmp = new THREE.Vector3();
  private render(alpha: number, fdt: number) {
    const time = G.time.value;
    // visuals — alpha interpolates between the last two fixed steps so karts
    // GLIDE at any refresh rate (v1.9 smoothness: "هیچ دیلی نداشته باشه")
    for (const [kart, vis] of this.visuals) {
      vis.render(fdt, this.particles, this.debris, time, alpha);
      void kart;
    }
    this.particles.update(fdt);
    this.debris.update(fdt);

    // camera follows the player's INTERPOLATED visual position
    this.updateCamera(fdt, this.playerVisual.interpPos(this.camTmp));

    // city lamp light pool
    this.updateLampLights(fdt);

    // sky dome follows camera (sun disc stays consistent from anywhere on track)
    if (this.skyDome) this.skyDome.position.set(this.camera.position.x, 0, this.camera.position.z);

    // drifting clouds
    const clouds = this.world.cloudGroup;
    if (clouds) {
      for (const c of clouds.children) {
        c.position.x += fdt * 1.6;
        if (c.position.x > 340) c.position.x = -340;
      }
    }

    // weather follows the player
    this.weather.update(fdt, this.player.pos, time);

    // shadow follows player
    if (this.sun.castShadow) {
      // v3.9 TEXEL SNAPPING: the shadow box used to slide with the car by
      // fractions of a shadow-map pixel every frame → every shadow edge in the
      // world crawled and flickered while driving (looked like a bug / lag).
      // Snapping the box to whole texels in light space keeps them rock-steady.
      const cam = this.sun.shadow.camera;
      const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.x;
      const p = this.player.pos;
      const R = RaceManager.SH_R, U = RaceManager.SH_U, F = RaceManager.SH_F;
      const r = Math.round(p.dot(R) / texel) * texel;
      const u = Math.round(p.dot(U) / texel) * texel;
      const f = p.dot(F);
      const tp = this.shTmp.copy(R).multiplyScalar(r).addScaledVector(U, u).addScaledVector(F, f);
      this.sun.target.position.copy(tp);
      this.sun.position.set(tp.x + 50, tp.y + 15, tp.z + 32);
    }

    // HUD @ 15hz
    this.lastHud += fdt;
    if (this.lastHud > 1 / 15) {
      this.lastHud = 0;
      this.emitHud();
    }

    this.renderer.render(this.scene, this.camera);
  }

  /** v1.9: pooled real lights snap to the streetlamps nearest the player —
   *  warm pools of light sweep over the car while driving a night city. */
  private updateLampLights(dt: number) {
    if (!this.lampLights.length) return;
    this.lampTimer -= dt;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.3;
      const pp = this.player.pos;
      this.activeLamps = this.world.lampPositions
        .filter(l => Math.abs(l.x - pp.x) < 44 && Math.abs(l.z - pp.z) < 44)
        .sort((a, b) => a.distanceToSquared(pp) - b.distanceToSquared(pp))
        .slice(0, this.lampLights.length);
    }
    for (let i = 0; i < this.lampLights.length; i++) {
      const L = this.lampLights[i];
      const lp = this.activeLamps[i];
      // v3.8 PERF: lights stay visible (intensity 0 when unused). Toggling
      // .visible changes the scene's light count → every material recompiles
      // → the stutter you felt while driving past street lamps at night.
      if (lp) {
        L.position.set(lp.x, lp.y + 3.0, lp.z);
        L.intensity = 30;
      } else {
        L.intensity = 0;
      }
    }
  }

  // BUGFIX (loud repetitive sound at race start): fx sounds below were played
  // EVERY fixed 60Hz tick while the fx state was active — a single landing
  // fired 'land' 9x in a burst and a fall fired 'splash' 24x (sounded like a
  // loud repeating coin machine). Now each fx sound plays exactly ONCE, on the
  // tick the fx state first appears.
  private prevPlayerFx: Kart['fx'] = 'none';

  // v3.9 shadow texel-snapping basis (sun direction is constant per race)
  private static SH_F = new THREE.Vector3(-50, -15, -32).normalize();
  private static SH_R = new THREE.Vector3().crossVectors(RaceManager.SH_F, new THREE.Vector3(0, 1, 0)).normalize();
  private static SH_U = new THREE.Vector3().crossVectors(RaceManager.SH_R, RaceManager.SH_F).normalize();
  private shTmp = new THREE.Vector3();
  private camPos = new THREE.Vector3(0, 5, -8);
  private camLook = new THREE.Vector3();
  private updateCamera(dt: number, pIp?: THREE.Vector3) {
    const k = this.player;
    const kPos = pIp ?? k.pos;   // interpolated visual position (smooth chase)
    const fwd = k.forward(new THREE.Vector3());
    const boost = k.boostT > 0;
    const lookBack = this.input.state.lookBack;

    /** ROAD-CLAMP helper (user bug: "جاده یه باگی داره، میرم داخلش"): on
     *  climbs/descents the chase cam floats BEHIND the kart — straight into
     *  the raised road behind the crest, so the screen filled with asphalt
     *  and it looked like the car drove "inside" the road. The camera is now
     *  clamped above the road surface at its own (x,z) too, not just the
     *  terrain. groundInfo is O(1) (spatial hash) so this is per-frame safe. */
    const clampAboveRoad = (p: THREE.Vector3, minAbove = 0.85) => {
      const gi = this.data.groundInfo(p.x, p.z);
      if (gi.d < 24 && gi.h > p.y - minAbove) p.y = gi.h + minAbove;
    };

    if (this.state === 'countdown') {
      // cinematic orbit: sweep from front-side to behind (tight, avoids gate pillars)
      const t = clamp(1 - this.countdownT / 3.9, 0, 1);
      const ang = k.heading + Math.PI + Math.sin(t * Math.PI) * 0.7;
      const dist = 5.6 - t * 1.4;
      const target = new THREE.Vector3(
        kPos.x + Math.sin(ang) * dist,
        kPos.y + 2.9 - t * 0.8,
        kPos.z + Math.cos(ang) * dist
      );
      // keep camera above terrain AND above the road deck
      const gY = this.data.groundAt(target.x, target.z);
      if (gY > -9000) target.y = Math.max(target.y, gY + 1.7);
      clampAboveRoad(target, 1.2);
      this.camPos.lerp(target, 1 - Math.exp(-4.5 * dt));
      this.camLook.lerp(kPos.clone().add(new THREE.Vector3(0, 1, 0)), 1 - Math.exp(-6 * dt));
    } else if (this.firstPerson) {
      // FIRST-PERSON head-cam (v1.8 settings toggle): sits at the driver's
      // eyes, looks ahead along the kart's heading; look-back mirrors it.
      this.playerVisual.hideBody = true;
      const dirFp = lookBack ? -1 : 1;
      const head = kPos.clone()
        .addScaledVector(fwd, 0.34 * dirFp)
        .add(new THREE.Vector3(0, 1.02 * (k.giantT > 0 ? 1.6 : 1), 0));
      clampAboveRoad(head, 0.6);
      this.camPos.copy(head);
      const look = kPos.clone()
        .addScaledVector(fwd, 26 * dirFp)
        .add(new THREE.Vector3(0, 1.15, 0));
      this.camLook.lerp(look, 1 - Math.exp(-22 * dt));
    } else {
      this.playerVisual.hideBody = false;
      const dirV = lookBack ? -1 : 1;
      const driftOff = k.drifting ? -k.driftDir * 0.9 : 0;
      const leftV = new THREE.Vector3(Math.cos(k.heading), 0, -Math.sin(k.heading));
      // portrait phones need a longer arm (user: "camera can't keep up with the
      // car — the picture trembles"): pull back when the aspect is tall, plus a
      // small speed-based arm so the car never fills the frame at top speed.
      const aspect = this.camera.aspect;
      const portraitMul = aspect < 1 ? 1 + (1 - aspect) * 0.62 : 1;
      const speedArm = clamp(Math.abs(k.speed) / k.T.maxSpeed, 0, 1) * 0.7;
      const arm = (4.7 + speedArm) * portraitMul;
      const target = kPos.clone()
        .addScaledVector(fwd, -arm * dirV - (boost ? -0.5 : 0))
        .addScaledVector(leftV, driftOff)
        .add(new THREE.Vector3(0, 2.15 + (boost ? 0.25 : 0) + (portraitMul - 1) * 0.5, 0));
      // SMOOTH CAMERA (user: "the camera must follow softly and fluidly"):
      // the old clamp snapped to the nearest spline sample height (a step
      // function) → camera bobbed at speed. The kart's own pos.y is now
      // continuous, so clamping against it keeps the chase butter-smooth.
      target.y = Math.max(target.y, kPos.y + 1.25);
      const gYc = this.data.groundAt ? this.data.groundAt(target.x, target.z) : -9999;
      if (gYc > -9000) target.y = Math.max(target.y, gYc + 1.6);
      clampAboveRoad(target, 0.9);
      const look = kPos.clone().addScaledVector(fwd, 3.2 * dirV).add(new THREE.Vector3(0, 1.05, 0));
      // LOOK-BACK = ZERO MOTION FX (user: "بدون هیچ افکت حرکتی عقب نشون بده
      // کامل"): the frame the button is pressed the camera TELEPORTS to the
      // full rear view (no swing), and the frame it's released it TELEPORTS
      // straight back. While held it tracks tightly so the rear picture is
      // rock-stable. Normal chase keeps its buttery damping.
      if (lookBack !== this.prevLookBack) {
        this.camPos.copy(target);
        this.camLook.copy(look);
      } else if (lookBack) {
        this.camPos.lerp(target, 1 - Math.exp(-26 * dt));   // near-locked follow
        this.camLook.lerp(look, 1 - Math.exp(-30 * dt));
      } else {
        // exponential (frame-rate independent) damping — buttery follow.
        this.camPos.lerp(target, 1 - Math.exp(-6.2 * dt));
        this.camLook.lerp(look, 1 - Math.exp(-8.5 * dt));
      }
      this.prevLookBack = lookBack;
    }

    this.camera.position.copy(this.camPos);
    if (this.camShake > 0) {
      this.camShake = Math.max(0, this.camShake - dt * 2.2);
      // gentle vertical-dominant shake, softened further in v1.8 (user:
      // "انقدر تکون علکی نخوره")
      const a = this.camShake * 0.1;
      this.camera.position.y += rand(-a, a);
      this.camera.position.x += rand(-a, a) * 0.5;
    }
    this.camera.lookAt(this.camLook);
    const fp = this.firstPerson && this.state !== 'countdown';
    const targetFov = (fp ? 72 : 62) + (boost ? 8 : 0) + (k.nitroT > 0 ? 9 : 0) + clamp(k.speed / k.T.maxSpeed, 0, 1.8) * 3 + k.overdrive * 5 + k.draft * 2;
    this.camFov = damp(this.camFov, targetFov, k.nitroT > 2.3 ? 9 : 4, dt);
    if (k.nitroT > 2.45) this.camShake = Math.max(this.camShake, 0.55);
    this.camera.fov = this.camFov;
    this.camera.aspect = this.renderer.domElement.width / this.renderer.domElement.height;
    this.camera.updateProjectionMatrix();
  }

  // ================= HUD / results =================
  physMs = 0;
  private adaptiveRes = new AdaptiveResolution();
  frameMs = 16.7;
  /** network round-trip (set by the MP client), shown in the debug overlay */
  rttMs = -1;

  private evSnap() {
    const N = this.data.samples.length;
    const lapNow = clamp(Math.floor(this.player.trackPos / N) + 1, 1, this.data.laps);
    return {
      raceMs: this.raceTime, pos: this.positionOf(this.player), total: this.racers.length,
      drift: this.driftTimeAcc, items: this.itemsUsed, jumps: this.jumpCount, hp: this.player.hp, spinouts: this.spinouts,
      lap: lapNow, laps: this.data.laps, finalLap: !this.data.open && lapNow === this.data.laps,
      hasJumps: !!this.theme?.jumpGap,
    };
  }

  private updateEvents(dt: number) {
    if (!this.mpMode && !this.events) {
      this.events = new RaceEvents(!this.mods.has('noitems'), this.level.rewardMul || 1);
      this.events.onMsg = (txt, gold) => {
        // never cover a wreck / breakdown warning that is still showing
        if (this.hudMsgT > 0.4 && !this.hudMsg.startsWith('\u200b')) return;
        this.hudMsg = (gold ? '\u200b' : '') + txt;
        this.hudMsgT = 1.6;
      };
      this.events.onReward = (kind) => {
        const P = this.player;
        if (kind === 'nitro') {
          P.applyNitro(1.4);
          audio.play('reward');
          this.particles.spawn({
            count: 22, pos: P.pos.clone(), spread: 0.7,
            vel: new THREE.Vector3(0, 2, 0), velSpread: 3.2,
            life: 0.6, size: 0.4, sizeEnd: 1.1, color: '#6fe3ff', alpha: 0.95, gravity: 0,
          });
        } else if (P.hasFreeSlot()) {
          P.item = rollItem(this.positionOf(P), this.racers.length, !!P.traits.itemLuck, this.enabledItems) as ItemId;
          audio.play('coin');
        }
      };
    }
    this.events?.update(dt, this.evSnap());
    // live goal transitions -> banner + sound (the moment the kid KNOWS the star is his)
    const g = this.goalState();
    if (g && g.state !== this.goalPrev) {
      if (g.state === 'done') { this.hudMsg = '\u200b🎯 ' + t('goalDone'); this.hudMsgT = 2; audio.play('reward'); }
      else if (g.state === 'fail' && this.goalPrev !== 'fail') { this.hudMsg = t('goalFail'); this.hudMsgT = 1.8; }
      this.goalPrev = g.state;
    }
  }

  /** v3.5 LIVE STAGE GOAL (career): what the goal is, how close you are, right now */
  private goalState(): GoalHud | null {
    const lv = this.level;
    if (!lv || lv.id <= 0 || this.mpMode) return null;
    const fa = getLang() === 'fa';
    const Nn = (n: number | string) => (fa ? faDigits(n) : String(n));
    const o = lv.objective;
    const P = this.player;
    const pos = this.positionOf(P);
    const total = Math.max(2, this.racers.length);
    const fin = P.finished;
    switch (o.type) {
      case 'finish1':
      case 'finish3': {
        const target = o.type === 'finish1' ? 1 : 3;
        const on = pos <= target;
        return { txt: t(o.type === 'finish1' ? 'gl_finish1' : 'gl_finish3', Nn(pos)), frac: on ? 1 : 1 - (pos - target) / (total - target), state: fin ? (on ? 'done' : 'fail') : on ? 'ok' : 'run' };
      }
      case 'time': {
        const lim = (o.param ?? 120) * 1000;
        const left = lim - this.raceTime;
        return { txt: t('gl_time', Nn(Math.max(0, Math.ceil(left / 1000)))), frac: Math.max(0, left / lim), state: left < 0 ? 'fail' : fin ? 'done' : 'run' };
      }
      case 'drift': {
        const need = o.param ?? 10;
        const d = Math.min(need, this.driftTimeAcc);
        return { txt: t('gl_drift', Nn(Math.floor(d)), Nn(need)), frac: d / need, state: d >= need ? 'done' : 'run' };
      }
      case 'items': {
        const need = o.param ?? 2;
        const u = Math.min(need, this.itemsUsed);
        return { txt: t('gl_items', Nn(u), Nn(need)), frac: u / need, state: u >= need ? 'done' : 'run' };
      }
      case 'survive': {
        const broke = !!P.breakdownDone;
        return { txt: t('gl_survive'), frac: Math.max(0, P.hp / Math.max(1, P.maxHp)), state: broke ? 'fail' : fin ? (pos <= 5 ? 'done' : 'fail') : 'ok' };
      }
      case 'clean': {
        const hit = this.spinouts > 0;
        return { txt: t('gl_clean', Nn(pos)), frac: hit ? 0 : pos === 1 ? 1 : 1 - (pos - 1) / (total - 1), state: hit ? 'fail' : fin ? (pos === 1 ? 'done' : 'fail') : pos === 1 ? 'ok' : 'run' };
      }
    }
    return null;
  }

  private emitHud() {
    if (!this.onHud) return;
    const P = this.player, pt = P.pt;
    const N = this.data.samples.length;
    const rank = this.positionOf(this.player);
    const minimap = this.world.minimapCache ?? (this.world.minimapCache = minimapPath(this.data));
    const mm = minimap.pts;
    const toMinimap = (kart: Kart) => {
      const idx = ((Math.round(kart.trackPos) % N) + N) % N;
      const p = mm[Math.min(mm.length - 1, Math.floor(idx / 6) )];
      return { x: p[0], z: p[1], isLocal: kart === this.player, color: kart.def.bodyColor };
    };
    this.onHud({
      countdown: this.state === 'countdown' ? Math.max(0, Math.ceil(this.countdownT - 0.5)) : -1,
      goFlash: this.state === 'racing' && this.raceTime < 900 ? 1 : 0,
      position: rank,
      totalRacers: this.racers.length,
      lap: clamp(Math.floor(this.player.trackPos / N) + 1, 1, this.data.laps),
      laps: this.data.laps,
      timeMs: this.raceTime,
      racers: this.rankOrder.map((k2, i) => ({ name: k2.name, pos: i + 1, isLocal: k2 === this.player, iconColor: k2.def.bodyColor, finished: k2.finished })),
      wrongWay: this.player.wrongWay,
      // v1.22: final lap = the last lap is IN PROGRESS (lapNow == laps-1).
      // The old check (kart.lap === laps-1) could never be true because
      // kart.lap is clamped to laps — the FINAL LAP banner never showed.
      finalLap: !this.data.open && Math.floor(this.player.trackPos / N) === this.data.laps - 1 && !this.player.finished,
      driftCharge: clamp(this.player.driftCharge / 1.7, 0, 1),
      driftTier: this.player.driftTier,
      item: this.player.item as ItemId | null,
      items: this.player.items as (ItemId | null)[],
      itemCooldown: this.player.itemCooldown,
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      hurtFlash: this.player.hurtT > 0 && this.player.hurtT < 0.5,
      boost: this.player.boostT > 0,
      speedFrac: this.player.engineRatio,
      overdrive: this.player.overdrive,
      draft: this.player.draft,
      recovered: this.recoverMsgT > 0,
      hudMsg: this.hudMsgT > 0 ? this.hudMsg : '',
      goal: this.goalState(),
      mission: this.events && !this.player.finished ? this.events.hud(this.evSnap()) : null,
      minimapRacers: this.racers.map(toMinimap),
      finished: this.player.finished,
      kmh: Math.abs(P.speed) * 3.6,
      rpm: pt.rpm, rpmN: pt.rpmN, redline: pt.eng.redline,
      gear: pt.gear, electric: pt.eng.electric, limiter: pt.limiter,
      dbg: DBG.on ? {
        fps: this.loop.fps, frameMs: this.frameMs, physMs: this.physMs, rttMs: this.rttProvider ? this.rttProvider() : this.rttMs,
        speed: P.speed * 3.6,
        targetSpeed: pt.equilibrium(P.surfaceRoad ? SURFACES_ROLL(P.surfaceMap.road) : SURFACES_ROLL(P.surfaceMap.off), P.boostT > 0) * 3.6,
        rpm: pt.rpm, gear: pt.gear, throttle: pt.throttle, brake: P.braking, drift: P.drifting,
        slipDeg: P.slipAngle * 57.3, grip: P.gripNow, surface: P.surface, boost: Math.max(0, P.boostT),
        load: pt.load, voices: audio.voiceCount, cls: pt.cls.id, engine: pt.eng.kind, quality: this.quality,
      } : undefined,
    });
  }

  private emitResults() {
    if (!this.onResults) return;
    // final ranking: unfinished racers ranked by progress
    this.rankRacers();
    const pos = this.positionOf(this.player);
    const total = this.racers.length;
    const lv = this.level;
    const mul = lv.rewardMul;
    // ---- RANK-BASED PAYOUT (track coins removed by design) ----
    // generous-ish but not infinite: rank table + skill bonuses
    const posCoins = [400, 300, 230, 170, 130, 100][Math.min(pos - 1, 5)];
    let bonus = 0;
    if (this.bestLapMs > 0) bonus += 50;                       // fast lap
    bonus += Math.min(150, Math.round(this.driftTimeAcc * 5)); // drift skill
    if (this.spinouts === 0 && pos <= 3) bonus += 40;          // clean podium
    if (this.player.usedMagnet) bonus += 60;                   // magnet bonus
    const evCoins = this.events?.coins ?? 0;           // v3.5 overtakes + missions
    const coins = Math.round((posCoins + bonus) * mul) + evCoins;
    const xp = Math.round((60 + (total - pos) * 15 + this.driftTimeAcc * 2) * mul);
    const parts = pos <= 3 ? Math.round((4 - Math.min(pos, 3)) * mul) : 0;
    let gems = 0;
    if (pos === 1 && lv.unlockGems) gems = lv.unlockGems;

    // objective
    let objDone = false;
    const o = lv.objective;
    switch (o.type) {
      case 'finish1': objDone = pos === 1; break;
      case 'finish3': objDone = pos <= 3; break;
      case 'survive': objDone = !this.player.breakdownDone && pos <= 5; break;   // v3.2: never break down
      case 'time': objDone = this.raceTime < (o.param ?? 120) * 1000; break;
      case 'drift': objDone = this.driftTimeAcc >= (o.param ?? 10); break;
      case 'items': objDone = this.itemsUsed >= (o.param ?? 2); break;
      case 'clean': objDone = pos === 1 && this.spinouts === 0; break;
      default: objDone = false;
    }
    // v3.2 clear star rules: ★ podium  ★ stage goal  ★ win
    const stars = (pos <= 3 ? 1 : 0) + (objDone ? 1 : 0) + (pos === 1 ? 1 : 0);

    this.onResults({
      position: pos, total, timeMs: this.raceTime,
      coins, xp, parts, gems, stars, objectiveDone: objDone,
      driftTime: this.driftTimeAcc, bestLapMs: this.bestLapMs,
      itemsUsed: this.itemsUsed, jumps: this.jumpCount,
      overtakes: this.events?.overtakes ?? 0, missions: this.events?.missionsDone ?? 0, eventCoins: evCoins,
    });
  }

  getHudItemInfo(item: ItemId | null) { return item ? ITEMS[item] : null; }
  charName(id: string) { return charById(id).name; }
  fmtT(ms: number) { return fmtTime(ms); }
}

export interface NetState {
  t: 's';
  /** v3.8: sender clock (ms) — lets the receiver remove Wi-Fi jitter */
  ts?: number;
  p: number[]; h: number; v: number; d: number; b: boolean; tp: number; it: string | null; f: boolean;
}
export type NetMsg = NetState;

/** v3.8 remote render delay (ms): > 2 snapshots at 20 Hz + Wi-Fi jitter */
const Race_NET_DELAY_MS = 120;

function shortAngle(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
