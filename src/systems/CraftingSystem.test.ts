import { describe, expect, it } from 'vitest';
import { RARITY_ORDER } from '../config/rarity';
import type { EquipmentInstance } from '../config/types';
import { AFFIX_COUNT_BY_RARITY } from '../data/affixes';
import { getEquipmentTemplate } from '../data/equipment';
import { getItemById } from '../data/items';
import { MATERIAL_DEFINITIONS, MONSTER_MATERIALS, getMaterialById } from '../data/materials';
import { RECIPES, getRecipeById, recipesForStation, type RecipeDefinition } from '../data/recipes';
import { NPC_DEFINITIONS } from '../data/npcs';
import { Player } from '../entities/Player';
import { canAfford, costShortfall, craftBlocker, craftRecipe, payCost, recipeCost, type CraftContext, type CraftResult } from './CraftingSystem';

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface StubContext extends CraftContext {
  bag: EquipmentInstance[];
  added: Record<string, number>;
  full: boolean;
}

function stubContext(over: { gold?: number; inventory?: Record<string, number>; level?: number; full?: boolean } = {}): StubContext {
  const ctx: StubContext = {
    gold: over.gold ?? 1000,
    inventory: { ...(over.inventory ?? {}) },
    level: over.level ?? 10,
    bag: [],
    added: {},
    full: over.full ?? false,
    get bagFull() {
      return this.full;
    },
    addItem(itemId: string, qty: number) {
      this.added[itemId] = (this.added[itemId] ?? 0) + qty;
      this.inventory[itemId] = (this.inventory[itemId] ?? 0) + qty;
    },
    addLoot(instance: EquipmentInstance) {
      if (this.full) return false;
      this.bag.push(instance);
      return true;
    },
  };
  return ctx;
}

function recipe(id: string): RecipeDefinition {
  const found = getRecipeById(id);
  if (!found) throw new Error(`missing recipe ${id}`);
  return found;
}

/** Narrows a craft result to an equipment success, failing the test otherwise. */
function craftedInstance(result: CraftResult): EquipmentInstance {
  if (!result.ok) throw new Error(`craft failed: ${result.reason}`);
  if (result.output.kind !== 'equipment') throw new Error('expected an equipment craft');
  return result.output.instance;
}

function fullStock(r: RecipeDefinition, extra = 0): Record<string, number> {
  return Object.fromEntries(r.materials.map((m) => [m.materialId, m.qty + extra]));
}

