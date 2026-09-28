// KUBO KARTS - Car definitions: 10 original karts across 5 classes.
// Stats shown 1..10 in UI; physics values derived in KartController.

export type CarClass = 'balanced' | 'speed' | 'drift' | 'heavy' | 'accel';

export interface CarDef {
  id: string;
  name: string;
  cls: CarClass;
  desc: string;
  price: number;          // coins (0 = starter / gem-only when gemOnly)
  gemPrice?: number;      // premium alternative (gems)
  /** v3.2: gem-only car (can NOT be bought with coins) */
  gemOnly?: boolean;
  /** v3.3: VIP-exclusive machine — drivable only while the VIP pass is active */
  vip?: boolean;
  /** v3.2: explicit performance tier (decoupled from price) */
  tier?: CarTier;
  /** v3.2: position inside its tier 0..1 (tiny speed ladder) */
  lad?: number;
  /** v3.2: legacy — no longer gates purchases (cars are sold, not level-locked) */
  reqLevel: number;
  bodyColor: string;      // default paint
  accentColor: string;
  stats: {
    speed: number; accel: number; handling: number;
    drift: number; weight: number; boost: number; defense: number;
  };
  model: {
    length: number; width: number; height: number; // chassis proportions (voxel units)
    nose: 'wedge' | 'flat' | 'round' | 'split';
    cabin: 'open' | 'cockpit' | 'canopy' | 'armored';
    podSize: number;          // side pods 0..2
    wheelStyle: number;       // default wheel 0..3
    wheelSize: number;        // 0.8..1.3
    exhaust: 1 | 2 | 4;
    spoilerStyle: number;     // default spoiler -1..3
    lights: 'round' | 'strip' | 'visor';
    decalDefault: number;     // stripe style
    style?: 'gt' | 'wedge2' | 'muscle' | 'ev' | 'f40' | 'lambo' | 'porsche' | 'mclaren' | 'bugatti' | 'aston';  // special body flavour
  };
}

