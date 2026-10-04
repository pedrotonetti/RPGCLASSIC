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
 * A real, ongoing affliction a skill can inflict on a hit target — see
 * `systems/statusEffects.ts` for the mechanics and `systems/statusSynergies.ts`
 * for how two of these combine into a bonus effect (Fase 3 — PDF section 5).
 */
export type StatusEffectType = 'bleed' | 'burn' | 'slow' | 'poison' | 'freeze' | 'stun';

/** An element a skill's damage can carry on top of its physical/magical kind — see `systems/damageAffinity.ts`. */
export type DamageElement = 'fire' | 'ice' | 'holy' | 'dark';

/** Everything an `EnemyDefinition` can be weak or resistant to: a skill's kind or its element. */
export type DamageTag = 'physical' | 'magical' | DamageElement;

/**
 * A recognizable AI personality an `EnemyDefinition` can opt into — see
 * `systems/enemyArchetypes.ts` for what each one actually does (movement,
 * skill choice, HP-threshold behavior changes). Left unset on an
 * `EnemyDefinition`, an enemy behaves exactly as it always has (the neutral
 * default profile) — this field only ever adds behavior, never removes any.
 * `summoner`/`mimic` are reserved: declared here so the type is already
 * complete, but not yet assigned to any real enemy (see that module's own
 * doc comment on why).
 */
export type EnemyArchetype = 'predator' | 'tank' | 'support' | 'ambusher' | 'summoner' | 'berserker' | 'controller' | 'guardian' | 'mimic';

/** Carried on a `SkillDefinition` that can inflict a status effect on a successful damaging hit. */
export interface StatusInflict {
  type: StatusEffectType;
  /** 0-1 chance to apply per hit target, rolled independently for `allEnemies` skills. */
  chance: number;
}

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
  /** A status effect this skill can inflict on a hit target (physical/magical skills only — never buff/heal). */
  inflicts?: StatusInflict;
  /** The element this skill's damage carries, checked against an enemy's `weaknesses`/`resistances` (see `systems/damageAffinity.ts`). Unset = plain physical/magical. */
  element?: DamageElement;
}

export interface SkillLevelStats {
  level: number;
  power: number;
  cost: number;
  cooldown: number;
}

/**
 * The shape a class's own unique combat identity takes (see
 * `systems/classMechanics.ts` for every tuning number, and `CombatEngine` for
 * where each one hooks in):
 *
 *  - `meter`: a battle-scoped 0-100 resource that fills from class-specific
 *    events (landing hits, blocking, healing, kills...) and resets every
 *    fight, like the combo counter does. Some meters are spent on an active
 *    ability (`ClassMechanicDefinition.ability`); others are purely passive.
 *  - `combo`: no resource of its own — re-reads the engine's shared combo
 *    counter through a class-specific lens (named levels, a finisher bonus).
 */
export type ClassMechanicKind = 'meter' | 'combo';

export interface ClassMechanicDefinition {
  /** Which engine behavior backs this mechanic — `CombatEngine` dispatches on it (e.g. 'fury', 'precision'). */
  id: string;
  /** Player-facing name shown on the HUD (e.g. 'Fúria'). */
  name: string;
  /** Player-facing explanation — shown as the HUD element's tooltip/aria-label and on the class select screen. */
  description: string;
  kind: ClassMechanicKind;
  /**
   * The active ability a full meter unlocks, if this mechanic has one (its
   * own hotbar button + key while in combat). Absent for passive meters
   * (e.g. the archer's Precisão) and for `combo` mechanics.
   */
  ability?: { name: string; description: string };
  /** Shows the meter as discrete steps (e.g. 5 marks -> "3/5") instead of a 0-100 percentage. */
  steps?: number;
  /** For a passive meter with no `ability`: announced the moment the meter fills, so the payoff isn't a silent surprise. */
  readyMessage?: string;
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
  /** This class's one unique combat identity beyond stats/skills. Optional: a class without one simply shows no class HUD element. */
  classMechanic?: ClassMechanicDefinition;
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
  /** Uniques only: the rarity this item always drops at. */
  fixedRarity?: ItemRarity;
  /** Uniques only: key into ITEM_PASSIVES (data/uniques.ts). */
  passiveId?: string;
  /** Set pieces only: key into SET_DEFINITIONS (data/uniques.ts). */
  setId?: string;
  /** Uniques/set pieces: existing template whose inventory icon this one reuses. */
  iconTemplateId?: string;
}

