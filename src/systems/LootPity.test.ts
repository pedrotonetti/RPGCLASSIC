import { describe, expect, it } from 'vitest';
import { RARITY_ORDER, rarityTier } from '../config/rarity';
import { generateLoot, lootRarityBias, rarityOdds } from '../data/equipment';
import { Player } from '../entities/Player';
import {
  PITY_EPIC_THRESHOLD,
  PITY_LEGENDARY_THRESHOLD,
  createInitialPity,
  pityFloor,
  recordDrop,
  sanitizePity,
} from './LootPity';

function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Always rolls the very bottom of every table: Comum rarity, first template. */
const unluckyRng = () => 0;

describe('pity counters', () => {
  it('count drops without an Épico or Lendário and reset when one lands', () => {
    const pity = createInitialPity();
    recordDrop(pity, 'verde');
    recordDrop(pity, 'azul');
    expect(pity).toEqual({ sinceEpic: 2, sinceLegendary: 2 });
    recordDrop(pity, 'amarelo');
    expect(pity).toEqual({ sinceEpic: 0, sinceLegendary: 3 });
    recordDrop(pity, 'verde');
    recordDrop(pity, 'vermelho');
    expect(pity).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
  });

  it('only guarantees a floor once the threshold has been reached, Lendário taking precedence', () => {
    expect(pityFloor({ sinceEpic: PITY_EPIC_THRESHOLD - 1, sinceLegendary: 0 })).toBeNull();
    expect(pityFloor({ sinceEpic: PITY_EPIC_THRESHOLD, sinceLegendary: 0 })).toBe('amarelo');
    expect(pityFloor({ sinceEpic: PITY_EPIC_THRESHOLD, sinceLegendary: PITY_LEGENDARY_THRESHOLD })).toBe('vermelho');
  });

  it('sanitizes missing, partial and malformed saved data to safe defaults', () => {
    expect(sanitizePity(undefined)).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
    expect(sanitizePity({ sinceEpic: 4 })).toEqual({ sinceEpic: 4, sinceLegendary: 0 });
    expect(sanitizePity({ sinceEpic: -3, sinceLegendary: 'x' })).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
    expect(sanitizePity({ sinceEpic: Number.NaN, sinceLegendary: 7.9 })).toEqual({ sinceEpic: 0, sinceLegendary: 7 });
  });
});

describe('generateLoot with pity', () => {
  it('records every drop, advancing the counters on a Comum roll', () => {
    const pity = createInitialPity();
    expect(generateLoot(1, 1, 0, { rng: unluckyRng, pity }).rarity).toBe('verde');
    generateLoot(1, 1, 0, { rng: unluckyRng, pity });
    expect(pity).toEqual({ sinceEpic: 2, sinceLegendary: 2 });
  });

  it('guarantees at least Épico after N drops without one, then resets the counter', () => {
    const pity = createInitialPity();
    for (let i = 0; i < PITY_EPIC_THRESHOLD; i++) expect(generateLoot(1, 1, 0, { rng: unluckyRng, pity }).rarity).toBe('verde');
    expect(pityFloor(pity)).toBe('amarelo');

    const rng = seeded(4);
    const guaranteed = generateLoot(1, 1, 0, { rng, pity });
    expect(rarityTier(guaranteed.rarity)).toBeGreaterThanOrEqual(rarityTier('amarelo'));
    expect(pity.sinceEpic).toBe(0);
  });

  it('guarantees at least Lendário after the longer streak', () => {
    const pity = { sinceEpic: 0, sinceLegendary: PITY_LEGENDARY_THRESHOLD };
    for (let seed = 0; seed < 50; seed++) {
      const copy = { ...pity };
      expect(rarityTier(generateLoot(1, 1, 0, { rng: seeded(seed), pity: copy }).rarity)).toBeGreaterThanOrEqual(rarityTier('vermelho'));
      expect(copy.sinceLegendary).toBe(0);
    }
  });

  it('never leaves a long unlucky streak unbroken: gaps stay within the thresholds over thousands of drops', () => {
    const pity = createInitialPity();
    const rng = seeded(99);
    let sinceEpic = 0;
    let sinceLegendary = 0;
    let worstEpic = 0;
    let worstLegendary = 0;
    for (let i = 0; i < 5000; i++) {
      const { rarity } = generateLoot(1, 1, 0, { rng, pity });
      sinceEpic = rarityTier(rarity) >= 2 ? 0 : sinceEpic + 1;
      sinceLegendary = rarityTier(rarity) >= 3 ? 0 : sinceLegendary + 1;
      worstEpic = Math.max(worstEpic, sinceEpic);
      worstLegendary = Math.max(worstLegendary, sinceLegendary);
    }
    expect(worstEpic).toBeLessThanOrEqual(PITY_EPIC_THRESHOLD);
    expect(worstLegendary).toBeLessThanOrEqual(PITY_LEGENDARY_THRESHOLD);
  });

  it('without a pity object it behaves like a plain roll and touches nothing', () => {
    expect(generateLoot(1, 1, 0, { rng: unluckyRng }).rarity).toBe('verde');
  });
});

describe('rarityOdds (the transparent drop table)', () => {
  it('sums to 1 and matches the base weights at zero bias', () => {
    const odds = rarityOdds(0);
    expect(RARITY_ORDER.reduce((s, r) => s + odds[r], 0)).toBeCloseTo(1, 10);
    expect(odds.verde).toBeCloseTo(0.5, 10);
    expect(odds.laranja).toBeCloseTo(0.02, 10);
  });

  it('shifts toward rarer tiers as enemy level and luck rise', () => {
    const low = rarityOdds(lootRarityBias(1, 0));
    const high = rarityOdds(lootRarityBias(18, 6));
    expect(high.laranja).toBeGreaterThan(low.laranja);
    expect(high.verde).toBeLessThan(low.verde);
  });

  it('removes every tier below a pity floor and renormalizes the rest', () => {
    const odds = rarityOdds(2, 'amarelo');
    expect(odds.verde).toBe(0);
    expect(odds.azul).toBe(0);
    expect(RARITY_ORDER.reduce((s, r) => s + odds[r], 0)).toBeCloseTo(1, 10);
    expect(odds.amarelo).toBeGreaterThan(0);
  });
});

describe('pity persistence on the player', () => {
  it('round-trips through save data', () => {
    const player = Player.createNew('Teste', 'warrior');
    player.lootPity = { sinceEpic: 7, sinceLegendary: 23 };
    const restored = Player.fromSaveData(JSON.parse(JSON.stringify(player.toSaveData())));
    expect(restored.lootPity).toEqual({ sinceEpic: 7, sinceLegendary: 23 });
  });

  it('defaults to a fresh counter for a save from before pity existed', () => {
    const data = JSON.parse(JSON.stringify(Player.createNew('Teste', 'mage').toSaveData()));
    delete data.lootPity;
    expect(Player.fromSaveData(data).lootPity).toEqual({ sinceEpic: 0, sinceLegendary: 0 });
  });

  it('the save copy is detached from the live counter', () => {
    const player = Player.createNew('Teste', 'archer');
    const data = player.toSaveData();
    player.lootPity.sinceEpic = 5;
    expect(data.lootPity.sinceEpic).toBe(0);
  });
});
