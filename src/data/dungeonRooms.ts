import type { ItemModifiers } from './affixes';

/**
 * Salas especiais de masmorra (Dungeons 2.0). Além das emboscadas comuns, uma
 * run pode ter salas de elite (mini-chefe), santuários (escolha entre bênção,
 * ouro ou cura) e armadilhas/eventos (escolha arriscada). Quais salas viram o
 * quê é sorteado por `systems/DungeonRoomSystem.ts`; aqui só ficam os textos
 * e os efeitos de cada escolha.
 */
export type DungeonRoomKind = 'combat' | 'elite' | 'shrine' | 'trap';

/** Um resultado possível de uma escolha. `chance` só importa quando a escolha tem mais de um resultado (soma 1). */
export interface RoomOutcomeDefinition {
  chance: number;
  message: string;
  /** Dano em fração da vida máxima (nunca mata — ver DungeonRoomSystem.applyRoomOutcome). */
  hpLossPct?: number;
  /** Custo de mana em fração da mana máxima; se faltar mana, vira `hpLossPct` de reserva. */
  mpCostPct?: number;
  /** Ouro em "unidades de sala" — multiplicado pelo nível da masmorra e o tier (ver roomGoldAmount). */
  goldUnits?: number;
  /** Restaura vida e mana por completo (ignora Seiva Amarga — é a água do santuário, não cura comum). */
  fullRestore?: boolean;
  /** Bênção que dura o resto da run (somada aos modificadores do jogador). */
  blessing?: Partial<ItemModifiers>;
}

export interface RoomChoiceDefinition {
  id: string;
  label: string;
  hint: string;
  outcomes: RoomOutcomeDefinition[];
  /** Dano (fração da vida máxima) cobrado no lugar de um custo de mana que não pode ser pago. */
  fallbackHpLossPct?: number;
}

export interface RoomEventDefinition {
  id: string;
  kind: 'shrine' | 'trap';
  name: string;
  description: string;
  choices: RoomChoiceDefinition[];
}

export const SHRINE_EVENTS: RoomEventDefinition[] = [
  {
    id: 'santuario_seiva',
    kind: 'shrine',
    name: 'Santuário da Seiva Limpa',
    description: 'Uma raiz antiga ainda verte seiva limpa aqui embaixo. Ela oferece um único presente — escolha bem.',
    choices: [
      {
        id: 'bencao',
        label: 'Bênção',
        hint: '+12% de dano causado pelo resto da incursão.',
        outcomes: [{ chance: 1, message: 'A seiva corre pelas suas mãos: +12% de dano até o fim da incursão.', blessing: { damageDealt: 0.12 } }],
      },
      {
        id: 'ouro',
        label: 'Oferendas',
        hint: 'Recolha o ouro deixado aos pés da raiz.',
        outcomes: [{ chance: 1, message: 'Você recolhe as oferendas esquecidas.', goldUnits: 1 }],
      },
      {
        id: 'cura',
        label: 'Água límpida',
        hint: 'Restaura toda a vida e a mana.',
        outcomes: [{ chance: 1, message: 'Você bebe da seiva limpa: vida e mana restauradas.', fullRestore: true }],
      },
    ],
  },
];

export const TRAP_EVENTS: RoomEventDefinition[] = [
  {
    id: 'fosso_espinhos',
    kind: 'trap',
    name: 'Fosso de Espinhos',
    description: 'Raízes afiadas como lanças cobrem o chão da câmara. Dá para saltar por cima — ou gastar mana para fazê-las recuar.',
    choices: [
      {
        id: 'saltar',
        label: 'Saltar',
        hint: 'Arriscado: pode sair ileso… ou não.',
        outcomes: [
          { chance: 0.6, message: 'Você cruza o fosso num salto limpo.' },
          { chance: 0.4, message: 'Os espinhos rasgam sua perna na aterrissagem (-20% de vida).', hpLossPct: 0.2 },
        ],
      },
      {
        id: 'desarmar',
        label: 'Desarmar',
        hint: 'Gasta 30% da mana máxima.',
        fallbackHpLossPct: 0.15,
        outcomes: [{ chance: 1, message: 'As raízes recuam diante da sua vontade.', mpCostPct: 0.3 }],
      },
    ],
  },
  {
    id: 'altar_rachado',
    kind: 'trap',
    name: 'Altar Rachado',
    description: 'Um altar partido ao meio pulsa num ritmo errado. Algo ainda responde a quem o toca.',
    choices: [
      {
        id: 'tocar',
        label: 'Tocar o altar',
        hint: 'Metade das vezes abençoa, metade fere.',
        outcomes: [
          { chance: 0.5, message: 'O altar aceita você: +10% de chance crítica até o fim da incursão.', blessing: { critChance: 0.1 } },
          { chance: 0.5, message: 'A rachadura cospe seiva podre em você (-15% de vida).', hpLossPct: 0.15 },
        ],
      },
      { id: 'ignorar', label: 'Seguir em frente', hint: 'Nada ganho, nada perdido.', outcomes: [{ chance: 1, message: 'Você deixa o altar para trás.' }] },
    ],
  },
  {
    id: 'nevoa_sussurrante',
    kind: 'trap',
    name: 'Névoa Sussurrante',
    description: 'Uma névoa espessa cobre a câmara, e dentro dela algo brilha como ouro. Os sussurros pedem um pouco de você em troca.',
    choices: [
      {
        id: 'atravessar',
        label: 'Atravessar a névoa',
        hint: 'Perde 10% da vida, ganha ouro.',
        outcomes: [{ chance: 1, message: 'A névoa cobra seu preço, mas você sai com os bolsos cheios.', hpLossPct: 0.1, goldUnits: 1.5 }],
      },
      { id: 'contornar', label: 'Contornar', hint: 'Seguro, sem recompensa.', outcomes: [{ chance: 1, message: 'Você contorna a névoa pelas bordas.' }] },
    ],
  },
];

export const ROOM_EVENTS: RoomEventDefinition[] = [...SHRINE_EVENTS, ...TRAP_EVENTS];

export function getRoomEvent(id: string): RoomEventDefinition | undefined {
  return ROOM_EVENTS.find((e) => e.id === id);
}

/** Nome curto de cada tipo de sala — para o HUD e os rótulos no mapa. */
export const ROOM_KIND_LABEL: Record<DungeonRoomKind, string> = {
  combat: 'Emboscada',
  elite: 'Sala de elite',
  shrine: 'Santuário',
  trap: 'Armadilha',
};
