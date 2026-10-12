import { describe, expect, it } from 'vitest';
import type { EquipmentInstance } from '../config/types';
import { AFFIXES, getAffixDefinition } from '../data/affixes';
import { computeEquipmentBonus, getEquipmentTemplate, itemDisplayName } from '../data/equipment';
import { Player, type PlayerSaveData } from '../entities/Player';
import type { Purse } from './CraftingSystem';
import {
  MAX_UPGRADE_LEVEL,
  UNIQUE_MAX_UPGRADE_LEVEL,
  enchantAffix,
  enchantBlocker,
  enchantCost,
  enchantableIndices,
  lockedAffixIndex,
  maxUpgradeLevel,
  rerollPool,
  upgradeCost,
  upgradeItem,
  type EnchantResult,
} from './EnchantSystem';
import { CURRENT_SCHEMA_VERSION, readSaveText, sealSave, type SaveRecord } from './saveFormat';

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function epicSword(over: Partial<EquipmentInstance> = {}): EquipmentInstance {
  return {
    uid: 'e1',
    templateId: 'espada_curta',
    rarity: 'amarelo',
    itemLevel: 10,
    affixes: [
      { id: 'brasa', value: 0.1 },
      { id: 'sangue', value: 0.03 },
    ],
    ...over,
  };
}

function richPurse(): Purse {
  return { gold: 100_000, inventory: { mat_arcane_shard: 99, mat_thirst_essence: 99, mat_iron_ore: 99, mat_leather: 99 } };
}

function expectEnchanted(result: EnchantResult): Extract<EnchantResult, { ok: true }> {
  if (!result.ok) throw new Error(`enchant failed: ${result.reason}`);
  return result;
}

describe('enchant cost', () => {
  it('escalates with every attempt and costs more on higher rarities and uniques', () => {
    const first = enchantCost(epicSword());
    const third = enchantCost(epicSword({ enchantCount: 2 }));
    expect(third.gold).toBeGreaterThan(first.gold);
    expect(enchantCost(epicSword({ rarity: 'laranja' })).gold).toBeGreaterThan(first.gold);
    expect(enchantCost(epicSword({ rarity: 'azul' })).gold).toBeLessThan(first.gold);

    const unique = enchantCost({ uid: 'u', templateId: 'presa_do_pacto', rarity: 'laranja', itemLevel: 10, affixes: [{ id: 'brasa', value: 0.1 }] });
    expect(unique.gold).toBeGreaterThan(enchantCost(epicSword({ rarity: 'laranja' })).gold);
  });

  it('needs essence from Épico up and more shards over time, capped', () => {
    expect(enchantCost(epicSword({ rarity: 'azul' })).materials).toEqual([{ materialId: 'mat_arcane_shard', qty: 1 }]);
    expect(enchantCost(epicSword()).materials).toContainEqual({ materialId: 'mat_thirst_essence', qty: 1 });
    expect(enchantCost(epicSword({ enchantCount: 4 })).materials[0].qty).toBe(3);
    expect(enchantCost(epicSword({ enchantCount: 100 })).materials[0].qty).toBe(6);
    expect(Number.isFinite(enchantCost(epicSword({ enchantCount: 1000 })).gold)).toBe(true);
  });

  it('treats a corrupt saved counter as zero', () => {
    expect(enchantCost(epicSword({ enchantCount: -5 }))).toEqual(enchantCost(epicSword()));
    expect(enchantCost(epicSword({ enchantCount: Number.NaN }))).toEqual(enchantCost(epicSword()));
  });
});

