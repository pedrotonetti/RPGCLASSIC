import { describe, expect, it } from 'vitest';
import { TileType } from '../config/tiles';
import { DEFAULT_PACK_WEIGHTS, getZoneById, MAIN_CITY_ID, monsterFreeAreas } from '../data/zones';
import { pickSpawnPoints, rollPackSize } from './monsterSpawning';

function grassGrid(width: number, height: number): TileType[][] {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => TileType.Grass));
}

describe('rollPackSize', () => {
  it('maps the roll onto the cumulative weights (index 0 = solo)', () => {
    const weights = [0.5, 0.3, 0.2];
    expect(rollPackSize(weights, () => 0)).toBe(1);
    expect(rollPackSize(weights, () => 0.49)).toBe(1);
    expect(rollPackSize(weights, () => 0.5)).toBe(2);
    expect(rollPackSize(weights, () => 0.79)).toBe(2);
    expect(rollPackSize(weights, () => 0.8)).toBe(3);
    expect(rollPackSize(weights, () => 0.9999)).toBe(3);
  });

  it('never exceeds the number of weights given (a starting village never rolls a trio)', () => {
    for (let i = 0; i < 200; i++) {
      expect(rollPackSize([0.6, 0.4])).toBeLessThanOrEqual(2);
    }
  });

  it('falls back to a solo for empty/zero weights instead of looping or returning 0', () => {
    expect(rollPackSize([])).toBe(1);
    expect(rollPackSize([0, 0])).toBe(1);
  });

  it('averages more than one monster per spawn point by default — bands, not singles', () => {
    const avg = DEFAULT_PACK_WEIGHTS.reduce((sum, w, i) => sum + w * (i + 1), 0) / DEFAULT_PACK_WEIGHTS.reduce((a, b) => a + b, 0);
    expect(avg).toBeGreaterThan(1.5);
  });
});

describe('pickSpawnPoints', () => {
  it('never picks a tile inside an avoid rect', () => {
    const tiles = grassGrid(40, 40);
    const avoid = [{ x0: 0, y0: 0, x1: 25, y1: 25 }];
    const points = pickSpawnPoints(tiles, { x: 39, y: 39 }, 30, 0, 2, avoid);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.x >= 0 && p.x <= 25 && p.y >= 0 && p.y <= 25).toBe(false);
    }
  });

  it('only ever picks grass, clear of the start, and respects spacing', () => {
    const tiles = grassGrid(30, 30);
    for (let x = 0; x < 30; x++) tiles[10][x] = TileType.Tree;
    const points = pickSpawnPoints(tiles, { x: 15, y: 15 }, 20, 5, 3);
    for (const p of points) {
      expect(tiles[p.y][p.x]).toBe(TileType.Grass);
      expect(Math.hypot(p.x - 15, p.y - 15)).toBeGreaterThanOrEqual(5);
    }
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        expect(Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('monsterFreeAreas', () => {
  it("keeps Pedravale's town districts (and the zone's own spawn) out of the monster scatter", () => {
    const [town] = monsterFreeAreas(MAIN_CITY_ID);
    expect(town).toBeDefined();
    const map = getZoneById(MAIN_CITY_ID).generate();
    const start = map.playerStart;
    expect(start.x >= town.x0 && start.x <= town.x1 && start.y >= town.y0 && start.y <= town.y1).toBe(true);
  });

  it('does not restrict any other zone', () => {
    expect(monsterFreeAreas('baluarte_amanhecer')).toEqual([]);
  });
});
