import type { EnemyDefinition, Stats } from './types';

/**
 * Enemy difficulty curve — the ONE place to re-tune how tough monsters are.
 *
 * `data/enemies.ts` and `data/bosses.ts` keep their original hand-authored
 * stat sheets (tuned back when fights were small, fixed, turn-based battle
 * groups); `applyEnemyBalance` layers this curve on top at runtime (see
 * `entities/Enemy.ts`, which resolves it once per spawned enemy), keyed off
 * each enemy's own difficulty tier (`EnemyDefinition.level`), so every
 * regular monster, every dungeon boss and every repeat-dungeon tier scale
 * from the same few numbers instead of dozens of hand-edited stat lines.
 *
 * Why this exists: measured with a scripted same-level simulation of the real
 * `CombatEngine` (every class, levels 1-16, 1v1/1v2/1v3, a human ~0.35s key
 * cadence), the unscaled sheets died in ~0.5s to the player's opening skills
 * at every regular tier (even the level-18 dragon boss fell in ~2s), and cost
 * 0-1% of the player's HP — class defense grows about
 * as fast as the hand-authored enemy attack does, so `attack - defense*0.6`
 * sat at or below zero for most matchups (a level-1 slime vs a level-1
 * warrior: 4 - 7*0.6 < 0 -> the 1-damage floor every single hit). The levers:
 *
 *  - HP, growing with tier (the player's burst — basic + every unlocked
 *    skill, with no global cooldown — grows faster than the old sheets did).
 *    Bosses get their own flat multiplier: their sheets were already big,
 *    and the regular curve's high-tier end would have made them slogs.
 *  - Attack, boosted the MOST at the lowest tiers (whose sheets were the ones
 *    stuck at the 1-damage floor) and fading back to 1x by the mid tiers,
 *    whose sheets already out-hit class defense — a flat or level-GROWING
 *    attack multiplier was measured to let the level-18 dragon crit a
 *    level-10 character for more than its whole HP bar.
 *  - A mitigation floor (`minDamageFraction`): defense still subtracts as
 *    before, but can't push a hit below that share of its raw power — what
 *    finally makes monsters matter to the tanky classes (warrior/paladin),
 *    without a big attack multiplier that would flatten the squishy ones.
 *
 * Measured result with the numbers below (same sim): a same-level single
 * trash mob now takes ~2.5-4s using skills (~4-8s basic-attack only), a pair
 * costs ~15-35% HP, a pack of three is genuinely dangerous (~40-75% HP), and
 * bosses are ~10-25s fights — while the worst single hit anywhere at levels
 * 1-2 stays at ~1/3 of the squishiest class's max HP (never a one-shot).
 */
export const ENEMY_BALANCE = {
  /** maxHp multiplier for a level-1 regular enemy ... */
  hpMultBase: 3.0,
  /** ... plus this much per enemy level above 1 (level 5 -> 3.48x, level 10 -> 4.08x). */
  hpMultPerLevel: 0.12,
  /** Flat maxHp multiplier for boss-tier enemies (`isBoss`), instead of the per-level curve above. */
  bossHpMult: 3.2,
  /** attack/magicAttack multiplier for a level-1 enemy ... */
  attackMultBase: 1.5,
  /** ... shrinking by this much per enemy level above 1 ... */
  attackMultFalloffPerLevel: 0.05,
  /** ... never below this (reached at level 11 with the numbers above; every boss sits at or near it). */
  attackMultMin: 1.0,
  /**
   * Flat multiplier on every enemy hit that lands on the player, AFTER
   * mitigation — kept at the pre-existing 0.65 (it compensates for monsters
   * being able to gang up on the player in the open world, which is still
   * true), just moved here so every enemy-damage knob lives together.
   */
  damageMult: 0.65,
  /**
   * The smallest share of an enemy hit's raw power (attack * skill power)
   * that defense is allowed to leave standing — see CombatSystem's
   * resolveAttack. The player's own attacks never use this floor. Only the
   * high-defense classes ever reach it; 0.55 has warrior/paladin taking
   * roughly 55-60% of what a mage does from the same fight (measured, sim),
   * instead of the near-total immunity they had before.
   */
  minDamageFraction: 0.55,
};

/** How much this enemy multiplies its hand-authored maxHp. */
export function enemyHpMultiplier(level: number, isBoss = false): number {
  if (isBoss) return ENEMY_BALANCE.bossHpMult;
  return ENEMY_BALANCE.hpMultBase + ENEMY_BALANCE.hpMultPerLevel * Math.max(0, level - 1);
}

/** How much this enemy tier multiplies its hand-authored attack/magicAttack. */
export function enemyAttackMultiplier(level: number): number {
  return Math.max(ENEMY_BALANCE.attackMultMin, ENEMY_BALANCE.attackMultBase - ENEMY_BALANCE.attackMultFalloffPerLevel * Math.max(0, level - 1));
}

/**
 * The runtime stat sheet for an enemy definition: maxHp and both attack
 * stats scaled by the multipliers above; defense/speed/luck/MP and every
 * non-stat field (rewards, skills, level, ...) untouched. A stat that's
 * genuinely 0 (a melee-only enemy's magicAttack) stays 0.
 */
export function applyEnemyBalance(def: EnemyDefinition): EnemyDefinition {
  const hpMult = enemyHpMultiplier(def.level, def.isBoss);
  const atkMult = enemyAttackMultiplier(def.level);
  const scale = (v: number, mult: number) => (v === 0 ? 0 : Math.max(1, Math.round(v * mult)));
  const stats: Stats = {
    ...def.stats,
    maxHp: scale(def.stats.maxHp, hpMult),
    attack: scale(def.stats.attack, atkMult),
    magicAttack: scale(def.stats.magicAttack, atkMult),
  };
  return { ...def, stats };
}