export const CARS: CarDef[] = [
  {
    id: 'kart_start', name: 'CUBBY', cls: 'balanced',
    desc: 'The trusty starter kart. Reliable, friendly, ready to race.',
    price: 0, tier: 'C', lad: 0.0, reqLevel: 1,
    bodyColor: '#e84a3f', accentColor: '#f7d154',
    stats: { speed: 5, accel: 5, handling: 5, drift: 5, weight: 5, boost: 5, defense: 5 },
    model: { length: 2.3, width: 1.6, height: 0.62, nose: 'round', cabin: 'open', podSize: 1, wheelStyle: 0, wheelSize: 1, exhaust: 2, spoilerStyle: -1, lights: 'round', decalDefault: 0 },
  },
  {
    id: 'kart_speed', name: 'COMET', cls: 'speed',
    desc: 'Built for pure top speed. Point it straight and hold on.',
    price: 3900, tier: 'C', lad: 0.5, reqLevel: 1,
    bodyColor: '#2f7de0', accentColor: '#e8f4ff',
    stats: { speed: 9, accel: 4, handling: 5, drift: 4, weight: 4, boost: 6, defense: 3 },
    model: { length: 2.8, width: 1.45, height: 0.5, nose: 'wedge', cabin: 'canopy', podSize: 0, wheelStyle: 1, wheelSize: 0.95, exhaust: 2, spoilerStyle: 1, lights: 'strip', decalDefault: 1 },
  },
  {
    id: 'kart_drift', name: 'SIDEWINDER', cls: 'drift',
    desc: 'Slippery sideways specialist. Lives for the perfect apex.',
    price: 3900, tier: 'C', lad: 0.5, reqLevel: 1,
    bodyColor: '#8c4de0', accentColor: '#28e0a8',
    stats: { speed: 6, accel: 5, handling: 6, drift: 9, weight: 4, boost: 7, defense: 3 },
    model: { length: 2.35, width: 1.62, height: 0.55, nose: 'flat', cabin: 'open', podSize: 1, wheelStyle: 2, wheelSize: 1.05, exhaust: 4, spoilerStyle: 2, lights: 'round', decalDefault: 2 },
  },
  {
    id: 'kart_heavy', name: 'TITAN', cls: 'heavy',
    desc: 'A rolling fortress. Nobody pushes this brute around.',
    price: 4900, tier: 'C', lad: 0.75, reqLevel: 1,
    bodyColor: '#5a6572', accentColor: '#f2a900',
    stats: { speed: 6, accel: 3, handling: 4, drift: 3, weight: 9, boost: 4, defense: 9 },
    model: { length: 2.6, width: 1.85, height: 0.8, nose: 'flat', cabin: 'armored', podSize: 2, wheelStyle: 3, wheelSize: 1.2, exhaust: 2, spoilerStyle: -1, lights: 'strip', decalDefault: 0 },
  },
  {
    id: 'kart_accel', name: 'SPARKY', cls: 'accel',
    desc: 'Zero to hero in a heartbeat. Electric launch off every corner.',
    price: 2900, tier: 'C', lad: 0.25, reqLevel: 1,
    bodyColor: '#f7d154', accentColor: '#37474f',
    stats: { speed: 5, accel: 9, handling: 6, drift: 5, weight: 4, boost: 5, defense: 4 },
    model: { length: 2.2, width: 1.55, height: 0.6, nose: 'split', cabin: 'open', podSize: 1, wheelStyle: 0, wheelSize: 0.9, exhaust: 1, spoilerStyle: -1, lights: 'round', decalDefault: 3 },
  },
  {
    id: 'kart_buggy', name: 'DUNEHOPPER', cls: 'balanced',
    desc: 'Off-road suspension monster. Laughs at gravel and shortcuts.',
    price: 5900, tier: 'C', lad: 1.0, reqLevel: 1,
    bodyColor: '#e07830', accentColor: '#3a2b20',
    stats: { speed: 6, accel: 6, handling: 6, drift: 5, weight: 6, boost: 5, defense: 6 },
    model: { length: 2.5, width: 1.7, height: 0.72, nose: 'wedge', cabin: 'open', podSize: 2, wheelStyle: 3, wheelSize: 1.25, exhaust: 2, spoilerStyle: 0, lights: 'round', decalDefault: 1 },
  },
  {
    id: 'kart_classic', name: 'RETRO 8', cls: 'drift',
    desc: 'A vintage beauty with old-school soul and modern grip.',
    price: 14900, gemPrice: 35, tier: 'B', lad: 0.0, reqLevel: 1,
    bodyColor: '#d04860', accentColor: '#f8f4ec',
    stats: { speed: 7, accel: 6, handling: 7, drift: 8, weight: 5, boost: 6, defense: 4 },
    model: { length: 2.45, width: 1.6, height: 0.58, nose: 'round', cabin: 'cockpit', podSize: 1, wheelStyle: 1, wheelSize: 1, exhaust: 2, spoilerStyle: -1, lights: 'round', decalDefault: 4 },
  },
  {
    id: 'kart_hover', name: 'ION GLIDE', cls: 'speed',
    desc: 'Experimental anti-grav prototype. Silent, fast, otherworldly.',
    price: 24900, gemPrice: 49, tier: 'B', lad: 0.85, reqLevel: 1,
    bodyColor: '#20c8d8', accentColor: '#0a2a38',
    stats: { speed: 8, accel: 7, handling: 7, drift: 6, weight: 3, boost: 8, defense: 3 },
    model: { length: 2.7, width: 1.5, height: 0.45, nose: 'wedge', cabin: 'canopy', podSize: 1, wheelStyle: 2, wheelSize: 0.8, exhaust: 4, spoilerStyle: 3, lights: 'strip', decalDefault: 5 },
  },
  {
    id: 'kart_truck', name: 'HAULER', cls: 'heavy',
    desc: 'Half truck, half wrecking ball. Cargo: pure intimidation.',
    price: 21900, gemPrice: 45, tier: 'B', lad: 0.6, reqLevel: 1,
    bodyColor: '#4a7c3a', accentColor: '#2a2a2a',
    stats: { speed: 7, accel: 4, handling: 4, drift: 4, weight: 10, boost: 5, defense: 10 },
    model: { length: 2.9, width: 1.9, height: 0.9, nose: 'flat', cabin: 'armored', podSize: 2, wheelStyle: 3, wheelSize: 1.3, exhaust: 2, spoilerStyle: 0, lights: 'strip', decalDefault: 0 },
  },
  {
    id: 'kart_proto', name: 'VORTEX X', cls: 'balanced',
    desc: 'The grand finale of engineering. Best of everything, master of all.',
    price: 89900, gemPrice: 190, tier: 'A', lad: 0.0, reqLevel: 1,
    bodyColor: '#121826', accentColor: '#00e676',
    stats: { speed: 8, accel: 8, handling: 8, drift: 8, weight: 6, boost: 8, defense: 6 },
    model: { length: 2.55, width: 1.68, height: 0.6, nose: 'split', cabin: 'canopy', podSize: 2, wheelStyle: 2, wheelSize: 1.05, exhaust: 4, spoilerStyle: 3, lights: 'visor', decalDefault: 6 },
  },
  // ---- NEW CAR PASS (user: "models like Ferrari & more") — original voxel
  // interpretations of iconic body styles, no real trademarks ----
  {
    id: 'kart_ev', name: 'VOLT EV', cls: 'accel',
    desc: 'Silent electric rocket. Seamless torque, zero noise, all grip.',
    price: 17900, gemPrice: 39, tier: 'B', lad: 0.25, reqLevel: 1,
    bodyColor: '#eef2f5', accentColor: '#00c2a8',
    stats: { speed: 7, accel: 9, handling: 7, drift: 5, weight: 5, boost: 7, defense: 5 },
    model: { length: 2.5, width: 1.66, height: 0.58, nose: 'round', cabin: 'cockpit', podSize: 0, wheelStyle: 1, wheelSize: 0.95, exhaust: 1, spoilerStyle: -1, lights: 'strip', decalDefault: 5, style: 'ev' },
  },
  {
    id: 'kart_muscle', name: 'MUSCLOR 71', cls: 'drift',
    desc: 'Big engine, big stripes, bigger burnouts. Old-school sidewind.',
    price: 19900, gemPrice: 42, tier: 'B', lad: 0.5, reqLevel: 1,
    bodyColor: '#e07820', accentColor: '#181818',
    stats: { speed: 8, accel: 6, handling: 5, drift: 8, weight: 8, boost: 6, defense: 6 },
    model: { length: 2.75, width: 1.78, height: 0.62, nose: 'wedge', cabin: 'cockpit', podSize: 0, wheelStyle: 3, wheelSize: 1.2, exhaust: 2, spoilerStyle: 0, lights: 'round', decalDefault: 2, style: 'muscle' },
  },
  {
    id: 'kart_gt', name: 'ROSSA GT', cls: 'speed',
    desc: 'A scarlet grand-tourer. Curves like poetry, growls like thunder.',
    price: 27900, gemPrice: 55, tier: 'B', lad: 1.0, reqLevel: 1,
    bodyColor: '#d42020', accentColor: '#f5e9b8',
    stats: { speed: 9, accel: 7, handling: 8, drift: 6, weight: 5, boost: 7, defense: 4 },
    model: { length: 2.85, width: 1.7, height: 0.48, nose: 'wedge', cabin: 'canopy', podSize: 0, wheelStyle: 1, wheelSize: 1, exhaust: 2, spoilerStyle: 1, lights: 'strip', decalDefault: 4, style: 'gt' },
  },
  {
    id: 'kart_wedge', name: 'SPECTRE', cls: 'speed',
    desc: 'An angry wedge of pure speed. Alien tech, earthbound fury.',
    price: 99900, gemPrice: 199, tier: 'A', lad: 0.15, reqLevel: 1,
    bodyColor: '#f7c531', accentColor: '#141414',
    stats: { speed: 10, accel: 7, handling: 7, drift: 6, weight: 5, boost: 8, defense: 3 },
    model: { length: 2.8, width: 1.78, height: 0.45, nose: 'wedge', cabin: 'canopy', podSize: 1, wheelStyle: 2, wheelSize: 1.1, exhaust: 4, spoilerStyle: 3, lights: 'visor', decalDefault: 5, style: 'wedge2' },
  },
  // ---- SPORTS CAR SEASON (user: "make sports cars, spend lots of time on
  // each, take inspiration from real models") — 6 premium machines, each with a
  // dedicated voxel body build, unlocking at higher levels like characters ----
  {
    id: 'kart_f40', name: 'FURIA 40', cls: 'speed',
    desc: 'Twin-turbo icon of the late 80s. Pop-up attitude, wing like a barn door.',
    price: 119900, gemPrice: 239, tier: 'A', lad: 0.45, reqLevel: 1,
    bodyColor: '#e0201b', accentColor: '#101014',
    stats: { speed: 9, accel: 8, handling: 8, drift: 7, weight: 4, boost: 8, defense: 3 },
    model: { length: 2.75, width: 1.74, height: 0.46, nose: 'wedge', cabin: 'canopy', podSize: 0, wheelStyle: 1, wheelSize: 1.05, exhaust: 2, spoilerStyle: 3, lights: 'strip', decalDefault: 0, style: 'f40' },
  },
  {
    id: 'kart_aventador', name: 'TORO SVX', cls: 'speed',
    desc: 'A scissored bull from Sant\'Agata. Angular fury, V12 scream.',
    price: 129900, gemPrice: 259, tier: 'A', lad: 0.6, reqLevel: 1,
    bodyColor: '#c8e438', accentColor: '#141414',
    stats: { speed: 10, accel: 8, handling: 8, drift: 6, weight: 5, boost: 8, defense: 4 },
    model: { length: 2.8, width: 1.8, height: 0.44, nose: 'wedge', cabin: 'canopy', podSize: 0, wheelStyle: 2, wheelSize: 1.15, exhaust: 4, spoilerStyle: 3, lights: 'visor', decalDefault: 5, style: 'lambo' },
  },
  {
    id: 'kart_911', name: 'NEUNFAHT', cls: 'drift',
    desc: 'Six decades of evolution. Round eyes, rear engine, endless grip.',
    price: 109900, gemPrice: 219, tier: 'A', lad: 0.3, reqLevel: 1,
    bodyColor: '#f0f2f4', accentColor: '#c8102e',
    stats: { speed: 8, accel: 7, handling: 9, drift: 8, weight: 4, boost: 6, defense: 5 },
    model: { length: 2.5, width: 1.66, height: 0.56, nose: 'round', cabin: 'cockpit', podSize: 0, wheelStyle: 1, wheelSize: 1, exhaust: 2, spoilerStyle: 1, lights: 'round', decalDefault: 4, style: 'porsche' },
  },
  {
    id: 'kart_p1', name: 'PAPAYA L1', cls: 'speed',
    desc: 'Hybrid hypercar. Dihedral doors, teardrop glass, silent violence.',
    price: 144900, gemPrice: 289, tier: 'A', lad: 0.8, reqLevel: 1,
    bodyColor: '#ff8000', accentColor: '#0e0e12',
    stats: { speed: 10, accel: 9, handling: 9, drift: 6, weight: 4, boost: 9, defense: 3 },
    model: { length: 2.78, width: 1.76, height: 0.44, nose: 'wedge', cabin: 'canopy', podSize: 0, wheelStyle: 2, wheelSize: 1.1, exhaust: 1, spoilerStyle: 3, lights: 'strip', decalDefault: 5, style: 'mclaren' },
  },
  {
    id: 'kart_chiron', name: 'AZURE ROYALE', cls: 'speed',
    desc: 'Two-tone art on wheels. Quad-turbo calm, then the horizon disappears.',
    price: 159900, gemPrice: 319, tier: 'A', lad: 0.95, reqLevel: 1,
    bodyColor: '#1b3fae', accentColor: '#0c0e14',
    stats: { speed: 10, accel: 9, handling: 8, drift: 5, weight: 6, boost: 9, defense: 5 },
    model: { length: 2.86, width: 1.8, height: 0.5, nose: 'round', cabin: 'canopy', podSize: 0, wheelStyle: 1, wheelSize: 1.12, exhaust: 4, spoilerStyle: 2, lights: 'strip', decalDefault: 0, style: 'bugatti' },
  },
  {
    id: 'kart_db11', name: 'DB GRANDE', cls: 'drift',
    desc: 'A gentleman with a growl. Long hood, ribbed vents, ducktail poise.',
    price: 134900, gemPrice: 269, tier: 'A', lad: 0.7, reqLevel: 1,
    bodyColor: '#0e5e4a', accentColor: '#d8dee6',
    stats: { speed: 9, accel: 7, handling: 8, drift: 8, weight: 5, boost: 7, defense: 5 },
    model: { length: 2.85, width: 1.72, height: 0.52, nose: 'wedge', cabin: 'cockpit', podSize: 0, wheelStyle: 1, wheelSize: 1.02, exhaust: 2, spoilerStyle: 0, lights: 'strip', decalDefault: 0, style: 'aston' },
  },
  // ---- A-CLASS EXPANSION (v1.8 user idea: "ماشین‌های جدید رده A؟") — two
  // more hypercars for the top tier, both price ≥ 13000 ⇒ rank A ----
  {
    id: 'kart_aurelion', name: 'AURELION X', cls: 'speed',
    desc: 'Liquid gold aero. A hypercar that corners like it owns gravity.',
    price: 149900, gemPrice: 299, tier: 'A', lad: 0.9, reqLevel: 1,
    bodyColor: '#d4af37', accentColor: '#15100a',
    stats: { speed: 10, accel: 9, handling: 9, drift: 7, weight: 5, boost: 9, defense: 4 },
    model: { length: 2.82, width: 1.78, height: 0.44, nose: 'wedge', cabin: 'canopy', podSize: 0, wheelStyle: 2, wheelSize: 1.12, exhaust: 4, spoilerStyle: 3, lights: 'visor', decalDefault: 5, style: 'lambo' },
  },
  {
    id: 'kart_vortexrs', name: 'VORTEX RS', cls: 'speed',
    desc: 'Track weapon with road plates. Downforce so strong it hums.',
    price: 169900, gemPrice: 339, tier: 'A', lad: 1.0, reqLevel: 1,
    bodyColor: '#14161c', accentColor: '#00e5ff',
    stats: { speed: 10, accel: 10, handling: 9, drift: 7, weight: 5, boost: 9, defense: 4 },
    model: { length: 2.8, width: 1.8, height: 0.42, nose: 'wedge', cabin: 'canopy', podSize: 1, wheelStyle: 2, wheelSize: 1.15, exhaust: 2, spoilerStyle: 3, lights: 'strip', decalDefault: 6, style: 'mclaren' },
  },
  // ---- v3.2 LEGENDARY S-CLASS (user: "ماشین‌های جدید اضافه کن که خیلی گرون
  // باشه و کاربر حتماً باید پول بده"): gem-only, the fastest tier in the game.
  {
    id: 'kart_raptor', name: 'RAPTOR X9', cls: 'speed',
    desc: 'Carbon claws and a jet-black canopy. The first taste of legend.',
    price: 249900, gemPrice: 590, tier: 'S', lad: 0.0, reqLevel: 1,
    bodyColor: '#1de9b6', accentColor: '#0b0f14',
    stats: { speed: 10, accel: 9, handling: 9, drift: 8, weight: 5, boost: 10, defense: 5 },
    model: { length: 2.84, width: 1.82, height: 0.42, nose: 'wedge', cabin: 'canopy', podSize: 1, wheelStyle: 2, wheelSize: 1.14, exhaust: 4, spoilerStyle: 3, lights: 'visor', decalDefault: 5, style: 'lambo' },
  },
  {
    id: 'kart_nova', name: 'NOVA STORM', cls: 'accel',
    desc: 'Plasma-blue hybrid beast. Launches like lightning, hums like a storm.',
    price: 289900, gemPrice: 690, tier: 'S', lad: 0.35, reqLevel: 1,
    bodyColor: '#2979ff', accentColor: '#e3f2fd',
    stats: { speed: 10, accel: 10, handling: 9, drift: 7, weight: 5, boost: 10, defense: 5 },
    model: { length: 2.8, width: 1.8, height: 0.43, nose: 'wedge', cabin: 'canopy', podSize: 0, wheelStyle: 2, wheelSize: 1.12, exhaust: 1, spoilerStyle: 3, lights: 'strip', decalDefault: 6, style: 'mclaren' },
  },
  {
    id: 'kart_hyperion', name: 'HYPERION', cls: 'balanced',
    desc: 'Royal purple with a gold heart. Grips, drifts and flies — all at once.',
    price: 329900, gemPrice: 790, tier: 'S', lad: 0.7, reqLevel: 1,
    bodyColor: '#7c4dff', accentColor: '#ffd740',
    stats: { speed: 10, accel: 10, handling: 10, drift: 9, weight: 6, boost: 10, defense: 6 },
    model: { length: 2.88, width: 1.84, height: 0.48, nose: 'round', cabin: 'canopy', podSize: 0, wheelStyle: 1, wheelSize: 1.14, exhaust: 4, spoilerStyle: 2, lights: 'strip', decalDefault: 0, style: 'bugatti' },
  },
  {
    id: 'kart_dragon', name: 'DRAGON KING', cls: 'speed',
    desc: 'Crimson scales, golden fangs. The king of the whole grid.',
    price: 379900, gemPrice: 890, tier: 'S', lad: 1.0, reqLevel: 1,
    bodyColor: '#d50000', accentColor: '#ffc400',
    stats: { speed: 10, accel: 10, handling: 10, drift: 9, weight: 6, boost: 10, defense: 7 },
    model: { length: 2.86, width: 1.84, height: 0.42, nose: 'wedge', cabin: 'canopy', podSize: 1, wheelStyle: 2, wheelSize: 1.16, exhaust: 4, spoilerStyle: 3, lights: 'visor', decalDefault: 5, style: 'wedge2' },
  },
  // ---- v3.3 VIP EXCLUSIVES (user: "VIP بتونه نه تنها ماشین‌های قفل، بلکه
  // ماشین‌های خفن رو هم باز کنه"): cannot be bought with coins or gems —
  // drivable only while the VIP pass is active. Same S top speed (fair), but
  // each one has the best-in-game flavour of its class + a unique paint job.
  {
    id: 'kart_phantom', name: 'PHANTOM VIP', cls: 'speed',
    desc: 'Black chrome and liquid gold. Only VIP drivers ever see its tail lights.',
    price: 0, vip: true, tier: 'S', lad: 1.0, reqLevel: 1,
    bodyColor: '#111317', accentColor: '#ffc83d',
    stats: { speed: 10, accel: 10, handling: 10, drift: 9, weight: 6, boost: 10, defense: 7 },
    model: { length: 2.9, width: 1.86, height: 0.46, nose: 'round', cabin: 'canopy', podSize: 0, wheelStyle: 1, wheelSize: 1.16, exhaust: 4, spoilerStyle: 2, lights: 'strip', decalDefault: 0, style: 'bugatti' },
  },
  {
    id: 'kart_thunder', name: 'THUNDERBOLT', cls: 'accel',
    desc: 'A storm in a bottle. The quickest launch on the whole grid.',
    price: 0, vip: true, tier: 'S', lad: 1.0, reqLevel: 1,
    bodyColor: '#ffe600', accentColor: '#1740ff',
    stats: { speed: 10, accel: 10, handling: 10, drift: 8, weight: 5, boost: 10, defense: 6 },
    model: { length: 2.8, width: 1.8, height: 0.42, nose: 'wedge', cabin: 'canopy', podSize: 1, wheelStyle: 2, wheelSize: 1.14, exhaust: 2, spoilerStyle: 3, lights: 'visor', decalDefault: 6, style: 'mclaren' },
  },
  {
    id: 'kart_galaxy', name: 'GALAXY GT', cls: 'drift',
    desc: 'Nebula paint, starlight trails. Drifts like it is floating in space.',
    price: 0, vip: true, tier: 'S', lad: 1.0, reqLevel: 1,
    bodyColor: '#6a1bff', accentColor: '#00f0ff',
    stats: { speed: 10, accel: 10, handling: 10, drift: 10, weight: 5, boost: 10, defense: 6 },
    model: { length: 2.84, width: 1.82, height: 0.43, nose: 'wedge', cabin: 'canopy', podSize: 0, wheelStyle: 2, wheelSize: 1.14, exhaust: 4, spoilerStyle: 3, lights: 'visor', decalDefault: 5, style: 'lambo' },
  },
];

