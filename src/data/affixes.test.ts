import { describe, expect, it } from 'vitest';
import { RARITY_ORDER } from '../config/rarity';
import type { EquipmentInstance, ItemRarity } from '../config/types';
import {
  AFFIXES,
  AFFIX_COUNT_BY_RARITY,
  addModifiers,
  affixModifiers,
  affixStatBonus,
  capModifiers,
  describeAffix,
  emptyModifiers,
  getAffixDefinition,
  rollAffixes,
} from './affixes';
import { computeEquipmentBonus, createStarterItem, generateLoot, getEquipmentTemplate, itemDisplayName } from './equipment';
import { UNIQUE_AFFIX_COUNT, UNIQUE_TEMPLATES } from './uniques';

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('affix table', () => {
  it('has unique ids and a valid effect target and range on every entry', () => {
    const ids = new Set<string>();
    for (const affix of AFFIXES) {
      expect(ids.has(affix.id), affix.id).toBe(false);
      ids.add(affix.id);
      expect(Boolean(affix.stat) !== Boolean(affix.modifier), `${affix.id}: exactly one of stat/modifier`).toBe(true);
      expect(affix.max).toBeGreaterThan(affix.min);
      expect(affix.text).toContain('{v}');
      expect(affix.title.startsWith('de ')).toBe(true);
    }
  });

  it('every slot has enough distinct affixes to fill the highest rarity', () => {
    const most = Math.max(...Object.values(AFFIX_COUNT_BY_RARITY));
    for (const slot of ['arma', 'armadura', 'acessorio'] as const) {
      expect(AFFIXES.filter((a) => !a.slots || a.slots.includes(slot)).length, slot).toBeGreaterThanOrEqual(most);
    }
  });
});

describe('rollAffixes', () => {
  it('rolls the requested number of distinct affixes, all valid for the slot', () => {
    const rng = seeded(1);
    for (const slot of ['arma', 'armadura', 'acessorio'] as const) {
      for (let i = 0; i < 50; i++) {
        const rolled = rollAffixes(slot, 5, 4, rng);
        expect(rolled).toHaveLength(4);
        expect(new Set(rolled.map((a) => a.id)).size).toBe(4);
        for (const affix of rolled) {
          const def = getAffixDefinition(affix.id)!;
          expect(!def.slots || def.slots.includes(slot)).toBe(true);
        }
      }
    }
  });

  it('keeps every rolled value inside its range, scaling only the flat-stat affixes with item level', () => {
    const rng = seeded(2);
    for (let i = 0; i < 200; i++) {
      for (const affix of rollAffixes('acessorio', 1, 6, rng)) {
        const def = getAffixDefinition(affix.id)!;
        expect(affix.value).toBeGreaterThanOrEqual(Math.min(def.min, 1) - 1e-9);
        expect(affix.value).toBeLessThanOrEqual(def.max + 1e-9);
      }
    }
    const lowLevel = rollAffixes('armadura', 1, 10, () => 0.999).find((a) => a.id === 'vitalidade')!;
    const highLevel = rollAffixes('armadura', 20, 10, () => 0.999).find((a) => a.id === 'vitalidade')!;
    expect(highLevel.value).toBeGreaterThan(lowLevel.value * 2);
    const pctLow = rollAffixes('armadura', 1, 10, () => 0.999).find((a) => a.id === 'espinhos')!;
    const pctHigh = rollAffixes('armadura', 20, 10, () => 0.999).find((a) => a.id === 'espinhos')!;
    expect(pctHigh.value).toBe(pctLow.value);
  });

  it('is deterministic for a given rng and mixes prefixes with suffixes', () => {
    expect(rollAffixes('arma', 8, 3, seeded(7))).toEqual(rollAffixes('arma', 8, 3, seeded(7)));
    const kinds = rollAffixes('arma', 8, 2, seeded(3)).map((a) => getAffixDefinition(a.id)!.kind);
    expect(kinds).toEqual(['prefix', 'suffix']);
  });
});

