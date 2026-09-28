// KUBO KARTS v3 - Vector icon set (replaces every emoji in the menus).
// Crisp inline SVGs: identical on every phone (no emoji-font roulette), they
// inherit `currentColor`, and scale cleanly at any size.

type IconDef = string; // inner SVG markup on a 24x24 grid

const P: Record<string, IconDef> = {
  flag: '<path d="M5 21V4"/><path d="M5 4h11l-1.8 4L16 12H5"/><path d="M9 4v8M12.5 4v8" stroke-width="1.2" opacity=".55"/>',
  wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.3-1.3a4 4 0 0 1-5-5L13 2.5a4 4 0 0 0 1.7 3.8Z" transform="rotate(0)"/><path d="M3 21l6-6"/>',
  helmet: '<path d="M4 15a8 8 0 0 1 16 0v3H9l-2 2H4z"/><path d="M13 11h7"/><path d="M4 15h9"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  cog: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/><path d="M12 14v4M8 21h8M9.5 18h5"/>',
  gift: '<rect x="3.5" y="8" width="17" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/><path d="M12 8c-2-4-6-4-6-1.5S9.5 8 12 8c2.5 0 6 1 6-1.5S14 4 12 8z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  fwd: '<path d="M9 5l7 7-7 7"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor" stroke="none"/>',
  starO: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M4.5 12.5l5 5L20 7"/>',
  play: '<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  signal: '<path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a6 6 0 0 1 8 0"/><circle cx="12" cy="19" r="1.3" fill="currentColor"/><path d="M2 9.5a14 14 0 0 1 20 0"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01" stroke-width="3"/><path d="M11 7.5h6M11 16.5h6"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  crown: '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  snow: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5"/>',
  rocket: '<path d="M12 2c3.5 2.5 5 6 5 10l-2 5H9l-2-5c0-4 1.5-7.5 5-10z"/><circle cx="12" cy="10" r="1.8"/><path d="M9 17l-2.5 4M15 17l2.5 4M12 17v5"/>',
  fog: '<path d="M4 9h13M7 13h13M3 17h11M6 5h8"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  gemS: '<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l-1.5 5L12 20l4.5-11L15 4"/>',
  flame: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 3-5 5-5 8a7 7 0 0 0 7 7z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  laps: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01" /><path d="M9 17h6"/><circle cx="12" cy="3.5" r="1"/>',
  paint: '<path d="M4 15c0-6 5-11 11-11 3 0 5 2 5 4 0 3-3 2-4 4s1 3-1 5-11 4-11-2z"/><circle cx="9" cy="11" r="1.2" fill="currentColor"/><circle cx="13" cy="8" r="1.2" fill="currentColor"/><circle cx="10" cy="15.5" r="1.2" fill="currentColor"/>',
  wheel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>',
  wing: '<path d="M3 8h18l-2 3H5z"/><path d="M7 11v6M17 11v6M5 17h14"/>',
  wind: '<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  gauge: '<path d="M4 18a9 9 0 1 1 16 0"/><path d="M12 13l4-5"/><circle cx="12" cy="13" r="1.4" fill="currentColor"/>',
  engine: '<path d="M4 10h3l2-3h6v3h3v3h2v-2M20 11v6M4 10v7h3l2 2h7v-2h2v-3"/><path d="M9 7V4h5"/>',
  turbo: '<circle cx="12" cy="12" r="8"/><path d="M12 4c1 4 0 7-4 8M20 12c-4 1-7 0-8-4M12 20c-1-4 0-7 4-8M4 12c4-1 7 0 8 4"/>',
  tire: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  drift: '<path d="M3 18c4 0 5-3 8-6s4-6 10-6"/><path d="M3 13c3 0 4-2 6-4"/><path d="M17 3l4 3-4 3"/>',
  armor: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M12 7v10M8 10h8"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v5h-5"/>',
  home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.9.7 1.5 1.7 1.5 2.8V17h4v-.3c0-1.1.6-2.1 1.5-2.8A6 6 0 0 0 12 3z"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5M4 20h16"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  power: '<path d="M12 3v8"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  medal: '<circle cx="12" cy="15" r="6"/><path d="M8 3l2.5 6.5M16 3l-2.5 6.5M8 3h8"/><path d="M12 12.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z" fill="currentColor" stroke="none"/>',
  car: '<path d="M3 16v-3l2-5h11l3 4h2v4"/><path d="M3 16h18"/><circle cx="7.5" cy="17" r="2.2"/><circle cx="16.5" cy="17" r="2.2"/><path d="M7 8l1 4h9"/>',
  controller: '<path d="M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6L14 14h-4l-1 1.6A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4z"/><path d="M7 11v3M5.5 12.5h3M16 11.5h.01M18 13.5h.01" />',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3.5"/>',
  vibrate: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M4 8v8M20 8v8M2 10v4M22 10v4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M10 10v10"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  steer: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M3.5 10h6M14.5 10h6M12 14v7"/>',
  fps: '<path d="M4 20V4h7M4 12h5"/><path d="M14 20V4h3a3 3 0 0 1 0 6h-3"/>',
  data: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.3" fill="currentColor"/>',
  box: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  mapPin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7c-3 0-4.5-1.5-6-4l-2-3.5a1.5 1.5 0 0 1 2.5-1.6L8 14"/>',
  wave: '<path d="M2 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  heart: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/>',
  swords: '<path d="M4 4l9 9M4 4v4M4 4h4M20 4l-9 9M20 4v4M20 4h-4"/><path d="M8 16l-3 3M16 16l3 3M7 14l3 3M17 14l-3 3"/>',
  trap: '<path d="M3 17h18"/><path d="M5 17l2-6h10l2 6"/><path d="M9 11V8h6v3"/>',
  magnet: '<path d="M5 3v9a7 7 0 0 0 14 0V3h-4v9a3 3 0 0 1-6 0V3z"/><path d="M5 7h4M15 7h4"/>',
  seed: '<circle cx="12" cy="12" r="3"/>',
};

