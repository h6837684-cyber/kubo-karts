// KUBO KARTS v3 - small UI kit shared by every menu screen: header bar,
// section heads, switches, currency pills. Keeps all screens on ONE visual
// vocabulary (same back button, same title block, same switch).
import { el } from './ui';
import { ic, cur, type Currency } from './icons3';
import { audio } from '../core/audio';
import { fmtNum } from '../core/utils';

/** screen header: back chevron + icon tile + title/subtitle + end slot */
export function header(scr: HTMLElement, icon: string, title: string, sub: string, onBack: () => void): HTMLElement {
  const h = el('div', 'hdr', scr);
  const back = el('button', 'hdr-back', h, ic('back', 22));
  back.setAttribute('aria-label', 'back');
  back.onclick = () => { audio.play('back'); onBack(); };
  const tb = el('div', 'hdr-title', h);
  el('span', 'hdr-ic', tb, ic(icon, 22));
  const tx = el('div', 'hdr-tx', tb);
  el('h1', '', tx, title);
  if (sub) el('small', '', tx, sub);
  return el('div', 'hdr-end', h);
}

/** section head: label + optional count/aside, hairline rule */
export function section(parent: HTMLElement, label: string, aside = ''): HTMLElement {
  const s = el('div', 'sec', parent);
  s.innerHTML = `<span class="sec-l">${label}</span><span class="sec-rule"></span>${aside ? `<span class="sec-a">${aside}</span>` : ''}`;
  return s;
}

/** accessible on/off switch */
export function switchEl(parent: HTMLElement, on: boolean, cb: (v: boolean) => void, label?: string): HTMLButtonElement {
  const b = el('button', `sw ${on ? 'on' : ''}`, parent) as HTMLButtonElement;
  b.setAttribute('role', 'switch');
  b.setAttribute('aria-checked', String(on));
  if (label) b.setAttribute('aria-label', label);
  b.innerHTML = '<span class="sw-k"></span>';
  b.onclick = (e) => {
    e.stopPropagation();
    const v = !b.classList.contains('on');
    b.classList.toggle('on', v);
    b.setAttribute('aria-checked', String(v));
    audio.play('click');
    cb(v);
  };
  return b;
}

/** amount with the redesigned currency art */
export function money(kind: Currency, amount: number, size = 18): string {
  return `<span class="money m-${kind}">${cur(kind, size)}<b>${fmtNum(amount)}</b></span>`;
}

/** progress bar markup (0..1) */
export function bar(frac: number, cls = ''): string {
  const f = Math.max(0, Math.min(1, frac));
  return `<span class="pbar ${cls}"><i style="transform:scaleX(${f.toFixed(3)})"></i></span>`;
}
