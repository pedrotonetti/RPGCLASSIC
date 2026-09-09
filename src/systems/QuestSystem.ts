import { createStarterItem } from '../data/equipment';
import { getNpcById } from '../data/npcs';
import { getQuestById, QUEST_CHAIN, type QuestDefinition } from '../data/quests';
import type { Player } from '../entities/Player';

/** Activates the very first quest the first time a fresh character enters the world. */
export function ensureQuestStarted(player: Player): void {
  if (!player.activeQuestId && player.completedQuestIds.length === 0) {
    player.activeQuestId = QUEST_CHAIN[0].id;
  }
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
