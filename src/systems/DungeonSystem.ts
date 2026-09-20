import { createStarterItem } from '../data/equipment';
import type { DungeonDefinition } from '../data/dungeons';
import type { Player } from '../entities/Player';

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
}

/** Starts tracking a fresh run of `dungeon` — call once per zone mount. */
export function startDungeonRun(dungeon: DungeonDefinition): DungeonRunState {
  return { dungeonId: dungeon.id, clearedEncounters: 0, totalEncounters: dungeon.encounters.length, bossDefeated: false };
}

/** Call once every time a fixed encounter pod is fully defeated (never twice for the same pod). Returns a new state — never mutates the input. */
export function recordEncounterCleared(state: DungeonRunState): DungeonRunState {
  return { ...state, clearedEncounters: Math.min(state.totalEncounters, state.clearedEncounters + 1) };
}

/** Short "2/3 emboscadas" style text for the HUD. */
export function encounterProgressText(state: DungeonRunState): string {
  return `Emboscadas: ${state.clearedEncounters}/${state.totalEncounters}`;
}

export interface DungeonCompletionReward {
  bonusGold: number;
  itemGranted: boolean;
  message: string;
}

/**
 * Grants the dungeon-clear bonus (guaranteed gold + a guaranteed equipment
 * piece) ON TOP OF whatever the boss's own `EnemyDefinition.xpReward`/
 * `goldReward` already paid out through the normal combat-victory path
 * (`CombatSystem.checkVictory`, exactly like any wandering monster) — this
 * is the extra "cleared the instance" payoff the design brief asks for.
 * Mutates `player` (gold + bag); returns the new run state
 * (`bossDefeated: true`) alongside a small summary for the completion
 * banner/overlay. Safe to call only once per run — callers gate on
 * `!state.bossDefeated` (see OverworldCombat's kill hook) so a boss that
 * somehow dies twice in one run (it shouldn't — see `noRespawn`) can't
 * double-grant.
 */
export function completeDungeon(player: Player, dungeon: DungeonDefinition, state: DungeonRunState): { state: DungeonRunState; reward: DungeonCompletionReward } {
  player.gold += dungeon.bonusGold;
  const itemGranted = player.addLoot(createStarterItem(dungeon.rewardItem.templateId, dungeon.rewardItem.rarity, Math.max(1, player.level)));
  const message = `${dungeon.name} concluída! +${dungeon.bonusGold} ouro bônus${itemGranted ? ', item garantido recebido' : ' (mochila cheia — item perdido)'}.`;
  return { state: { ...state, bossDefeated: true }, reward: { bonusGold: dungeon.bonusGold, itemGranted, message } };
}
