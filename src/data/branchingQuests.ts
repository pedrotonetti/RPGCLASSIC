import { MAIN_CITY_ID } from './zones';
import type { QuestDefinition } from './quests';

export const VAU_FACTION_ID = 'ancoradouro_vau';

// Two side quests ending in a three-way trade-off decision (QuestDefinition.choices); no option is the right one.
export const BRANCHING_QUESTS: QuestDefinition[] = [
  // --- Doroteia, líder do Comboio de Refugiados (Praça do Mercado) ---------
  {
    id: 'doroteia_r1_saqueadores',
    title: 'Saqueadores do Comboio',
    description:
      'Os sacos de grão que o comboio trouxe do Forte de Ferro sumiram numa só noite — bandoleiros do Verdegal levaram tudo o que dava para carregar. Doroteia quer o que sobrou de volta antes que o primeiro refugiado perceba que a despensa está vazia.',
    giverNpcId: 'doroteia_comboio',
    objective: { kind: 'defeat', targetId: 'bandit', amount: 4 },
    rewardXp: 220,
    rewardGold: 100,
    nextQuestId: 'doroteia_r2_despensa',
  },
  {
    id: 'doroteia_r2_despensa',
    title: 'O Preço do Pão',
    description:
      'Os saqueadores caíram e os sacos voltaram — mas não chegam para o comboio inteiro e para Pedravale ao mesmo tempo. Doroteia espera uma decisão sua, e qualquer uma delas vai custar alguma coisa a alguém.',
    giverNpcId: 'doroteia_comboio',
    objective: { kind: 'talkTo', targetId: 'doroteia_comboio', amount: 1 },
    rewardXp: 300,
    rewardGold: 40,
    choices: [
      {
        id: 'dividir',
        label: 'Dividir os estoques de Pedravale com o comboio',
        summary: 'Confiança e esperança sobem e a corrupção recua, mas o pão sai do seu bolso (-60 ouro) e nenhuma relíquia vem de brinde.',
        effect: {
          setFlag: 'comboio_acolhido',
          worldStateDelta: { trust: 8, hope: 4, corruption: -3 },
          factionDelta: { factionId: 'pedravale', amount: 10 },
          grantGold: -60,
        },
      },
      {
        id: 'raiz_proibida',
        label: 'Colher a raiz do ipezal para alimentar todo mundo',
        summary: 'Comida para todos e uma relíquia lendária na hora, mas a corrupção dispara, a natureza se desequilibra e Pedravale passa a te temer.',
        effect: {
          setFlag: 'raiz_proibida_usada',
          worldStateDelta: { corruption: 9, natureBalance: -7, trust: -4 },
          factionDelta: { factionId: 'pedravale', amount: -6 },
          grantItem: { templateId: 'amuleto_vitalidade', rarity: 'vermelho' },
        },
      },
      {
        id: 'vender_suprimentos',
        label: 'Vender o que foi resgatado e seguir seu caminho',
        summary: 'Ouro imediato (+120), mas o comboio passa fome, a confiança cai e as trilhas de Pedravale ficam mais cheias de criaturas.',
        effect: {
          setFlag: 'comboio_abandonado',
          grantGold: 120,
          worldStateDelta: { trust: -6, hope: -4, corruption: 2 },
          factionDelta: { factionId: 'pedravale', amount: -8 },
          zoneState: { zoneId: MAIN_CITY_ID, state: 'faminto' },
        },
      },
    ],
  },

  // --- Lavadeira Zefa e Barqueiro Joaquim (Ancoradouro do Vau) -------------
  {
    id: 'vau_r3_ossos_do_leito',
    title: 'Ossos no Leito Seco',
    description:
      'Desde que o rio voltou a correr, Zefa não consegue mais bater roupa em paz: os ossos que apareceram no leito começaram a andar, de noite, em fila. Ela quer alguém que desça lá antes que o fio d\'água que voltou seja pisoteado por eles.',
    giverNpcId: 'zefa_lavadeira',
    objective: { kind: 'defeat', targetId: 'skeleton', amount: 5 },
    rewardXp: 260,
    rewardGold: 120,
    nextQuestId: 'vau_r4_pedagio',
  },
  {
    id: 'vau_r4_pedagio',
    title: 'Quem Bebe Primeiro',
    description:
      'Com o leito limpo, o fio d\'água engrossou — e uma caravana de Pedravale chegou com ordens de abrir um canal até a cidade, enquanto o povo do Vau quer cada gota para si. Zefa manda você falar com o Barqueiro Joaquim: é ele quem cobra do rio, e é ele quem não sabe de quem a água é.',
    giverNpcId: 'zefa_lavadeira',
    objective: { kind: 'talkTo', targetId: 'joaquim_vau', amount: 1 },
    rewardXp: 340,
    rewardGold: 60,
    choices: [
      {
        id: 'reservar',
        label: 'Reservar a água para o povo do Vau',
        summary: 'O Vau te adota, a esperança cresce e a natureza respira, mas Pedravale fecha a cara e nenhum ouro entra.',
        effect: {
          setFlag: 'vau_reservado',
          worldStateDelta: { hope: 5, natureBalance: 4, trust: 2 },
          factionDeltas: [
            { factionId: VAU_FACTION_ID, amount: 12 },
            { factionId: 'pedravale', amount: -6 },
          ],
        },
      },
      {
        id: 'canal',
        label: 'Abrir o canal até Pedravale',
        summary: 'Pedravale paga bem (+90 ouro e um anel raro), mas o Vau se sente traído e o rio perde o que lhe restava de equilíbrio.',
        effect: {
          setFlag: 'vau_canalizado',
          grantGold: 90,
          grantItem: { templateId: 'anel_sorte', rarity: 'azul' },
          worldStateDelta: { natureBalance: -6, trust: 3 },
          factionDeltas: [
            { factionId: 'pedravale', amount: 10 },
            { factionId: VAU_FACTION_ID, amount: -10 },
          ],
        },
      },
      {
        id: 'pedagio',
        label: 'Cobrar pedágio pela água dos dois lados',
        summary: 'A bolsa mais gorda (+160 ouro), mas ninguém perdoa quem lucra com a sede alheia: a confiança e a esperança caem e a corrupção avança.',
        effect: {
          setFlag: 'vau_pedagio_da_agua',
          grantGold: 160,
          worldStateDelta: { trust: -5, hope: -4, corruption: 3 },
          factionDeltas: [
            { factionId: VAU_FACTION_ID, amount: -6 },
            { factionId: 'pedravale', amount: -4 },
          ],
        },
      },
    ],
  },
];

export const BRANCHING_QUEST_STARTERS: Array<{ questId: string; prerequisiteQuestId: string }> = [
  { questId: 'doroteia_r1_saqueadores', prerequisiteQuestId: 'q6_dragon' },
  { questId: 'vau_r3_ossos_do_leito', prerequisiteQuestId: 'vau_r2_benzedura' },
];
