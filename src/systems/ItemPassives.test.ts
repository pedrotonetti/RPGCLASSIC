import { describe, expect, it } from 'vitest';
import { EQUIPMENT_TEMPLATES, computeEquipmentBonus, createStarterItem, getEquipmentTemplate } from '../data/equipment';
import { ITEM_PASSIVES, SET_DEFINITIONS, SET_TEMPLATES, UNIQUE_TEMPLATES, getItemPassive } from '../data/uniques';
import { Player } from '../entities/Player';
import {
  activeSetBonuses,
  collectTriggers,
  conditionHolds,
  describeItem,
  resolveItemEffects,
  setPieceCounts,
  setStatBonus,
  type EquippedGear,
  type PassiveContext,
} from './ItemPassives';

const NEUTRAL: PassiveContext = { hpFraction: 1, mpFraction: 1, meterFraction: 0, comboHits: 0, enemiesAlive: 1 };

function ctx(over: Partial<PassiveContext> = {}): PassiveContext {
  return { ...NEUTRAL, ...over };
}

function item(templateId: string, rarity: 'verde' | 'azul' | 'amarelo' | 'vermelho' | 'laranja' = 'amarelo') {
  return createStarterItem(templateId, rarity, 5, () => 0.5);
}

describe('data contract', () => {
  it('ships 6-8+ uniques, each Lendário/Mítico, with a real passive and a reusable icon', () => {
    expect(UNIQUE_TEMPLATES.length).toBeGreaterThanOrEqual(6);
    const baseIds = new Set(EQUIPMENT_TEMPLATES.map((t) => t.id));
    for (const template of UNIQUE_TEMPLATES) {
      expect(['vermelho', 'laranja']).toContain(template.fixedRarity);
      expect(getItemPassive(template.passiveId!), template.id).toBeDefined();
      expect(baseIds.has(template.iconTemplateId!), template.id).toBe(true);
      expect(getEquipmentTemplate(template.id)).toBe(template);
    }
    expect(new Set(UNIQUE_TEMPLATES.map((t) => t.passiveId)).size).toBe(UNIQUE_TEMPLATES.length);
    expect(ITEM_PASSIVES.every((p) => p.description.length > 15)).toBe(true);
  });

  it('has two small sets whose pieces point back at them and whose bonuses are reachable', () => {
    expect(SET_DEFINITIONS.length).toBeGreaterThanOrEqual(2);
    for (const set of SET_DEFINITIONS) {
      expect(set.pieces.length).toBeGreaterThanOrEqual(2);
      expect(set.pieces.length).toBeLessThanOrEqual(3);
      for (const id of set.pieces) expect(getEquipmentTemplate(id).setId).toBe(set.id);
      for (const bonus of set.bonuses) expect(bonus.pieces).toBeLessThanOrEqual(set.pieces.length);
    }
    for (const template of SET_TEMPLATES) expect(SET_DEFINITIONS.some((s) => s.id === template.setId)).toBe(true);
  });
});

describe('conditionHolds', () => {
  it('treats a missing condition as always true and requires every set field to hold', () => {
    expect(conditionHolds(undefined, ctx())).toBe(true);
    expect(conditionHolds({ hpBelow: 0.3 }, ctx({ hpFraction: 0.29 }))).toBe(true);
    expect(conditionHolds({ hpBelow: 0.3 }, ctx({ hpFraction: 0.3 }))).toBe(false);
    expect(conditionHolds({ hpAbove: 0.9, mpBelow: 0.5 }, ctx({ hpFraction: 1, mpFraction: 0.6 }))).toBe(false);
    expect(conditionHolds({ mechanic: 'flow', comboAtLeast: 4 }, ctx({ mechanicId: 'flow', comboHits: 4 }))).toBe(true);
    expect(conditionHolds({ mechanic: 'flow', comboAtLeast: 4 }, ctx({ mechanicId: 'fury', comboHits: 6 }))).toBe(false);
    expect(conditionHolds({ targetHpBelow: 0.3 }, ctx())).toBe(false);
    expect(conditionHolds({ targetHpBelow: 0.3 }, ctx({ targetHpFraction: 0.2 }))).toBe(true);
    expect(conditionHolds({ minEnemies: 3 }, ctx({ enemiesAlive: 2 }))).toBe(false);
  });
});

