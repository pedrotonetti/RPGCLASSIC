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

/**
 * "O Chamado" — each class's personal 2-3 quest coda in Pedravale itself,
 * unlocked once QUEST_CHAIN's current end (q6_dragon) is complete. These run
 * entirely in parallel across classes (a warrior never sees a mage's chain,
 * and vice versa) but each is built from that class's own hook — see the
 * design brief in the task that produced this file — and each one's last
 * quest ends on a line that visibly gestures at Tobias hiding something
 * about the Zeladores da Raiz, without staging that reveal itself: eight
 * threads converging on the same secret, left for a future pass to pay off.
 * See QuestSystem.ensureClassCallingStarted for how a chain is triggered.
 */
export const CLASS_CALLING_QUESTS: QuestDefinition[] = [
  // --- Guerreiro: o comboio de refugiados -------------------------------
  {
    id: 'warrior_pc1_convoy',
    title: 'O Comboio em Fuga',
    description:
      'O Comandante Gael mandou uma mensageira à frente de um comboio de refugiados que foge do Forte de Ferro para Pedravale. Encontre-a nos portões da vila.',
    giverNpcId: 'doroteia_comboio',
    objective: { kind: 'talkTo', targetId: 'doroteia_comboio', amount: 1 },
    rewardXp: 60,
    rewardGold: 40,
    nextQuestId: 'warrior_pc2_convoy_defense',
  },
  {
    id: 'warrior_pc2_convoy_defense',
    title: 'Escoltar sob a Sede',
    description:
      'Bandos de lobos corrompidos seguem o rastro do comboio pela trilha. Afaste-os antes que alcancem os portões de Pedravale.',
    giverNpcId: 'doroteia_comboio',
    objective: { kind: 'defeat', targetId: 'dark_wolf', amount: 6 },
    rewardXp: 220,
    rewardGold: 140,
    rewardItem: { templateId: 'machado_guerra', rarity: 'azul' },
    nextQuestId: 'warrior_pc3_first_line',
  },
  {
    id: 'warrior_pc3_first_line',
    title: 'Primeira Linha de Defesa',
    description:
      'Gael tinha razão: Pedravale nunca teve uma guarda de verdade. Enquanto você treina para ser essa linha de frente, o Ancião Tobias começa a evitar perguntas sobre como a cidade vai se proteger de algo maior que lobos e bandidos.',
    giverNpcId: 'doroteia_comboio',
    objective: { kind: 'reachLevel', amount: 13 },
    rewardXp: 320,
    rewardGold: 220,
  },

  // --- Mago: o pergaminho que só reage a um Vozeiro ---------------------
  {
    id: 'mage_pc1_scroll',
    title: 'O Pergaminho Selado',
    description:
      'Um mensageiro da Torre dos Arcanos chegou com um pergaminho que nenhuma mana consegue abrir. O Magíster Orin suspeita que só reage a um Vozeiro.',
    giverNpcId: 'correio_bento',
    objective: { kind: 'talkTo', targetId: 'correio_bento', amount: 1 },
    rewardXp: 60,
    rewardGold: 40,
    nextQuestId: 'mage_pc2_attune',
  },
  {
    id: 'mage_pc2_attune',
    title: 'Afinar a Própria Voz',
    description:
      'O selo do pergaminho não cede à magia comum. Aprofunde seu próprio dom de Vozeiro até que ele reconheça sua voz.',
    giverNpcId: 'correio_bento',
    objective: { kind: 'reachLevel', amount: 14 },
    rewardXp: 220,
    rewardGold: 140,
    rewardItem: { templateId: 'cajado_arcano', rarity: 'azul' },
    nextQuestId: 'mage_pc3_seal_broken',
  },
  {
    id: 'mage_pc3_seal_broken',
    title: 'O Selo se Rompe',
    description:
      'Quando o pergaminho enfim se abre sob sua voz, esqueletos guardiões despertam para proteger o que sobrou do selo. Os símbolos entalhados no pergaminho, porém, são os mesmos riscos das vigas mais velhas da casa do Ancião Tobias — e ele nunca disse que sabia lê-los.',
    giverNpcId: 'correio_bento',
    objective: { kind: 'defeat', targetId: 'skeleton', amount: 6 },
    rewardXp: 320,
    rewardGold: 220,
  },

  // --- Arqueiro: rastros que fogem em vez de atacar ---------------------
  {
    id: 'archer_pc1_trail',
    title: 'Rastros ao Contrário',
    description:
      'Caçador Ren jura ter visto criaturas corrompidas fugindo de Pedravale em vez de atacar — todas na mesma direção, como se algo as chamasse.',
    giverNpcId: 'cacador_ren',
    objective: { kind: 'talkTo', targetId: 'cacador_ren', amount: 1 },
    rewardXp: 60,
    rewardGold: 40,
    nextQuestId: 'archer_pc2_intercept',
  },
  {
    id: 'archer_pc2_intercept',
    title: 'Interceptar a Fuga',
    description:
      'Intercepte os goblins em fuga antes que cheguem longe demais para rastrear. Talvez o padrão da fuga guarde uma pista de para onde — e para quem — estão indo.',
    giverNpcId: 'cacador_ren',
    objective: { kind: 'defeat', targetId: 'goblin', amount: 6 },
    rewardXp: 220,
    rewardGold: 140,
    rewardItem: { templateId: 'arco_longo', rarity: 'azul' },
    nextQuestId: 'archer_pc3_source',
  },
  {
    id: 'archer_pc3_source',
    title: 'O Chamado sob a Serra',
    description:
      'O rastro termina sempre no mesmo ponto: as raízes mais fundas sob Pedravale, perto de onde o Ancião Tobias guarda os registros mais antigos da vila. Ren jura já ter visto Tobias lá embaixo, uma vez, há anos — e nunca mais tocou no assunto.',
    giverNpcId: 'cacador_ren',
    objective: { kind: 'reachLevel', amount: 13 },
    rewardXp: 320,
    rewardGold: 220,
  },

  // --- Clériga/o: as Raízes do ipezal gritando ---------------------------
  {
    id: 'cleric_pc1_scream',
    title: 'O Grito nas Raízes',
    description:
      'A Zeladora Sable sente as Raízes do ipezal de Pedravale gritando, não sussurrando — algo que só um curador de verdade percebe.',
    giverNpcId: 'zeladora_sable',
    objective: { kind: 'talkTo', targetId: 'zeladora_sable', amount: 1 },
    rewardXp: 60,
    rewardGold: 40,
    nextQuestId: 'cleric_pc2_soothe',
  },
  {
    id: 'cleric_pc2_soothe',
    title: 'Acalmar o Ipezal',
    description:
      'Criaturas corrompidas rondam o ipezal, atraídas pelo mesmo grito que você ouve. Afaste-as para que as Raízes possam ser ouvidas em paz.',
    giverNpcId: 'zeladora_sable',
    objective: { kind: 'defeat', amount: 5 },
    rewardXp: 220,
    rewardGold: 140,
    rewardItem: { templateId: 'manto_sagrado', rarity: 'azul' },
    nextQuestId: 'cleric_pc3_warning',
  },
  {
    id: 'cleric_pc3_warning',
    title: 'A Mensagem nas Raízes',
    description:
      'Quando finalmente ouve por inteiro o que as Raízes gritam, não é sobre a Sede que avança lá fora — é um nome. Um nome que o Ancião Tobias reconhece na hora, e que apaga do rosto antes que você pergunte o que significa.',
    giverNpcId: 'zeladora_sable',
    objective: { kind: 'reachLevel', amount: 13 },
    rewardXp: 320,
    rewardGold: 220,
  },

  // --- Paladino: o juramento esquecido dos Zeladores --------------------
  {
    id: 'paladin_pc1_oath',
    title: 'O Juramento nos Arquivos',
    description:
      'O Escrivão Aldo encontrou, nos arquivos mais velhos de Pedravale, um voto esquecido feito pelos lendários Zeladores da Raiz.',
    giverNpcId: 'escrivao_aldo',
    objective: { kind: 'talkTo', targetId: 'escrivao_aldo', amount: 1 },
    rewardXp: 60,
    rewardGold: 40,
    nextQuestId: 'paladin_pc2_worthy',
  },
  {
    id: 'paladin_pc2_worthy',
    title: 'Provar-se Digno',
    description:
      'Reativar um juramento antigo não é decisão de escrivão — é decisão de quem carrega honra o bastante para jurá-lo de novo. Prove que você carrega essa força.',
    giverNpcId: 'escrivao_aldo',
    objective: { kind: 'reachLevel', amount: 14 },
    rewardXp: 220,
    rewardGold: 140,
    nextQuestId: 'paladin_pc3_reactivate',
  },
  {
    id: 'paladin_pc3_reactivate',
    title: 'O Juramento Reativado',
    description:
      'Diante do templo, você jura reativar o voto dos Zeladores da Raiz contra orcs corrompidos que testam a decisão com aço. Ao dizer as palavras em voz alta, sente que alguém em Pedravale já as ouviu antes — e percebe, pelo silêncio súbito do Ancião Tobias, que esse alguém pode ser ele.',
    giverNpcId: 'escrivao_aldo',
    objective: { kind: 'defeat', targetId: 'orc', amount: 6 },
    rewardXp: 320,
    rewardGold: 220,
    rewardItem: { templateId: 'martelo_sagrado', rarity: 'azul' },
  },

  // --- Assassina/o: espiões disfarçados em Pedravale ---------------------
  {
    id: 'assassin_pc1_watch',
    title: 'Rostos Estranhos',
    description:
      'A Vigia Talma, chefe da guarda de Pedravale, suspeita que rostos desconhecidos andam entrando na vila fazendo perguntas que não deveriam fazer.',
    giverNpcId: 'vigia_talma',
    objective: { kind: 'talkTo', targetId: 'vigia_talma', amount: 1 },
    rewardXp: 60,
    rewardGold: 40,
    nextQuestId: 'assassin_pc2_shadow',
  },
  {
    id: 'assassin_pc2_shadow',
    title: 'Desmascarar as Sombras',
    description:
      'Espiões disfarçados de mercadores e bandidos se escondem entre os moradores. Confronte-os antes que reportem o que virem sobre você.',
    giverNpcId: 'vigia_talma',
    objective: { kind: 'defeat', targetId: 'bandit', amount: 6 },
    rewardXp: 220,
    rewardGold: 140,
    rewardItem: { templateId: 'adaga_sombria', rarity: 'azul' },
    nextQuestId: 'assassin_pc3_mask',
  },
  {
    id: 'assassin_pc3_mask',
    title: 'O Nome que Ninguém Diz',
    description:
      'Um dos espiões, antes de fugir, sussurra um nome que você só conhecia de rumores: Ilva. Quando você repete o nome para o Ancião Tobias, ele troca de assunto rápido demais para ser coincidência.',
    giverNpcId: 'vigia_talma',
    objective: { kind: 'reachLevel', amount: 13 },
    rewardXp: 320,
    rewardGold: 220,
  },

  // --- Necromante: ouvir as Raízes corrompidas apavora a vila ------------
  {
    id: 'necromancer_pc1_fear',
    title: 'O Medo da Vila',
    description:
      'Dona Ilma, moradora de Pedravale, vem até você — sem raiva, só medo. As crianças não dormem desde que ouviram você "conversando" sozinho perto do ipezal velho.',
    giverNpcId: 'dona_ilma',
    objective: { kind: 'talkTo', targetId: 'dona_ilma', amount: 1 },
    rewardXp: 60,
    rewardGold: 40,
    nextQuestId: 'necromancer_pc2_prove',
  },
  {
    id: 'necromancer_pc2_prove',
    title: 'Provar o Controle',
    description:
      'Mostre a Pedravale que ouvir as Raízes corrompidas não é o mesmo que servir a elas — detenha as criaturas que rondam a vila à noite.',
    giverNpcId: 'dona_ilma',
    objective: { kind: 'defeat', amount: 6 },
    rewardXp: 220,
    rewardGold: 140,
    rewardItem: { templateId: 'grimorio_amaldicoado', rarity: 'azul' },
    nextQuestId: 'necromancer_pc3_trust',
  },
  {
    id: 'necromancer_pc3_trust',
    title: 'Confiança Emprestada',
    description:
      'A vila ainda cochicha quando você passa, mas já não fecha as portas. Só o Ancião Tobias evita seu olhar de um jeito diferente dos outros — não parece medo do que você ouve. Parece mais... culpa.',
    giverNpcId: 'dona_ilma',
    objective: { kind: 'reachLevel', amount: 14 },
    rewardXp: 320,
    rewardGold: 220,
  },

  // --- Monge: sentir o desequilíbrio da Sede antes de vê-lo --------------
  {
    id: 'monk_pc1_imbalance',
    title: 'A Dor que Ninguém Vê',
    description:
      'O Andarilho Ossian, um monge peregrino de passagem por Pedravale, reconhece de longe uma dor que não é do corpo: é do chi, do mesmo jeito que a Sede o desequilibra por dentro.',
    giverNpcId: 'andarilho_ossian',
    objective: { kind: 'talkTo', targetId: 'andarilho_ossian', amount: 1 },
    rewardXp: 60,
    rewardGold: 40,
    nextQuestId: 'monk_pc2_discipline',
  },
  {
    id: 'monk_pc2_discipline',
    title: 'Disciplinar o Alarme',
    description:
      'Se seu corpo sente a Sede antes dos olhos verem, ele é o alarme mais cedo que Pedravale tem. Aprenda a suportá-lo sem se perder na dor que carrega.',
    giverNpcId: 'andarilho_ossian',
    objective: { kind: 'reachLevel', amount: 13 },
    rewardXp: 220,
    rewardGold: 140,
    rewardItem: { templateId: 'manoplas_combate', rarity: 'azul' },
    nextQuestId: 'monk_pc3_alarm',
  },
  {
    id: 'monk_pc3_alarm',
    title: 'A Escalada Sentida',
    description:
      'Você sente a próxima escalada da Sede horas antes de qualquer sinal visível — aranhas gigantes corrompidas se juntando na borda do campo — e corre para intercep-las. Quando volta, encontra o Ancião Tobias sentado sozinho, olhando o horizonte como quem já viveu esse aviso antes.',
    giverNpcId: 'andarilho_ossian',
    objective: { kind: 'defeat', targetId: 'giant_spider', amount: 6 },
    rewardXp: 320,
    rewardGold: 220,
  },
];

