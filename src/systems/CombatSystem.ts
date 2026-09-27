import { ENEMY_BALANCE } from '../config/balance';
import { generateLoot } from '../data/equipment';
import { MATERIAL_DEFINITIONS, MATERIAL_DROP_CHANCE } from '../data/materials';
import type { EquipmentInstance, SkillDefinition, SkillTarget, StatusEffectType, StatusInflict, Stats } from '../config/types';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import {
  CLASS_METER_MAX,
  FAITH_PER_BLOCK,
  FAITH_PER_CAST,
  FAITH_PER_PERFECT_BLOCK,
  FURY_PER_BLOCK,
  FURY_PER_DAMAGE_TAKEN,
  FURY_PER_HIT,
  FURY_PER_PERFECT_BLOCK,
  MIRACLE_HEAL_POWER,
  PRECISION_PER_HIT,
  SAVAGE_STRIKE_POWER,
  SOUL_DRAIN_LIFESTEAL,
  SOUL_DRAIN_POWER,
  SOULS_PER_HIT,
  SOULS_PER_KILL,
  classAbilityTarget,
  comboLabel,
  flowFinisherBonus,
  flowLevelForCombo,
  precisionCritBonus,
} from './classMechanics';
import { archetypeActionIntervalMultiplier, archetypeDamageMultiplier, archetypeProfileFor, pickSkillForArchetype, telegraphTextFor } from './enemyArchetypes';
import { phaseActionIntervalMultiplier, phaseDamageMultiplier, phaseIndexForHp } from './BossPhaseSystem';
import { computeSkillLevelStats } from './skillMath';
import { applyStatusEffect, tickStatusEffects } from './statusEffects';
import { checkFreezeShatter, checkStatusSynergy, type StatusSynergyResult } from './statusSynergies';

export type CombatOutcome = 'ongoing' | 'victory' | 'defeat' | 'fled';

export interface CombatEvent {
  kind:
    | 'damage'
    | 'heal'
    | 'miss'
    | 'buff'
    | 'defeated'
    | 'victory'
    | 'defeat'
    | 'fled'
    | 'info'
    | 'telegraph'
    | 'bossPhase'
    | 'stagger'
    | 'statusApplied'
    | 'statusTick';
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
  /** Crafting materials gained on victory, keyed by material id. */
  materialsGained?: Record<string, number>;
  /** How an incoming hit on the player was mitigated, if at all — lets the UI cue the right sound/feedback without parsing text. */
  mitigation?: 'block' | 'perfectBlock' | 'dodge';
  /** Set on `statusApplied`/`statusTick` events — which affliction this is about, for VFX/UI. */
  statusType?: StatusEffectType;
  /** Set on `damage`/`heal`/`buff` events raised by an actual skill (not a DoT tick) — lets the UI pick the right shared hit/impact VFX without re-deriving it from the skill id. */
  skillKind?: 'physical' | 'magical' | 'heal' | 'buff';
}

const STATUS_LABEL: Record<StatusEffectType, string> = {
  bleed: 'sangramento',
  burn: 'queimadura',
  slow: 'lentidão',
  poison: 'veneno',
  freeze: 'congelamento',
  stun: 'atordoamento',
};

/** `'meter'`: a class ability (`useClassAbility`) tried before its class meter is full. */
export type UseSkillResult =
  | { ok: true; events: CombatEvent[] }
  | { ok: false; reason: 'cooldown' | 'mana' | 'dead' | 'unknown' | 'meter' };

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

interface AttackOptions {
  /**
   * The smallest share of the hit's raw power (atkStat * power) defense may
   * leave standing — 0 (the default, used for the player's own attacks)
   * keeps the plain subtract-defense formula; enemy attacks pass
   * `ENEMY_BALANCE.minDamageFraction` (see config/balance.ts) so armor can
   * blunt a monster's hit but never erase it.
   */
  minFraction?: number;
  /** Added on top of the normal (capped) crit chance — the archer's Precisão (see classMechanics.ts). */
  bonusCritChance?: number;
  /** Skips the miss roll entirely — for class abilities paid for with a whole meter (see classMechanics.ts). */
  noMiss?: boolean;
}

