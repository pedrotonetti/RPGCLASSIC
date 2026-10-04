import { RARITY_ORDER, rarityTier } from '../config/rarity';
import type { ItemRarity } from '../config/types';

/** Consecutive real drops since the last item at or above each guaranteed tier. */
export interface LootPityState {
  sinceEpic: number;
  sinceLegendary: number;
}

/** After this many drops without an Épico or better, the next drop is guaranteed at least Épico. */
export const PITY_EPIC_THRESHOLD = 10;
/** Same for Lendário. */
export const PITY_LEGENDARY_THRESHOLD = 40;

const EPIC_TIER = rarityTier('amarelo');
const LEGENDARY_TIER = rarityTier('vermelho');

export function createInitialPity(): LootPityState {
  return { sinceEpic: 0, sinceLegendary: 0 };
}

function cleanCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Safe default for saves from before pity existed (and for malformed data). */
export function sanitizePity(raw: unknown): LootPityState {
  const source = (raw ?? {}) as Partial<Record<keyof LootPityState, unknown>>;
  return { sinceEpic: cleanCount(source.sinceEpic), sinceLegendary: cleanCount(source.sinceLegendary) };
}

/** The lowest rarity the next drop may roll, or null when no guarantee is due. */
export function pityFloor(state: LootPityState): ItemRarity | null {
  if (state.sinceLegendary >= PITY_LEGENDARY_THRESHOLD) return RARITY_ORDER[LEGENDARY_TIER];
  if (state.sinceEpic >= PITY_EPIC_THRESHOLD) return RARITY_ORDER[EPIC_TIER];
  return null;
}

/** Updates the counters in place after a real drop of `rarity`. */
export function recordDrop(state: LootPityState, rarity: ItemRarity): void {
  const tier = rarityTier(rarity);
  state.sinceEpic = tier >= EPIC_TIER ? 0 : state.sinceEpic + 1;
  state.sinceLegendary = tier >= LEGENDARY_TIER ? 0 : state.sinceLegendary + 1;
}
