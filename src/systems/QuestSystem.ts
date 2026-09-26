import { applyChoiceEffect } from './ChoiceSystem';
import { createStarterItem } from '../data/equipment';
import { getNpcById } from '../data/npcs';
import {
  firstCallingQuestIdForClass,
  firstQuestIdForClass,
  getQuestById,
  lastCallingQuestIdForClass,
  SIDE_QUEST_STARTERS,
  type QuestDefinition,
} from '../data/quests';
import type { Player } from '../entities/Player';

/** Activates the very first quest the first time a fresh character enters the world — that class's own village prelude, not the shared main-city story. */
export function ensureQuestStarted(player: Player): void {
  if (!player.activeQuestId && player.completedQuestIds.length === 0) {
    player.activeQuestId = firstQuestIdForClass(player.classId);
  }
}

/**
 * Once QUEST_CHAIN's current end (q6_dragon) is behind the player and no
 * other quest is active, hands them the first quest of their own class's
 * personal "calling" chain in Pedravale (see CLASS_CALLING_QUESTS) — unless
 * they've already been through it. Mirrors ensureQuestStarted's idempotent,
 * call-it-every-mount style rather than gating on a one-time event.
 */
export function ensureClassCallingStarted(player: Player): void {
  if (player.activeQuestId) return;
  if (!player.completedQuestIds.includes('q6_dragon')) return;
  const firstId = firstCallingQuestIdForClass(player.classId);
  if (player.completedQuestIds.includes(firstId)) return;
  player.activeQuestId = firstId;
}

/**
 * Once a player's own class's "calling" chain (CLASS_CALLING_QUESTS) is fully
 * behind them and no other quest is active, hands them the first quest of
 * "A Sombra de Amara" (AMARA_REVEAL_QUESTS) — the class-agnostic Ato 2.5
 * reveal chain every calling chain was built to converge on. Same idempotent,
 * call-it-every-mount shape as ensureClassCallingStarted.
 */
export function ensureAmaraRevealStarted(player: Player): void {
  if (player.activeQuestId) return;
  const lastCallingId = lastCallingQuestIdForClass(player.classId);
  if (!player.completedQuestIds.includes(lastCallingId)) return;
  const firstId = 'amara_r1_evasion';
  if (player.completedQuestIds.includes(firstId)) return;
  player.activeQuestId = firstId;
}

/**
 * Once "A Sombra de Amara" (AMARA_REVEAL_QUESTS) is fully behind the player
 * and no other quest is active, hands them the first quest of Ato 3 (see
 * ACT3_QUESTS) — unless they've already made their final choice
 * (act3Ending set) or already have this quest behind them. Same idempotent,
 * call-it-every-mount shape as ensureAmaraRevealStarted.
 */
export function ensureAct3Started(player: Player): void {
  if (player.activeQuestId) return;
  if (player.act3Ending) return;
  if (!player.completedQuestIds.includes('amara_r4_confession')) return;
  const firstId = 'act3_q1_trail';
  if (player.completedQuestIds.includes(firstId)) return;
  player.activeQuestId = firstId;
}

/**
 * The two independent quest slots a player can have going at once: 'main' is
 * whatever `ensureQuestStarted`/`ensureClassCallingStarted`/
 * `ensureAmaraRevealStarted`/`ensureAct3Started` ever assign
 * (`player.activeQuestId` — the single-threaded story chain: prelude ->
 * QUEST_CHAIN -> that class's calling chain -> the Amara reveal -> Ato 3),
 * 'side' is whatever `offerSideQuest` handed out (`player.sideQuestId`) —
 * a lost NPC's chain or a bounty, running ALONGSIDE the main chain instead of
 * only ever while it sat idle. Every notify-family function below (plus
 * currentQuest/questTrackerText) walks both slots so a side quest gets
 * exactly the same progress toasts, completion rewards, and tracker/arrow
 * guidance the main chain already had — see OverworldScreen's quest-tracker
 * HUD.
 */
export type QuestSlot = 'main' | 'side';

const QUEST_SLOTS: QuestSlot[] = ['main', 'side'];

function questIdInSlot(player: Player, slot: QuestSlot): string | null {
  return slot === 'main' ? player.activeQuestId : player.sideQuestId;
}

function setQuestIdInSlot(player: Player, slot: QuestSlot, id: string | null): void {
  if (slot === 'main') player.activeQuestId = id;
  else player.sideQuestId = id;
}

/** The quest currently occupying one slot — 'main' (the default) for the story chain, 'side' for whatever `offerSideQuest` handed out. */
export function currentQuest(player: Player, slot: QuestSlot = 'main'): QuestDefinition | null {
  const id = questIdInSlot(player, slot);
  if (!id) return null;
  return getQuestById(id) ?? null;
}

/**
 * Both quests currently being tracked — the main chain first, the side quest
 * second, skipping whichever slot is empty. What `questTrackerText` and
 * `OverworldScreen`'s quest-follow arrow iterate over so a side quest running
 * alongside the main chain gets its own line/guidance too, instead of the
 * tracker only ever being able to show one quest at a time.
 */
export function activeQuests(player: Player): QuestDefinition[] {
  const out: QuestDefinition[] = [];
  for (const slot of QUEST_SLOTS) {
    const quest = currentQuest(player, slot);
    if (quest) out.push(quest);
  }
  return out;
}

function questLineFor(player: Player, quest: QuestDefinition): string {
  const obj = quest.objective;
  if (obj.kind === 'talkTo') return `${quest.title}: fale com ${getNpcById(obj.targetId!).name}`;
  if (obj.kind === 'reachLevel') return `${quest.title}: alcance o nível ${obj.amount} (atual: ${player.level})`;
  const have = player.questProgress[quest.id] ?? 0;
  const targetLabel = obj.targetId ? ` (${obj.targetId})` : '';
  return `${quest.title}: derrote inimigos${targetLabel} (${have}/${obj.amount})`;
}

