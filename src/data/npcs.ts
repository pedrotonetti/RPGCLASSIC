import type { CharacterAppearance } from '../config/customization';
import { villageClearingBounds } from '../systems/MapGenerator';
import { CLASS_ZONE_THEMES } from './classZones';
import { getDungeonById } from './dungeons';
import { MAIN_CITY_ID, SECONDARY_VILLAGE_SIZE, START_VILLAGE_SIZE } from './zones';

export type VendorKind = 'ferreiro' | 'artesao' | 'boticario' | 'joalheiro';

export interface VendorInfo {
  kind: VendorKind;
  /** Consumable item ids for sale (apothecary). */
  itemIds?: string[];
  /** Equipment template ids for sale — a fresh 'verde' instance is rolled on purchase (blacksmith, artisan). */
  equipmentTemplateIds?: string[];
  /** Gem ids for sale (jeweler). */
  gemIds?: string[];
  /** Material this vendor's crafting recipes consume, alongside gold — see materials dropped by monsters. */
  craftMaterialId: string;
}

/**
 * A quest-state-conditioned override of an NPC's default `dialogue` lines.
 * Checked in the order they appear in `NpcDefinition.questDialogue` — put the
 * most specific/latest state first. `when: 'active'` (the default) matches
 * while `questId` is the player's current `activeQuestId`; `when: 'completed'`
 * matches once `questId` is in `completedQuestIds` (and no earlier, more
 * specific entry matched) — handy for a persistent line that should stick
 * around after a chain's last quest, once there's no longer an active quest
 * to key off of.
 */
export interface NpcQuestDialogue {
  questId: string;
  when?: 'active' | 'completed';
  lines: string[];
}

export interface NpcDefinition {
  id: string;
  name: string;
  role: string;
  /** Which zone this NPC stands in — the main city, or one of the class villages. */
  zoneId: string;
  mapX: number;
  mapY: number;
  dialogue: string[];
  /** Optional quest-conditioned dialogue overrides — see NpcQuestDialogue. */
  questDialogue?: NpcQuestDialogue[];
  appearance: CharacterAppearance;
  vendor?: VendorInfo;
  /**
   * Which playable class's rigged GLTF model (see `render/playerAvatar.ts`'s
   * `CLASS_MODEL_FILE`/`HELD_MESHES`) this NPC renders as in `OverworldScreen`
   * — chosen as the closest visual/role analog, not a claim the NPC actually
   * plays that class. Every hand-authored NPC below sets this explicitly; the
   * generated elder/mentor loop at the bottom of this file sets it to the
   * theme's own `classId` (an elder/mentor IS that class, so it reuses that
   * class's exact loadout instead of guessing an analog).
   */
  classAnalogId: string;
}

function npcAppearance(overrides: Partial<CharacterAppearance>): CharacterAppearance {
  return {
    gender: 'masculino',
    skinTone: 0xe8bf9a,
    hairStyle: 'curto',
    hairColor: 0x4a2f20,
    eyeColor: 0x4a2f20,
    bodyType: 'atletico',
    heightScale: 1.0,
    faceShape: 'oval',
    eyebrowStyle: 'reta',
    facialHair: 'nenhuma',
    primaryColor: 0x6b5f78,
    secondaryColor: 0xf2ede1,
    headAccessory: 'nenhum',
    scarStyle: 'nenhuma',
    tattooStyle: 'nenhuma',
    ...overrides,
  };
}

const WEAPON_ARMOR_TEMPLATE_IDS = [
  'espada_curta',
  'machado_guerra',
  'cajado_arcano',
  'arco_longo',
  'adaga_sombria',
  'grimorio_amaldicoado',
  'manoplas_combate',
  'martelo_sagrado',
  'armadura_couro',
  'armadura_placas',
  'vestes_arcanas',
  'manto_sagrado',
];

const ACCESSORY_TEMPLATE_IDS = ['anel_sorte', 'amuleto_vitalidade', 'bracelete_arcano', 'talisma_velocidade'];

const GEM_IDS = ['gem_ruby', 'gem_sapphire', 'gem_emerald', 'gem_topaz', 'gem_amethyst', 'gem_moonstone'];

