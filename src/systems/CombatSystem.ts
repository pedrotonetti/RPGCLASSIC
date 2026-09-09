import type { Skill, Stats } from '../config/types';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';

export type BattleActionType = 'attack' | 'skill' | 'item' | 'run';

export interface PlayerAction {
  type: BattleActionType;
  skillId?: string;
  itemId?: string;
  /** Index into the engine's enemies array, for single-target actions. */
  targetIndex?: number;
}

export interface LogEntry {
  actorName: string;
  text: string;
  targetName?: string;
  /** Index into the engine's enemies array, set when the actor is an enemy. */
  actorIndex?: number;
  /** Index into the engine's enemies array, set when the target is an enemy. */
  targetIndex?: number;
  damage?: number;
  healed?: number;
  crit?: boolean;
  missed?: boolean;
  defeated?: boolean;
  /** HP of the target immediately after this entry resolves, for animating HP bars in order. */
  targetHpAfter?: number;
}

export type BattleOutcome = 'ongoing' | 'victory' | 'defeat' | 'fled';

export interface RoundResult {
  entries: LogEntry[];
  outcome: BattleOutcome;
  levelsGained?: number;
  xpGained?: number;
  goldGained?: number;
}

interface AttackResult {
  damage: number;
  crit: boolean;
  missed: boolean;
}

