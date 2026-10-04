import { applyEnemyBalance } from '../config/balance';
import type { EnemyArchetype, EnemyDefinition, SkillDefinition, Stats } from '../config/types';
import { getBossById } from '../data/bosses';
import { getEnemyById } from '../data/enemies';
import { effectiveSkillsForPhase } from '../systems/BossPhaseSystem';
import { statusSpeedMultiplier, type ActiveStatusEffect, type StatusEffectHolder } from '../systems/statusEffects';

/** A single enemy instance within one battle. Enemies don't persist between battles. */
export class Enemy implements StatusEffectHolder {
  definitionId: string;
  currentHp: number;
  currentMp: number;
  /** Real-time AI clock: counts down to the enemy's next action. */
  actionTimer: number;
  /**
   * Multiplies this instance's stats, XP/gold reward and loot-tier signal
   * (`EnemyDefinition.level`) on top of its shared, hand-authored
   * `EnemyDefinition` — 1 for every ordinary spawn (wandering monster, fresh
   * tier-1 dungeon run). Set above 1 only for a repeat dungeon run entered at
   * a higher tier (see `DungeonTierSystem.dungeonTierStatMultiplier` and
   * `OverworldCombat.spawnDungeonEncounters`), so the same shared enemy data
   * can be reused unscaled everywhere else instead of forking a scaled copy
   * of it per tier.
   */
  private readonly tierMultiplier: number;
  /** Title prepended to the name for a rare variant (systems/RareEncounterSystem.ts); empty otherwise. */
  private readonly namePrefix: string;
  /**
   * This instance's full runtime stat sheet, resolved once at construction
   * (the source definitions are static data) instead of rebuilt on every
   * `def`/`stats` read — those are hit several times per frame per engaged
   * enemy by `CombatEngine.tick`/`OverworldCombat`.
   */
  private readonly resolvedDef: EnemyDefinition;
  /** Active bleed/burn/slow afflictions — see `systems/statusEffects.ts`; ticked by `CombatEngine.tick`. */
  statusEffects: ActiveStatusEffect[] = [];
  /** Which of `def.phases` (a scripted boss fight only — see `systems/BossPhaseSystem.ts`) is currently active. Always 0 (and never read) for an enemy with no `phases`. Advanced by `CombatEngine.tick`. */
  phaseIndex = 0;

  constructor(definitionId: string, tierMultiplier = 1, namePrefix = '') {
    this.definitionId = definitionId;
    this.tierMultiplier = tierMultiplier;
    this.namePrefix = namePrefix;
    this.resolvedDef = this.resolveDef();
    this.currentHp = this.stats.maxHp;
    this.currentMp = this.stats.maxMp;
    // Stagger initial actions a little so multiple enemies don't act in lockstep.
    this.actionTimer = this.def.actionInterval * (0.4 + Math.random() * 0.6);
  }

  /** <1 while `slow` is active — scales both this enemy's own action timer and its overworld chase speed (see `OverworldCombat`). */
  get speedMultiplier(): number {
    return statusSpeedMultiplier(this);
  }

  get def(): EnemyDefinition {
    return this.resolvedDef;
  }

  private resolveDef(): EnemyDefinition {
    // Dungeon bosses (data/bosses.ts) live outside data/enemies.ts's own
    // ENEMY_DEFINITIONS on purpose (see that file's header) — checked first
    // so a boss id never falls through to getEnemyById's throw. The shared
    // difficulty curve (config/balance.ts) applies to both lists alike,
    // before any repeat-dungeon tier multiplier below stacks on top of it.
    const base = applyEnemyBalance(getBossById(this.definitionId) ?? getEnemyById(this.definitionId));
    if (this.tierMultiplier === 1 && !this.namePrefix) return base;
    const mult = this.tierMultiplier;
    // A stat that's genuinely 0 (e.g. a melee-only enemy's magicAttack) stays
    // 0 — only a positive stat gets floored at 1 so scaling never rounds a
    // real stat away to nothing.
    const scale = (v: number) => (v === 0 ? 0 : Math.max(1, Math.round(v * mult)));
    return {
      ...base,
      name: this.namePrefix ? `${this.namePrefix} ${base.name}` : base.name,
      stats: {
        maxHp: scale(base.stats.maxHp),
        maxMp: scale(base.stats.maxMp),
        attack: scale(base.stats.attack),
        magicAttack: scale(base.stats.magicAttack),
        defense: scale(base.stats.defense),
        magicDefense: scale(base.stats.magicDefense),
        speed: scale(base.stats.speed),
        luck: scale(base.stats.luck),
      },
      xpReward: Math.round(base.xpReward * mult),
      goldReward: Math.round(base.goldReward * mult),
      // Loot rolls (see CombatSystem.checkVictory -> lootDropChance/generateLoot)
      // read this straight off `.def`, so a scaled-up dungeon mob correctly
      // rolls loot as if it were the harder enemy it now plays as.
      level: Math.round(base.level * mult),
    };
  }

  get name(): string {
    return this.def.name;
  }

  get color(): number {
    return this.def.color;
  }

  get isBoss(): boolean {
    return this.def.isBoss ?? false;
  }

  /** This enemy's AI personality, if any — see `systems/enemyArchetypes.ts`. */
  get archetype(): EnemyArchetype | undefined {
    return this.def.archetype;
  }

  get stats(): Stats {
    return this.def.stats;
  }

  /** The current phase's own skill pool for a scripted boss fight, or the base pool unchanged for everything else (`def.phases` unset) — see `systems/BossPhaseSystem.ts`. */
  get skills(): SkillDefinition[] {
    return effectiveSkillsForPhase(this.def.skills, this.def.phases, this.phaseIndex);
  }

  isAlive(): boolean {
    return this.currentHp > 0;
  }

  takeDamage(amount: number): number {
    const dmg = Math.max(0, Math.round(amount));
    this.currentHp = Math.max(0, this.currentHp - dmg);
    return dmg;
  }

  /** For a Suporte archetype's own heal skill (see CombatSystem.resolveEnemySupportHeal) — mirrors Player.heal. Returns the amount actually restored. */
  heal(amount: number): number {
    const before = this.currentHp;
    this.currentHp = Math.min(this.stats.maxHp, this.currentHp + Math.max(0, Math.round(amount)));
    return this.currentHp - before;
  }
}
