import type { EquipmentTemplate, ItemRarity, Stats } from '../config/types';
import type { ItemModifiers } from './affixes';

/** Every field that is set must hold (AND). Fractions are 0..1 of the relevant max. */
export interface PassiveCondition {
  hpBelow?: number;
  hpAbove?: number;
  mpBelow?: number;
  mpAbove?: number;
  /** The wearer's class-mechanic id (fury, precision, faith, souls, flow). */
  mechanic?: string;
  meterAtLeast?: number;
  comboAtLeast?: number;
  /** Evaluated per hit, against the enemy being hit. */
  targetHpBelow?: number;
  minEnemies?: number;
}

/** A continuous effect, live only while `when` holds. `statMult` entries are additive fractions (0.2 = +20%, -0.3 = -30%). */
export interface PassiveEffect {
  when?: PassiveCondition;
  mods?: Partial<ItemModifiers>;
  statMult?: Partial<Record<keyof Stats, number>>;
}

export type TriggerEvent = 'kill' | 'crit' | 'hitTaken' | 'block' | 'perfectBlock' | 'dodge';

/** A one-shot payoff fired when `on` happens. */
export interface PassiveTrigger {
  on: TriggerEvent;
  when?: PassiveCondition;
  /** 0..1, default 1. */
  chance?: number;
  healHpPct?: number;
  restoreMpPct?: number;
  /** Shown in the combat log when it fires. */
  label: string;
}

export interface ItemPassive {
  id: string;
  name: string;
  description: string;
  effects: PassiveEffect[];
  triggers?: PassiveTrigger[];
}

export interface SetBonus {
  /** Equipped pieces needed. */
  pieces: number;
  description: string;
  stats?: Partial<Stats>;
  effects?: PassiveEffect[];
  triggers?: PassiveTrigger[];
}

export interface SetDefinition {
  id: string;
  name: string;
  /** Template ids of the pieces. */
  pieces: string[];
  bonuses: SetBonus[];
}

export const ITEM_PASSIVES: ItemPassive[] = [
  {
    id: 'sede_insaciavel',
    name: 'Sede Insaciável',
    description: 'Abaixo de 30% de vida, regenera 8% da mana máxima por segundo.',
    effects: [{ when: { hpBelow: 0.3 }, mods: { mpRegenPct: 0.08 } }],
  },
  {
    id: 'seiva_viva',
    name: 'Seiva Viva',
    description: 'Ao derrotar um inimigo, recupera 10% da vida máxima.',
    effects: [],
    triggers: [{ on: 'kill', healHpPct: 0.1, label: 'Seiva Viva' }],
  },
  {
    id: 'casca_rachada',
    name: 'Casca Rachada',
    description: 'Reflete 12% do dano recebido. Abaixo de 50% de vida, recebe 20% menos dano.',
    effects: [{ mods: { thorns: 0.12 } }, { when: { hpBelow: 0.5 }, mods: { damageReduction: 0.2 } }],
  },
  {
    id: 'ritmo_do_orvalho',
    name: 'Ritmo do Orvalho',
    description: 'Com combo de 4 ou mais acertos, causa 25% a mais de dano e ganha 8% de chance crítica.',
    effects: [{ when: { comboAtLeast: 4 }, mods: { damageDealt: 0.25, critChance: 0.08 } }],
  },
  {
    id: 'pacto_de_sangue',
    name: 'Pacto de Sangue',
    description: 'Causa 35% a mais de dano e rouba 5% do dano como vida, mas recebe 25% a mais de dano.',
    effects: [{ mods: { damageDealt: 0.35, lifeSteal: 0.05, damageTaken: 0.25 } }],
  },
  {
    id: 'eco_faminto',
    name: 'Eco Faminto',
    description: 'O recurso de classe (Fúria, Precisão, Fé, Almas) enche 50% mais rápido. Com ele cheio — ou no Fluxo nível 2 do Monge — causa 15% a mais de dano.',
    effects: [
      { mods: { meterGain: 0.5 } },
      { when: { meterAtLeast: 1 }, mods: { damageDealt: 0.15 } },
      { when: { mechanic: 'flow', comboAtLeast: 4 }, mods: { damageDealt: 0.15 } },
    ],
  },
  {
    id: 'juramento_do_zelador',
    name: 'Juramento do Zelador',
    description: 'Bloqueio perfeito restaura 12% da vida e 10% da mana. Bloqueio comum restaura 4% da vida.',
    effects: [],
    triggers: [
      { on: 'perfectBlock', healHpPct: 0.12, restoreMpPct: 0.1, label: 'Juramento do Zelador' },
      { on: 'block', healHpPct: 0.04, label: 'Juramento do Zelador' },
    ],
  },
  {
    id: 'fome_da_raiz',
    name: 'Fome da Raiz',
    description: 'Habilidades custam 20% menos mana. Golpes críticos restauram 5% da mana máxima.',
    effects: [{ mods: { mpCost: 0.2 } }],
    triggers: [{ on: 'crit', restoreMpPct: 0.05, label: 'Fome da Raiz' }],
  },
  // --- Expansão de conteúdo (side-quest rewards in data/quests.ts; they also drop like any unique) ---
  {
    id: 'agua_corrente',
    name: 'Água Corrente',
    description: 'Regenera 0,5 de mana por segundo. Ao derrotar um inimigo, recupera 6% da vida e 6% da mana máximas.',
    effects: [{ mods: { mpRegen: 0.5 } }],
    triggers: [{ on: 'kill', healHpPct: 0.06, restoreMpPct: 0.06, label: 'Água Corrente' }],
  },
  {
    id: 'golpe_de_cantaria',
    name: 'Golpe de Cantaria',
    description: 'Causa 25% a mais de dano a inimigos abaixo de 35% de vida, e cada golpe tem 15% de chance de deixar o alvo lento.',
    effects: [{ when: { targetHpBelow: 0.35 }, mods: { damageDealt: 0.25 } }, { mods: { slowChance: 0.15 } }],
  },
  {
    id: 'lingua_sem_raiz',
    name: 'Língua Sem Raiz',
    description: 'Recebe 12% menos dano. Abaixo de 50% de vida, ganha 8% de chance crítica. Golpes críticos restauram 4% da vida máxima.',
    effects: [{ mods: { damageReduction: 0.12 } }, { when: { hpBelow: 0.5 }, mods: { critChance: 0.08 } }],
    triggers: [{ on: 'crit', healHpPct: 0.04, label: 'Língua Sem Raiz' }],
  },
];

