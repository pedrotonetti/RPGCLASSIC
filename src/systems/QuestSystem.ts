import { createStarterItem } from '../data/equipment';
import { getNpcById } from '../data/npcs';
import {
  firstCallingQuestIdForClass,
  firstQuestIdForClass,
  getQuestById,
  lastCallingQuestIdForClass,
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

export function currentQuest(player: Player): QuestDefinition | null {
  if (!player.activeQuestId) return null;
  return getQuestById(player.activeQuestId) ?? null;
}

export function questTrackerText(player: Player): string {
  const quest = currentQuest(player);
  if (!quest) return player.completedQuestIds.length > 0 ? 'Todas as missões concluídas — por enquanto.' : 'Nenhuma missão ativa.';
  const obj = quest.objective;
  if (obj.kind === 'talkTo') return `${quest.title}: fale com ${getNpcById(obj.targetId!).name}`;
  if (obj.kind === 'reachLevel') return `${quest.title}: alcance o nível ${obj.amount} (atual: ${player.level})`;
  const have = player.questProgress[quest.id] ?? 0;
  const targetLabel = obj.targetId ? ` (${obj.targetId})` : '';
  return `${quest.title}: derrote inimigos${targetLabel} (${have}/${obj.amount})`;
}

function completeQuest(player: Player, quest: QuestDefinition): string {
  player.completedQuestIds.push(quest.id);
  player.activeQuestId = quest.nextQuestId ?? null;
  player.gainXp(quest.rewardXp);
  player.gold += quest.rewardGold;
  if (quest.rewardItem) {
    player.addLoot(createStarterItem(quest.rewardItem.templateId, quest.rewardItem.rarity, Math.max(1, player.level)));
  }
  return `Missão concluída: ${quest.title}! +${quest.rewardXp} XP, +${quest.rewardGold} ouro${quest.rewardItem ? ', 1 item recebido' : ''}.`;
}

export function notifyTalkedTo(player: Player, npcId: string): string | null {
  const quest = currentQuest(player);
  if (!quest || quest.objective.kind !== 'talkTo') return null;
  if (quest.objective.targetId !== npcId) return null;
  return completeQuest(player, quest);
}

/** Call once per defeated enemy after a battle victory. */
export function notifyEnemyDefeated(player: Player, enemyId: string): string | null {
  const quest = currentQuest(player);
  if (!quest || quest.objective.kind !== 'defeat') return null;
  if (quest.objective.targetId && quest.objective.targetId !== enemyId) return null;
  const have = (player.questProgress[quest.id] ?? 0) + 1;
  player.questProgress[quest.id] = have;
  if (have >= quest.objective.amount) return completeQuest(player, quest);
  return null;
}

/** Call after any level-up to check "reach level N" objectives. */
export function notifyLevelChanged(player: Player): string | null {
  const quest = currentQuest(player);
  if (!quest || quest.objective.kind !== 'reachLevel') return null;
  if (player.level >= quest.objective.amount) return completeQuest(player, quest);
  return null;
}
