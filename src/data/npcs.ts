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

export interface NpcDefinition {
  id: string;
  name: string;
  role: string;
  /** Which zone this NPC stands in — the main city, or one of the class villages. */
  zoneId: string;
  mapX: number;
  mapY: number;
  dialogue: string[];
  appearance: CharacterAppearance;
  vendor?: VendorInfo;
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
      'Você é um Vozeiro. Consegue ouvir os ancestrais diretamente. É um dom que se acreditava extinto.',
      'Vá até os ipezais além da vila e ouça por si mesmo o que as Raízes têm a dizer. Eu... preciso pensar em como te contar o resto.',
    ],
  },
  {
    id: 'elira',
    name: 'Ferreira Elira',
    role: 'Ferreira',
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
      'Você deve ser o Vozeiro de quem todos falam. Eu sou Zaya — vim de um vilarejo três serras a leste.',
      'Andei seguindo o rastro da Sede até aqui. Prometo te ajudar no que precisar lá fora.',
      '(Zaya sorri, mas por um instante seus olhos pesam, como quem carrega um recado que ainda não entregou.)',
    ],
  },
  {
    id: 'artesa_bina',
    name: 'Artesã Bina',
    role: 'Artesã',
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
      'Comandante Gael me mandou correndo à frente do comboio — disse que você era forte o bastante pra isso, Vozeiro.',
      'Fugimos do Forte de Ferro com o que coube nas costas. As trilhas atrás de nós não estão seguras como antes.',
      'Se Pedravale não aguentar esse tanto de gente com fome e sem teto... o Comandante teme que a cidade vire um problema antes de virar um lar.',
    ],
  },
  {
    id: 'correio_bento',
    name: 'Correio Bento',
    role: 'Mensageiro de Pedravale',
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
      'Orin acha que só reage a um Vozeiro. Não sei bem o que isso quer dizer — só sei que ele parecia mais assustado que curioso.',
    ],
  },
  {
    id: 'cacador_ren',
    name: 'Caçador Ren',
    role: 'Batedor das Trilhas',
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
  },
  {
    id: 'vigia_talma',
    name: 'Vigia Talma',
    role: 'Chefe da Guarda de Pedravale',
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