/** `value` is the final rolled magnitude, already level-scaled where the affix scales. */
export interface ItemAffix {
  id: string;
  value: number;
}

export interface EquipmentInstance {
  uid: string;
  templateId: string;
  rarity: ItemRarity;
  itemLevel: number;
  /** Absent on items saved before affixes existed — treated as none. */
  affixes?: ItemAffix[];
  /** Gem id socketed into this item, if any — adds its stat bonus and tints the item with a glow. */
  socketedGemId?: string;
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
  /** This enemy's AI personality — see `systems/enemyArchetypes.ts`. Unset = the neutral default profile (today's existing generic behavior, unchanged). */
  archetype?: EnemyArchetype;
  /**
   * This enemy's own difficulty tier, independent of whatever level the
   * player who kills it happens to be. Drives loot scaling (see
   * `generateLoot` in `data/equipment.ts`) and the shared HP/attack
   * difficulty curve layered over `stats` at runtime (see
   * `config/balance.ts`) — it is NOT read by encounter selection or AI.
   * Roughly matches "the player level this enemy is
   * calibrated to threaten", ordered consistently with `ENEMY_DEFINITIONS`
   * going from weakest to strongest, with boss-tier enemies set well above
   * the regular curve to match their outsized stats/rewards.
   */
  level: number;
  /**
   * A boss-only encounter script (see `systems/BossPhaseSystem.ts`): ordered
   * ascending by `hpThreshold` isn't required, but index 0 is always the
   * fight's OPENING state (no transition event fires for it — the boss just
   * starts there) and later entries are reached as its HP falls. Unset (the
   * default for every regular enemy, and for a boss with no scripted
   * fight yet) behaves exactly like today: one flat skill pool for the whole
   * fight, no phase transitions.
   */
  phases?: BossPhaseDefinition[];
  /** Damage tags this enemy takes extra damage from (see `systems/damageAffinity.ts`). Unset = no weaknesses. */
  weaknesses?: DamageTag[];
  /** Damage tags this enemy takes reduced damage from. A tag in both lists cancels out. */
  resistances?: DamageTag[];
}

/** One phase of a scripted boss fight — see `EnemyDefinition.phases` and `systems/BossPhaseSystem.ts`. */
export interface BossPhaseDefinition {
  /** This phase begins the instant the boss's HP fraction drops to/at or below this value. Omit (or leave meaningless) for index 0 — the fight's opening state is always active from the start, never entered via a threshold. */
  hpThreshold?: number;
  /** Shown once, the moment this phase begins — a narrative beat, not a status message (e.g. "A Matriarca-Geleia se contorce, furiosa"). Omit for index 0 (see `hpThreshold`) — no transition event ever fires for the opening phase. */
  transitionText?: string;
  /** This phase's own skill pool, REPLACING the boss's base `EnemyDefinition.skills` for as long as it's active — omit to keep the base pool unchanged (a phase can exist purely for its damage/speed/narrative beat, without a new attack). */
  skills?: SkillDefinition[];
  /** Multiplies damage dealt while this phase is active (on top of any archetype-driven enrage — see systems/enemyArchetypes.ts). 1 = unchanged. */
  damageMult?: number;
  /** Multiplies the next action-timer interval while this phase is active — below 1 acts faster. 1 = unchanged. */
  actionIntervalMult?: number;
}
