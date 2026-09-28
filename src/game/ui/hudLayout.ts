// KUBO KARTS - HUD LAYOUT EDITOR (v1.10, user request):
// "میخوام یه گزینه بزار داخل بخش تنظیمات که وقتی کاربر روشن میزنه بتونه خودش
//  تمام دکمه‌ها و چینش‌های داخل صفحه انجام بده مثل آیکون‌های قدرت و جلو و عقب
//  و دکمه چشم و دکمه راست و چپ و همچی و بتونه بزرگ و کوچیک کنه دکمه‌ها رو"
//
// Every on-screen control group (power-up slots, gas/brake, steering, look
// button, hearts, drift meter, pause…) can be DRAGGED anywhere and RESIZED
// with ＋ / − . Layout lives in the save file as viewport-fraction offsets so
// it survives rotation and different phones.
//
// v1.22 (user: "میخوام ورایش چیدمان داخل بخش تنظیمات باشه و میخوام که سرعت
// سنجه هم بشه جاشو ویرایش کرد مثل بغیه چیز ها و میخوام یه نسخه دیگه درست کنی
// که سااده باشه … و بشه انتخاب کرد یکی از اون دو نسخه"):
//  • the SPEEDOMETER (#speedo) is now a first-class layout entry
//  • TWO HUD PRESETS — SIMPLE (default) and CLASSIC — selectable in Settings
//  • the editor can be opened from SETTINGS (a live HUD preview is shown,
//    no race needed) as well as from the pause menu
import { el } from './ui';
import type { UIManager } from './ui';
import type { Meta } from '../meta/meta';
import type { Settings } from '../core/save';
import { audio } from '../core/audio';
import { t } from '../core/lang';
import { clamp } from '../core/utils';

export interface HudBox { dx: number; dy: number; s: number }

/* eslint-disable @typescript-eslint/no-unused-vars */

/** id → editor key. The group element is what gets dragged/scaled.
 *  v1.11 (user: "داخل تنظیمات کاستمایز دکمه‌ها هر دکمه جدا بشه تغییر مکان یا
 *  تغییر سایز — مثل جلو و عقب و چپ راست"): EVERY button is now its own
 *  selectable, draggable, resizable entry — gas, brake, each steering arrow,
 *  each power-up slot, look, drift, pause — PLUS the old containers (drag a
 *  container to move its children together). Individual buttons are listed
 *  BEFORE their containers so a tap on the button selects the button, not
 *  the wrapper.
 *  v1.22: #speedo joins the list. `wrap` is appended INSIDE the inline
 *  transform so the CSS centering trick (translateX(-50%)) survives a
 *  user drag instead of being wiped by it. */
export const HUD_GROUPS: { key: string; sel: string; labelKey: string; wrap?: string }[] = [
  // individual buttons first (most specific match wins via find())
  { key: 'gas', sel: '#btn-gas', labelKey: 'layoutGas' },
  { key: 'brake', sel: '#btn-brake', labelKey: 'layoutBrake' },
  { key: 'left', sel: '#btn-left', labelKey: 'layoutLeft' },
  { key: 'right', sel: '#btn-right', labelKey: 'layoutRight' },
  { key: 'slot0', sel: '#btn-slot-0', labelKey: 'layoutSlot1' },
  { key: 'slot1', sel: '#btn-slot-1', labelKey: 'layoutSlot2' },
  { key: 'slot2', sel: '#btn-slot-2', labelKey: 'layoutSlot3' },
  { key: 'drift', sel: '#btn-drift', labelKey: 'layoutDrift' },
  { key: 'look', sel: '#btn-look', labelKey: 'layoutLook' },
  { key: 'pause', sel: '#btn-pause', labelKey: 'layoutPause' },
  { key: 'light', sel: '#btn-light', labelKey: 'layoutLight' },
  // containers (move a whole cluster at once)
  { key: 'slots', sel: '#item-slots', labelKey: 'layoutSlots' },
  { key: 'hearts', sel: '#hp-row', labelKey: 'layoutHearts' },
  { key: 'pedals', sel: '#pedal-col', labelKey: 'layoutPedals' },
  { key: 'steer', sel: '#steer-pad', labelKey: 'layoutSteer' },
  { key: 'wheelzone', sel: '#wheel-zone', labelKey: 'layoutWheel' },
  { key: 'meter', sel: '#drift-meter', labelKey: 'layoutMeter' },
  // v1.22: the speedometer — centered via translateX(-50%) in CSS, so its
  // inline transform must keep that centering (see `wrap`)
  { key: 'speedo', sel: '#speedo', labelKey: 'layoutSpeedo', wrap: 'translateX(-50%)' },
];

const MIN_S = 0.55, MAX_S = 1.9;

// ---------------- v1.22 HUD PRESETS ----------------
/** Preset scale boxes applied on top of the default layout when the user picks
 *  the SIMPLE preset. Pixel re-anchoring (speedo to the bottom, smaller
 *  minimap…) lives in CSS under `#hud.hud-simple` — fraction offsets can't
 *  track pixel-anchored neighbours across screen sizes, but CSS can. */
