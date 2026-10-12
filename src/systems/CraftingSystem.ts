/**
 * Crafting puro: custos (ouro + materiais), checagem e execução de receitas
 * de `data/recipes.ts`. Sem DOM nem Player concreto — tudo recebe a forma
 * mínima de que precisa (`Purse`/`CraftContext`), que `Player` já satisfaz
 * estruturalmente. Também é a casa dos utilitários de custo que
 * EnchantSystem reaproveita.
 */
import type { EquipmentInstance } from '../config/types';
import { createStarterItem } from '../data/equipment';
import type { MaterialStack, RecipeDefinition } from '../data/recipes';

/** Onde se paga: ouro e o saco compartilhado de consumíveis/materiais/gemas. */
export interface Purse {
  gold: number;
  inventory: Record<string, number>;
}

export interface WorkshopCost {
  gold: number;
  materials: MaterialStack[];
}

export function ownedQty(purse: Purse, materialId: string): number {
  return Math.max(0, purse.inventory[materialId] ?? 0);
}

/** What's still missing to pay `cost` — empty materials and 0 gold means affordable. */
export function costShortfall(purse: Purse, cost: WorkshopCost): WorkshopCost {
  const materials = cost.materials
    .map((m) => ({ materialId: m.materialId, qty: Math.max(0, m.qty - ownedQty(purse, m.materialId)) }))
    .filter((m) => m.qty > 0);
  return { gold: Math.max(0, cost.gold - purse.gold), materials };
}

export function canAfford(purse: Purse, cost: WorkshopCost): boolean {
  const short = costShortfall(purse, cost);
  return short.gold === 0 && short.materials.length === 0;
}

/** Debits `cost` atomically: nothing is touched unless all of it is affordable. */
export function payCost(purse: Purse, cost: WorkshopCost): boolean {
  if (!canAfford(purse, cost)) return false;
  purse.gold -= cost.gold;
  for (const m of cost.materials) {
    if (m.qty <= 0) continue;
    const left = ownedQty(purse, m.materialId) - m.qty;
    if (left > 0) purse.inventory[m.materialId] = left;
    else delete purse.inventory[m.materialId];
  }
  return true;
}

/** Equipment recipes get pricier as the player levels (the crafted item is born at the player's level); consumables don't. */
const EQUIPMENT_GOLD_PER_LEVEL = 0.06;

export function recipeCost(recipe: RecipeDefinition, playerLevel: number): WorkshopCost {
  const level = Math.max(1, Math.floor(playerLevel));
  const gold = recipe.output.kind === 'equipment' ? Math.round(recipe.gold * (1 + (level - 1) * EQUIPMENT_GOLD_PER_LEVEL)) : recipe.gold;
  return { gold, materials: recipe.materials.map((m) => ({ ...m })) };
}

export interface CraftContext extends Purse {
  level: number;
  readonly bagFull: boolean;
  addItem(itemId: string, qty: number): void;
  addLoot(instance: EquipmentInstance): boolean;
}

export type CraftFailure = 'level' | 'bag' | 'gold' | 'materials';

export const CRAFT_FAILURE_TEXT: Record<CraftFailure, string> = {
  level: 'Nível insuficiente para esta receita.',
  bag: 'Mochila cheia.',
  gold: 'Ouro insuficiente.',
  materials: 'Materiais insuficientes.',
};

/** Why `recipe` can't be crafted right now, or null when it can. Level first, then bag space, then the bill. */
export function craftBlocker(recipe: RecipeDefinition, ctx: CraftContext): CraftFailure | null {
  if (ctx.level < (recipe.minLevel ?? 1)) return 'level';
  if (recipe.output.kind === 'equipment' && ctx.bagFull) return 'bag';
  const short = costShortfall(ctx, recipeCost(recipe, ctx.level));
  if (short.materials.length > 0) return 'materials';
  if (short.gold > 0) return 'gold';
  return null;
}

export type CraftResult =
  | { ok: true; output: { kind: 'item'; itemId: string; qty: number } }
  | { ok: true; output: { kind: 'equipment'; instance: EquipmentInstance } }
  | { ok: false; reason: CraftFailure };

/** Pays for and produces `recipe`'s output, delivering it through ctx.addItem/addLoot. Touches nothing on failure. */
export function craftRecipe(recipe: RecipeDefinition, ctx: CraftContext, rng: () => number = Math.random): CraftResult {
  const blocker = craftBlocker(recipe, ctx);
  if (blocker) return { ok: false, reason: blocker };
  const out = recipe.output;
  if (out.kind === 'item') {
    payCost(ctx, recipeCost(recipe, ctx.level));
    ctx.addItem(out.itemId, out.qty);
    return { ok: true, output: { kind: 'item', itemId: out.itemId, qty: out.qty } };
  }
  const instance = createStarterItem(out.templateId, out.rarity, Math.max(1, ctx.level), rng);
  payCost(ctx, recipeCost(recipe, ctx.level));
  if (!ctx.addLoot(instance)) {
    // bagFull was checked above; a holder that still refuses is refunded rather than robbed.
    const cost = recipeCost(recipe, ctx.level);
    ctx.gold += cost.gold;
    for (const m of cost.materials) ctx.inventory[m.materialId] = ownedQty(ctx, m.materialId) + m.qty;
    return { ok: false, reason: 'bag' };
  }
  return { ok: true, output: { kind: 'equipment', instance } };
}
