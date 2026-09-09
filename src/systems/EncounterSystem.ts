import { ENEMY_DEFINITIONS } from '../data/enemies';

/** Chance per step taken on an encounter tile that a battle triggers. */
export const ENCOUNTER_CHANCE_PER_STEP = 0.08;

function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Picks 1-2 enemy definition ids appropriate for the player's current level. */
export function pickEncounterEnemyIds(playerLevel: number): string[] {
  const weights = ENEMY_DEFINITIONS.map((_, i) => {
    const intendedLevel = i + 1;
    const diff = Math.abs(intendedLevel - playerLevel);
    return Math.max(1, 10 - diff * 2.5);
  });

  const first = pickWeighted(ENEMY_DEFINITIONS, weights);
  const ids = [first.id];

  if (playerLevel >= 2 && Math.random() < 0.3) {
    const second = pickWeighted(ENEMY_DEFINITIONS, weights);
    ids.push(second.id);
  }

  return ids;
}