function resolveAttack(atk: Stats, def: Stats, power: number, kind: 'physical' | 'magical', opts: AttackOptions = {}): AttackRoll {
  const { minFraction = 0, bonusCritChance = 0, noMiss = false } = opts;
  const missChance = Math.min(0.25, Math.max(0.02, 0.05 + (def.luck - atk.luck) * 0.01));
  if (!noMiss && Math.random() < missChance) return { damage: 0, crit: false, missed: true };
  const atkStat = kind === 'physical' ? atk.attack : atk.magicAttack;
  const defStat = kind === 'physical' ? def.defense : def.magicDefense;
  const critChance = Math.min(0.5, Math.max(0.05, 0.05 + atk.luck * 0.015)) + bonusCritChance;
  const isCrit = Math.random() < critChance;
  const variance = 0.9 + Math.random() * 0.2;
  const rawPower = atkStat * power;
  const raw = Math.max(rawPower * minFraction, rawPower - defStat * 0.6);
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
// Loot/material drop chance per defeated enemy scales gently with that
// enemy's own difficulty tier (EnemyDefinition.level): a trivial low-tier
// enemy still mostly drops nothing at all, so grinding weak monsters isn't
// a slot machine, while a genuinely tough kill is noticeably more likely to
// drop *something* — on top of that something already being higher-level
// and rarer via generateLoot's own enemy-level-driven roll. Boss-tier
// enemies (isBoss) get a large floor instead of the linear scale, so a
// one-off major fight (there's exactly one boss in this build, gating the
// final quest) doesn't feel like it could all be for nothing.
const LOOT_DROP_CHANCE_BASE = 0.32;
const LOOT_DROP_CHANCE_PER_LEVEL = 0.018;
const LOOT_DROP_CHANCE_MAX = 0.85;
const BOSS_LOOT_DROP_CHANCE = 0.95;
// Materials are minor crafting fodder (see data/materials.ts), so their own
// base chance stays as tuned there — only the enemy-tier nudge lives here,
// smaller than the equipment scale since materials are meant to keep
// trickling in steadily rather than tracking difficulty as tightly.
const MATERIAL_DROP_CHANCE_PER_LEVEL = 0.01;
const MATERIAL_DROP_CHANCE_MAX = 0.75;

/** Exported for direct (deterministic) unit testing of the tier-scaling curve — see CombatSystem.test.ts. */
export function lootDropChance(enemyLevel: number, isBoss: boolean | undefined): number {
  if (isBoss) return BOSS_LOOT_DROP_CHANCE;
  return Math.min(LOOT_DROP_CHANCE_MAX, LOOT_DROP_CHANCE_BASE + enemyLevel * LOOT_DROP_CHANCE_PER_LEVEL);
}

/** Exported for direct (deterministic) unit testing of the tier-scaling curve — see CombatSystem.test.ts. */
export function materialDropChance(enemyLevel: number): number {
  return Math.min(MATERIAL_DROP_CHANCE_MAX, MATERIAL_DROP_CHANCE + enemyLevel * MATERIAL_DROP_CHANCE_PER_LEVEL);
}
// Enemy-hit tuning (the post-mitigation damage multiplier that compensates
// for monsters ganging up in the open world, and the armor floor) lives in
// config/balance.ts's ENEMY_BALANCE, alongside the enemy HP/attack curve.

// --- action-combat depth: telegraphed enemy attacks, a timed block/parry
// window, and a combo counter that rewards consecutive clean hits ---------
const BLOCK_KEY = '__block';
const BLOCK_DURATION = 0.5;
const PERFECT_BLOCK_WINDOW = 0.15;
const BLOCK_DAMAGE_REDUCTION = 0.65;
export const BLOCK_COOLDOWN = 1.6;
const PERFECT_BLOCK_STUN = 0.8;
const TELEGRAPH_DURATION = 0.45;
/** The plain chance `beginEnemyAction` rolls to use a skill at all instead of a basic attack, before an archetype's own `skillUseChanceMult` (see systems/enemyArchetypes.ts) scales it. */
const BASE_SKILL_USE_CHANCE = 0.55;
// Exported only so classMechanics.test.ts can pin the monk's Fluxo levels
// (which re-read this same counter) against them.
export const COMBO_WINDOW = 3.0;
export const COMBO_DAMAGE_PER_HIT = 0.05;
export const COMBO_MAX_STACKS = 6;

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
  /** Which enemies have already landed their first action this fight — an Emboscador's one-time surprise bonus (`ArchetypeProfile.ambushFirstHitMult`) only ever applies once per enemy per fight. */
  private hasActed = new Set<Enemy>();

  /**
   * The player's class-mechanic resource (Fúria/Precisão/Fé/Almas — see
   * classMechanics.ts), 0..CLASS_METER_MAX. Battle-scoped exactly like
   * `comboCount`: born empty with this engine (one per fight) and discarded
   * with it — never persisted. Stays 0 for a class without a meter mechanic.
   */
  private classMeter = 0;
  /** `player.classDef.classMechanic?.id`, resolved once — every class-mechanic hook below dispatches on it. */
  private readonly mechanicId: string | undefined;

  constructor(
    public player: Player,
    public enemies: Enemy[],
  ) {
    this.mechanicId = player.classDef.classMechanic?.id;
  }

  get comboHits(): number {
    // `comboCount` itself only resets lazily, on the next landed hit — without
    // this, the HUD's combo badge (and the monk's Fluxo level, which is read
    // off this same counter) kept showing a chain that had already lapsed.
    return this.clock - this.lastComboHitAt > COMBO_WINDOW ? 0 : this.comboCount;
  }

  /** Current class-meter value, 0..CLASS_METER_MAX. */
  get classMeterValue(): number {
    return this.classMeter;
  }

  classMeterFraction(): number {
    return this.classMeter / CLASS_METER_MAX;
  }

  isClassMeterFull(): boolean {
    return this.classMeter >= CLASS_METER_MAX;
  }

  /** What this class's active ability targets, or null if its mechanic has none (the archer's passive Precisão, the monk's Fluxo, a class with no mechanic). */
  classAbilityTarget(): SkillTarget | null {
    return classAbilityTarget(this.mechanicId);
  }

  /** The monk's current Fluxo level (0..FLOW_MAX_LEVEL), derived from the shared combo counter — always 0 for every other class. */
  get flowLevel(): number {
    return this.mechanicId === 'flow' ? flowLevelForCombo(this.comboHits) : 0;
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
        skillKind: 'heal',
      });
      this.onSupportCast();
    } else if (skill.kind === 'buff') {
      const stat = skill.buffStat ?? 'attack';
      const mult = 1 + levelStats.power * 0.18;
      const duration = BUFF_BASE_DURATION + level * BUFF_DURATION_PER_LEVEL;
      this.buffs.push({ stat, mult, expiresAt: this.clock + duration });
      events.push({ kind: 'buff', text: `Você usou ${skill.name}!`, actorIsPlayer: true, targetIsPlayer: true, skillKind: 'buff' });
      this.onSupportCast();
    } else {
      const kind = skill.kind === 'magical' ? 'magical' : 'physical';
      const targets =
        skill.target === 'allEnemies' ? this.aliveEnemies() : [this.enemies[targetIndex ?? 0]].filter(Boolean);
      // Read off the meter as it stood BEFORE this action — the shot that
      // extends the streak is sharpened by the streak so far, not by itself.
      const bonusCritChance = this.mechanicId === 'precision' ? precisionCritBonus(this.classMeter) : 0;

      let landed = 0;
      let missed = 0;
      for (const enemy of targets) {
        if (!enemy.isAlive()) continue;
        const index = this.enemies.indexOf(enemy);
        const roll = resolveAttack(atkStats, enemy.stats, levelStats.power, kind, { bonusCritChance });
        if (roll.missed) {
          events.push({ kind: 'miss', text: `Você errou ${enemy.name}.`, actorIsPlayer: true, targetIndex: index });
          missed += 1;
          continue;
        }
        landed += 1;
        this.landPlayerHit(enemy, roll, skill.name, kind, events, { inflicts: skill.inflicts, feedsMeter: true });
      }
      this.onPlayerAttackResolved(landed, missed);
    }

    this.checkVictory(events);
    return { ok: true, events };
  }

  /**
   * One landed player hit: advances the shared combo, scales the roll by it
   * (plus the monk's Fluxo finisher bonus), deals the damage, and emits the
   * damage / defeated / stagger / status events. Shared by `useSkill` and
   * `useClassAbility` so both read identically to the HUD. `feedsMeter` is
   * false for class abilities — a spend never refills its own meter. Returns
   * the damage actually dealt.
   */
  private landPlayerHit(
    enemy: Enemy,
    roll: AttackRoll,
    actionName: string,
    kind: 'physical' | 'magical',
    events: CombatEvent[],
    opts: { inflicts?: StatusInflict; feedsMeter: boolean },
  ): number {
    const index = this.enemies.indexOf(enemy);
    if (this.clock - this.lastComboHitAt > COMBO_WINDOW) this.comboCount = 0;
    this.comboCount = Math.min(COMBO_MAX_STACKS, this.comboCount + 1);
    this.lastComboHitAt = this.clock;
    const comboMult = 1 + this.comboCount * COMBO_DAMAGE_PER_HIT + flowFinisherBonus(this.mechanicId, this.comboCount);

    const dealt = enemy.takeDamage(roll.damage * comboMult);
    const label = comboLabel(this.mechanicId, this.comboCount);
    const comboText = label ? ` (${label})` : '';
    events.push({
      kind: 'damage',
      text: `Você usou ${actionName} em ${enemy.name}${roll.crit ? ' (Crítico!)' : ''}${comboText}`,
      actorIsPlayer: true,
      targetIndex: index,
      amount: dealt,
      crit: roll.crit,
      targetHpAfter: enemy.currentHp,
      skillKind: kind,
    });
    if (!enemy.isAlive()) {
      events.push({ kind: 'defeated', text: `${enemy.name} foi derrotado!`, actorIsPlayer: true, targetIndex: index });
      this.staggerStacks.delete(enemy);
      if (opts.feedsMeter) this.onEnemyDefeated();
    } else {
      this.registerHitForStagger(enemy, index, events);

      // "Estilhaçamento" — checked against the target's status list BEFORE
      // this hit's own inflict roll below, so the hit that first freezes an
      // enemy can never shatter it on the spot (see statusSynergies.ts).
      const shatter = checkFreezeShatter(enemy);
      if (shatter) this.applySynergyBonusToEnemy(enemy, index, dealt, shatter, events, opts.feedsMeter);

      if (enemy.isAlive() && opts.inflicts && Math.random() < opts.inflicts.chance) {
        const synergy = checkStatusSynergy(enemy, opts.inflicts.type);
        applyStatusEffect(enemy, opts.inflicts.type, dealt);
        events.push({
          kind: 'statusApplied',
          text: `${enemy.name} sofre ${STATUS_LABEL[opts.inflicts.type]}!`,
          actorIsPlayer: true,
          targetIndex: index,
          statusType: opts.inflicts.type,
        });
        if (synergy) this.applySynergyBonusToEnemy(enemy, index, dealt, synergy, events, opts.feedsMeter);
      }
    }
    return dealt;
  }

  /**
   * Fires this class's active ability (Golpe Selvagem / Milagre da Fé /
   * Dreno das Almas — see classMechanics.ts): only with a FULL class meter,
   * which it then empties. No MP cost and no cooldown of its own — refilling
   * the meter is the cooldown. `targetIndex` picks the target the same way
   * `useSkill` does, for the single-target one. The meter is only spent once
   * the ability is known to have something to act on.
   */
  useClassAbility(targetIndex?: number): UseSkillResult {
    if (this.outcome !== 'ongoing') return { ok: false, reason: 'dead' };
    const ability = this.player.classDef.classMechanic?.ability;
    if (!ability || !this.classAbilityTarget()) return { ok: false, reason: 'unknown' };
    if (!this.isClassMeterFull()) return { ok: false, reason: 'meter' };

    const events: CombatEvent[] = [];
    const atkStats = this.effectiveStats();

    if (this.mechanicId === 'fury') {
      const enemy = this.enemies[targetIndex ?? 0];
      if (!enemy || !enemy.isAlive()) return { ok: false, reason: 'unknown' };
      this.classMeter = 0;
      const roll = resolveAttack(atkStats, enemy.stats, SAVAGE_STRIKE_POWER, 'physical', { noMiss: true });
      this.landPlayerHit(enemy, roll, ability.name, 'physical', events, { feedsMeter: false });
    } else if (this.mechanicId === 'faith') {
      this.classMeter = 0;
      // Every status effect in this build (bleed/burn/slow) is an affliction,
      // so the cleanse is simply "clear them all".
      const cleansed = this.player.statusEffects.length > 0;
      this.player.statusEffects = [];
      const healed = this.player.heal(resolveHeal(atkStats, MIRACLE_HEAL_POWER));
      events.push({
        kind: 'heal',
        text: `Você invocou ${ability.name}!${cleansed ? ' Suas aflições foram purificadas.' : ''}`,
        actorIsPlayer: true,
        targetIsPlayer: true,
        amount: healed,
        targetHpAfter: this.player.currentHp,
        skillKind: 'heal',
      });
    } else if (this.mechanicId === 'souls') {
      const targets = this.aliveEnemies();
      if (targets.length === 0) return { ok: false, reason: 'unknown' };
      this.classMeter = 0;
      // Lifesteal counts only the HP actually drained — `takeDamage` reports
      // the full hit even past 0 HP, and overkilling a nearly-dead enemy
      // shouldn't heal as if it had drained a fresh one.
      let totalDrained = 0;
      for (const enemy of targets) {
        const hpBefore = enemy.currentHp;
        const roll = resolveAttack(atkStats, enemy.stats, SOUL_DRAIN_POWER, 'magical', { noMiss: true });
        const dealt = this.landPlayerHit(enemy, roll, ability.name, 'magical', events, { feedsMeter: false });
        totalDrained += Math.min(dealt, hpBefore);
      }
      const healed = this.player.heal(totalDrained * SOUL_DRAIN_LIFESTEAL);
      events.push({
        kind: 'heal',
        text: 'As almas drenadas restauram sua vida.',
        actorIsPlayer: true,
        targetIsPlayer: true,
        amount: healed,
        targetHpAfter: this.player.currentHp,
        skillKind: 'heal',
      });
    } else {
      return { ok: false, reason: 'unknown' };
    }

    this.checkVictory(events);
    return { ok: true, events };
  }

  // --- class-mechanic meter hooks (tuning: classMechanics.ts) ------------

  private gainClassMeter(amount: number): void {
    this.classMeter = Math.min(CLASS_METER_MAX, this.classMeter + amount);
  }

  /** After a player attack skill resolves against all its targets: Fúria/Almas gain once if anything connected; Precisão gains on a clean action and empties on any miss. */
  private onPlayerAttackResolved(landed: number, missed: number): void {
    if (this.mechanicId === 'precision') {
      if (missed > 0) this.classMeter = 0;
      else if (landed > 0) this.gainClassMeter(PRECISION_PER_HIT);
    } else if (landed > 0) {
      if (this.mechanicId === 'fury') this.gainClassMeter(FURY_PER_HIT);
      else if (this.mechanicId === 'souls') this.gainClassMeter(SOULS_PER_HIT);
    }
  }

  /** After a heal or buff skill is cast. */
  private onSupportCast(): void {
    if (this.mechanicId === 'faith') this.gainClassMeter(FAITH_PER_CAST);
  }

  /** On every `defeated` event from the player's own attacks or DoTs (never from a class ability). */
  private onEnemyDefeated(): void {
    if (this.mechanicId === 'souls') this.gainClassMeter(SOULS_PER_KILL);
  }

  /** After an enemy hit that didn't miss lands on the player — `mitigation` undefined means it was taken in full. */
  private onEnemyHitResolved(mitigation: CombatEvent['mitigation']): void {
    if (this.mechanicId === 'fury') {
      if (mitigation === 'perfectBlock') this.gainClassMeter(FURY_PER_PERFECT_BLOCK);
      else if (mitigation === 'block') this.gainClassMeter(FURY_PER_BLOCK);
      else if (mitigation === undefined) this.gainClassMeter(FURY_PER_DAMAGE_TAKEN);
    } else if (this.mechanicId === 'faith') {
      if (mitigation === 'perfectBlock') this.gainClassMeter(FAITH_PER_PERFECT_BLOCK);
      else if (mitigation === 'block') this.gainClassMeter(FAITH_PER_BLOCK);
    }
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

    // A `slow` affliction on the player scales down how fast their own
    // cooldowns recover — their practical "attack speed" while iced up.
    const playerCooldownRate = dt * this.player.speedMultiplier;
    for (const key of Object.keys(this.cooldowns)) {
      this.cooldowns[key] = Math.max(0, this.cooldowns[key] - playerCooldownRate);
    }
    this.buffs = this.buffs.filter((b) => b.expiresAt > this.clock);
    this.player.regenMp(dt);

    const events: CombatEvent[] = [];

    this.tickStatusDamage(dt, events);
    if (this.outcome !== 'ongoing') return events;

    this.advanceBossPhases(events);

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
        // A `slow` affliction scales down how fast this enemy's own action
        // timer counts down — both its attack speed AND (via the same
        // `speedMultiplier`, read by `OverworldCombat`'s own chase logic)
        // its overworld movement speed.
        enemy.actionTimer -= dt * enemy.speedMultiplier;
        if (enemy.actionTimer > 0) continue;
        const profile = archetypeProfileFor(enemy.archetype);
        const hpFraction = enemy.currentHp / enemy.stats.maxHp;
        enemy.actionTimer =
          enemy.def.actionInterval *
          (0.85 + Math.random() * 0.3) *
          archetypeActionIntervalMultiplier(profile, hpFraction) *
          phaseActionIntervalMultiplier(enemy.def.phases, enemy.phaseIndex);
        this.beginEnemyAction(enemy, events);
      }
    }

    if (this.outcome === 'ongoing') this.checkVictory(events);
    return events;
  }

  /** Advances every alive scripted boss's own phase (see systems/BossPhaseSystem.ts) if its current HP has crossed into a new one — a plain enemy with no `def.phases` is untouched (phaseIndexForHp always returns 0 for it, already its resting state). Run right after status DoT (which can itself push a boss into a new phase this same frame) and before anything reads `enemy.skills`/damage multipliers this tick. */
  private advanceBossPhases(events: CombatEvent[]): void {
    for (const enemy of this.aliveEnemies()) {
      if (!enemy.def.phases) continue;
      const hpFraction = enemy.currentHp / enemy.stats.maxHp;
      const nextIndex = phaseIndexForHp(enemy.def.phases, hpFraction);
      if (nextIndex === enemy.phaseIndex) continue;
      enemy.phaseIndex = nextIndex;
      const phase = enemy.def.phases[nextIndex];
      events.push({ kind: 'bossPhase', text: phase.transitionText ?? '', actorIsPlayer: false, actorIndex: this.enemies.indexOf(enemy) });
    }
  }

  /** Ticks every active bleed/burn on both sides, applying DoT damage and emitting `statusTick` events — run once per frame, before anything else that could also end the battle this same tick. */
  private tickStatusDamage(dt: number, events: CombatEvent[]): void {
    for (const enemy of this.aliveEnemies()) {
      const result = tickStatusEffects(enemy, dt);
      if (result.damage <= 0) continue;
      const index = this.enemies.indexOf(enemy);
      const dealt = enemy.takeDamage(result.damage);
      events.push({
        kind: 'statusTick',
        text: `${enemy.name} sofre ${result.ticked.map((t) => STATUS_LABEL[t]).join(' e ')}.`,
        actorIsPlayer: true,
        targetIndex: index,
        amount: dealt,
        targetHpAfter: enemy.currentHp,
        statusType: result.ticked[0],
      });
      if (!enemy.isAlive()) {
        events.push({ kind: 'defeated', text: `${enemy.name} foi derrotado!`, actorIsPlayer: true, targetIndex: index });
        this.staggerStacks.delete(enemy);
        this.onEnemyDefeated();
      }
    }
    if (this.outcome === 'ongoing') this.checkVictory(events);
    if (this.outcome !== 'ongoing') return;

    const playerResult = tickStatusEffects(this.player, dt);
    if (playerResult.damage <= 0) return;
    const dealt = this.player.takeDamage(playerResult.damage);
    events.push({
      kind: 'statusTick',
      text: `Você sofre ${playerResult.ticked.map((t) => STATUS_LABEL[t]).join(' e ')}.`,
      actorIsPlayer: false,
      targetIsPlayer: true,
      amount: dealt,
      targetHpAfter: this.player.currentHp,
      statusType: playerResult.ticked[0],
    });
    if (!this.player.isAlive()) {
      this.outcome = 'defeat';
      events.push({ kind: 'defeat', text: 'Você foi derrotado...', actorIsPlayer: false });
    }
  }

  /** Picks the enemy's next move and opens a short, telegraphed wind-up before it actually lands — the player's real window to block. */
  private beginEnemyAction(enemy: Enemy, events: CombatEvent[]): void {
    const profile = archetypeProfileFor(enemy.archetype);
    const usable = enemy.skills.filter((s) => enemy.currentMp >= computeSkillLevelStats(s, 1).cost);
    const wantsSkill = usable.length > 0 && Math.random() < Math.min(1, BASE_SKILL_USE_CHANCE * profile.skillUseChanceMult);
    let skill = wantsSkill ? pickSkillForArchetype(profile, usable) : null;
    // A Suporte with nobody actually hurt would otherwise "heal" a full-HP
    // target for 0 — falls back to a normal action instead of wasting its turn.
    if (skill?.kind === 'heal' && !this.aliveEnemies().some((e) => e.currentHp < e.stats.maxHp * 0.9)) {
      skill = null;
    }
    if (skill) enemy.currentMp -= computeSkillLevelStats(skill, 1).cost;

    this.pendingAttacks.set(enemy, { resolveAt: this.clock + TELEGRAPH_DURATION, skill });
    const actorIndex = this.enemies.indexOf(enemy);
    events.push({ kind: 'telegraph', text: telegraphTextFor(profile, enemy.name), actorIsPlayer: false, actorIndex });
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
    events.push({ kind: 'stagger', text: `${enemy.name} foi atordoado!`, actorIsPlayer: true, targetIndex: index });
  }

  /**
   * A status-effect combo's payoff (see systems/statusSynergies.ts) landing
   * on an enemy: burns off the consumed effect, deals its own bonus-damage
   * event (reusing every existing 'damage'-event render path — HP bar,
   * floating "-N", hit VFX — with zero new UI), and (only if the enemy
   * survives it) inflicts a fresh stun. Mirrors the base hit's own
   * defeated-handling exactly, since this bonus can finish an enemy off on
   * its own.
   */
  private applySynergyBonusToEnemy(enemy: Enemy, index: number, triggeringDamage: number, result: StatusSynergyResult, events: CombatEvent[], feedsMeter: boolean): void {
    enemy.statusEffects = enemy.statusEffects.filter((e) => e.type !== result.consumes);
    const bonus = Math.max(1, Math.round(triggeringDamage * result.bonusDamageFraction));
    const dealt = enemy.takeDamage(bonus);
    events.push({ kind: 'damage', text: `${result.label}!`, actorIsPlayer: true, targetIndex: index, amount: dealt, targetHpAfter: enemy.currentHp, skillKind: 'physical' });
    if (!enemy.isAlive()) {
      events.push({ kind: 'defeated', text: `${enemy.name} foi derrotado!`, actorIsPlayer: true, targetIndex: index });
      this.staggerStacks.delete(enemy);
      if (feedsMeter) this.onEnemyDefeated();
    } else if (result.inflictsStun) {
      applyStatusEffect(enemy, 'stun', dealt);
    }
  }

  /**
   * Same as `applySynergyBonusToEnemy`, but for a synergy landing on the
   * player — deliberately does NOT push its own 'defeat' event even if this
   * bonus is the killing blow: `resolveEnemyAttack`'s own existing
   * `!this.player.isAlive()` check (right after every call site of this
   * method) already covers that uniformly, however the player actually died.
   */
  private applySynergyBonusToPlayer(triggeringDamage: number, result: StatusSynergyResult, events: CombatEvent[]): void {
    this.player.statusEffects = this.player.statusEffects.filter((e) => e.type !== result.consumes);
    const bonus = Math.max(1, Math.round(triggeringDamage * result.bonusDamageFraction));
    const dealt = this.player.takeDamage(bonus);
    events.push({ kind: 'damage', text: `${result.label}!`, actorIsPlayer: false, targetIsPlayer: true, amount: dealt, targetHpAfter: this.player.currentHp, skillKind: 'physical' });
    if (this.player.isAlive() && result.inflictsStun) applyStatusEffect(this.player, 'stun', dealt);
  }

  /** Suporte archetype's actual behavior: heals its most wounded ally (itself included) instead of attacking — see systems/enemyArchetypes.ts's own doc comment. */
  private resolveEnemySupportHeal(enemy: Enemy, skill: SkillDefinition, events: CombatEvent[]): void {
    const levelStats = computeSkillLevelStats(skill, 1);
    const target = [...this.aliveEnemies()].sort((a, b) => a.currentHp / a.stats.maxHp - b.currentHp / b.stats.maxHp)[0];
    if (!target) return;
    const healed = target.heal(resolveHeal(enemy.stats, levelStats.power));
    const actorIndex = this.enemies.indexOf(enemy);
    const targetIndex = this.enemies.indexOf(target);
    events.push({
      kind: 'heal',
      text: target === enemy ? `${enemy.name} usou ${skill.name} e se curou.` : `${enemy.name} usou ${skill.name} em ${target.name}.`,
      actorIsPlayer: false,
      actorIndex,
      targetIndex,
      amount: healed,
      targetHpAfter: target.currentHp,
      skillKind: 'heal',
    });
  }

  private resolveEnemyAttack(enemy: Enemy, skill: SkillDefinition | null, events: CombatEvent[]): void {
    if (!enemy.isAlive()) return; // died mid wind-up

    const activeSkill = skill ?? BASIC_ENEMY_ATTACK;
    if (activeSkill.kind === 'heal') {
      this.resolveEnemySupportHeal(enemy, activeSkill, events);
      return;
    }
    const levelStats = computeSkillLevelStats(activeSkill, 1);
    const kind = activeSkill.kind === 'magical' ? 'magical' : 'physical';
    const roll = resolveAttack(enemy.stats, this.effectiveStats(), levelStats.power, kind, { minFraction: ENEMY_BALANCE.minDamageFraction });
    roll.damage = Math.max(1, Math.round(roll.damage * ENEMY_BALANCE.damageMult));
    const profile = archetypeProfileFor(enemy.archetype);
    const hpFraction = enemy.currentHp / enemy.stats.maxHp;
    let archetypeMult = archetypeDamageMultiplier(profile, hpFraction);
    if (profile.ambushFirstHitMult && !this.hasActed.has(enemy)) archetypeMult *= profile.ambushFirstHitMult;
    this.hasActed.add(enemy);
    archetypeMult *= phaseDamageMultiplier(enemy.def.phases, enemy.phaseIndex);
    if (archetypeMult !== 1) roll.damage = Math.max(1, Math.round(roll.damage * archetypeMult));
    const actorIndex = this.enemies.indexOf(enemy);

    if (roll.missed) {
      events.push({ kind: 'miss', text: `${enemy.name} errou o ataque.`, actorIsPlayer: false, actorIndex, targetIsPlayer: true });
      return;
    }

    const isPerfectBlock = this.isBlocking() && this.clock - this.blockStartedAt <= PERFECT_BLOCK_WINDOW;
    const isBlocked = this.isBlocking() && !isPerfectBlock;
    let dealt: number;
    let suffix = '';
    let mitigation: CombatEvent['mitigation'];
    if (this.isDodging()) {
      dealt = 0;
      suffix = ' Esquivou!';
      mitigation = 'dodge';
    } else if (isPerfectBlock) {
      dealt = 0;
      suffix = ' Bloqueio perfeito!';
      mitigation = 'perfectBlock';
      enemy.actionTimer += PERFECT_BLOCK_STUN;
    } else if (isBlocked) {
      dealt = this.player.takeDamage(roll.damage * (1 - BLOCK_DAMAGE_REDUCTION));
      suffix = ' (bloqueado)';
      mitigation = 'block';
    } else {
      dealt = this.player.takeDamage(roll.damage);
      this.comboCount = 0;
    }
    this.onEnemyHitResolved(mitigation);

    events.push({
      kind: 'damage',
      text: `${enemy.name} usou ${skill?.name ?? 'um ataque'} em você${roll.crit ? ' (Crítico!)' : ''}${suffix}`,
      actorIsPlayer: false,
      actorIndex,
      targetIsPlayer: true,
      amount: dealt,
      crit: roll.crit,
      targetHpAfter: this.player.currentHp,
      mitigation,
      skillKind: kind,
    });

    if (dealt > 0) {
      // "Estilhaçamento" — checked BEFORE this hit's own inflict roll below,
      // so the hit that first freezes the player can never shatter it on
      // the spot (see statusSynergies.ts).
      const shatter = checkFreezeShatter(this.player);
      if (shatter) this.applySynergyBonusToPlayer(dealt, shatter, events);

      if (this.player.isAlive() && activeSkill.inflicts && Math.random() < activeSkill.inflicts.chance) {
        const synergy = checkStatusSynergy(this.player, activeSkill.inflicts.type);
        applyStatusEffect(this.player, activeSkill.inflicts.type, dealt);
        events.push({
          kind: 'statusApplied',
          text: `Você sofre ${STATUS_LABEL[activeSkill.inflicts.type]}!`,
          actorIsPlayer: false,
          targetIsPlayer: true,
          statusType: activeSkill.inflicts.type,
        });
        if (synergy) this.applySynergyBonusToPlayer(dealt, synergy, events);
      }
    }

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
    const materialsGained: Record<string, number> = {};
    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      if (Math.random() < lootDropChance(enemy.def.level, enemy.def.isBoss)) {
        const item = generateLoot(enemy.def.level, this.player.level, this.player.stats.luck);
        if (this.player.addLoot(item)) loot.push(item);
      }
      if (Math.random() < materialDropChance(enemy.def.level)) {
        const material = MATERIAL_DEFINITIONS[Math.floor(Math.random() * MATERIAL_DEFINITIONS.length)];
        materialsGained[material.id] = (materialsGained[material.id] ?? 0) + 1;
        this.player.addItem(material.id, 1);
      }
    }
    const levelsGained = this.player.gainXp(xpGained);
    this.player.gold += goldGained;
    this.outcome = 'victory';
    const materialsText = Object.keys(materialsGained).length > 0 ? ', materiais encontrados' : '';
    events.push({
      kind: 'victory',
      text: `Vitória! +${xpGained} XP, +${goldGained} ouro${loot.length > 0 ? `, ${loot.length} item(ns) encontrado(s)` : ''}${materialsText}.`,
      actorIsPlayer: true,
      xpGained,
      goldGained,
      levelsGained,
      loot,
      materialsGained,
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
