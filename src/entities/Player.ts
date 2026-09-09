import { getClassById } from '../config/classes';
import { XP_TO_LEVEL } from '../config/gameConfig';
import type { CharacterClassDefinition, Skill, Stats } from '../config/types';
import { getItemById } from '../data/items';
import { computeStatsAtLevel } from './statMath';

export interface PlayerSaveData {
  name: string;
  classId: string;
  level: number;
  xp: number;
  gold: number;
  currentHp: number;
  currentMp: number;
  inventory: Record<string, number>;
  mapX: number;
  mapY: number;
}

export class Player {
  name: string;
  classId: string;
  level = 1;
  xp = 0;
  gold = 30;
  currentHp: number;
  currentMp: number;
  inventory: Record<string, number>;
  /** Overworld tile position, persisted across saves. */
  mapX: number;
  mapY: number;

  private constructor(name: string, classId: string, data?: Partial<PlayerSaveData>) {
    this.name = name;
    this.classId = classId;
    this.level = data?.level ?? 1;
    this.xp = data?.xp ?? 0;
    this.gold = data?.gold ?? 30;
    this.inventory = data?.inventory ?? { potion_hp: 3, potion_mp: 2 };
    this.mapX = data?.mapX ?? 6;
    this.mapY = data?.mapY ?? 6;
    this.currentHp = data?.currentHp ?? this.stats.maxHp;
    this.currentMp = data?.currentMp ?? this.stats.maxMp;
  }

  static createNew(name: string, classId: string): Player {
    return new Player(name, classId);
  }

  static fromSaveData(data: PlayerSaveData): Player {
    return new Player(data.name, data.classId, data);
  }

  get classDef(): CharacterClassDefinition {
    return getClassById(this.classId);
  }

  get stats(): Stats {
    return computeStatsAtLevel(this.classDef.baseStats, this.classDef.growth, this.level);
  }

  get availableSkills(): Skill[] {
    return this.classDef.skills.filter((s) => s.unlockLevel <= this.level);
  }

  get xpToNextLevel(): number {
    return XP_TO_LEVEL(this.level);
  }

  isAlive(): boolean {
    return this.currentHp > 0;
  }

  takeDamage(amount: number): number {
    const dmg = Math.max(0, Math.round(amount));
    this.currentHp = Math.max(0, this.currentHp - dmg);
    return dmg;
  }

  heal(amount: number): number {
    const before = this.currentHp;
    this.currentHp = Math.min(this.stats.maxHp, this.currentHp + Math.max(0, Math.round(amount)));
    return this.currentHp - before;
  }

  spendMp(amount: number): boolean {
    if (this.currentMp < amount) return false;
    this.currentMp -= amount;
    return true;
  }

  restoreMp(amount: number): number {
    const before = this.currentMp;
    this.currentMp = Math.min(this.stats.maxMp, this.currentMp + Math.max(0, Math.round(amount)));
    return this.currentMp - before;
  }

  /** Applies XP gain, resolving as many level-ups as the XP allows. Returns levels gained. */
  gainXp(amount: number): number {
    this.xp += amount;
    let levelsGained = 0;
    while (this.xp >= this.xpToNextLevel) {
      this.xp -= this.xpToNextLevel;
      this.level += 1;
      levelsGained += 1;
      // Fully restore HP/MP on level up as a small reward.
      this.currentHp = this.stats.maxHp;
      this.currentMp = this.stats.maxMp;
    }
    return levelsGained;
  }

  addItem(itemId: string, qty = 1): void {
    this.inventory[itemId] = (this.inventory[itemId] ?? 0) + qty;
  }

  /** Consumes one unit of the item and applies its effect. Returns false if unavailable. */
  useItem(itemId: string): { hpRestored: number; mpRestored: number } | null {
    const count = this.inventory[itemId] ?? 0;
    if (count <= 0) return null;
    const item = getItemById(itemId);
    const hpRestored = item.healHp > 0 ? this.heal(item.healHp) : 0;
    const mpRestored = item.healMp > 0 ? this.restoreMp(item.healMp) : 0;
    this.inventory[itemId] = count - 1;
    if (this.inventory[itemId] === 0) delete this.inventory[itemId];
    return { hpRestored, mpRestored };
  }

  toSaveData(): PlayerSaveData {
    return {
      name: this.name,
      classId: this.classId,
      level: this.level,
      xp: this.xp,
      gold: this.gold,
      currentHp: this.currentHp,
      currentMp: this.currentMp,
      inventory: { ...this.inventory },
      mapX: this.mapX,
      mapY: this.mapY,
    };
  }
}
