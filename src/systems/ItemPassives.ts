import type { EquipmentInstance, EquipmentSlot, Stats } from '../config/types';
import { addModifiers, affixModifiers, capModifiers, describeAffix, emptyModifiers, type ItemModifiers } from '../data/affixes';
import { getEquipmentTemplate } from '../data/equipment';
import {
  getItemPassive,
  getSetDefinition,
  SET_DEFINITIONS,
  type PassiveCondition,
  type PassiveEffect,
  type PassiveTrigger,
  type SetBonus,
  type SetDefinition,
  type TriggerEvent,
} from '../data/uniques';

export type EquippedGear = Partial<Record<EquipmentSlot, EquipmentInstance>>;

/** The moment-to-moment state passive conditions are checked against; fractions are 0..1. */
export interface PassiveContext {
  hpFraction: number;
  mpFraction: number;
  mechanicId?: string;
  meterFraction: number;
  comboHits: number;
  targetHpFraction?: number;
  enemiesAlive: number;
}

export interface ResolvedItemEffects {
  mods: ItemModifiers;
  /** Additive stat fractions (0.2 = +20%) from conditional effects. */
  statMult: Partial<Record<keyof Stats, number>>;
}

export function conditionHolds(cond: PassiveCondition | undefined, ctx: PassiveContext): boolean {
  if (!cond) return true;
  if (cond.hpBelow !== undefined && !(ctx.hpFraction < cond.hpBelow)) return false;
  if (cond.hpAbove !== undefined && !(ctx.hpFraction > cond.hpAbove)) return false;
  if (cond.mpBelow !== undefined && !(ctx.mpFraction < cond.mpBelow)) return false;
  if (cond.mpAbove !== undefined && !(ctx.mpFraction > cond.mpAbove)) return false;
  if (cond.mechanic !== undefined && ctx.mechanicId !== cond.mechanic) return false;
  if (cond.meterAtLeast !== undefined && !(ctx.meterFraction >= cond.meterAtLeast)) return false;
  if (cond.comboAtLeast !== undefined && ctx.comboHits < cond.comboAtLeast) return false;
  if (cond.targetHpBelow !== undefined && !(ctx.targetHpFraction !== undefined && ctx.targetHpFraction < cond.targetHpBelow)) return false;
  if (cond.minEnemies !== undefined && ctx.enemiesAlive < cond.minEnemies) return false;
  return true;
}

function equippedList(gear: EquippedGear): EquipmentInstance[] {
  return Object.values(gear).filter((i): i is EquipmentInstance => !!i);
}

/** Equipped pieces per set id, counting each distinct piece once. */
export function setPieceCounts(gear: EquippedGear): Record<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const instance of equippedList(gear)) {
    const setId = getEquipmentTemplate(instance.templateId).setId;
    if (!setId) continue;
    const pieces = seen.get(setId) ?? new Set<string>();
    pieces.add(instance.templateId);
    seen.set(setId, pieces);
  }
  const counts: Record<string, number> = {};
  for (const [setId, pieces] of seen) counts[setId] = pieces.size;
  return counts;
}

export interface ActiveSetBonus {
  set: SetDefinition;
  bonus: SetBonus;
}

export function activeSetBonuses(gear: EquippedGear): ActiveSetBonus[] {
  const counts = setPieceCounts(gear);
  const active: ActiveSetBonus[] = [];
  for (const set of SET_DEFINITIONS) {
    const owned = counts[set.id] ?? 0;
    for (const bonus of set.bonuses) {
      if (owned >= bonus.pieces) active.push({ set, bonus });
    }
  }
  return active;
}

/** Flat stat bonuses granted by active set bonuses — folded into `Player.stats`. */
export function setStatBonus(gear: EquippedGear): Partial<Stats> {
  const total: Partial<Stats> = {};
  for (const { bonus } of activeSetBonuses(gear)) {
    for (const [stat, value] of Object.entries(bonus.stats ?? {}) as Array<[keyof Stats, number]>) {
      total[stat] = (total[stat] ?? 0) + value;
    }
  }
  return total;
}

