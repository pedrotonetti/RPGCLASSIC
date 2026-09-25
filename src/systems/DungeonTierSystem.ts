import { RARITY_ORDER, RARITY_SCORE_MULTIPLIER, RARITY_STAT_MULTIPLIER, rarityTier } from '../config/rarity';
import type { ItemRarity } from '../config/types';

/**
 * Pure, deterministic math for repeatable-dungeon tiers — the "deeper
 * endgame loop" for a dungeon a player has already cleared once (see
 * `DungeonSystem.completeDungeon`, `OverworldScreen`'s tier-picker, and
 * `Player.dungeonTiers`).
 *
 * Rather than inventing a fresh, ad-hoc set of tuning constants, tier N is
 * pinned directly to the game's own rarity ladder (config/rarity.ts,
 * established this session as verde -> azul -> amarelo -> vermelho ->
 * laranja/Mítico): tier N's monsters get exactly the stat multiplier a
 * rarity-N item already grants gear, and tier N's payout gets exactly the
 * multiplier a rarity-N item already counts for in the Power Score economy
 * (RARITY_SCORE_MULTIPLIER). This keeps the curve "clean" in the sense the
 * brief asks for — every number here already exists and was tuned for
 * exactly this kind of "how much does one step up the ladder matter"
 * question — and it hands the dungeon-clear reward item a natural way to
 * climb the SAME ladder its own rarity already lives on.
 *
 * Capped at RARITY_ORDER.length (5): a 6th tier would have no rarity above
 * laranja/Mítico left to reward, and 5 clearly-escalating tiers (verde-grade
 * up to laranja-grade monsters) is already the "handful of meaningfully
 * harder tiers" the brief calls for — nothing here needs (or supports) a
 * tier 50.
 */
export const DUNGEON_TIER_CAP = RARITY_ORDER.length;

function clampTier(tier: number): number {
  return Math.max(1, Math.min(DUNGEON_TIER_CAP, Math.round(tier)));
}

function rarityForTier(tier: number): ItemRarity {
  return RARITY_ORDER[clampTier(tier) - 1];
}

/** How much tier N multiplies a dungeon's monsters' stats (HP, attack, defense, ...) for a repeat run entered at that tier — see `Enemy`'s `tierMultiplier`. 1 at tier 1 (identical to a first-time clear). */
export function dungeonTierStatMultiplier(tier: number): number {
  return RARITY_STAT_MULTIPLIER[rarityForTier(tier)];
}

/** How much tier N multiplies a dungeon's XP/gold payout (both the guaranteed clear bonus and, via `Enemy.def`, every monster's own reward). 1 at tier 1. */
export function dungeonTierRewardMultiplier(tier: number): number {
  return RARITY_SCORE_MULTIPLIER[rarityForTier(tier)];
}

/**
 * The dungeon's guaranteed clear-reward item climbs one rung of the rarity
 * ladder per tier above 1, capped at the top (laranja/Mítico) — a dungeon
 * whose tier-1 reward is already laranja (the late-game instance) simply has
 * nowhere higher to climb, and keeps handing out its top-rarity piece at
 * every tier.
 */
export function dungeonTierRewardRarity(baseRarity: ItemRarity, tier: number): ItemRarity {
  const index = Math.min(RARITY_ORDER.length - 1, rarityTier(baseRarity) + (clampTier(tier) - 1));
  return RARITY_ORDER[index];
}

/**
 * Every tier the player may currently choose to enter at, given the best
 * tier they've already cleared for this dungeon (0 = never cleared). Always
 * starts at 1 and stops exactly one tier past their best clear — so they can
 * replay any tier they've beaten, or take the next step up, but never skip
 * ahead — capped at DUNGEON_TIER_CAP.
 */
export function selectableDungeonTiers(bestClearedTier: number): number[] {
  const highest = clampTier(Math.max(1, bestClearedTier + 1));
  return Array.from({ length: highest }, (_, i) => i + 1);
}
