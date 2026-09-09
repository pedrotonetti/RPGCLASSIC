import type { SkillDefinition, SkillKind, SkillLevelStats, SkillTarget, Stats } from '../config/types';

/** Regular skills are leveled 1-10 by spending skill points. */
export const REGULAR_SKILL_MAX_LEVEL = 10;
/** The class ultimate instead auto-scales with character level, up to 100. */
export const ULTIMATE_MAX_LEVEL = 100;

export function computeSkillLevelStats(skill: SkillDefinition, level: number): SkillLevelStats {
  const lvl = Math.max(1, Math.min(skill.maxLevel, level));
  const steps = lvl - 1;
  return {
    level: lvl,
    power: Math.round((skill.basePower + skill.powerPerLevel * steps) * 100) / 100,
    cost: Math.round(skill.baseCost + skill.costPerLevel * steps),
    cooldown: Math.max(skill.minCooldown, skill.baseCooldown - skill.cooldownPerLevel * steps),
  };
}

/** The ultimate's level tracks the character's own level 1:1, capped at 100. */
export function ultimateLevelForCharacter(characterLevel: number): number {
  return Math.max(1, Math.min(ULTIMATE_MAX_LEVEL, characterLevel));
}

/** Skill points granted for reaching a given character level (called once per level-up). */
export function skillPointsForLevel(characterLevel: number): number {
  // A steady point every level, plus a bonus every 5th level as a milestone reward.
  return characterLevel % 5 === 0 ? 2 : 1;
}

interface SkillCore {
  id: string;
  name: string;
  description: string;
  kind: SkillKind;
  target: SkillTarget;
  unlockLevel: number;
  baseCooldown: number;
  baseCost: number;
  basePower: number;
  buffStat?: keyof Stats;
}

/** A regular tree skill: levels 1-10 via skill points, moderate scaling. */
export function makeSkill(core: SkillCore): SkillDefinition {
  return {
    ...core,
    isUltimate: false,
    maxLevel: REGULAR_SKILL_MAX_LEVEL,
    powerPerLevel: Math.round(core.basePower * 0.15 * 100) / 100,
    costPerLevel: Math.max(1, Math.round(core.baseCost * 0.08)),
    cooldownPerLevel: Math.round(core.baseCooldown * 0.06 * 10) / 10,
    minCooldown: Math.round(core.baseCooldown * 0.55 * 10) / 10,
  };
}

/**
 * The class ultimate: levels 1-100 automatically with character level.
 *
 * Cost is intentionally frozen at `baseCost` (no per-level scaling): an
 * ultimate that gets stronger *and* more expensive as you level up fights
 * the reward of leveling it, and for low-mana-growth classes (e.g. the
 * Warrior, whose maxMp grows only +1/level) a scaling cost can outpace
 * mana growth entirely and make the ultimate permanently uncastable.
 */
export function makeUltimate(core: SkillCore): SkillDefinition {
  return {
    ...core,
    isUltimate: true,
    maxLevel: ULTIMATE_MAX_LEVEL,
    powerPerLevel: Math.round(core.basePower * 0.02 * 100) / 100,
    costPerLevel: 0,
    cooldownPerLevel: Math.round(core.baseCooldown * 0.005 * 100) / 100,
    minCooldown: Math.round(core.baseCooldown * 0.6 * 10) / 10,
  };
}

/** The free, always-available basic attack: fixed at level 1, very short cooldown, no cost. */
export function makeBasicAttack(kind: Extract<SkillKind, 'physical' | 'magical'>, power = 1.0): SkillDefinition {
  return {
    id: 'basic_attack',
    name: 'Ataque Básico',
    description: 'Um ataque simples, sempre disponível.',
    kind,
    target: 'enemy',
    unlockLevel: 1,
    isUltimate: false,
    maxLevel: 1,
    baseCooldown: 1.1,
    cooldownPerLevel: 0,
    minCooldown: 1.1,
    baseCost: 0,
    costPerLevel: 0,
    basePower: power,
    powerPerLevel: 0,
  };
}
