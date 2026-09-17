import { TILE_SIZE } from '../config/gameConfig';
import { CLASS_ZONE_THEMES, getClassZoneTheme } from './classZones';
import { generateOverworldMap, generateVillageMap, mainCityArrivalTile, MAIN_CITY_GATES, type GeneratedMap } from '../systems/MapGenerator';

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
}

const MAIN_CITY_ACCENT = 0x4c8a3f; // the field's usual grass green — no special tint for the shared hub

function buildClassVillageZones(): Record<string, ZoneDefinition> {
  const zones: Record<string, ZoneDefinition> = {};

  CLASS_ZONE_THEMES.forEach((theme, i) => {
    const startSeed = 4000 + i;
    const secondarySeed = 5000 + i;
    const startSize = { width: 18, height: 14 };
    const secondarySize = { width: 24, height: 18 };

    const startArrive = { x: Math.floor(startSize.width / 2), y: startSize.height - 3 };
    const secondaryArriveFromStart = { x: Math.floor(secondarySize.width / 2), y: 2 };
    const cityArrive = mainCityArrivalTile(theme.classId);

    zones[theme.startVillageId] = {
      id: theme.startVillageId,
      name: theme.startVillageName,
      accentColor: theme.accentColor,
      monsterIds: theme.startMonsters,
      monsterCount: 6,
      generate: () => generateVillageMap({ ...startSize, seed: startSeed, hasNorthGate: false, hasSouthGate: true, treeCount: 18 }),
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
      monsterCount: 8,
      generate: () =>
        generateVillageMap({ ...secondarySize, seed: secondarySeed, hasNorthGate: true, hasSouthGate: true, treeCount: 26 }),
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
    const secondarySize = { width: 24, height: 18 };
    return {
      atTile: { x: gate.x, y: gate.y },
      toZone: theme.secondaryVillageId,
      arriveTile: { x: Math.floor(secondarySize.width / 2), y: secondarySize.height - 3 },
    };
  });
}

const CLASS_VILLAGE_ZONES = buildClassVillageZones();

export const ZONE_DEFINITIONS: Record<string, ZoneDefinition> = {
  [MAIN_CITY_ID]: {
    id: MAIN_CITY_ID,
    name: 'Pedravale',
    accentColor: MAIN_CITY_ACCENT,
    generate: () => generateOverworldMap(),
    exits: mainCityExits(),
    monsterCount: 12,
  },
  ...CLASS_VILLAGE_ZONES,
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
