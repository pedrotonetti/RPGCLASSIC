import { describe, it, expect } from 'vitest';
import {
  generateOverworldMap,
  generateVillageMap,
  generateDungeonMap,
  dungeonLayout,
  MAIN_CITY_GATES,
  mainCityArrivalTile,
  MAP_WIDTH,
  MAP_HEIGHT,
  BUILDING_FOOTPRINTS,
} from './MapGenerator';
import { CLASS_ZONE_THEMES } from '../data/classZones';
import { NPC_DEFINITIONS } from '../data/npcs';
import { isWalkable, TileType } from '../config/tiles';

/** Flood-fills from `from` over every walkable tile, for connectivity checks. */
function reachableTiles(tiles: TileType[][], from: { x: number; y: number }): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  const height = tiles.length;
  const width = tiles[0].length;
  while (stack.length > 0) {
    const p = stack.pop()!;
    const key = `${p.x},${p.y}`;
    if (seen.has(key)) continue;
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue;
    if (!isWalkable(tiles[p.y][p.x])) continue;
    seen.add(key);
    stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }
  return seen;
}

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

describe('generateDungeonMap (linear corridor instances)', () => {
  it.each([1, 3, 4, 5])('carves a fully connected path from the exit gate to every encounter and the boss arena (%i encounters)', (encounterCount) => {
    const layout = dungeonLayout(encounterCount);
    const { tiles, playerStart } = generateDungeonMap({ seed: 42, encounterCount });

    expect(tiles.length).toBe(layout.height);
    expect(tiles[0].length).toBe(layout.width);
    expect(playerStart).toEqual(layout.playerStart);

    const reachable = reachableTiles(tiles, layout.playerStart);
    expect(reachable.has(`${layout.exitTile.x},${layout.exitTile.y}`)).toBe(true);
    expect(reachable.has(`${layout.bossTile.x},${layout.bossTile.y}`)).toBe(true);
    for (const enc of layout.encounterTiles) {
      expect(reachable.has(`${enc.x},${enc.y}`), `encounter tile ${enc.x},${enc.y} unreachable`).toBe(true);
    }
  });

  it('is deterministic for a given seed and encounter count', () => {
    const a = generateDungeonMap({ seed: 7, encounterCount: 3 });
    const b = generateDungeonMap({ seed: 7, encounterCount: 3 });
    expect(a.tiles).toEqual(b.tiles);
    expect(a.playerStart).toEqual(b.playerStart);
  });

  it('places encounters strictly between the entrance and the boss arena, entrance-to-boss order', () => {
    const layout = dungeonLayout(4);
    // South (higher y) is the entrance/exit side; the corridor climbs north
    // (decreasing y) toward the boss — see MapGenerator's own doc comment.
    expect(layout.exitTile.y).toBeGreaterThan(layout.playerStart.y);
    let previousY = layout.playerStart.y;
    for (const enc of layout.encounterTiles) {
      expect(enc.y).toBeLessThan(previousY);
      previousY = enc.y;
    }
    expect(layout.bossTile.y).toBeLessThan(previousY);
  });

  it('never spills the boss arena above the map\'s own top border', () => {
    for (const encounterCount of [1, 2, 3, 4, 5, 6]) {
      const layout = dungeonLayout(encounterCount);
      expect(layout.bossTile.y).toBeGreaterThanOrEqual(1);
      expect(layout.bossTile.y).toBeLessThan(layout.height - 1);
    }
  });
});
