import type { ItemRarity } from '../config/types';
import type { VendorKind } from './npcs';

/** Uma quantidade de um material de `data/materials.ts`. */
export interface MaterialStack {
  materialId: string;
  qty: number;
}

export type RecipeOutput =
  /** Consumível (`data/items.ts`) — vai para `Player.inventory`. */
  | { kind: 'item'; itemId: string; qty: number }
  /** Equipamento (`data/equipment.ts`/`data/uniques.ts`) — nasce no nível do jogador, com afixos sorteados como um drop daquela raridade. */
  | { kind: 'equipment'; templateId: string; rarity: ItemRarity };

export interface RecipeDefinition {
  id: string;
  name: string;
  description: string;
  /** Qual bancada (o ofício do vendedor) conhece esta receita. */
  station: VendorKind;
  materials: MaterialStack[];
  /** Ouro no nível 1 — receitas de equipamento encarecem com o nível do jogador (ver CraftingSystem.recipeCost). */
  gold: number;
  output: RecipeOutput;
  /** Nível mínimo do jogador para a bancada liberar a receita. */
  minLevel?: number;
}

export const RECIPES: RecipeDefinition[] = [
  // --- Boticário ------------------------------------------------------------
  {
    id: 'rec_pocao_vida_maior',
    name: 'Poção de Vida Maior',
    description: 'Ervas maceradas devagar, até o caldo ficar espesso.',
    station: 'boticario',
    materials: [{ materialId: 'mat_herb', qty: 3 }],
    gold: 20,
    output: { kind: 'item', itemId: 'potion_hp_major', qty: 2 },
  },
  {
    id: 'rec_elixir_restaurador',
    name: 'Elixir Restaurador',
    description: 'Erva e um fragmento arcano dissolvido — fecha feridas e reacende a mana.',
    station: 'boticario',
    materials: [
      { materialId: 'mat_herb', qty: 2 },
      { materialId: 'mat_arcane_shard', qty: 1 },
    ],
    gold: 30,
    output: { kind: 'item', itemId: 'elixir_restorer', qty: 1 },
  },
  {
    id: 'rec_racao_montaria',
    name: 'Ração de Montaria',
    description: 'Erva seca e uma tira de couro para amarrar o fardo — do jeito que o Tropeiro Amaro ensina.',
    station: 'boticario',
    materials: [
      { materialId: 'mat_herb', qty: 2 },
      { materialId: 'mat_leather', qty: 1 },
    ],
    gold: 10,
    output: { kind: 'item', itemId: 'racao_montaria', qty: 3 },
  },
  {
    id: 'rec_pocao_mana_maior',
    name: 'Poção de Mana Maior',
    description: 'Dois fragmentos arcanos dissolvidos devagar em infusão de erva.',
    station: 'boticario',
    materials: [
      { materialId: 'mat_herb', qty: 1 },
      { materialId: 'mat_arcane_shard', qty: 2 },
    ],
    gold: 25,
    output: { kind: 'item', itemId: 'potion_mp_major', qty: 2 },
  },
  {
    id: 'rec_elixir_da_raiz',
    name: 'Elixir da Raiz',
    description: 'Erva, fragmento e uma gota de Essência Sedenta devolvida à terra antes de virar remédio.',
    station: 'boticario',
    materials: [
      { materialId: 'mat_herb', qty: 3 },
      { materialId: 'mat_arcane_shard', qty: 2 },
      { materialId: 'mat_thirst_essence', qty: 1 },
    ],
    gold: 60,
    output: { kind: 'item', itemId: 'elixir_da_raiz', qty: 1 },
    minLevel: 10,
  },

  // --- Ferreiro ---------------------------------------------------------------
  {
    id: 'rec_lamina_temperada',
    name: 'Lâmina Temperada',
    description: 'Uma Espada Curta Épica, temperada com Essência Sedenta.',
    station: 'ferreiro',
    materials: [
      { materialId: 'mat_iron_ore', qty: 6 },
      { materialId: 'mat_thirst_essence', qty: 1 },
    ],
    gold: 120,
    output: { kind: 'equipment', templateId: 'espada_curta', rarity: 'amarelo' },
    minLevel: 5,
  },
  {
    id: 'rec_placas_reforcadas',
    name: 'Placas Reforçadas',
    description: 'Uma Armadura de Placas Épica, rebitada em couro.',
    station: 'ferreiro',
    materials: [
      { materialId: 'mat_iron_ore', qty: 5 },
      { materialId: 'mat_leather', qty: 2 },
      { materialId: 'mat_thirst_essence', qty: 1 },
    ],
    gold: 130,
    output: { kind: 'equipment', templateId: 'armadura_placas', rarity: 'amarelo' },
    minLevel: 5,
  },
  {
    id: 'rec_machado_das_brasas',
    name: 'Machado das Brasas',
    description: 'Peça do conjunto Brasas da Pedra Vermelha.',
    station: 'ferreiro',
    materials: [
      { materialId: 'mat_iron_ore', qty: 8 },
      { materialId: 'mat_thirst_essence', qty: 2 },
    ],
    gold: 180,
    output: { kind: 'equipment', templateId: 'machado_das_brasas', rarity: 'azul' },
    minLevel: 8,
  },
  {
    id: 'rec_couraca_das_brasas',
    name: 'Couraça das Brasas',
    description: 'Peça do conjunto Brasas da Pedra Vermelha.',
    station: 'ferreiro',
    materials: [
      { materialId: 'mat_iron_ore', qty: 6 },
      { materialId: 'mat_leather', qty: 3 },
      { materialId: 'mat_thirst_essence', qty: 2 },
    ],
    gold: 180,
    output: { kind: 'equipment', templateId: 'couraca_das_brasas', rarity: 'azul' },
    minLevel: 8,
  },
  {
    id: 'rec_facao_temperado',
    name: 'Facão Temperado',
    description: 'Um Facão de Mato Épico, de lâmina larga e cabo de couro trançado.',
    station: 'ferreiro',
    materials: [
      { materialId: 'mat_iron_ore', qty: 5 },
      { materialId: 'mat_leather', qty: 1 },
      { materialId: 'mat_thirst_essence', qty: 1 },
    ],
    gold: 110,
    output: { kind: 'equipment', templateId: 'facao_de_mato', rarity: 'amarelo' },
    minLevel: 5,
  },

  // --- Tecelã -----------------------------------------------------------------
  {
    id: 'rec_vestes_bordadas',
    name: 'Vestes Bordadas',
    description: 'Vestes Arcanas Épicas, bordadas com fio de fragmento.',
    station: 'tecelao',
    materials: [
      { materialId: 'mat_leather', qty: 4 },
      { materialId: 'mat_arcane_shard', qty: 2 },
      { materialId: 'mat_thirst_essence', qty: 1 },
    ],
    gold: 120,
    output: { kind: 'equipment', templateId: 'vestes_arcanas', rarity: 'amarelo' },
    minLevel: 5,
  },
  {
    id: 'rec_manto_do_peregrino',
    name: 'Manto do Peregrino',
    description: 'Peça do conjunto Peregrino do Verdegal.',
    station: 'tecelao',
    materials: [
      { materialId: 'mat_leather', qty: 6 },
      { materialId: 'mat_herb', qty: 2 },
      { materialId: 'mat_thirst_essence', qty: 2 },
    ],
    gold: 160,
    output: { kind: 'equipment', templateId: 'manto_do_peregrino', rarity: 'azul' },
    minLevel: 8,
  },
  {
    id: 'rec_gibao_do_tropeiro',
    name: 'Gibão do Tropeiro',
    description: 'Peça do conjunto Lida do Tropeiro.',
    station: 'tecelao',
    materials: [
      { materialId: 'mat_leather', qty: 7 },
      { materialId: 'mat_herb', qty: 1 },
      { materialId: 'mat_thirst_essence', qty: 2 },
    ],
    gold: 160,
    output: { kind: 'equipment', templateId: 'gibao_do_tropeiro', rarity: 'azul' },
    minLevel: 8,
  },

  // --- Artesã -----------------------------------------------------------------
  {
    id: 'rec_arco_entalhado',
    name: 'Arco Entalhado',
    description: 'Um Arco Longo Épico, com empunhadura de couro e ponteiras de ferro.',
    station: 'artesao',
    materials: [
      { materialId: 'mat_leather', qty: 4 },
      { materialId: 'mat_iron_ore', qty: 2 },
      { materialId: 'mat_thirst_essence', qty: 1 },
    ],
    gold: 120,
    output: { kind: 'equipment', templateId: 'arco_longo', rarity: 'amarelo' },
    minLevel: 5,
  },
  {
    id: 'rec_cajado_do_peregrino',
    name: 'Cajado do Peregrino',
    description: 'Peça do conjunto Peregrino do Verdegal.',
    station: 'artesao',
    materials: [
      { materialId: 'mat_leather', qty: 3 },
      { materialId: 'mat_arcane_shard', qty: 4 },
      { materialId: 'mat_thirst_essence', qty: 2 },
    ],
    gold: 160,
    output: { kind: 'equipment', templateId: 'cajado_do_peregrino', rarity: 'azul' },
    minLevel: 8,
  },
  {
    id: 'rec_aguilhada_do_tropeiro',
    name: 'Aguilhada do Tropeiro',
    description: 'Peça do conjunto Lida do Tropeiro.',
    station: 'artesao',
    materials: [
      { materialId: 'mat_leather', qty: 2 },
      { materialId: 'mat_iron_ore', qty: 4 },
      { materialId: 'mat_thirst_essence', qty: 2 },
    ],
    gold: 160,
    output: { kind: 'equipment', templateId: 'aguilhada_do_tropeiro', rarity: 'azul' },
    minLevel: 8,
  },
  {
    id: 'rec_berrante_do_tropeiro',
    name: 'Berrante do Tropeiro',
    description: 'Peça do conjunto Lida do Tropeiro.',
    station: 'artesao',
    materials: [
      { materialId: 'mat_leather', qty: 4 },
      { materialId: 'mat_arcane_shard', qty: 1 },
      { materialId: 'mat_thirst_essence', qty: 2 },
    ],
    gold: 160,
    output: { kind: 'equipment', templateId: 'berrante_do_tropeiro', rarity: 'azul' },
    minLevel: 8,
  },

  // --- Joalheiro --------------------------------------------------------------
  {
    id: 'rec_anel_lapidado',
    name: 'Anel Lapidado',
    description: 'Um Anel da Sorte Épico, lapidado em fragmento arcano.',
    station: 'joalheiro',
    materials: [
      { materialId: 'mat_arcane_shard', qty: 5 },
      { materialId: 'mat_thirst_essence', qty: 1 },
    ],
    gold: 140,
    output: { kind: 'equipment', templateId: 'anel_sorte', rarity: 'amarelo' },
    minLevel: 5,
  },
  {
    id: 'rec_amuleto_do_peregrino',
    name: 'Amuleto do Peregrino',
    description: 'Peça do conjunto Peregrino do Verdegal.',
    station: 'joalheiro',
    materials: [
      { materialId: 'mat_arcane_shard', qty: 5 },
      { materialId: 'mat_herb', qty: 2 },
      { materialId: 'mat_thirst_essence', qty: 2 },
    ],
    gold: 160,
    output: { kind: 'equipment', templateId: 'amuleto_do_peregrino', rarity: 'azul' },
    minLevel: 8,
  },
];

export function getRecipeById(id: string): RecipeDefinition | undefined {
  return RECIPES.find((r) => r.id === id);
}

export function recipesForStation(station: VendorKind): RecipeDefinition[] {
  return RECIPES.filter((r) => r.station === station);
}
