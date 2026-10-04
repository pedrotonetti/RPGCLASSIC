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