export const NPC_DEFINITIONS: NpcDefinition[] = [
  {
    id: 'tobias',
    name: 'Ancião Tobias',
    role: 'Líder de Pedravale',
    // Wise mystic elder who "hears the ancestors" — reads as an arcane sage.
    classAnalogId: 'mage',
    zoneId: MAIN_CITY_ID,
    mapX: 5,
    mapY: 4,
    appearance: npcAppearance({
      hairStyle: 'longo',
      hairColor: 0xe8e4dc,
      facialHair: 'longa',
      primaryColor: 0x7a4fb3,
      secondaryColor: 0xf2c14e,
      bodyType: 'magro',
      headAccessory: 'nenhum',
    }),
    dialogue: [
      'Você ouviu, não ouviu? Quando as criaturas atacaram ontem à noite... você as ouviu antes de vê-las.',
      'Isso não é normal. Ninguém em Pedravale devia ser capaz disso. Ninguém... desde a guerra.',
      'As Raízes estão inquietas. A Florescência deveria vir em breve, mas as Ipê-árvores não florescem — estão sendo drenadas por algo que chamamos de Sede.',
      'Você é um Escolhido Verde. Consegue ouvir os ancestrais diretamente. É um dom que se acreditava extinto.',
      'Vá até os ipezais além da vila e ouça por si mesmo o que as Raízes têm a dizer. Eu... preciso pensar em como te contar o resto.',
    ],
    questDialogue: [
      {
        questId: 'amara_r4_confession',
        when: 'completed',
        lines: [
          '(Tobias ainda está sentado onde você o deixou, olhando para as próprias mãos.)',
          'Eu devia ter contado antes de você precisar arrancar de mim. Isso também é minha culpa, não só a de Amara.',
          'Se Ilva já sabe o que eu sei — e algo me diz que sabe — ela não vai esperar educadamente que você decida o que fazer com isso.',
        ],
      },
      {
        questId: 'amara_r4_confession',
        lines: [
          '(Tobias respira fundo, como quem carrega esse fôlego há décadas.)',
          'Amara Ventura era minha bisavó. Uma das sete. Não uma heroína de história de ninar — uma pessoa que fez uma escolha e depois passou o resto da vida com medo de que alguém a repetisse.',
          'Eles não curaram a ferida, filho(a). Selaram. Empurraram o problema para quem viesse depois — para nós. E eu soube disso a vida inteira e escolhi ficar calado, porque achei que estava te poupando de um peso grande demais.',
          'Estava errado. Não em me preocupar — em decidir sozinho o que você merecia carregar.',
          'Tem gente lá fora que já chegou perto demais dessa mesma verdade, do jeito errado. Ilva. Se o nome já chegou até você por outros lábios, agora sabe por quê.',
          '(Ele hesita, olhando para a porta, como se tivesse mais uma coisa a dizer e não conseguisse.) Vá com cuidado. Isso não termina com uma confissão — está só começando.',
        ],
      },
      {
        questId: 'amara_r3_proof',
        lines: [
          '(Tobias vê o que você carrega e o rosto dele perde a cor por um instante, antes de se recompor.)',
          'Onde você conseguiu... não. Não me responda aqui, na rua. Venha até minha casa quando puder falar sem que meio Pedravale escute.',
        ],
      },
      {
        questId: 'amara_r2_archives',
        lines: [
          'O Escrivão Aldo mexe demais nesses arquivos velhos. Um dia desses ele vai desenterrar algo que era melhor deixar enterrado.',
          '(Ele diz isso sorrindo, mas os olhos não sorriem junto.)',
        ],
      },
      {
        questId: 'amara_r1_evasion',
        lines: [
          'Zeladores da Raiz? Isso é história de avó, para assustar criança antes de dormir. Não perca seu tempo com fantasma de guerra antiga.',
          '(Ele desvia o olhar ao dizer isso — a primeira vez que você o vê, de verdade, mentir.)',
          'Vá descansar. Amanhã tem trabalho de verdade te esperando.',
        ],
      },
    ],
  },
  {
    id: 'elira',
    name: 'Ferreira Elira',
    role: 'Ferreira',
    // Blacksmith — rugged, hammer-and-axe worker, the Barbarian rig's vibe.
    classAnalogId: 'warrior',
    zoneId: MAIN_CITY_ID,
    mapX: 3,
    mapY: 6,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'coque',
      hairColor: 0xa5502a,
      primaryColor: 0x2a2a35,
      secondaryColor: 0xd97a2e,
      bodyType: 'robusto',
    }),
    dialogue: [
      'O metal não mente. Só o fogo revela do que algo é feito.',
      'Ando forjando à luz de vela — as Ipê-árvores perto da forja não brotam uma flor sequer este ano.',
      'Se encontrar minérios raros por aí, me avise — sempre há algo novo para forjar.',
    ],
    vendor: { kind: 'ferreiro', equipmentTemplateIds: WEAPON_ARMOR_TEMPLATE_IDS, craftMaterialId: 'mat_iron_ore' },
  },
  {
    id: 'bram',
    name: 'Guarda Bram',
    role: 'Guarda da Vila',
    // Armored village guard — sword-and-shield Knight rig.
    classAnalogId: 'paladin',
    zoneId: MAIN_CITY_ID,
    mapX: 8,
    mapY: 3,
    appearance: npcAppearance({
      hairStyle: 'moicano',
      hairColor: 0x1c1712,
      primaryColor: 0x3a5fb3,
      secondaryColor: 0xcfd6dc,
      bodyType: 'robusto',
      scarStyle: 'olho',
    }),
    dialogue: [
      'Fique nas trilhas conhecidas. O campo aberto anda mais perigoso a cada dia.',
      'As criaturas que vêm da Sede não são bichos comuns — juraria que reconheço rostos nelas. Não conto isso a qualquer um.',
    ],
    questDialogue: [
      {
        questId: 'contrato_troll_lagoa',
        when: 'completed',
        lines: ['(Bram arranca o próprio aviso da parede da estalagem.) Problema resolvido. Devia ter imaginado que seria você a dar um jeito nisso.'],
      },
      {
        questId: 'contrato_troll_lagoa',
        lines: [
          'Viu o aviso na estalagem? Aquele troll não vai se afastar da lagoa sozinho, e cada dia ele anda mais perto das ruas.',
          'Não é bicho de briga limpa. Cuidado com o alcance dos braços dele.',
        ],
      },
    ],
  },
  {
    id: 'mira',
    name: 'Curandeira Mira',
    role: 'Boticária',
    // Healer/apothecary — staff-carrying cleric reads right for a curandeira.
    classAnalogId: 'cleric',
    zoneId: MAIN_CITY_ID,
    mapX: 7,
    mapY: 6,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'medio',
      hairColor: 0xd9b464,
      primaryColor: 0xe0c34a,
      secondaryColor: 0xf2ede1,
      bodyType: 'magro',
    }),
    dialogue: [
      'Poções de vida e mana, sempre à mão para quem parte em aventura.',
      'Rezo pela Florescência todo ano. Este ano, pela primeira vez, tenho medo de que ela não venha.',
    ],
    vendor: { kind: 'boticario', itemIds: ['potion_hp', 'potion_mp'], craftMaterialId: 'mat_herb' },
  },
  {
    id: 'zaya',
    name: 'Zaya',
    role: 'Batedora Viajante',
    // Traveling scout — bow-carrying Rogue rig fits a scout's ranged, mobile vibe.
    classAnalogId: 'archer',
    zoneId: MAIN_CITY_ID,
    mapX: 4,
    mapY: 7,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'trancado',
      hairColor: 0x1c1712,
      eyeColor: 0x4a9a5a,
      primaryColor: 0x3fae5b,
      secondaryColor: 0x6b4423,
      bodyType: 'atletico',
      tattooStyle: 'braco',
    }),
    dialogue: [
      'Você deve ser o Escolhido Verde de quem todos falam. Eu sou Zaya — vim de um vilarejo três serras a leste.',
      'Andei seguindo o rastro da Sede até aqui. Prometo te ajudar no que precisar lá fora.',
      '(Zaya sorri, mas por um instante seus olhos pesam, como quem carrega um recado que ainda não entregou.)',
    ],
    questDialogue: [
      {
        questId: 'amara_r4_confession',
        when: 'completed',
        lines: [
          '(Zaya ouve você contar o que Tobias confessou e fica quieta por tempo demais antes de responder.)',
          'Amara Ventura. Os Zeladores. Ilva.',
          '(Ela repete os nomes baixinho, como quem já os ouviu antes em algum lugar que não devia — e então força um sorriso rápido demais para ser sincero.) Isso muda tudo, não é? Vamos com calma, então.',
        ],
      },
    ],
  },
  {
    id: 'ilva',
    name: 'Ilva, a Semeadora',
    role: 'A que acelera a Sede',
    // Wields the Sede's own corrupted root-magic on purpose — the necromancer analog fits better than any "villain in armor" cliché.
    classAnalogId: 'necromancer',
    zoneId: MAIN_CITY_ID,
    // Standing apart from the plaza's usual cluster (x3-8,y3-7) near the
    // deepest dungeon's own portal (silent_root_rift, 45,30) — she's been
    // close to the worst of the Sede the whole time, not hiding across town.
    mapX: 48,
    mapY: 32,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'longo',
      hairColor: 0x8a8378,
      eyeColor: 0x9acb6e,
      primaryColor: 0x2e2a24,
      secondaryColor: 0x5c6b3f,
      bodyType: 'magro',
      faceShape: 'anguloso',
      scarStyle: 'bochecha',
      headAccessory: 'nenhum',
    }),
    // Before act3_q2_confront is even active, she's just an unreadable
    // stranger nobody has a reason yet to talk to at length.
    dialogue: [
      '(Ela observa de longe, quieta demais para ser só mais um rosto de Pedravale. Ainda não é hora de perguntar quem é.)',
    ],
    questDialogue: [
      {
        questId: 'act3_q2_confront',
        lines: [
          'Então é você. O Escolhido Verde que Tobias escondeu de si mesmo por tanto tempo quanto pôde.',
          'Sei o que veio perguntar: se eu sou o mal, ou se a Sede é. A resposta não vai te agradar — não escolhi isso por prazer. Escolhi porque ninguém mais estava disposto a fazer a escolha difícil.',
          'As Raízes já estavam apodrecendo antes de mim. Os Zeladores as colheram. Seus ancestrais esconderam isso. Cada geração empurrou o problema pra frente, com medo de encará-lo. Eu só parei de empurrar.',
          'Queimar tudo até a raiz e forçar uma Segunda Florescência do zero. É cruel. Também é a única cura que não depende de mais uma geração inteira fingindo que a ferida vai sarar sozinha.',
          'Posso estar errada sobre o preço. Mas alguém tinha que decidir — e agora essa escolha é sua, não minha.',
        ],
      },
    ],
  },
  {
    id: 'artesa_bina',
    name: 'Artesã Bina',
    role: 'Artesã',
    // Hand-craft artisan — unarmed monk loadout (no weapon shown) suits a non-combatant.
    classAnalogId: 'monk',
    zoneId: MAIN_CITY_ID,
    mapX: 6,
    mapY: 4,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'longo',
      hairColor: 0x2a2a35,
      primaryColor: 0x8a6a3f,
      secondaryColor: 0xd97a2e,
      bodyType: 'magro',
    }),
    dialogue: [
      'Anéis, amuletos, braceletes — o que a sorte não dá, um bom artesanato empresta.',
      'Cada peça que faço carrega um pouco de quem a encomendou. É um trabalho pessoal, esse.',
    ],
    vendor: { kind: 'artesao', equipmentTemplateIds: ACCESSORY_TEMPLATE_IDS, craftMaterialId: 'mat_leather' },
  },
  {
    id: 'joalheiro_nemo',
    name: 'Joalheiro Nemo',
    role: 'Joalheiro',
    // Precise gem-cutter — necromancer's Mage-file wand+spellbook loadout
    // (small tool-in-hand, book of notes) reads as fine handiwork, and keeps
    // him visually distinct from Tobias/Aldo's own Mage-file variants.
    classAnalogId: 'necromancer',
    zoneId: MAIN_CITY_ID,
    mapX: 8,
    mapY: 6,
    appearance: npcAppearance({
      hairStyle: 'careca',
      primaryColor: 0x4a2f20,
      secondaryColor: 0xe0b23a,
      bodyType: 'robusto',
      headAccessory: 'nenhum',
    }),
    dialogue: [
      'Gemas lapidadas à mão, cada uma pronta para engastar em arma ou armadura.',
      'Uma gema bem engastada não só fortalece — ela brilha. Combate é teatro, e teatro precisa de luz.',
    ],
    vendor: { kind: 'joalheiro', gemIds: GEM_IDS, craftMaterialId: 'mat_arcane_shard' },
  },
];

