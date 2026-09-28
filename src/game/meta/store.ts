// KUBO KARTS v3 - REAL-MONEY STORE CATALOG (Toman).
// user: "من میخوام اینجا ارز خودم بفروشم به تومان … من خودم بعداً سیستم پول
// وصل می‌کنم". Everything the shop sells for money lives in PRODUCTS below.
//
// ──────────────────────────────────────────────────────────────────────────
//  HOW TO CONNECT A PAYMENT GATEWAY (ZarinPal / IDPay / Bazaar / Myket …)
//  Replace the body of `requestPayment()` ONLY. It receives the product and
//  must resolve `true` once the payment is VERIFIED (ideally server-side),
//  `false` if the user cancelled / payment failed. The shop UI then calls
//  `grantProduct()` which credits the currencies and saves.
//  Or, from anywhere at runtime:  setPaymentHandler(async (p) => { ... })
// ──────────────────────────────────────────────────────────────────────────
import type { Meta } from './meta';

export type ProductKind = 'gems' | 'coins' | 'parts' | 'bundle' | 'vip' | 'legend';

export interface Product {
  id: string;             // stable SKU — use it as the gateway's product id
  kind: ProductKind;
  toman: number;          // price in Toman
  gems?: number;
  coins?: number;
  parts?: number;
  bonus?: number;         // % extra shown as a ribbon (display only)
  tag?: 'best' | 'hot' | 'first';
  vipDays?: number;       // v3.4 VIP pass length
  anchor?: number;        // v3.4 explicit crossed-out "worth" price (Toman)
  nameKey: string;        // lang key
}

// v3.1 PRICING (user: "همه آیتم‌ها بیشترین قیمت زیر ۶۰ تومن باشه و بر اساس
// روانشناسی قیمت بذار"). Rules used:
//  • CHARM PRICES: every price ends in ۹٬۹۰۰ / ۴٬۹۰۰ and the ceiling is ۵۹٬۹۰۰.
//  • LOW-FRICTION ENTRY: a one-time ۹٬۹۰۰ starter pack worth ~4× (first
//    purchase is the hardest; after it, buying again is much easier).
//  • ANCHOR + DECOY: in each row the big pack has by far the best bonus, the
//    middle one is tagged "most popular" so the cheap one looks thin and the
//    big one looks like a steal. A crossed-out "worth" price anchors value.
//  • BASE RATES (per 1٬000 Toman): 6 gems · 400 coins · 1.6 parts. Bonus %
//    below is computed against these, so the ribbons never lie.
export const RATE = { gems: 12, coins: 400, parts: 1.6 };
export const PRODUCTS: Product[] = [
  // ---- gem packs (v3.2: 9,900 = 120 gems = three B-class cars) ----
  { id: 'gems_50', kind: 'gems', toman: 4900, gems: 50, nameKey: 'pk_gems_s' },
  { id: 'gems_120', kind: 'gems', toman: 9900, gems: 120, nameKey: 'pk_gems_s' },
  { id: 'gems_330', kind: 'gems', toman: 24900, gems: 330, bonus: 10, tag: 'hot', nameKey: 'pk_gems_m' },
  { id: 'gems_560', kind: 'gems', toman: 39900, gems: 560, bonus: 17, nameKey: 'pk_gems_l' },
  { id: 'gems_900', kind: 'gems', toman: 59900, gems: 900, bonus: 25, tag: 'best', nameKey: 'pk_gems_xl' },
  // ---- coin packs ----
  { id: 'coins_3k', kind: 'coins', toman: 7900, coins: 3200, nameKey: 'pk_coins_s' },
  { id: 'coins_9k', kind: 'coins', toman: 19900, coins: 9500, bonus: 20, tag: 'hot', nameKey: 'pk_coins_m' },
  { id: 'coins_24k', kind: 'coins', toman: 44900, coins: 24000, bonus: 35, tag: 'best', nameKey: 'pk_coins_l' },
  // ---- parts crates ----
  { id: 'parts_10', kind: 'parts', toman: 5900, parts: 10, nameKey: 'pk_parts_s' },
  { id: 'parts_30', kind: 'parts', toman: 14900, parts: 30, bonus: 25, tag: 'hot', nameKey: 'pk_parts_m' },
  { id: 'parts_80', kind: 'parts', toman: 34900, parts: 80, bonus: 45, tag: 'best', nameKey: 'pk_parts_l' },
  // ---- bundles ----
  { id: 'bundle_rookie', kind: 'bundle', toman: 9900, gems: 100, coins: 5000, parts: 15, tag: 'first', nameKey: 'pk_rookie' },
  { id: 'bundle_pro', kind: 'bundle', toman: 49900, gems: 360, coins: 20000, parts: 50, tag: 'best', nameKey: 'pk_pro' },
  // ---- v3.4 VIP PASS (weekly = low-risk try, monthly = the real seller) ----
  // Weekly x4 = 59,600 so the monthly 49,900 reads "save 16%" -> decoy effect.
  { id: 'vip_week', kind: 'vip', toman: 14900, vipDays: 7, nameKey: 'vipWeek' },
  { id: 'vip_month', kind: 'vip', toman: 49900, vipDays: 30, tag: 'best', anchor: 59900, nameKey: 'vipMonth' },
  // ---- v3.4 LEGEND PACK (user: "پکیج باشه … قیمت ۳۰ تومان"): every classic
  // premium car (all A-tier) + the 3 gem maps + 150 gems, FOREVER. 29,900 is
  // the charm version of 30k; the anchor is what the contents cost one by one.
  { id: 'legend_pack', kind: 'legend', toman: 29900, gems: 150, tag: 'first', anchor: 249900, nameKey: 'legendPack' },
];