export const SIMPLE_BOXES: Record<string, HudBox> = {
  speedo: { dx: 0, dy: 0, s: 0.62 },
};

export function hudPresetOf(settings: Settings): 'simple' | 'normal' {
  return settings.hudPreset ?? 'simple';   // default = SIMPLE (user request)
}

/** The layout the HUD actually renders: preset base + the user's own edits
 *  (custom edits win so the layout editor always reflects what you see). */
export function effectiveLayout(settings: Settings): Record<string, HudBox> | undefined {
  const preset: Record<string, HudBox> = hudPresetOf(settings) === 'simple' ? SIMPLE_BOXES : {};
  const custom = settings.hudLayout ?? {};
  const keys = new Set([...Object.keys(preset), ...Object.keys(custom)]);
  if (!keys.size) return undefined;
  const out: Record<string, HudBox> = {};
  for (const k of keys) out[k] = { ...(preset[k] ?? { dx: 0, dy: 0, s: 1 }), ...custom[k] };
  return out;
}

/** Paint the preset CSS class (pixel-level packing) on the HUD root. */
export function applyHudPresetClass(hud: HTMLElement, settings: Settings) {
  hud.classList.toggle('hud-simple', hudPresetOf(settings) === 'simple');
}

export function applyHudLayout(root: HTMLElement, layout: Record<string, HudBox> | undefined) {
  if (!root || !layout) return;
  for (const g of HUD_GROUPS) {
    const box = layout[g.key];
    const target = root.querySelector(g.sel) as HTMLElement | null;
    if (!target) continue;
    if (!box) { target.style.transform = ''; continue; }
    const vw = window.innerWidth, vh = window.innerHeight;
    target.style.transform =
      `translate(${(box.dx * vw).toFixed(1)}px, ${(box.dy * vh).toFixed(1)}px)` +
      (g.wrap ? ` ${g.wrap}` : '') +
      (box.s && box.s !== 1 ? ` scale(${box.s})` : '');
  }
}

/**
 * Opens the in-race layout editor. The race must be PAUSED (we call this from
 * the pause menu): the HUD stays visible behind the editor overlay and the
 * frozen sim keeps everything still while dragging. onDone returns to pause.
 */
