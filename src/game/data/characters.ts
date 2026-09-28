// KUBO KARTS - Character roster: 10 original voxel racers with distinct traits & animations.

export interface CharDef {
  id: string;
  name: string;
  title: string;
  desc: string;
  price: number;
  gemPrice?: number;
  reqLevel: number;
  trait: { id: string; label: string; desc: string };
  look: {
    skin: string;          // head/arms base
    shirt: string;
    pants: string;
    hat: 'cap' | 'goggles' | 'leaf' | 'flame' | 'crownHelm' | 'headphones' | 'magnet' | 'visor' | 'starHood' | 'shadowHood';
    hatColor: string;
    accent: string;        // shoes/gloves
    eyes: string;
    height: number;        // 0.85..1.15
    bulk: number;          // torso width scale
    emblem: string;        // chest emblem color
  };
}

export const CHARACTERS: CharDef[] = [
  {
    id: 'bolt', name: 'BOLT', title: 'The Rocket Rookie',
    desc: 'A delivery kid who upgraded from pizza bags to race karts. Never skips leg day, never brakes early.',
    price: 0, reqLevel: 1,
    trait: { id: 'startDash', label: 'ROCKET START', desc: '+20% stronger start boost' },
    look: { skin: '#f0b58a', shirt: '#e8452f', pants: '#2b3a67', hat: 'cap', hatColor: '#e8452f', accent: '#f2f2f2', eyes: '#22313f', height: 1, bulk: 1, emblem: '#f7d154' },
  },
  {
    id: 'pip', name: 'PIP', title: 'The Gadget Genius',
    desc: 'Half mechanic, half mischief. She built her first kart from a washing machine. It worked. Mostly.',
    price: 2400, reqLevel: 2,
    trait: { id: 'itemLuck', label: 'SCRAPYARD LUCK', desc: 'Item roulette favors stronger items' },
    look: { skin: '#f5c9a2', shirt: '#67c23a', pants: '#7a4326', hat: 'goggles', hatColor: '#f7a021', accent: '#37474f', eyes: '#1b5e20', height: 0.9, bulk: 0.9, emblem: '#e8f4ff' },
  },
  {
    id: 'moss', name: 'MOSS', title: 'The Nature Cruiser',
    desc: 'A sleepy forest spirit who somehow drifts beautifully. Smells faintly of pine and victory.',
    price: 3000, reqLevel: 4,
    trait: { id: 'offroad', label: 'ROOTED GRIP', desc: '-50% off-road slowdown' },
    look: { skin: '#7cb342', shirt: '#33691e', pants: '#5d4037', hat: 'leaf', hatColor: '#43a047', accent: '#a1887f', eyes: '#fdd835', height: 0.95, bulk: 1.15, emblem: '#aed581' },
  },
  {
    id: 'tiko', name: 'TIKO', title: 'The Drift Ape',
    desc: 'Jungle-born drift king. Communicates entirely in tire squeals and victory chest-beats.',
    price: 3600, reqLevel: 6,
    trait: { id: 'driftFast', label: 'JUNGLE STYLE', desc: 'Drift charges 25% faster' },
    look: { skin: '#8d6e63', shirt: '#f7a021', pants: '#5d4037', hat: 'headphones', hatColor: '#e8452f', accent: '#f2f2f2', eyes: '#3e2723', height: 0.98, bulk: 1.05, emblem: '#20c8d8' },
  },
  {
    id: 'ember', name: 'EMBER', title: 'The Flame Chaser',
    desc: 'Grew up next to a volcano. Considers lava a "mild inconvenience" and boost pads a lifestyle.',
    price: 4200, reqLevel: 8,
    trait: { id: 'boostPad', label: 'HOT STREAK', desc: 'Boost pads & turbo last +25% longer' },
    look: { skin: '#ff8a65', shirt: '#bf360c', pants: '#4e342e', hat: 'flame', hatColor: '#ff6d00', accent: '#ffca28', eyes: '#fff59d', height: 1.02, bulk: 1, emblem: '#ffab40' },
  },
  {
    id: 'glacier', name: 'GLACIER', title: 'The Cold Shoulder',
    desc: 'An ice golem with a heart of gold (frozen). Bad news for anyone relying on flashy gadgets.',
    price: 4800, reqLevel: 10,
    trait: { id: 'antiFreeze', label: 'COLD BLOOD', desc: 'Frozen & EMP time -40%' },
    look: { skin: '#b3e5fc', shirt: '#4fc3f7', pants: '#78909c', hat: 'crownHelm', hatColor: '#e1f5fe', accent: '#0277bd', eyes: '#01579b', height: 1.1, bulk: 1.2, emblem: '#e1f5fe' },
  },
  {
    id: 'magno', name: 'MAGNO', title: 'The Coin Collector',
    desc: 'A retired factory robot with a magnetic personality - literally. Coins just can\'t resist.',
    price: 5600, gemPrice: 60, reqLevel: 12,
    trait: { id: 'coinMagnet', label: 'MAGNETIC PULL', desc: 'Coins fly to you from farther' },
    look: { skin: '#b0bec5', shirt: '#455a64', pants: '#263238', hat: 'magnet', hatColor: '#e53935', accent: '#f2f2f2', eyes: '#00e5ff', height: 1.05, bulk: 1.1, emblem: '#f7d154' },
  },
  {
    id: 'blocksley', name: 'SIR BLOCKSLEY', title: 'The Iron Gentleman',
    desc: 'A knight-turned-racer. Fights with honor, wins with bumpers. "Most rude!" - after every collision.',
    price: 6800, reqLevel: 14,
    trait: { id: 'ironBumper', label: 'IRON BUMPER', desc: '+30% knockback dealt, -20% taken' },
    look: { skin: '#f5c9a2', shirt: '#78909c', pants: '#37474f', hat: 'crownHelm', hatColor: '#b0bec5', accent: '#f2f2f2', eyes: '#22313f', height: 1.08, bulk: 1.15, emblem: '#e53935' },
  },
  {
    id: 'nova', name: 'NOVA', title: 'The Sky Runner',
    desc: 'Grew up on floating islands. Treats jumps like doorways and gravity like a mild suggestion.',
    price: 8200, gemPrice: 90, reqLevel: 16,
    trait: { id: 'airborne', label: 'FEATHERFALL', desc: 'Better air control & softer landings' },
    look: { skin: '#ffe0b2', shirt: '#5c6bc0', pants: '#283593', hat: 'starHood', hatColor: '#7e57c2', accent: '#ffd54f', eyes: '#4527a0', height: 1, bulk: 0.95, emblem: '#ffd54f' },
  },
  {
    id: 'vex', name: 'VEX', title: 'The Midnight Racer',
    desc: 'Nobody has seen Vex\'s face. Nobody has beaten Vex twice. The slipstream whispers when they pass.',
    price: 12000, gemPrice: 150, reqLevel: 20,
    trait: { id: 'slipstream', label: 'SHADOW DRAFT', desc: 'Draft/slipstream boost is 2x stronger' },
    look: { skin: '#263238', shirt: '#121826', pants: '#0a0e14', hat: 'shadowHood', hatColor: '#121826', accent: '#00e676', eyes: '#00e676', height: 1.06, bulk: 1, emblem: '#00e676' },
  },
];

export const charById = (id: string): CharDef => CHARACTERS.find(c => c.id === id) ?? CHARACTERS[0];
