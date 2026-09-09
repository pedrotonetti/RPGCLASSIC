import { generateLoot } from '../data/equipment';
import type { EquipmentInstance, SkillDefinition, Stats } from '../config/types';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { computeSkillLevelStats } from './skillMath';

export type CombatOutcome = 'ongoing' | 'victory' | 'defeat' | 'fled';

export interface CombatEvent {
  kind: 'damage' | 'heal' | 'miss' | 'buff' | 'defeated' | 'victory' | 'defeat' | 'fled' | 'info' | 'telegraph';
  text: string;
  actorIsPlayer: boolean;
  actorIndex?: number;
  targetIsPlayer?: boolean;
  targetIndex?: number;
  amount?: number;
  crit?: boolean;
  targetHpAfter?: number;
  loot?: EquipmentInstance[];
  xpGained?: number;
  goldGained?: number;
  levelsGained?: number;
}

export type UseSkillResult =
  | { ok: true; events: CombatEvent[] }
  | { ok: false; reason: 'cooldown' | 'mana' | 'dead' | 'unknown' };

interface ActiveBuff {
  stat: keyof Stats;
  mult: number;
  expiresAt: number;
}

interface AttackRoll {
  damage: number;
  crit: boolean;
  missed: boolean;
}

function resolveAttack(atk: Stats, def: Stats, power: number, kind: 'physical' | 'magical'): AttackRoll {
  const missChance = Math.min(0.25, Math.max(0.02, 0.05 + (def.luck - atk.luck) * 0.01));
  if (Math.random() < missChance) return { damage: 0, crit: false, missed: true };
  const atkStat = kind === 'physical' ? atk.attack : atk.magicAttack;
  const defStat = kind === 'physical' ? def.defense : def.magicDefense;
  const critChance = Math.min(0.5, Math.max(0.05, 0.05 + atk.luck * 0.015));
  const isCrit = Math.random() < critChance;
  const variance = 0.9 + Math.random() * 0.2;
  const raw = atkStat * power - defStat * 0.6;
  const damage = Math.max(1, Math.round(raw * variance * (isCrit ? 1.6 : 1)));
  return { damage, crit: isCrit, missed: false };
}

function resolveHeal(atk: Stats, power: number): number {
  return Math.round((atk.magicAttack + atk.attack * 0.3) * power) + 5;
}

const FLEE_KEY = '__flee';
const FLEE_COOLDOWN = 4;
export const ITEM_COOLDOWN = 3;
const BUFF_BASE_DURATION = 8;
const BUFF_DURATION_PER_LEVEL = 0.5;
const LOOT_DROP_CHANCE = 0.4;

// --- action-combat depth: telegraphed enemy attacks, a timed block/parry
// window, and a combo counter that rewards consecutive clean hits ---------
const BLOCK_KEY = '__block';
const BLOCK_DURATION = 0.5;
const PERFECT_BLOCK_WINDOW = 0.15;
const BLOCK_DAMAGE_REDUCTION = 0.65;
export const BLOCK_COOLDOWN = 1.6;
const PERFECT_BLOCK_STUN = 0.8;
const TELEGRAPH_DURATION = 0.45;
const COMBO_WINDOW = 3.0;
const COMBO_DAMAGE_PER_HIT = 0.05;
const COMBO_MAX_STACKS = 6;

// A tighter, riskier alternative to blocking: full damage negation, but a
// much shorter active window and no "safe" partial-mitigation fallback.
const DODGE_KEY = '__dodge';
const DODGE_DURATION = 0.25;
export const DODGE_COOLDOWN = 1.0;

// Enough clean hits in a row on the same enemy interrupts whatever it's
// winding up and delays its next move — a poise-break, rewarding combo play.
const STAGGER_THRESHOLD = 3;
const STAGGER_DELAY = 1.2;

/**
 * Real-time action-combat engine: skills are triggered on demand (subject to
 * their own cooldown/mana), enemies act autonomously on their own timers,
 * and `tick()` advances everything by one frame. There is no turn queue.
 */
