// KUBO KARTS v3 - Menu screens: main menu, modes, SEASONS (career), quick
// race (illustrated posters), items (+ per-power-up switches), TOMAN shop,
// daily rewards, challenges + achievements, PROFILE, settings.
// The old NEWS screen and the "latest news" banner/tile are gone (user request).
import { el, type UIManager } from './ui';
import { openHudLayoutEditorFromSettings } from './hudLayout';
import { t, getLang } from '../core/lang';
import { audio, SOUND_NAMES } from '../core/audio';
import { THEMES, themeById } from '../world/themes';
import { LEVELS, levelName, levelDesc, type LevelDef } from '../race/levels';
import { faDigits, fmtNum, fmtTime } from '../core/utils';
import { ITEMS, type ItemId } from '../items/items';
import { itemIconDataURL } from './icons';
import { ic, cur, type Currency } from './icons3';
import { header, section, switchEl, money, bar } from './kit';
import { themePoster } from './posters';
import { mapThumb } from './mapthumbs';
import { charThumb, carThumb } from './thumbs';
import { CARS, tierOf } from '../data/cars';
import { CHARACTERS, charById } from '../data/characters';
import { PRODUCTS, requestPayment, grantProduct, alreadyBought, fmtToman, paymentConnected, savePct, worthToman, isFirstGemBuy, type Product } from '../meta/store';
import { PREMIUM_MAPS, Meta } from '../meta/meta';
import { ACHIEVEMENTS, achProgress, claimAch, achClaimable } from '../meta/achievements';
import type { GameCtx } from './ctx';
import './lang3';
import './lang35';
import './lang36';
import { itemModePicker } from './itemMode';

const fa = () => getLang() === 'fa';
const N = (n: number | string) => (fa() ? faDigits(n) : String(n));

/** seasons = consecutive groups of 3 career worlds */
export interface Season { idx: number; worlds: string[]; levels: LevelDef[] }
export function seasons(): Season[] {
  const order: string[] = [];
  for (const l of LEVELS) if (!order.includes(l.themeId)) order.push(l.themeId);
  const out: Season[] = [];
  for (let i = 0; i < order.length; i += 3) {
    const worlds = order.slice(i, i + 3);
    out.push({ idx: out.length, worlds, levels: LEVELS.filter(l => worlds.includes(l.themeId)) });
  }
  return out;
}

const MOD_IC: Record<string, string> = {
  night: 'moon', lowgrip: 'snow', turbostart: 'rocket', itemstorm: 'box',
  noitems: 'ban', fog: 'fog', boss: 'crown', gems: 'gemS', veteran: 'flame',
};

export const ITEM_CATS: [string, ItemId[]][] = [
  ['cat_attack', ['rocket', 'lightning', 'ice', 'emp', 'minecart']],
  ['cat_trap', ['jump', 'mine', 'tnt', 'banana', 'trap']],
  ['cat_defense', ['shield', 'ghost', 'giant']],
  ['cat_util', ['boost', 'magnet']],
];

/** big faceted currency art, stacked for bigger packs */
function packArt(kind: Currency, tier: number): string {
  const n = Math.max(1, Math.min(3, tier));
  let h = '';
  for (let i = 0; i < n; i++) h += `<span class="pa pa${i}">${cur(kind, 58 - i * 6)}</span>`;
  return `<div class="pack-art n${n}">${h}</div>`;
}