/**
 * "A Sombra de Amara" — Ato 2.5's opening reveal chain: the convergence point
 * all eight CLASS_CALLING_QUESTS chains above were built to gesture at (see
 * that constant's own doc-comment). Unlike CLASS_CALLING_QUESTS, this is a
 * SINGLE class-agnostic chain — every class converges on the same plot once
 * their own calling chain is done, so there is no per-class branching here.
 * See LORE.md's "A reviravolta (Ato 2/3)" for the truth this pays off (Tobias's
 * ancestor Amara Ventura was one of the seven Zeladores da Raiz who sealed,
 * not healed, the wound) and QuestSystem.ensureAmaraRevealStarted for how the
 * chain is triggered. Deliberately ends on a cliffhanger, not a resolution —
 * the Ato 3 confrontation/branching endings are a future pass (see LORE.md).
 */
export const AMARA_REVEAL_QUESTS: QuestDefinition[] = [
  {
    id: 'amara_r1_evasion',
    title: 'As Perguntas que Tobias Evita',
    description:
      'Depois de tudo que já ouviu — de tanta gente diferente, em tantos cantos de Pedravale — chegou a hora de perguntar direto ao Ancião Tobias o que ele sabe sobre os Zeladores da Raiz.',
    giverNpcId: 'tobias',
    objective: { kind: 'talkTo', targetId: 'tobias', amount: 1 },
    rewardXp: 80,
    rewardGold: 50,
    nextQuestId: 'amara_r2_archives',
  },
  {
    id: 'amara_r2_archives',
    title: 'O Arquivo de Aldo',
    description:
      'Tobias desviou do assunto rápido demais para ser esquecimento. Se ele não vai falar, talvez os registros mais velhos da vila falem por ele — procure o Escrivão Aldo nos arquivos de Pedravale.',
    giverNpcId: 'tobias',
    objective: { kind: 'talkTo', targetId: 'escrivao_aldo', amount: 1 },
    rewardXp: 120,
    rewardGold: 70,
    nextQuestId: 'amara_r3_proof',
  },
  {
    id: 'amara_r3_proof',
    title: 'O Nome nas Vigas',
    description:
      'Aldo achou um nome, mas não uma prova que se segure sozinha. As vigas mais antigas da casa de Tobias guardam símbolos entalhados que ninguém mais decifrou — e algo corrompido ainda vigia o que resta deles.',
    giverNpcId: 'escrivao_aldo',
    objective: { kind: 'defeat', targetId: 'skeleton', amount: 4 },
    rewardXp: 180,
    rewardGold: 110,
    nextQuestId: 'amara_r4_confession',
  },
  {
    id: 'amara_r4_confession',
    title: 'A Confissão do Ancião',
    description:
      'De posse da prova, é hora de confrontar Tobias — não para acusá-lo, mas para finalmente ouvir a verdade inteira, custe o que custar a ele e a você.',
    giverNpcId: 'tobias',
    objective: { kind: 'talkTo', targetId: 'tobias', amount: 1 },
    rewardXp: 320,
    rewardGold: 200,
    rewardItem: { templateId: 'talisma_velocidade', rarity: 'vermelho' },
  },
];