export function openHudLayoutEditor(ui: UIManager, meta: Meta, onDone: () => void) {
  const hud = document.getElementById('hud');
  if (!hud) { onDone(); return; }
  // v1.22: the editor drafts start from what is CURRENTLY PAINTED (preset +
  // custom). Saving diffs against that snapshot, so untouched groups are NOT
  // frozen into the save (switching presets later still works).
  const start = JSON.parse(JSON.stringify(effectiveLayout(meta.data.settings) ?? {})) as Record<string, HudBox>;
  // SEPARATE deep copy! drafts must diverge from `start` or the save-time
  // diff (done.onclick) would always compare equal and save nothing.
  const drafts: Record<string, HudBox> = JSON.parse(JSON.stringify(start));
  let selected = '';
  let dragging: { key: string; id: number; sx: number; sy: number; dx: number; dy: number } | null = null;

  hud.classList.add('layout-edit');
  applyAll();

  // ---- toolbar overlay ----
  const bar = el('div', '');
  bar.id = 'hud-layout-bar';
  const hint = el('div', 'hlb-hint', bar, t('hudLayoutHint'));
  const selLabel = el('div', 'hlb-sel', bar, '');
  const row = el('div', 'hlb-row', bar);
  const minus = el('button', 'btn small', row, '− ' + t('low'));
  const plus = el('button', 'btn small', row, '＋ ' + t('high'));
  const reset = el('button', 'btn small red', row, t('hudLayoutReset'));
  const done = el('button', 'btn small green', row, t('hudLayoutDone'));
  document.getElementById('game-ui')!.appendChild(bar);

  const groupOf = (key: string) => HUD_GROUPS.find(g => g.key === key);
  const el2 = (key: string) => {
    const g = groupOf(key);
    return g ? (hud.querySelector(g.sel) as HTMLElement | null) : null;
  };

  function applyAll() {
    applyHudLayout(hud!, drafts);
    if (selected) {
      const target = el2(selected);
      target?.classList.add('hlb-selected');
    }
  }

  function paintSel() {
    hud!.querySelectorAll('.hlb-selected').forEach(e => e.classList.remove('hlb-selected'));
    if (selected) {
      el2(selected)?.classList.add('hlb-selected');
      const g = groupOf(selected);
      selLabel.textContent = g ? `▸ ${t(g.labelKey as Parameters<typeof t>[0])}  ×${(drafts[selected]?.s ?? 1).toFixed(2)}` : '';
      selLabel.style.visibility = 'visible';
    } else {
      selLabel.style.visibility = 'hidden';
    }
  }

  minus.onclick = () => {
    if (!selected) return;
    const b = drafts[selected] ?? (drafts[selected] = { dx: 0, dy: 0, s: 1 });
    b.s = clamp(Math.round((b.s - 0.1) * 10) / 10, MIN_S, MAX_S);
    audio.play('click');
    applyAll(); paintSel();
  };
  plus.onclick = () => {
    if (!selected) return;
    const b = drafts[selected] ?? (drafts[selected] = { dx: 0, dy: 0, s: 1 });
    b.s = clamp(Math.round((b.s + 0.1) * 10) / 10, MIN_S, MAX_S);
    audio.play('click');
    applyAll(); paintSel();
  };
  reset.onclick = () => {
    audio.play('back');
    for (const k of Object.keys(drafts)) delete drafts[k];
    selected = '';
    applyAll(); paintSel();
  };
  done.onclick = () => {
    audio.play('click');
    // v1.22: keep only groups that CHANGED during this session (relative to
    // what was painted when the editor opened). Everything else stays preset-
    // driven so picking the other preset later isn't fighting stale edits.
    const clean: Record<string, HudBox> = { ...(meta.data.settings.hudLayout ?? {}) };
    for (const [k, v] of Object.entries(drafts)) {
      const was = start[k] ?? { dx: 0, dy: 0, s: 1 };
      const changed = Math.abs(v.dx - was.dx) > 0.001 || Math.abs(v.dy - was.dy) > 0.001 || Math.abs(v.s - was.s) > 0.001;
      if (changed) clean[k] = { ...v };
      else if (!start[k] && Math.abs(v.dx) < 0.001 && Math.abs(v.dy) < 0.001 && Math.abs(v.s - 1) < 0.001) delete clean[k];
    }
    meta.data.settings.hudLayout = Object.keys(clean).length ? clean : undefined;
    meta.save();
    close();
    ui.toast(t('hudLayoutSaved'), 'good');
    onDone();
  };

  function close() {
    hud!.classList.remove('layout-edit');
    hud!.querySelectorAll('.hlb-selected').forEach(e => e.classList.remove('hlb-selected'));
    applyHudLayout(hud!, effectiveLayout(meta.data.settings));   // final paint from the SAVE
    bar.remove();
    hud!.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
  }

  /** CAPTURE phase on the HUD: we get every touch BEFORE the buttons do, so in
   *  edit mode a tap never fires the actual control (no gas, no items). */
  function onDown(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement;
    const g = HUD_GROUPS.find(gr => target.closest(gr.sel));
    if (!g) { selected = ''; paintSel(); return; }
    selected = g.key;
    const b = drafts[selected] ?? (drafts[selected] = { dx: 0, dy: 0, s: 1 });
    dragging = { key: selected, id: e.pointerId, sx: e.clientX, sy: e.clientY, dx: b.dx, dy: b.dy };
    paintSel();
  }
  function onMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragging.id) return;
    e.preventDefault();
    e.stopPropagation();
    const b = drafts[dragging.key];
    b.dx = dragging.dx + (e.clientX - dragging.sx) / window.innerWidth;
    b.dy = dragging.dy + (e.clientY - dragging.sy) / window.innerHeight;
    applyHudLayout(hud!, drafts);
  }
  function onUp(e: PointerEvent) {
    if (dragging && e.pointerId === dragging.id) {
      // snap tiny accidental drags back to zero
      const b = drafts[dragging.key];
      if (Math.abs(b.dx) < 0.012 && Math.abs(b.dy) < 0.012) { b.dx = 0; b.dy = 0; applyAll(); }
      dragging = null;
    }
  }

  hud.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);
  paintSel();
}

/**
 * v1.22 — LAYOUT EDITOR FROM SETTINGS (user: "میخوام ورایش چیدمان داخل بخش
 * تنظیمات باشه"). detach() removes the hud from the DOM between races, so the
 * settings entry MOUNTS the real hud as a live preview over the settings
 * screen and runs the very same editor on it. No race, no mock DOM — what you
 * drag is exactly what races will render.
 */
export function openHudLayoutEditorFromSettings(ui: UIManager, meta: Meta, onDone: () => void) {
  const hudEl = (ui.hud?.el as HTMLElement | undefined) ?? document.getElementById('hud');
  if (!hudEl) { onDone(); return; }
  // HudController.detach() REMOVES the hud from the DOM when a race ends, so
  // in the menus it usually isn't mounted — mount it for the preview and put
  // it back the way it was afterwards.
  const wasMounted = document.contains(hudEl);
  const prevZ = hudEl.style.zIndex;
  const prevDisplay = hudEl.style.display;
  const prevPE = hudEl.style.pointerEvents;
  if (!wasMounted) document.getElementById('game-ui')!.appendChild(hudEl);
  hudEl.style.display = '';
  hudEl.style.zIndex = '900';        // above the settings screen (z 10..100)
  hudEl.style.pointerEvents = 'auto';
  // paint the CURRENT preset + saved layout so the preview is honest
  applyHudPresetClass(hudEl, meta.data.settings);
  applyHudLayout(hudEl, effectiveLayout(meta.data.settings));
  openHudLayoutEditor(ui, meta, () => {
    hudEl.style.zIndex = prevZ;
    hudEl.style.display = prevDisplay;
    hudEl.style.pointerEvents = prevPE;
    if (!wasMounted) hudEl.remove(); // restore the detached state attach() expects
    onDone();
  });
}
