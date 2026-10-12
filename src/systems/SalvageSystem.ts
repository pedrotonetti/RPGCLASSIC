/**
 * Desmontar: transforma equipamento indesejado da mochila em materiais.
 * O rendimento cresce com a raridade (e um pouco com o nível do item e os
 * aprimoramentos investidos nele); Raro ou melhor também rende Essência
 * Sedenta, o único jeito de obtê-la. A gema encaixada volta para o jogador.
 */
import { rarityTier } from '../config/rarity';
import type { EquipmentInstance, EquipmentSlot } from '../config/types';
import { getEquipmentTemplate } from '../data/equipment';
import type { MaterialStack } from '../data/recipes';

export const ESSENCE_MATERIAL_ID = 'mat_thirst_essence';

/** O material "da peça" — o mesmo de que ela seria forjada. */
export const SALVAGE_BASE_MATERIAL: Record<EquipmentSlot, string> = {
  arma: 'mat_iron_ore',
  armadura: 'mat_leather',
  acessorio: 'mat_arcane_shard',
};

/** Indexed by rarity tier (Comum..Mítico). */
const BASE_QTY_BY_TIER = [1, 2, 3, 4, 6];
const ESSENCE_BY_TIER = [0, 1, 2, 3, 5];
/** One extra base material per this many item levels. */
const LEVELS_PER_BONUS_MATERIAL = 10;

/** What desmontar `instance` yields, merged by material id, in a stable order (base, shards, essence). */
export function salvageYield(instance: EquipmentInstance): MaterialStack[] {
  const tier = Math.max(0, rarityTier(instance.rarity));
  const slot = getEquipmentTemplate(instance.templateId).slot;
  const totals = new Map<string, number>();
  const add = (materialId: string, qty: number): void => {
    if (qty > 0) totals.set(materialId, (totals.get(materialId) ?? 0) + qty);
  };
  const levelBonus = Math.floor(Math.max(1, instance.itemLevel) / LEVELS_PER_BONUS_MATERIAL);
  const upgradeRefund = Math.max(0, Math.floor(instance.upgradeLevel ?? 0));
  add(SALVAGE_BASE_MATERIAL[slot], BASE_QTY_BY_TIER[tier] + levelBonus + upgradeRefund);
  // Afixos são magia presa ao item: cada par devolve um fragmento arcano.
  add('mat_arcane_shard', Math.floor((instance.affixes?.length ?? 0) / 2));
  add(ESSENCE_MATERIAL_ID, ESSENCE_BY_TIER[tier]);
  return [...totals.entries()].map(([materialId, qty]) => ({ materialId, qty }));
}

/** Desmontar Raro ou melhor pede confirmação na interface. */
export function salvageNeedsConfirm(instance: EquipmentInstance): boolean {
  return rarityTier(instance.rarity) >= 1 || (instance.upgradeLevel ?? 0) > 0 || (instance.enchantCount ?? 0) > 0;
}

export interface SalvageHolder {
  bag: EquipmentInstance[];
  addItem(itemId: string, qty: number): void;
}

export type SalvageResult = { ok: true; yields: MaterialStack[]; gemReturned: string | null } | { ok: false };

/** Removes the bag item `uid` and pays out its materials (and socketed gem). Equipped items must be unequipped first. */
export function salvageFromBag(holder: SalvageHolder, uid: string): SalvageResult {
  const index = holder.bag.findIndex((i) => i.uid === uid);
  if (index === -1) return { ok: false };
  const instance = holder.bag[index];
  const yields = salvageYield(instance);
  holder.bag.splice(index, 1);
  for (const stack of yields) holder.addItem(stack.materialId, stack.qty);
  const gemReturned = instance.socketedGemId ?? null;
  if (gemReturned) holder.addItem(gemReturned, 1);
  return { ok: true, yields, gemReturned };
}

/** Sums several yields (e.g. for a bulk-salvage summary). */
export function mergeYields(lists: MaterialStack[][]): MaterialStack[] {
  const totals = new Map<string, number>();
  for (const list of lists) for (const s of list) totals.set(s.materialId, (totals.get(s.materialId) ?? 0) + s.qty);
  return [...totals.entries()].map(([materialId, qty]) => ({ materialId, qty }));
}

/** Bag uids that "desmontar todos os Comuns" would take: plain Comum items with nothing invested in them. */
export function bulkSalvageCandidates(bag: EquipmentInstance[]): string[] {
  return bag.filter((i) => i.rarity === 'verde' && !salvageNeedsConfirm(i) && !i.socketedGemId).map((i) => i.uid);
}