/** inline SVG icon (inherits currentColor) */
export function ic(name: string, size = 20, cls = ''): string {
  const d = P[name] ?? P.seed;
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// ---------------------------------------------------------------------------
// CURRENCY ART (user: "جم‌ها، چرخ‌دنده و سکه‌ها از نو طراحی بشن و خفن‌تر باشن")
// Flat-faceted illustrations, no gradients: every shade is its own polygon,
// like a cut stone / minted coin / machined part. Fixed palette so they read
// on any surface.
// ---------------------------------------------------------------------------
const COIN = `
  <circle cx="16" cy="17" r="13" fill="#8a4b08"/>
  <circle cx="16" cy="15.5" r="13" fill="#f5a524"/>
  <path d="M16 2.5a13 13 0 0 1 13 13H3a13 13 0 0 1 13-13z" fill="#ffc44d"/>
  <circle cx="16" cy="15.5" r="9.6" fill="#e08a12"/>
  <circle cx="16" cy="15.5" r="8.4" fill="#ffb627"/>
  <path d="M16 7.1a8.4 8.4 0 0 1 8.4 8.4H7.6A8.4 8.4 0 0 1 16 7.1z" fill="#ffcf5c"/>
  <path d="M12.6 10.6h2.6v3.6l3.6-3.6h3.3l-4.5 4.4 4.7 5.3h-3.4l-3.7-4.3v4.3h-2.6z" fill="#8a4b08"/>
  <path d="M12.2 10.1h2.6v3.6l3.6-3.6h3.3l-4.5 4.4 4.7 5.3h-3.4l-3.7-4.3v4.3h-2.6z" fill="#fff3cf"/>
  <path d="M7 8.5l1.6-1.6M24.5 6.2l.9.9" stroke="#fff7e0" stroke-width="1.6" stroke-linecap="round"/>`;

const GEM = `
  <path d="M8 4h16l6 8-14 17L2 12z" fill="#5b1a8c"/>
  <path d="M8 4h16l6 8H2z" fill="#c04dff"/>
  <path d="M8 4l4 8h8l4-8z" fill="#e3a2ff"/>
  <path d="M2 12h10l4 17z" fill="#8f2fd6"/>
  <path d="M30 12H20l-4 17z" fill="#6c20ad"/>
  <path d="M12 12h8l-4 17z" fill="#b13cf5"/>
  <path d="M8 4 2 12h10z" fill="#d57dff"/>
  <path d="M24 4l6 8H20z" fill="#9c35e6"/>
  <path d="M11 6.2l2 3.6" stroke="#fbeaff" stroke-width="1.6" stroke-linecap="round"/>`;

const PARTS = `
  <path d="M16 3.2l2.3.3.7 3 2.4 1 2.6-1.6 1.8 1.4 1.4 1.8-1.6 2.6 1 2.4 3 .7.3 2.3-.3 2.3-3 .7-1 2.4 1.6 2.6-1.4 1.8-1.8 1.4-2.6-1.6-2.4 1-.7 3-2.3.3-2.3-.3-.7-3-2.4-1-2.6 1.6-1.8-1.4-1.4-1.8 1.6-2.6-1-2.4-3-.7L3.2 16l.3-2.3 3-.7 1-2.4-1.6-2.6 1.4-1.8 1.8-1.4 2.6 1.6 2.4-1 .7-3z" fill="#3a4150" transform="translate(0 1.4)"/>
  <path d="M16 3.2l2.3.3.7 3 2.4 1 2.6-1.6 1.8 1.4 1.4 1.8-1.6 2.6 1 2.4 3 .7.3 2.3-.3 2.3-3 .7-1 2.4 1.6 2.6-1.4 1.8-1.8 1.4-2.6-1.6-2.4 1-.7 3-2.3.3-2.3-.3-.7-3-2.4-1-2.6 1.6-1.8-1.4-1.4-1.8 1.6-2.6-1-2.4-3-.7L3.2 16l.3-2.3 3-.7 1-2.4-1.6-2.6 1.4-1.8 1.8-1.4 2.6 1.6 2.4-1 .7-3z" fill="#aeb8c8"/>
  <path d="M16 3.2l2.3.3.7 3 2.4 1 2.6-1.6 1.8 1.4 1.4 1.8-1.6 2.6 1 2.4 3 .7.3 2.3H3.2l.3-2.3 3-.7 1-2.4-1.6-2.6 1.4-1.8 1.8-1.4 2.6 1.6 2.4-1 .7-3z" fill="#d7dee9"/>
  <circle cx="16" cy="16" r="7" fill="#6b7589"/>
  <circle cx="16" cy="16" r="5.6" fill="#ff7a1a"/>
  <path d="M10.4 16a5.6 5.6 0 0 1 11.2 0z" fill="#ffa24d"/>
  <circle cx="16" cy="16" r="2.4" fill="#2b303b"/>`;

export type Currency = 'coin' | 'gem' | 'parts';
export function cur(kind: Currency, size = 22, cls = ''): string {
  const body = kind === 'coin' ? COIN : kind === 'gem' ? GEM : PARTS;
  return `<svg class="cur cur-${kind} ${cls}" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true">${body}</svg>`;
}
