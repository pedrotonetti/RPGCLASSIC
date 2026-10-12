import { ENEMY_DEFINITIONS } from '../data/enemies';

function pickWeighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Picks 1-2 enemy definition ids appropriate for the player's current level.
 * Bosses (`isBoss` — today, the story's one-of-a-kind `young_dragon`) are
 * never part of this random pool: every entry keeps a minimum weight of 1,
 * so leaving them in let the corrupted guardian turn up as ordinary field
 * filler anywhere in Pedravale — exactly what data/zones.ts's own comment on
 * Baluarte do Amanhecer says must never happen. It has its own hand-placed
 * encounter instead (OverworldScreen's BALUARTE_DRAGON_TILE). Weights key
 * off each enemy's own difficulty tier (`EnemyDefinition.level`) — for the
 * original eleven regular enemies that's exactly their old 1-based position
 * in ENEMY_DEFINITIONS, so their odds are unchanged, while enemies added
 * later (wherever they sit in the list) weigh in at their real tier.
 */
export function pickEncounterEnemyIds(playerLevel: number): string[] {
  const pool = ENEMY_DEFINITIONS.map((def) => {
    const intendedLevel = def.level;
    const diff = Math.abs(intendedLevel - playerLevel);
    return { def, weight: Math.max(1, 10 - diff * 2.5) };
  }).filter((entry) => !entry.def.isBoss);
  const defs = pool.map((entry) => entry.def);
  const weights = pool.map((entry) => entry.weight);

  const first = pickWeighted(defs, weights);
  const ids = [first.id];

  if (playerLevel >= 2 && Math.random() < 0.3) {
    const second = pickWeighted(defs, weights);
    ids.push(second.id);
  }

  return ids;
}
