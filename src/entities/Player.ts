import { getClassById } from '../config/classes';
import { defaultAppearance, type CharacterAppearance } from '../config/customization';
import { XP_TO_LEVEL } from '../config/gameConfig';
import type { CharacterClassDefinition, EquipmentInstance, EquipmentSlot, SkillDefinition, SkillLevelStats, Stats } from '../config/types';
import { computeEquipmentBonus, createStarterItem, getEquipmentTemplate } from '../data/equipment';
import { getItemById } from '../data/items';
import { computeSkillLevelStats, skillPointsForLevel, ultimateLevelForCharacter } from '../systems/skillMath';
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
  appearance: CharacterAppearance;
  equipment: Partial<Record<EquipmentSlot, EquipmentInstance>>;
  bag: EquipmentInstance[];
  skillLevels: Record<string, number>;
  skillPoints: number;
  completedQuestIds: string[];
  activeQuestId: string | null;
  questProgress: Record<string, number>;
}

const MAX_BAG_SIZE = 40;

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
  appearance: CharacterAppearance;
  equipment: Partial<Record<EquipmentSlot, EquipmentInstance>>;
  bag: EquipmentInstance[];
  skillLevels: Record<string, number>;
  skillPoints: number;
  completedQuestIds: string[];
  activeQuestId: string | null;
  questProgress: Record<string, number>;

  private constructor(name: string, classId: string, data?: Partial<PlayerSaveData>) {
    this.name = name;
    this.classId = classId;
    this.level = data?.level ?? 1;
    this.xp = data?.xp ?? 0;
    this.gold = data?.gold ?? 30;
    this.inventory = data?.inventory ?? { potion_hp: 3, potion_mp: 2 };
    this.mapX = data?.mapX ?? 6;
    this.mapY = data?.mapY ?? 6;
    const classDef = getClassById(classId);
    this.appearance = data?.appearance ?? defaultAppearance(classDef.color, classDef.accentColor);
    this.equipment = data?.equipment ?? {};
    this.bag = data?.bag ?? [];
    this.skillLevels = data?.skillLevels ?? {};
    this.skillPoints = data?.skillPoints ?? 0;
    this.completedQuestIds = data?.completedQuestIds ?? [];
    this.activeQuestId = data?.activeQuestId ?? null;
    this.questProgress = data?.questProgress ?? {};
    this.currentHp = data?.currentHp ?? this.stats.maxHp;
    this.currentMp = data?.currentMp ?? this.stats.maxMp;
  }

  static createNew(name: string, classId: string): Player {
    const player = new Player(name, classId);
    const starterWeapon = STARTER_WEAPON[classId];
    if (starterWeapon) player.equipment.arma = createStarterItem(starterWeapon, 'verde', 1);
    return player;
  }

  static fromSaveData(data: PlayerSaveData): Player {
    return new Player(data.name, data.classId, data);
  }

  get classDef(): CharacterClassDefinition {
    return getClassById(this.classId);
  }

  /** Base class stats for this level, plus flat bonuses from equipped gear. */
  get stats(): Stats {
    const base = computeStatsAtLevel(this.classDef.baseStats, this.classDef.growth, this.level);
    const withGear = { ...base };
    for (const instance of Object.values(this.equipment)) {
      if (!instance) continue;
      const bonus = computeEquipmentBonus(instance);
      for (const [stat, value] of Object.entries(bonus) as Array<[keyof Stats, number]>) {
        withGear[stat] += value;
      }
    }
    return withGear;
  }

  get mpRegenPerSecond(): number {
    return Math.max(1, this.stats.maxMp * 0.045);
  }

  get xpToNextLevel(): number {
    return XP_TO_LEVEL(this.level);
  }

  /** All skills whose unlock level has been reached, each paired with its current level. */
  get unlockedSkills(): Array<{ skill: SkillDefinition; level: number }> {
    return this.classDef.skills
      .filter((s) => this.level >= s.unlockLevel)
      .map((skill) => ({ skill, level: this.skillLevel(skill.id) }));
  }

  skillLevel(skillId: string): number {
    const skill = this.classDef.skills.find((s) => s.id === skillId);
    if (!skill) return 0;
    if (skill.isUltimate) return ultimateLevelForCharacter(this.level);
    return this.skillLevels[skillId] ?? 1;
  }

  skillLevelStats(skillId: string): SkillLevelStats | null {
    const skill = this.classDef.skills.find((s) => s.id === skillId) ?? (skillId === this.classDef.basicAttack.id ? this.classDef.basicAttack : null);
    if (!skill) return null;
    const level = skill.id === this.classDef.basicAttack.id ? 1 : this.skillLevel(skillId);
    return computeSkillLevelStats(skill, level);
  }

  /** Spends one skill point to raise a regular (non-ultimate) skill by one level. */
  upgradeSkill(skillId: string): boolean {
    const skill = this.classDef.skills.find((s) => s.id === skillId);
    if (!skill || skill.isUltimate) return false;
    if (this.level < skill.unlockLevel) return false;
    if (this.skillPoints <= 0) return false;
    const current = this.skillLevel(skillId);
    if (current >= skill.maxLevel) return false;
    this.skillLevels[skillId] = current + 1;
    this.skillPoints -= 1;
    return true;
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

  regenMp(dt: number): void {
    this.restoreMp(this.mpRegenPerSecond * dt);
  }

  /** Applies XP gain, resolving as many level-ups as the XP allows. Returns levels gained. */
  gainXp(amount: number): number {
    this.xp += amount;
    let levelsGained = 0;
    while (this.xp >= this.xpToNextLevel) {
      this.xp -= this.xpToNextLevel;
      this.level += 1;
      levelsGained += 1;
      this.skillPoints += skillPointsForLevel(this.level);
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

  addLoot(instance: EquipmentInstance): boolean {
    if (this.bag.length >= MAX_BAG_SIZE) return false;
    this.bag.push(instance);
    return true;
  }

  equipFromBag(uid: string): boolean {
    const index = this.bag.findIndex((i) => i.uid === uid);
    if (index === -1) return false;
    const [instance] = this.bag.splice(index, 1);
    const slot = getSlotOf(instance);
    const previous = this.equipment[slot];
    this.equipment[slot] = instance;
    if (previous) this.bag.push(previous);
    return true;
  }

  unequip(slot: EquipmentSlot): boolean {
    const instance = this.equipment[slot];
    if (!instance) return false;
    delete this.equipment[slot];
    this.bag.push(instance);
    return true;
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
      appearance: { ...this.appearance },
      equipment: { ...this.equipment },
      bag: [...this.bag],
      skillLevels: { ...this.skillLevels },
      skillPoints: this.skillPoints,
      completedQuestIds: [...this.completedQuestIds],
      activeQuestId: this.activeQuestId,
      questProgress: { ...this.questProgress },
    };
  }
}

function getSlotOf(instance: EquipmentInstance): EquipmentSlot {
  return getEquipmentTemplate(instance.templateId).slot;
}

const STARTER_WEAPON: Record<string, string> = {
  warrior: 'espada_curta',
  mage: 'cajado_arcano',
  archer: 'arco_longo',
  cleric: 'martelo_sagrado',
  paladin: 'machado_guerra',
  assassin: 'adaga_sombria',
  necromancer: 'grimorio_amaldicoado',
  monk: 'manoplas_combate',
};
