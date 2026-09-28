// KUBO KARTS - Screens part 2: garage (3D + customize + upgrade), characters,
// multiplayer lobby, pause, results.
import { el } from './ui';
import type { GameCtx } from './ctx';
import type { UIManager } from './ui';
import type { Showcase } from './showcase';
import { t } from '../core/lang';
import { audio } from '../core/audio';
import { CARS, PAINTS, WHEEL_COLORS, BOOST_COLORS, GLOW_COLORS, DECAL_COUNT, SPOILER_COUNT, EXHAUST_COUNT, WHEEL_STYLE_COUNT, upgradeCost, tierOf, TIER_COLORS, carSortKey, type CarDef } from '../data/cars';
import { CHARACTERS, charById } from '../data/characters';
import { fmtNum } from '../core/utils';
import { defaultCustom, Meta } from '../meta/meta';
import type { RaceResult } from '../race/race';
import { charAvatar } from './screens';
import { ITEMS, type ItemId } from '../items/items';
import { serverAddress, fullShareUrl, isApp, hostAddrList, refreshHostAddr, hostIpProblem, discoverHosts, type MpSettings } from '../net/client';
import { itemIconDataURL } from './icons';
import { itemModePicker } from './itemMode';
import { openHudLayoutEditor } from './hudLayout';
import { carThumb, charThumb, wheelThumb, customThumb } from './thumbs';
import { mapThumb } from './mapthumbs';
import { ic, cur } from './icons3';
import { header, money, bar } from './kit';
import { themePoster } from './posters';

/** all track themes available to the MP host */
const THEME_IDS = ['grass', 'castle', 'desert', 'snow', 'volcano', 'cave', 'sky', 'city', 'crashcity', 'mccity', 'ruins', 'jungle', 'megaramp', 'candy', 'galaxy', 'dragon', 'royal'];
/** every power-up the host can allow in item boxes */
const ALL_ITEM_IDS = ['boost', 'shield', 'rocket', 'lightning', 'ice', 'trap', 'mine', 'magnet', 'emp', 'giant', 'ghost', 'jump', 'tnt', 'banana', 'minecart'];

function themeName(id: string): string {
  return t('theme_' + id);
}

/** shared live MP settings editor: map / laps / bots / power-ups in boxes */
function mpSettingsEditor(host: HTMLElement, s: MpSettings, onChange: (s: MpSettings) => void, mapLocked: (th: string) => boolean = () => false, onLocked: (th: string) => void = () => {}) {
  const wrap = el('div', 'mp-settings', host);
  const mkLabel = (txt: string) => el('div', 'mps-label', wrap, txt);
  // map — WITH PREVIEW IMAGES (user: "همراه اسم مپ‌ها عکسشون باشه — بهترین عکس")
  mkLabel(`${ic('map', 14)} ${t('chooseTrack')}`);
  const mapGrid = el('div', 'map-grid', wrap);
  const mapBtns: Record<string, HTMLElement> = {};
  for (const th of THEME_IDS) {
    const locked = mapLocked(th);
    const card = el('div', `map-card ${th === s.theme ? 'selected' : ''} ${locked ? 'locked' : ''}`, mapGrid);
    const img = document.createElement('img');
    img.src = mapThumb(th);
    img.alt = themeName(th);
    img.loading = 'lazy';
    card.appendChild(img);
    el('span', 'mc-name', card, themeName(th));
    el('span', 'mc-check', card, ic('check', 14));
    if (locked) el('span', 'mc-lock', card, ic('lock', 18));
    mapBtns[th] = card;
    card.onclick = () => {
      if (mapLocked(th)) { audio.play('error'); onLocked(th); return; }
      audio.play('click');
      s.theme = th;
      for (const k of Object.keys(mapBtns)) mapBtns[k].classList.toggle('selected', k === th);
      onChange(s);
    };
  }
  // laps + bots side by side
  const lb = el('div', 'mps-two', wrap);
  const lapsCol = el('div', '', lb);
  el('div', 'mps-label', lapsCol, `${ic('laps', 14)} ${t('laps')}`);
  const lapsRow = el('div', 'seg mps-seg', lapsCol);
  const lapBtns: Record<number, HTMLElement> = {};
  // v1.8 (user: "از یک تا هشت داشته باشه برای دور"): 1..8 laps
  for (const l of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const b = el('button', l === s.laps ? 'active' : '', lapsRow, String(l));
    lapBtns[l] = b;
    b.onclick = () => {
      audio.play('click');
      s.laps = l;
      for (const k of Object.keys(lapBtns)) lapBtns[+k].classList.toggle('active', +k === l);
      onChange(s);
    };
  }
  const botsCol = el('div', '', lb);
  el('div', 'mps-label', botsCol, `${ic('bot', 14)} ${t('bots')}`);
  const botsRow = el('div', 'seg mps-seg', botsCol);
  const botBtns: Record<number, HTMLElement> = {};
  for (const nb of [0, 1, 2, 3, 4]) {
    const b = el('button', nb === s.bots ? 'active' : '', botsRow, nb === 0 ? t('noBots') : String(nb));
    botBtns[nb] = b;
    b.onclick = () => {
      audio.play('click');
      s.bots = nb;
      for (const k of Object.keys(botBtns)) botBtns[+k].classList.toggle('active', +k === nb);
      onChange(s);
    };
  }
  // power-ups allowed in boxes (toggle chips; at least one stays on)
  // v3.1 ITEM MODE: lucky boxes vs real items on the road
  mkLabel(`${ic('box', 14)} ${t('itemMode')}`);
  itemModePicker(wrap, s.itemMode === 'placed' ? 'placed' : 'mystery', v => { s.itemMode = v; onChange(s); }, 'mps-mode');
  mkLabel(`${ic('box', 14)} ${t('itemsInBoxes')}`);
  const itemRow = el('div', 'mps-items', wrap);
  for (const id of ALL_ITEM_IDS) {
    const def = ITEMS[id as ItemId];
    const on = s.items.includes(id);
    const chip = el('button', `mp-item-chip ${on ? 'on' : ''}`, itemRow);
    chip.innerHTML = `<img src="${itemIconDataURL(id as ItemId)}" draggable="false" style="width:26px;height:26px;object-fit:contain;pointer-events:none">`;
    chip.title = t(`item_${id}`);
    chip.onclick = () => {
      audio.play('click');
      const i = s.items.indexOf(id);
      if (i >= 0) {
        if (s.items.length <= 1) { audio.play('error'); return; }
        s.items.splice(i, 1);
        chip.classList.remove('on');
      } else {
        s.items.push(id);
        chip.classList.add('on');
      }
      onChange(s);
    };
  }
  return wrap;
}

