import { describe, expect, it } from 'vitest';
import { DUNGEON_MODIFIERS, getDungeonModifier } from '../data/dungeonModifiers';
import { DUNGEON_DEFINITIONS, getDungeonById } from '../data/dungeons';
import {
  FEATURED_REWARD_BONUS,
  combineDungeonModifiers,
  dayIndex,
  featuredModifierForDay,
  formatRewardBonus,
  mixSeed,
  modifierCountForTier,
  planDungeonRun,
  seededRng,
} from './DungeonModifierSystem';
import { DUNGEON_TIER_CAP } from './DungeonTierSystem';

describe('DUNGEON_MODIFIERS data', () => {
  it('has unique ids, Portuguese names/descriptions and a positive reward bonus each', () => {
    const ids = DUNGEON_MODIFIERS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DUNGEON_MODIFIERS.length).toBeGreaterThanOrEqual(6);
    for (const m of DUNGEON_MODIFIERS) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.description.length).toBeGreaterThan(0);
      expect(m.rewardBonus).toBeGreaterThan(0);
      expect(Object.keys(m.effects).length).toBeGreaterThan(0);
    }
  });

  it('covers the brief: death bursts, reduced healing, extra elite, faster enemies, crit-for-damage trade', () => {
    const effects = DUNGEON_MODIFIERS.map((m) => m.effects);
    expect(effects.some((e) => e.deathBurst?.burn)).toBe(true);
    expect(effects.some((e) => (e.healingMult ?? 1) < 1)).toBe(true);
    expect(effects.some((e) => (e.extraElites ?? 0) > 0)).toBe(true);
    expect(effects.some((e) => (e.enemyActionIntervalMult ?? 1) < 1)).toBe(true);
    expect(effects.some((e) => (e.playerMods?.critChance ?? 0) > 0 && (e.playerMods?.damageTaken ?? 0) > 0)).toBe(true);
  });
});

