/** World units (meters) per overworld grid tile. */
export const TILE_SIZE = 2;

export const STORAGE_KEY = 'rpgclassic:save:v2';

export const XP_TO_LEVEL = (level: number): number => Math.round(20 * level ** 1.5);
