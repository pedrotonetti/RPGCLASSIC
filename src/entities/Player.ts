import { getClassById } from '../config/classes';
import { defaultAppearance, type CharacterAppearance } from '../config/customization';
import { XP_TO_LEVEL } from '../config/gameConfig';
import type { CharacterClassDefinition, EquipmentInstance, EquipmentSlot, SkillDefinition, SkillLevelStats, Stats } from '../config/types';
import { computeEquipmentBonus, createStarterItem, getEquipmentTemplate } from '../data/equipment';
import { getItemById } from '../data/items';
import { computeSkillLevelStats, skillPointsForLevel, ultimateLevelForCharacter } from '../systems/skillMath';
import { arriveWorldPosition, getZoneById, MAIN_CITY_ID, startZoneForClass } from '../data/zones';
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
  /** Which zone (main city, or a class's starting/secondary village) mapX/mapY are relative to. */
  zoneId: string;
  appearance: CharacterAppearance;
  equipment: Partial<Record<EquipmentSlot, EquipmentInstance>>;
  bag: EquipmentInstance[];
  skillLevels: Record<string, number>;
  skillPoints: number;
  completedQuestIds: string[];
  activeQuestId: string | null;
  questProgress: Record<string, number>;
  unlockedMounts: string[];
  activeMountId: string | null;
  /** Which of Ato 3's three branching endings (see LORE.md) the player chose — null until OverworldScreen's Act3ChoiceOverlay resolves one. Also doubles as "has the player finished the main story" for anything that should only apply post-ending. */
  act3Ending: Act3Ending | null;
  /** Whether this character has already dismissed OverworldScreen's first-time tutorial overlay — false only for a brand-new character, never reset afterward. */
  hasSeenTutorial: boolean;
  /**
   * Best-cleared repeatable-dungeon tier per `DungeonDefinition.id`, keyed
   * only for dungeons cleared at least once (absent/0 = never cleared, so a
   * fresh dungeon's portal keeps behaving exactly like a first-time visit).
   * See `systems/DungeonTierSystem.ts` for the tier-scaling math and
   * `DungeonSystem.completeDungeon` for where this gets bumped.
   */
  dungeonTiers: Record<string, number>;
}

/** The three closures Ato 3 branches into — see LORE.md's "O final". */
export type Act3Ending = 'corte' | 'cura' | 'abraco';

const MAX_BAG_SIZE = 40;

export class Player {
  name: string;
  classId: string;
  level = 1;
  xp = 0;
  gold = 30;
  currentHp: number;
  currentMp: number;
  /** Sub-1 leftover from each regen tick — restoreMp()/heal() only take whole numbers, so a tiny per-frame amount (a fraction of 1 HP/MP) would otherwise round down to nothing every single frame and never actually regenerate. */
  private hpRegenAccumulator = 0;
  private mpRegenAccumulator = 0;
  inventory: Record<string, number>;
  /** Continuous overworld world-space position (units, not tile indices) — free movement, not grid-snapped. */
  mapX: number;
  mapY: number;
  zoneId: string;
  appearance: CharacterAppearance;
  equipment: Partial<Record<EquipmentSlot, EquipmentInstance>>;
  bag: EquipmentInstance[];
  skillLevels: Record<string, number>;
  skillPoints: number;
  completedQuestIds: string[];
  activeQuestId: string | null;
  questProgress: Record<string, number>;
  unlockedMounts: string[];
  activeMountId: string | null;
  act3Ending: Act3Ending | null;
  hasSeenTutorial: boolean;
  dungeonTiers: Record<string, number>;
  /**
   * Session-only "enter the next dungeon at this tier" hand-off — set by
   * OverworldScreen.enterDungeon just before swapping to the dungeon's own
   * instance zone, read (and reset back to 1) once by that new screen's
   * mount(). Deliberately NOT part of PlayerSaveData: it only needs to
   * survive the one screen swap between picking a tier and that zone
   * actually mounting, never a save/reload.
   */
  pendingDungeonTier = 1;