export const UNIQUE_TEMPLATES: EquipmentTemplate[] = [
  // --- Lendários ---------------------------------------------------------
  {
    id: 'manto_da_sede',
    name: 'Manto da Sede',
    slot: 'armadura',
    description: 'Tecido que bebe a própria dor para sustentar a magia.',
    statWeights: { magicDefense: 3, maxMp: 5 },
    fixedRarity: 'vermelho',
    passiveId: 'sede_insaciavel',
    iconTemplateId: 'manto_sagrado',
  },
  {
    id: 'coracao_de_seiva',
    name: 'Coração de Seiva',
    slot: 'acessorio',
    description: 'Ainda pulsa, mesmo arrancado da Raiz.',
    statWeights: { maxHp: 7, luck: 1 },
    fixedRarity: 'vermelho',
    passiveId: 'seiva_viva',
    iconTemplateId: 'amuleto_vitalidade',
  },
  {
    id: 'casca_do_ipe_rachado',
    name: 'Casca do Ipê Rachado',
    slot: 'armadura',
    description: 'Cada rachadura guarda uma Florescência que não veio.',
    statWeights: { defense: 4, maxHp: 4 },
    fixedRarity: 'vermelho',
    passiveId: 'casca_rachada',
    iconTemplateId: 'armadura_placas',
  },
  {
    id: 'gume_do_orvalho',
    name: 'Gume do Orvalho',
    slot: 'arma',
    description: 'A última gota antes da seca — e ela não cai sozinha.',
    statWeights: { attack: 2, speed: 3, luck: 1 },
    fixedRarity: 'vermelho',
    passiveId: 'ritmo_do_orvalho',
    iconTemplateId: 'adaga_sombria',
  },
  // --- Míticos -----------------------------------------------------------
  {
    id: 'presa_do_pacto',
    name: 'Presa do Pacto',
    slot: 'arma',
    description: 'Quem a empunha jamais foi o primeiro dono.',
    statWeights: { attack: 5, luck: 1 },
    fixedRarity: 'laranja',
    passiveId: 'pacto_de_sangue',
    iconTemplateId: 'machado_guerra',
  },
  {
    id: 'selo_do_eco',
    name: 'Selo do Eco Faminto',
    slot: 'acessorio',
    description: 'Repete cada golpe até o corpo aprender a fome.',
    statWeights: { luck: 2, maxHp: 4 },
    fixedRarity: 'laranja',
    passiveId: 'eco_faminto',
    iconTemplateId: 'anel_sorte',
  },
  {
    id: 'martelo_do_zelador',
    name: 'Martelo do Último Zelador',
    slot: 'arma',
    description: 'Selou a ferida uma vez. Ainda lembra o peso do juramento.',
    statWeights: { attack: 3, magicDefense: 2, maxHp: 3 },
    fixedRarity: 'laranja',
    passiveId: 'juramento_do_zelador',
    iconTemplateId: 'martelo_sagrado',
  },
  {
    id: 'grimorio_das_raizes',
    name: 'Grimório das Raízes Famintas',
    slot: 'arma',
    description: 'As páginas bebem da mesma fonte que a Sede.',
    statWeights: { magicAttack: 5, luck: 1 },
    fixedRarity: 'laranja',
    passiveId: 'fome_da_raiz',
    iconTemplateId: 'grimorio_amaldicoado',
  },
  // --- Expansão de conteúdo ----------------------------------------------
  {
    id: 'patua_do_vau',
    name: 'Patuá do Vau',
    slot: 'acessorio',
    description: 'Costurado com fibra do último junco verde do rio. Anda leve quem carrega um pouco d\'água consigo.',
    statWeights: { maxHp: 4, maxMp: 4, magicDefense: 1 },
    fixedRarity: 'vermelho',
    passiveId: 'agua_corrente',
    iconTemplateId: 'amuleto_vitalidade',
  },
  {
    id: 'marreta_do_pedreiro',
    name: 'Marreta do Pedreiro Tomé',
    slot: 'arma',
    description: 'Assentou pedra do Baluarte por quarenta anos. Sabe exatamente onde uma coisa racha.',
    statWeights: { attack: 4, defense: 1, maxHp: 2 },
    fixedRarity: 'vermelho',
    passiveId: 'golpe_de_cantaria',
    iconTemplateId: 'martelo_sagrado',
  },
  {
    id: 'coracao_sem_patria',
    name: 'Coração Sem Pátria',
    slot: 'acessorio',
    description: 'Um nó de raiz trazido pela maré. Bate num ritmo que nenhum ipê de Ipêra conhece.',
    statWeights: { maxHp: 5, luck: 2, defense: 1 },
    fixedRarity: 'laranja',
    passiveId: 'lingua_sem_raiz',
    iconTemplateId: 'anel_sorte',
  },
];

