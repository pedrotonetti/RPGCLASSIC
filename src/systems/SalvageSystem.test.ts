import { describe, expect, it } from 'vitest';
import { RARITY_ORDER } from '../config/rarity';
import type { EquipmentInstance, ItemRarity } from '../config/types';
import { Player } from '../entities/Player';
import { bulkSalvageCandidates, mergeYields, salvageFromBag, salvageNeedsConfirm, salvageYield, type SalvageHolder } from './SalvageSystem';

function item(over: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return { uid: 'u1', templateId: 'espada_curta', rarity: 'verde', itemLevel: 1, ...over };
}

function qtyOf(stacks: Array<{ materialId: string; qty: number }>, id: string): number {
  return stacks.find((s) => s.materialId === id)?.qty ?? 0;
}

function holder(bag: EquipmentInstance[]): SalvageHolder & { got: Record<string, number> } {
  return {
    bag,
    got: {},
    addItem(itemId: string, qty: number) {
      this.got[itemId] = (this.got[itemId] ?? 0) + qty;
    },
  };
}

describe('salvageYield', () => {
  it('gives the slot material: iron for weapons, leather for armor, shards for accessories', () => {
    expect(salvageYield(item())).toEqual([{ materialId: 'mat_iron_ore', qty: 1 }]);
    expect(salvageYield(item({ templateId: 'armadura_couro' }))).toEqual([{ materialId: 'mat_leather', qty: 1 }]);
    expect(salvageYield(item({ templateId: 'anel_sorte' }))).toEqual([{ materialId: 'mat_arcane_shard', qty: 1 }]);
  });

  it('scales with rarity, and only Raro or better yields essence', () => {
    let lastBase = 0;
    let lastEssence = -1;
    for (const rarity of RARITY_ORDER) {
      const stacks = salvageYield(item({ rarity }));
      const base = qtyOf(stacks, 'mat_iron_ore');
      const essence = qtyOf(stacks, 'mat_thirst_essence');
      expect(base).toBeGreaterThan(lastBase);
      expect(essence).toBeGreaterThan(lastEssence);
      lastBase = base;
      lastEssence = essence;
    }
    expect(qtyOf(salvageYield(item({ rarity: 'verde' })), 'mat_thirst_essence')).toBe(0);
    expect(qtyOf(salvageYield(item({ rarity: 'azul' })), 'mat_thirst_essence')).toBe(1);
    expect(qtyOf(salvageYield(item({ rarity: 'laranja' })), 'mat_thirst_essence')).toBe(5);
  });

  it('adds a bit for item level, upgrades invested and pairs of affixes', () => {
    const plain = qtyOf(salvageYield(item({ rarity: 'amarelo' })), 'mat_iron_ore');
    expect(qtyOf(salvageYield(item({ rarity: 'amarelo', itemLevel: 20 })), 'mat_iron_ore')).toBe(plain + 2);
    expect(qtyOf(salvageYield(item({ rarity: 'amarelo', upgradeLevel: 3 })), 'mat_iron_ore')).toBe(plain + 3);
    const affixes = [
      { id: 'brasa', value: 0.1 },
      { id: 'sangue', value: 0.03 },
    ];
    expect(qtyOf(salvageYield(item({ rarity: 'amarelo', affixes })), 'mat_arcane_shard')).toBe(1);
  });

  it('merges same-material lines (an accessory\'s shards with its affix shards)', () => {
    const stacks = salvageYield(item({ templateId: 'anel_sorte', rarity: 'amarelo', affixes: [{ id: 'fortuna', value: 1 }, { id: 'precisao', value: 0.03 }] }));
    expect(stacks.filter((s) => s.materialId === 'mat_arcane_shard')).toHaveLength(1);
    expect(qtyOf(stacks, 'mat_arcane_shard')).toBe(3 + 1);
  });
});

describe('salvageFromBag', () => {
  it('removes the item, pays the materials and returns the socketed gem', () => {
    const target = item({ uid: 'b', rarity: 'azul', socketedGemId: 'gem_ruby' });
    const h = holder([item({ uid: 'a' }), target]);
    const result = salvageFromBag(h, 'b');
    if (!result.ok) throw new Error('salvage failed');
    expect(result.gemReturned).toBe('gem_ruby');
    expect(h.bag.map((i) => i.uid)).toEqual(['a']);
    expect(h.got).toEqual({ mat_iron_ore: 2, mat_thirst_essence: 1, gem_ruby: 1 });
  });

  it('fails on an unknown uid without touching anything', () => {
    const h = holder([item()]);
    expect(salvageFromBag(h, 'nope')).toEqual({ ok: false });
    expect(h.bag).toHaveLength(1);
    expect(h.got).toEqual({});
  });

  it('works on a real Player and registers the essence in the codex', () => {
    const player = Player.createNew('Sucateira', 'archer');
    player.bag = [item({ uid: 'x', rarity: 'vermelho' })];
    expect(salvageFromBag(player, 'x').ok).toBe(true);
    expect(player.bag).toEqual([]);
    expect(player.inventory.mat_thirst_essence).toBe(3);
    expect(player.codex.materials.mat_thirst_essence).toBe(3);
  });
});

describe('salvage helpers', () => {
  it('asks for confirmation on Raro+ or anything worked on at a bench', () => {
    expect(salvageNeedsConfirm(item())).toBe(false);
    for (const rarity of ['azul', 'amarelo', 'vermelho', 'laranja'] as ItemRarity[]) expect(salvageNeedsConfirm(item({ rarity }))).toBe(true);
    expect(salvageNeedsConfirm(item({ upgradeLevel: 1 }))).toBe(true);
    expect(salvageNeedsConfirm(item({ enchantCount: 1 }))).toBe(true);
  });

  it('bulk-salvages only plain Comum items', () => {
    const bag = [
      item({ uid: 'c1' }),
      item({ uid: 'r1', rarity: 'azul' }),
      item({ uid: 'c2', upgradeLevel: 1 }),
      item({ uid: 'c3', socketedGemId: 'gem_ruby' }),
      item({ uid: 'c4', templateId: 'anel_sorte' }),
    ];
    expect(bulkSalvageCandidates(bag)).toEqual(['c1', 'c4']);
  });

  it('merges several yields', () => {
    expect(
      mergeYields([
        [{ materialId: 'mat_iron_ore', qty: 1 }],
        [
          { materialId: 'mat_iron_ore', qty: 2 },
          { materialId: 'mat_leather', qty: 1 },
        ],
      ]),
    ).toEqual([
      { materialId: 'mat_iron_ore', qty: 3 },
      { materialId: 'mat_leather', qty: 1 },
    ]);
  });
});
