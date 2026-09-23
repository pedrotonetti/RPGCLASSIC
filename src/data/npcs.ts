import type { CharacterAppearance } from '../config/customization';
import { CLASS_ZONE_THEMES } from './classZones';
import { MAIN_CITY_ID } from './zones';

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
for (const theme of CLASS_ZONE_THEMES) {
  NPC_DEFINITIONS.push({
    id: `${theme.classId}_elder`,
    name: theme.elderName,
    role: theme.elderTitle,
    // An elder/mentor of this class's own village IS that class, so it
    // reuses that exact class's model/loadout instead of an analog guess.
    classAnalogId: theme.classId,
    zoneId: theme.startVillageId,
    mapX: 8,
    mapY: 7,
    appearance: npcAppearance({ primaryColor: theme.accentColor, secondaryColor: 0xf2ede1, hairStyle: 'longo', hairColor: 0xe8e4dc }),
    dialogue: theme.elderGreeting,
  });
  NPC_DEFINITIONS.push({
    id: `${theme.classId}_mentor`,
    name: theme.mentorName,
    role: theme.mentorTitle,
    classAnalogId: theme.classId,
    zoneId: theme.secondaryVillageId,
    mapX: 11,
    mapY: 8,
    appearance: npcAppearance({ primaryColor: theme.accentColor, secondaryColor: 0x2a2a35, bodyType: 'robusto' }),
    dialogue: theme.mentorGreeting,
  });
}

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