export const SET_TEMPLATES: EquipmentTemplate[] = [
  {
    id: 'cajado_do_peregrino',
    name: 'Cajado do Peregrino',
    slot: 'arma',
    description: 'Madeira de ipê, polida por mil caminhadas.',
    statWeights: { magicAttack: 3, maxMp: 3 },
    setId: 'peregrino_do_verdegal',
    iconTemplateId: 'cajado_arcano',
  },
  {
    id: 'manto_do_peregrino',
    name: 'Manto do Peregrino',
    slot: 'armadura',
    description: 'Remendado em cada vilarejo por onde passou.',
    statWeights: { magicDefense: 3, maxHp: 4 },
    setId: 'peregrino_do_verdegal',
    iconTemplateId: 'manto_sagrado',
  },
  {
    id: 'amuleto_do_peregrino',
    name: 'Amuleto do Peregrino',
    slot: 'acessorio',
    description: 'Guarda uma gota da última nascente viva.',
    statWeights: { maxMp: 4, luck: 1 },
    setId: 'peregrino_do_verdegal',
    iconTemplateId: 'amuleto_vitalidade',
  },
  {
    id: 'machado_das_brasas',
    name: 'Machado das Brasas',
    slot: 'arma',
    description: 'Forjado onde a pedra ainda é vermelha.',
    statWeights: { attack: 4, defense: 1 },
    setId: 'brasas_da_pedra_vermelha',
    iconTemplateId: 'machado_guerra',
  },
  {
    id: 'couraca_das_brasas',
    name: 'Couraça das Brasas',
    slot: 'armadura',
    description: 'Quente ao toque, mesmo no inverno da serra.',
    statWeights: { defense: 4, maxHp: 5 },
    setId: 'brasas_da_pedra_vermelha',
    iconTemplateId: 'armadura_placas',
  },
  {
    id: 'aguilhada_do_tropeiro',
    name: 'Aguilhada do Tropeiro',
    slot: 'arma',
    description: 'Vara de ponta de ferro que tocou tropa por todas as serras de Ipêra.',
    statWeights: { attack: 3, speed: 1, maxHp: 2 },
    setId: 'lida_do_tropeiro',
    iconTemplateId: 'cajado_arcano',
  },
  {
    id: 'gibao_do_tropeiro',
    name: 'Gibão do Tropeiro',
    slot: 'armadura',
    description: 'Couro curtido no sal da estrada. Cheira a poeira e a chuva que não veio.',
    statWeights: { defense: 3, maxHp: 5 },
    setId: 'lida_do_tropeiro',
    iconTemplateId: 'armadura_couro',
  },
  {
    id: 'berrante_do_tropeiro',
    name: 'Berrante do Tropeiro',
    slot: 'acessorio',
    description: 'Um toque e a tropa inteira sabe para onde ir — até a que já se perdeu.',
    statWeights: { maxHp: 4, speed: 2 },
    setId: 'lida_do_tropeiro',
    iconTemplateId: 'talisma_velocidade',
  },
];

