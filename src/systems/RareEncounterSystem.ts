import { RARITY_ORDER } from '../config/rarity';
import type { EquipmentInstance, ItemRarity } from '../config/types';
import { generateLoot } from '../data/equipment';

export const RARE_TIER_MULTIPLIER = 1.6;
export const RARE_MODEL_SCALE = 1.28;
export const PITY_GUARANTEE = 40;
export const PITY_PER_FAILED_MOUNT_ROLL = 2;
export const RARE_MIN_LOOT_RARITY: ItemRarity = 'azul';
export const RARE_LOOT_LEVEL_BONUS = 2;
export const RARE_MIN_PLAYER_LEVEL = 3;

const DEFAULT_BASE_CHANCE = 0.04;
const ZONE_BASE_CHANCE: Record<string, number> = {
  main_city: 0.05,
  ancoradouro_vau: 0.06,
  baluarte_amanhecer: 0.08,
};
const PITY_STEP = 0.015;
// Respawns re-roll far more often than mounts happen, so each roll is scaled down.
const RESPAWN_ROLL_FACTOR = 0.2;
const MAX_CHANCE_BELOW_GUARANTEE = 0.85;

export type RareRollTrigger = 'mount' | 'respawn';

// Gender-neutral on purpose: it is prepended to names of either gender.
const NAME_PREFIXES = ['Ancestral', 'Fulgente'] as const;

export function normalizePity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(PITY_GUARANTEE, Math.floor(value)));
}

export function rareEncountersUnlocked(playerLevel: number): boolean {
  return playerLevel >= RARE_MIN_PLAYER_LEVEL;
}

export function rareBaseChance(zoneId: string): number {
  return ZONE_BASE_CHANCE[zoneId] ?? DEFAULT_BASE_CHANCE;
}

export function rareSpawnChance(zoneId: string, pity: number, trigger: RareRollTrigger = 'mount'): number {
  const p = normalizePity(pity);
  if (p >= PITY_GUARANTEE) return 1;
  const raw = Math.min(MAX_CHANCE_BELOW_GUARANTEE, rareBaseChance(zoneId) + p * PITY_STEP);
  return trigger === 'respawn' ? raw * RESPAWN_ROLL_FACTOR : raw;
}

export function rollRareSpawn(zoneId: string, pity: number, trigger: RareRollTrigger = 'mount', rand: () => number = Math.random): boolean {
  return rand() < rareSpawnChance(zoneId, pity, trigger);
}

// Pity resets only when a rare is killed, not merely spawned, so walking past one never wastes it.
export function pityAfterKill(pity: number, killedRare: boolean): number {
  if (killedRare) return 0;
  return Math.min(PITY_GUARANTEE, normalizePity(pity) + 1);
}

export function pityAfterFailedMountRoll(pity: number): number {
  return Math.min(PITY_GUARANTEE, normalizePity(pity) + PITY_PER_FAILED_MOUNT_ROLL);
}

export function rarePrefixFor(enemyId: string): string {
  let sum = 0;
  for (let i = 0; i < enemyId.length; i++) sum += enemyId.charCodeAt(i);
  return NAME_PREFIXES[sum % NAME_PREFIXES.length];
}

export function rareDisplayName(enemyId: string, baseName: string): string {
  return `${rarePrefixFor(enemyId)} ${baseName}`;
}

export function ensureMinRarity(item: EquipmentInstance, min: ItemRarity = RARE_MIN_LOOT_RARITY): EquipmentInstance {
  if (RARITY_ORDER.indexOf(item.rarity) >= RARITY_ORDER.indexOf(min)) return item;
  return { ...item, rarity: min };
}

export function rollRareLoot(enemyLevel: number, characterLevel: number, luck = 0): EquipmentInstance {
  return ensureMinRarity(generateLoot(enemyLevel + RARE_LOOT_LEVEL_BONUS, characterLevel, luck));
}