const ALL_QUESTS: QuestDefinition[] = [
  ...CLASS_PRELUDE_QUESTS,
  ...QUEST_CHAIN,
  ...CLASS_CALLING_QUESTS,
  ...AMARA_REVEAL_QUESTS,
];

export function getQuestById(id: string): QuestDefinition | undefined {
  return ALL_QUESTS.find((q) => q.id === id);
}

/** The first quest a brand-new character of this class should be given. */
export function firstQuestIdForClass(classId: string): string {
  return `${classId}_q0_arrival`;
}

/** First quest id of each class's personal Pedravale "calling" chain — see CLASS_CALLING_QUESTS. */
const CALLING_FIRST_QUEST_ID: Record<string, string> = {
  warrior: 'warrior_pc1_convoy',
  mage: 'mage_pc1_scroll',
  archer: 'archer_pc1_trail',
  cleric: 'cleric_pc1_scream',
  paladin: 'paladin_pc1_oath',
  assassin: 'assassin_pc1_watch',
  necromancer: 'necromancer_pc1_fear',
  monk: 'monk_pc1_imbalance',
};

/** The first quest of a class's personal Pedravale "calling" chain — see CLASS_CALLING_QUESTS. */
export function firstCallingQuestIdForClass(classId: string): string {
  const id = CALLING_FIRST_QUEST_ID[classId];
  if (!id) throw new Error(`Sem missão de chamado definida para a classe: ${classId}`);
  return id;
}

/** Last quest id of each class's personal Pedravale "calling" chain — see CLASS_CALLING_QUESTS. */
const CALLING_LAST_QUEST_ID: Record<string, string> = {
  warrior: 'warrior_pc3_first_line',
  mage: 'mage_pc3_seal_broken',
  archer: 'archer_pc3_source',
  cleric: 'cleric_pc3_warning',
  paladin: 'paladin_pc3_reactivate',
  assassin: 'assassin_pc3_mask',
  necromancer: 'necromancer_pc3_trust',
  monk: 'monk_pc3_alarm',
};

/**
 * The last quest of a class's personal Pedravale "calling" chain — see
 * CLASS_CALLING_QUESTS. Used to gate AMARA_REVEAL_QUESTS (the class-agnostic
 * chain every calling chain converges into) on that class's own chain being
 * fully complete, regardless of which class the player picked.
 */
export function lastCallingQuestIdForClass(classId: string): string {
  const id = CALLING_LAST_QUEST_ID[classId];
  if (!id) throw new Error(`Sem missão de chamado definida para a classe: ${classId}`);
  return id;
}