describe('enchantAffix', () => {
  it('pays, rerolls the chosen affix in place and locks the others', () => {
    const purse = richPurse();
    const sword = epicSword();
    const cost = enchantCost(sword);
    const result = expectEnchanted(enchantAffix(purse, sword, 0, seeded(1)));
    expect(result.previous).toEqual({ id: 'brasa', value: 0.1 });
    expect(sword.affixes?.[0]).toEqual(result.next);
    expect(sword.affixes?.[1]).toEqual({ id: 'sangue', value: 0.03 });
    expect(sword.enchantCount).toBe(1);
    expect(sword.enchantedAffixIndex).toBe(0);
    expect(purse.gold).toBe(100_000 - cost.gold);
    expect(purse.inventory.mat_arcane_shard).toBe(98);
    expect(purse.inventory.mat_thirst_essence).toBe(98);

    expect(lockedAffixIndex(sword)).toBe(0);
    expect(enchantableIndices(sword)).toEqual([0]);
    expect(enchantBlocker(purse, sword, 1)).toBe('locked');
    expect(enchantAffix(purse, sword, 1)).toEqual({ ok: false, reason: 'locked' });
  });

  it('never duplicates another affix on the item and stays valid for the slot', () => {
    for (let seed = 0; seed < 60; seed++) {
      const sword = epicSword();
      const result = expectEnchanted(enchantAffix(richPurse(), sword, 0, seeded(seed)));
      expect(result.next.id).not.toBe('sangue');
      const def = getAffixDefinition(result.next.id);
      expect(def?.slots === undefined || def.slots.includes('arma')).toBe(true);
      expect(def?.kind).toBe('prefix');
      expect(result.next.value).toBeGreaterThan(0);
    }
  });

  it('keeps the kind (prefix/suffix) of the replaced affix when the slot allows it', () => {
    const pool = rerollPool(epicSword(), 1);
    expect(pool.length).toBeGreaterThan(0);
    expect(pool.every((a) => a.kind === 'suffix')).toBe(true);
    expect(pool.some((a) => a.id === 'sangue')).toBe(true);
  });

  it('gets more expensive on every attempt', () => {
    const purse = richPurse();
    const sword = epicSword();
    const golds: number[] = [];
    for (let i = 0; i < 4; i++) {
      const before = purse.gold;
      expectEnchanted(enchantAffix(purse, sword, 0, seeded(i)));
      golds.push(before - purse.gold);
    }
    expect(golds).toEqual([...golds].sort((a, b) => a - b));
    expect(new Set(golds).size).toBe(4);
    expect(sword.enchantCount).toBe(4);
  });

  it('refuses items without affixes, bad indices and empty purses, untouched', () => {
    const plain = epicSword({ rarity: 'verde', affixes: undefined });
    expect(enchantAffix(richPurse(), plain, 0)).toEqual({ ok: false, reason: 'noAffixes' });
    expect(enchantAffix(richPurse(), epicSword(), 5)).toEqual({ ok: false, reason: 'invalidIndex' });

    const poor: Purse = { gold: 0, inventory: { mat_arcane_shard: 5, mat_thirst_essence: 5 } };
    const sword = epicSword();
    expect(enchantAffix(poor, sword, 0)).toEqual({ ok: false, reason: 'gold' });
    expect(enchantAffix({ gold: 99_999, inventory: {} }, sword, 0)).toEqual({ ok: false, reason: 'materials' });
    expect(sword).toEqual(epicSword());
    expect(poor.inventory).toEqual({ mat_arcane_shard: 5, mat_thirst_essence: 5 });
  });

  it('only rerolls a unique item\'s affixes — its passive stays', () => {
    const unique: EquipmentInstance = { uid: 'u', templateId: 'gume_do_orvalho', rarity: 'vermelho', itemLevel: 12, affixes: [{ id: 'precisao', value: 0.03 }] };
    expectEnchanted(enchantAffix(richPurse(), unique, 0, seeded(4)));
    expect(getEquipmentTemplate(unique.templateId).passiveId).toBe('ritmo_do_orvalho');
    expect(itemDisplayName(unique)).toBe('Gume do Orvalho');
  });

  it('ignores a stale locked index left past the end of the affix list', () => {
    expect(lockedAffixIndex(epicSword({ enchantedAffixIndex: 7 }))).toBeNull();
    expect(enchantableIndices(epicSword({ enchantedAffixIndex: 7 }))).toEqual([0, 1]);
  });

  it('every affix in the table can be reached by some slot', () => {
    const reachable = new Set(['arma', 'armadura', 'acessorio'].flatMap((slot) => AFFIXES.filter((a) => !a.slots || a.slots.includes(slot as 'arma')).map((a) => a.id)));
    expect(reachable.size).toBe(AFFIXES.length);
  });
});

