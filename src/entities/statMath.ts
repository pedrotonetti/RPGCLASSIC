import type { Stats } from '../config/types';

export function computeStatsAtLevel(base: Stats, growth: Stats, level: number): Stats {
  const levels = level - 1;
  const key = (k: keyof Stats) => Math.round(base[k] + growth[k] * levels);
  return {
    maxHp: key('maxHp'),
    maxMp: key('maxMp'),
    attack: key('attack'),
    magicAttack: key('magicAttack'),
    defense: key('defense'),
    magicDefense: key('magicDefense'),
    speed: key('speed'),
    luck: key('luck'),
  };
}