export function registerGarageScreens(ui: UIManager, ctx: GameCtx) {
  const meta = ctx.meta;

  // ============ GARAGE ============
  // FULL-SCREEN REBUILD (user: "چرا منوی گاراژ کامل و تمام‌صفحه نیست"): the
  // old body was capped to 31% of the screen and everything below was raw 3D
  // scene. Now: compact top bar + tabs, a dedicated 3D PREVIEW BAND, and the
  // content (stats / cars grid / customization / workshop) fills the REST of
  // the screen with scrolling — a complete, full-page menu.
  {
    const scr = el('div', 'screen v3');
    header(scr, 'wrench', t('garage'), t('garageSub'), () => ui.show('menu'));
    const tabs = el('div', 'tabs', scr);
    const tabCars = el('div', 'tab active', tabs, t('cars'));
    tabs.classList.add('v3-gtabs');
    const tabCustom = el('div', 'tab', tabs, t('customize'));
    const tabUpg = el('div', 'tab', tabs, t('workshop'));
    // preview band: transparent window where the 3D showcase car appears
    const band = el('div', 'preview-band', scr);
    el('div', 'band-edge top', band);
    el('div', 'band-edge bot', band);
    const bandName = el('div', 'band-name', band, '');
    const bandSub = el('div', 'band-sub', band, '');
    const body = el('div', 'screen-body', scr);

    let activeTab = 'cars';
    let curCar = meta.data.selectedCar;

    const paintTabs = () => {
      tabCars.classList.toggle('active', activeTab === 'cars');
      tabCustom.classList.toggle('active', activeTab === 'custom');
      tabUpg.classList.toggle('active', activeTab === 'upg');
    };
    tabCars.onclick = () => { audio.play('click'); activeTab = 'cars'; paintTabs(); build(); };
    tabCustom.onclick = () => { audio.play('click'); activeTab = 'custom'; paintTabs(); build(); };
    tabUpg.onclick = () => { audio.play('click'); activeTab = 'upg'; paintTabs(); build(); };

    const statRow = (label: string, val: number, colorCls = ''): string => {
      const k = colorCls === 'c2' ? (label === t('speed') ? 'c-speed' : 'c-boost') : colorCls === 'c3' ? 'c-accel' : '';
      return `<div class="gs ${k}"><span class="gs-h">${label}<b>${fmtNum(Math.round(val * 10) / 10)}</b></span>${bar(val / 10)}</div>`;
    };

    const build = () => {
      body.innerHTML = '';
      const owned = meta.canDrive(curCar);     // v3.4: VIP cars drive while the pass runs
      const def = CARS.find(c => c.id === curCar)!;
      ctx.showcase.setCar(curCar, owned ? meta.customFor(curCar) : undefined);
      ctx.showcase.setFocus('car');
      // align the 3D subject to the band's REAL on-screen rect (measured, not
      // guessed) — after the browser lays the screen out
      requestAnimationFrame(() => {
        const r = band.getBoundingClientRect();
        if (r.height > 40) ctx.showcase.setBand(r.top / window.innerHeight, r.height / window.innerHeight);
      });
      bandName.textContent = def.name;
      bandSub.innerHTML = `${t('cls_' + def.cls)} · <b style="color:${TIER_COLORS[tierOf(def)]}">${t('carTier')} ${tierOf(def)}</b>`;

      if (activeTab === 'cars') {
        // stats panel
        const stats = el('div', 'panel', body);
        stats.style.padding = '12px 14px';
        const st = meta.effStats(curCar);
        stats.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
            <h2>${def.name} <span class="tier-badge tier-${tierOf(def)}" style="font-size:13px;vertical-align:middle">${t('carTier')} ${tierOf(def)}</span></h2><span class="sub">${t('cls_' + def.cls)}</span>
          </div>
          <div class="gar-stat">
          ${statRow(t('speed'), st.speed, 'c2')}
          ${statRow(t('accel'), st.accel, 'c3')}
          ${statRow(t('handling'), st.handling)}
          ${statRow(t('driftStat'), st.drift)}
          ${statRow(t('boost'), st.boost, 'c2')}
          ${statRow(t('defense'), st.defense)}
          </div>`;
        // car grid — v1.12: 2 columns so the side-view car images render BIG
        el('div', 'section-header', body).innerHTML = `<span>${t('cars')}</span><span class="line"></span>`;
        const grid = el('div', 'grid c2', body);
        for (const car of [...CARS].sort((a, b) => carSortKey(a) - carSortKey(b))) {
          const isOwned = meta.canDrive(car.id);
          const isSel = meta.data.selectedCar === car.id;
          const canBuy = meta.canBuyCar(car.id);
          const card = el('div', `card car-card-v3 ${isSel ? 'selected' : ''} ${!isOwned ? 'locked' : ''} ${car.vip ? 'vip-car' : ''}`, grid);
          // REAL 3D thumbnail rendered offscreen (replaces the gradient block)
          const thumb = carThumb(car.id);
          const media = thumb
            ? `<img class="car-thumb" src="${thumb}" alt="${car.name}">`
            : `<div style="height:42px;border-radius:9px;background:linear-gradient(135deg,${car.bodyColor},${car.accentColor});margin-bottom:6px"></div>`;
          card.innerHTML = `
            <div class="tier-badge tier-${tierOf(car)}">${tierOf(car)}</div>
            ${car.id === 'kart_proto' ? '<div class="ribbon">RARE</div>' : ''}${car.vip ? `<div class="ribbon vip-rib">${ic('crown', 11)} VIP</div>` : ''}
            ${media}
            <h3 style="font-size:13px">${car.name}</h3>
            <div class="sub">${t('cls_' + car.cls)}</div>
            <div class="cc-price">${isOwned ? (isSel ? `<span class="cc-eq">${ic('check', 14)} ${t('equipped')}</span>` : '') : car.vip ? `<span class="cc-vip">${ic('crown', 13)} ${t('vipOnlyShort')}</span>` : `${car.gemOnly ? '' : money('coin', car.price, 15)}${car.gemPrice ? money('gem', car.gemPrice, 15) : ''}`}</div>`;
          card.onclick = () => {
            audio.play('click');
            // always preview the car in the showcase (locked cars too — browsing is free)
            curCar = car.id;
            ctx.showcase.setCar(car.id, isOwned ? meta.customFor(car.id) : undefined);
            ctx.showcase.setFocus('car');
            build();
            if (isOwned) {
              meta.data.selectedCar = car.id;
              meta.save();
            } else if (canBuy.ok) {
              const pay = car.gemOnly || meta.data.coins < car.price ? money('gem', car.gemPrice ?? 0, 18) : money('coin', car.price, 18);
              ui.modal(car.name, `<div class="pay-sheet"><p>${t('buy')} · ${pay}</p></div>`, [
                { label: t('cancel'), cb: () => {} },
                { label: t('buy'), cls: 'green', cb: () => { if (meta.buyCar(car.id)) { audio.play('purchase'); ui.toast(`${car.name} · ${t('purchased')}`, 'good'); build(); } } },
              ]);
            } else if (canBuy.reason === 'vipOnly') {
              audio.play('click');
              ui.modal(`${ic('crown', 20)} VIP`, `<div class="pay-sheet vip-sheet"><p>${t('vipOnly')}</p><p class="sub">${t('vipPerks')}</p></div>`, [
                { label: t('cancel'), cb: () => {} },
                { label: t('getVip'), cls: 'green', cb: () => ui.show('shop') },
              ]);
            } else if (canBuy.reason === 'notEnough' && car.gemPrice) {
              audio.play('error'); ui.toast(t('notEnough'), 'bad'); ui.show('shop');
            } else {
              audio.play('error');
              ui.toast(canBuy.reason.startsWith('unlockLevelN') ? t('unlockLevelN', canBuy.reason.split(':')[1]) : t(canBuy.reason), 'bad');
            }
          };
        }
      } else if (activeTab === 'custom') {
        if (!owned) {
          const p = el('div', 'panel', body);
          p.style.padding = '20px';
          p.innerHTML = `<p style="color:var(--dim);font-weight:800;text-align:center">${ic('lock', 18)} ${t('locked')}</p>`;
          return;
        }
        // ============ CUSTOMIZE v2 — IMAGE-FIRST MENU (user: "منو رو تغییر بده،
        // همراه با تصویر باشه و نشون بده چی میخوام اضافه کنم") ============
        // every option is now a REAL rendered preview of what it adds: wheel
        // styles show the rim, spoilers/decals/exhaust show them ON the car,
        // underglow swatches glow in their own color.
        const c = meta.customFor(curCar);
        const section = (label: string) => el('div', 'section-header', body).innerHTML = `<span>${label}</span><span class="line"></span>`;
        const swatches = (colors: string[], cur: string, cb: (v: string) => void) => {
          const w = el('div', 'swatches', body);
          for (const col of colors) {
            const sw = el('div', `swatch ${col === cur ? 'sel' : ''}`, w);
            sw.style.background = col;
            sw.onclick = () => { audio.play('click'); cb(col); build(); };
          }
        };
        /** horizontal row of IMAGE option cards (the actual preview + name) */
        const imgChips = (items: { img: string | null; label: string; fallback?: string }[], curIdx: number, cb: (i: number) => void) => {
          const row = el('div', 'opt-row', body);
          items.forEach((it, i) => {
            const chip = el('div', `opt-chip ${i === curIdx ? 'sel' : ''}`, row);
            chip.innerHTML = it.img
              ? `<img src="${it.img}" alt="${it.label}">`
              : `<div class="opt-fallback">${ic(it.fallback ?? 'car', 26)}</div>`;
            const lbl = el('div', 'opt-label', chip, it.label);
            void lbl;
            chip.onclick = () => { audio.play('click'); cb(i); build(); };
          });
        };

        section(t('paint'));
        swatches(PAINTS, c.paint, v => { c.paint = v; meta.save(); ctx.showcase.setCar(curCar, c); });
        section(`${t('paint')} 2`);
        swatches(PAINTS, c.paint2, v => { c.paint2 = v; meta.save(); ctx.showcase.setCar(curCar, c); });
        // wheels: real rim previews per style + color swatches
        section(t('wheels'));
        imgChips(
          Array.from({ length: WHEEL_STYLE_COUNT }, (_, i) => ({
            img: wheelThumb(i), label: `#${i + 1}`,
          })),
          c.wheelStyle,
          v => { c.wheelStyle = v; meta.save(); ctx.showcase.setCar(curCar, c); },
        );
        swatches(WHEEL_COLORS, c.wheelColor, v => { c.wheelColor = v; meta.save(); ctx.showcase.setCar(curCar, c); });
        // spoiler: rendered ON this car, rear 3/4 view
        section(t('spoiler'));
        imgChips(
          Array.from({ length: SPOILER_COUNT + 1 }, (_, i) => ({
            img: customThumb(curCar, { spoiler: i - 1 }, 'rear'),
            label: i === 0 ? '—' : `#${i}`,
            fallback: i === 0 ? 'ban' : 'wing',
          })),
          c.spoiler + 1,
          v => { c.spoiler = v - 1; meta.save(); ctx.showcase.setCar(curCar, c); },
        );
        // decals: front 3/4 view with the decal painted
        section(t('decals'));
        imgChips(
          Array.from({ length: DECAL_COUNT }, (_, i) => ({
            img: customThumb(curCar, { decal: i }, 'front'),
            label: i === 0 ? '—' : `#${i}`,
            fallback: i === 0 ? 'ban' : 'paint',
          })),
          c.decal,
          v => { c.decal = v; meta.save(); ctx.showcase.setCar(curCar, c); },
        );
        // exhaust: rear view with 1/2/4 pipes
        section(t('exhaust'));
        imgChips(
          ['1', '2', '4'].map((n, i) => ({
            img: customThumb(curCar, { exhaust: i }, 'rear'),
            label: `×${n}`,
            fallback: 'wind',
          })),
          c.exhaust,
          v => { c.exhaust = v; meta.save(); ctx.showcase.setCar(curCar, c); },
        );
        section(t('boostFx'));
        swatches(BOOST_COLORS, c.boostColor, v => { c.boostColor = v; meta.save(); ctx.showcase.setCar(curCar, c); });
        // UNDERGLOW (user: "بشه برای زیر ماشین افکت رنگی گذاشت") — color swatch
        // chips that glow in their own color. v1.9: the '' chip is AUTO (default
        // cyan) — the night underglow is ALWAYS on (user reported "broken" 3x
        // because stock cars had glow:'' = no glow object at all).
        section(t('underglow'));
        const glowRow = el('div', 'swatches glow-row', body);
        for (const col of GLOW_COLORS) {
          const sw = el('div', `swatch glow-swatch ${col === c.glow ? 'sel' : ''}`, glowRow);
          if (col === '') {
            sw.classList.add('glow-off');
            sw.innerHTML = ic('refresh', 16);
            sw.style.background = 'linear-gradient(135deg,#00e5ff55,#00557788)';
          } else {
            sw.style.background = col;
            sw.style.boxShadow = `0 0 14px ${col}, 0 0 4px ${col}`;
          }
          sw.title = col === '' ? t('glowAuto') : col;
          sw.onclick = () => { audio.play('click'); c.glow = col; meta.save(); ctx.showcase.setCar(curCar, c); build(); };
        }
        el('div', 'sub', body).style.cssText = 'color:var(--dim);font-size:10px;font-weight:700;text-align:center;margin:4px 0 0';
        el('div', 'sub', body).textContent = t('underglowHint');
      } else {
        if (!owned) {
          const p = el('div', 'panel', body);
          p.style.padding = '20px';
          p.innerHTML = `<p style="color:var(--dim);font-weight:800;text-align:center">${ic('lock', 18)} ${t('locked')}</p>`;
          return;
        }
        // ============ WORKSHOP (big garage update) ============
        // 5 tuning tracks x 5 levels — coins + parts, real physics per part
        const up = meta.upgradesOf(curCar);
        const panel = el('div', 'panel', body);
        panel.style.padding = '14px';
        const buildLv = meta.buildLevel(curCar);
        const st = meta.effStats(curCar);
        panel.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:baseline">
            <h2>${def.name}</h2>
            <span class="sub" style="color:var(--yellow);font-weight:900">${t('w_buildLvl')} ${fmtNum(buildLv)}/${fmtNum(25)}</span>
          </div>
          <div class="gar-stat" style="margin-top:8px">
          ${statRow(t('speed'), st.speed, 'c2')}
          ${statRow(t('accel'), st.accel, 'c3')}
          ${statRow(t('handling'), st.handling)}
          ${statRow(t('driftStat'), st.drift)}
          ${statRow(t('boost'), st.boost, 'c2')}
          ${statRow(t('defense'), st.defense)}
          </div>
          ${buildLv >= 25 ? `<p style="color:var(--green);font-weight:900;margin-top:6px">${ic('star', 14)} ${t('buildBonus')}</p>` : ''}`;

        const trackIcon: Record<string, string> = { engine: 'engine', turbo: 'turbo', tires: 'tire', drift: 'drift', armor: 'armor' };
        for (const track of ['engine', 'turbo', 'tires', 'drift', 'armor']) {
          const lvl = (up as unknown as Record<string, number>)[track] ?? 0;
          const maxed = lvl >= 5;
          const rowEl = el('div', 'tune-v3', body);
          const pips = Array.from({ length: 5 }, (_, i) =>
            `<span class="pip ${i < lvl ? 'on' : ''}"></span>`).join('');
          rowEl.innerHTML = `
            <div class="tv-ic">${ic(trackIcon[track], 22)}</div>
            <div class="tv-tx">
              <b>${t('w_' + track)}</b>
              <small>${t('w_' + track + '_d')}</small>
              <div class="pips">${pips}</div>
            </div>`;
          const action = el('div', '', rowEl);
          if (maxed) {
            action.innerHTML = `<span class="tv-max">${ic('star', 14)} ${t('max')}</span>`;
          } else {
            const costInfo = Meta.tuneCost(track, lvl);
            const affordable = meta.canTune(curCar, track);
            const btn = el('button', `btn-v ${affordable ? 'volt' : 'ghost'}`, action,
              `${ic('up', 14)}${money('coin', costInfo.coins, 15)}${money('parts', costInfo.parts, 15)}`) as HTMLButtonElement;
            if (!affordable) btn.disabled = true;
            btn.onclick = () => {
              if (meta.tuneCar(curCar, track)) {
                audio.play('levelUp');
                ui.toast(`${t('w_' + track)} ${fmtNum(lvl + 1)}/${fmtNum(5)}`, 'good');
                build();
                ctx.showcase.setCar(curCar, meta.customFor(curCar));
              } else {
                audio.play('error');
                ui.toast(t('notEnough'), 'bad');
              }
            };
          }
        }
        const hint = el('p', '', body);
        hint.style.cssText = 'color:var(--dim);font-size:11px;font-weight:700;text-align:center;margin:8px 0 4px';
        hint.textContent = `${t('parts')} → ${t('workshopSub')}`;
      }
    };

    ui.register('garage', {
      el: scr,
      onShow: () => { curCar = meta.data.selectedCar; activeTab = 'cars'; paintTabs(); build(); },
      onHide: () => { ctx.showcase.setFocus('both'); ctx.showcase.setBand(null); },
    });
  }

  // ============ CHARACTERS ============
  // FULL-SCREEN REBUILD (user: "منوی شخصیت‌ها کامل و تمام‌صفحه نبود") + the
  // roster is now FULLY localized (Persian titles/descs/traits — the English
  // 'Item roulette favors stronger items' leak is gone).
  {
    const scr = el('div', 'screen v3');
    header(scr, 'helmet', t('charSelect'), t('charsSub'), () => ui.show('menu'));
    const band = el('div', 'preview-band', scr);
    band.style.height = '24vh';
    el('div', 'band-edge top', band);
    el('div', 'band-edge bot', band);
    const bandName = el('div', 'band-name', band, '');
    const bandSub = el('div', 'band-sub', band, '');
    const body = el('div', 'screen-body', scr);
    body.id = 'chars-body';

    let animBtns: HTMLButtonElement[] = [];

    const build = () => {
      body.innerHTML = '';
      const sel = meta.data.selectedChar;
      const def = charById(sel);
      ctx.showcase.setChar(sel);
      ctx.showcase.setFocus('char');
      ctx.showcase.setCharAnim('idle');
      requestAnimationFrame(() => {
        const r = band.getBoundingClientRect();
        if (r.height > 40) ctx.showcase.setBand(r.top / window.innerHeight, r.height / window.innerHeight);
      });
      bandName.textContent = def.name;
      bandSub.textContent = t('ch_' + def.id);

      // ---- compact detail strip ----
      const detail = el('div', 'panel char-detail', body);
      const owned = meta.ownsChar(sel);
      const bigPortrait = charThumb(sel);
      detail.innerHTML = `
        <div class="cd-head">
          ${bigPortrait
            ? `<img class="cd-ava cd-ava-img" src="${bigPortrait}" alt="${def.name}">`
            : `<span class="cd-ava">${charAvatar(def.id)}</span>`}
          <div class="cd-names">
            <h2>${def.name}</h2>
            <div class="sub">${t('ch_' + def.id)}${owned ? '' : ` · ${ic('lock', 12)} ${t('level')} ${fmtNum(def.reqLevel)}`}</div>
          </div>
          <span class="trait-chip" title="${t('ch_' + def.id + '_td')}">${ic('sparkle', 13)} ${t('ch_' + def.id + '_t')}</span>
        </div>
        <p class="cd-desc">${t('ch_' + def.id + '_d')}</p>
        <div class="cd-trait-sub">${t('ch_' + def.id + '_td')}</div>`;
      // animation preview buttons
      const animRow = el('div', 'cd-anims', detail);
      animBtns = [];
      for (const [lbl, anim] of [[t('on'), 'idle'], [t('youWin'), 'win'], [t('youLose'), 'lose']] as [string, 'idle' | 'win' | 'lose'][]) {
        const b = el('button', 'btn small', animRow, lbl) as HTMLButtonElement;
        b.onclick = () => {
          audio.play('click');
          ctx.showcase.setCharAnim(anim);
          animBtns.forEach(x => x.classList.remove('yellow'));
          b.classList.add('yellow');
        };
        animBtns.push(b);
      }

      el('div', 'section-header', body).innerHTML = `<span>${t('characters')}</span><span class="line"></span>`;
      const grid = el('div', 'grid c2 char-grid', body);
      for (const ch of CHARACTERS) {
        const chOwned = meta.ownsChar(ch.id);
        const isSel = sel === ch.id;
        const canBuy = meta.canBuyChar(ch.id);
        const card = el('div', `card char-card-v3 ${isSel ? 'selected' : ''} ${!chOwned ? 'locked' : ''}`, grid);
        // REAL 3D portrait per character (user: menus must show images)
        const portrait = charThumb(ch.id);
        card.innerHTML = `
          ${portrait
            ? `<img class="char-thumb" src="${portrait}" alt="${ch.name}">`
            : `<span class="cav">${charAvatar(ch.id)}</span>`}
          <span class="cinfo">
            <h3>${ch.name}</h3>
            <div class="sub">${chOwned ? (isSel ? `<span class="cc-eq" style="color:var(--volt)">${ic('check', 13)} ${t('equipped')}</span>` : t('ch_' + ch.id)) : canBuy.ok ? `${money('coin', ch.price, 14)}${ch.gemPrice ? money('gem', ch.gemPrice, 14) : ''}` : `${ic('lock', 12)} ${t('level')} ${fmtNum(ch.reqLevel)}`}</div>
          </span>`;
        card.onclick = () => {
          audio.play('click');
          if (chOwned) {
            meta.data.selectedChar = ch.id;
            meta.save();
            build();
          } else if (canBuy.ok) {
            if (meta.buyChar(ch.id)) {
              audio.play('purchase');
              ui.toast(`${ch.name} · ${t('purchased')}`, 'good');
              build();
            }
          } else {
            audio.play('error');
            ui.toast(canBuy.reason.startsWith('unlockLevelN') ? t('unlockLevelN', canBuy.reason.split(':')[1]) : t(canBuy.reason), 'bad');
          }
        };
      }
    };

    ui.register('characters', {
      el: scr,
      onShow: () => build(),
      onHide: () => { ctx.showcase.setFocus('both'); ctx.showcase.setBand(null); ctx.showcase.setCharAnim('idle'); },
    });
  }

  // ============ MULTIPLAYER ============
  // REBUILT v2 (user spec): exactly two options — "BECOME SERVER" (host picks
  // the map, bots and which power-ups are in the boxes, then sees the SERVER
  // ADDRESS to share) and "JOIN BY IP". No more room codes. Everyone's NAME is
  // visible in the lobby and each player picks their own unlocked car & char.
  {
    const scr = el('div', 'screen v3 solid-ish');
    header(scr, 'signal', t('mpTitle'), t('mpSub'), () => { ctx.ui.show('menu'); ctx.leaveMp?.(); });
    const body = el('div', 'screen-body', scr);
    body.id = 'mp-body';

    // ---- home: exactly two options ----
    const buildHome = () => {
      body.innerHTML = '';
      const grid = el('div', 'mp-home', body);
      const mk = (poster: string, icon: string, title: string, sub: string, cls: string, go: () => void) => {
        const c = el('button', `mode-card ${cls}`, grid);
        c.innerHTML = `<img class="mc-img" src="${themePoster(poster)}" alt=""><span class="mc-shade"></span>
          <span class="mc-ic">${ic(icon, 26)}</span><span class="mc-tx"><b>${title}</b><small>${sub}</small></span>
          <span class="mc-stat">${ic('users', 13)} ${t('upTo6')}</span>`;
        c.onclick = () => { audio.play('click'); go(); };
      };
      mk('crashcity', 'server', t('becomeServer'), t('becomeServerSub'), 'm-volt', () => buildCreate());
      mk('mccity', 'link', t('joinByIp'), t('joinByIpSub'), 'm-ice', () => buildJoin());
    };

    // ---- create: settings → open server ----
    const buildCreate = () => {
      body.innerHTML = '';
      const panel = el('div', 'panel', body);
      panel.style.padding = '16px';
      panel.innerHTML = `<h2 class="lbl-ic" style="margin-bottom:10px">${ic('server', 20)} ${t('becomeServer')}</h2>`;
      const settings: MpSettings = { theme: 'grass', laps: 3, bots: 2, items: ALL_ITEM_IDS.slice() };
      mpSettingsEditor(panel, settings, () => { /* local until OPEN SERVER */ },
        th => !meta.ownsMap(th), () => ui.toast(t('mapLockedHost'), 'bad'));
      const btn = el('button', 'btn big yellow', panel, `${ic('play', 18)} ${t('openServer')}`);
      btn.style.cssText = 'width:100%;margin-top:12px';
      btn.onclick = () => { audio.play('click'); ctx.hostRoom(meta.data.name, { ...settings }); };
      const back2 = el('button', 'btn small', panel, t('back'));
      back2.style.marginTop = '8px';
      back2.onclick = () => { audio.play('back'); buildHome(); };
    };

    // ---- join by IP ----
    const buildJoin = () => {
      body.innerHTML = '';
      const panel = el('div', 'panel', body);
      panel.style.padding = '16px';
      panel.innerHTML = `
        <h2 class="lbl-ic" style="margin-bottom:6px">${ic('link', 20)} ${t('joinByIp')}</h2>
        <p style="color:var(--dim);font-size:12px;font-weight:700;margin-bottom:10px">
          ${isApp() ? t('joinAddrHintApp') : t('joinAddrHint', serverAddress())}</p>`;
      const lbl = el('div', 'mps-label', panel, `${ic('helmet', 14)} ${meta.data.name}`);
      lbl.style.marginBottom = '8px';
      // v3.8 AUTO-DISCOVERY (APK): hosts on the same Wi-Fi / hotspot show up
      // here by themselves — tap one to join, no IP typing at all.
      if (isApp()) {
        const found = el('div', 'mp-found', panel);
        found.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:10px';
        const head = el('div', 'mps-label', found, `${ic('server', 13)} ${t('findServers')}`);
        void head;
        const listEl = el('div', '', found);
        listEl.style.cssText = 'display:flex;flex-direction:column;gap:6px';
        const info = el('p', '', found, t('scanningServers'));
        info.style.cssText = 'color:var(--dim);font-size:11px;font-weight:700;margin:0';
        const shown = new Set<string>();
        const scan = async () => {
          while (found.isConnected) {
            const hosts = await discoverHosts(2500);
            if (!found.isConnected) return;
            for (const h of hosts) {
              const key = `${h.ip}:${h.port}`;
              if (shown.has(key)) continue;
              shown.add(key);
              const b = el('button', 'btn cyan', listEl, `${ic('link', 16)} ${h.name || 'KUBO'} <small dir="ltr" style="opacity:.75">${h.ip}</small>`);
              b.style.cssText = 'width:100%;justify-content:space-between';
              b.onclick = () => { audio.play('click'); ctx.joinRoom(h.port && h.port !== 3003 ? key : h.ip, meta.data.name); };
            }
            info.textContent = shown.size ? t('orTypeIp') : `${t('noServersFound')} • ${t('vpnHint')}`;
            await new Promise(r => setTimeout(r, 600));
          }
        };
        void scan();
      }
      const inp = el('input', 'mp-input', panel) as HTMLInputElement;
      inp.placeholder = isApp() ? t('joinAddrPlaceholderApp') : t('joinAddrPlaceholder');
      inp.inputMode = isApp() ? 'decimal' : 'url';
      inp.dir = 'ltr';
      inp.style.marginBottom = '12px';
      const btn = el('button', 'btn big cyan', panel, `${ic('link', 18)} ${t('join')}`);
      btn.style.width = '100%';
      btn.onclick = () => {
        audio.play('click');
        ctx.joinRoom(inp.value.trim(), meta.data.name);
      };
      const back2 = el('button', 'btn small', panel, t('back'));
      back2.style.marginTop = '8px';
      back2.onclick = () => { audio.play('back'); buildHome(); };
      const status = el('p', '', panel);
      status.id = 'mp-status';
      status.style.cssText = 'text-align:center;margin-top:10px;color:var(--cyan);font-weight:800;font-size:13px';
    };

    ui.register('mp', { el: scr, onShow: () => { buildHome(); ctx.showcase.setFocus('both'); } });
  }
}

export function buildLobby(ui: UIManager, ctx: GameCtx, state: LobbyState) {
  const body = document.getElementById('mp-body');
  if (!body) return;
  body.innerHTML = '';
  const meta = ctx.meta;
  const panel = el('div', 'mp-lobby panel', body);

  // ---- server address banner (host shares it; joiner sees where they are) ----
  // v1.13 (user: "سرور ساخته بشه آی پی اونو بزنه تا به دوستاش بگه"): the host
  // sees the FULL clickable URL — friends can either open the link directly
  // (best on phones) or type the address into JOIN BY IP.
  const addrBox = el('div', 'mp-addr', panel);
  addrBox.innerHTML = `<span class="mpa-label">${state.isHost ? `${ic('server', 13)} ${t('serverAddress')}` : `${ic('link', 13)} ${t('connectedTo')}`}</span><b class="mpa-addr" dir="ltr">${state.isHost ? fullShareUrl() : serverAddress()}</b><small class="mpa-more" style="display:block;font-size:11px;font-weight:700;color:var(--dim)"></small>`;
  // v3.8 LIVE HOST IP (APK): the address used to be read ONCE — if hotspot was
  // switched on after opening the server, the lobby showed "—" forever. Now it
  // refreshes every 2 s, lists EVERY usable address (hotspot + Wi-Fi) and tells
  // the host what to do when there is none.
  if (state.isHost && isApp()) {
    const main = addrBox.querySelector('.mpa-addr') as HTMLElement;
    const more = addrBox.querySelector('.mpa-more') as HTMLElement;
    const kindLabel = (k?: string) => k === 'hotspot' ? t('lanKindHotspot') : k === 'wifi' ? t('lanKindWifi') : t('lanKindOther');
    const paint = () => {
      const list = hostAddrList();
      if (!list.length) {
        const np = hostIpProblem() === 'no-plugin';
        main.textContent = np ? t('lanNoPlugin') : t('noLanIp');
        more.textContent = np ? t('lanNoPluginHint') : t('lanNoIpHint');
        return;
      }
      main.textContent = list[0].ip;
      more.textContent = list.length > 1
        ? list.map(a => `${kindLabel(a.kind)}: ${a.ip}`).join('  •  ')
        : kindLabel(list[0].kind);
    };
    paint();
    const tick = async () => {
      while (addrBox.isConnected) {
        await refreshHostAddr();
        if (!addrBox.isConnected) return;
        paint();
        await new Promise(r => setTimeout(r, 2000));
      }
    };
    void tick();
  }
  if (state.isHost) {
    addrBox.title = t('tapCopy');
    addrBox.onclick = () => {
      const addr = fullShareUrl();
      navigator.clipboard?.writeText(addr).catch(() => { /* clipboard blocked */ });
      ui.toast(t('copied'), 'good');
    };
  }
  const hint = el('p', '', panel);
  hint.style.cssText = 'text-align:center;color:var(--dim);font-size:11px;font-weight:700';
  hint.textContent = state.isHost
    ? `${t('youAreHost')} • ${isApp() ? t('shareAddrHintApp') : t('shareAddrHint')}`
    : t('waitingHost');

  // ---- player list: NAME + CAR IMAGE + CHARACTER IMAGE + host tag + ready ----
  // v1.8 (user: "وقتی میخوایم با حالت سرور بازی کنم عکس ماشین‌ها و کاراکترها
  // باشه"): every lobby row now shows the REAL rendered car + character thumbs
  const list = el('div', 'mp-players', panel);
  for (const p of state.players) {
    const row = el('div', `player-row ${p.isMe ? 'me-row' : ''}`, list);
    const carDef = CARS.find(c => c.id === p.car);
    const cThumb = charThumb(p.char);
    const carImg = carThumb(p.car);
    const ava = `<div class="pav" style="background:${p.color}33">${cThumb
      ? `<img class="pav-img" src="${cThumb}" alt="${charById(p.char).name}" draggable="false">`
      : charAvatar(p.char)}</div>`;
    const carMedia = carImg
      ? `<img class="pcar-img" src="${carImg}" alt="${carDef?.name ?? '?'}" draggable="false">`
      : `<span class="pcar-fallback">${ic('car', 24)}</span>`;
    row.innerHTML = `
      ${ava}
      ${carMedia}
      <div class="pinfo">
        <b class="pname">${p.name}${p.isMe ? ` <small style="color:var(--volt)">· ${t('lobbyYou')}</small>` : ''}</b>
        <div class="psub">${carDef ? carDef.name : '?'} · ${charById(p.char).name}</div>
      </div>
      ${p.isHost ? `<span class="host-tag">HOST</span>` : ''}`;
    const readyTag = el('span', `chip ${p.ready ? 'ready-chip' : ''}`, row, '');
    readyTag.style.cssText = `font-size:11px;padding:3px 10px;color:${p.ready ? 'var(--green)' : 'var(--dim)'}`;
    readyTag.innerHTML = p.ready ? `${ic('check', 12)} ${t('ready')}` : t('notReady');
  }

  // ---- my car & character pickers (host AND joiners can choose).
  // USER REQUEST: the HOST's unlocked cars are also available to JOINERS —
  // but ONLY inside this multiplayer lobby (fairer pack racing). Host-only
  // cars are marked with 📡. ----
  const pick = el('div', 'mp-pick', panel);
  const hostCars = state.hostCars ?? [];
  const carEntries = CARS
    .filter(c => meta.canDrive(c.id) || hostCars.includes(c.id))
    .map(c => ({ id: c.id, label: `${c.name}${!meta.canDrive(c.id) ? ` ${ic('server', 11)}` : ''}` }));
  const mkPicker = (label: string, cur: string, entries: { id: string; label: string }[], cb: (id: string) => void) => {
    const wrap = el('div', 'mp-pick-row', pick);
    el('div', 'mps-label', wrap, label);
    const chips = el('div', 'mp-pick-chips', wrap);
    for (const e of entries) {
      const b = el('button', `mp-pick-chip ${e.id === cur ? 'on' : ''}`, chips, e.label);
      b.onclick = () => {
        audio.play('click');
        cb(e.id);
        buildInner();
      };
    }
  };
  mkPicker(`${ic('car', 14)} ${t('carChoice')}${!state.isHost && hostCars.length ? ` <span class="sub">· ${t('lobbyHintHostCars')}</span>` : ''}`, meta.data.selectedCar,
    carEntries,
    id => { meta.data.selectedCar = id; meta.save(); ctx.setLobbyCar?.(id); refreshPreview(); });
  mkPicker(`${ic('helmet', 14)} ${t('charChoice')}`, meta.data.selectedChar,
    CHARACTERS.filter(c => meta.ownsChar(c.id)).map(c => ({ id: c.id, label: c.name })),
    id => { meta.data.selectedChar = id; meta.save(); ctx.setLobbyChar?.(id); });

  // ---- USER REQUEST: customize the car RIGHT HERE in the lobby (paint +
  // underglow quick editor) with a live showcase preview behind the panel ----
  const custWrap = el('div', 'mp-pick', panel);
  const custHead = el('button', 'mp-pick-chip', custWrap, `${ic('paint', 14)} ${t('lobbyCustomize')}`);
  const custBody = el('div', '', custWrap);
  custBody.style.display = 'none';
  custHead.style.width = '100%';
  const refreshPreview = () => {
    if (custBody.style.display !== 'none') ctx.showcase.setCar(meta.data.selectedCar, meta.customFor(meta.data.selectedCar));
  };
  custHead.onclick = () => {
    audio.play('click');
    custBody.style.display = custBody.style.display === 'none' ? 'block' : 'none';
    custHead.classList.toggle('on', custBody.style.display !== 'none');
    if (custBody.style.display !== 'none') {
      ctx.showcase.setCar(meta.data.selectedCar, meta.customFor(meta.data.selectedCar));
      ctx.showcase.setFocus('car');
      custBody.innerHTML = '';
      const c = meta.customFor(meta.data.selectedCar);
      const mkSwatches = (title: string, colors: string[], get: () => string, set: (v: string) => void, glow = false) => {
        el('div', 'mps-label', custBody, title);
        const row = el('div', `swatches${glow ? ' glow-row' : ''}`, custBody);
        for (const col of colors) {
          const sw = el('div', `swatch${glow ? ' glow-swatch' : ''} ${get() === col ? 'sel' : ''}`, row);
          sw.style.background = col || 'linear-gradient(135deg,#333,#111)';
          if (glow) { sw.style.boxShadow = `0 0 12px ${col || 'transparent'}`; sw.style.background = col || 'transparent'; if (!col) { sw.classList.add('glow-off'); sw.innerHTML = ic('x', 14); } }
          sw.onclick = () => {
            audio.play('click');
            set(col);
            meta.save();
            ctx.showcase.setCar(meta.data.selectedCar, c);
            custBody.querySelectorAll('.swatch').forEach(s2 => s2.classList.remove('sel'));
            sw.classList.add('sel');
          };
        }
      };
      mkSwatches(t('paint'), PAINTS.slice(0, 8), () => c.paint, v => { c.paint = v; });
      mkSwatches(t('underglow'), GLOW_COLORS.slice(0, 7), () => c.glow, v => { c.glow = v; }, true);
      const hint2 = el('div', 'sub', custBody);
      hint2.style.cssText = 'padding:4px 2px';
      hint2.textContent = `${t('garage')}: ${t('customize')} +`;
    }
  };

  const buildInner = () => { /* picker re-render: full lobby rebuild keeps it simple */ buildLobby(ui, ctx, state); };

  // ---- host: live settings + START ----
  if (state.isHost) {
    const sHost = el('div', 'mp-settings-host', panel);
    const local: MpSettings = { ...state.settings, items: state.settings.items.slice() };
    mpSettingsEditor(sHost, local, (s2) => {
      state.settings = { ...s2 };
      ctx.hostChangeSettings?.({ ...s2 });
    }, th => !meta.ownsMap(th), () => ui.toast(t('mapLockedHost'), 'bad'));
    const startBtn = el('button', 'btn big yellow', panel, `${ic('flag', 20)} ${t('startRace')}`);
    startBtn.style.width = '100%';
    startBtn.onclick = () => { audio.play('click'); ctx.hostStartRace(); };
  } else {
    const readyBtn = el('button', `btn big ${state.meReady ? 'ready' : 'not'}`, panel, state.meReady ? `${ic('check', 18)} ${t('ready')}` : t('ready'));
    readyBtn.style.width = '100%';
    readyBtn.onclick = () => { audio.play('click'); ctx.toggleReady(); };
  }

  const count = el('p', '', panel);
  count.style.cssText = 'text-align:center;color:var(--dim);font-size:11px;font-weight:700';
  count.innerHTML = `${ic('users', 12)} ${fmtNum(state.players.length)}/${fmtNum(6)} · ${ic('map', 12)} ${state.themeName} · ${ic('laps', 12)} ${fmtNum(state.settings.laps)} · ${ic('bot', 12)} ${fmtNum(state.settings.bots)}`;
}

export interface LobbyState {
  code: string;
  isHost: boolean;
  meReady: boolean;
  players: { id: string; name: string; char: string; car: string; color: string; isHost: boolean; isMe: boolean; ready: boolean }[];
  settings: MpSettings;
  themeName: string;
  /** cars the HOST has unlocked — joiners may use them, but only in MP */
  hostCars?: string[];
}

export function registerRaceOverlays(ui: UIManager, ctx: GameCtx) {
  // ============ PAUSE ============
  {
    const scr = el('div', 'screen');
    const wrap = el('div', 'results-wrap', scr);
    const panel = el('div', 'pause-panel panel', wrap);
    el('h2', 'lbl-ic', panel, `${ic('pause', 20)} ${t('paused')}`).style.cssText = 'justify-content:center;display:flex';
    // quick control-mode switch (wheel / arrow buttons)
    const ctrlRow = el('div', '', panel);
    ctrlRow.style.cssText = 'display:flex;gap:8px;justify-content:center;margin:2px 0 10px';
    const mkCtrl = (label: string, mode: 'wheel' | 'buttons') => {
      const b = el('button', 'btn small', ctrlRow, label);
      b.onclick = () => {
        audio.play('click');
        ctx.meta.data.settings.steerMode = mode;
        ctx.meta.save();
        ui.hud.setSteerMode(mode);
        for (const c of ctrlRow.children) (c as HTMLElement).classList.remove('yellow');
        b.classList.add('yellow');
      };
      return b;
    };
    const wheelBtn = mkCtrl(`${ic('steer', 14)} ${t('wheel')}`, 'wheel');
    const buttonsBtn = mkCtrl(`${ic('controller', 14)} ${t('buttons')}`, 'buttons');
    const paintCtrl = () => {
      wheelBtn.classList.toggle('yellow', ctx.meta.data.settings.steerMode !== 'buttons');
      buttonsBtn.classList.toggle('yellow', ctx.meta.data.settings.steerMode === 'buttons');
    };
    const resume = el('button', 'btn big yellow', panel, `${ic('play', 18)} ${t('resume')}`);
    resume.onclick = () => { audio.play('click'); ctx.resumeRace(); };
    // v1.10 HUD LAYOUT EDITOR (user: "یه گزینه بزار که کاربر بتونه خودش تمام
    // دکمه‌ها و چینش‌های داخل صفحه انجام بده"): closes the pause overlay and
    // opens the drag/resize editor over the (frozen) race HUD.
    const layoutBtn = el('button', 'btn cyan', panel, t('hudLayoutEdit'));
    layoutBtn.onclick = () => {
      audio.play('click');
      ui.closeCurrent();               // hide the pause panel, race stays paused
      openHudLayoutEditor(ui, ctx.meta, () => ui.show('pause'));
    };
    const restart = el('button', 'btn', panel, `${ic('refresh', 16)} ${t('restart')}`);
    restart.onclick = () => { audio.play('click'); ctx.restartRace(); };
    const quit = el('button', 'btn red', panel, `${ic('x', 16)} ${t('quit')}`);
    quit.onclick = () => { audio.play('back'); ctx.quitRace(); };
    ui.register('pause', { el: scr, onShow: () => paintCtrl() });
  }

  // ============ RESULTS ============
  {
    const scr = el('div', 'screen');
    const wrap = el('div', 'results-wrap', scr);
    const panel = el('div', 'results-panel panel', wrap);
    panel.id = 'results-panel';
    ui.register('results', {
      el: scr,
      onShow: (params) => {
        const r = params as RaceResult & { levelId: number; objectiveText: string; isMp: boolean; record: boolean };
        panel.innerHTML = '';
        const win = r.position === 1;
        const title = el('div', '', panel);
        title.style.margin = '4px 0 2px';
        title.innerHTML = `<span style="font-size:15px;font-weight:900;letter-spacing:2px;color:var(--dim)">${t('raceFinished')}</span>`;
        const pos = el('div', `results-pos ${win ? 'p1' : 'other'}`, panel, '');
        pos.innerHTML = win ? `${ic('trophy', 34)} ${t('youWin')}` : `${ordinal(r.position)} <small style="font-size:20px">/ ${r.total}</small>`;
        // stars (career only)
        if (r.levelId > 0) {
          const stars = el('div', 'results-stars', panel);
          for (let i = 1; i <= 3; i++) {
            const s = el('span', `s ${i <= r.stars ? '' : 'off'}`, stars, ic('star', 40));
            s.style.animationDelay = `${i * 0.22}s`;
          }
        }
        // objective
        if (r.levelId > 0) {
          const obj = el('div', '', panel);
          obj.innerHTML = `<span class="obj-banner ${r.objectiveDone ? 'ok' : 'fail'}">${ic(r.objectiveDone ? 'check' : 'x', 14)} ${r.objectiveText}</span>`;
        }
        // time
        const timeRow = el('div', '', panel);
        timeRow.style.cssText = 'margin-top:8px;color:var(--dim);font-weight:800;font-size:13px';
        timeRow.innerHTML = `${t('time')}: <b style="color:#fff">${fmtTime2(r.timeMs)}</b>${r.record ? ` <span style="color:var(--green)">${ic('trophy', 14)} ${t('newRecord')}</span>` : ''}`;
        // v3.5 race events recap (overtakes + mini missions)
        if (!r.isMp && ((r.overtakes ?? 0) > 0 || (r.missions ?? 0) > 0)) {
          const ev = el('div', 'res-events', panel);
          ev.innerHTML = `<span>${ic('fwd', 14)} ${t('resOvertakes')}: <b>${r.overtakes ?? 0}</b></span><span>${ic('target', 14)} ${t('resMissions')}: <b>${r.missions ?? 0}</b></span>${(r.eventCoins ?? 0) > 0 ? `<span>${cur('coin', 16)} <b>+${r.eventCoins}</b></span>` : ''}`;
        }
        // rewards
        const rewards = el('div', 'reward-row', panel);
        const addReward = (icon: string, val: number, label: string, delay: number) => {
          if (val <= 0) return;
          const chip = el('div', 'reward-chip gain', rewards);
          chip.style.animationDelay = `${delay}s`;
          chip.innerHTML = `<span class="ri">${icon}</span><span class="rv" id="rv-${label}">+${val}</span><span style="font-size:9px;color:var(--dim);font-weight:800">${label}</span>`;
        };
        addReward(cur('coin', 26), r.coins, 'coins', 0.3);
        addReward(`<span style="color:var(--ice)">${ic('star', 24)}</span>`, r.xp, 'xp', 0.45);
        addReward(cur('parts', 26), r.parts, 'parts', 0.6);
        addReward(cur('gem', 26), r.gems, 'gems', 0.75);
        // buttons
        const btns = el('div', 'results-btns', panel);
        const mk = (label: string, cls: string, cb: () => void) => {
          const b = el('button', `btn ${cls}`, btns, label);
          b.onclick = () => { audio.play('click'); cb(); };
        };
        // v3.5: "next stage" only when it is really open (it used to start a locked stage)
        if (!r.isMp && r.levelId > 0 && ctx.meta.isLevelUnlocked(r.levelId + 1)) mk(`${ic('play', 16)} ${t('nextRace')}`, 'yellow', () => ctx.nextLevel());
        mk(`${ic('refresh', 16)} ${t('replay')}`, 'cyan', () => ctx.restartRace());
        mk(`${ic('home', 16)} ${t('toMenu')}`, '', () => ctx.quitRace());
        if (r.isMp) mk(`${ic('signal', 16)} ${t('multiplayer')}`, 'green', () => ctx.backToLobby());
      },
    });
  }
}

function ordinal(n: number): string {
  const s = ['TH', 'ST', 'ND', 'RD'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function fmtTime2(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