describe('recipe data', () => {
  it('has unique ids and only references real materials, items, templates and stations', () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    const stations = new Set(NPC_DEFINITIONS.flatMap((n) => (n.vendor && !n.vendor.noCrafting ? [n.vendor.kind] : [])));
    for (const r of RECIPES) {
      expect(stations.has(r.station), `${r.id} station`).toBe(true);
      expect(r.materials.length).toBeGreaterThan(0);
      for (const m of r.materials) {
        expect(() => getMaterialById(m.materialId)).not.toThrow();
        expect(m.qty).toBeGreaterThan(0);
      }
      expect(r.gold).toBeGreaterThan(0);
      if (r.output.kind === 'item') expect(() => getItemById(r.output.kind === 'item' ? r.output.itemId : '')).not.toThrow();
      else {
        const template = getEquipmentTemplate(r.output.templateId);
        expect(template.passiveId, 'uniques are never craftable').toBeUndefined();
        expect(RARITY_ORDER).toContain(r.output.rarity);
      }
    }
  });

  it('gives every crafting station at least one recipe', () => {
    for (const kind of ['ferreiro', 'boticario', 'artesao', 'joalheiro', 'tecelao'] as const) {
      expect(recipesForStation(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it('keeps the salvage-only essence out of monster drops', () => {
    expect(MATERIAL_DEFINITIONS.some((m) => m.id === 'mat_thirst_essence')).toBe(true);
    expect(MONSTER_MATERIALS.some((m) => m.id === 'mat_thirst_essence')).toBe(false);
    expect(MONSTER_MATERIALS.map((m) => m.id)).toEqual(['mat_iron_ore', 'mat_leather', 'mat_herb', 'mat_arcane_shard']);
  });
});

describe('cost helpers', () => {
  const cost = { gold: 50, materials: [{ materialId: 'mat_herb', qty: 3 }, { materialId: 'mat_leather', qty: 1 }] };

  it('reports exactly what is missing', () => {
    const purse = { gold: 20, inventory: { mat_herb: 1 } };
    expect(costShortfall(purse, cost)).toEqual({ gold: 30, materials: [{ materialId: 'mat_herb', qty: 2 }, { materialId: 'mat_leather', qty: 1 }] });
    expect(canAfford(purse, cost)).toBe(false);
  });

  it('pays atomically and removes emptied stacks', () => {
    const poor = { gold: 49, inventory: { mat_herb: 3, mat_leather: 1 } };
    expect(payCost(poor, cost)).toBe(false);
    expect(poor).toEqual({ gold: 49, inventory: { mat_herb: 3, mat_leather: 1 } });

    const rich = { gold: 60, inventory: { mat_herb: 5, mat_leather: 1 } };
    expect(payCost(rich, cost)).toBe(true);
    expect(rich).toEqual({ gold: 10, inventory: { mat_herb: 2 } });
  });

  it('scales equipment recipes with player level but not consumables', () => {
    const potion = recipe('rec_pocao_vida_maior');
    expect(recipeCost(potion, 1).gold).toBe(potion.gold);
    expect(recipeCost(potion, 30).gold).toBe(potion.gold);
    const blade = recipe('rec_lamina_temperada');
    expect(recipeCost(blade, 1).gold).toBe(blade.gold);
    expect(recipeCost(blade, 11).gold).toBe(Math.round(blade.gold * 1.6));
  });
});

describe('craftRecipe', () => {
  it('turns herbs and gold into potions', () => {
    const r = recipe('rec_pocao_vida_maior');
    const ctx = stubContext({ gold: 100, inventory: { mat_herb: 5 } });
    const result = craftRecipe(r, ctx);
    expect(result).toEqual({ ok: true, output: { kind: 'item', itemId: 'potion_hp_major', qty: 2 } });
    expect(ctx.gold).toBe(100 - r.gold);
    expect(ctx.inventory).toEqual({ mat_herb: 2, potion_hp_major: 2 });
  });

  it('forges equipment at the player level with the rarity affix count', () => {
    const r = recipe('rec_lamina_temperada');
    const ctx = stubContext({ level: 12, inventory: fullStock(r) });
    const instance = craftedInstance(craftRecipe(r, ctx, seeded(3)));
    expect(instance.templateId).toBe('espada_curta');
    expect(instance.rarity).toBe('amarelo');
    expect(instance.itemLevel).toBe(12);
    expect(instance.affixes).toHaveLength(AFFIX_COUNT_BY_RARITY.amarelo);
    expect(ctx.bag).toEqual([instance]);
    expect(ctx.inventory).toEqual({});
    expect(ctx.gold).toBe(1000 - recipeCost(r, 12).gold);
  });

  it('can craft set pieces', () => {
    const r = recipe('rec_machado_das_brasas');
    const instance = craftedInstance(craftRecipe(r, stubContext({ inventory: fullStock(r) }), seeded(9)));
    expect(getEquipmentTemplate(instance.templateId).setId).toBe('brasas_da_pedra_vermelha');
  });

  it('refuses, untouched, for level, bag space, materials and gold — in that order', () => {
    const r = recipe('rec_machado_das_brasas');
    const low = stubContext({ level: 3, inventory: fullStock(r) });
    expect(craftRecipe(r, low)).toEqual({ ok: false, reason: 'level' });

    const full = stubContext({ full: true, inventory: fullStock(r) });
    expect(craftBlocker(r, full)).toBe('bag');
    expect(craftRecipe(r, full)).toEqual({ ok: false, reason: 'bag' });

    const missing = stubContext({ gold: 0, inventory: { mat_iron_ore: 1 } });
    expect(craftRecipe(r, missing)).toEqual({ ok: false, reason: 'materials' });

    const broke = stubContext({ gold: 5, inventory: fullStock(r) });
    expect(craftRecipe(r, broke)).toEqual({ ok: false, reason: 'gold' });
    expect(broke.gold).toBe(5);
    expect(broke.inventory).toEqual(fullStock(r));
    expect(broke.bag).toEqual([]);
  });

  it('only needs bag space for equipment', () => {
    const r = recipe('rec_elixir_restaurador');
    expect(craftBlocker(r, stubContext({ full: true, inventory: fullStock(r) }))).toBeNull();
  });

  it('works directly on a real Player (codex picks up the new item)', () => {
    const player = Player.createNew('Forjador', 'warrior');
    const r = recipe('rec_elixir_restaurador');
    player.gold = 100;
    player.inventory = { ...player.inventory, ...fullStock(r) };
    const result = craftRecipe(r, player);
    expect(result.ok).toBe(true);
    expect(player.inventory.elixir_restorer).toBe(1);
    expect(player.inventory.mat_herb).toBeUndefined();
    expect(player.gold).toBe(100 - r.gold);
  });
});