describe('upgradeItem', () => {
  it('raises item level and stats, escalating the bill, up to the ceiling', () => {
    const purse = richPurse();
    const sword = epicSword();
    const baseAttack = computeEquipmentBonus(sword).attack ?? 0;
    let lastGold = 0;
    for (let step = 1; step <= MAX_UPGRADE_LEVEL; step++) {
      const cost = upgradeCost(sword);
      if (!cost) throw new Error('cost should exist below the ceiling');
      expect(cost.gold).toBeGreaterThan(lastGold);
      lastGold = cost.gold;
      const result = upgradeItem(purse, sword);
      expect(result).toEqual({ ok: true, upgradeLevel: step, itemLevel: 10 + step, cost });
    }
    expect(computeEquipmentBonus(sword).attack ?? 0).toBeGreaterThan(baseAttack);
    expect(itemDisplayName(sword)).toBe('Espada Curta de Brasa +5');
    expect(upgradeCost(sword)).toBeNull();
    expect(upgradeItem(purse, sword)).toEqual({ ok: false, reason: 'maxLevel' });
  });

  it('uses the slot material and adds essence from the third step', () => {
    expect(upgradeCost(epicSword())?.materials).toEqual([{ materialId: 'mat_iron_ore', qty: 2 }]);
    expect(upgradeCost(epicSword({ templateId: 'armadura_couro', upgradeLevel: 2 }))?.materials).toEqual([
      { materialId: 'mat_leather', qty: 4 },
      { materialId: 'mat_thirst_essence', qty: 1 },
    ]);
  });

  it('caps uniques lower', () => {
    const unique: EquipmentInstance = { uid: 'u', templateId: 'manto_da_sede', rarity: 'vermelho', itemLevel: 5 };
    expect(maxUpgradeLevel(unique)).toBe(UNIQUE_MAX_UPGRADE_LEVEL);
    expect(upgradeCost({ ...unique, upgradeLevel: UNIQUE_MAX_UPGRADE_LEVEL })).toBeNull();
  });

  it('refuses without paying when short', () => {
    const purse: Purse = { gold: 1, inventory: { mat_iron_ore: 10 } };
    const sword = epicSword();
    expect(upgradeItem(purse, sword)).toEqual({ ok: false, reason: 'gold' });
    expect(upgradeItem({ gold: 9999, inventory: {} }, sword)).toEqual({ ok: false, reason: 'materials' });
    expect(sword).toEqual(epicSword());
    expect(purse.gold).toBe(1);
  });
});

describe('persistence', () => {
  it('enchant/upgrade fields survive a save round trip on equipped and bag items', () => {
    const player = Player.createNew('Encantadora', 'mage');
    player.gold = 100_000;
    player.inventory = { ...player.inventory, mat_arcane_shard: 50, mat_thirst_essence: 50, mat_iron_ore: 50 };
    const sword = epicSword({ uid: 'bag-sword' });
    player.bag.push(sword);
    expectEnchanted(enchantAffix(player, sword, 1, seeded(2)));
    expect(upgradeItem(player, sword).ok).toBe(true);
    const weapon = player.equipment.arma;
    if (!weapon) throw new Error('mage starts with a weapon');
    expect(upgradeItem(player, weapon).ok).toBe(true);

    const loaded = readSaveText(sealSave(player.toSaveData() as unknown as SaveRecord));
    if (!loaded.ok) throw new Error(`save failed to load: ${loaded.reason}`);
    const restored = Player.fromSaveData(loaded.data as unknown as PlayerSaveData);
    const restoredSword = restored.bag.find((i) => i.uid === 'bag-sword');
    expect(restoredSword).toEqual(sword);
    expect(restoredSword?.enchantCount).toBe(1);
    expect(restoredSword?.enchantedAffixIndex).toBe(1);
    expect(restoredSword?.upgradeLevel).toBe(1);
    expect(restored.equipment.arma?.upgradeLevel).toBe(1);
    expect(restored.gold).toBe(player.gold);
  });

  it('loads a current-version save written before these fields existed', () => {
    const player = Player.createNew('Antiga', 'warrior');
    player.bag.push({ uid: 'old', templateId: 'espada_curta', rarity: 'azul', itemLevel: 4, affixes: [{ id: 'brasa', value: 0.1 }] });
    const loaded = readSaveText(sealSave(player.toSaveData() as unknown as SaveRecord, CURRENT_SCHEMA_VERSION));
    if (!loaded.ok) throw new Error(`save failed to load: ${loaded.reason}`);
    const restored = Player.fromSaveData(loaded.data as unknown as PlayerSaveData);
    const old = restored.bag.find((i) => i.uid === 'old');
    if (!old) throw new Error('bag item lost');
    expect(enchantableIndices(old)).toEqual([0]);
    expect(enchantCost(old)).toEqual(enchantCost({ ...old, enchantCount: 0 }));
    expect(upgradeCost(old)).not.toBeNull();
    expect(itemDisplayName(old)).toBe('Espada Curta de Brasa');
  });
});
