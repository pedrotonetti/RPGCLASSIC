import { createStarterItem } from '../data/equipment';
import type { DungeonDefinition } from '../data/dungeons';
import type { Player } from '../entities/Player';
import { dungeonTierRewardMultiplier, dungeonTierRewardRarity } from './DungeonTierSystem';

/**
 * Pure, THREE.js-free bookkeeping for one dungeon visit — kept separate from
 * `OverworldCombat`'s three.js/DOM-heavy monster AI so encounter progression
 * and the boss-completion payoff stay unit-testable in isolation (see
 * `DungeonSystem.test.ts`). `OverworldScreen`/`OverworldCombat` own the
 * actual monster spawning and call into this module at the right hooks
 * (a fixed encounter's last monster dying, the boss dying).
 */
export interface DungeonRunState {
  dungeonId: string;
  clearedEncounters: number;
  totalEncounters: number;
  bossDefeated: boolean;
  /** Which repeatable tier this run was entered at (see DungeonTierSystem) — 1 for a first-time clear or any run entered without picking a higher one. */
  tier: number;
}

/** Starts tracking a fresh run of `dungeon` at the given tier (1 by default — a first-time clear, or a tier-1 replay) — call once per zone mount. */
export function startDungeonRun(dungeon: DungeonDefinition, tier = 1): DungeonRunState {
  return { dungeonId: dungeon.id, clearedEncounters: 0, totalEncounters: dungeon.encounters.length, bossDefeated: false, tier: Math.max(1, Math.round(tier)) };
}

/** Call once every time a fixed encounter pod is fully defeated (never twice for the same pod). Returns a new state — never mutates the input. */
export function recordEncounterCleared(state: DungeonRunState): DungeonRunState {
  return { ...state, clearedEncounters: Math.min(state.totalEncounters, state.clearedEncounters + 1) };
}

/** Short "2/3 emboscadas" style text for the HUD — appends the run's tier only when it's above 1, so a first-time (tier-1) run's HUD text is byte-for-byte unchanged. */
export function encounterProgressText(state: DungeonRunState): string {
  const base = `Emboscadas: ${state.clearedEncounters}/${state.totalEncounters}`;
  return state.tier > 1 ? `${base} · Tier ${state.tier}` : base;
}

export interface DungeonCompletionReward {
  bonusGold: number;
  itemGranted: boolean;
  message: string;
  /** Which tier this clear paid out at (see DungeonTierSystem) — 1 for an ordinary/first-time clear. */
  tier: number;
}

/**
 * Grants the dungeon-clear bonus (guaranteed gold + a guaranteed equipment
 * piece) ON TOP OF whatever the boss's own `EnemyDefinition.xpReward`/
 * `goldReward` already paid out through the normal combat-victory path
 * (`CombatSystem.checkVictory`, exactly like any wandering monster) — this
 * is the extra "cleared the instance" payoff the design brief asks for.
 * Both the bonus gold and the reward item's rarity scale up with
 * `state.tier` (see DungeonTierSystem) — at tier 1 (a first-time clear, or
 * an ordinary tier-1 replay) the multiplier is exactly 1 and the rarity is
 * exactly `dungeon.rewardItem.rarity`, so this is byte-for-byte the same
 * payout a fresh clear always granted. Also records this dungeon's new
 * best-cleared tier on `player.dungeonTiers` (never lowering it), which is
 * what unlocks the next tier's entry at the portal and what RankingScreen's
 * "highest tier cleared" readout shows.
 * Mutates `player` (gold + bag + dungeonTiers); returns the new run state
 * (`bossDefeated: true`) alongside a small summary for the completion
 * banner/overlay. Safe to call only once per run — callers gate on
 * `!state.bossDefeated` (see OverworldCombat's kill hook) so a boss that
 * somehow dies twice in one run (it shouldn't — see `noRespawn`) can't
 * double-grant.
 */
export function completeDungeon(player: Player, dungeon: DungeonDefinition, state: DungeonRunState): { state: DungeonRunState; reward: DungeonCompletionReward } {
  const tier = state.tier;
  const bonusGold = Math.round(dungeon.bonusGold * dungeonTierRewardMultiplier(tier));
  player.gold += bonusGold;
  const rarity = dungeonTierRewardRarity(dungeon.rewardItem.rarity, tier);
  const itemGranted = player.addLoot(createStarterItem(dungeon.rewardItem.templateId, rarity, Math.max(1, player.level)));
  player.dungeonTiers[dungeon.id] = Math.max(player.dungeonTiers[dungeon.id] ?? 0, tier);
  const tierSuffix = tier > 1 ? ` (Tier ${tier})` : '';
  const message = `${dungeon.name}${tierSuffix} concluída! +${bonusGold} ouro bônus${itemGranted ? ', item garantido recebido' : ' (mochila cheia — item perdido)'}.`;
  return { state: { ...state, bossDefeated: true }, reward: { bonusGold, itemGranted, message, tier } };
}
