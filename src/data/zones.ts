import { TILE_SIZE } from '../config/gameConfig';
import { CLASS_ZONE_THEMES, getClassZoneTheme } from './classZones';
import { DUNGEON_DEFINITIONS } from './dungeons';
import { generateDungeonMap, generateOverworldMap, generateVillageMap, mainCityArrivalTile, MAIN_CITY_GATES, type GeneratedMap } from '../systems/MapGenerator';

export const MAIN_CITY_ID = 'main_city';

export interface ZoneExit {
  /** Tile the player must stand on to trigger the transition. */
  atTile: { x: number; y: number };
  toZone: string;
  /** World-space tile to arrive at in the destination zone. */
  arriveTile: { x: number; y: number };
}

export interface ZoneDefinition {
  id: string;
  name: string;
  generate: () => GeneratedMap;
  exits: ZoneExit[];
  /** Ground tint for this zone — lets each class's territory (and the main city) read as visually distinct. */
  accentColor: number;
  /** Enemy ids this zone's monsters are drawn from. Omit to use the level-weighted main city pool. */
  monsterIds?: string[];
  monsterCount: number;
  /**
   * Set for a dungeon instance's own linear-corridor zone (see
   * `data/dungeons.ts`) — when present, `OverworldScreen` spawns this
   * dungeon's fixed encounter pods and boss (via
   * `OverworldCombat.spawnDungeonEncounters`) instead of the usual random
   * `spawnMonsters` scatter, and shows the encounter-progress/boss-banner HUD.
   */
  dungeonId?: string;
}

const MAIN_CITY_ACCENT = 0x4c8a3f; // the field's usual grass green — no special tint for the shared hub

// Roughly doubled from the original 18x14 / 24x18 so every class's territory
// gets a real village/town footprint instead of a cramped walled pen — see
// MapGenerator.ts's own doubled MAP_WIDTH/MAP_HEIGHT for the main city.
// Hoisted here (instead of each being a literal re-typed in both
// buildClassVillageZones and mainCityExits, as they used to be) so the two
// can never drift out of sync with each other again.
// Was 36x28/48x36 — widened ~3x per axis (~9x area), matching the main
// city's own resize in MapGenerator.ts. Every exit/arrival tile below is
// computed from these constants (Math.floor(width/2), height-3, etc.), not
// hardcoded, so they stay correct automatically; only the elder/mentor NPC
// positions (data/npcs.ts) needed an explicit fix, via the new
// villageClearingBounds export, since those WERE hardcoded absolute tiles.
export const START_VILLAGE_SIZE = { width: 110, height: 85 };
export const SECONDARY_VILLAGE_SIZE = { width: 145, height: 110 };

function buildClassVillageZones(): Record<string, ZoneDefinition> {
  const zones: Record<string, ZoneDefinition> = {};

  CLASS_ZONE_THEMES.forEach((theme, i) => {
    const startSeed = 4000 + i;
    const secondarySeed = 5000 + i;
    const startSize = START_VILLAGE_SIZE;
    const secondarySize = SECONDARY_VILLAGE_SIZE;

    const startArrive = { x: Math.floor(startSize.width / 2), y: startSize.height - 3 };
    const secondaryArriveFromStart = { x: Math.floor(secondarySize.width / 2), y: 2 };
    const cityArrive = mainCityArrivalTile(theme.classId);

    zones[theme.startVillageId] = {
      id: theme.startVillageId,
      name: theme.startVillageName,
      accentColor: theme.accentColor,
      monsterIds: theme.startMonsters,
      monsterCount: 30,
      generate: () =>
        generateVillageMap({ ...startSize, seed: startSeed, hasNorthGate: false, hasSouthGate: true, treeCount: 480, development: 'sparse' }),
      exits: [
        {
          atTile: { x: Math.floor(startSize.width / 2), y: startSize.height - 1 },
          toZone: theme.secondaryVillageId,
          arriveTile: secondaryArriveFromStart,
        },
      ],
    };

    zones[theme.secondaryVillageId] = {
      id: theme.secondaryVillageId,
      name: theme.secondaryVillageName,
      accentColor: theme.accentColor,
      monsterIds: theme.secondaryMonsters,
      monsterCount: 45,
      generate: () =>
        generateVillageMap({ ...secondarySize, seed: secondarySeed, hasNorthGate: true, hasSouthGate: true, treeCount: 700, development: 'developed' }),
      exits: [
        { atTile: { x: Math.floor(secondarySize.width / 2), y: 0 }, toZone: theme.startVillageId, arriveTile: startArrive },
        { atTile: { x: Math.floor(secondarySize.width / 2), y: secondarySize.height - 1 }, toZone: MAIN_CITY_ID, arriveTile: cityArrive },
      ],
    };
  });

  return zones;
}

function mainCityExits(): ZoneExit[] {
  return MAIN_CITY_GATES.map((gate) => {
    const theme = getClassZoneTheme(gate.classId);
    const secondarySize = SECONDARY_VILLAGE_SIZE;
    return {
      atTile: { x: gate.x, y: gate.y },
      toZone: theme.secondaryVillageId,
      arriveTile: { x: Math.floor(secondarySize.width / 2), y: secondarySize.height - 3 },
    };
  });
}

const CLASS_VILLAGE_ZONES = buildClassVillageZones();

/** A sickly, corrupted-root tint distinct from every village's own accent and from the main city's plain grass green — every dungeon shares it so an instance always reads as "not open-world" the instant it loads. */
const DUNGEON_ACCENT = 0x5a4a6e;

function buildDungeonZones(): Record<string, ZoneDefinition> {
  const zones: Record<string, ZoneDefinition> = {};
  for (const dungeon of DUNGEON_DEFINITIONS) {
    zones[dungeon.zoneId] = {
      id: dungeon.zoneId,
      name: dungeon.name,
      accentColor: DUNGEON_ACCENT,
      generate: () => generateDungeonMap({ seed: dungeon.seed, encounterCount: dungeon.encounters.length }),
      exits: [{ atTile: dungeon.exitTile, toZone: dungeon.portal.hostZoneId, arriveTile: dungeon.portal.arriveTile }],
      // Monsters here are placed at fixed points, not scattered by
      // spawnMonsters — see OverworldScreen.mount's dungeonId branch.
      monsterCount: 0,
      dungeonId: dungeon.id,
    };
  }
  return zones;
}

const DUNGEON_ZONES = buildDungeonZones();

export const ZONE_DEFINITIONS: Record<string, ZoneDefinition> = {
  [MAIN_CITY_ID]: {
    id: MAIN_CITY_ID,
    name: 'Pedravale',
    accentColor: MAIN_CITY_ACCENT,
    generate: () => generateOverworldMap(),
    exits: mainCityExits(),
    monsterCount: 65,
  },
  ...CLASS_VILLAGE_ZONES,
  ...DUNGEON_ZONES,
};

export function getZoneById(id: string): ZoneDefinition {
  const found = ZONE_DEFINITIONS[id];
  if (!found) throw new Error(`Zona desconhecida: ${id}`);
  return found;
}

export function startZoneForClass(classId: string): string {
  return getClassZoneTheme(classId).startVillageId;
}

/** World-space (not tile) position for a zone's arrival tile — the center of that tile. */
export function arriveWorldPosition(arriveTile: { x: number; y: number }): { x: number; z: number } {
  return { x: arriveTile.x * TILE_SIZE + TILE_SIZE / 2, z: arriveTile.y * TILE_SIZE + TILE_SIZE / 2 };
}