describe('affix count scales with rarity', () => {
  it('createStarterItem rolls 0/1/2/3/4 affixes from Comum to Mítico, and none are stored on a Comum item', () => {
    RARITY_ORDER.forEach((rarity, tier) => {
      const item = createStarterItem('espada_curta', rarity, 5, seeded(tier));
      expect(item.affixes?.length ?? 0).toBe(tier);
    });
    expect(createStarterItem('espada_curta', 'verde', 1).affixes).toBeUndefined();
  });

  it('generateLoot gives regular items the rarity-scaled count and uniques their own reduced count', () => {
    const rng = seeded(11);
    const seen = new Set<ItemRarity>();
    for (let i = 0; i < 1500; i++) {
      const item = generateLoot(10, 10, 6, { rng });
      seen.add(item.rarity);
      const template = getEquipmentTemplate(item.templateId);
      const expected = template.passiveId ? (UNIQUE_AFFIX_COUNT[item.rarity] ?? 0) : AFFIX_COUNT_BY_RARITY[item.rarity];
      expect(item.affixes?.length ?? 0, `${item.templateId} ${item.rarity}`).toBe(expected);
    }
    expect(seen.size).toBe(RARITY_ORDER.length);
  });
});

describe('old items without affixes', () => {
  const legacy: EquipmentInstance = { uid: 'old', templateId: 'cajado_arcano', rarity: 'azul', itemLevel: 4 };

  it('keep computing the same stats and display name', () => {
    expect(computeEquipmentBonus(legacy)).toEqual({ magicAttack: Math.round(4 * 1.35 * (1 + 3 * 0.12) * 10) / 10 });
    expect(itemDisplayName(legacy)).toBe('Cajado Arcano');
    expect(affixStatBonus(legacy.affixes)).toEqual({});
    expect(affixModifiers(legacy.affixes)).toEqual({});
  });

  it('ignore an affix id that no longer exists in the table', () => {
    const stale: EquipmentInstance = { ...legacy, affixes: [{ id: 'removido_um_dia', value: 9 }] };
    expect(computeEquipmentBonus(stale)).toEqual(computeEquipmentBonus(legacy));
    expect(describeAffix(stale.affixes![0])).toBeNull();
  });
});

describe('affix effects on an item', () => {
  it('flat-stat affixes add to the equipment bonus on top of the template stats', () => {
    const plain: EquipmentInstance = { uid: 'a', templateId: 'espada_curta', rarity: 'verde', itemLevel: 1 };
    const rolled: EquipmentInstance = { ...plain, affixes: [{ id: 'brutalidade', value: 4 }, { id: 'sangue', value: 0.03 }] };
    expect(computeEquipmentBonus(rolled).attack).toBe((computeEquipmentBonus(plain).attack ?? 0) + 4);
    expect(affixModifiers(rolled.affixes)).toEqual({ lifeSteal: 0.03 });
  });

  it('the lead affix lends its title to a regular item name, while uniques keep theirs', () => {
    const named: EquipmentInstance = { uid: 'b', templateId: 'espada_curta', rarity: 'azul', itemLevel: 1, affixes: [{ id: 'brasa', value: 0.1 }] };
    expect(itemDisplayName(named)).toBe('Espada Curta de Brasa');
    const unique = createStarterItem(UNIQUE_TEMPLATES[0].id, UNIQUE_TEMPLATES[0].fixedRarity, 3, seeded(5));
    expect(itemDisplayName(unique)).toBe(UNIQUE_TEMPLATES[0].name);
  });

  it('describes a rolled affix in pt-BR with its formatted value', () => {
    expect(describeAffix({ id: 'precisao', value: 0.04 })).toBe('+4% de chance crítica');
    expect(describeAffix({ id: 'brutalidade', value: 3 })).toBe('+3 de Ataque');
    expect(describeAffix({ id: 'fonte', value: 0.8 })).toBe('+0,8 de regeneração de MP por segundo');
  });
});

describe('modifier aggregation', () => {
  it('sums sources and caps stacked values so they cannot break combat math', () => {
    const total = emptyModifiers();
    addModifiers(total, { critChance: 0.3, lifeSteal: 0.2 });
    addModifiers(total, { critChance: 0.3, lifeSteal: 0.2, damageDealt: 0.35 });
    const capped = capModifiers(total);
    expect(capped.critChance).toBe(0.35);
    expect(capped.lifeSteal).toBe(0.25);
    expect(capped.damageDealt).toBeCloseTo(0.35);
  });
});
