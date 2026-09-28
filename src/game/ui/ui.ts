// KUBO KARTS - UI framework: screen stack, HUD (touch controls), toasts, modals.
import type { RaceManager, RaceHudData } from '../race/race';
import type { InputSystem } from '../core/input';
import { audio } from '../core/audio';
import { DBG } from '../core/debug';
import { t, isRTL, setLang, type Lang } from '../core/lang';
import { clamp, fmtTime } from '../core/utils';
import { ITEMS, type ItemId } from '../items/items';
import { itemIconDataURL, heartDataURL } from './icons';
import { ic } from './icons3';
import './lang31';
import './lang35';
import { applyHudLayout, applyHudPresetClass, effectiveLayout } from './hudLayout';
import type { Meta } from '../meta/meta';

export function el<K extends keyof HTMLElementTagNameMap = 'div'>(
  tag: K, cls?: string, parent?: HTMLElement, html?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export type ScreenDef = {
  el: HTMLElement;
  onShow?: (params?: unknown) => void;
  onHide?: () => void;
};

export class UIManager {
  root: HTMLElement;
  screens = new Map<string, ScreenDef>();
  current: string | null = null;
  hud: HudController;
  meta: Meta;
  onQuitRace: (() => void) | null = null;
  onRestartRace: (() => void) | null = null;

  constructor(root: HTMLElement, meta: Meta, input: InputSystem) {
    this.root = root;
    this.meta = meta;
    this.hud = new HudController(this, input);
    applyLangClass(root, meta.data.settings.lang);
  }

  register(name: string, def: ScreenDef) { this.screens.set(name, def); }

  show(name: string, params?: unknown) {
    const prev = this.current ? this.screens.get(this.current) : null;
    if (prev && prev.el !== this.screens.get(name)?.el) {
      prev.onHide?.();
      prev.el.classList.add('out');
      const pEl = prev.el;
      setTimeout(() => pEl.remove(), 180);
    }
    const def = this.screens.get(name);
    if (!def) return;
    this.current = name;
    def.el.classList.remove('out');
    if (def.el.parentElement !== this.root) this.root.appendChild(def.el);
    try {
      def.onShow?.(params);
    } catch (e) {
      console.error('[kubo] onShow failed for', name, e);
    }
  }

  clearScreens() {
    for (const [, def] of this.screens) {
      def.onHide?.();
      def.el.remove();
      def.el.classList.remove('out');
    }
    this.current = null;
  }

  closeCurrent() {
    const prev = this.current ? this.screens.get(this.screensCurrentName()) : null;
    if (prev) { prev.onHide?.(); prev.el.remove(); }
    this.current = null;
  }
  private screensCurrentName(): string { return this.current ?? ''; }

  toast(msg: string, type: 'good' | 'bad' | '' = '') {
    let host = this.root.querySelector('#toasts') as HTMLElement;
    if (!host) host = el('div', '', this.root, ''); host.id = 'toasts';
    const tt = el('div', `toast ${type}`, host, msg);
    setTimeout(() => tt.remove(), 2600);
  }

  modal(title: string, bodyHtml: string, buttons: { label: string; cls?: string; cb: () => void }[]) {
    const wrap = el('div', 'modal-wrap', this.root);
    const modal = el('div', 'modal panel', wrap);
    el('h2', '', modal, title);
    const p = el('p', '', modal);
    p.innerHTML = bodyHtml;
    const row = el('div', 'row', modal);
    for (const b of buttons) {
      const btn = el('button', `btn small ${b.cls ?? ''}`, row, b.label);
      btn.onclick = () => { audio.play('click'); wrap.remove(); b.cb(); };
    }
    audio.play('click');
    return wrap;
  }

  applyLanguage(lang: Lang) {
    this.meta.data.settings.lang = lang;
    setLang(lang);
    applyLangClass(this.root, lang);
    this.meta.save();
    // LANGUAGE FIX (user: "زبان فارسی کار نمی‌کند"): screens bake their strings
    // at register time, so just flipping the lang flag left the UI in English.
    // A full reload re-runs every registerXxx with the new dictionary — every
    // screen, the HUD, boot tips and results all come back in the new language.
    // Settings are already saved, so the reload boots straight into Persian.
    try {
      const splash = el('div', 'lang-switch-splash', this.root,
        lang === 'fa' ? 'در حال تغییر زبان…' : 'Switching language…');
      splash.style.cssText =
        'position:absolute;inset:0;z-index:999;background:#0a0e18;color:#fff;' +
        'display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px';
    } catch { /* cosmetic only */ }
    setTimeout(() => location.reload(), 260);
  }
}

function applyLangClass(root: HTMLElement, lang: Lang) {
  root.classList.toggle('rtl', isRTL());
  root.setAttribute('dir', isRTL() ? 'rtl' : 'ltr');
  void lang;
}

// ================= HUD =================
export class HudController {
  el: HTMLElement;
  private race: RaceManager | null = null;
  private input: InputSystem;
  private ui: UIManager;
  private minimapCtx: CanvasRenderingContext2D | null = null;
  private minimapPath: [number, number][] | null = null;
  private minimapBreak: number | null = null;
  private cdEl: HTMLElement;
  private centerEl: HTMLElement;
  private wrongWayShown = false;
  private wheelVisEl: HTMLElement | null = null;

  constructor(ui: UIManager, input: InputSystem) {
    this.ui = ui;
    this.input = input;
    this.el = el('div', '');
    this.el.id = 'hud';
    this.el.style.display = 'none';

    // top left: position + racer list
    const tl = el('div', 'hud-top-left', this.el);
    this.posEl = el('div', 'position-big', tl, '1<small>/6</small>');
    this.racerListEl = el('div', 'racer-list', tl);

    // top right: timer + minimap
    const tr = el('div', 'hud-top-right', this.el);
    this.timerEl = el('div', 'timer', tr, '00:00.00');
    const mmBox = el('div', 'minimap-box', tr);
    const mmCanvas = document.createElement('canvas');
    mmCanvas.width = 148; mmCanvas.height = 148;
    mmBox.appendChild(mmCanvas);
    this.minimapCtx = mmCanvas.getContext('2d');

    // v1.20 INSTRUMENT CLUSTER — top-center speedometer (KM/H, straight from
    // physics, smoothly interpolated) + RPM arc with LOW/MID/HIGH/REDLINE
    // zones taken from the car's EngineProfile + gear indicator.
    this.buildSpeedo();
    // development debug overlay (?debug=1, F3 or backtick)
    this.buildDebug();

    // center: lap pill, messages
    this.lapEl = el('div', 'lap-pill', this.el, '');
    this.centerEl = el('div', 'center-msg', this.el, '');
    // v3.5 LIVE STAGE GOAL bar + MINI-MISSION chip (top centre, under the lap pill)
    this.goalWrap = el('div', 'ev-stack', this.el);
    this.goalEl = el('div', 'goal-bar', this.goalWrap);
    this.goalEl.innerHTML = `<span class="gb-ic">${ic('target', 15)}</span><span class="gb-tx"></span><span class="gb-bar"><i></i></span>`;
    this.missionEl = el('div', 'mission-chip', this.goalWrap);
    this.missionEl.innerHTML = `<span class="mc-ic">${ic('bolt', 15)}</span><span class="mc-tx"></span><span class="mc-t"></span><span class="mc-bar"><i></i></span>`;
    this.cdEl = el('div', '', this.el, '');
    this.cdEl.id = 'countdown-overlay';
    const cdNum = el('div', '', this.cdEl, '');
    cdNum.id = 'countdown-num';

    // drift meter
    const dm = el('div', 'drift-meter', this.el);
    dm.id = 'drift-meter';
    dm.innerHTML = '<div class="fill"></div><div class="lbl">DRIFT</div>';
    this.driftMeter = dm;

    // boost speed vignette (better fx pass): radial speed-lines overlay that
    // fades in while boosting / at very high speed
    this.boostFxEl = el('div', 'boost-fx', this.el);
    this.boostFxEl.innerHTML = '<div class="bf-ring"></div><div class="bf-lines"></div>';
    // v3.1 speed-breaker / slipstream badges (top-center, under the lap bar)
    this.odEl = el('div', 'od-badges', this.el);
    // v3.2: the SPEED-BREAKER badge is gone (user: "اون شکستن سرعت که خودش میاد
    // روی صفحه حذف کن") — it still works, silently, like in real life. Only a
    // tiny wind icon remains for slipstream (no text).
    this.odEl.innerHTML = `<div class="od-b od-sb" style="display:none"><i class="od-bar"><b></b></i></div><div class="od-b od-df"><span class="od-ic">${ic('wind', 14)}</span></div>`;

    this.buildTouchControls();
  }

  // ---------------- v1.20 speedometer / RPM / gear ----------------
  private spd!: { root: HTMLElement; num: HTMLElement; gear: HTMLElement; zone: HTMLElement; rpmTxt: HTMLElement; segs: SVGPathElement[] };
  private spdShown = 0;
  private spdLast = 0;
  private static SEGS = 26;
  private buildSpeedo() {
    const root = el('div', 'speedo', this.el);
    root.id = 'speedo';
    const n = HudController.SEGS;
    // semicircular segmented arc (SVG) — each segment lit up to rpmN
    let paths = '';
    const cx = 90, cy = 88, r1 = 70, r2 = 82;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI * (1 - i / n) - 0.012, a1 = Math.PI * (1 - (i + 1) / n) + 0.012;
      const p = (r: number, a: number) => `${(cx + Math.cos(a) * r).toFixed(1)},${(cy - Math.sin(a) * r).toFixed(1)}`;
      paths += `<path class="seg" d="M${p(r1, a0)} L${p(r2, a0)} A${r2},${r2} 0 0 1 ${p(r2, a1)} L${p(r1, a1)} A${r1},${r1} 0 0 0 ${p(r1, a0)} Z"/>`;
    }
    root.innerHTML = `<svg class="sp-arc" viewBox="0 0 180 96" aria-hidden="true">${paths}</svg>
      <div class="sp-read"><span class="sp-num">0</span><span class="sp-unit">KM/H</span></div>
      <div class="sp-gear">N</div>
      <div class="sp-foot"><span class="sp-zone">LOW</span><span class="sp-rpm">0.0 ×1000 RPM</span></div>`;
    this.spd = {
      root, num: root.querySelector('.sp-num')!, gear: root.querySelector('.sp-gear')!, zone: root.querySelector('.sp-zone')!,
      rpmTxt: root.querySelector('.sp-rpm')!, segs: Array.from(root.querySelectorAll('.seg')) as SVGPathElement[],
    };
  }
  private updateSpeedo(h: RaceHudData) {
    if (!this.spd || h.kmh === undefined) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - (this.spdLast || now)) / 1000);
    this.spdLast = now;
    // smooth interpolation toward the PHYSICS speed (no sudden jumps, no fake)
    this.spdShown += (h.kmh - this.spdShown) * Math.min(1, dt * 9);
    if (Math.abs(this.spdShown - h.kmh) < 0.05) this.spdShown = h.kmh;
    this.spd.num.textContent = String(Math.round(this.spdShown));
    this.spd.gear.textContent = h.electric ? 'E' : h.gear < 0 ? 'R' : h.kmh < 1 && h.gear <= 1 ? 'N' : String(h.gear);
    const rN = Math.max(0, Math.min(1.02, h.rpmN));
    const lit = Math.round(rN * HudController.SEGS);
    const redStart = Math.floor(HudController.SEGS * 0.86);
    for (let i = 0; i < this.spd.segs.length; i++) {
      const seg = this.spd.segs[i];
      const cls = i < lit ? (i >= redStart ? 'seg on red' : i >= HudController.SEGS * 0.66 ? 'seg on high' : i >= HudController.SEGS * 0.33 ? 'seg on mid' : 'seg on low') : (i >= redStart ? 'seg rz' : 'seg');
      if (seg.getAttribute('class') !== cls) seg.setAttribute('class', cls);
    }
    const zone = rN >= 0.86 ? 'REDLINE' : rN >= 0.66 ? 'HIGH' : rN >= 0.33 ? 'MID' : 'LOW';
    if (this.spd.zone.textContent !== zone) { this.spd.zone.textContent = zone; this.spd.zone.dataset.z = zone; }
    this.spd.rpmTxt.textContent = `${(h.rpm / 1000).toFixed(1)} ×1000 RPM`;
    this.spd.root.classList.toggle('boost', h.boost);
    this.spd.root.classList.toggle('limiter', h.limiter);
    this.spd.root.style.setProperty('--sp-glow', String(Math.min(1, h.speedFrac)));
  }

  // ---------------- v1.20 debug overlay ----------------
  private dbgEl: HTMLElement | null = null;
  private buildDebug() {
    const want = (typeof location !== 'undefined' && /[?&]debug=1/.test(location.search))
      || (typeof localStorage !== 'undefined' && localStorage.getItem('kubo_debug') === '1');
    DBG.on = want;
    this.dbgEl = el('div', 'dbg-overlay', this.el);
    this.dbgEl.id = 'dbg-overlay';
    this.dbgEl.style.display = want ? 'block' : 'none';
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'F3' || e.key === '`') {
          DBG.on = !DBG.on;
          try { localStorage.setItem('kubo_debug', DBG.on ? '1' : '0'); } catch { /* private mode */ }
          if (this.dbgEl) this.dbgEl.style.display = DBG.on ? 'block' : 'none';
          e.preventDefault();
        }
      });
    }
  }
  private updateDebug(h: RaceHudData) {
    if (!this.dbgEl || !DBG.on || !h.dbg) return;
    const d = h.dbg;
    const f = (v: number, n = 1) => v.toFixed(n);
    this.dbgEl.textContent =
`FPS ${d.fps}  frame ${f(d.frameMs)}ms  phys ${f(d.physMs, 2)}ms  RTT ${d.rttMs < 0 ? '—' : f(d.rttMs, 0) + 'ms'}
speed ${f(d.speed)} km/h  target ${f(d.targetSpeed)} km/h
RPM ${f(d.rpm, 0)}  gear ${d.gear}  load ${f(d.load, 2)}
throttle ${f(d.throttle, 2)}  brake ${d.brake ? 'ON' : 'off'}  drift ${d.drift ? 'ON' : 'off'}
slip ${f(d.slipDeg)}°  grip ${f(d.grip * 100, 0)}%  surface ${d.surface}
boost ${f(d.boost, 2)}s  voices ${d.voices}
class ${d.cls}  engine ${d.engine}  gfx ${d.quality}`;
  }

  private posEl: HTMLElement;
  private racerListEl: HTMLElement;
  private timerEl: HTMLElement;
  private lapEl: HTMLElement;
  private driftMeter: HTMLElement;
  private boostFxEl: HTMLElement;
  private boostFxOn = false;
  private odEl!: HTMLElement;
  private goalWrap!: HTMLElement;
  private goalEl!: HTMLElement;
  private missionEl!: HTMLElement;
  private goalKey = '';
  private missionKey = '';
  private slotBtns: HTMLElement[] = [];
  private lastCountdown = 99;
  private driftFill: HTMLElement | null = null;
  private hpEl: HTMLElement | null = null;
  private hpBuiltMax = -1;
  private hpShown = -1;
  private lightBtn: HTMLElement | null = null;
  private lightBtnTapped = false;

  private buildTouchControls() {
    const input = this.input;

    // ---- steering zone (WHEEL mode): drag anywhere in the left zone ----
    const zone = el('div', '', this.el);
    zone.id = 'wheel-zone';
    const wheelVis = el('div', '', zone);
    wheelVis.id = 'wheel-vis';
    this.wheelVisEl = wheelVis;
    el('div', 'hub', wheelVis);
    let wheelActive = false;
    const applyZone = (clientX: number) => {
      const r = zone.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const dx = (clientX - cx) / (r.width * 0.32);
      const v = clamp(dx, -1, 1);
      // small dead-zone so a resting finger doesn't drift the kart
      input.touchSteer = Math.abs(v) < 0.045 ? 0 : v * input.sensitivity;
    };
    zone.addEventListener('pointerdown', (e) => {
      wheelActive = true;
      try { zone.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
      applyZone(e.clientX);
    });
    zone.addEventListener('pointermove', (e) => { if (wheelActive) applyZone(e.clientX); });
    const endWheel = (e: PointerEvent) => {
      if (!wheelActive) return;
      wheelActive = false;
      input.touchSteer = 0;
      try { zone.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    zone.addEventListener('pointerup', endWheel);
    zone.addEventListener('pointercancel', endWheel);
    zone.addEventListener('lostpointercapture', () => { wheelActive = false; input.touchSteer = 0; });

    // ---- buttons helper: capture-safe (slide finger off = still held) ----
    const pressBtn = (id: string, label: string, onPress: () => void, onRelease: () => void, parent: HTMLElement = this.el) => {
      const b = el('div', 'tc', parent, label);
      b.id = id;
      const down = (e: PointerEvent) => {
        e.preventDefault();
        try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        b.classList.add('pressed');
        onPress();
      };
      const up = (e?: PointerEvent) => {
        if (e) { try { b.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }
        if (!b.classList.contains('pressed')) return;
        b.classList.remove('pressed');
        onRelease();
      };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      // block the browser context menu / text selection on long-press
      b.addEventListener('contextmenu', e => e.preventDefault());
      return b;
    };

    // ---- pedals column (right: gas above brake) ----
    const pedals = el('div', 'pedal-col', this.el);
    pedals.id = 'pedal-col';
    pressBtn('btn-gas', '▲', () => { input.touchGas = true; }, () => { input.touchGas = false; }, pedals);
    pressBtn('btn-brake', '▼', () => { input.touchBrake = true; }, () => { input.touchBrake = false; }, pedals);

    pressBtn('btn-drift', ic('drift', 30), () => { input.touchDrift = true; }, () => { input.touchDrift = false; });

    // ---- 3 POWER-UP SLOTS, BOTTOM-CENTER (user spec: "تا سه تا قدرت بشه گرفت،
    // سه تا جای قدرت پایین صفحه باشه و وسط باشه؛ بزنی اولی اولی فعال میشه،
    // دومی دومی، سومی سومی") — each slot is its own button and fires EXACTLY
    // the item sitting in it. ----
    const slotsWrap = el('div', '', this.el);
    slotsWrap.id = 'item-slots';
    this.slotBtns = [];
    for (let i = 0; i < 3; i++) {
      const idx = i;
      const b = pressBtn(`btn-slot-${i}`, '', () => { input.state.useItemSlot = idx; }, () => { }, slotsWrap);
      b.classList.add('slot', 'empty');
      b.dataset.slotnum = String(i + 1);
      const ring = el('div', 'cooldown-ring', b);
      ring.style.setProperty('--p', '0%');
      this.slotBtns.push(b);
    }

    // ---- HEALTH BAR (v1.9, user: "نوار جون شبیه قلب‌های ماینکرفت، وسط پایین
    // بالای جای قدرت‌ها") — Minecraft-style pixel hearts sitting right ABOVE
    // the power-up slots. Max hearts come from the car's tier (C=3, B=4, A=5):
    // "ماشین‌های رتبه بالا نوار جون بهتری دارن". ----
    this.hpEl = el('div', 'hp-row', this.el);
    this.hpEl.id = 'hp-row';
    this.hpBuiltMax = -1;

    // ---- LOOK BACK (user request): HOLD to see behind the kart — INSTANT
    // switch with zero motion effect, RELEASE and the camera is instantly back.
    // Uses the capture-safe pressBtn.
    pressBtn('btn-look', ic('eye', 26), () => { input.touchLookBack = true; }, () => { input.touchLookBack = false; });

    // ---- arrow steering pad (BUTTONS mode): ◀ ▶ ----
    const pad = el('div', '', this.el);
    pad.id = 'steer-pad';
    let lHeld = 0, rHeld = 0;
    const syncSteer = () => { input.touchSteer = clamp(rHeld - lHeld, -1, 1); };
    pressBtn('btn-left', '◀', () => { lHeld = 1; syncSteer(); }, () => { lHeld = 0; syncSteer(); }, pad);
    pressBtn('btn-right', '▶', () => { rHeld = 1; syncSteer(); }, () => { rHeld = 0; syncSteer(); }, pad);

    // ---- pause ----
    const pause = el('div', 'tc', this.el, ic('pause', 22));
    pause.id = 'btn-pause';
    pause.addEventListener('pointerdown', (e) => { e.preventDefault(); input.state.pause = true; });

    // ---- HEADLIGHT TOGGLE (v1.12, user: "دکمه خاموش/روشن برای چراغ جلوی
    // ماشین") — shown only on NIGHT maps; tap = beams off/on. The actual light
    // work happens in KartVisual.setLightsOn via the callback wired in attach().
    const lightBtn = el('div', 'tc', this.el, ic('bulb', 24));
    lightBtn.id = 'btn-light';
    lightBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.lightBtnTapped = true;
    });
    lightBtn.style.display = 'none';   // day maps never see it
    this.lightBtn = lightBtn;

    // safety: releasing everything when the app loses focus
    window.addEventListener('blur', () => {
      wheelActive = false; lHeld = 0; rHeld = 0;
      input.touchSteer = 0; input.touchGas = false; input.touchBrake = false; input.touchDrift = false;
    });

    // apply saved control mode
    this.setSteerMode(this.steerMode);
  }

  steerMode: 'wheel' | 'buttons' = 'wheel';
  setSteerMode(m: 'wheel' | 'buttons') {
    this.steerMode = m;
    this.el.classList.toggle('mode-wheel', m === 'wheel');
    this.el.classList.toggle('mode-buttons', m === 'buttons');
    this.input.steerMode = m;
    // the visible control groups change with the mode — repaint layout
    this.applySavedLayout();
  }

  /** v1.10 HUD LAYOUT EDITOR: paint the user's saved positions/scales.
   *  v1.22: also paints the HUD PRESET class (simple = default) and merges the
   *  preset's scale boxes UNDER the user's custom edits (custom wins). */
  applySavedLayout() {
    applyHudPresetClass(this.el, this.ui.meta.data.settings);
    applyHudLayout(this.el, effectiveLayout(this.ui.meta.data.settings));
  }

  attach(race: RaceManager) {
    this.race = race;
    this.el.style.display = '';
    document.getElementById('game-ui')!.appendChild(this.el);
    this.applySavedLayout();   // v1.10: restore the user's custom button layout
    // v1.12: headlight toggle — shown on night maps AND maps with tunnels
    // (v1.13: the tunnel lights are automatic, the button is a manual override)
    const pv = race.playerVisual;
    if (this.lightBtn) {
      if ((race.isNight || race.hasTunnels) && pv) {
        this.lightBtn.style.display = '';
        this.lightBtn.classList.remove('off');
      } else {
        this.lightBtn.style.display = 'none';
      }
    }
    // minimap path (compute once per race)
    this.minimapBreak = race.data.open && race.data.seam !== undefined ? Math.floor(race.data.seam / 6) + 1 : null;
    const cache = (race.world as unknown as { minimapCache?: { pts: [number, number][] } }).minimapCache;
    this.minimapPath = cache?.pts ?? (race.world as unknown as { minimapCache?: { pts: [number, number][] } }).minimapCache?.pts ?? null;
    if (!this.minimapPath) {
      import('../world/track').then(m => {
        const mp = m.minimapPath(race.data);
        (race.world as unknown as { minimapCache?: { pts: [number, number][] } }).minimapCache = mp;
        this.minimapPath = mp.pts;
      });
    }
  }

  detach() {
    this.el.style.display = 'none';
    this.el.remove();
    this.race = null;
    this.lastCountdown = 99;
    this.wrongWayShown = false;
    this.goalKey = ''; this.missionKey = '';
    this.goalEl?.classList.remove('show'); this.missionEl?.classList.remove('show');
    this.hpBuiltMax = -1;
    this.hpShown = -1;
  }

  /** v3.5 live goal + mini mission (cheap: DOM only touched when something changes) */
  private updateGoal(h: RaceHudData) {
    const g = h.goal;
    if (!g || h.finished) { if (this.goalKey) { this.goalEl.classList.remove('show'); this.goalKey = ''; } }
    else {
      const k = g.txt + g.state + Math.round(g.frac * 50);
      if (k !== this.goalKey) {
        this.goalKey = k;
        this.goalEl.className = `goal-bar show gs-${g.state}`;
        (this.goalEl.querySelector('.gb-tx') as HTMLElement).textContent = g.txt;
        (this.goalEl.querySelector('.gb-bar i') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, g.frac)).toFixed(3)})`;
        (this.goalEl.querySelector('.gb-ic') as HTMLElement).innerHTML = ic(g.state === 'done' ? 'check' : g.state === 'fail' ? 'x' : 'target', 15);
      }
    }
    const m = h.mission;
    if (!m) { if (this.missionKey) { this.missionEl.classList.remove('show'); this.missionKey = ''; } return; }
    const mk = m.txt + m.state + m.left + Math.round(m.frac * 40);
    if (mk === this.missionKey) return;
    const fresh = !this.missionKey;
    this.missionKey = mk;
    this.missionEl.className = `mission-chip show ms-${m.state}${fresh ? ' pop' : ''}`;
    (this.missionEl.querySelector('.mc-tx') as HTMLElement).textContent = m.txt;
    (this.missionEl.querySelector('.mc-t') as HTMLElement).textContent = m.state === 'run' ? `${m.left}s` : m.state === 'done' ? '✔' : '✖';
    (this.missionEl.querySelector('.mc-bar i') as HTMLElement).style.transform = `scaleX(${Math.max(0, Math.min(1, m.frac)).toFixed(3)})`;
  }

  update(h: RaceHudData) {
    // v1.12 HEADLIGHT TOGGLE: edge-triggered tap → flip the player's lights
    if (this.lightBtnTapped) {
      this.lightBtnTapped = false;
      const pv = this.race?.playerVisual;
      if (pv) {
        const on = pv.toggleLights();
        audio.play('click');
        this.lightBtn?.classList.toggle('off', !on);
      }
    }
    this.posEl.innerHTML = `${h.position}<small>/${h.totalRacers}</small>`;
    this.updateSpeedo(h);
    this.updateDebug(h);

    // steering wheel visual feedback — uses uiSteer (user-perceived direction):
    // drag right → wheel rotates clockwise, like a real car (fixes mirrored feel)
    if (this.wheelVisEl) {
      const ang = this.input.uiSteer * 55;
      this.wheelVisEl.style.transform = `rotate(${ang.toFixed(1)}deg)`;
    }

    // racer list (top 6)
    const rows = h.racers.slice(0, 6).map(r =>
      `<div class="racer-row ${r.isLocal ? 'me' : ''} ${r.finished ? 'dim' : ''}">
        <span class="rp">${r.pos}</span>
        <span class="ric" style="background:${r.iconColor}"></span>
        <span>${r.name}</span>
      </div>`).join('');
    this.racerListEl.innerHTML = rows;

    this.timerEl.textContent = fmtTime(h.timeMs);
    this.lapEl.textContent = `${t('lap')} ${h.lap}/${h.laps}`;
    this.updateGoal(h);

    // countdown
    const cdNum = document.getElementById('countdown-num');
    if (cdNum) {
      if (h.countdown >= 1 && h.countdown <= 3) {
        if (this.lastCountdown !== h.countdown) {
          this.lastCountdown = h.countdown;
          cdNum.textContent = h.countdown === 3 ? t('countdown3') : h.countdown === 2 ? t('countdown2') : t('countdown1');
          cdNum.classList.remove('zoom', 'go');
          void cdNum.offsetWidth;
          cdNum.classList.add('zoom');
        }
      } else if (h.countdown === -1 && h.goFlash && this.lastCountdown !== 0) {
        this.lastCountdown = 0;
        cdNum.textContent = t('go');
        cdNum.classList.remove('zoom');
        void cdNum.offsetWidth;
        cdNum.classList.add('zoom', 'go');
      } else if (!h.goFlash && h.countdown === -1 && this.lastCountdown === 0) {
        this.lastCountdown = -1;
        cdNum.textContent = '';
      }
    }

    // wrong way / recovered / generic HUD message (breakdown, repair, …)
    if (h.hudMsg) {
      // breakdown / repair banners take priority for their duration
      if (this.centerEl.textContent !== h.hudMsg) {
        this.centerEl.textContent = h.hudMsg;
        this.centerEl.className = h.hudMsg.startsWith('\u200b') ? 'center-msg gold pop' : 'center-msg warn pop';
      }
    } else if (h.recovered && !this.wrongWayShown) {
      this.wrongWayShown = true;
      this.centerEl.textContent = t('recovered');
      this.centerEl.className = 'center-msg gold pop';
    } else if (h.wrongWay && !this.wrongWayShown) {
      this.wrongWayShown = true;
      this.centerEl.textContent = t('wrongWay');
      this.centerEl.className = 'center-msg warn pop';
      // vibration setting must ACTUALLY gate haptics (user: settings don't work)
      if (navigator.vibrate && this.ui.meta.data.settings.vibration) navigator.vibrate(80);
    } else if (!h.wrongWay && !h.recovered && this.wrongWayShown) {
      this.wrongWayShown = false;
      this.centerEl.className = 'center-msg';
      this.centerEl.textContent = '';
    } else if (!h.hudMsg && this.centerEl.textContent && !this.wrongWayShown) {
      // v3.3 BUGFIX: the gold "repaired" banner was never cleared (only 'warn' was) → stuck till the finish
      // clear stale breakdown banner once its timer runs out
      this.centerEl.textContent = '';
      this.centerEl.className = 'center-msg';
    }

    // drift meter
    if (h.driftCharge > 0.03) {
      this.driftMeter.classList.add('show');
      this.driftMeter.classList.toggle('t1', h.driftTier === 1);
      this.driftMeter.classList.toggle('t2', h.driftTier === 2);
      if (!this.driftFill) this.driftFill = this.driftMeter.querySelector('.fill');
      if (this.driftFill) this.driftFill.style.width = `${h.driftCharge * 100}%`;
      const lbl = this.driftMeter.querySelector('.lbl') as HTMLElement;
      lbl.textContent = h.driftTier === 2 ? t('ultraTurbo') : h.driftTier === 1 ? t('driftBoostReady') : t('drift');
    } else {
      this.driftMeter.classList.remove('show');
    }

    // boost speed vignette
    const wantFx = h.boost || h.speedFrac > 1.02;
    if (wantFx !== this.boostFxOn) {
      this.boostFxOn = wantFx;
      this.boostFxEl.classList.toggle('on', wantFx);
    }
    if (wantFx) {
      this.boostFxEl.style.setProperty('--bf-i', String(clamp((h.boost ? 0.6 : 0) + Math.max(0, h.speedFrac - 0.95) * 1.6, 0, 1)));
    }

    // v3.1 speed breaker / slipstream badges
    {
      const od = h.overdrive ?? 0, df = h.draft ?? 0;
      const sb = this.odEl.children[0] as HTMLElement, dfe = this.odEl.children[1] as HTMLElement;
      void od; void sb;
      dfe.classList.toggle('on', df > 0.25);
    }

    // 3 power-up slots (bottom-center) — each button fires ITS OWN slot
    for (let i = 0; i < this.slotBtns.length; i++) {
      const btn = this.slotBtns[i];
      const id = h.items?.[i] ?? null;
      if (id) {
        const def = ITEMS[id as ItemId];
        const cur = btn.dataset.item;
        if (cur !== id) {
          btn.dataset.item = id;
          // crisp canvas icon (user: icons must look better + detailed)
          btn.innerHTML = `<img class="item-ic" src="${itemIconDataURL(id as ItemId)}" draggable="false" alt="">`;
          btn.classList.remove('pop');
          void btn.offsetWidth;
          btn.classList.add('pop');
        }
        btn.classList.remove('empty');
        btn.classList.add('ready');
        btn.style.borderColor = def.color;
        btn.style.setProperty('--glow', def.color);
      } else {
        btn.dataset.item = '';
        btn.innerHTML = '';
        btn.classList.add('empty');
        btn.classList.remove('ready');
        btn.style.borderColor = '';
        btn.style.setProperty('--glow', 'rgba(255,214,79,0.8)');
      }
      // roulette cooldown ring shows on the slot currently being rolled
      const ring = btn.querySelector('.cooldown-ring') as HTMLElement | null;
      const rolling = h.itemCooldown > 0 && !h.items?.[i] && (i === 0 || !!h.items?.[i - 1]);
      if (ring) ring.style.setProperty('--p', rolling ? `${(1 - clamp(h.itemCooldown / 0.9, 0, 1)) * 100}%` : '0%');
    }

    // HEALTH HEARTS (v1.9): rebuild only when the bar shape changes; swap
    // sprites per half-heart; flash red on damage (hurtFlash) like MC's
    // low-health pulse. v1.11 (user: "وقتی کم میشن مثل ماینکرفت انیمیشن داشته
    // باشه"): each heart that just LOST health pops with its own MC-style
    // shake/scale animation (CSS class 'lost', 420ms), independent of the
    // whole-row hurt flash.
    if (this.hpEl && h.maxHp > 0) {
      if (this.hpBuiltMax !== h.maxHp) {
        this.hpBuiltMax = h.maxHp;
        this.hpShown = -1;
        const hearts = Math.ceil(h.maxHp / 2);
        let html = '';
        for (let i = 0; i < hearts; i++) html += `<img class="hp-heart" draggable="false" alt="">`;
        this.hpEl.innerHTML = html;
      }
      if (this.hpShown !== h.hp) {
        const imgs = this.hpEl.querySelectorAll('img');
        const hearts = imgs.length;
        const prevState = this.hpShown;
        this.hpShown = h.hp;
        const heartVal = (i: number, hp: number) => hp - (hearts - 1 - i) * 2;
        for (let i = 0; i < hearts; i++) {
          const v = heartVal(i, h.hp);
          const state = v >= 2 ? 'full' : v === 1 ? 'half' : 'empty';
          imgs[i].src = heartDataURL(state);
          // did THIS heart just lose health?
          if (prevState >= 0) {
            const pv = heartVal(i, prevState);
            if (v < pv) {
              const im = imgs[i];
              im.classList.remove('lost');
              void (im as HTMLElement).offsetWidth;   // restart the CSS animation
              im.classList.add('lost');
              window.setTimeout(() => im.classList.remove('lost'), 450);
            }
          }
        }
      }
      this.hpEl.classList.toggle('hurt', !!h.hurtFlash);
      this.hpEl.classList.toggle('low', h.hp <= 2);
    } else if (this.hpEl) {
      this.hpEl.innerHTML = '';
    }

    // minimap
    if (this.minimapCtx && this.minimapPath) {
      const ctx = this.minimapCtx;
      ctx.clearRect(0, 0, 148, 148);
      // track path
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 7;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const brk = this.minimapBreak;
      this.minimapPath.forEach((p, i) => {
        const x = 10 + p[0] * 128, y = 10 + p[1] * 128;
        if (i === 0 || i === brk) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (brk === null) ctx.closePath();   // open tracks: start ≠ finish
      ctx.stroke();
      ctx.strokeStyle = 'rgba(40,52,80,0.9)';
      ctx.lineWidth = 3.5;
      ctx.stroke();
      // racers
      for (const r of h.minimapRacers) {
        ctx.beginPath();
        ctx.fillStyle = r.isLocal ? '#ffd23f' : r.color;
        ctx.arc(10 + r.x * 128, 10 + r.z * 128, r.isLocal ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
        if (r.isLocal) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      }
    }
  }

  setSensitivity(v: number) { this.input.sensitivity = v; }
  setMirror(v: boolean) { this.input.mirror = v; }
  setWheelSize(v: number) { this.el.style.setProperty('--wheel-scale', String(v)); }
  setAutoGas(v: boolean) { this.input.autoGas = v; }
  refreshLang() { void t('pos'); }
}
