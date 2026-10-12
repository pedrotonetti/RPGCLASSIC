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
];

export function getItemById(id: string): ItemDefinition {
  const found = ITEM_DEFINITIONS.find((i) => i.id === id);
  if (!found) {
    throw new Error(`Item desconhecido: ${id}`);
  }
  return found;
}
