import type { ItemDefinition } from '../config/types';

export const ITEM_DEFINITIONS: ItemDefinition[] = [
  {
    id: 'potion_hp',
    name: 'Poção de Vida',
    description: 'Restaura 30 pontos de vida.',
    kind: 'consumable',
    healHp: 30,
    healMp: 0,
    price: 15,
  },
  {
    id: 'potion_mp',
    name: 'Poção de Mana',
    description: 'Restaura 20 pontos de mana.',
    kind: 'consumable',
    healHp: 0,
    healMp: 20,
    price: 20,
  },
  // --- só por receita (data/recipes.ts) — nenhum vendedor os tem em estoque ---
  {
    id: 'potion_hp_major',
    name: 'Poção de Vida Maior',
    description: 'Restaura 80 pontos de vida.',
    kind: 'consumable',
    healHp: 80,
    healMp: 0,
    price: 45,
  },
  {
    id: 'elixir_restorer',
    name: 'Elixir Restaurador',
    description: 'Restaura 50 pontos de vida e 40 de mana.',
    kind: 'consumable',
    healHp: 50,
    healMp: 40,
    price: 60,
  },

  // --- Expansão de conteúdo -------------------------------------------------
  // Sold by the apothecary (data/npcs.ts) — cheap, everyday supplies.
  {
    id: 'cha_capim_santo',
    name: 'Chá de Capim-Santo',
    description: 'Chá morno de beira de fogão. Restaura 20 de vida e 15 de mana.',
    kind: 'consumable',
    healHp: 20,
    healMp: 15,
    price: 18,
  },
  {
    // A mount treat — the item id exists so the Estábulo/mount systems can
    // read it later; today it is only an ordinary (weak) consumable, since
    // "em apuro até gente come".
    id: 'racao_montaria',
    name: 'Ração de Montaria',
    description: 'Milho, rapadura e capim seco amarrados num fardo de tropeiro. Feita para a montaria — mas, em apuro, até gente come: restaura 12 de vida.',
    kind: 'consumable',
    healHp: 12,
    healMp: 0,
    price: 10,
  },
  // Recipe-only (data/recipes.ts) or quest/event rewards (data/quests.ts, data/worldEvents.ts).
  {
    id: 'potion_mp_major',
    name: 'Poção de Mana Maior',
    description: 'Fragmento arcano dissolvido em infusão de ervas. Restaura 60 pontos de mana.',
    kind: 'consumable',
    healHp: 0,
    healMp: 60,
    price: 50,
  },
  {
    id: 'agua_do_vau',
    name: 'Água Benzida do Vau',
    description: 'Água do fio que voltou a correr, benzida pela Quitéria. Restaura 45 de vida e 30 de mana.',
    kind: 'consumable',
    healHp: 45,
    healMp: 30,
    price: 35,
  },
  {
    id: 'elixir_da_raiz',
    name: 'Elixir da Raiz',
    description: 'Destilado com Essência Sedenta e devolvido à terra antes de ser bebido. Restaura 140 de vida e 80 de mana.',
    kind: 'consumable',
    healHp: 140,
    healMp: 80,
    price: 120,
  },
];

export function getItemById(id: string): ItemDefinition {
  const found = ITEM_DEFINITIONS.find((i) => i.id === id);
  if (!found) {
    throw new Error(`Item desconhecido: ${id}`);
  }
  return found;
}
