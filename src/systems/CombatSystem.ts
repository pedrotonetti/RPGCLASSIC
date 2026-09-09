import { generateLoot } from '../data/equipment';
import type { EquipmentInstance, SkillDefinition, Stats } from '../config/types';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { computeSkillLevelStats } from './skillMath';

export type CombatOutcome = 'ongoing' | 'victory' | 'defeat' | 'fled';

export interface CombatEvent {
  kind: 'damage' | 'heal' | 'miss' | 'buff' | 'defeated' | 'victory' | 'defeat' | 'fled' | 'info';
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

  constructor(
    public player: Player,
    public enemies: Enemy[],
  ) {}

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
        const dealt = enemy.takeDamage(roll.damage);
        events.push({
          kind: 'damage',
          text: `Você usou ${skill.name} em ${enemy.name}${roll.crit ? ' (Crítico!)' : ''}`,
          actorIsPlayer: true,
          targetIndex: index,
          amount: dealt,
          crit: roll.crit,
          targetHpAfter: enemy.currentHp,
        });
        if (!enemy.isAlive()) {
          events.push({ kind: 'defeated', text: `${enemy.name} foi derrotado!`, actorIsPlayer: true, targetIndex: index });
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
    for (const enemy of this.aliveEnemies()) {
      enemy.actionTimer -= dt;
      if (enemy.actionTimer > 0) continue;
      enemy.actionTimer = enemy.def.actionInterval * (0.85 + Math.random() * 0.3);
      this.runEnemyAction(enemy, events);
      if (this.outcome !== 'ongoing') break;
    }

    if (this.outcome === 'ongoing') this.checkVictory(events);
    return events;
  }

  private runEnemyAction(enemy: Enemy, events: CombatEvent[]): void {
    const usable = enemy.skills.filter((s) => enemy.currentMp >= computeSkillLevelStats(s, 1).cost);
    const skill = usable.length > 0 && Math.random() < 0.55 ? usable[Math.floor(Math.random() * usable.length)] : null;
    const activeSkill = skill ?? BASIC_ENEMY_ATTACK;
    const levelStats = computeSkillLevelStats(activeSkill, 1);
    if (skill) enemy.currentMp -= levelStats.cost;

    const kind = activeSkill.kind === 'magical' ? 'magical' : 'physical';
    const roll = resolveAttack(enemy.stats, this.effectiveStats(), levelStats.power, kind);
    const actorIndex = this.enemies.indexOf(enemy);

    if (roll.missed) {
      events.push({ kind: 'miss', text: `${enemy.name} errou o ataque.`, actorIsPlayer: false, actorIndex, targetIsPlayer: true });
      return;
    }
    const dealt = this.player.takeDamage(roll.damage);
    events.push({
      kind: 'damage',
      text: `${enemy.name} usou ${skill?.name ?? 'um ataque'} em você${roll.crit ? ' (Crítico!)' : ''}`,
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