export const carById = (id: string): CarDef => CARS.find(c => c.id === id) ?? CARS[0];

// ---- PERFORMANCE TIERS (user: "ماشین‌ها رو رده‌بندی کن، بهترین‌ها رتبه A") ----
// A = hypercars (best), B = sports, C = starters. Derived from the shop price
// — the economy already encodes the ranking.
export type CarTier = 'S' | 'A' | 'B' | 'C';
/** v3.2: tiers are EXPLICIT (car.tier) — prices no longer decide the class,
 *  so the shop can price freely. Fallback keeps old/unknown data working. */
export function tierOf(car: CarDef): CarTier {
  if (car.tier) return car.tier;
  if (car.price >= 13000) return 'A';
  if (car.price >= 5000) return 'B';
  return 'C';
}
export const TIER_ORDER: Record<CarTier, number> = { C: 0, B: 1, A: 2, S: 3 };
/** garage order: tier, then price (gems count as coins×500 for sorting) */
export function carSortKey(c: CarDef): number {
  return TIER_ORDER[tierOf(c)] * 1e7 + (c.vip ? 5e6 : 0) + (c.lad ?? 0) * 1e6 + (c.gemPrice ?? 0) * 500 + c.price;
}
export const TIER_COLORS: Record<CarTier, string> = { S: '#ff3d71', A: '#ffb300', B: '#b45aff', C: '#9aa7b8' };

// ---- customization options ----
export const PAINTS = ['#e84a3f', '#f7a021', '#f7d154', '#67c23a', '#20c8d8', '#2f7de0', '#8c4de0', '#e0489e', '#f2f2f2', '#2a2f38', '#7a4326', '#0e9e6e'];
export const WHEEL_COLORS = ['#1c1c1c', '#c0392b', '#2980b9', '#f1c40f', '#27ae60', '#8e44ad', '#ecf0f1'];
export const BOOST_COLORS = ['#ff9a3d', '#5ad0ff', '#a0ff5a', '#ff5ad0', '#ffe45a', '#b45aff'];
/** UNDERGLOW palette (user: "بشه برای زیر ماشین افکت رنگی گذاشت") — '' = off */
export const GLOW_COLORS = ['#00e5ff', '#7c4dff', '#ff1744', '#76ff03', '#ffea00', '#ff4081', '#ffffff', ''];
export const DECAL_COUNT = 7;   // stripe styles incl. none
export const SPOILER_COUNT = 4; // styles 0..3
export const EXHAUST_COUNT = 3; // 1,2,4 pipes
export const WHEEL_STYLE_COUNT = 4;

export function upgradeCost(stage: number): number { return [800, 2000, 4500][stage] ?? 0; }
