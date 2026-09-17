import type { ItemRarity } from '../config/types';
import { CLASS_ZONE_THEMES } from './classZones';

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

/**
 * Three quests per class, playing out entirely in that class's own starting
 * and secondary village before the shared Chapter 1 story (QUEST_CHAIN,
 * above) picks up once the character reaches Pedravale.
 */
function buildClassPreludeQuests(): QuestDefinition[] {
  const quests: QuestDefinition[] = [];
  for (const theme of CLASS_ZONE_THEMES) {
    const q0Id = `${theme.classId}_q0_arrival`;
    const q1Id = `${theme.classId}_q1_journey`;
    const q2Id = `${theme.classId}_q2_pedravale`;
    quests.push(
      {
        id: q0Id,
        title: 'Primeiros Passos',
        description: `${theme.elderName} pede que você prove seu valor contra as criaturas que rondam ${theme.startVillageName}.`,
        giverNpcId: `${theme.classId}_elder`,
        objective: { kind: 'defeat', amount: 3 },
        rewardXp: 15,
        rewardGold: 10,
        nextQuestId: q1Id,
      },
      {
        id: q1Id,
        title: 'Rumo à Vila Secundária',
        description: `Viaje até ${theme.secondaryVillageName} e apresente-se a ${theme.mentorName}.`,
        giverNpcId: `${theme.classId}_elder`,
        objective: { kind: 'talkTo', targetId: `${theme.classId}_mentor`, amount: 1 },
        rewardXp: 25,
        rewardGold: 15,
        nextQuestId: q2Id,
      },
      {
        id: q2Id,
        title: 'Rumo a Pedravale',
        description: 'Siga a estrada até Pedravale e fale com o Guarda Bram no portão.',
        giverNpcId: `${theme.classId}_mentor`,
        objective: { kind: 'talkTo', targetId: 'bram', amount: 1 },
        rewardXp: 35,
        rewardGold: 20,
        nextQuestId: 'q1_awaken',
      },
    );
  }
  return quests;
}

export const CLASS_PRELUDE_QUESTS = buildClassPreludeQuests();

const ALL_QUESTS: QuestDefinition[] = [...CLASS_PRELUDE_QUESTS, ...QUEST_CHAIN];

export function getQuestById(id: string): QuestDefinition | undefined {
  return ALL_QUESTS.find((q) => q.id === id);
}

/** The first quest a brand-new character of this class should be given. */
export function firstQuestIdForClass(classId: string): string {
  return `${classId}_q0_arrival`;
}