// One "calling" NPC per class, standing in Pedravale itself — delivers the
// personal hook that pulls that class into its own short quest chain once
// Chapter 1's shared story (QUEST_CHAIN) reaches its current end at
// q6_dragon. See data/quests.ts CLASS_CALLING_QUESTS for the chains these
// feed. Kept as brand-new characters (never Tobias or Zaya) so their static,
// one-shot dialogue arrays can't collide with — or spoil — those two NPCs'
// own already-established lines.
NPC_DEFINITIONS.push(
  {
    id: 'doroteia_comboio',
    name: 'Doroteia',
    role: 'Líder do Comboio de Refugiados',
    // Leader who protected her people fleeing Forte de Ferro — armored Knight rig.
    classAnalogId: 'paladin',
    zoneId: MAIN_CITY_ID,
    mapX: 3,
    mapY: 3,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'trancado',
      hairColor: 0x7a5233,
      primaryColor: 0x8a6a3f,
      secondaryColor: 0x4a2f20,
      bodyType: 'magro',
    }),
    dialogue: [
      'Comandante Gael me mandou correndo à frente do comboio — disse que você era forte o bastante pra isso, Escolhido Verde.',
      'Fugimos do Forte de Ferro com o que coube nas costas. As trilhas atrás de nós não estão seguras como antes.',
      'Se Pedravale não aguentar esse tanto de gente com fome e sem teto... o Comandante teme que a cidade vire um problema antes de virar um lar.',
    ],
  },
  {
    id: 'correio_bento',
    name: 'Correio Bento',
    role: 'Mensageiro de Pedravale',
    // Fast, light courier — agile dagger-carrying Rogue rig.
    classAnalogId: 'assassin',
    zoneId: MAIN_CITY_ID,
    mapX: 4,
    mapY: 3,
    appearance: npcAppearance({
      hairStyle: 'curto',
      hairColor: 0x1c1712,
      primaryColor: 0x3a5fb3,
      secondaryColor: 0xf2ede1,
      bodyType: 'magro',
    }),
    dialogue: [
      'Vim correndo desde a Torre dos Arcanos — o Magíster Orin jurou que isso não podia esperar pelo carteiro de sempre.',
      'É um pergaminho selado. Ele disse que tentou abri-lo com toda a mana da Torre, e nada aconteceu.',
      'Orin acha que só reage a um Escolhido Verde. Não sei bem o que isso quer dizer — só sei que ele parecia mais assustado que curioso.',
    ],
  },
  {
    id: 'cacador_ren',
    name: 'Caçador Ren',
    role: 'Batedor das Trilhas',
    // Literal bow-carrying hunter/tracker.
    classAnalogId: 'archer',
    zoneId: MAIN_CITY_ID,
    mapX: 5,
    mapY: 3,
    appearance: npcAppearance({
      hairStyle: 'longo',
      hairColor: 0x4a2f20,
      primaryColor: 0x3fae5b,
      secondaryColor: 0x6b4423,
      bodyType: 'atletico',
    }),
    dialogue: [
      'Rastreio bicho desde criança e nunca vi isso: criaturas da Sede fugindo de Pedravale, não atacando.',
      'Fogem todas na mesma direção, feito puxadas por uma corda que a gente não vê. Isso não é instinto de bicho assustado — é chamado.',
      'Preciso de outro par de olhos que enxergue rastro como eu enxergo. Vem comigo?',
      'Tudo que você vê além dos portões de Pedravale, até onde as vilas de cada classe começam, é Verdegal — a mesma mata que dá nome à grande floresta de Ipêra inteira. Não tem dono. Só tem quem sabe andar nela.',
    ],
    questDialogue: [
      {
        questId: 'contrato_cinzas_elemental',
        when: 'completed',
        lines: ['(Caçador Ren examina os restos de mais uma fogueira apagada.) As cinzas pararam de se espalhar. Bom trabalho.'],
      },
      {
        questId: 'contrato_cinzas_elemental',
        lines: [
          'Duas clareiras inteiras já viraram cinza esta semana. Elementais de fogo migrando da mata funda — ache-os antes que vire três clareiras.',
          'Fogo que anda sozinho não é fogo comum. Cuidado com o calor à distância.',
        ],
      },
    ],
  },
  {
    id: 'zeladora_sable',
    name: 'Zeladora Sable',
    role: 'Guardiã do Ipezal de Pedravale',
    // Shrine/grove guardian who feels the Raízes — staff-carrying cleric.
    classAnalogId: 'cleric',
    zoneId: MAIN_CITY_ID,
    mapX: 6,
    mapY: 3,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'coque',
      hairColor: 0xe8e4dc,
      primaryColor: 0xe0c34a,
      secondaryColor: 0xf2ede1,
      bodyType: 'magro',
    }),
    dialogue: [
      'Você sente, não sente? As Raízes do nosso ipezal não sussurram mais — gritam.',
      'Rezei aqui a vida inteira e nunca ouvi isso. Só um curador de verdade sente a diferença entre dor e aviso.',
      'Ajude-me a entender o que elas tentam dizer, antes que gritem tão alto que ninguém mais durma em Pedravale.',
    ],
  },
  {
    id: 'escrivao_aldo',
    name: 'Escrivão Aldo',
    role: 'Guardião dos Arquivos de Pedravale',
    // Bookish archivist/scholar — staff-and-open-spellbook mage reads studious.
    classAnalogId: 'mage',
    zoneId: MAIN_CITY_ID,
    mapX: 7,
    mapY: 3,
    appearance: npcAppearance({
      hairStyle: 'careca',
      hairColor: 0xcfd6dc,
      facialHair: 'cavanhaque',
      primaryColor: 0x6b5f78,
      secondaryColor: 0xcfd6dc,
      bodyType: 'magro',
    }),
    dialogue: [
      'Vasculhando os arquivos mais velhos da vila, achei um juramento que ninguém sabia que ainda existia — um voto dos chamados Zeladores da Raiz.',
      'É um voto de guarda, não de guerra. Promete vigilância eterna contra algo que o texto nunca nomeia — só chama de "a ferida".',
      'Um documento desses não devia ficar esquecido numa prateleira. Mas reativar um juramento assim não é decisão de escrivão — é decisão de quem carrega honra o bastante pra jurá-lo de novo.',
      '(Ele aponta pela janela para a praça murada logo ali fora dos arquivos.) Essa aqui é a Praça da Fundação — o pedaço mais velho de Pedravale, de antes da vila crescer o bastante pra precisar de uma praça nova.',
    ],
    questDialogue: [
      {
        questId: 'amara_r2_archives',
        lines: [
          'Já ia te procurar. Achei um registro de nascimento arquivado junto do juramento dos Zeladores — um sobrenome que ainda existe em Pedravale.',
          'Ventura. Amara Ventura. E olhando de novo os riscos entalhados nas vigas mais velhas da casa do Ancião Tobias, o mesmo traço de letra aparece nos dois lugares.',
          'Não estou dizendo que Tobias é ela. Estou dizendo que ele é filho de quem foi — e isso ele nunca contou a ninguém, nem à própria vila que lidera.',
          'Se quiser algo mais firme que minha palavra, essas vigas ainda estão de pé. Alguma coisa corrompida anda rondando lá embaixo, como se ainda montasse guarda sobre o que resta delas.',
        ],
      },
    ],
  },
  {
    id: 'vigia_talma',
    name: 'Vigia Talma',
    role: 'Chefe da Guarda de Pedravale',
    // Head of the guard — armored sword-and-shield Knight rig, same as Bram.
    classAnalogId: 'paladin',
    zoneId: MAIN_CITY_ID,
    mapX: 3,
    mapY: 4,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'moicano',
      hairColor: 0x1c1712,
      primaryColor: 0x3a5fb3,
      secondaryColor: 0x2a2a35,
      bodyType: 'robusto',
    }),
    dialogue: [
      'Bram me chamou baixinho — falou que tem gente estranha demais entrando por essas portas ultimamente. Rostos que ninguém conhece, perguntas que ninguém devia fazer.',
      'Eu comando a guarda, mas guarda não pensa como quem se esconde nas sombras. Você pensa.',
      'Se tem espião disfarçado de morador em Pedravale, você vai reconhecer o disfarce antes que qualquer um de nós.',
      'Metade da minha guarda fica na Praça da Fundação, a outra metade lá embaixo na Praça do Mercado — Pedravale cresceu rápido demais pra uma só ronda dar conta das duas.',
    ],
  },
  {
    id: 'dona_ilma',
    name: 'Dona Ilma',
    role: 'Moradora de Pedravale',
    // Ordinary townsperson, no reason to be armed — unarmed monk loadout.
    classAnalogId: 'monk',
    zoneId: MAIN_CITY_ID,
    mapX: 4,
    mapY: 4,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'medio',
      hairColor: 0xcfd6dc,
      primaryColor: 0x8a6a3f,
      secondaryColor: 0xf2ede1,
      bodyType: 'robusto',
    }),
    dialogue: [
      'Não quero ser mal-educada, mas... as crianças não dormem direito desde que você chegou falando sozinho perto do ipezal velho.',
      'Sei que ouve coisas que a gente não ouve. Isso já assustava antes de você aparecer — agora tem um rosto pra esse medo.',
      'Não vim pedir que pare. Vim pedir que mostre a Pedravale que o que você ouve não é a mesma coisa que virar aquilo que ouve.',
    ],
  },
  {
    id: 'andarilho_ossian',
    name: 'Andarilho Ossian',
    role: 'Monge Peregrino',
    // Literally a wandering monk — unarmed monk loadout.
    classAnalogId: 'monk',
    zoneId: MAIN_CITY_ID,
    mapX: 7,
    mapY: 4,
    appearance: npcAppearance({
      hairStyle: 'careca',
      facialHair: 'longa',
      hairColor: 0xe8e4dc,
      primaryColor: 0xd97a2e,
      secondaryColor: 0xf2ede1,
      bodyType: 'magro',
    }),
    dialogue: [
      'Vi você cambalear na praça sem ninguém tocar em você. Reconheço essa dor — não é do corpo, é do chi.',
      'Andei mosteiro em mosteiro a vida inteira e nunca senti a Sede crescer tão rápido quanto sinto vendo você se dobrar de dor por algo que ninguém mais percebe ainda.',
      'Se seu corpo sente antes dos olhos verem, então seu corpo é o alarme mais cedo que Pedravale tem. Use isso — mas cuide-se, esse alarme cobra caro de quem carrega.',
    ],
  },
);

