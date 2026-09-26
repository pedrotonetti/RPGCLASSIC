import { getDungeonById } from './dungeons';

/**
 * Hidden treasure chests tucked off the beaten path — the map "segredos"
 * (secrets) half of the request that produced this file, alongside the
 * quest-target enemy density audit and the multi-quest tracking work (see
 * this session's report). Each grants a one-time gold + rolled-loot reward
 * the first time it's opened (see OverworldScreen.openChest, which rolls the
 * item via `data/equipment.ts`'s `generateLoot`), then stays depleted —
 * `Player.openedChestIds` persists which ones a save has already looted, the
 * same `string[]`-of-ids idiom `completedQuestIds` already uses.
 *
 * `atTile` is a DESIRED position, not a hand-verified one: several zones
 * here (the open-world main city, village maps) place buildings/trees via
 * seeded RNG, so a chest's exact tile could land on solid geometry depending
 * on how that RNG happens to fall. OverworldScreen.buildChests snaps it to
 * the nearest walkable tile at mount time (via Pathfinding.findNearestWalkable,
 * the same helper click-to-walk already uses to recover from an unwalkable
 * click) rather than this file assuming a tile is safe just because it LOOKS
 * clear of any known fixed obstacle.
 */
export interface ChestDefinition {
  id: string;
  /** Shown on the chest's floating label. */
  name: string;
  /** Which zone this chest's fixed position lives in — see data/zones.ts/data/dungeons.ts. */
  zoneId: string;
  atTile: { x: number; y: number };
  goldReward: number;
  /**
   * Fed into `generateLoot` as the "enemy level" analog, biasing the rolled
   * item's tier/rarity toward what's appropriate this early/late in the
   * story — roughly the recommended level of the content around it (see
   * each entry's own comment).
   */
  lootLevel: number;
}

const rootHollow = getDungeonById('root_hollow');
const rottenSapGallery = getDungeonById('rotten_sap_gallery');

export const CHEST_DEFINITIONS: ChestDefinition[] = [
  // --- Pedravale (main city) — two chests off the plazas/gates/roads -------
  {
    id: 'chest_verdegal_pond',
    name: 'Baú Esquecido do Verdegal',
    zoneId: 'main_city',
    // Well clear of the old-town/downtown plazas and every gate stub — south
    // of the field pond (MapGenerator's pondCx/pondCy=58/15), a stretch of
    // open Verdegal nobody has a reason to walk through on the way anywhere.
    atTile: { x: 62, y: 27 },
    goldReward: 45,
    lootLevel: 6,
  },
  {
    id: 'chest_verdegal_far_field',
    name: 'Baú da Trilha Perdida',
    zoneId: 'main_city',
    // Deep in the south-east field, past every class gate's own stub — only
    // findable by a player actually exploring the Verdegal's far reaches.
    atTile: { x: 190, y: 100 },
    goldReward: 75,
    lootLevel: 11,
  },

  // --- A class starting/secondary village, one each -----------------------
  {
    id: 'chest_pedra_vermelha_corner',
    name: 'Baú da Pedra Vermelha',
    zoneId: 'warrior_start',
    // Tucked in the village's own tree line, off in a corner far from the
    // central clearing/gate road — see MapGenerator.villageClearingBounds.
    atTile: { x: 16, y: 70 },
    goldReward: 30,
    lootLevel: 3,
  },
  {
    id: 'chest_torre_arcanos_alcove',
    name: 'Baú da Torre Esquecida',
    zoneId: 'mage_secondary',
    atTile: { x: 128, y: 18 },
    goldReward: 65,
    lootLevel: 10,
  },

  // --- Two dungeons — a real "hidden alcove off the corridor" secret ------
  {
    id: 'chest_root_hollow_alcove',
    name: 'Baú da Toca das Raízes',
    zoneId: rootHollow.zoneId,
    // Offset well to the side of the second encounter chamber's own fixed
    // combat tile — a genuine detour off the corridor's own spine, not
    // sitting on the path forward.
    atTile: { x: rootHollow.encounters[1].atTile.x + 3, y: rootHollow.encounters[1].atTile.y },
    goldReward: 55,
    lootLevel: 8,
  },
  {
    id: 'chest_rotten_sap_boss_alcove',
    name: 'Baú da Galeria Podre',
    zoneId: rottenSapGallery.zoneId,
    atTile: { x: rottenSapGallery.bossTile.x + 4, y: rottenSapGallery.bossTile.y },
    goldReward: 110,
    lootLevel: 13,
  },
];

export function chestsInZone(zoneId: string): ChestDefinition[] {
  return CHEST_DEFINITIONS.filter((c) => c.zoneId === zoneId);
}

export function getChestById(id: string): ChestDefinition {
  const found = CHEST_DEFINITIONS.find((c) => c.id === id);
  if (!found) throw new Error(`Baú desconhecido: ${id}`);
  return found;
}
