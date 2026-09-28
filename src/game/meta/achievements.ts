// KUBO KARTS v3 - Lifetime ACHIEVEMENTS (challenges screen, second tab) +
// profile badges. Progress is derived from the existing save stats, so old
// saves instantly show their real progress.
import type { Meta } from './meta';
import { CARS } from '../data/cars';
import { CHARACTERS } from '../data/characters';
import { LEVELS } from '../race/levels';

export interface Achievement {
  id: string;
  icon: string;               // icons3 name
  goal: number;
  gems: number;
  coins: number;
  value: (m: Meta) => number;
}

const cleared = (m: Meta) => LEVELS.filter(l => m.levelRecord(l.id).stars > 0).length;

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'ac_race10', icon: 'flag', goal: 10, gems: 10, coins: 1000, value: m => m.data.stats.races },
  { id: 'ac_race50', icon: 'flag', goal: 50, gems: 30, coins: 4000, value: m => m.data.stats.races },
  { id: 'ac_win5', icon: 'trophy', goal: 5, gems: 15, coins: 1500, value: m => m.data.stats.wins },
  { id: 'ac_win25', icon: 'trophy', goal: 25, gems: 50, coins: 6000, value: m => m.data.stats.wins },
  { id: 'ac_star30', icon: 'star', goal: 30, gems: 20, coins: 2000, value: m => m.totalStars() },
  { id: 'ac_star90', icon: 'star', goal: 90, gems: 60, coins: 8000, value: m => m.totalStars() },
  { id: 'ac_star180', icon: 'crown', goal: LEVELS.length * 3, gems: 200, coins: 25000, value: m => m.totalStars() },
  { id: 'ac_clear20', icon: 'map', goal: 20, gems: 25, coins: 3000, value: cleared },
  { id: 'ac_cars5', icon: 'car', goal: 5, gems: 25, coins: 0, value: m => m.data.ownedCars.length },
  { id: 'ac_carsAll', icon: 'car', goal: CARS.length, gems: 150, coins: 0, value: m => m.data.ownedCars.length },
  { id: 'ac_chars5', icon: 'helmet', goal: 5, gems: 25, coins: 0, value: m => m.data.ownedChars.length },
  { id: 'ac_charsAll', icon: 'helmet', goal: CHARACTERS.length, gems: 100, coins: 0, value: m => m.data.ownedChars.length },
  { id: 'ac_lvl10', icon: 'medal', goal: 10, gems: 30, coins: 3000, value: m => m.levelInfo.level },
  { id: 'ac_mp1', icon: 'users', goal: 1, gems: 10, coins: 1000, value: m => m.data.stats.mpWins },
];

export function achClaimed(m: Meta): string[] {
  return (m.data.achClaimed ??= []);
}
export function achProgress(m: Meta, a: Achievement) {
  const v = Math.min(a.goal, a.value(m));
  return { v, done: v >= a.goal, claimed: achClaimed(m).includes(a.id) };
}
export function claimAch(m: Meta, a: Achievement): boolean {
  const p = achProgress(m, a);
  if (!p.done || p.claimed) return false;
  achClaimed(m).push(a.id);
  if (a.gems) m.addGems(a.gems);
  if (a.coins) m.addCoins(a.coins);
  m.save();
  return true;
}
export function achClaimable(m: Meta): number {
  return ACHIEVEMENTS.filter(a => { const p = achProgress(m, a); return p.done && !p.claimed; }).length;
}
