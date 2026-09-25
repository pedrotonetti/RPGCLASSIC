import { describe, expect, it } from 'vitest';
import { RARITY_ORDER, RARITY_SCORE_MULTIPLIER, RARITY_STAT_MULTIPLIER } from '../config/rarity';
import {
  DUNGEON_TIER_CAP,
  dungeonTierRewardMultiplier,
  dungeonTierRewardRarity,
  dungeonTierStatMultiplier,
  selectableDungeonTiers,
} from './DungeonTierSystem';

describe('DUNGEON_TIER_CAP', () => {
  it('is pinned to the rarity ladder\'s own length (one dungeon tier per rarity)', () => {
    expect(DUNGEON_TIER_CAP).toBe(RARITY_ORDER.length);
    expect(DUNGEON_TIER_CAP).toBe(5);
  });
});

describe('dungeonTierStatMultiplier', () => {
  it('is exactly 1 at tier 1 — a first-time clear scales nothing', () => {
    expect(dungeonTierStatMultiplier(1)).toBe(1);
  });

  it('matches the rarity stat multiplier of the corresponding rung of the ladder', () => {
    expect(dungeonTierStatMultiplier(2)).toBe(RARITY_STAT_MULTIPLIER.azul);
    expect(dungeonTierStatMultiplier(3)).toBe(RARITY_STAT_MULTIPLIER.amarelo);
    expect(dungeonTierStatMultiplier(4)).toBe(RARITY_STAT_MULTIPLIER.vermelho);
    expect(dungeonTierStatMultiplier(5)).toBe(RARITY_STAT_MULTIPLIER.laranja);
  });

  it('strictly increases tier over tier, with no cap-busting beyond tier 5', () => {
    const values = [1, 2, 3, 4, 5].map(dungeonTierStatMultiplier);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(dungeonTierStatMultiplier(6)).toBe(dungeonTierStatMultiplier(5));
    expect(dungeonTierStatMultiplier(50)).toBe(dungeonTierStatMultiplier(5));
  });

  it('clamps anything below 1 up to tier 1\'s multiplier', () => {
    expect(dungeonTierStatMultiplier(0)).toBe(dungeonTierStatMultiplier(1));
    expect(dungeonTierStatMultiplier(-3)).toBe(dungeonTierStatMultiplier(1));
  });
});

describe('dungeonTierRewardMultiplier', () => {
  it('is exactly 1 at tier 1', () => {
    expect(dungeonTierRewardMultiplier(1)).toBe(1);
  });

  it('matches the rarity score multiplier of the corresponding rung of the ladder', () => {
    expect(dungeonTierRewardMultiplier(2)).toBe(RARITY_SCORE_MULTIPLIER.azul);
    expect(dungeonTierRewardMultiplier(5)).toBe(RARITY_SCORE_MULTIPLIER.laranja);
  });

  it('pays out strictly more at every successive tier', () => {
    const values = [1, 2, 3, 4, 5].map(dungeonTierRewardMultiplier);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
  });
});

describe('dungeonTierRewardRarity', () => {
  it('climbs one rung of the ladder per tier above 1', () => {
    expect(dungeonTierRewardRarity('verde', 1)).toBe('verde');
    expect(dungeonTierRewardRarity('verde', 2)).toBe('azul');
    expect(dungeonTierRewardRarity('verde', 3)).toBe('amarelo');
    expect(dungeonTierRewardRarity('verde', 4)).toBe('vermelho');
    expect(dungeonTierRewardRarity('verde', 5)).toBe('laranja');
  });

  it('caps at the top of the ladder (laranja/Mítico) instead of running off the end', () => {
    expect(dungeonTierRewardRarity('vermelho', 4)).toBe('laranja');
    expect(dungeonTierRewardRarity('vermelho', 5)).toBe('laranja');
  });

  it('a dungeon whose tier-1 reward is already the top rarity stays there at every tier', () => {
    for (let tier = 1; tier <= 5; tier++) expect(dungeonTierRewardRarity('laranja', tier)).toBe('laranja');
  });
});

describe('selectableDungeonTiers', () => {
  it('offers only tier 1 when the dungeon has never been cleared', () => {
    expect(selectableDungeonTiers(0)).toEqual([1]);
  });

  it('offers every cleared tier plus exactly one new one to try next', () => {
    expect(selectableDungeonTiers(1)).toEqual([1, 2]);
    expect(selectableDungeonTiers(2)).toEqual([1, 2, 3]);
    expect(selectableDungeonTiers(4)).toEqual([1, 2, 3, 4, 5]);
  });

  it('never offers a tier past the cap, even once the cap is already cleared', () => {
    expect(selectableDungeonTiers(5)).toEqual([1, 2, 3, 4, 5]);
    expect(selectableDungeonTiers(99)).toEqual([1, 2, 3, 4, 5]);
  });
});