export class CombatEngine {
  outcome: CombatOutcome = 'ongoing';
  clock = 0;
  private cooldowns: Record<string, number> = {};
  private buffs: ActiveBuff[] = [];

  private blockActiveUntil = -Infinity;
  private blockStartedAt = -Infinity;
  private dodgeActiveUntil = -Infinity;
  private comboCount = 0;
  private lastComboHitAt = -Infinity;
  private staggerStacks = new Map<Enemy, number>();
  private pendingAttacks = new Map<Enemy, { resolveAt: number; skill: SkillDefinition | null }>();

  constructor(
    public player: Player,
    public enemies: Enemy[],
  ) {}

  get comboHits(): number {
    return this.comboCount;
  }

  isBlocking(): boolean {
    return this.clock <= this.blockActiveUntil;
  }

  isDodging(): boolean {
    return this.clock <= this.dodgeActiveUntil;
  }

  blockCooldownRemaining(): number {
    return this.cooldownRemaining(BLOCK_KEY);
  }

  dodgeCooldownRemaining(): number {
    return this.cooldownRemaining(DODGE_KEY);
  }

  private aliveEnemies(): Enemy[] {
    return this.enemies.filter((e) => e.isAlive());
  }

  cooldownRemaining(skillId: string): number {
    return Math.max(0, this.cooldowns[skillId] ?? 0);
  }

  cooldownFraction(skillId: string, totalCooldown: number): number {
    if (totalCooldown <= 0) return 0;
    return Math.min(1, this.cooldownRemaining(skillId) / totalCooldown);
  }

  fleeCooldownRemaining(): number {
    return this.cooldownRemaining(FLEE_KEY);
  }

  /** Player's stats with active buffs applied on top. */
  effectiveStats(): Stats {
    const stats = { ...this.player.stats };
    for (const buff of this.buffs) {
      stats[buff.stat] = Math.round(stats[buff.stat] * buff.mult);
    }
    return stats;
  }

  private findSkill(skillId: string): SkillDefinition | null {
    if (skillId === this.player.classDef.basicAttack.id) return this.player.classDef.basicAttack;
    return this.player.classDef.skills.find((s) => s.id === skillId) ?? null;
  }

  useSkill(skillId: string, targetIndex?: number): UseSkillResult {
    if (this.outcome !== 'ongoing') return { ok: false, reason: 'dead' };
    const skill = this.findSkill(skillId);
    if (!skill) return { ok: false, reason: 'unknown' };
    if (this.cooldownRemaining(skillId) > 0) return { ok: false, reason: 'cooldown' };

    const isBasic = skillId === this.player.classDef.basicAttack.id;
    const level = isBasic ? 1 : this.player.skillLevel(skillId);
    const levelStats = computeSkillLevelStats(skill, level);
    if (this.player.currentMp < levelStats.cost) return { ok: false, reason: 'mana' };

    this.player.spendMp(levelStats.cost);
    this.cooldowns[skillId] = levelStats.cooldown;

    const events: CombatEvent[] = [];
    const atkStats = this.effectiveStats();

    if (skill.kind === 'heal') {
      const healed = this.player.heal(resolveHeal(atkStats, levelStats.power));
      events.push({
        kind: 'heal',
        text: `Você usou ${skill.name} e recuperou vida.`,
        actorIsPlayer: true,
        targetIsPlayer: true,
        amount: healed,
        targetHpAfter: this.player.currentHp,
      });
    } else if (skill.kind === 'buff') {
      const stat = skill.buffStat ?? 'attack';
      const mult = 1 + levelStats.power * 0.18;
      const duration = BUFF_BASE_DURATION + level * BUFF_DURATION_PER_LEVEL;
      this.buffs.push({ stat, mult, expiresAt: this.clock + duration });
      events.push({ kind: 'buff', text: `Você usou ${skill.name}!`, actorIsPlayer: true });
    } else {
      const kind = skill.kind === 'magical' ? 'magical' : 'physical';
      const targets =
        skill.target === 'allEnemies' ? this.aliveEnemies() : [this.enemies[targetIndex ?? 0]].filter(Boolean);

      for (const enemy of targets) {
        if (!enemy.isAlive()) continue;
        const index = this.enemies.indexOf(enemy);
        const roll = resolveAttack(atkStats, enemy.stats, levelStats.power, kind);
        if (roll.missed) {
          events.push({ kind: 'miss', text: `Você errou ${enemy.name}.`, actorIsPlayer: true, targetIndex: index });
          continue;
        }

        if (this.clock - this.lastComboHitAt > COMBO_WINDOW) this.comboCount = 0;
        this.comboCount = Math.min(COMBO_MAX_STACKS, this.comboCount + 1);
        this.lastComboHitAt = this.clock;
        const comboMult = 1 + this.comboCount * COMBO_DAMAGE_PER_HIT;

        const dealt = enemy.takeDamage(roll.damage * comboMult);
        const comboText = this.comboCount > 1 ? ` (Combo x${this.comboCount})` : '';
        events.push({
          kind: 'damage',
          text: `Você usou ${skill.name} em ${enemy.name}${roll.crit ? ' (Crítico!)' : ''}${comboText}`,
          actorIsPlayer: true,
          targetIndex: index,
          amount: dealt,
          crit: roll.crit,
          targetHpAfter: enemy.currentHp,
        });
        if (!enemy.isAlive()) {
          events.push({ kind: 'defeated', text: `${enemy.name} foi derrotado!`, actorIsPlayer: true, targetIndex: index });
          this.staggerStacks.delete(enemy);
        } else {
          this.registerHitForStagger(enemy, index, events);
        }
      }
    }

    this.checkVictory(events);
    return { ok: true, events };
  }

