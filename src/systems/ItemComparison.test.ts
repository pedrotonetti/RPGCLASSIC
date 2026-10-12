import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, ItemRarity } from '../config/types';
import { computeEquipmentBonus, getEquipmentTemplate } from '../data/equipment';
import { SET_DEFINITIONS, UNIQUE_TEMPLATES, getItemPassive } from '../data/uniques';
import { compareItems, formatDelta, totalGearStats } from './ItemComparison';
import type { EquippedGear } from './ItemPassives';

let uid = 0;
function item(templateId: string, rarity: ItemRarity = 'verde', itemLevel = 1, affixes: EquipmentInstance['affixes'] = undefined): EquipmentInstance {
  uid += 1;
  return { uid: `t${uid}`, templateId, rarity, itemLevel, ...(affixes ? { affixes } : {}) };
}

describe('compareItems — stat deltas', () => {
  it('against an empty slot, every delta equals the candidate own bonus and the verdict is "empty"', () => {
    const sword = item('espada_curta', 'azul', 3);
    const cmp = compareItems(sword, {});
    expect(cmp.verdict).toBe('empty');
    expect(cmp.equipped).toBeNull();
    const bonus = computeEquipmentBonus(sword);
    for (const row of cmp.stats) {
      expect(row.current).toBe(0);
      expect(row.delta).toBeCloseTo(bonus[row.stat] ?? 0, 5);
    }
    expect(cmp.stats.length).toBe(Object.keys(bonus).length);
  });

  it('a higher-level copy of the equipped item is an upgrade with only non-negative deltas', () => {
    const worn = item('espada_curta', 'verde', 1);
    const better = item('espada_curta', 'verde', 10);
    const cmp = compareItems(better, { arma: worn });
    expect(cmp.verdict).toBe('upgrade');
    expect(cmp.powerDelta).toBeGreaterThan(0);
    expect(cmp.stats.length).toBeGreaterThan(0);
    for (const row of cmp.stats) expect(row.delta).toBeGreaterThanOrEqual(0);
    expect(cmp.stats.some((row) => row.delta > 0)).toBe(true);
  });

  it('the reverse swap mirrors every delta and flips the verdict', () => {
    const worn = item('espada_curta', 'verde', 10);
    const worse = item('espada_curta', 'verde', 1);
    const up = compareItems(worn, { arma: worse });
    const down = compareItems(worse, { arma: worn });
    expect(down.verdict).toBe('downgrade');
    for (const row of down.stats) {
      const mirror = up.stats.find((r) => r.stat === row.stat)!;
      expect(row.delta).toBeCloseTo(-mirror.delta, 5);
    }
  });

  it('a stat only the equipped item gives shows as a loss (next = 0)', () => {
    // Axe (attack) worn, staff (magicAttack) candidate: attack must drop to 0.
    const axe = item('machado_guerra', 'verde', 1);
    const staff = item('cajado_arcano', 'verde', 1);
    const cmp = compareItems(staff, { arma: axe });
    const atkWeight = getEquipmentTemplate('machado_guerra').statWeights.attack;
    expect(atkWeight).toBeGreaterThan(0);
    const atk = cmp.stats.find((r) => r.stat === 'attack')!;
    expect(atk.next).toBe(0);
    expect(atk.delta).toBeLessThan(0);
  });

  it('equal rarity and level reads as a sidegrade', () => {
    const cmp = compareItems(item('machado_guerra', 'azul', 4), { arma: item('espada_curta', 'azul', 4) });
    expect(cmp.verdict).toBe('sidegrade');
    expect(cmp.powerDelta).toBe(0);
  });

  it('only the candidate slot changes — other equipped slots stay out of the delta', () => {
    const armor = item('armadura_couro', 'amarelo', 5);
    const gear: EquippedGear = { armadura: armor, arma: item('espada_curta') };
    const cmp = compareItems(item('espada_curta'), gear);
    // Identical sword swapped in: nothing moves even though armor stats are in both totals.
    for (const row of cmp.stats) expect(row.delta).toBe(0);
    expect(totalGearStats(gear).defense ?? 0).toBeGreaterThan(0);
  });
});

describe('compareItems — affixes, unique powers and sets', () => {
  it('lists affixes gained and lost as a multiset difference', () => {
    const worn = item('espada_curta', 'amarelo', 1, [
      { id: 'brutalidade', value: 3 },
      { id: 'sangue', value: 0.03 },
    ]);
    const cand = item('espada_curta', 'amarelo', 1, [
      { id: 'brutalidade', value: 3 },
      { id: 'precisao', value: 0.04 },
    ]);
    const cmp = compareItems(cand, { arma: worn });
    expect(cmp.affixesGained).toEqual(['+4% de chance crítica']);
    expect(cmp.affixesLost).toEqual(['3% de roubo de vida']);
  });

  it('reports a unique power gained (and lost when swapping it out)', () => {
    const unique = UNIQUE_TEMPLATES[0];
    const passive = getItemPassive(unique.passiveId!)!;
    const plainSameSlot = { arma: 'espada_curta', armadura: 'armadura_couro', acessorio: 'anel_sorte' }[unique.slot];
    const uniqueItem = item(unique.id, unique.fixedRarity ?? 'vermelho', 10);
    const plain = item(plainSameSlot, 'verde', 1);

    const gained = compareItems(uniqueItem, { [unique.slot]: plain });
    expect(gained.passiveGained?.name).toBe(passive.name);
    expect(gained.passiveLost).toBeNull();

    const lost = compareItems(plain, { [unique.slot]: uniqueItem });
    expect(lost.passiveLost?.name).toBe(passive.name);
    expect(lost.passiveGained).toBeNull();

    const same = compareItems(item(unique.id, unique.fixedRarity ?? 'vermelho', 12), { [unique.slot]: uniqueItem });
    expect(same.passiveGained).toBeNull();
    expect(same.passiveLost).toBeNull();
  });

  it('completing a set activates its bonus — and folds its flat stats into the deltas', () => {
    const set = SET_DEFINITIONS.find((s) => s.id === 'brasas_da_pedra_vermelha')!;
    const couraca = item('couraca_das_brasas', 'amarelo', 5);
    const axe = item('machado_das_brasas', 'amarelo', 5);
    const plainAxe = item('machado_guerra', 'amarelo', 5);

    const cmp = compareItems(axe, { armadura: couraca, arma: plainAxe });
    expect(cmp.setBonusesGained).toHaveLength(1);
    expect(cmp.setBonusesGained[0]).toContain(set.name);
    expect(cmp.setBonusesLost).toEqual([]);

    const axeOnly = computeEquipmentBonus(axe).attack! - computeEquipmentBonus(plainAxe).attack!;
    const atk = cmp.stats.find((r) => r.stat === 'attack')!;
    expect(atk.delta).toBeCloseTo(axeOnly + set.bonuses[0].stats!.attack!, 5);

    const breaking = compareItems(plainAxe, { armadura: couraca, arma: axe });
    expect(breaking.setBonusesLost).toHaveLength(1);
    expect(breaking.setBonusesGained).toEqual([]);
  });
});

describe('formatDelta', () => {
  it('signs gains and losses with a pt-BR decimal comma', () => {
    expect(formatDelta(3)).toBe('+3');
    expect(formatDelta(-1.5)).toBe('-1,5');
    expect(formatDelta(0)).toBe('0');
    expect(formatDelta(0.04)).toBe('0');
    expect(formatDelta(2.25)).toBe('+2,3');
  });
});
