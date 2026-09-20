import { describe, it, expect } from 'vitest';
import { generateOverworldMap, generateVillageMap, MAIN_CITY_GATES, mainCityArrivalTile, MAP_WIDTH, MAP_HEIGHT, BUILDING_FOOTPRINTS } from './MapGenerator';
import { CLASS_ZONE_THEMES } from '../data/classZones';
import { NPC_DEFINITIONS } from '../data/npcs';
import { isWalkable, TileType } from '../config/tiles';

function tileAt(tiles: TileType[][], x: number, y: number): TileType {
  return tiles[y][x];
}

function footprintCells(buildings: Array<{ x: number; y: number; w: number; h: number }>): Set<string> {
  const cells = new Set<string>();
  for (const b of buildings) {
    for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) cells.add(`${b.x + dx},${b.y + dy}`);
  }
  return cells;
}

describe('MapGenerator (procedural buildings)', () => {
  it('main city has the expected dimensions and every NPC/gate/arrival tile stays walkable and clear of buildings', () => {
    const { tiles, buildings } = generateOverworldMap();
    expect(tiles.length).toBe(MAP_HEIGHT);
    expect(tiles[0].length).toBe(MAP_WIDTH);
    expect(buildings.length).toBeGreaterThan(15);

    const occupied = footprintCells(buildings);
    for (const npc of NPC_DEFINITIONS.filter((n) => n.zoneId === 'main_city')) {
      expect(isWalkable(tileAt(tiles, npc.mapX, npc.mapY)), `NPC ${npc.id} tile`).toBe(true);
      expect(occupied.has(`${npc.mapX},${npc.mapY}`), `NPC ${npc.id} stranded inside a building`).toBe(false);
    }

    for (const gate of MAIN_CITY_GATES) {
      expect(isWalkable(tileAt(tiles, gate.x, gate.y)), `gate ${gate.classId}`).toBe(true);
      expect(occupied.has(`${gate.x},${gate.y}`)).toBe(false);
      const arrive = mainCityArrivalTile(gate.classId);
      expect(isWalkable(tileAt(tiles, arrive.x, arrive.y)), `arrival ${gate.classId}`).toBe(true);
      expect(occupied.has(`${arrive.x},${arrive.y}`), `arrival ${gate.classId} inside a building`).toBe(false);
    }
  });

  it('no building overlaps another or spills past the map border, in the main city or any village', () => {
    const cities = [generateOverworldMap()];
    for (const theme of CLASS_ZONE_THEMES) {
      cities.push(generateVillageMap({ width: 36, height: 28, seed: theme.classId.length, hasNorthGate: false, hasSouthGate: true, treeCount: 65, development: 'sparse' }));
      cities.push(generateVillageMap({ width: 48, height: 36, seed: theme.classId.length + 1, hasNorthGate: true, hasSouthGate: true, treeCount: 95, development: 'developed' }));
    }
    for (const map of cities) {
      const width = map.tiles[0].length;
      const height = map.tiles.length;
      const seen = new Set<string>();
      for (const b of map.buildings) {
        expect(b.x).toBeGreaterThanOrEqual(1);
        expect(b.y).toBeGreaterThanOrEqual(1);
        expect(b.x + b.w).toBeLessThanOrEqual(width - 1);
        expect(b.y + b.h).toBeLessThanOrEqual(height - 1);
        for (let dy = 0; dy < b.h; dy++) {
          for (let dx = 0; dx < b.w; dx++) {
            const key = `${b.x + dx},${b.y + dy}`;
            expect(seen.has(key), `overlap at ${key}`).toBe(false);
            seen.add(key);
          }
        }
      }
      // playerStart must stay reachable — never inside the buildings just placed.
      expect(isWalkable(tileAt(map.tiles, map.playerStart.x, map.playerStart.y))).toBe(true);
      expect(seen.has(`${map.playerStart.x},${map.playerStart.y}`)).toBe(false);
    }
  });

  it('every secondary village gets a handful of huts and a landmark tower; every starting village stays sparser', () => {
    CLASS_ZONE_THEMES.forEach((theme, i) => {
      const start = generateVillageMap({ width: 36, height: 28, seed: 4000 + i, hasNorthGate: false, hasSouthGate: true, treeCount: 65, development: 'sparse' });
      const secondary = generateVillageMap({ width: 48, height: 36, seed: 5000 + i, hasNorthGate: true, hasSouthGate: true, treeCount: 95, development: 'developed' });
      expect(start.buildings.length, `${theme.classId} start village`).toBeGreaterThan(3);
      expect(secondary.buildings.length, `${theme.classId} secondary village`).toBeGreaterThan(start.buildings.length);
      expect(secondary.buildings.some((b) => b.kind === 'tower'), `${theme.classId} secondary missing its landmark tower`).toBe(true);
    });
  });

  it('every building kind has a positive tile footprint', () => {
    for (const k of Object.keys(BUILDING_FOOTPRINTS) as Array<keyof typeof BUILDING_FOOTPRINTS>) {
      expect(BUILDING_FOOTPRINTS[k].w).toBeGreaterThanOrEqual(1);
      expect(BUILDING_FOOTPRINTS[k].h).toBeGreaterThanOrEqual(1);
    }
  });
});
