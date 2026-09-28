// KUBO KARTS v3.1 part 2 - ITEM MODE picker (Settings + MP host lobby).
// user: "داخل بخش تنظیمات و چندنفره یه گزینه بذاری مثلاً شانسی یا آیتم"
import { el } from './ui';
import { t } from '../core/lang';
import { audio } from '../core/audio';
import { itemIconDataURL } from './icons';
import type { ItemMode } from '../items/placed';

let boxIcon = '';
/** yellow lucky box with a white "?" (matches the in-race box) */
export function mysteryBoxIcon(): string {
  if (boxIcon) return boxIcon;
  const S = 96, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d')!;
  const r = (x: number, y: number, w: number, h: number, rad: number) => {
    c.beginPath(); c.moveTo(x + rad, y); c.arcTo(x + w, y, x + w, y + h, rad); c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad); c.arcTo(x, y, x + w, y, rad); c.closePath();
  };
  const glow = c.createRadialGradient(48, 48, 10, 48, 48, 48);
  glow.addColorStop(0, 'rgba(255,214,60,0.55)'); glow.addColorStop(1, 'rgba(255,214,60,0)');
  c.fillStyle = glow; c.fillRect(0, 0, S, S);
  r(14, 14, 68, 68, 12); c.fillStyle = '#e8a400'; c.fill();
  r(20, 20, 56, 56, 8);
  const g = c.createLinearGradient(20, 20, 76, 76); g.addColorStop(0, '#ffe766'); g.addColorStop(1, '#ffc21a');
  c.fillStyle = g; c.fill();
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.moveTo(22, 22); c.lineTo(52, 22); c.lineTo(22, 52); c.closePath(); c.fill();
  c.font = '900 46px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineWidth = 6; c.strokeStyle = '#b87600'; c.strokeText('?', 48, 51);
  c.fillStyle = '#ffffff'; c.fillText('?', 48, 51);
  for (const [x, y] of [[20, 20], [76, 20], [20, 76], [76, 76]]) { c.fillStyle = '#fff3c0'; c.beginPath(); c.arc(x, y, 3, 0, Math.PI * 2); c.fill(); }
  boxIcon = cv.toDataURL('image/png');
  return boxIcon;
}

/** two big cards: LUCKY BOXES | REAL ITEMS */
export function itemModePicker(host: HTMLElement, value: ItemMode, onChange: (v: ItemMode) => void, extraCls = ''): HTMLElement {
  const wrap = el('div', `im-mode ${extraCls}`, host);
  let cur = value;
  const opts: [ItemMode, string, string, string][] = [
    ['mystery', mysteryBoxIcon(), t('itemModeMystery'), t('itemModeMysteryD')],
    ['placed', itemIconDataURL('banana'), t('itemModePlaced'), t('itemModePlacedD')],
  ];
  const btns: HTMLElement[] = [];
  for (const [v, img, name, desc] of opts) {
    const b = el('button', v === cur ? 'active' : '', wrap, `<img src="${img}" alt="" draggable="false"><span>${name}</span><small>${desc}</small>`);
    if (v === 'placed') {
      // a peek at the actual items: nitro · banana · minecart
      b.querySelector('img')!.outerHTML = `<span class="im-trio"><img src="${itemIconDataURL('boost')}" alt=""><img src="${itemIconDataURL('banana')}" alt=""><img src="${itemIconDataURL('minecart')}" alt=""></span>`;
    }
    btns.push(b);
    b.onclick = () => {
      audio.play('click');
      if (v === cur) return;
      cur = v;
      btns.forEach((x, i) => x.classList.toggle('active', opts[i][0] === v));
      onChange(v);
    };
  }
  return wrap;
}