describe('seeded RNG helpers', () => {
  it('seededRng is deterministic and stays in [0, 1)', () => {
    const a = seededRng(1234);
    const b = seededRng(1234);
    for (let i = 0; i < 50; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('mixSeed changes with every part', () => {
    expect(mixSeed(1, 2, 3)).toBe(mixSeed(1, 2, 3));
    expect(mixSeed(1, 2, 3)).not.toBe(mixSeed(1, 2, 4));
    expect(mixSeed(1, 2, 3)).not.toBe(mixSeed(3, 2, 1));
  });

  it('dayIndex is the local calendar day — same all day long, +1 the next day', () => {
    const morning = new Date(2026, 9, 11, 0, 5);
    const night = new Date(2026, 9, 11, 23, 55);
    const nextDay = new Date(2026, 9, 12, 0, 1);
    expect(dayIndex(morning)).toBe(dayIndex(night));
    expect(dayIndex(nextDay)).toBe(dayIndex(morning) + 1);
  });
});

describe('Distorção do dia', () => {
  it('is fixed for a given day and comes from the table', () => {
    const day = dayIndex(new Date(2026, 9, 11));
    expect(featuredModifierForDay(day).id).toBe(featuredModifierForDay(day).id);
    expect(DUNGEON_MODIFIERS).toContain(featuredModifierForDay(day));
  });

  it('rotates — a month of days features more than one modifier', () => {
    const start = dayIndex(new Date(2026, 0, 1));
    const seen = new Set(Array.from({ length: 30 }, (_, i) => featuredModifierForDay(start + i).id));
    expect(seen.size).toBeGreaterThan(2);
  });
});

describe('planDungeonRun', () => {
  const day = dayIndex(new Date(2026, 9, 11));

  it('rolls 1 modifier at tier 1, up to 3 at the top tiers — never repeating one', () => {
    expect(modifierCountForTier(1)).toBe(1);
    expect(modifierCountForTier(DUNGEON_TIER_CAP)).toBe(3);
    for (let tier = 1; tier <= DUNGEON_TIER_CAP; tier++) {
      expect(modifierCountForTier(tier)).toBeGreaterThanOrEqual(modifierCountForTier(Math.max(1, tier - 1)));
      for (const dungeon of DUNGEON_DEFINITIONS) {
        const plan = planDungeonRun(dungeon, tier, day);
        expect(plan.modifierIds.length).toBe(modifierCountForTier(tier));
        expect(new Set(plan.modifierIds).size).toBe(plan.modifierIds.length);
        for (const id of plan.modifierIds) expect(getDungeonModifier(id)).toBeDefined();
      }
    }
  });

  it('always includes the Distorção do dia', () => {
    for (let d = day; d < day + 10; d++) {
      const plan = planDungeonRun(getDungeonById('root_hollow'), 3, d);
      expect(plan.featuredId).toBe(featuredModifierForDay(d).id);
      expect(plan.modifierIds).toContain(plan.featuredId);
    }
  });

  it('is deterministic per (dungeon, tier, day) — reopening the portal cannot reroll', () => {
    const dungeon = getDungeonById('rotten_sap_gallery');
    expect(planDungeonRun(dungeon, 4, day)).toEqual(planDungeonRun(dungeon, 4, day));
    expect(planDungeonRun(dungeon, 4, day).seed).not.toBe(planDungeonRun(dungeon, 4, day + 1).seed);
    expect(planDungeonRun(dungeon, 4, day).seed).not.toBe(planDungeonRun(getDungeonById('root_hollow'), 4, day).seed);
  });
});

describe('combineDungeonModifiers', () => {
  it('is neutral with no modifiers', () => {
    const c = combineDungeonModifiers([]);
    expect(c).toEqual({
      playerMods: {},
      healingMult: 1,
      enemyStatMult: 1,
      enemyActionIntervalMult: 1,
      enemyChaseSpeedMult: 1,
      deathBurst: null,
      extraElites: 0,
      rewardBonus: 0,
    });
  });

  it('sums player mods and reward bonuses, multiplies the multipliers', () => {
    const c = combineDungeonModifiers(['fio_da_navalha', 'sede_voraz', 'seiva_amarga', 'casca_endurecida', 'brasas_vingativas', 'sentinela_desperta']);
    expect(c.playerMods.damageTaken).toBeCloseTo(0.4);
    expect(c.playerMods.critChance).toBeCloseTo(0.15);
    expect(c.playerMods.damageDealt).toBeCloseTo(0.15);
    expect(c.healingMult).toBeCloseTo(0.6);
    expect(c.enemyStatMult).toBeCloseTo(1.25);
    expect(c.deathBurst).toEqual({ maxHpPct: 0.05, burn: true });
    expect(c.extraElites).toBe(1);
    const expected = ['fio_da_navalha', 'sede_voraz', 'seiva_amarga', 'casca_endurecida', 'brasas_vingativas', 'sentinela_desperta']
      .map((id) => getDungeonModifier(id)!.rewardBonus)
      .reduce((a, b) => a + b, 0);
    expect(c.rewardBonus).toBeCloseTo(expected);
  });

  it('pays the featured bonus only when the featured modifier is active', () => {
    const base = combineDungeonModifiers(['frenesi_das_raizes']).rewardBonus;
    expect(combineDungeonModifiers(['frenesi_das_raizes'], 'frenesi_das_raizes').rewardBonus).toBeCloseTo(base + FEATURED_REWARD_BONUS);
    expect(combineDungeonModifiers(['frenesi_das_raizes'], 'seiva_amarga').rewardBonus).toBeCloseTo(base);
  });

  it('ignores unknown ids (e.g. a modifier removed in a later build)', () => {
    expect(combineDungeonModifiers(['nao_existe']).rewardBonus).toBe(0);
  });

  it('formats the reward bonus as a percentage', () => {
    expect(formatRewardBonus(0.33)).toBe('+33%');
  });
});