export const SET_DEFINITIONS: SetDefinition[] = [
  {
    id: 'peregrino_do_verdegal',
    name: 'Peregrino do Verdegal',
    pieces: ['cajado_do_peregrino', 'manto_do_peregrino', 'amuleto_do_peregrino'],
    bonuses: [
      {
        pieces: 2,
        description: '+15 de Mana máxima e +1 de regeneração de MP por segundo.',
        stats: { maxMp: 15 },
        effects: [{ mods: { mpRegen: 1 } }],
      },
      {
        pieces: 3,
        description: 'Habilidades custam 15% menos mana e derrotar um inimigo restaura 8% da mana máxima.',
        effects: [{ mods: { mpCost: 0.15 } }],
        triggers: [{ on: 'kill', restoreMpPct: 0.08, label: 'Fôlego do Peregrino' }],
      },
    ],
  },
  {
    id: 'brasas_da_pedra_vermelha',
    name: 'Brasas da Pedra Vermelha',
    pieces: ['machado_das_brasas', 'couraca_das_brasas'],
    bonuses: [
      {
        pieces: 2,
        description: '+6 de Ataque e +4 de Defesa. Abaixo de 50% de vida, +20% de Ataque e Ataque Mágico.',
        stats: { attack: 6, defense: 4 },
        effects: [{ when: { hpBelow: 0.5 }, statMult: { attack: 0.2, magicAttack: 0.2 } }],
      },
    ],
  },
  {
    // The Tropeiro Amaro's own trade (data/npcs.ts), crafted at the weaver's
    // and artisan's benches (data/recipes.ts) — a sturdy, travel-minded set.
    id: 'lida_do_tropeiro',
    name: 'Lida do Tropeiro',
    pieces: ['aguilhada_do_tropeiro', 'gibao_do_tropeiro', 'berrante_do_tropeiro'],
    bonuses: [
      {
        pieces: 2,
        description: '+20 de Vida máxima e +3 de Velocidade.',
        stats: { maxHp: 20, speed: 3 },
      },
      {
        pieces: 3,
        description: '+10% de ouro encontrado, e derrotar um inimigo restaura 6% da vida máxima.',
        effects: [{ mods: { goldFind: 0.1 } }],
        triggers: [{ on: 'kill', healHpPct: 0.06, label: 'Fôlego da Estrada' }],
      },
    ],
  },
];

/** Chance that a Lendário/Mítico drop is a unique rather than a regular item of that rarity. */
export const UNIQUE_DROP_CHANCE: Partial<Record<ItemRarity, number>> = { vermelho: 0.6, laranja: 0.8 };

/** Affixes a unique rolls on top of its passive — its identity is the passive, not the affixes. */
export const UNIQUE_AFFIX_COUNT: Partial<Record<ItemRarity, number>> = { vermelho: 1, laranja: 2 };

/** Chance that a Raro-or-better drop is a set piece. */
export const SET_PIECE_DROP_CHANCE = 0.18;

export function getItemPassive(id: string): ItemPassive | undefined {
  return ITEM_PASSIVES.find((p) => p.id === id);
}

export function getSetDefinition(id: string): SetDefinition | undefined {
  return SET_DEFINITIONS.find((s) => s.id === id);
}