/**
 * One line per currently tracked quest (main chain, then side quest if one is
 * running), newline-joined — see `activeQuests`. `OverworldScreen`'s
 * `.quest-tracker` renders this with `white-space: pre-line` so each quest
 * gets its own visual line instead of running together.
 */
export function questTrackerText(player: Player): string {
  const quests = activeQuests(player);
  if (quests.length === 0) return player.completedQuestIds.length > 0 ? 'Todas as missões concluídas — por enquanto.' : 'Nenhuma missão ativa.';
  return quests.map((quest) => questLineFor(player, quest)).join('\n');
}

function completeQuest(player: Player, quest: QuestDefinition, slot: QuestSlot): string {
  player.completedQuestIds.push(quest.id);
  setQuestIdInSlot(player, slot, quest.nextQuestId ?? null);
  player.gainXp(quest.rewardXp);
  player.gold += quest.rewardGold;
  if (quest.rewardItem) {
    player.addLoot(createStarterItem(quest.rewardItem.templateId, quest.rewardItem.rarity, Math.max(1, player.level)));
  }
  // Beyond the player's own XP/gold/item reward, some quests also nudge
  // Ipêra's own WorldState (see data/quests.ts's onCompleteEffect doc
  // comment) — applied silently here rather than folded into the toast
  // below, so the completion message's shape stays exactly what existing
  // tests (unit + e2e) already assert on.
  if (quest.onCompleteEffect) applyChoiceEffect(player, quest.onCompleteEffect);
  return `Missão concluída: ${quest.title}! +${quest.rewardXp} XP, +${quest.rewardGold} ouro${quest.rewardItem ? ', 1 item recebido' : ''}.`;
}

/**
 * Side/optional content (lost NPCs, bounty hunts — see data/quests.ts's
 * SIDE_QUESTS/SIDE_QUEST_STARTERS) doesn't get its own ensure*Started gate
 * the way the main chain does: nothing marches the player into it
 * automatically. Instead, talking to that quest's own giver NPC hands it out
 * directly — the same completedQuestIds idiom notifyTalkedTo (below) already
 * uses to COMPLETE a quest, just applied to STARTING a brand-new, unrelated
 * one. Only ever takes effect while the SIDE slot (player.sideQuestId) is
 * free — the main chain's own activeQuestId is a completely independent slot
 * and is never even read here, so a side quest can now be picked up and
 * tracked concurrently with whatever the main chain currently has active.
 * Call this BEFORE dialogueLinesFor (see OverworldScreen.openDialogue) so a
 * chain that starts on this exact conversation shows its own briefing line
 * immediately instead of the NPC's generic default dialogue.
 */
export function offerSideQuest(player: Player, npcId: string): string | null {
  if (player.sideQuestId) return null;
  for (const starter of SIDE_QUEST_STARTERS) {
    if (player.completedQuestIds.includes(starter.questId)) continue;
    if (!player.completedQuestIds.includes(starter.prerequisiteQuestId)) continue;
    const quest = getQuestById(starter.questId);
    if (!quest || quest.giverNpcId !== npcId) continue;
    player.sideQuestId = quest.id;
    return `Nova missão: ${quest.title}`;
  }
  return null;
}

export function notifyTalkedTo(player: Player, npcId: string): string | null {
  const messages: string[] = [];
  for (const slot of QUEST_SLOTS) {
    const quest = currentQuest(player, slot);
    if (!quest || quest.objective.kind !== 'talkTo') continue;
    if (quest.objective.targetId !== npcId) continue;
    messages.push(completeQuest(player, quest, slot));
  }
  return messages.length > 0 ? messages.join('\n') : null;
}

/**
 * Call once per defeated enemy after a battle victory. Always returns a
 * message when this kill counted toward a tracked objective — not just on
 * the final one — so the tracker's "(have/amount)" count changing is
 * accompanied by a toast the player actually notices mid-battle, the same
 * way completing the quest already got one. Checks BOTH quest slots (main
 * chain and side quest — see QuestSlot), since a single kill can validly
 * advance two independent `defeat` objectives at once (e.g. a main-chain
 * "derrote goblins" alongside a side-quest bounty on the same enemy id);
 * when it does, both progress/completion messages are returned, newline-
 * joined.
 */
export function notifyEnemyDefeated(player: Player, enemyId: string): string | null {
  const messages: string[] = [];
  for (const slot of QUEST_SLOTS) {
    const quest = currentQuest(player, slot);
    if (!quest || quest.objective.kind !== 'defeat') continue;
    if (quest.objective.targetId && quest.objective.targetId !== enemyId) continue;
    const have = (player.questProgress[quest.id] ?? 0) + 1;
    player.questProgress[quest.id] = have;
    if (have >= quest.objective.amount) messages.push(completeQuest(player, quest, slot));
    else messages.push(`${quest.title}: ${have}/${quest.objective.amount}`);
  }
  return messages.length > 0 ? messages.join('\n') : null;
}

/** Call after any level-up to check "reach level N" objectives, in either quest slot (see QuestSlot). */
export function notifyLevelChanged(player: Player): string | null {
  const messages: string[] = [];
  for (const slot of QUEST_SLOTS) {
    const quest = currentQuest(player, slot);
    if (!quest || quest.objective.kind !== 'reachLevel') continue;
    if (player.level < quest.objective.amount) continue;
    messages.push(completeQuest(player, quest, slot));
  }
  return messages.length > 0 ? messages.join('\n') : null;
}
