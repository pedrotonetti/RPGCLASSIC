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
 * The main story chain — Pedravale, threatened by the Shadow Blight
 * spreading from nearby ruins. Completing one quest unlocks the next.
 */
export const QUEST_CHAIN: QuestDefinition[] = [
  {
    id: 'q1_awaken',
    title: 'Ecos das Sombras',
    description: 'O Ancião Tobias quer falar com você sobre a ameaça que paira sobre Pedravale.',
    giverNpcId: 'tobias',
    objective: { kind: 'talkTo', targetId: 'tobias', amount: 1 },
    rewardXp: 20,
    rewardGold: 10,
    nextQuestId: 'q2_first_steps',
  },
  {
    id: 'q2_first_steps',
    title: 'Primeiros Passos',
    description: 'Prove seu valor derrotando criaturas no campo aberto.',
    giverNpcId: 'tobias',
    objective: { kind: 'defeat', amount: 3 },
    rewardXp: 40,
    rewardGold: 20,
    nextQuestId: 'q3_new_blood',
  },
  {
    id: 'q3_new_blood',
    title: 'Sangue Novo',
    description: 'Continue treinando até alcançar o nível 5.',
    giverNpcId: 'tobias',
    objective: { kind: 'reachLevel', amount: 5 },
    rewardXp: 60,
    rewardGold: 30,
    rewardItem: { templateId: 'espada_curta', rarity: 'azul' },
    nextQuestId: 'q4_goblin_hunt',
  },
  {
    id: 'q4_goblin_hunt',
    title: 'Caçador de Goblins',
    description: 'Goblins corrompidos têm atacado viajantes. Derrote-os.',
    giverNpcId: 'bram',
    objective: { kind: 'defeat', targetId: 'goblin', amount: 5 },
    rewardXp: 100,
    rewardGold: 60,
    nextQuestId: 'q5_the_calling',
  },
  {
    id: 'q5_the_calling',
    title: 'O Chamado da Ruína',
    description: 'A corrupção cresce. Torne-se forte o suficiente — alcance o nível 10.',
    giverNpcId: 'tobias',
    objective: { kind: 'reachLevel', amount: 10 },
    rewardXp: 150,
    rewardGold: 100,
    rewardItem: { templateId: 'amuleto_vitalidade', rarity: 'amarelo' },
    nextQuestId: 'q6_dragon',
  },
  {
    id: 'q6_dragon',
    title: 'O Dragão Desperta',
    description: 'Um jovem dragão corrompido emergiu das ruínas. Enfrente-o.',
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