/** what the contents would cost at base rates (the crossed-out anchor price) */
export function worthToman(p: Product): number {
  if (p.anchor) return p.anchor;
  const raw = (p.gems ?? 0) / RATE.gems * 1000 + (p.coins ?? 0) / RATE.coins * 1000 + (p.parts ?? 0) / RATE.parts * 1000;
  // round UP to the next charm price (…,900) so the anchor looks natural
  return Math.ceil((raw + 100) / 1000) * 1000 - 100;
}
/** % saved vs the anchor (0 when not worth showing) */
export function savePct(p: Product): number {
  const w = worthToman(p);
  const pct = Math.round((1 - p.toman / w) * 100);
  return pct >= 12 ? pct : 0;
}


export const productById = (id: string) => PRODUCTS.find(p => p.id === id);

export type PaymentHandler = (p: Product) => Promise<boolean>;
let handler: PaymentHandler | null = null;

/** plug a gateway in at runtime (e.g. from another module / webview bridge) */
export function setPaymentHandler(h: PaymentHandler | null) { handler = h; }
export function paymentConnected() { return handler !== null; }

/** ask the gateway to charge the user. Returns true only on verified payment. */
export async function requestPayment(p: Product): Promise<boolean> {
  if (handler) return handler(p);
  // Gateway not connected yet → the UI shows the "coming soon" sheet.
  return false;
}

/** credit a verified purchase */
export function grantProduct(meta: Meta, p: Product) {
  // v3.4 FIRST GEM PURCHASE = DOUBLE GEMS (the first buy is the hardest one)
  if (p.kind === 'gems' && p.gems && isFirstGemBuy(meta)) meta.addGems(p.gems);
  if (p.kind === 'vip' && p.vipDays) meta.grantVip(p.vipDays);
  if (p.kind === 'legend') meta.grantLegendPack();
  if (p.gems) meta.addGems(p.gems);
  if (p.coins) meta.addCoins(p.coins);
  if (p.parts) meta.addParts(p.parts);
  const d = meta.data as unknown as { purchases?: string[] };
  (d.purchases ??= []).push(p.id);
  meta.save();
}

/** true until the player bought ANY gem pack (x2 ribbon on every gem pack) */
export function isFirstGemBuy(meta: Meta): boolean {
  const d = meta.data as unknown as { purchases?: string[] };
  return !(d.purchases ?? []).some(id => id.startsWith('gems_'));
}

/** "first purchase" bundles can be bought once */
export function alreadyBought(meta: Meta, p: Product) {
  const d = meta.data as unknown as { purchases?: string[] };
  return p.tag === 'first' && (d.purchases ?? []).includes(p.id);
}

/** 49000 → "۴۹٬۰۰۰" / "49,000" */
export function fmtToman(n: number, fa: boolean): string {
  const s = n.toLocaleString('en-US');
  if (!fa) return s;
  return s.replace(/,/g, '٬').replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[+d]);
}
