import { RARITY_SCORE_MULTIPLIER } from '../config/rarity';
import type { Stats } from '../config/types';
import type { Player } from '../entities/Player';

function sumStats(stats: Stats): number {
  return stats.maxHp + stats.maxMp + stats.attack * 3 + stats.magicAttack * 3 + stats.defense * 3 + stats.magicDefense * 3 + stats.speed * 2 + stats.luck * 2;
}

/** A single number summarizing overall character strength, used for the ranking screen. */
export function computePowerScore(player: Player): number {
  const levelScore = player.level * 14;
  const statsScore = Math.round(sumStats(player.stats) * 0.8);

  let gearScore = 0;
  for (const instance of Object.values(player.equipment)) {
    if (!instance) continue;
    gearScore += RARITY_SCORE_MULTIPLIER[instance.rarity] * instance.itemLevel * 9;
  }

  let skillScore = 0;
  for (const skill of player.classDef.skills) {
    const level = player.skillLevel(skill.id);
    skillScore += skill.isUltimate ? level * 3.5 : level * 16;
  }

  return Math.round(levelScore + statsScore + gearScore + skillScore);
}
