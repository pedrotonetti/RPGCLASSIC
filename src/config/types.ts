export interface Stats {
  maxHp: number;
  maxMp: number;
  attack: number;
  magicAttack: number;
  defense: number;
  magicDefense: number;
  speed: number;
  luck: number;
}

export type SkillTarget = 'enemy' | 'allEnemies' | 'ally' | 'allAllies' | 'self';
export type SkillKind = 'physical' | 'magical' | 'heal' | 'buff';

export interface Skill {
  id: string;
  name: string;
  description: string;
  mpCost: number;
  target: SkillTarget;
  kind: SkillKind;
  /** Multiplies the relevant attack/magic stat when computing effect magnitude. */
  power: number;
  /** Minimum character level required to use this skill. */
  unlockLevel: number;
}

export interface CharacterClassDefinition {
  id: string;
  name: string;
  description: string;
  /** Hex color used for the placeholder sprite and UI accents of this class. */
  color: number;
  baseStats: Stats;
  /** Stat increase applied on every level-up (rounded when applied). */
  growth: Stats;
  skills: Skill[];
}

export interface ItemDefinition {
  id: string;
  name: string;
  description: string;
  kind: 'consumable';
  /** HP restored when used (0 if none). */
  healHp: number;
  /** MP restored when used (0 if none). */
  healMp: number;
  price: number;
}

export interface EnemyDefinition {
  id: string;
  name: string;
  color: number;
  stats: Stats;
  xpReward: number;
  goldReward: number;
  /** Skills the enemy may use in addition to its basic attack. */
  skills: Skill[];
}