  attemptFlee(): UseSkillResult {
    if (this.outcome !== 'ongoing') return { ok: false, reason: 'dead' };
    if (this.fleeCooldownRemaining() > 0) return { ok: false, reason: 'cooldown' };
    this.cooldowns[FLEE_KEY] = FLEE_COOLDOWN;

    const alive = this.aliveEnemies();
    const avgSpeed = alive.reduce((s, e) => s + e.stats.speed, 0) / Math.max(1, alive.length);
    const chance = Math.min(0.9, Math.max(0.1, 0.5 + (this.player.stats.speed - avgSpeed) * 0.02));
    if (Math.random() < chance) {
      this.outcome = 'fled';
      return { ok: true, events: [{ kind: 'fled', text: 'Você fugiu da batalha!', actorIsPlayer: true }] };
    }
    return { ok: true, events: [{ kind: 'info', text: 'Você tentou fugir, mas não conseguiu!', actorIsPlayer: true }] };
  }

  /**
   * Opens a short block window: damage taken while it's active is cut down,
   * and — timed right at the very start of the window, against a telegraphed
   * attack — negated entirely as a "perfect block" that also staggers the
   * attacker. Has its own short cooldown so it can't just be held forever.
   */
  attemptBlock(): UseSkillResult {
    if (this.outcome !== 'ongoing') return { ok: false, reason: 'dead' };
    if (this.blockCooldownRemaining() > 0) return { ok: false, reason: 'cooldown' };
    this.cooldowns[BLOCK_KEY] = BLOCK_COOLDOWN;
    this.blockStartedAt = this.clock;
    this.blockActiveUntil = this.clock + BLOCK_DURATION;
    return { ok: true, events: [{ kind: 'info', text: 'Postura de bloqueio!', actorIsPlayer: true }] };
  }

  /**
   * Opens a much shorter i-frame window than block: no partial-mitigation
   * safety net, but a clean dodge avoids the hit entirely and keeps the
   * combo alive. Its own (shorter) cooldown means it can't replace blocking
   * outright — it's a higher-risk, higher-reward alternative for good timing.
   */
  attemptDodge(): UseSkillResult {
    if (this.outcome !== 'ongoing') return { ok: false, reason: 'dead' };
    if (this.dodgeCooldownRemaining() > 0) return { ok: false, reason: 'cooldown' };
    this.cooldowns[DODGE_KEY] = DODGE_COOLDOWN;
    this.dodgeActiveUntil = this.clock + DODGE_DURATION;
    return { ok: true, events: [{ kind: 'info', text: 'Esquiva!', actorIsPlayer: true }] };
  }