describe('unique passives', () => {
  it('Manto da Sede regenerates mana only while HP is under 30%', () => {
    const gear: EquippedGear = { armadura: item('manto_da_sede', 'vermelho') };
    expect(resolveItemEffects(gear, ctx({ hpFraction: 0.8 })).mods.mpRegenPct).toBe(0);
    expect(resolveItemEffects(gear, ctx({ hpFraction: 0.29 })).mods.mpRegenPct).toBe(0.08);
  });

  it('Presa do Pacto trades defense for damage: more dealt, more taken, plus lifesteal', () => {
    const { mods } = resolveItemEffects({ arma: item('presa_do_pacto', 'laranja') }, ctx());
    expect(mods.damageDealt).toBeGreaterThan(0.3);
    expect(mods.damageTaken).toBeGreaterThan(0.2);
    expect(mods.lifeSteal).toBeGreaterThan(0);
  });

  it('Selo do Eco Faminto speeds the class meter, and pays off with a full meter or Fluxo nível 2 only', () => {
    const gear: EquippedGear = { acessorio: item('selo_do_eco', 'laranja') };
    expect(resolveItemEffects(gear, ctx()).mods.meterGain).toBe(0.5);
    expect(resolveItemEffects(gear, ctx()).mods.damageDealt).toBe(0);
    expect(resolveItemEffects(gear, ctx({ meterFraction: 1, mechanicId: 'fury' })).mods.damageDealt).toBe(0.15);
    expect(resolveItemEffects(gear, ctx({ mechanicId: 'flow', comboHits: 4 })).mods.damageDealt).toBe(0.15);
    expect(resolveItemEffects(gear, ctx({ mechanicId: 'fury', comboHits: 6 })).mods.damageDealt).toBe(0);
  });

  it('Casca do Ipê Rachado always reflects, and adds damage reduction only below half HP', () => {
    const gear: EquippedGear = { armadura: item('casca_do_ipe_rachado', 'vermelho') };
    const healthy = resolveItemEffects(gear, ctx({ hpFraction: 0.9 })).mods;
    const hurt = resolveItemEffects(gear, ctx({ hpFraction: 0.4 })).mods;
    expect(healthy.thorns).toBe(0.12);
    expect(healthy.damageReduction).toBe(0);
    expect(hurt.damageReduction).toBe(0.2);
  });

  it('Gume do Orvalho only empowers a running combo', () => {
    const gear: EquippedGear = { arma: item('gume_do_orvalho', 'vermelho') };
    expect(resolveItemEffects(gear, ctx({ comboHits: 3 })).mods.damageDealt).toBe(0);
    const chained = resolveItemEffects(gear, ctx({ comboHits: 4 })).mods;
    expect(chained.damageDealt).toBe(0.25);
    expect(chained.critChance).toBe(0.08);
  });

  it('stacks affix modifiers with passives and never exceeds the global caps', () => {
    const arma = { ...item('presa_do_pacto', 'laranja'), affixes: [{ id: 'sangue', value: 0.05 }, { id: 'precisao', value: 0.05 }] };
    const acessorio = { ...item('selo_do_eco', 'laranja'), affixes: [{ id: 'sangue', value: 0.05 }] };
    const { mods } = resolveItemEffects({ arma, acessorio }, ctx());
    expect(mods.lifeSteal).toBeCloseTo(0.15);
    expect(mods.critChance).toBe(0.05);
    const stacked = resolveItemEffects({ arma: { ...arma, affixes: [{ id: 'sangue', value: 0.5 }] } }, ctx());
    expect(stacked.mods.lifeSteal).toBe(0.25);
  });

  it('applies conditional stat multipliers only while their condition holds (set bonus)', () => {
    const gear: EquippedGear = { arma: item('machado_das_brasas'), armadura: item('couraca_das_brasas') };
    expect(resolveItemEffects(gear, ctx({ hpFraction: 1 })).statMult).toEqual({});
    expect(resolveItemEffects(gear, ctx({ hpFraction: 0.4 })).statMult).toEqual({ attack: 0.2, magicAttack: 0.2 });
  });
});

describe('triggers', () => {
  it('collects only the triggers of equipped passives that match the event', () => {
    const gear: EquippedGear = { acessorio: item('coracao_de_seiva', 'vermelho'), arma: item('martelo_do_zelador', 'laranja') };
    expect(collectTriggers(gear, 'kill', ctx()).map((t) => t.label)).toEqual(['Seiva Viva']);
    expect(collectTriggers(gear, 'perfectBlock', ctx())).toHaveLength(1);
    expect(collectTriggers(gear, 'dodge', ctx())).toHaveLength(0);
    expect(collectTriggers({}, 'kill', ctx())).toHaveLength(0);
  });

  it('rolls a trigger chance with the injected rng', () => {
    const gear: EquippedGear = { acessorio: item('coracao_de_seiva', 'vermelho') };
    const passive = getItemPassive('seiva_viva')!;
    const original = passive.triggers![0].chance;
    passive.triggers![0].chance = 0.4;
    try {
      expect(collectTriggers(gear, 'kill', ctx(), () => 0.39)).toHaveLength(1);
      expect(collectTriggers(gear, 'kill', ctx(), () => 0.41)).toHaveLength(0);
    } finally {
      passive.triggers![0].chance = original;
    }
  });
});

