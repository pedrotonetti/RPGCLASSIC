/**
 * Encantamento e aprimoramento — os sumidouros de ouro do fim de jogo.
 *
 * Encantar: troca UM afixo do item por um novo sorteio (da mesma tabela de
 * `data/affixes.ts`, válido para o slot). O primeiro encantamento escolhe
 * qual afixo; dali em diante só aquele pode ser reencantado e os outros
 * ficam travados. Cada tentativa encarece a próxima (`enchantCount` fica
 * gravado no item). O poder de um item único (sua passiva) nunca entra no
 * sorteio — só os afixos extras dele, e a um custo maior.
 *
 * Aprimorar: +1 de nível do item (que já escala os atributos base em
 * `computeEquipmentBonus`), até um teto por item, com custo crescente.
 */
import { rarityTier } from '../config/rarity';
import type { EquipmentInstance, ItemAffix } from '../config/types';
import { AFFIXES, rollAffixValue, type AffixDefinition } from '../data/affixes';
import { getEquipmentTemplate } from '../data/equipment';
import { payCost, type Purse, type WorkshopCost, costShortfall } from './CraftingSystem';
import { ESSENCE_MATERIAL_ID, SALVAGE_BASE_MATERIAL } from './SalvageSystem';

/** Indexed by rarity tier (Comum..Mítico). */
const RARITY_COST_MULT = [1, 1, 1.5, 2.2, 3];
/** Uniques are rarer to replace, so working them costs more. */
const UNIQUE_COST_MULT = 1.5;
/** Growth of the enchant bill per earlier attempt on the same item; the exponent stops growing here so the price stays finite. */
const ENCHANT_GROWTH = 1.35;
const ENCHANT_GROWTH_CAP = 12;

export const MAX_UPGRADE_LEVEL = 5;
export const UNIQUE_MAX_UPGRADE_LEVEL = 3;

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function enchantCountOf(instance: EquipmentInstance): number {
  return count(instance.enchantCount);
}

export function upgradeLevelOf(instance: EquipmentInstance): number {
  return count(instance.upgradeLevel);
}

export function isUniqueItem(instance: EquipmentInstance): boolean {
  return Boolean(getEquipmentTemplate(instance.templateId).passiveId);
}

function costMultiplier(instance: EquipmentInstance): number {
  const tier = Math.max(0, rarityTier(instance.rarity));
  return RARITY_COST_MULT[tier] * (isUniqueItem(instance) ? UNIQUE_COST_MULT : 1);
}

// --- encantar ---------------------------------------------------------------

/** The affix index locked in by the first enchant, or null while the player can still choose any. Ignores a stale index past the end. */
export function lockedAffixIndex(instance: EquipmentInstance): number | null {
  const idx = instance.enchantedAffixIndex;
  const len = instance.affixes?.length ?? 0;
  return typeof idx === 'number' && Number.isInteger(idx) && idx >= 0 && idx < len ? idx : null;
}

/** Which affix indices the bench will reroll right now. */
export function enchantableIndices(instance: EquipmentInstance): number[] {
  const len = instance.affixes?.length ?? 0;
  const locked = lockedAffixIndex(instance);
  if (locked !== null) return [locked];
  return Array.from({ length: len }, (_, i) => i);
}

export function enchantCost(instance: EquipmentInstance): WorkshopCost {
  const n = enchantCountOf(instance);
  const level = Math.max(1, instance.itemLevel);
  const gold = Math.round((20 + 5 * level) * costMultiplier(instance) * ENCHANT_GROWTH ** Math.min(n, ENCHANT_GROWTH_CAP));
  const materials = [{ materialId: 'mat_arcane_shard', qty: Math.min(6, 1 + Math.floor(n / 2)) }];
  if (rarityTier(instance.rarity) >= rarityTier('amarelo')) materials.push({ materialId: ESSENCE_MATERIAL_ID, qty: 1 });
  return { gold, materials };
}

export type EnchantFailure = 'noAffixes' | 'locked' | 'invalidIndex' | 'gold' | 'materials' | 'noOptions';

export const ENCHANT_FAILURE_TEXT: Record<EnchantFailure, string> = {
  noAffixes: 'Este item não tem afixos para encantar.',
  locked: 'Só o afixo já encantado pode ser reencantado.',
  invalidIndex: 'Afixo inválido.',
  gold: 'Ouro insuficiente.',
  materials: 'Materiais insuficientes.',
  noOptions: 'Nenhum afixo alternativo cabe neste item.',
};

