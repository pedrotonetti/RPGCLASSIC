export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 270;
export const TILE_SIZE = 16;

export const STORAGE_KEY = 'rpgclassic:save:v1';

export const XP_TO_LEVEL = (level: number): number => Math.round(20 * level ** 1.5);
