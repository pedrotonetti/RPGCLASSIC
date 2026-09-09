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
];

export function getItemById(id: string): ItemDefinition {
  const found = ITEM_DEFINITIONS.find((i) => i.id === id);
  if (!found) {
    throw new Error(`Item desconhecido: ${id}`);
  }
  return found;
}