// One elder (starting village) and one mentor (secondary village) per class,
// generated from the shared theme table instead of hand-duplicated —
// see data/classZones.ts for names/dialogue per class.
//
// Positioned relative to each village's own central clearing (see
// villageClearingBounds) rather than a stale absolute tile — these used to
// be hardcoded at (8,7)/(11,8), tuned by hand for the OLD, much smaller
// village dimensions; a hardcoded tile like that silently strands the NPC
// out in the trees the next time START_VILLAGE_SIZE/SECONDARY_VILLAGE_SIZE
// changes; this can't drift out of sync with the village generator.
const startBounds = villageClearingBounds(START_VILLAGE_SIZE.width, START_VILLAGE_SIZE.height);
const secondaryBounds = villageClearingBounds(SECONDARY_VILLAGE_SIZE.width, SECONDARY_VILLAGE_SIZE.height);
for (const theme of CLASS_ZONE_THEMES) {
  NPC_DEFINITIONS.push({
    id: `${theme.classId}_elder`,
    name: theme.elderName,
    role: theme.elderTitle,
    // An elder/mentor of this class's own village IS that class, so it
    // reuses that exact class's model/loadout instead of an analog guess.
    classAnalogId: theme.classId,
    zoneId: theme.startVillageId,
    // Just outside the clearing's NW corner (3 tiles west of its wall, 1
    // north of it) — matches where the old absolute (8,7) actually sat
    // relative to the clearing at the previous village size.
    mapX: startBounds.cx - startBounds.vw - 3,
    mapY: startBounds.cy - startBounds.vh - 1,
    appearance: npcAppearance({ primaryColor: theme.accentColor, secondaryColor: 0xf2ede1, hairStyle: 'longo', hairColor: 0xe8e4dc }),
    dialogue: theme.elderGreeting,
  });
  NPC_DEFINITIONS.push({
    id: `${theme.classId}_mentor`,
    name: theme.mentorName,
    role: theme.mentorTitle,
    classAnalogId: theme.classId,
    zoneId: theme.secondaryVillageId,
    // Just outside the clearing's NW corner (3 tiles west of its wall, 3
    // north of it) — matches where the old absolute (11,8) sat relative to
    // the clearing at the previous secondary-village size.
    mapX: secondaryBounds.cx - secondaryBounds.vw - 3,
    mapY: secondaryBounds.cy - secondaryBounds.vh - 3,
    appearance: npcAppearance({ primaryColor: theme.accentColor, secondaryColor: 0x2a2a35, bodyType: 'robusto' }),
    dialogue: theme.mentorGreeting,
  });
}

