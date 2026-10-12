import { RARITY_SCORE_MULTIPLIER } from '../config/rarity';
import type { EquipmentInstance, EquipmentSlot, Stats } from '../config/types';
import { describeAffix } from '../data/affixes';
import { computeEquipmentBonus, getEquipmentTemplate } from '../data/equipment';
import { getItemPassive } from '../data/uniques';
import { activeSetBonuses, setStatBonus, type EquippedGear } from './ItemPassives';

/**
 * "What changes if I equip this?" — pure data, no DOM, so the inventory's
 * comparison tooltip/sheet (ui/itemComparePanel.ts) only formats what this
 * returns. Stat deltas are computed over the WHOLE equipped set before vs.
 * after the swap, so a set bonus switching on/off (setStatBonus) is folded
 * into the same numbers the player's sheet will actually show, not just
 * the two items' own stat lines side by side.
 */

/** Display order + pt-BR abbreviation for each stat — same abbreviations the inventory's own item stat line uses. */
export const STAT_ORDER: Array<keyof Stats> = ['maxHp', 'maxMp', 'attack', 'magicAttack', 'defense', 'magicDefense', 'speed', 'luck'];
export const STAT_ABBREV: Record<keyof Stats, string> = {
  maxHp: 'HP',
  maxMp: 'MP',
  attack: 'ATQ',
  magicAttack: 'MAG',
  defense: 'DEF',
  magicDefense: 'RES',
  speed: 'VEL',
  luck: 'SOR',
};

export interface StatDelta {
  stat: keyof Stats;
  label: string;
  /** Total from all equipped gear (items + active set stat bonuses) right now. */
  current: number;
  /** Same total after swapping the candidate in. */
  next: number;
  delta: number;
}

export interface PassiveSummary {
  name: string;
  description: string;
}

export type ComparisonVerdict = 'empty' | 'upgrade' | 'downgrade' | 'sidegrade';

export interface ItemComparison {
  slot: EquipmentSlot;
  candidate: EquipmentInstance;
  equipped: EquipmentInstance | null;
  /** Only stats that either side touches — zero-on-both-sides rows are left out. */
  stats: StatDelta[];
  /** Same rarity×level weighting PowerScore's gear contribution uses. */
  powerDelta: number;
  verdict: ComparisonVerdict;
  affixesGained: string[];
  affixesLost: string[];
  /** Unique power the candidate brings that the equipped item doesn't (null when both carry the same one). */
  passiveGained: PassiveSummary | null;
  passiveLost: PassiveSummary | null;
  /** Set-bonus descriptions that would switch on / off, prefixed with the set name. */
  setBonusesGained: string[];
  setBonusesLost: string[];
}

/** Rounds away floating-point noise (stat bonuses are tenths). */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Sum of every equipped item's own bonus plus active set stat bonuses. */
export function totalGearStats(gear: EquippedGear): Partial<Stats> {
  const total: Partial<Stats> = {};
  const add = (bonus: Partial<Stats>) => {
    for (const [stat, value] of Object.entries(bonus) as Array<[keyof Stats, number]>) {
      total[stat] = (total[stat] ?? 0) + value;
    }
  };
  for (const instance of Object.values(gear)) if (instance) add(computeEquipmentBonus(instance));
  add(setStatBonus(gear));
  return total;
}

export function itemPower(instance: EquipmentInstance): number {
  return RARITY_SCORE_MULTIPLIER[instance.rarity] * instance.itemLevel;
}

/** |powerDelta| below this reads as "equivalente" rather than a real up/downgrade. */
export const SIDEGRADE_THRESHOLD = 0.5;

function passiveOf(instance: EquipmentInstance | null): (PassiveSummary & { id: string }) | null {
  if (!instance) return null;
  const id = getEquipmentTemplate(instance.templateId).passiveId;
  const passive = id ? getItemPassive(id) : undefined;
  return passive ? { id: passive.id, name: passive.name, description: passive.description } : null;
}

function affixLines(instance: EquipmentInstance | null): string[] {
  return (instance?.affixes ?? []).map(describeAffix).filter((line): line is string => line !== null);
}

/** Multiset difference: each line in `a` not matched by an equal line in `b` (so two identical affixes on one side still count twice). */
function linesMissingFrom(a: string[], b: string[]): string[] {
  const pool = [...b];
  const out: string[] = [];
  for (const line of a) {
    const i = pool.indexOf(line);
    if (i === -1) out.push(line);
    else pool.splice(i, 1);
  }
  return out;
}

function setBonusKeys(gear: EquippedGear): Map<string, string> {
  const keys = new Map<string, string>();
  for (const { set, bonus } of activeSetBonuses(gear)) keys.set(`${set.id}:${bonus.pieces}`, `${set.name} (${bonus.pieces}): ${bonus.description}`);
  return keys;
}

/** Compares `candidate` against whatever `gear` currently holds in the candidate's slot. */
export function compareItems(candidate: EquipmentInstance, gear: EquippedGear): ItemComparison {
  const slot = getEquipmentTemplate(candidate.templateId).slot;
  const equipped = gear[slot] ?? null;
  const after: EquippedGear = { ...gear, [slot]: candidate };

  const before = totalGearStats(gear);
  const next = totalGearStats(after);
  const stats: StatDelta[] = [];
  for (const stat of STAT_ORDER) {
    const a = before[stat] ?? 0;
    const b = next[stat] ?? 0;
    if (a === 0 && b === 0) continue;
    stats.push({ stat, label: STAT_ABBREV[stat], current: round1(a), next: round1(b), delta: round1(b - a) });
  }

  const powerDelta = round1(itemPower(candidate) - (equipped ? itemPower(equipped) : 0));
  let verdict: ComparisonVerdict;
  if (!equipped) verdict = 'empty';
  else if (Math.abs(powerDelta) < SIDEGRADE_THRESHOLD) verdict = 'sidegrade';
  else verdict = powerDelta > 0 ? 'upgrade' : 'downgrade';

  const candAffixes = affixLines(candidate);
  const eqAffixes = affixLines(equipped);

  const candPassive = passiveOf(candidate);
  const eqPassive = passiveOf(equipped);
  const samePassive = candPassive?.id !== undefined && candPassive.id === eqPassive?.id;
  const strip = (p: (PassiveSummary & { id: string }) | null): PassiveSummary | null => (p ? { name: p.name, description: p.description } : null);

  const setsBefore = setBonusKeys(gear);
  const setsAfter = setBonusKeys(after);

  return {
    slot,
    candidate,
    equipped,
    stats,
    powerDelta,
    verdict,
    affixesGained: linesMissingFrom(candAffixes, eqAffixes),
    affixesLost: linesMissingFrom(eqAffixes, candAffixes),
    passiveGained: samePassive ? null : strip(candPassive),
    passiveLost: samePassive ? null : strip(eqPassive),
    setBonusesGained: [...setsAfter].filter(([k]) => !setsBefore.has(k)).map(([, v]) => v),
    setBonusesLost: [...setsBefore].filter(([k]) => !setsAfter.has(k)).map(([, v]) => v),
  };
}

/** "+3", "-1,5", "0" — pt-BR decimal comma, explicit sign for gains. */
export function formatDelta(value: number): string {
  const rounded = round1(value);
  const text = Number.isInteger(rounded) ? String(Math.abs(rounded)) : Math.abs(rounded).toFixed(1).replace('.', ',');
  if (rounded > 0) return `+${text}`;
  if (rounded < 0) return `-${text}`;
  return '0';
}