  private constructor(name: string, classId: string, data?: Partial<PlayerSaveData>) {
    this.name = name;
    this.classId = classId;
    this.level = data?.level ?? 1;
    this.xp = data?.xp ?? 0;
    this.gold = data?.gold ?? 30;
    this.inventory = data?.inventory ?? { potion_hp: 3, potion_mp: 2 };
    // World-space center of the starting tile (5,5) at TILE_SIZE=2 — kept as
    // a literal instead of importing MapGenerator/gameConfig here, matching
    // this file's existing style of not depending on world-layout modules.
    this.mapX = data?.mapX ?? 11;
    this.mapY = data?.mapY ?? 11;
    this.zoneId = data?.zoneId ?? MAIN_CITY_ID;
    const classDef = getClassById(classId);
    this.appearance = data?.appearance ?? defaultAppearance(classDef.color, classDef.accentColor);
    this.equipment = data?.equipment ?? {};
    this.bag = data?.bag ?? [];
    this.skillLevels = data?.skillLevels ?? {};
    this.skillPoints = data?.skillPoints ?? 0;
    this.completedQuestIds = data?.completedQuestIds ?? [];
    this.activeQuestId = data?.activeQuestId ?? null;
    this.questProgress = data?.questProgress ?? {};
    // Both mounts are unlocked by default in this build (see data/mounts.ts).
    this.unlockedMounts = data?.unlockedMounts ?? ['llama', 'condor'];
    this.activeMountId = data?.activeMountId ?? null;
    this.act3Ending = data?.act3Ending ?? null;
    this.hasSeenTutorial = data?.hasSeenTutorial ?? false;
    this.dungeonTiers = data?.dungeonTiers ?? {};
    this.currentHp = data?.currentHp ?? this.stats.maxHp;
    this.currentMp = data?.currentMp ?? this.stats.maxMp;
  }

  static createNew(name: string, classId: string): Player {
    const player = new Player(name, classId);
    const starterWeapon = STARTER_WEAPON[classId];
    if (starterWeapon) player.equipment.arma = createStarterItem(starterWeapon, 'verde', 1);

    // Every class starts in its own village, not the shared main city.
    player.zoneId = startZoneForClass(classId);
    const spawn = arriveWorldPosition(getZoneById(player.zoneId).generate().playerStart);
    player.mapX = spawn.x;
    player.mapY = spawn.z;

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

  get hpRegenPerSecond(): number {
    return Math.max(0.5, this.stats.maxHp * 0.02);
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
    this.mpRegenAccumulator += this.mpRegenPerSecond * dt;
    const whole = Math.floor(this.mpRegenAccumulator);
    if (whole > 0) {
      this.mpRegenAccumulator -= whole;
      this.restoreMp(whole);
    }
  }

  /** Passive HP regen — only meant to be ticked while out of combat (see OverworldScreen); in-fight recovery goes through heal() via potions/skills instead. */
  regenHp(dt: number): void {
    if (!this.isAlive()) return;
    this.hpRegenAccumulator += this.hpRegenPerSecond * dt;
    const whole = Math.floor(this.hpRegenAccumulator);
    if (whole > 0) {
      this.hpRegenAccumulator -= whole;
      this.heal(whole);
    }
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

  get bagFull(): boolean {
    return this.bag.length >= MAX_BAG_SIZE;
  }

  addLoot(instance: EquipmentInstance): boolean {
    if (this.bagFull) return false;
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

  setMount(mountId: string | null): boolean {
    if (mountId !== null && !this.unlockedMounts.includes(mountId)) return false;
    this.activeMountId = mountId;
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
      zoneId: this.zoneId,
      appearance: { ...this.appearance },
      equipment: { ...this.equipment },
      bag: [...this.bag],
      skillLevels: { ...this.skillLevels },
      skillPoints: this.skillPoints,
      completedQuestIds: [...this.completedQuestIds],
      activeQuestId: this.activeQuestId,
      questProgress: { ...this.questProgress },
      unlockedMounts: [...this.unlockedMounts],
      activeMountId: this.activeMountId,
      act3Ending: this.act3Ending,
      hasSeenTutorial: this.hasSeenTutorial,
      dungeonTiers: { ...this.dungeonTiers },
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
