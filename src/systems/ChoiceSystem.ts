/**
 * A reusable "this decision changes something" effect — the generic engine
 * behind any dialogue/quest/event choice, so each new decision point is a
 * small data value instead of new bespoke code. Currently invoked from
 * quest completion (see `QuestDefinition.onCompleteEffect` in
 * `data/quests.ts` and `QuestSystem.ts`'s `completeQuest`) — a genuine,
 * reachable integration rather than an inert type nobody calls. The same
 * shape is meant to be reused later by a branching-dialogue UI and by
 * world events (PDF sections 3/16) without changing this file.
 */
import type { ItemRarity } from '../config/types';
import { createStarterItem } from '../data/equipment';
import type { Player } from '../entities/Player';
import { adjustFactionReputation, adjustWorldState, markEventCompleted, setFlag, setZoneState, type WorldStateAxis } from './WorldStateSystem';

export interface ChoiceEffect {
  /** Set one flag true — see WorldState.flags. */
  setFlag?: string;
  /** Delta applied to one or more WorldState axes (corruption/hope/trust/natureBalance), clamped 0..100. */
  worldStateDelta?: Partial<Record<WorldStateAxis, number>>;
  factionDelta?: { factionId: string; amount: number };
  /** For decisions that move several factions at once; applied in addition to `factionDelta`. */
  factionDeltas?: Array<{ factionId: string; amount: number }>;
  grantItem?: { templateId: string; rarity: ItemRarity };
  /** Negative values are a payment; gold never drops below 0. */
  grantGold?: number;
  /** Marks a world event resolved — see WorldState.completedEvents. */
  markEventId?: string;
  /** Labels a zone's own state (e.g. a settlement's threat resolved) — see WorldState.zoneStates and data/zones.ts's ZoneDefinition.resolvedState. */
  zoneState?: { zoneId: string; state: string };
}

/** One option of a branching quest; `summary` names what it gains AND costs. */
export interface QuestChoice {
  id: string;
  label: string;
  summary: string;
  effect: ChoiceEffect;
}

/** Applies every field an effect sets; every field is optional so a quest/event only needs to specify what it actually changes. */
export function applyChoiceEffect(player: Player, effect: ChoiceEffect): void {
  if (effect.setFlag) setFlag(player.worldState, effect.setFlag);
  if (effect.worldStateDelta) adjustWorldState(player.worldState, effect.worldStateDelta);
  if (effect.factionDelta) adjustFactionReputation(player.worldState, effect.factionDelta.factionId, effect.factionDelta.amount);
  for (const delta of effect.factionDeltas ?? []) adjustFactionReputation(player.worldState, delta.factionId, delta.amount);
  if (effect.grantItem) player.addLoot(createStarterItem(effect.grantItem.templateId, effect.grantItem.rarity, Math.max(1, player.level)));
  if (effect.grantGold) player.gold = Math.max(0, player.gold + effect.grantGold);
  if (effect.markEventId) markEventCompleted(player.worldState, effect.markEventId);
  if (effect.zoneState) setZoneState(player.worldState, effect.zoneState.zoneId, effect.zoneState.state);
}