describe('set bonuses', () => {
  const peregrino = ['cajado_do_peregrino', 'manto_do_peregrino', 'amuleto_do_peregrino'];

  it('activate by piece count: nothing at 1, the first tier at 2, the second at 3', () => {
    const one: EquippedGear = { arma: item(peregrino[0]) };
    const two: EquippedGear = { ...one, armadura: item(peregrino[1]) };
    const three: EquippedGear = { ...two, acessorio: item(peregrino[2]) };
    expect(setPieceCounts(one)).toEqual({ peregrino_do_verdegal: 1 });
    expect(activeSetBonuses(one)).toHaveLength(0);
    expect(activeSetBonuses(two).map((b) => b.bonus.pieces)).toEqual([2]);
    expect(activeSetBonuses(three).map((b) => b.bonus.pieces)).toEqual([2, 3]);
    expect(setStatBonus(one)).toEqual({});
    expect(setStatBonus(two)).toEqual({ maxMp: 15 });
    expect(resolveItemEffects(two, ctx()).mods.mpRegen).toBe(1);
    expect(resolveItemEffects(two, ctx()).mods.mpCost).toBe(0);
    expect(resolveItemEffects(three, ctx()).mods.mpCost).toBe(0.15);
    expect(collectTriggers(three, 'kill', ctx()).map((t) => t.label)).toEqual(['Fôlego do Peregrino']);
    expect(collectTriggers(two, 'kill', ctx())).toHaveLength(0);
  });

  it('do not mix between sets and ignore non-set gear', () => {
    const gear: EquippedGear = { arma: item('cajado_do_peregrino'), armadura: item('couraca_das_brasas'), acessorio: item('anel_sorte') };
    expect(setPieceCounts(gear)).toEqual({ peregrino_do_verdegal: 1, brasas_da_pedra_vermelha: 1 });
    expect(activeSetBonuses(gear)).toHaveLength(0);
  });

  it('flow into the player stats and mana economy', () => {
    const player = Player.createNew('Teste', 'mage');
    const cajado = item(peregrino[0]);
    const manto = item(peregrino[1]);
    const amuleto = item(peregrino[2]);
    player.equipment = { arma: cajado };
    const oneRegen = player.mpRegenPerSecond;
    const oneMp = player.stats.maxMp;

    player.equipment = { arma: cajado, armadura: manto };
    const mantoMp = computeEquipmentBonus(manto).maxMp ?? 0;
    expect(player.stats.maxMp).toBeCloseTo(oneMp + mantoMp + 15, 5);
    expect(player.mpRegenPerSecond).toBeGreaterThan(oneRegen + 0.99);
    expect(player.discountedSkillCost(20)).toBe(20);

    player.equipment = { arma: cajado, armadura: manto, acessorio: amuleto };
    expect(player.discountedSkillCost(20)).toBe(17);
  });
});

describe('describeItem', () => {
  it('lists affix lines, the unique passive and nothing else for a unique', () => {
    const unique = { ...item('manto_da_sede', 'vermelho'), affixes: [{ id: 'resguardo', value: 0.04 }] };
    const info = describeItem(unique, {});
    expect(info.affixLines).toEqual(['4% menos dano recebido']);
    expect(info.passive?.name).toBe('Sede Insaciável');
    expect(info.set).toBeUndefined();
  });

  it('shows set progress counting the described item as equipped, with active tiers flagged', () => {
    const gear: EquippedGear = { arma: item('cajado_do_peregrino') };
    const candidate = item('manto_do_peregrino');
    const info = describeItem(candidate, gear);
    expect(info.set).toMatchObject({ name: 'Peregrino do Verdegal', owned: 2, total: 3 });
    expect(info.set!.pieces.map((p) => p.owned)).toEqual([true, true, false]);
    expect(info.set!.bonuses.map((b) => b.active)).toEqual([true, false]);
  });

  it('is empty for a legacy item with no affixes', () => {
    expect(describeItem({ uid: 'x', templateId: 'anel_sorte', rarity: 'azul', itemLevel: 3 }, {})).toEqual({ affixLines: [] });
  });
});

describe('mana regeneration through the player', () => {
  it('Manto da Sede boosts mana regen only once HP drops below 30%', () => {
    const player = Player.createNew('Teste', 'mage');
    player.equipment = { armadura: item('manto_da_sede', 'vermelho') };
    player.currentHp = player.stats.maxHp;
    const healthy = player.mpRegenPerSecond;
    player.currentHp = Math.floor(player.stats.maxHp * 0.2);
    const desperate = player.mpRegenPerSecond;
    expect(desperate).toBeGreaterThan(healthy + player.stats.maxMp * 0.07);
  });

  it('a flat regeneration affix raises the baseline', () => {
    const player = Player.createNew('Teste', 'warrior');
    const base = player.mpRegenPerSecond;
    player.equipment = { acessorio: { ...item('anel_sorte', 'azul'), affixes: [{ id: 'fonte', value: 1.2 }] } };
    expect(player.mpRegenPerSecond).toBeCloseTo(base + 1.2, 5);
  });
});