function resolveAttack(atk: Stats, def: Stats, power: number, kind: 'physical' | 'magical'): AttackResult {
  const missChance = Math.min(0.25, Math.max(0.02, 0.05 + (def.luck - atk.luck) * 0.01));
  if (Math.random() < missChance) {
    return { damage: 0, crit: false, missed: true };
  }
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

interface RoundActor {
  speed: number;
  jitter: number;
  act: () => void;
}

export class BattleEngine {
  constructor(
    public player: Player,
    public enemies: Enemy[],
  ) {}

  private aliveEnemies(): Enemy[] {
    return this.enemies.filter((e) => e.isAlive());
  }

  private chooseEnemyAction(enemy: Enemy): { skill?: Skill } {
    const usable = enemy.skills.filter((s) => enemy.currentMp >= s.mpCost);
    if (usable.length > 0 && Math.random() < 0.5) {
      const skill = usable[Math.floor(Math.random() * usable.length)];
      enemy.currentMp -= skill.mpCost;
      return { skill };
    }
    return {};
  }

  resolveRound(action: PlayerAction): RoundResult {
    const entries: LogEntry[] = [];

    if (action.type === 'run') {
      const alive = this.aliveEnemies();
      const avgSpeed = alive.reduce((s, e) => s + e.stats.speed, 0) / Math.max(1, alive.length);
      const fleeChance = Math.min(0.9, Math.max(0.1, 0.5 + (this.player.stats.speed - avgSpeed) * 0.02));
      if (Math.random() < fleeChance) {
        entries.push({ actorName: this.player.name, text: 'Você fugiu da batalha!' });
        return { entries, outcome: 'fled' };
      }
      entries.push({ actorName: this.player.name, text: 'Você tentou fugir, mas não conseguiu!' });
    }

    const actors: RoundActor[] = [];

    // A failed flee attempt still forfeits the player's action this round.
    if (action.type !== 'run') {
      actors.push({
        speed: this.player.stats.speed,
        jitter: Math.random(),
        act: () => this.executePlayerAction(action, entries),
      });
    }

    for (const enemy of this.aliveEnemies()) {
      const chosen = this.chooseEnemyAction(enemy);
      actors.push({
        speed: enemy.stats.speed,
        jitter: Math.random(),
        act: () => this.executeEnemyAction(enemy, chosen.skill, entries),
      });
    }

    actors.sort((a, b) => b.speed - a.speed || b.jitter - a.jitter);

    for (const actor of actors) {
      if (!this.player.isAlive()) break;
      actor.act();
      if (!this.player.isAlive()) break;
      if (this.aliveEnemies().length === 0) break;
    }

    if (!this.player.isAlive()) {
      entries.push({ actorName: this.player.name, text: 'Você foi derrotado...' });
      return { entries, outcome: 'defeat' };
    }

    if (this.aliveEnemies().length === 0 && this.enemies.length > 0) {
      const xpGained = this.enemies.reduce((s, e) => s + e.def.xpReward, 0);
      const goldGained = this.enemies.reduce((s, e) => s + e.def.goldReward, 0);
      const levelsGained = this.player.gainXp(xpGained);
      this.player.gold += goldGained;
      entries.push({
        actorName: this.player.name,
        text: `Vitória! Ganhou ${xpGained} XP e ${goldGained} moedas de ouro.`,
      });
      if (levelsGained > 0) {
        entries.push({
          actorName: this.player.name,
          text: `${this.player.name} subiu para o nível ${this.player.level}!`,
        });
      }
      return { entries, outcome: 'victory', levelsGained, xpGained, goldGained };
    }

    return { entries, outcome: 'ongoing' };
  }

  private executePlayerAction(action: PlayerAction, entries: LogEntry[]): void {
    if (action.type === 'attack') {
      const index = action.targetIndex ?? 0;
      const enemy = this.enemies[index];
      if (!enemy || !enemy.isAlive()) return;
      const result = resolveAttack(this.player.stats, enemy.stats, 1, 'physical');
      this.applyAttackResult(this.player.name, enemy.name, result, entries, undefined, index);
      if (!result.missed) {
        const dealt = enemy.takeDamage(result.damage);
        entries[entries.length - 1].damage = dealt;
        if (!enemy.isAlive()) entries[entries.length - 1].defeated = true;
      }
      entries[entries.length - 1].targetHpAfter = enemy.currentHp;
      return;
    }

    if (action.type === 'skill' && action.skillId) {
      const skill = this.player.availableSkills.find((s) => s.id === action.skillId);
      if (!skill || !this.player.spendMp(skill.mpCost)) return;

      if (skill.kind === 'heal') {
        const healed = this.player.heal(resolveHeal(this.player.stats, skill.power));
        entries.push({
          actorName: this.player.name,
          text: `${this.player.name} usou ${skill.name} e recuperou vida.`,
          targetName: this.player.name,
          healed,
          targetHpAfter: this.player.currentHp,
        });
        return;
      }

      const targetIndexes =
        skill.target === 'allEnemies'
          ? this.enemies.map((_, i) => i).filter((i) => this.enemies[i].isAlive())
          : [action.targetIndex ?? 0];

      for (const index of targetIndexes) {
        const enemy = this.enemies[index];
        if (!enemy || !enemy.isAlive()) continue;
        const result = resolveAttack(this.player.stats, enemy.stats, skill.power, skill.kind === 'magical' ? 'magical' : 'physical');
        this.applyAttackResult(this.player.name, enemy.name, result, entries, skill.name, index);
        if (!result.missed) {
          const dealt = enemy.takeDamage(result.damage);
          entries[entries.length - 1].damage = dealt;
          if (!enemy.isAlive()) entries[entries.length - 1].defeated = true;
        }
        entries[entries.length - 1].targetHpAfter = enemy.currentHp;
      }
      return;
    }

    if (action.type === 'item' && action.itemId) {
      const result = this.player.useItem(action.itemId);
      if (!result) return;
      entries.push({
        actorName: this.player.name,
        text: `${this.player.name} usou um item.`,
        targetName: this.player.name,
        healed: result.hpRestored,
        targetHpAfter: this.player.currentHp,
      });
    }
  }

  private executeEnemyAction(enemy: Enemy, skill: Skill | undefined, entries: LogEntry[]): void {
    if (!enemy.isAlive()) return;
    const actorIndex = this.enemies.indexOf(enemy);
    const power = skill?.power ?? 1;
    const kind = skill ? (skill.kind === 'magical' ? 'magical' : 'physical') : 'physical';
    const result = resolveAttack(enemy.stats, this.player.stats, power, kind);
    this.applyAttackResult(enemy.name, this.player.name, result, entries, skill?.name, undefined, actorIndex);
    if (!result.missed) {
      const dealt = this.player.takeDamage(result.damage);
      entries[entries.length - 1].damage = dealt;
    }
    entries[entries.length - 1].targetHpAfter = this.player.currentHp;
  }

  private applyAttackResult(
    actorName: string,
    targetName: string,
    result: AttackResult,
    entries: LogEntry[],
    skillName?: string,
    targetIndex?: number,
    actorIndex?: number,
  ): void {
    const verb = skillName ? `usou ${skillName} em` : 'atacou';
    if (result.missed) {
      entries.push({
        actorName,
        targetName,
        text: `${actorName} ${verb} ${targetName}, mas errou!`,
        missed: true,
        targetIndex,
        actorIndex,
      });
      return;
    }
    const critText = result.crit ? ' (Crítico!)' : '';
    entries.push({
      actorName,
      targetName,
      text: `${actorName} ${verb} ${targetName}${critText}`,
      crit: result.crit,
      targetIndex,
      actorIndex,
    });
  }
}
