import type { CharacterAppearance } from '../config/customization';

export interface NpcDefinition {
  id: string;
  name: string;
  role: string;
  mapX: number;
  mapY: number;
  dialogue: string[];
  appearance: CharacterAppearance;
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

export const NPC_DEFINITIONS: NpcDefinition[] = [
  {
    id: 'tobias',
    name: 'Ancião Tobias',
    role: 'Líder de Pedravale',
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
  },
  {
    id: 'bram',
    name: 'Guarda Bram',
    role: 'Guarda da Vila',
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
    role: 'Curandeira',
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
  },
  {
    id: 'zaya',
    name: 'Zaya',
    role: 'Batedora Viajante',
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
];

export function getNpcById(id: string): NpcDefinition {
  const found = NPC_DEFINITIONS.find((n) => n.id === id);
  if (!found) throw new Error(`NPC desconhecido: ${id}`);
  return found;
}