/** Affixes the reroll may land on: valid for the slot and not already on the item elsewhere (the current one may come back with a new value). Same kind (prefixo/sufixo) as the replaced one when possible. */
export function rerollPool(instance: EquipmentInstance, index: number): AffixDefinition[] {
  const slot = getEquipmentTemplate(instance.templateId).slot;
  const affixes = instance.affixes ?? [];
  const others = new Set(affixes.filter((_, i) => i !== index).map((a) => a.id));
  const valid = AFFIXES.filter((a) => (!a.slots || a.slots.includes(slot)) && !others.has(a.id));
  const currentKind = AFFIXES.find((a) => a.id === affixes[index]?.id)?.kind;
  const sameKind = currentKind ? valid.filter((a) => a.kind === currentKind) : [];
  return sameKind.length > 0 ? sameKind : valid;
}

/** Why the bench won't enchant affix `index` of `instance` for `purse`, or null when it will. */
export function enchantBlocker(purse: Purse, instance: EquipmentInstance, index: number): EnchantFailure | null {
  const len = instance.affixes?.length ?? 0;
  if (len === 0) return 'noAffixes';
  if (!Number.isInteger(index) || index < 0 || index >= len) return 'invalidIndex';
  if (!enchantableIndices(instance).includes(index)) return 'locked';
  if (rerollPool(instance, index).length === 0) return 'noOptions';
  const short = costShortfall(purse, enchantCost(instance));
  if (short.materials.length > 0) return 'materials';
  if (short.gold > 0) return 'gold';
  return null;
}

export type EnchantResult = { ok: true; previous: ItemAffix; next: ItemAffix; cost: WorkshopCost } | { ok: false; reason: EnchantFailure };

/** Pays and rerolls affix `index` in place, locking the item to that affix. Nothing changes on failure. */
export function enchantAffix(purse: Purse, instance: EquipmentInstance, index: number, rng: () => number = Math.random): EnchantResult {
  const blocker = enchantBlocker(purse, instance, index);
  if (blocker) return { ok: false, reason: blocker };
  const cost = enchantCost(instance);
  payCost(purse, cost);
  const pool = rerollPool(instance, index);
  const def = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  const affixes = [...(instance.affixes ?? [])];
  const previous = affixes[index];
  const next: ItemAffix = { id: def.id, value: rollAffixValue(def, instance.itemLevel, rng) };
  affixes[index] = next;
  instance.affixes = affixes;
  instance.enchantedAffixIndex = index;
  instance.enchantCount = enchantCountOf(instance) + 1;
  return { ok: true, previous, next, cost };
}

// --- aprimorar --------------------------------------------------------------

export function maxUpgradeLevel(instance: EquipmentInstance): number {
  return isUniqueItem(instance) ? UNIQUE_MAX_UPGRADE_LEVEL : MAX_UPGRADE_LEVEL;
}

/** The next upgrade's bill, or null once the item is at its ceiling. */
export function upgradeCost(instance: EquipmentInstance): WorkshopCost | null {
  const u = upgradeLevelOf(instance);
  if (u >= maxUpgradeLevel(instance)) return null;
  const level = Math.max(1, instance.itemLevel);
  const gold = Math.round((30 + 8 * level) * costMultiplier(instance) * (1 + 0.6 * u));
  const slot = getEquipmentTemplate(instance.templateId).slot;
  const materials = [{ materialId: SALVAGE_BASE_MATERIAL[slot], qty: 2 + u }];
  if (u >= 2) materials.push({ materialId: ESSENCE_MATERIAL_ID, qty: u - 1 });
  return { gold, materials };
}

export type UpgradeFailure = 'maxLevel' | 'gold' | 'materials';

export const UPGRADE_FAILURE_TEXT: Record<UpgradeFailure, string> = {
  maxLevel: 'Este item já está no aprimoramento máximo.',
  gold: 'Ouro insuficiente.',
  materials: 'Materiais insuficientes.',
};

export function upgradeBlocker(purse: Purse, instance: EquipmentInstance): UpgradeFailure | null {
  const cost = upgradeCost(instance);
  if (!cost) return 'maxLevel';
  const short = costShortfall(purse, cost);
  if (short.materials.length > 0) return 'materials';
  if (short.gold > 0) return 'gold';
  return null;
}

export type UpgradeResult = { ok: true; upgradeLevel: number; itemLevel: number; cost: WorkshopCost } | { ok: false; reason: UpgradeFailure };

/** Pays and raises the item one level (and one upgrade step). */
export function upgradeItem(purse: Purse, instance: EquipmentInstance): UpgradeResult {
  const blocker = upgradeBlocker(purse, instance);
  if (blocker) return { ok: false, reason: blocker };
  const cost = upgradeCost(instance)!;
  payCost(purse, cost);
  instance.upgradeLevel = upgradeLevelOf(instance) + 1;
  instance.itemLevel = Math.max(1, instance.itemLevel) + 1;
  return { ok: true, upgradeLevel: instance.upgradeLevel, itemLevel: instance.itemLevel, cost };
}