// "Lost" NPCs — placed somewhere a player wouldn't stumble on immediately
// (a dungeon chamber off its own encounter tile, the far edge of a village,
// past the far end of its own north/south road) rather than in the usual
// villages'/Pedravale's clustered NPC rows above. Each opens its own short
// 1-2 quest side chain once q6_dragon is behind the player (see
// data/quests.ts's SIDE_QUESTS/SIDE_QUEST_STARTERS) — none of them touch
// Ato 3 or Amara Ventura's own reveal, just Ipêra's wider texture.
const rottenSapGallery = getDungeonById('rotten_sap_gallery');
// Two tiles below encounter chamber #2's own center tile (see
// dungeons.ts/MapGenerator's dungeonLayout) — inside that chamber's open
// grass, on the corridor's own guaranteed-clear center column, but off the
// fixed monster pod itself.
const vascoTile = { x: rottenSapGallery.encounters[2].atTile.x, y: rottenSapGallery.encounters[2].atTile.y + 2 };

NPC_DEFINITIONS.push(
  {
    id: 'baltazar_relicario',
    name: 'Baltazar',
    role: 'Guardião do Relicário Esquecido',
    // Robed keeper of an old, half-forgotten shrine — the mage rig's staff/robe reads right for a relic keeper.
    classAnalogId: 'mage',
    zoneId: 'necromancer_secondary',
    // Far up the north road of "Cripta Esquecida", near the map's own
    // border — well clear of the central clearing everyone else clusters
    // around, and on the same guaranteed-Path road column every secondary
    // village carves north from its clearing (see villageClearingBounds),
    // never a bare hardcoded tile number.
    mapX: secondaryBounds.cx,
    mapY: 4,
    appearance: npcAppearance({
      hairStyle: 'longo',
      hairColor: 0x8a8378,
      facialHair: 'longa',
      primaryColor: 0x4a2f20,
      secondaryColor: 0x6b5f78,
      bodyType: 'magro',
      headAccessory: 'nenhum',
    }),
    dialogue: [
      'Poucos descem até este canto da Cripta Esquecida. A maioria vem pelas lojas lá em cima, não pelas lembranças aqui embaixo.',
      'Guardo um relicário selado desde os tempos em que os Zeladores da Raiz ainda eram gente de carne e osso, não história de avó.',
      '(Ele bate de leve na pedra ao lado, como quem confere se algo ainda dorme.) Por enquanto, ainda dorme.',
    ],
    questDialogue: [
      {
        questId: 'relicario_r2_heranca',
        when: 'completed',
        lines: [
          '(Baltazar mantém o relicário aberto, vazio, como se isso finalmente aliviasse algo nele.)',
          'Continue ouvindo as Raízes, Escolhido Verde. Alguém precisa, agora que eu já fiz minha parte.',
        ],
      },
      {
        questId: 'relicario_r2_heranca',
        lines: [
          '(Baltazar solta o ar que parecia segurar há dias.) Silêncio de novo. Obrigado.',
          'Prometi a mim mesmo, há muito tempo, que nunca mostraria isso a ninguém. Mas guardar sozinho não impediu a Sede de se aproximar — talvez dividir o peso ajude mais do que escondê-lo.',
          '(Ele abre o relicário. Dentro, um bracelete arcano, gasto pelo tempo, ainda pulsa fraco.) Leve. Um Zelador o carregou uma vez. Talvez sirva a você agora.',
        ],
      },
      {
        questId: 'relicario_r1_guardioes',
        lines: [
          'Ouviu isso? Os ossos lá embaixo não deviam se mexer sozinhos — não desde que o relicário foi selado.',
          'Não peço que entenda o que guardo. Peço que desça e silencie o que acordou, antes que suba até aqui.',
        ],
      },
    ],
  },
  {
    id: 'eremita_vasco',
    name: 'Eremita Vasco',
    role: 'Preso na Galeria da Seiva Podre',
    // A ragged survivor with no weapon of his own — the monk rig's bare-handed loadout fits.
    classAnalogId: 'monk',
    zoneId: rottenSapGallery.zoneId,
    mapX: vascoTile.x,
    mapY: vascoTile.y,
    appearance: npcAppearance({
      hairStyle: 'curto',
      hairColor: 0x6b5f52,
      facialHair: 'cavanhaque',
      primaryColor: 0x5a4a3a,
      secondaryColor: 0x2e2a24,
      bodyType: 'magro',
      headAccessory: 'nenhum',
    }),
    dialogue: [
      '(Um homem magro se encolhe entre as raízes retorcidas, olhos fundos de quem não dorme direito há dias.) Não... não vim atrás de tesouro nenhum. Vim fugindo.',
      'As aranhas tomaram a galeria faz uma semana. Eu devia ter saído no primeiro dia. Agora é tarde demais pra arriscar sozinho.',
    ],
    questDialogue: [
      {
        questId: 'eremita_r2_partida',
        when: 'completed',
        lines: [
          '(Vasco ainda organiza as próprias coisas, decidido a partir assim que reunir coragem — mas já não olha por cima do ombro a cada passo.)',
          'Vou andando quando o sol nascer de novo. Até lá, obrigado por me dar de volta o corredor.',
        ],
      },
      {
        questId: 'eremita_r2_partida',
        lines: [
          '(Vasco respira fundo, olhando o corredor livre pela primeira vez em dias.) Livre. Finalmente livre.',
          'Não vou pra casa — vou pra vila mais próxima avisar o que vi se mexendo aqui embaixo. Se tem bicho sendo guiado feito rebanho, alguém em algum lugar segura a rédea.',
          '(Ele aperta sua mão com força inesperada para alguém tão magro.) Obrigado por não me deixar aqui feito lembrança.',
        ],
      },
      {
        questId: 'eremita_r1_cercado',
        lines: [
          'Elas se moviam estranho, sabe? Não como bicho assustado — como bicho guiado. Nunca vi por quem.',
          'Se limpar o caminho até a saída, eu saio com você. Juro que não atraso o passo.',
        ],
      },
    ],
  },
  {
    id: 'nair_coivara',
    name: 'Nair',
    role: 'Sobrevivente de Coivara',
    // A scout who survived alone in the wild long enough to reach here — bow-carrying archer rig fits.
    classAnalogId: 'archer',
    zoneId: 'assassin_start',
    // Far down the south road of "Vila das Sombras", near the map's own
    // border — same guaranteed-Path road column every starting village
    // carves south from its clearing, well past the houses everyone else
    // clusters around.
    mapX: startBounds.cx,
    mapY: START_VILLAGE_SIZE.height - 4,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'trancado',
      hairColor: 0x2a2a35,
      eyeColor: 0x6b5f78,
      primaryColor: 0x3a3540,
      secondaryColor: 0x8a6a3f,
      bodyType: 'magro',
      scarStyle: 'bochecha',
    }),
    dialogue: [
      '(Uma mulher magra observa o horizonte do canto mais afastado da vila, longe do centro, como se ainda vigiasse algo que já não existe mais.) Coivara não existe mais. Não pergunte onde fica — não fica em lugar nenhum.',
      'Uma alcateia corrompida alcançou meu vilarejo há meses. Fui a única rápida o bastante pra fugir.',
    ],
    questDialogue: [
      {
        questId: 'nair_r1_ultimos_de_coivara',
        when: 'completed',
        lines: [
          '(Nair ainda observa o horizonte, mas agora com os ombros um pouco mais soltos.) Obrigada. Coivara não volta, mas talvez ninguém mais precise virar Coivara.',
        ],
      },
      {
        questId: 'nair_r1_ultimos_de_coivara',
        lines: [
          'A mesma alcateia ainda ronda essas trilhas. Sinto o uivo à noite — o mesmo, tenho certeza.',
          'Não peço vingança. Peço que ninguém mais precise correr como eu corri.',
        ],
      },
    ],
  },
);

