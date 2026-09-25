import type { EnemyDefinition, SkillDefinition, Stats } from '../config/types';
import { getBossById } from '../data/bosses';
import { getEnemyById } from '../data/enemies';

/** A single enemy instance within one battle. Enemies don't persist between battles. */
export class Enemy {
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

  constructor(definitionId: string, tierMultiplier = 1) {
    this.definitionId = definitionId;
    this.tierMultiplier = tierMultiplier;
    this.currentHp = this.stats.maxHp;
    this.currentMp = this.stats.maxMp;
    // Stagger initial actions a little so multiple enemies don't act in lockstep.
    this.actionTimer = this.def.actionInterval * (0.4 + Math.random() * 0.6);
  }

  get def(): EnemyDefinition {
    // Dungeon bosses (data/bosses.ts) live outside data/enemies.ts's own
    // ENEMY_DEFINITIONS on purpose (see that file's header) — checked first
    // so a boss id never falls through to getEnemyById's throw.
    const base = getBossById(this.definitionId) ?? getEnemyById(this.definitionId);
    if (this.tierMultiplier === 1) return base;
    const mult = this.tierMultiplier;
    // A stat that's genuinely 0 (e.g. a melee-only enemy's magicAttack) stays
    // 0 — only a positive stat gets floored at 1 so scaling never rounds a
    // real stat away to nothing.
    const scale = (v: number) => (v === 0 ? 0 : Math.max(1, Math.round(v * mult)));
    return {
      ...base,
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

  get stats(): Stats {
    return this.def.stats;
  }

  get skills(): SkillDefinition[] {
    return this.def.skills;
  }

  isAlive(): boolean {
    return this.currentHp > 0;
  }

  takeDamage(amount: number): number {
    const dmg = Math.max(0, Math.round(amount));
    this.currentHp = Math.max(0, this.currentHp - dmg);
    return dmg;
  }
}
