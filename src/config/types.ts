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

export type SkillTarget = 'enemy' | 'allEnemies' | 'self';
export type SkillKind = 'physical' | 'magical' | 'heal' | 'buff';

/**
 * A skill in a class's tree. Regular skills level from 1 to `maxLevel` (10)
 * by spending skill points. The one skill per class with `isUltimate: true`
 * instead auto-scales its level with the character's own level, all the way
 * to 100 — it never consumes skill points.
 */
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  kind: SkillKind;
  target: SkillTarget;
  isUltimate: boolean;
  maxLevel: number;
  /** Minimum character level required for this skill to become usable. */
  unlockLevel: number;
  /** Mana cost at level 1. */
  baseCost: number;
  /** Mana cost added per level. */
  costPerLevel: number;
  /** Damage/heal multiplier (vs. the relevant attack stat) at level 1. */
  basePower: number;
  /** Multiplier added per level. */
  powerPerLevel: number;
  /** Cooldown in seconds at level 1. */
  baseCooldown: number;
  /** Cooldown reduced (seconds) per level. */
  cooldownPerLevel: number;
  /** Cooldown never goes below this, however high the level. */
  minCooldown: number;
  /** For `kind: 'buff'` skills: which stat the temporary buff multiplies. */
  buffStat?: keyof Stats;
}

export interface SkillLevelStats {
  level: number;
  power: number;
  cost: number;
  cooldown: number;
}

export interface CharacterClassDefinition {
  id: string;
  name: string;
  description: string;
  /** Hex color used for the character model's primary garment color. */
  color: number;
  /** Hex color used as a secondary accent (trim, cape, gem, etc). */
  accentColor: number;
  baseStats: Stats;
  /** Stat increase applied on every level-up (rounded when applied). */
  growth: Stats;
  /** Basic attack is always available and free; the rest are the tree. */
  basicAttack: SkillDefinition;
  skills: SkillDefinition[];
}

export type ItemRarity = 'verde' | 'azul' | 'amarelo' | 'vermelho' | 'laranja';

export type EquipmentSlot = 'arma' | 'armadura' | 'acessorio';

export interface EquipmentTemplate {
  id: string;
  name: string;
  slot: EquipmentSlot;
  description: string;
  /** Relative weight of each stat this item rolls bonuses on, at rarity 'verde' and item level 1. */
  statWeights: Partial<Record<keyof Stats, number>>;
}

export interface EquipmentInstance {
  uid: string;
  templateId: string;
  rarity: ItemRarity;
  itemLevel: number;
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
  /** How often (seconds) this enemy acts on its own, real-time AI loop. */
  actionInterval: number;
  /** Skills the enemy may use in addition to its basic attack (fixed at level 1). */
  skills: SkillDefinition[];
  /** True for boss-tier enemies (bigger, tougher, shown with a boss banner). */
  isBoss?: boolean;
}