  /** Drinks/eats a consumable from the player's inventory (short shared cooldown so it can't be spammed). */
  useItem(itemId: string): UseSkillResult {
    if (this.outcome !== 'ongoing') return { ok: false, reason: 'dead' };
    const cooldownKey = `item_${itemId}`;
    if (this.cooldownRemaining(cooldownKey) > 0) return { ok: false, reason: 'cooldown' };

    const result = this.player.useItem(itemId);
    if (!result) return { ok: false, reason: 'unknown' };
    this.cooldowns[cooldownKey] = ITEM_COOLDOWN;

    const amount = result.hpRestored + result.mpRestored;
    return {
      ok: true,
      events: [
        {
          kind: 'heal',
          text: 'Você consumiu um item.',
          actorIsPlayer: true,
          targetIsPlayer: true,
          amount,
          targetHpAfter: this.player.currentHp,
        },
      ],
    };
  }

  /** Advances the battle by `dt` seconds: cooldowns, mana regen, buffs, enemy AI. */
  tick(dt: number): CombatEvent[] {
    if (this.outcome !== 'ongoing') return [];
    this.clock += dt;

    for (const key of Object.keys(this.cooldowns)) {
      this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);
    }
    this.buffs = this.buffs.filter((b) => b.expiresAt > this.clock);
    this.player.regenMp(dt);

    const events: CombatEvent[] = [];

    // Resolve any enemy attacks whose telegraph window has elapsed first.
    for (const [enemy, pending] of [...this.pendingAttacks]) {
      if (this.clock < pending.resolveAt) continue;
      this.pendingAttacks.delete(enemy);
      this.resolveEnemyAttack(enemy, pending.skill, events);
      if (this.outcome !== 'ongoing') break;
    }

    if (this.outcome === 'ongoing') {
      for (const enemy of this.aliveEnemies()) {
        if (this.pendingAttacks.has(enemy)) continue; // already winding up
        enemy.actionTimer -= dt;
        if (enemy.actionTimer > 0) continue;
        enemy.actionTimer = enemy.def.actionInterval * (0.85 + Math.random() * 0.3);
        this.beginEnemyAction(enemy, events);
      }
    }

