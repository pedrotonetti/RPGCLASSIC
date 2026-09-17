import type { Stats } from '../config/types';

/** A gem the jeweler sells; socketed into an equipped item for a flat stat bonus and a glow tinted to the gem's color. */
export interface GemDefinition {
  id: string;
  name: string;
  color: number;
  description: string;
  statBonus: Partial<Stats>;
  price: number;
}

export const GEM_DEFINITIONS: GemDefinition[] = [
  { id: 'gem_ruby', name: 'Rubi', color: 0xd8323f, description: 'Pulsa com calor contido.', statBonus: { attack: 3 }, price: 80 },
  { id: 'gem_sapphire', name: 'Safira', color: 0x2f6fd8, description: 'Fria ao toque, nunca ao olhar.', statBonus: { magicAttack: 3 }, price: 80 },
  { id: 'gem_emerald', name: 'Esmeralda', color: 0x2fa85a, description: 'Verde como o Verdegal em silêncio.', statBonus: { defense: 3 }, price: 80 },
  { id: 'gem_topaz', name: 'Topázio', color: 0xe0b23a, description: 'Brilha mais rápido do que se olha.', statBonus: { speed: 2 }, price: 70 },
  { id: 'gem_amethyst', name: 'Ametista', color: 0x8a4fd8, description: 'Favorece quem confia na sorte.', statBonus: { luck: 3 }, price: 70 },
  {
    id: 'gem_moonstone',
    name: 'Pedra-Lua',
    color: 0xdfe6f0,
    description: 'Uma pedra rara, dizem que aparada por um Zelador.',
    statBonus: { maxHp: 6, maxMp: 4 },
    price: 140,
  },
];

export function getGemById(id: string): GemDefinition {
  const found = GEM_DEFINITIONS.find((g) => g.id === id);
  if (!found) throw new Error(`Gema desconhecida: ${id}`);
  return found;
}