function passiveSources(gear: EquippedGear): { effects: PassiveEffect[]; triggers: PassiveTrigger[] } {
  const effects: PassiveEffect[] = [];
  const triggers: PassiveTrigger[] = [];
  for (const instance of equippedList(gear)) {
    const passiveId = getEquipmentTemplate(instance.templateId).passiveId;
    const passive = passiveId ? getItemPassive(passiveId) : undefined;
    if (!passive) continue;
    effects.push(...passive.effects);
    triggers.push(...(passive.triggers ?? []));
  }
  for (const { bonus } of activeSetBonuses(gear)) {
    effects.push(...(bonus.effects ?? []));
    triggers.push(...(bonus.triggers ?? []));
  }
  return { effects, triggers };
}

/** The one evaluation step for what gear does beyond flat stats: affix modifiers (always on), unique passives and set bonuses (while their condition holds). */
export function resolveItemEffects(gear: EquippedGear, ctx: PassiveContext): ResolvedItemEffects {
  const mods = emptyModifiers();
  const statMult: Partial<Record<keyof Stats, number>> = {};
  for (const instance of equippedList(gear)) addModifiers(mods, affixModifiers(instance.affixes));
  for (const effect of passiveSources(gear).effects) {
    if (!conditionHolds(effect.when, ctx)) continue;
    if (effect.mods) addModifiers(mods, effect.mods);
    for (const [stat, value] of Object.entries(effect.statMult ?? {}) as Array<[keyof Stats, number]>) {
      statMult[stat] = (statMult[stat] ?? 0) + value;
    }
  }
  return { mods: capModifiers(mods), statMult };
}

/** Triggers of equipped passives and active set bonuses that fire for `on` right now (condition met, chance rolled). */
export function collectTriggers(gear: EquippedGear, on: TriggerEvent, ctx: PassiveContext, rng: () => number = Math.random): PassiveTrigger[] {
  return passiveSources(gear).triggers.filter((t) => {
    if (t.on !== on || !conditionHolds(t.when, ctx)) return false;
    return t.chance === undefined || t.chance >= 1 || rng() < t.chance;
  });
}

export interface ItemDescription {
  affixLines: string[];
  passive?: { name: string; description: string };
  set?: {
    name: string;
    owned: number;
    total: number;
    pieces: Array<{ name: string; owned: boolean }>;
    bonuses: Array<{ pieces: number; description: string; active: boolean }>;
  };
}

/** What an item card shows beyond its stat line. Set progress counts `instance` as equipped, so a bag item reads "what I'd have after equipping it". */
export function describeItem(instance: EquipmentInstance, gear: EquippedGear): ItemDescription {
  const template = getEquipmentTemplate(instance.templateId);
  const description: ItemDescription = {
    affixLines: (instance.affixes ?? []).map(describeAffix).filter((line): line is string => line !== null),
  };

  const passive = template.passiveId ? getItemPassive(template.passiveId) : undefined;
  if (passive) description.passive = { name: passive.name, description: passive.description };

  const set = template.setId ? getSetDefinition(template.setId) : undefined;
  if (set) {
    const withItem: EquippedGear = { ...gear, [template.slot]: instance };
    const owned = setPieceCounts(withItem)[set.id] ?? 0;
    const equippedIds = new Set(equippedList(withItem).map((i) => i.templateId));
    description.set = {
      name: set.name,
      owned,
      total: set.pieces.length,
      pieces: set.pieces.map((id) => ({ name: getEquipmentTemplate(id).name, owned: equippedIds.has(id) })),
      bonuses: set.bonuses.map((b) => ({ pieces: b.pieces, description: b.description, active: owned >= b.pieces })),
    };
  }
  return description;
}
