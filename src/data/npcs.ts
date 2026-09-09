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
      'Ah, um novo herói em Pedravale... Já era hora.',
      'Uma sombra antiga desperta nas ruínas a leste. Nós a chamamos de Praga Sombria.',
      'Ela corrompe bestas e homens, tornando-os inimigos de tudo que é vivo.',
      'Prove seu valor lá fora, e talvez juntos possamos deter o que está por vir.',
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
      'Já vi coisas saindo daquelas ruínas que não deveriam existir.',
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
      'Volte sempre que precisar se recuperar, herói.',
    ],
  },
];

export function getNpcById(id: string): NpcDefinition {
  const found = NPC_DEFINITIONS.find((n) => n.id === id);
  if (!found) throw new Error(`NPC desconhecido: ${id}`);
  return found;
}
