import type { ItemRarity } from './types';

/** Ascending order — index also doubles as the rarity "tier" (0-4). */
export const RARITY_ORDER: ItemRarity[] = ['verde', 'azul', 'amarelo', 'vermelho', 'laranja'];

export const RARITY_LABEL: Record<ItemRarity, string> = {
  verde: 'Comum',
  azul: 'Raro',
  amarelo: 'Épico',
  vermelho: 'Lendário',
  laranja: 'Mítico',
};

/** Hex color used everywhere a rarity needs a swatch (item borders, name text, etc). */
export const RARITY_COLOR: Record<ItemRarity, number> = {
  verde: 0x4caf50,
  azul: 0x2f80ed,
  amarelo: 0xf2c14e,
  vermelho: 0xe0433d,
  laranja: 0xff8c1a,
};

/** How much a rarity multiplies an equipment template's base stat rolls. */
export const RARITY_STAT_MULTIPLIER: Record<ItemRarity, number> = {
  verde: 1,
  azul: 1.35,
  amarelo: 1.85,
  vermelho: 2.5,
  laranja: 3.4,
};

/** How much a rarity multiplies an item's contribution to Power Score. */
export const RARITY_SCORE_MULTIPLIER: Record<ItemRarity, number> = {
  verde: 1,
  azul: 1.6,
  amarelo: 2.6,
  vermelho: 4.2,
  laranja: 6.8,
};

export function rarityTier(rarity: ItemRarity): number {
  return RARITY_ORDER.indexOf(rarity);
}

export function rarityToHex(rarity: ItemRarity): string {
  return `#${RARITY_COLOR[rarity].toString(16).padStart(6, '0')}`;
}