    if (this.outcome === 'ongoing') this.checkVictory(events);
    return events;
  }

  /** Picks the enemy's next move and opens a short, telegraphed wind-up before it actually lands — the player's real window to block. */
  private beginEnemyAction(enemy: Enemy, events: CombatEvent[]): void {
    const usable = enemy.skills.filter((s) => enemy.currentMp >= computeSkillLevelStats(s, 1).cost);
    const skill = usable.length > 0 && Math.random() < 0.55 ? usable[Math.floor(Math.random() * usable.length)] : null;
    if (skill) enemy.currentMp -= computeSkillLevelStats(skill, 1).cost;

    this.pendingAttacks.set(enemy, { resolveAt: this.clock + TELEGRAPH_DURATION, skill });
    const actorIndex = this.enemies.indexOf(enemy);
    events.push({ kind: 'telegraph', text: `${enemy.name} vai atacar!`, actorIsPlayer: false, actorIndex });
  }

  /** Enough clean hits in a row on one enemy breaks its poise: cancels whatever it's winding up and delays its next move. */
  private registerHitForStagger(enemy: Enemy, index: number, events: CombatEvent[]): void {
    const stacks = (this.staggerStacks.get(enemy) ?? 0) + 1;
    if (stacks < STAGGER_THRESHOLD) {
      this.staggerStacks.set(enemy, stacks);
      return;
    }
    this.staggerStacks.set(enemy, 0);
    this.pendingAttacks.delete(enemy);
    enemy.actionTimer += STAGGER_DELAY;
    events.push({ kind: 'info', text: `${enemy.name} foi atordoado!`, actorIsPlayer: true, targetIndex: index });
  }

  private resolveEnemyAttack(enemy: Enemy, skill: SkillDefinition | null, events: CombatEvent[]): void {
    if (!enemy.isAlive()) return; // died mid wind-up

    const activeSkill = skill ?? BASIC_ENEMY_ATTACK;
    const levelStats = computeSkillLevelStats(activeSkill, 1);
    const kind = activeSkill.kind === 'magical' ? 'magical' : 'physical';
    const roll = resolveAttack(enemy.stats, this.effectiveStats(), levelStats.power, kind);
    const actorIndex = this.enemies.indexOf(enemy);

    if (roll.missed) {
      events.push({ kind: 'miss', text: `${enemy.name} errou o ataque.`, actorIsPlayer: false, actorIndex, targetIsPlayer: true });
      return;
    }

    const isPerfectBlock = this.isBlocking() && this.clock - this.blockStartedAt <= PERFECT_BLOCK_WINDOW;
    const isBlocked = this.isBlocking() && !isPerfectBlock;
    let dealt: number;
    let suffix = '';
    if (this.isDodging()) {
      dealt = 0;
      suffix = ' Esquivou!';
    } else if (isPerfectBlock) {
      dealt = 0;
      suffix = ' Bloqueio perfeito!';
      enemy.actionTimer += PERFECT_BLOCK_STUN;
    } else if (isBlocked) {
      dealt = this.player.takeDamage(roll.damage * (1 - BLOCK_DAMAGE_REDUCTION));
      suffix = ' (bloqueado)';
    } else {
      dealt = this.player.takeDamage(roll.damage);
      this.comboCount = 0;
    }

    events.push({
      kind: 'damage',
      text: `${enemy.name} usou ${skill?.name ?? 'um ataque'} em você${roll.crit ? ' (Crítico!)' : ''}${suffix}`,
      actorIsPlayer: false,
      actorIndex,
      targetIsPlayer: true,
      amount: dealt,
      crit: roll.crit,
      targetHpAfter: this.player.currentHp,
    });

    if (!this.player.isAlive()) {
      this.outcome = 'defeat';
      events.push({ kind: 'defeat', text: 'Você foi derrotado...', actorIsPlayer: false });
    }
  }

  private checkVictory(events: CombatEvent[]): void {
    if (this.enemies.length === 0 || this.aliveEnemies().length > 0) return;
    const xpGained = this.enemies.reduce((s, e) => s + e.def.xpReward, 0);
    const goldGained = this.enemies.reduce((s, e) => s + e.def.goldReward, 0);
    const loot: EquipmentInstance[] = [];
    for (let i = 0; i < this.enemies.length; i++) {
      if (Math.random() < LOOT_DROP_CHANCE) {
        const item = generateLoot(this.player.level, this.player.stats.luck);
        if (this.player.addLoot(item)) loot.push(item);
      }
    }
    const levelsGained = this.player.gainXp(xpGained);
    this.player.gold += goldGained;
    this.outcome = 'victory';
    events.push({
      kind: 'victory',
      text: `Vitória! +${xpGained} XP, +${goldGained} ouro${loot.length > 0 ? `, ${loot.length} item(ns) encontrado(s)` : ''}.`,
      actorIsPlayer: true,
      xpGained,
      goldGained,
      levelsGained,
      loot,
    });
  }
}

const BASIC_ENEMY_ATTACK: SkillDefinition = {
  id: 'enemy_basic',
  name: 'Ataque',
  description: '',
  kind: 'physical',
  target: 'enemy',
  isUltimate: false,
  maxLevel: 1,
  unlockLevel: 1,
  baseCost: 0,
  costPerLevel: 0,
  basePower: 1,
  powerPerLevel: 0,
  baseCooldown: 1,
  cooldownPerLevel: 0,
  minCooldown: 1,
};
