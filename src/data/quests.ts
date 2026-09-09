import type { ItemRarity } from '../config/types';

export type QuestObjectiveKind = 'talkTo' | 'defeat' | 'reachLevel';

export interface QuestObjective {
  kind: QuestObjectiveKind;
  /** NPC id for 'talkTo', enemy id for 'defeat' (omit to accept any enemy). */
  targetId?: string;
  /** Level for 'reachLevel', kill count for 'defeat', 1 for 'talkTo'. */
  amount: number;
}

export interface QuestDefinition {
  id: string;
  title: string;
  description: string;
  giverNpcId: string;
  objective: QuestObjective;
  rewardXp: number;
  rewardGold: number;
  rewardItem?: { templateId: string; rarity: ItemRarity };
  nextQuestId?: string;
}

/**
 * Capítulo 1 de Ipêra — "O Vozeiro de Pedravale". A ameaça (a Sede) e a
 * verdade sobre o passado de Ipêra são apresentadas aos poucos; ver
 * LORE.md para a bíblia completa, incluindo a reviravolta e os ganchos
 * para os próximos capítulos. Completar uma missão libera a próxima.
 */
export const QUEST_CHAIN: QuestDefinition[] = [
  {
    id: 'q1_awaken',
    title: 'A Voz nas Raízes',
    description: 'O Ancião Tobias precisa falar com você sobre o que aconteceu ontem à noite.',
    giverNpcId: 'tobias',
    objective: { kind: 'talkTo', targetId: 'tobias', amount: 1 },
    rewardXp: 20,
    rewardGold: 10,
    nextQuestId: 'q2_first_steps',
  },
  {
    id: 'q2_first_steps',
    title: 'Ouvir as Raízes',
    description: 'Enfrente as criaturas corrompidas pela Sede que rondam o campo aberto.',
    giverNpcId: 'tobias',
    objective: { kind: 'defeat', amount: 3 },
    rewardXp: 40,
    rewardGold: 20,
    nextQuestId: 'q3_new_blood',
  },
  {
    id: 'q3_new_blood',
    title: 'Sangue de Vozeiro',
    description: 'Seu dom ainda é fraco. Continue treinando até alcançar o nível 5.',
    giverNpcId: 'tobias',
    objective: { kind: 'reachLevel', amount: 5 },
    rewardXp: 60,
    rewardGold: 30,
    rewardItem: { templateId: 'espada_curta', rarity: 'azul' },
    nextQuestId: 'q4_goblin_hunt',
  },
  {
    id: 'q4_goblin_hunt',
    title: 'Rastros da Sede',
    description: 'Goblins corrompidos pela Sede têm atacado viajantes nas trilhas. Detenha-os.',
    giverNpcId: 'bram',
    objective: { kind: 'defeat', targetId: 'goblin', amount: 5 },
    rewardXp: 100,
    rewardGold: 60,
    nextQuestId: 'q5_the_calling',
  },
  {
    id: 'q5_the_calling',
    title: 'O Peso do Dom',
    description: 'A Sede se espalha mais rápido do que Tobias esperava. Torne-se forte o suficiente — alcance o nível 10.',
    giverNpcId: 'tobias',
    objective: { kind: 'reachLevel', amount: 10 },
    rewardXp: 150,
    rewardGold: 100,
    rewardItem: { templateId: 'amuleto_vitalidade', rarity: 'amarelo' },
    nextQuestId: 'q6_dragon',
  },
  {
    id: 'q6_dragon',
    title: 'O Guardião Corrompido',
    description: 'Um antigo guardião das ruínas, corrompido pela Sede há gerações, despertou. Enfrente-o — e talvez, ao ouvi-lo morrer, entenda algo que Tobias nunca lhe contou.',
    giverNpcId: 'tobias',
    objective: { kind: 'defeat', targetId: 'young_dragon', amount: 1 },
    rewardXp: 400,
    rewardGold: 300,
    rewardItem: { templateId: 'anel_sorte', rarity: 'laranja' },
  },
];

export function getQuestById(id: string): QuestDefinition | undefined {
  return QUEST_CHAIN.find((q) => q.id === id);
}