// More "lost"-style NPCs, one per class village that had nothing beyond its
// generated elder/mentor pair (necromancer_secondary already has Baltazar,
// assassin_start already has Nair — this round covers five of the six
// classes that so far had NEITHER village hold anything past that pair:
// warrior, mage, archer, cleric, monk. Paladin's two villages are the one
// remaining gap; see this session's report). Same idiom as the three lost
// NPCs above: positioned off the generated village's own guaranteed-Path
// road column (never a bare hardcoded tile), single-quest chains gated on
// q6_dragon via SIDE_QUEST_STARTERS, rewarding an existing equipment
// template id at 'laranja' rarity — on par with the existing bounties.
NPC_DEFINITIONS.push(
  {
    id: 'vidal_portao',
    name: 'Sargento Vidal',
    role: 'Última Guarda do Portão Sul do Forte de Ferro',
    // Held the fort's own gate alone after the refugee convoy fled — armored sword-and-shield Knight rig, same silhouette as Bram/Talma.
    classAnalogId: 'paladin',
    zoneId: 'warrior_secondary',
    // Far down the south road of "Forte de Ferro", near the map's own
    // border — the same guaranteed-Path column every secondary village
    // carves south from its clearing, well past the barracks everyone else
    // clusters around.
    mapX: secondaryBounds.cx,
    mapY: SECONDARY_VILLAGE_SIZE.height - 4,
    appearance: npcAppearance({
      hairStyle: 'moicano',
      hairColor: 0x6b5f52,
      primaryColor: 0xb33a3a,
      secondaryColor: 0x2a2a35,
      bodyType: 'robusto',
      scarStyle: 'olho',
    }),
    dialogue: [
      '(Um soldado sozinho examina o portão sul, os braços tremendo de cansaço.) O comboio já foi há muito. Doroteia foi na frente, o Comandante Gael foi atrás — e alguém precisava ficar segurando o que sobrou daqui.',
      'Guerreiros de casca rachada testam esse portão toda noite. Sozinho, não aguento pra sempre.',
    ],
    questDialogue: [
      {
        questId: 'vidal_r1_portao',
        when: 'completed',
        lines: ['(Vidal se apoia no próprio portão, agora firme.) Segura. Pela primeira vez em semanas, o Forte de Ferro tem um portão de verdade outra vez.'],
      },
      {
        questId: 'vidal_r1_portao',
        lines: [
          'Cada guerreiro de casca rachada que eu derrubo, dois aparecem na trilha atrás dele. Não é sorte ruim — é gente sendo mandada pra cá de propósito.',
          'Ajude-me a segurar esse portão e prometo que o próximo recruta do Forte não vai precisar fazer isso sozinho.',
        ],
      },
    ],
  },
  {
    id: 'sora_veu',
    name: 'Noviça Sora',
    role: 'Guardiã do Poço de Mana do Véu Azul',
    // A young apprentice tending an arcane wellspring — staff-carrying Mage rig.
    classAnalogId: 'mage',
    zoneId: 'mage_start',
    // Far down the south road of "Vila do Véu Azul", near the map's own
    // border — same guaranteed-Path road column every starting village
    // carves south from its clearing.
    mapX: startBounds.cx,
    mapY: START_VILLAGE_SIZE.height - 4,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'medio',
      hairColor: 0x3a5fb3,
      eyeColor: 0x9acb6e,
      primaryColor: 0x3a5fb3,
      secondaryColor: 0xf2ede1,
      bodyType: 'magro',
    }),
    dialogue: [
      '(Uma noviça se debruça sobre um poço raso de mana, tentando acalmar a própria água com as duas mãos.) Desde que a Sede se aproximou, os sussurros alados enlouqueceram — batem contra o poço como se quisessem calar o que ouvem nele.',
      'Não consigo estudar o poço e defendê-lo ao mesmo tempo. E se ele quebrar, o Véu Azul inteiro perde sua própria fonte.',
    ],
    questDialogue: [
      {
        questId: 'sora_r1_veu',
        when: 'completed',
        lines: ['(Sora encosta a testa na borda do poço, aliviada.) Quieto de novo. Obrigada — vou lembrar disso da próxima vez que alguém disser que noviça não serve pra nada em campo.'],
      },
      {
        questId: 'sora_r1_veu',
        lines: [
          'Eles não atacam por fome — atacam o próprio poço, como se soubessem o que ele guarda.',
          'Afaste-os antes que a água pare de responder a qualquer mão, até a minha.',
        ],
      },
    ],
  },
  {
    id: 'ivo_trilha',
    name: 'Guarda-Trilha Ivo',
    role: 'Vigia da Trilha Verde',
    // A watchful trail scout — bow-carrying archer rig.
    classAnalogId: 'archer',
    zoneId: 'archer_secondary',
    // Far up the north road of "Posto da Trilha Verde", near the map's own
    // border — same guaranteed-Path road column every secondary village
    // carves north from its clearing (mirrors Baltazar's own placement in
    // necromancer_secondary, just the opposite class's territory).
    mapX: secondaryBounds.cx,
    mapY: 4,
    appearance: npcAppearance({
      hairStyle: 'curto',
      hairColor: 0x4a2f20,
      primaryColor: 0x3fae5b,
      secondaryColor: 0x6b4423,
      bodyType: 'atletico',
    }),
    dialogue: [
      'Caravanas inteiras somem na Trilha Verde ultimamente. Não por acaso — por andarilhos sedentos, gente que a Sede corrompeu por dentro antes de corromper por fora.',
      'Não tenho gente de sobra pra escoltar ninguém. O Posto inteiro segura a trilha com o que tem.',
    ],
    questDialogue: [
      {
        questId: 'ivo_r1_emboscada',
        when: 'completed',
        lines: ['(Ivo observa a trilha vazia, quieta pela primeira vez em dias.) Passagem livre. Diga aos viajantes que a Trilha Verde volta a merecer o nome.'],
      },
      {
        questId: 'ivo_r1_emboscada',
        lines: [
          'Eles emboscam de longe, sedentos demais pra esperar um alvo melhor. Cuidado ao seguir a trilha sozinho.',
          'Limpe o caminho e o Posto da Trilha Verde vai lembrar seu nome tanto quanto lembra o de Fenn.',
        ],
      },
    ],
  },
  {
    id: 'dulce_bambu',
    name: 'Irmã Dulce',
    role: 'Zeladora do Bosque de Ancestrais do Bambu',
    // Tends a small ancestor grove — staff-carrying cleric rig.
    classAnalogId: 'cleric',
    zoneId: 'cleric_start',
    // Far down the south road of "Vila do Bambu", near the map's own
    // border — same guaranteed-Path road column every starting village
    // carves south from its clearing.
    mapX: startBounds.cx,
    mapY: START_VILLAGE_SIZE.height - 4,
    appearance: npcAppearance({
      gender: 'feminino',
      hairStyle: 'coque',
      hairColor: 0x8a8378,
      primaryColor: 0xe0c34a,
      secondaryColor: 0xf2ede1,
      bodyType: 'magro',
    }),
    dialogue: [
      '(Uma irmã reza ajoelhada diante de um pequeno bosque de sepulturas, mãos trêmulas.) O bosque de ancestrais sempre foi lugar de descanso, não de guerra. Agora ancestrais descarnados caminham entre as próprias sepulturas.',
      'Rezo sem saber mais se estou sendo ouvida por quem descansa ou por quem a Sede virou do avesso.',
    ],
    questDialogue: [
      {
        questId: 'dulce_r1_ancestrais',
        when: 'completed',
        lines: ['(Dulce se levanta, ainda trêmula, mas com o bosque enfim em silêncio.) Descansem, ancestrais. Obrigada por me devolver isso pra dizer com o coração inteiro.'],
      },
      {
        questId: 'dulce_r1_ancestrais',
        lines: [
          'Não venho pedir vingança contra os próprios ancestrais — só que voltem a descansar antes que mais gente do Bambu perca o sono por eles.',
          'Silencie-os com respeito, se puder. Eles não escolheram voltar assim.',
        ],
      },
    ],
  },
  {
    id: 'iwa_jade',
    name: 'Mestre Iwa',
    role: 'Instrutor do Pátio de Treino do Punho de Jade',
    // An old training instructor — unarmed monk rig.
    classAnalogId: 'monk',
    zoneId: 'monk_start',
    // Far down the south road of "Vila do Punho de Jade", near the map's own
    // border — same guaranteed-Path road column every starting village
    // carves south from its clearing.
    mapX: startBounds.cx,
    mapY: START_VILLAGE_SIZE.height - 4,
    appearance: npcAppearance({
      hairStyle: 'careca',
      facialHair: 'cavanhaque',
      hairColor: 0xcfd6dc,
      primaryColor: 0xd97a2e,
      secondaryColor: 0xf2ede1,
      bodyType: 'robusto',
    }),
    dialogue: [
      '(Um instrutor idoso observa o próprio pátio de treino, pisoteado, os cânticos de disciplina interrompidos.) Brotos retorcidos invadem toda madrugada — atraídos pelo ritmo dos nossos cânticos, como se confundissem disciplina com presa fácil.',
      'Um pátio que não treina em paz não forma discípulo nenhum. Preciso do pátio de volta antes do próximo amanhecer.',
    ],
    questDialogue: [
      {
        questId: 'iwa_r1_disciplina',
        when: 'completed',
        lines: ['(Mestre Iwa retoma a postura no centro do pátio, em silêncio, como se nunca tivesse saído dela.) Disciplina restaurada. Poucos de fora entendem o que isso vale aqui.'],
      },
      {
        questId: 'iwa_r1_disciplina',
        lines: [
          'Eles vêm em bando, pequenos e rápidos demais para o meu próprio ritmo de golpes.',
          'Afaste-os do pátio e prometo um ensinamento que nenhum mosteiro fora daqui oferece.',
        ],
      },
    ],
  },
);

export function getNpcById(id: string): NpcDefinition {
  const found = NPC_DEFINITIONS.find((n) => n.id === id);
  if (!found) throw new Error(`NPC desconhecido: ${id}`);
  return found;
}

/**
 * The dialogue lines to actually show for this NPC right now — the first
 * matching entry in `npc.questDialogue` (see NpcQuestDialogue), falling back
 * to `npc.dialogue` when none match. Takes primitives rather than a `Player`
 * so this data module has no dependency on the entities layer.
 */
export function dialogueLinesFor(npc: NpcDefinition, activeQuestId: string | null, completedQuestIds: string[]): string[] {
  for (const entry of npc.questDialogue ?? []) {
    const when = entry.when ?? 'active';
    if (when === 'active' && activeQuestId === entry.questId) return entry.lines;
    if (when === 'completed' && completedQuestIds.includes(entry.questId)) return entry.lines;
  }
  return npc.dialogue;
}
