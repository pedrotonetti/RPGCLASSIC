import type { EnemyDefinition, SkillDefinition, Stats } from '../config/types';
import { getEnemyById } from '../data/enemies';

/** A single enemy instance within one battle. Enemies don't persist between battles. */
export class Enemy {
  definitionId: string;
  currentHp: number;
  currentMp: number;
  /** Real-time AI clock: counts down to the enemy's next action. */
  actionTimer: number;

  constructor(definitionId: string) {
    this.definitionId = definitionId;
    this.currentHp = this.stats.maxHp;
    this.currentMp = this.stats.maxMp;
    // Stagger initial actions a little so multiple enemies don't act in lockstep.
    this.actionTimer = this.def.actionInterval * (0.4 + Math.random() * 0.6);
  }

  get def(): EnemyDefinition {
    return getEnemyById(this.definitionId);
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