export function registerMenuScreens(ui: UIManager, ctx: GameCtx) {
  const meta = ctx.meta;
  const S = meta.data.settings;
  const itemsOnFor = (mode: 'career' | 'quick') =>
    mode === 'career' ? (S.itemsCareer ?? S.itemsOn ?? true) : (S.itemsQuick ?? S.itemsOn ?? true);
  const setItemsFor = (mode: 'career' | 'quick', v: boolean) => {
    if (mode === 'career') S.itemsCareer = v; else S.itemsQuick = v;
    meta.save();
    ui.toast(`${t(mode === 'career' ? 'career' : 'quickRace')} · ${t('powerUps')}: ${v ? t('on') : t('off')}`, v ? 'good' : '');
  };
  /** compact "POWER-UPS on/off" control used on the career & quick screens */
  const powerSwitch = (parent: HTMLElement, mode: 'career' | 'quick') => {
    const w = el('div', 'pw-switch', parent);
    el('span', 'pw-ic', w, ic('box', 16));
    el('span', 'pw-l', w, t('powerUps'));
    switchEl(w, itemsOnFor(mode), v => setItemsFor(mode, v), t('powerUps'));
    return w;
  };

  /** v3.5 premium map unlock flow (quick race + shop): gems confirm, or VIP */
  const unlockMap = (themeId: string, done: () => void) => {
    const price = meta.mapGemPrice(themeId);
    const art = `<div class="map-unlock"><img src="${themePoster(themeId)}" alt=""><b>${t('theme_' + themeId)}</b></div>`;
    if (!price) {   // VIP-only map
      ui.modal(t('vipOnlyMap'), `${art}<p>${t('vipPerks')}</p>`, [
        { label: t('cancel'), cb: () => {} },
        { label: `${ic('crown', 14)} ${t('getVip')}`, cls: 'yellow', cb: () => ui.show('shop') },
      ]);
      return;
    }
    if (meta.data.gems < price) {
      ui.modal(t('notEnoughGems'), `${art}<p>${t('needGemsN', N(price - meta.data.gems))}</p>`, [
        { label: t('cancel'), cb: () => {} },
        { label: `${cur('gem', 14)} ${t('getGems')}`, cls: 'yellow', cb: () => ui.show('shop') },
      ]);
      return;
    }
    ui.modal(t('unlockMapQ'), `${art}<p>${t('unlockMapBody')}</p>`, [
      { label: t('cancel'), cb: () => {} },
      { label: `${cur('gem', 14)} ${N(price)}`, cls: 'green', cb: () => {
        if (meta.buyMap(themeId)) { audio.play('unlock'); ui.toast(`${t('theme_' + themeId)} · ${t('purchased')}`, 'good'); done(); }
        else { audio.play('error'); ui.toast(t('notEnough'), 'bad'); }
      } },
    ]);
  };

  // ============ MAIN MENU (v3.5 redesign) ============
  // user: "منوی اصلی بازی جذاب‌ترش کن، مسابقه‌ای‌ترش کن". What changed & why:
  //  • CONTINUE card: the very next stage is ONE tap away (no menu digging),
  //    with its goal and "N stars to the next chest" (goal-gradient hook)
  //  • big PLAY with a moving shine + quick buttons for Quick Race / Online
  //  • OFFER carousel: VIP / Legend Pack / today's real car deal (the car deal
  //    really ends at midnight, so its timer is honest — no fake urgency for kids)
  //  • your CAR plate (name + tier) in the middle, under the 3D showcase
  //  • animated speed streaks + sparks behind everything; daily gift bounces
  {
    const scr = el('div', 'screen v3 mm v35');
    scr.id = 'menu-root';
    scr.innerHTML = `<div class="mm-fx"><i></i><i></i><i></i><i></i><i></i><i></i><b></b><b></b><b></b><b></b></div>`;

    const top = el('div', 'mm-top', scr);
    const prof = el('button', 'mm-profile', top);
    const wallet = el('div', 'mm-wallet', top);

    // ---- left column: continue card + offer carousel ----
    const left = el('div', 'mm-left', scr);
    const next = el('button', 'mm-next', left);
    const offer = el('div', 'mm-offer', left);

    // ---- right column: play + modes + tiles ----
    const nav = el('div', 'mm-nav', scr);
    const play = el('button', 'mm-play', nav);
    play.innerHTML = `
      <span class="mp-ic">${ic('flag', 30)}</span>
      <span class="mp-tx"><b>${t('play')}</b><small>${t('playSub')}</small></span>
      <span class="mp-go">${ic(fa() ? 'back' : 'fwd', 26)}</span><span class="mp-shine"></span>`;
    play.onclick = () => { audio.play('click'); ui.show('modes'); };
    const modes = el('div', 'mm-modes', nav);
    const modeBtn = (icon: string, label: string, go: () => void, cls: string) => {
      const b = el('button', `mm-mode ${cls}`, modes, `${ic(icon, 20)}<b>${label}</b>`);
      b.onclick = () => { audio.play('click'); go(); };
    };
    modeBtn('clock', t('quickRace'), () => ui.show('quick'), 'mo-ice');
    modeBtn('signal', t('multiplayer'), () => ui.show('mp'), 'mo-flare');
    const grid = el('div', 'mm-grid', nav);
    const tile = (icon: string, label: string, sub: string, go: string, cls = '') => {
      const b = el('button', `mm-tile ${cls}`, grid);
      b.innerHTML = `<span class="mt-ic">${ic(icon, 24)}</span><span class="mt-tx"><b>${label}</b><small>${sub}</small></span>`;
      b.onclick = () => { audio.play('click'); ui.show(go); };
      return b;
    };
    const tGarage = tile('wrench', t('garage'), '', 'garage', 't-ice');
    const tChars = tile('helmet', t('characters'), '', 'characters', 't-flare');
    tile('bolt', t('items'), t('itemsSub'), 'items', 't-violet');
    const tShop = tile('bag', t('shop'), t('shopSub'), 'shop', 't-gold');
    el('span', 'mt-hot', tShop, t('hotTag'));

    // ---- centre: my ride plate ----
    const ride = el('button', 'mm-ride', scr);
    ride.onclick = () => { audio.play('click'); ui.show('garage'); };

    const dock = el('div', 'mm-dock', scr);
    const dockBtn = (icon: string, label: string, go: string) => {
      const b = el('button', 'mm-dk', dock);
      b.innerHTML = `<span class="dk-ic">${ic(icon, 22)}</span><span class="dk-l">${label}</span>`;
      b.onclick = () => { audio.play('click'); ui.show(go); };
      return b;
    };
    const dMap = dockBtn('map', t('seasons'), 'levels');
    const dCh = dockBtn('target', t('challenges'), 'challenges');
    const dDaily = dockBtn('gift', t('dailyShort'), 'daily');
    dockBtn('medal', t('profile'), 'profile');
    const setBadge = (b: HTMLElement, txt: string | null) => {
      let bd = b.querySelector('.dk-badge');
      if (!txt) { bd?.remove(); return; }
      if (!bd) bd = el('span', 'dk-badge', b);
      bd.textContent = txt;
    };

    const untilMidnight = () => {
      const now = new Date(); const mid = new Date(now); mid.setHours(24, 0, 0, 0);
      const ms = mid.getTime() - now.getTime();
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
      return N(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);
    };

    const paintNext = () => {
      const lv = meta.nextLevel();
      if (!lv) {
        next.className = 'mm-next all';
        next.innerHTML = `<span class="nx-art">${ic('trophy', 34)}</span><span class="nx-tx"><small>${t('career')}</small><b>${t('allCleared')}</b><em>${t('allClearedSub')}</em></span>`;
        next.onclick = () => { audio.play('click'); ui.show('levels'); };
        return;
      }
      const SEAS = seasons();
      const si = SEAS.findIndex(x => x.levels.some(l => l.id === lv.id));
      const sea = SEAS[Math.max(0, si)];
      let chestTxt = '';
      for (let k = 0; k < 3; k++) {
        if (meta.chestState(sea.idx, sea.levels, k) === 'locked') {
          const need = meta.chestNeed(sea.levels, k) - meta.seasonStars(sea.levels).got;
          chestTxt = `${ic('gift', 12)} ${t('starsToChest', N(need))}`;
          break;
        }
        if (meta.chestState(sea.idx, sea.levels, k) === 'ready') { chestTxt = `${ic('gift', 12)} ${t('chestReady')}`; break; }
      }
      const idxIn = sea.levels.filter(l => l.themeId === lv.themeId).findIndex(l => l.id === lv.id) + 1;
      next.className = 'mm-next';
      next.innerHTML = `
        <span class="nx-art"><img src="${mapThumb(lv.themeId)}" alt=""><i>${N(idxIn)}</i></span>
        <span class="nx-tx"><small>${t('continueCareer')} · ${t('theme_' + lv.themeId)}</small><b>${levelName(lv)}</b><em>${ic('target', 12)} ${levelDesc(lv)}</em>${chestTxt ? `<u>${chestTxt}</u>` : ''}</span>
        <span class="nx-go">${ic('play', 22)}</span>`;
      next.onclick = () => { audio.play('click'); ctx.startLevel(lv); };
    };

    // offer carousel
    let offers: { html: string; go: () => void; cls: string }[] = [];
    let oi = 0;
    let offerTimer = 0;
    const buildOffers = () => {
      offers = [];
      const vipM = PRODUCTS.find(p => p.id === 'vip_month');
      if (vipM && !meta.isVip()) offers.push({
        cls: 'of-vip', go: () => ui.show('shop'),
        html: `<span class="of-ic">${ic('crown', 30)}</span><span class="of-tx"><b>${t('vipMonth')}</b><small>${t('vipPerks')}</small></span><span class="of-p">${fmtToman(vipM.toman, fa())}<small>${t('toman')}</small></span>`,
      });
      const leg = PRODUCTS.find(p => p.id === 'legend_pack');
      if (leg && !alreadyBought(meta, leg)) offers.push({
        cls: 'of-legend', go: () => ui.show('shop'),
        html: `<span class="of-ic">${ic('trophy', 30)}</span><span class="of-tx"><b>${t('legendPack')}</b><small>${t('legendPack_d')}</small></span><span class="of-p"><s>${fmtToman(worthToman(leg), fa())}</s>${fmtToman(leg.toman, fa())}<small>${t('toman')}</small></span>`,
      });
      const deal = meta.ensureShopOffers().filter(o => o.startsWith('car:')).map(o => CARS.find(c => c.id === o.slice(4))).find(c => c && !meta.ownsCar(c.id));
      if (deal) {
        const th = carThumb(deal.id);
        offers.push({
          cls: 'of-deal', go: () => ui.show('shop'),
          html: `<span class="of-ic car">${th ? `<img src="${th}" alt="">` : ic('car', 30)}</span><span class="of-tx"><b>${deal.name} <em>-25٪</em></b><small class="of-timer">${ic('clock', 11)} <span data-timer>${untilMidnight()}</span></small></span><span class="of-p">${money('coin', Math.round(deal.price * 0.75), 15)}</span>`,
        });
      }
      paintOffer();
    };
    const paintOffer = () => {
      if (!offers.length) { offer.style.display = 'none'; return; }
      offer.style.display = '';
      oi = oi % offers.length;
      const o = offers[oi];
      offer.className = `mm-offer ${o.cls}`;
      offer.innerHTML = `${o.html}<span class="of-dots">${offers.map((_, i) => `<i class="${i === oi ? 'on' : ''}"></i>`).join('')}</span>`;
      offer.onclick = () => { audio.play('click'); o.go(); };
    };
    const tick = () => {
      const tm = offer.querySelector('[data-timer]');
      if (tm) tm.textContent = untilMidnight();
    };

    const refresh = () => {
      const li = meta.levelInfo;
      const portrait = charThumb(meta.data.selectedChar);
      prof.innerHTML = `
        <span class="pf-ava">${portrait ? `<img src="${portrait}" alt="">` : ic('helmet', 26)}</span>
        <span class="pf-tx">
          <b>${meta.data.name}${meta.isVip() ? ` <span class="vip-chip">${ic('crown', 11)} VIP</span>` : ''}</b>
          <span class="pf-lv"><i>${N(li.level)}</i>${bar(li.cur / li.need, 'xp')}</span>
        </span>`;
      wallet.innerHTML = '';
      const wChip = (kind: Currency, val: number) => {
        const c = el('button', `w-chip w-${kind}`, wallet, `${cur(kind, 22)}<b>${fmtNum(val)}</b>${kind !== 'parts' ? `<span class="w-plus">${ic('up', 12)}</span>` : ''}`);
        c.onclick = () => { audio.play('click'); ui.show('shop'); };
      };
      wChip('coin', meta.data.coins);
      wChip('gem', meta.data.gems);
      wChip('parts', meta.data.parts);
      const gear = el('button', 'w-set', wallet, ic('cog', 22));
      gear.setAttribute('aria-label', t('settings'));
      gear.onclick = () => { audio.play('click'); ui.show('settings'); };
      const car = CARS.find(c => c.id === meta.data.selectedCar);
      tGarage.querySelector('small')!.textContent = car ? car.name : '';
      tChars.querySelector('small')!.textContent = charById(meta.data.selectedChar).name;
      if (car) {
        const tier = tierOf(car);
        ride.innerHTML = `<span class="tier-tag tier-${tier}">${tier}</span><b>${car.name}</b><small>${t('cls_' + car.cls)}</small><span class="rd-go">${ic('wrench', 14)}</span>`;
      }
      setBadge(dMap, `${N(meta.totalStars())}★`);
      const ready = meta.challengesReady() + achClaimable(meta);
      setBadge(dCh, ready ? N(ready) : null);
      const canDaily = meta.canClaimDaily();
      setBadge(dDaily, canDaily ? '!' : null);
      dDaily.classList.toggle('bounce', canDaily);
      dCh.classList.toggle('bounce', ready > 0);
      dMap.classList.toggle('has-num', true);
      paintNext();
      buildOffers();
    };
    prof.onclick = () => { audio.play('click'); ui.show('profile'); };

    ui.register('menu', { el: scr, onShow: () => {
      meta.validateSelection();                     // v3.4: expired VIP car -> safe fallback
      const vd = meta.claimVipDaily();              // v3.4: VIP daily gems
      if (vd) ui.toast(`VIP +${N(vd)}`, 'good');
      ctx.showcase.setFocus('both'); refresh();
      clearInterval(offerTimer);
      let n = 0;
      offerTimer = window.setInterval(() => {
        tick();
        if (++n % 5 === 0 && offers.length > 1) { oi++; paintOffer(); }
      }, 1000);
    }, onHide: () => clearInterval(offerTimer) });
  }

  // ============ MODES ============
  {
    const scr = el('div', 'screen v3 solid-ish');
    header(scr, 'flag', t('chooseMode'), t('chooseModeSub'), () => ui.show('menu'));
    const body = el('div', 'screen-body', scr);
    const grid = el('div', 'mode-grid', body);
    const mode = (poster: string, icon: string, name: string, desc: string, stat: () => string, cls: string, go: () => void) => {
      const c = el('button', `mode-card ${cls}`, grid);
      c.innerHTML = `
        <img class="mc-img" src="${themePoster(poster)}" alt="">
        <span class="mc-shade"></span>
        <span class="mc-ic">${ic(icon, 26)}</span>
        <span class="mc-tx"><b>${name}</b><small>${desc}</small></span>
        <span class="mc-stat"></span>`;
      c.onclick = () => { audio.play('click'); go(); };
      return { c, stat };
    };
    const cards = [
      mode('grass', 'trophy', t('career'), t('careerDesc'), () => `${ic('star', 13)} ${N(meta.totalStars())} / ${N(LEVELS.length * 3)}`, 'm-volt', () => ui.show('levels')),
      mode('city', 'clock', t('quickRace'), t('quickDesc'), () => `${ic('map', 13)} ${N(THEMES.length)} ${t('maps')}`, 'm-ice', () => ui.show('quick')),
      mode('crashcity', 'signal', t('multiplayer'), t('mpDesc'), () => `${ic('users', 13)} ${t('upTo6')}`, 'm-flare', () => ui.show('mp')),
    ];
    ui.register('modes', {
      el: scr,
      onShow: () => {
        ctx.showcase.setFocus('both');
        for (const k of cards) k.c.querySelector('.mc-stat')!.innerHTML = k.stat();
      },
    });
  }

  // ============ SEASONS (career level select) ============
  {
    const scr = el('div', 'screen v3 solid-ish');
    const end = header(scr, 'map', t('seasons'), t('seasonsSub'), () => ui.show('modes'));
    const starsChip = el('span', 'hdr-chip', end, '');
    powerSwitch(end, 'career');
    const tabs = el('div', 'season-tabs', scr);
    const body = el('div', 'screen-body', scr);
    const SEAS = seasons();
    let cur = 0;

    const seasonStars = (s: Season) => s.levels.reduce((a, l) => a + meta.levelRecord(l.id).stars, 0);
    const seasonOpen = (s: Season) => meta.isLevelUnlocked(s.levels[0].id);

    const buildTabs = () => {
      tabs.innerHTML = '';
      for (const s of SEAS) {
        const open = seasonOpen(s);
        const b = el('button', `s-tab ${s.idx === cur ? 'on' : ''} ${open ? '' : 'locked'}`, tabs);
        const st = seasonStars(s), max = s.levels.length * 3;
        b.innerHTML = `<span class="st-n">${t('season')} ${N(s.idx + 1)}</span><b>${t('season_' + s.idx)}</b>
          <span class="st-p">${open ? `${ic('star', 11)} ${N(st)}/${N(max)}` : ic('lock', 12)}</span>${bar(st / max, 'thin')}${[0, 1, 2].some(k => meta.chestState(s.idx, s.levels, k) === 'ready') ? '<i class="s-dot"></i>' : ''}`;
        b.onclick = () => { audio.play('click'); cur = s.idx; build(); };
      }
    };

    const build = () => {
      starsChip.innerHTML = `${ic('star', 14)} ${N(meta.totalStars())}/${N(LEVELS.length * 3)}`;
      buildTabs();
      body.innerHTML = '';
      const s = SEAS[cur];
      const open = seasonOpen(s);
      const st = seasonStars(s), max = s.levels.length * 3;
      // hero banner
      const hero = el('div', `season-hero ${open ? '' : 'locked'}`, body);
      hero.innerHTML = `
        <div class="sh-art">${s.worlds.map(w => `<img src="${themePoster(w)}" alt="">`).join('')}</div>
        <div class="sh-shade"></div>
        <div class="sh-tx">
          <span class="sh-k">${t('season')} ${N(s.idx + 1)}</span>
          <h2>${t('season_' + s.idx)}</h2>
          <p>${t('season_' + s.idx + '_d')}</p>
          <div class="sh-prog">${bar(st / max, 'volt')}<span>${ic('star', 13)} ${N(st)} / ${N(max)}</span></div>
        </div>
        ${open ? '' : `<div class="sh-lock">${ic('lock', 28)}<span>${t('seasonLocked')}</span></div>`}`;
      // v3.6 SEASON CHESTS: 3 chests on a star rail (1/3, 2/3, all stars)
      if (open) {
        const ct = el('div', 'chest-track', body);
        ct.innerHTML = `<div class="ct-h">${ic('gift', 14)} ${t('chestsTitle')}<span>${ic('star', 12)} ${N(st)} / ${N(max)}</span></div>`;
        const rail = el('div', 'ct-rail', ct);
        rail.innerHTML = `<i style="width:${Math.min(100, (st / max) * 100).toFixed(1)}%"></i>`;
        for (let k = 0; k < 3; k++) {
          const need = meta.chestNeed(s.levels, k);
          const state = meta.chestState(s.idx, s.levels, k);
          const c = el('button', `ct-chest ${state} ${k === 2 ? 'big' : ''}`, rail);
          c.style.insetInlineStart = `${((need / max) * 100).toFixed(1)}%`;
          const rw = Meta.SEASON_CHESTS[k];
          c.innerHTML = `<span class="ct-box">${state === 'open' ? ic('check', 22) : ic('gift', k === 2 ? 30 : 24)}</span>
            <small>${state === 'ready' ? t('chestOpen') : state === 'open' ? t('chestDone') : `${ic('star', 10)} ${N(need)}`}</small>`;
          c.onclick = () => {
            if (state === 'open') { audio.play('click'); return; }
            if (state === 'locked') { audio.play('error'); ui.toast(t('chestLockedN', N(need - st)), 'bad'); return; }
            if (!meta.claimChest(s.idx, s.levels, k)) return;
            audio.play('reward');
            const parts = [rw.coins ? money('coin', rw.coins, 22) : '', rw.gems ? money('gem', rw.gems, 22) : '', rw.parts ? money('parts', rw.parts, 22) : ''].join('');
            ui.modal(t('chestOpened'), `<div class="chest-pop"><span class="cp-box">${ic('gift', 56)}</span><div class="cp-rw">${parts}</div></div>`,
              [{ label: t('ok'), cls: 'green', cb: () => build() }]);
            build();
          };
        }
      }
      // v3.6 WINDING ROAD: stages zig-zag along a real curved road (RTL-aware)
      const myCar = carThumb(meta.data.selectedCar);
      for (const w of s.worlds) {
        const lv = s.levels.filter(l => l.themeId === w);
        const wst = lv.reduce((a, l) => a + meta.levelRecord(l.id).stars, 0);
        const wh = el('div', 'world-head', body);
        wh.innerHTML = `<img src="${mapThumb(w)}" alt=""><b>${t('theme_' + w)}</b><span class="sec-rule"></span><span class="wh-s">${ic('star', 12)} ${N(wst)}/${N(lv.length * 3)}</span>`;
        const scroll = el('div', 'wind-scroll', body);
        const wind = el('div', 'wind', scroll);
        const STEP = 156, CW = 132, AMP = 70, TOP = 40, PAD = 16, TAIL = 60;
        const width = PAD * 2 + (lv.length - 1) * STEP + CW + TAIL;
        const height = TOP + AMP + 132 + 8;
        wind.style.width = `${width}px`; wind.style.height = `${height}px`;
        const X = (x: number) => (fa() ? width - x : x);
        // anchor = centre of each stage's number badge
        const pts = lv.map((_, i) => ({ x: X(PAD + i * STEP + CW / 2), y: TOP + 25 + (i % 2 ? AMP : 0) }));
        const endPt = { x: X(PAD + (lv.length - 1) * STEP + CW + TAIL / 2 + 4), y: pts[pts.length - 1].y };
        const curve = (list: { x: number; y: number }[]) => list.reduce((d, p, i) => {
          if (!i) return `M${p.x} ${p.y}`;
          const q = list[i - 1], mx = (q.x + p.x) / 2;
          return `${d} C${mx} ${q.y} ${mx} ${p.y} ${p.x} ${p.y}`;
        }, '');
        let reach = 0;   // how far the lit road goes: up to the next playable stage
        lv.forEach((l, i) => { if (meta.isLevelUnlocked(l.id)) reach = i; });
        const all = curve([...pts, endPt]);
        const lit = reach > 0 ? curve(pts.slice(0, reach + 1)) : '';
        wind.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
          <path class="rd-edge" d="${all}"/><path class="rd-base" d="${all}"/><path class="rd-dash" d="${all}"/>${lit ? `<path class="rd-done" d="${lit}"/>` : ''}</svg>`;
        const flag = el('span', 'flag-end', wind, ic('trophy', 18));
        flag.style.left = `${endPt.x}px`; flag.style.top = `${endPt.y}px`;
        let nextCard = null as HTMLElement | null;
        lv.forEach((l, i) => {
          const rec = meta.levelRecord(l.id);
          const un = meta.isLevelUnlocked(l.id);
          const gp = (l.mods ?? []).includes('boss');
          const isNext = un && !rec.stars;
          const card = el('button', `stage ${un ? '' : 'locked'} ${gp ? 'gp' : ''} ${rec.stars ? 'done' : ''} ${isNext ? 'next' : ''}`, wind);
          card.style.left = `${pts[i].x - CW / 2}px`;
          card.style.top = `${pts[i].y - 25}px`;
          const stars = [1, 2, 3].map(k => `<i class="${k <= rec.stars ? 'on' : ''}">${ic('star', 13)}</i>`).join('');
          const mods = (l.mods ?? []).map(m => `<span class="st-mod" title="${t('mod_' + m)}">${ic(MOD_IC[m] ?? 'sparkle', 12)}</span>`).join('');
          card.innerHTML = `
            ${isNext && myCar ? `<span class="sg-pin"><img src="${myCar}" alt=""><b>${t('youAreHere')}</b></span>` : ''}
            <span class="sg-num">${gp ? ic('crown', 16) : N(i + 1)}</span>
            <span class="sg-name">${levelName(l)}</span>
            <span class="sg-obj">${un ? levelDesc(l) : t('locked')}</span>
            <span class="sg-foot"><span class="sg-stars">${stars}</span><span class="sg-mods">${mods}</span></span>
            ${un ? `<span class="sg-meta">${ic('laps', 11)} ${N(l.laps)} · ${rec.best ? fmtTime(rec.best) : '--:--'}</span>` : `<span class="sg-lock">${ic('lock', 18)}</span>`}`;
          if (isNext) nextCard = card;
          card.onclick = () => {
            if (!un) { audio.play('error'); ui.toast(t('needPrev'), 'bad'); return; }
            audio.play('click');
            ctx.startLevel(l);
          };
        });
        // bring the current stage into view inside its road (horizontal only)
        if (nextCard) {
          const nc = nextCard as HTMLElement;
          requestAnimationFrame(() => {
            const sr = scroll.getBoundingClientRect(), cr = nc.getBoundingClientRect();
            scroll.scrollLeft += (cr.left + cr.width / 2) - (sr.left + sr.width / 2);
          });
        }
      }
    };
    ui.register('levels', {
      el: scr,
      onShow: () => {
        ctx.showcase.setFocus('both');
        // open on the season holding the next unplayed stage
        const nx = meta.nextLevel();
        if (nx) { const si = SEAS.findIndex(s => s.levels.some(l => l.id === nx.id)); if (si >= 0) cur = si; }
        build();
      },
    });
  }

  // ============ QUICK RACE ============
  {
    const scr = el('div', 'screen v3 solid-ish');
    const end = header(scr, 'clock', t('quickRace'), t('quickSub'), () => ui.show('modes'));
    powerSwitch(end, 'quick');
    const body = el('div', 'screen-body', scr);
    const grid = el('div', 'poster-grid', body);
    let laps = 3;
    let sel = THEMES[0].id;
    const cards: Record<string, HTMLElement> = {};
    for (const th of THEMES) {
      const c = el('button', `poster ${th.id === sel ? 'sel' : ''}`, grid);
      const tags: string[] = [];
      if (th.night) tags.push(`<span class="pt">${ic('moon', 12)} ${t('tagNight')}</span>`);
      if (th.hazard !== 'none') tags.push(`<span class="pt warn">${ic('flame', 12)} ${t('tagHazard')}</span>`);
      if (th.jumpGap) tags.push(`<span class="pt">${ic('rocket', 12)} ${t('tagJumps')}</span>`);
      if (th.id === 'megaramp') tags.push(`<span class="pt">${ic('laps', 12)} ${t('oneLap')}</span>`);
      c.innerHTML = `
        <img class="po-img" src="${themePoster(th.id)}" alt="" loading="lazy">
        <span class="po-map"><img src="${mapThumb(th.id)}" alt=""></span>
        <span class="po-tags">${tags.join('')}</span>
        <span class="po-name">${t('theme_' + th.id)}</span>
        <span class="po-check">${ic('check', 16)}</span>
        ${meta.isMapPremium(th.id) ? `<span class="po-prem">${ic('crown', 12)} ${t('premiumMap')}</span><span class="po-lock"></span>` : ''}`;
      c.onclick = () => {
        audio.play('click');
        sel = th.id;
        for (const k of Object.keys(cards)) cards[k].classList.toggle('sel', k === sel);
        paintBar();
      };
      cards[th.id] = c;
    }
    // bottom start bar: laps + go
    const sb = el('div', 'start-bar', scr);
    const sbInfo = el('div', 'sb-info', sb);
    const lapsBox = el('div', 'sb-laps', sb);
    el('span', 'sb-l', lapsBox, `${ic('laps', 14)} ${t('laps')}`);
    const seg = el('div', 'seg v3seg', lapsBox);
    for (let l = 1; l <= 8; l++) {
      const b = el('button', l === laps ? 'active' : '', seg, N(l));
      b.onclick = () => {
        audio.play('click'); laps = l;
        seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); paintBar();
      };
    }
    const go = el('button', 'btn-v volt big', sb, `${ic('play', 18)}<span>${t('startRace')}</span>`);
    go.onclick = () => {
      audio.play('click');
      if (!meta.ownsMap(sel)) { unlockMap(sel, paintBar); return; }
      ctx.startQuickRace(sel, laps);
    };
    // v3.5 PREMIUM MAPS: locked posters show a crown + price; the start button turns into "unlock"
    const paintLocks = () => {
      for (const id of Object.keys(cards)) {
        const lk = cards[id].querySelector('.po-lock') as HTMLElement | null;
        if (!lk) continue;
        const own = meta.ownsMap(id);
        cards[id].classList.toggle('locked', !own);
        const price = meta.mapGemPrice(id);
        lk.innerHTML = own ? '' : `${ic('lock', 22)}<span>${price ? `${cur('gem', 16)} ${N(price)}` : `${ic('crown', 14)} VIP`}</span>`;
      }
    };
    const paintBar = () => {
      paintLocks();
      const own = meta.ownsMap(sel);
      const price = meta.mapGemPrice(sel);
      go.className = `btn-v ${own ? 'volt' : 'gold'} big`;
      go.innerHTML = own ? `${ic('play', 18)}<span>${t('startRace')}</span>`
        : price ? `${ic('lock', 18)}<span>${t('unlock')}</span>${cur('gem', 18)}<b>${N(price)}</b>` : `${ic('crown', 18)}<span>${t('vipOnlyShort')}</span>`;
      const lp = sel === 'megaramp' ? 1 : laps;
      sbInfo.innerHTML = `<img src="${mapThumb(sel)}" alt=""><span><b>${t('theme_' + sel)}</b><small>${N(lp)} ${t('laps')} · ${itemsOnFor('quick') ? t('powerUpsOn') : t('powerUpsOff')}</small></span>`;
    };
    ui.register('quick', { el: scr, onShow: () => { ctx.showcase.setFocus('both'); paintBar(); } });
  }

  // ============ ITEMS (guide + per-power-up switches) ============
  {
    const scr = el('div', 'screen v3 solid-ish');
    header(scr, 'bolt', t('items'), t('itemsSub2'), () => ui.show('menu'));
    const body = el('div', 'screen-body', scr);
    const build = () => {
      body.innerHTML = '';
      // per-mode master switches
      const modes = el('div', 'items-modes', body);
      for (const m of ['career', 'quick'] as const) {
        const r = el('div', 'im-row', modes);
        r.innerHTML = `<span class="im-ic">${ic(m === 'career' ? 'trophy' : 'clock', 20)}</span><span class="im-tx"><b>${t(m === 'career' ? 'career' : 'quickRace')}</b><small>${t('powerUpsModeSub')}</small></span>`;
        switchEl(r, itemsOnFor(m), v => { setItemsFor(m, v); }, t('powerUps'));
      }
      el('div', 'im-note', body, `${ic('info', 14)} ${t('powerUpsMpNote')}`);
      const off = (S.itemsOff ??= []);
      for (const [cat, ids] of ITEM_CATS) {
        section(body, t(cat), N(ids.length));
        const g = el('div', 'item-grid', body);
        for (const id of ids) {
          const it = ITEMS[id];
          const on = !off.includes(id);
          const c = el('div', `item-card ${on ? '' : 'off'}`, g);
          c.style.setProperty('--ic', it.color);
          c.innerHTML = `
            <span class="ic-art"><img src="${itemIconDataURL(id)}" alt="" draggable="false"></span>
            <span class="ic-tx"><b>${t('item_' + id)}</b><small>${t('item_' + id + '_d')}</small></span>`;
          switchEl(c, on, v => {
            const i = off.indexOf(id);
            if (!v) {
              if (Object.keys(ITEMS).length - off.length <= 1) { audio.play('error'); build(); return; }
              if (i < 0) off.push(id);
            } else if (i >= 0) off.splice(i, 1);
            c.classList.toggle('off', !v);
            meta.save();
          }, t('item_' + id));
        }
      }
    };
    ui.register('items', { el: scr, onShow: () => { ctx.showcase.setFocus('both'); build(); } });
  }

  // ============ SHOP (Toman) ============
  {
    const scr = el('div', 'screen v3 solid-ish');
    const end = header(scr, 'bag', t('shopTitle'), t('shopSub'), () => ui.show('menu'));
    const wal = el('div', 'hdr-wallet', end);
    const body = el('div', 'screen-body shop-body', scr);

    const paintWallet = () => {
      wal.innerHTML = money('coin', meta.data.coins, 18) + money('gem', meta.data.gems, 18) + money('parts', meta.data.parts, 18);
    };
    const priceTag = (p: Product) => `<span class="toman"><b>${fmtToman(p.toman, fa())}</b><small>${t('toman')}</small></span>`;
    // v3.1 price psychology: crossed-out "worth" anchor + % saved (bundles & big packs)
    const anchorTag = (p: Product) => {
      const sp = savePct(p);
      if (!sp) return '';
      return `<span class="sp-anchor"><span class="sp-old">${fmtToman(worthToman(p), fa())}</span><span class="sp-save">${t('youSave')} ${N(sp)}٪</span></span>`;
    };

    const buy = async (p: Product) => {
      audio.play('click');
      if (!paymentConnected()) {
        ui.modal(t('payTitle'), `<div class="pay-sheet">${ic('lock', 26)}<p>${t('payNotConnected')}</p><div class="pay-sum"><span>${t(p.nameKey)}</span>${priceTag(p)}</div></div>`,
          [{ label: t('ok'), cls: 'green', cb: () => {} }]);
        return;
      }
      const ok = await requestPayment(p).catch(() => false);
      if (ok) { grantProduct(meta, p); audio.play('purchase'); ui.toast(t('purchased'), 'good'); build(); }
      else { audio.play('error'); ui.toast(t('payFailed'), 'bad'); }
    };

    const contents = (p: Product) => {
      const parts: string[] = [];
      if (p.gems) parts.push(money('gem', p.gems, 16));
      if (p.coins) parts.push(money('coin', p.coins, 16));
      if (p.parts) parts.push(money('parts', p.parts, 16));
      return parts.join('');
    };
    const ribbon = (p: Product) => p.tag ? `<span class="rib rib-${p.tag}">${t(p.tag === 'hot' ? 'mostPopular' : p.tag === 'best' ? 'bestValue' : 'onlyOnce')}</span>` : (p.bonus ? `<span class="rib">+${N(p.bonus)}٪</span>` : '');

    const build = () => {
      paintWallet();
      body.innerHTML = '';
      // featured
      const pro = PRODUCTS.find(p => p.id === 'bundle_pro')!;
      const rookie = PRODUCTS.find(p => p.id === 'bundle_rookie')!;
      const feat = el('div', 'shop-feat', body);
      const mkFeat = (p: Product, cls: string) => {
        const done = alreadyBought(meta, p);
        const f = el('button', `feat ${cls} ${done ? 'done' : ''}`, feat);
        f.innerHTML = `
          ${ribbon(p)}
          <div class="ft-art">${cur('gem', 64, 'a1')}${cur('coin', 52, 'a2')}${cur('parts', 44, 'a3')}</div>
          <div class="ft-tx"><b>${t(p.nameKey)}</b><small>${t(p.nameKey + '_d')}</small><div class="ft-c">${contents(p)}</div></div>
          <div class="ft-buy">${done ? `<span class="toman">${ic('check', 16)} ${t('owned')}</span>` : anchorTag(p) + priceTag(p)}</div>`;
        if (!done) f.onclick = () => buy(p);
      };
      mkFeat(pro, 'pro');
      mkFeat(rookie, 'rookie');

      const packs = (kind: 'gems' | 'coins' | 'parts', title: string, icon: Currency) => {
        section(body, title);
        const g = el('div', 'pack-grid', body);
        const list = PRODUCTS.filter(p => p.kind === kind);
        list.forEach((p, i) => {
          const amt = p.gems ?? p.coins ?? p.parts ?? 0;
          const c = el('button', `pack pk-${icon} ${p.tag === 'best' ? 'featured' : ''} ${p.tag === 'hot' ? 'popular' : ''}`, g);
          const x2 = kind === 'gems' && isFirstGemBuy(meta);   // v3.5: show the first-purchase x2 (it was granted but never shown)
          c.innerHTML = `${x2 ? `<span class="rib rib-x2">x2 ${t('firstBuy')}</span>` : ribbon(p)}${packArt(icon, i + 1)}<b class="pk-amt">${fmtNum(x2 ? amt * 2 : amt)}</b>${x2 ? `<s class="pk-was">${fmtNum(amt)}</s>` : ''}<span class="pk-n">${t(p.nameKey)}</span>${p.bonus ? `<span class="sp-bonus">+${N(p.bonus)}٪ ${t('bonusPct')}</span>` : ''}${priceTag(p)}`;
          c.onclick = () => buy(p);
        });
      };
      // v3.4 VIP PASS + LEGEND PACK (top of the gem packs)
      // v3.5: VIP perks listed as big, clear bullets (kids read icons, not sentences)
      section(body, t('vipTitle'), meta.isVip() ? `${t('vipActive')} · ${N(meta.vipDaysLeft())} ${t('daysShort')}` : '');
      const perks = el('div', 'vip-perks', body);
      for (const [i2, k] of [['car', 'vp_cars'], ['map', 'vp_maps'], ['tag', 'vp_coins'], ['gemS', 'vp_gems']] as const) el('span', 'vp', perks, `${ic(i2, 18)}<b>${t(k)}</b>`);
      const vg = el('div', 'pack-grid vip-grid', body);
      for (const p of PRODUCTS.filter(x => x.kind === 'vip' || x.kind === 'legend')) {
        const done = alreadyBought(meta, p);
        const c = el('button', `pack vip-pack ${p.tag === 'best' ? 'featured' : ''} ${done ? 'done' : ''}`, vg);
        c.innerHTML = `${ribbon(p)}<span class="vip-ic">${ic('crown', 40)}</span><b class="pk-amt">${t(p.nameKey)}</b><span class="pk-n">${p.kind === 'legend' ? t('legendPack_d') : t('vipPerks')}</span>${done ? `<span class="toman">${ic('check', 14)} ${t('owned')}</span>` : anchorTag(p) + priceTag(p)}`;
        if (!done) c.onclick = () => buy(p);
      }
      // v3.5 PREMIUM MAPS (gems) — good / better / best ladder + VIP-only gold city
      section(body, t('premiumMaps'), t('premiumMapsSub'));
      const mg = el('div', 'map-shop', body);
      for (const id of Object.keys(PREMIUM_MAPS)) {
        const own = meta.ownsMap(id);
        const forever = (meta.data.ownedMaps ?? []).includes(id);
        const price = PREMIUM_MAPS[id];
        const c = el('button', `map-card ${own ? 'owned' : ''} ${price ? '' : 'vip'}`, mg);
        c.innerHTML = `<img src="${themePoster(id)}" alt="" loading="lazy"><span class="mcd-shade"></span><b>${t('theme_' + id)}</b>
          <span class="mcd-p">${own ? `${ic('check', 14)} ${forever ? t('owned') : 'VIP'}` : price ? `${cur('gem', 16)} ${N(price)}` : `${ic('crown', 14)} ${t('vipOnlyShort')}`}</span>`;
        if (!forever) c.onclick = () => { audio.play('click'); if (own) { ui.toast(t('vipActive'), 'good'); return; } unlockMap(id, build); };
      }
      packs('gems', t('gemsTitle'), 'gem');
      packs('coins', t('coinsTitle'), 'coin');
      packs('parts', t('partsTitle'), 'parts');

      // in-game exchange (gems → coins / parts)
      section(body, t('exchange'), t('exchangeSub'));
      const ex = el('div', 'pack-grid ex', body);
      const exOffers: [Currency, number, number][] = [['coin', 2000, 20], ['coin', 5500, 50], ['parts', 12, 30]];
      exOffers.forEach(([kind, amount, cost], i) => {
        const c = el('button', `pack ex pk-${kind}`, ex);
        c.innerHTML = `${packArt(kind, i + 1)}<b class="pk-amt">${fmtNum(amount)}</b><span class="pk-n">${t(kind === 'coin' ? 'coins' : 'parts')}</span><span class="toman gemprice">${cur('gem', 16)}<b>${fmtNum(cost)}</b></span>`;
        c.onclick = () => {
          if (meta.data.gems < cost) { audio.play('error'); ui.toast(t('notEnough'), 'bad'); return; }
          meta.data.gems -= cost;
          if (kind === 'coin') meta.addCoins(amount); else meta.addParts(amount);
          meta.save(); audio.play('purchase'); ui.toast(t('purchased'), 'good'); build();
        };
      });

      // daily car deal (coins)
      const offers = meta.ensureShopOffers().filter(o => o.startsWith('car:'));
      if (offers.length) {
        section(body, t('dailyOffers'), '-25٪');
        const g = el('div', 'deal-grid', body);
        for (const o of offers) {
          const car = CARS.find(c => c.id === o.slice(4));
          if (!car) continue;
          const price = Math.round(car.price * 0.75);
          const owned = meta.ownsCar(car.id);
          const th = carThumb(car.id);
          const c = el('button', `deal ${owned ? 'done' : ''}`, g);
          c.innerHTML = `<span class="tier-tag tier-${tierOf(car)}">${tierOf(car)}</span>${th ? `<img src="${th}" alt="">` : ic('car', 40)}<b>${car.name}</b>
            ${owned ? `<span class="toman">${ic('check', 14)} ${t('owned')}</span>` : `<span class="deal-p"><s>${fmtNum(car.price)}</s>${money('coin', price, 16)}</span>`}`;
          if (!owned) c.onclick = () => {
            if (meta.data.coins < price) { audio.play('error'); ui.toast(t('notEnough'), 'bad'); return; }
            meta.data.coins -= price;
            meta.data.ownedCars.push(car.id);
            meta.customFor(car.id);
            meta.save(); audio.play('purchase'); ui.toast(`${car.name} · ${t('purchased')}`, 'good'); build();
          };
        }
      }
      el('p', 'shop-legal', body, t('shopLegal'));
    };
    ui.register('shop', { el: scr, onShow: () => { ctx.showcase.setFocus('both'); build(); } });
  }

  // ============ DAILY REWARDS ============
  {
    const scr = el('div', 'screen v3 solid-ish');
    header(scr, 'gift', t('dailyRewards'), t('dailySub'), () => ui.show('menu'));
    const body = el('div', 'screen-body', scr);
    const DAY: [Currency | 'big', number][] = [['coin', 300], ['parts', 3], ['coin', 600], ['gem', 10], ['parts', 6], ['gem', 20], ['big', 0]];
    const build = () => {
      body.innerHTML = '';
      const strip = el('div', 'daily-v3', body);
      const dayIdx = meta.dailyDayIndex();
      const can = meta.canClaimDaily();
      DAY.forEach(([k, v], i) => {
        const state = i < dayIdx || (!can && i === dayIdx) ? 'got' : i === dayIdx && can ? 'today' : '';
        const c = el('div', `dv ${state} ${k === 'big' ? 'big' : ''}`, strip);
        c.innerHTML = `<span class="dv-d">${t('day')} ${N(i + 1)}</span>
          <span class="dv-art">${k === 'big' ? `${cur('gem', 34)}${cur('coin', 30)}` : cur(k, 40)}</span>
          <b>${k === 'big' ? t('bigPrize') : fmtNum(v)}</b>${state === 'got' ? `<span class="dv-ok">${ic('check', 16)}</span>` : ''}`;
      });
      const btn = el('button', `btn-v ${can ? 'volt' : 'ghost'} big wide`, body, can ? `${ic('gift', 18)}<span>${t('claim')}</span>` : `${ic('hourglass', 18)}<span>${t('comeBack')}</span>`) as HTMLButtonElement;
      btn.disabled = !can;
      btn.onclick = () => {
        const res = meta.claimDaily();
        if (res) { audio.play('reward'); ui.toast(res.reward.label, 'good'); build(); }
      };
    };
    ui.register('daily', { el: scr, onShow: () => { ctx.showcase.setFocus('both'); build(); } });
  }

  // ============ CHALLENGES + ACHIEVEMENTS ============
  {
    const scr = el('div', 'screen v3 solid-ish');
    const end = header(scr, 'target', t('challenges'), t('challengesSub'), () => ui.show('menu'));
    const timer = el('span', 'hdr-chip', end, '');
    const tabs = el('div', 'v3tabs', scr);
    const body = el('div', 'screen-body', scr);
    let tab: 'daily' | 'ach' = 'daily';
    const TASK_IC: Record<string, string> = { ch_win1: 'trophy', ch_win3: 'trophy', ch_drift20: 'drift', ch_coins50: 'tag', ch_items5: 'box', ch_race2: 'flag', ch_stars2: 'star', ch_mp1: 'users', ch_jump10: 'rocket',
      ch_podium1: 'medal', ch_overtake5: 'fwd', ch_overtake15: 'fwd', ch_overtake30: 'fwd', ch_event2: 'target', ch_event5: 'target', ch_goal3: 'flag', ch_drift60: 'drift' };
    let tick = 0;
    const paintTimer = () => {
      const now = new Date();
      const mid = new Date(now); mid.setHours(24, 0, 0, 0);
      const ms = mid.getTime() - now.getTime();
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      timer.innerHTML = `${ic('clock', 14)} ${N(String(h).padStart(2, '0'))}:${N(String(m).padStart(2, '0'))}`;
    };
    const card = (icon: string, title: string, sub: string, frac: number, prog: string, reward: string, state: 'claim' | 'done' | 'run', onClaim?: () => void, onSwap?: () => void) => {
      const r = el('div', `ch-card ${state}`, body);
      r.innerHTML = `
        <span class="chc-ic">${ic(icon, 24)}</span>
        <span class="chc-tx"><b>${title}</b><small>${sub}</small><span class="chc-bar">${bar(frac, state === 'run' ? '' : 'volt')}<em>${prog}</em></span></span>
        <span class="chc-rw">${reward}</span>`;
      const act = el('span', 'chc-act', r);
      if (state === 'claim') {
        const b = el('button', 'btn-v volt', act, t('claim'));
        b.onclick = () => onClaim?.();
      } else if (state === 'done') act.innerHTML = `<span class="chc-ok">${ic('check', 18)}</span>`;
      else if (onSwap) {
        const sw = el('button', 'chc-swap', act, `${ic('refresh', 16)}<span>${t('rerollBtn')}</span>`);
        sw.onclick = () => onSwap();
      } else act.innerHTML = `<span class="chc-lock">${ic('hourglass', 16)}</span>`;
    };
    const build = () => {
      tabs.innerHTML = '';
      const achN = achClaimable(meta);
      for (const [k, lbl] of [['daily', t('dailyTasks')], ['ach', t('achievements')]] as const) {
        const b = el('button', `v3tab ${tab === k ? 'on' : ''}`, tabs, `${lbl}${k === 'ach' && achN ? ` <i>${N(achN)}</i>` : ''}`);
        b.onclick = () => { audio.play('click'); tab = k; build(); };
      }
      body.innerHTML = '';
      if (tab === 'daily') {
        meta.ensureChallenges();
        // v3.6 daily set card: 3 progress pips + the bonus chest (goal-gradient hook)
        const tasks = meta.data.challenges.tasks;
        const doneN = tasks.filter(x => x.claimed).length;
        const bonusState = meta.chBonusClaimed() ? 'open' : meta.canClaimChBonus() ? 'ready' : 'locked';
        const cs = el('div', 'ch-set', body);
        const bm = meta.coinMul();
        cs.innerHTML = `
          <span class="cs-tx"><b>${t('chSetTitle')} · ${N(doneN)}/${N(3)}</b>
            <span class="cs-dots">${tasks.map(x => `<i class="${x.claimed ? 'on' : ''}"></i>`).join('')}</span>
            <small>${bonusState === 'open' ? t('chSetDone') : t('chSetSub')} · ${meta.canReroll() ? t('rerollFree') : t('rerollUsed')}</small></span>
          <span class="cs-rw">${money('gem', Meta.CH_BONUS.gems, 16)}${money('coin', Meta.CH_BONUS.coins * bm, 16)}</span>`;
        const chest = el('button', `cs-chest ${bonusState}`, cs, bonusState === 'open' ? ic('check', 26) : ic('gift', 32));
        chest.onclick = () => {
          if (bonusState === 'locked') { audio.play('error'); ui.toast(t('chSetSub'), 'bad'); return; }
          if (bonusState === 'open' || !meta.claimChBonus()) { audio.play('click'); return; }
          audio.play('reward');
          ui.modal(t('chestOpened'), `<div class="chest-pop"><span class="cp-box">${ic('gift', 56)}</span><div class="cp-rw">${money('gem', Meta.CH_BONUS.gems, 22)}${money('coin', Meta.CH_BONUS.coins * bm, 22)}</div></div>`,
            [{ label: t('ok'), cls: 'green', cb: () => build() }]);
          build();
        };
        for (const task of tasks) {
          const goal = meta.challengeGoal(task.id);
          const rw = meta.challengeReward(task.id);
          const tier = meta.challengeTier(task.id);
          const state = task.claimed ? 'done' : task.p >= goal ? 'claim' : 'run';
          const rwHtml = money('coin', rw.coins, 16) + (rw.gems ? money('gem', rw.gems, 16) : '') + (rw.parts ? money('parts', rw.parts, 16) : '') + `<span class="xp-tag">+${N(rw.xp)} XP</span>`;
          card(TASK_IC[task.id] ?? 'target', `<span class="ch-tier ${tier}">${t(tier)}</span>${t(task.id)}`, t('dailyTaskSub'), task.p / goal, `${fmtNum(task.p)} / ${fmtNum(goal)}`,
            rwHtml, state,
            () => {
              if (!meta.claimChallenge(task.id)) return;
              audio.play('reward');
              ui.toast(`+${fmtNum(rw.coins)}${rw.gems ? ` · +${N(rw.gems)} 💎` : ''}${rw.parts ? ` · +${N(rw.parts)} 🔧` : ''}`, 'good');
              build();
            },
            state === 'run' && meta.canReroll() ? () => {
              if (meta.rerollChallenge(task.id)) { audio.play('unlock'); ui.toast(t('rerolled'), 'good'); build(); }
              else { audio.play('error'); }
            } : undefined);
        }
      } else {
        const list = ACHIEVEMENTS.map(a => ({ a, p: achProgress(meta, a) }))
          .sort((x, y) => (Number(y.p.done && !y.p.claimed) - Number(x.p.done && !x.p.claimed)) || (Number(x.p.claimed) - Number(y.p.claimed)));
        for (const { a, p } of list) {
          const rw = (a.gems ? money('gem', a.gems, 16) : '') + (a.coins ? money('coin', a.coins, 16) : '');
          card(a.icon, t(a.id), t(a.id + '_d'), p.v / a.goal, `${fmtNum(p.v)} / ${fmtNum(a.goal)}`, rw,
            p.claimed ? 'done' : p.done ? 'claim' : 'run',
            () => { if (claimAch(meta, a)) { audio.play('reward'); ui.toast(t('achDone'), 'good'); build(); } });
        }
      }
    };
    ui.register('challenges', {
      el: scr,
      onShow: () => { ctx.showcase.setFocus('both'); paintTimer(); clearInterval(tick); tick = window.setInterval(paintTimer, 30000); build(); },
      onHide: () => clearInterval(tick),
    });
  }

  // ============ PROFILE ============
  {
    const scr = el('div', 'screen v3 solid-ish');
    header(scr, 'medal', t('profile'), t('profileSub'), () => ui.show('menu'));
    const body = el('div', 'screen-body', scr);
    const build = () => {
      body.innerHTML = '';
      const li = meta.levelInfo;
      const st = meta.data.stats;
      const wrap = el('div', 'pro-wrap', body);
      // hero card
      const hero = el('div', 'pro-hero', wrap);
      const portrait = charThumb(meta.data.selectedChar);
      const carT = carThumb(meta.data.selectedCar);
      const circ = 2 * Math.PI * 54;
      hero.innerHTML = `
        <div class="ph-ring">
          <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" class="r-bg"/><circle cx="60" cy="60" r="54" class="r-fg" stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - li.cur / li.need)).toFixed(1)}"/></svg>
          <span class="ph-ava">${portrait ? `<img src="${portrait}" alt="">` : ic('helmet', 48)}</span>
          <span class="ph-lv">${N(li.level)}</span>
        </div>
        <div class="ph-name"><b>${meta.data.name}</b><button class="ph-edit" aria-label="edit">${ic('edit', 16)}</button></div>
        <div class="ph-xp">${fmtNum(li.cur)} / ${fmtNum(li.need)} XP</div>
        <div class="ph-ride">${carT ? `<img src="${carT}" alt="">` : ''}<span><small>${t('myRide')}</small><b>${CARS.find(c => c.id === meta.data.selectedCar)?.name ?? ''}</b></span></div>`;
      (hero.querySelector('.ph-edit') as HTMLElement).onclick = () => {
        audio.play('click');
        ui.modal(t('editName'), `<input class="mp-input" id="name-input" maxlength="14" value="${meta.data.name}">`, [
          { label: t('cancel'), cb: () => {} },
          { label: t('ok'), cls: 'green', cb: () => {
            const inp = document.getElementById('name-input') as HTMLInputElement;
            if (inp && inp.value.trim()) { meta.data.name = inp.value.trim().slice(0, 14); meta.save(); build(); }
          } },
        ]);
      };
      const side = el('div', 'pro-side', wrap);
      section(side, t('statsTitle'));
      const sg = el('div', 'stat-grid', side);
      const winRate = st.races ? Math.round((st.wins / st.races) * 100) : 0;
      const hrs = Math.floor(st.playMs / 3600000), mins = Math.floor((st.playMs % 3600000) / 60000);
      const tiles: [string, string, string][] = [
        ['flag', t('st_races'), fmtNum(st.races)],
        ['trophy', t('st_wins'), fmtNum(st.wins)],
        ['chart', t('st_winrate'), `${N(winRate)}٪`],
        ['star', t('st_stars'), `${N(meta.totalStars())}`],
        ['drift', t('st_drifts'), fmtNum(st.drifts)],
        ['users', t('st_mpwins'), fmtNum(st.mpWins)],
        ['tag', t('st_coins'), fmtNum(st.coins)],
        ['clock', t('st_time'), `${N(hrs)}${t('hShort')} ${N(mins)}${t('mShort')}`],
      ];
      for (const [i2, l, v] of tiles) el('div', 'stat-tile', sg, `<span>${ic(i2, 18)}</span><b>${v}</b><small>${l}</small>`);
      section(side, t('collection'));
      const col = el('div', 'coll', side);
      const cleared = LEVELS.filter(l => meta.levelRecord(l.id).stars > 0).length;
      const rows: [string, string, number, number][] = [
        ['car', t('cars'), meta.data.ownedCars.length, CARS.length],
        ['helmet', t('characters'), meta.data.ownedChars.length, CHARACTERS.length],
        ['map', t('stagesCleared'), cleared, LEVELS.length],
        ['star', t('stars'), meta.totalStars(), LEVELS.length * 3],
      ];
      for (const [i2, l, v, m] of rows) el('div', 'coll-row', col, `<span class="cr-ic">${ic(i2, 18)}</span><span class="cr-l">${l}</span>${bar(v / m, 'volt')}<b>${N(v)}/${N(m)}</b>`);
      section(side, t('badges'));
      const bd = el('div', 'badge-row', side);
      for (const a of ACHIEVEMENTS) {
        const p = achProgress(meta, a);
        el('span', `bdg ${p.done ? 'on' : ''}`, bd, ic(a.icon, 18)).title = t(a.id);
      }
    };
    ui.register('profile', { el: scr, onShow: () => { ctx.showcase.setFocus('both'); build(); } });
  }

  // ============ SETTINGS ============
  {
    const scr = el('div', 'screen v3 solid-ish');
    header(scr, 'cog', t('settingsTitle'), '', () => ui.show('menu'));
    const body = el('div', 'screen-body set-body', scr);

    const row = (icon: string, label: string, sub?: string) => {
      const r = el('div', 'set-row', body);
      el('span', 'sr-ic', r, ic(icon, 18));
      const l = el('span', 'sr-tx', r, `<b>${label}</b>${sub ? `<small>${sub}</small>` : ''}`);
      void l;
      return el('div', 'sr-ctl', r);
    };
    const segControl = (r: HTMLElement, options: [string, string][], initial: string, cb: (v: string) => void) => {
      const seg = el('div', 'seg v3seg', r);
      let curV = initial;
      const paint = () => {
        seg.innerHTML = '';
        for (const [v, lbl] of options) {
          const b = el('button', v === curV ? 'active' : '', seg, lbl) as HTMLButtonElement;
          b.onclick = () => { audio.play('click'); if (v === curV) return; curV = v; cb(v); paint(); };
        }
      };
      paint();
    };
    const slider = (r: HTMLElement, val: number, cb: (v: number) => void) => {
      const inp = el('input', 'v3range', r) as HTMLInputElement;
      inp.type = 'range'; inp.min = '0'; inp.max = '100';
      inp.value = String(Math.round(val * 100));
      const paint = () => inp.style.setProperty('--v', `${inp.value}%`);
      paint();
      inp.oninput = () => { paint(); cb(Number(inp.value) / 100); };
    };

    section(body, t('secGraphics'));
    segControl(row('layout', t('graphics')), [['low', t('low')], ['medium', t('medium')], ['high', t('high')], ['ultra', t('ultra')]], S.graphics, v => {
      S.graphics = v as typeof S.graphics; meta.save(); ctx.applyQuality();
    });
    switchEl(row('fps', t('showFps')), S.showFps, v => { S.showFps = v; ctx.applyFpsSetting(); meta.save(); });
    segControl(row('camera', t('camMode'), t('camSub')), [['chase', t('camChase')], ['fp', t('camFp')]], S.camera ?? 'chase', v => {
      S.camera = v as typeof S.camera; meta.save();
    });

    section(body, t('secAudio'));
    slider(row('volume', t('master')), S.master, v => { S.master = v; audio.setMasterVol(v); meta.save(); });
    slider(row('music', t('music')), S.music, v => { S.music = v; audio.setMusicVol(v); audio.musicOn = v > 0.01; meta.save(); });
    slider(row('bolt', t('sfx')), S.sfx, v => { S.sfx = v; audio.setSfxVol(v); audio.sfxOn = v > 0.01; meta.save(); });
    switchEl(row('vibrate', t('vibration')), S.vibration, v => { S.vibration = v; meta.save(); });

    section(body, t('secControls'));
    segControl(row('steer', t('controlLayout'), t('controlLayoutSub')), [['wheel', t('wheel')], ['buttons', t('buttons')]], S.steerMode === 'tilt' ? 'wheel' : S.steerMode, v => {
      S.steerMode = v as typeof S.steerMode; ui.hud.setSteerMode(S.steerMode as 'wheel' | 'buttons'); meta.save();
    });
    slider(row('sliders', t('sensitivity')), (S.steerSens - 0.6) / 1.0, v => { S.steerSens = 0.6 + v; ui.hud.setSensitivity(S.steerSens); meta.save(); });
    segControl(row('wheel', t('wheelSize'), t('wheelSizeSub')), [['0.8', t('low')], ['1', t('medium')], ['1.3', t('high')]], String(Number(S.wheelSize ?? 1)), v => {
      S.wheelSize = Number(v); ui.hud.setWheelSize(S.wheelSize); meta.save();
    });
    switchEl(row('gauge', t('autoGas'), t('autoGasSub')), S.autoGas, v => { S.autoGas = v; meta.save(); ui.hud.setAutoGas(v); });
    switchEl(row('refresh', t('invertSteer'), t('invertSteerSub')), S.mirrorSteer ?? false, v => { S.mirrorSteer = v; meta.save(); ui.hud.setMirror(v); });
    segControl(row('layout', t('hudPreset'), t('hudPresetSub')), [['simple', t('hudSimple')], ['normal', t('hudNormal')]], S.hudPreset ?? 'simple', v => {
      S.hudPreset = v as 'simple' | 'normal'; meta.save(); ui.hud.applySavedLayout();
    });
    const lay = el('button', 'btn-v ice', row('edit', t('hudLayout'), t('hudLayoutSub')), `${ic('edit', 14)}<span>${t('hudLayoutEdit')}</span>`);
    lay.onclick = () => { audio.play('click'); ui.closeCurrent(); openHudLayoutEditorFromSettings(ui, meta, () => ui.show('settings')); };

    section(body, t('powerUps'));
    switchEl(row('trophy', t('career'), t('powerUpsModeSub')), itemsOnFor('career'), v => setItemsFor('career', v));
    switchEl(row('clock', t('quickRace'), t('powerUpsModeSub')), itemsOnFor('quick'), v => setItemsFor('quick', v));
    const pick = el('button', 'btn-v ghost', row('bolt', t('powerUpsPick'), t('powerUpsPickSub')), `<span>${t('items')}</span>${ic(fa() ? 'back' : 'fwd', 14)}`);
    pick.onclick = () => { audio.play('click'); ui.show('items'); };
    section(body, t('itemMode'), t('itemModeSub'));
    itemModePicker(body, S.itemMode === 'placed' ? 'placed' : 'mystery', v => { S.itemMode = v; meta.save(); });

    section(body, t('language'));
    segControl(row('globe', t('language')), [['fa', 'فارسی'], ['en', 'English']], S.lang, v => { ui.applyLanguage(v as 'en' | 'fa'); });

    section(body, t('data'));
    const dr = row('data', t('data'), t('dataSub'));
    const ex = el('button', 'btn-v ghost sq', dr, ic('upload', 16)); ex.title = t('exportData');
    ex.onclick = () => {
      const code = ctx.exportSave();
      ui.modal(t('exportData'), `<textarea class="mp-input" readonly style="height:100px;letter-spacing:0;text-align:left;font-size:10px;word-break:break-all">${code}</textarea>`, [{ label: t('ok'), cls: 'green', cb: () => {} }]);
    };
    const im = el('button', 'btn-v ghost sq', dr, ic('download', 16)); im.title = t('importData');
    im.onclick = () => {
      ui.modal(t('importData'), `<textarea class="mp-input" id="imp-code" style="height:100px;letter-spacing:0;text-align:left;font-size:10px"></textarea>`, [
        { label: t('cancel'), cb: () => {} },
        { label: t('ok'), cls: 'green', cb: () => {
          const ta = document.getElementById('imp-code') as HTMLTextAreaElement;
          if (ta && ctx.importSave(ta.value)) { ui.toast(t('ok'), 'good'); setTimeout(() => location.reload(), 500); } else ui.toast(t('error'), 'bad');
        } },
      ]);
    };
    const rs = el('button', 'btn-v flare sq', dr, ic('trash', 16)); rs.title = t('resetData');
    rs.onclick = () => {
      ui.modal(t('resetData'), t('resetConfirm'), [
        { label: t('no'), cb: () => {} },
        { label: t('yes'), cls: 'red', cb: () => { ctx.resetSave(); location.reload(); } },
      ]);
    };

    section(body, t('soundList'), t('soundListSub'));
    const sg = el('div', 'snd-grid', body);
    for (const s of SOUND_NAMES) {
      const chip = el('button', 'snd', sg, `${ic('play', 12)}<span>${fa() ? s.fa : s.en}</span>`);
      chip.onclick = () => { audio.resume?.(); audio.play(s.key, 1, 1); };
    }

    ui.register('settings', { el: scr, onShow: () => ctx.showcase.setFocus('both') });
  }
}

/** fallback avatar (vector helmet — no emoji) */
export function charAvatar(charId: string): string {
  void charId;
  return ic('helmet', 26);
}

void themeById;
