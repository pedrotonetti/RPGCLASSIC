import { describe, expect, it } from 'vitest';
import { rarityTier } from '../config/rarity';
import { generateLoot } from './equipment';

const SAMPLE_SIZE = 2000;

/** Average item level and average rarity tier (0=verde..4=laranja) over many rolls, to compare distributions without depending on any single seed. */
function sampleAverages(enemyLevel: number, characterLevel: number, luckBias = 0): { avgItemLevel: number; avgRarityTier: number } {
  let levelSum = 0;
  let tierSum = 0;
  for (let i = 0; i < SAMPLE_SIZE; i++) {
    const item = generateLoot(enemyLevel, characterLevel, luckBias);
    levelSum += item.itemLevel;
    tierSum += rarityTier(item.rarity);
  }
  return { avgItemLevel: levelSum / SAMPLE_SIZE, avgRarityTier: tierSum / SAMPLE_SIZE };
}

describe('generateLoot: enemy-tier-driven scaling', () => {
  it('a much higher-tier enemy drops a statistically higher average item level than a low-tier one, at the same player level', () => {
    const low = sampleAverages(1, 10, 0);
    const high = sampleAverages(18, 10, 0);
    // Wide margin (well above the +/-1 per-roll jitter's noise at this sample size) so this cannot flake.
    expect(high.avgItemLevel).toBeGreaterThan(low.avgItemLevel + 5);
  });

  it('a much higher-tier enemy also skews toward rarer drops on average than a low-tier one, at equal luck', () => {
    const low = sampleAverages(1, 10, 2);
    const high = sampleAverages(18, 10, 2);
    expect(high.avgRarityTier).toBeGreaterThan(low.avgRarityTier + 0.3);
  });

  it('the defeated enemy dominates item level over the player\'s own level: an under-leveled player who takes down a tough enemy out-drops an over-leveled player stomping a trivial one', () => {
    const strugglingPlayerToughKill = sampleAverages(18, 3, 0); // level-3 player vs. a level-18 enemy
    const overleveledPlayerTrivialKill = sampleAverages(1, 30, 0); // level-30 player vs. a level-1 enemy
    expect(strugglingPlayerToughKill.avgItemLevel).toBeGreaterThan(overleveledPlayerTrivialKill.avgItemLevel);
  });

  it('item level is always at least 1, even for the lowest enemy/player levels', () => {
    for (let i = 0; i < 300; i++) {
      const item = generateLoot(1, 1, 0);
      expect(item.itemLevel).toBeGreaterThanOrEqual(1);
    }
  });
});
