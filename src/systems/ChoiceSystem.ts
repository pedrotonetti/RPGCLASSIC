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
import { adjustFactionReputation, adjustWorldState, markEventCompleted, setFlag, type WorldStateAxis } from './WorldStateSystem';

export interface ChoiceEffect {
  /** Set one flag true — see WorldState.flags. */
  setFlag?: string;
  /** Delta applied to one or more WorldState axes (corruption/hope/trust/natureBalance), clamped 0..100. */
  worldStateDelta?: Partial<Record<WorldStateAxis, number>>;
  factionDelta?: { factionId: string; amount: number };
  grantItem?: { templateId: string; rarity: ItemRarity };
  grantGold?: number;
  /** Marks a world event resolved — see WorldState.completedEvents. */
  markEventId?: string;
}

/** Applies every field an effect sets; every field is optional so a quest/event only needs to specify what it actually changes. */
export function applyChoiceEffect(player: Player, effect: ChoiceEffect): void {
  if (effect.setFlag) setFlag(player.worldState, effect.setFlag);
  if (effect.worldStateDelta) adjustWorldState(player.worldState, effect.worldStateDelta);
  if (effect.factionDelta) adjustFactionReputation(player.worldState, effect.factionDelta.factionId, effect.factionDelta.amount);
  if (effect.grantItem) player.addLoot(createStarterItem(effect.grantItem.templateId, effect.grantItem.rarity, Math.max(1, player.level)));
  if (effect.grantGold) player.gold += effect.grantGold;
  if (effect.markEventId) markEventCompleted(player.worldState, effect.markEventId);
}
