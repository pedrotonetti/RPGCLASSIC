import { describe, it, expect } from 'vitest';
import { TileType } from '../config/tiles';
import { buildWalkabilityGrid, compressPath, findNearestWalkable, findPath, pathfindToClick } from './Pathfinding';

function gridFromRows(rows: string[]): TileType[][] {
  // '.' = Grass (walkable), '#' = Tree (blocked), '~' = Water (blocked on foot)
  return rows.map((row) =>
    row.split('').map((ch) => {
      if (ch === '#') return TileType.Tree;
      if (ch === '~') return TileType.Water;
      return TileType.Grass;
    }),
  );
}

describe('Pathfinding', () => {
  it('finds a straight line when nothing is in the way', () => {
    const tiles = gridFromRows(['.....', '.....', '.....', '.....', '.....']);
    const grid = buildWalkabilityGrid(tiles);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 0 });
    expect(path).not.toBeNull();
    expect(path![0]).toEqual({ x: 0, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 4, y: 0 });
  });

  it('routes around a single blocking Tree tile instead of through it', () => {
    const tiles = gridFromRows(['.....', '.....', '..#..', '.....', '.....']);
    const grid = buildWalkabilityGrid(tiles);
    const path = findPath(grid, { x: 2, y: 0 }, { x: 2, y: 4 });
    expect(path).not.toBeNull();
    // The path must never step on the blocked tile.
    expect(path!.some((p) => p.x === 2 && p.y === 2)).toBe(false);
    expect(path![0]).toEqual({ x: 2, y: 0 });
    expect(path![path!.length - 1]).toEqual({ x: 2, y: 4 });
  });

  it('never cuts diagonally through the corner of two blocked tiles', () => {
    // A wall with a single-tile diagonal "gap" between (1,1) and (2,2) — the
    // straight orthogonal tiles on both sides of that gap are blocked, so a
    // diagonal step between them would visually clip a corner.
    const tiles = gridFromRows(['....', '.##.', '.##.', '....']);
    const grid = buildWalkabilityGrid(tiles);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 3, y: 3 });
    expect(path).not.toBeNull();
    for (let i = 0; i < path!.length - 1; i++) {
      const a = path![i];
      const b = path![i + 1];
      const dx = Math.abs(a.x - b.x);
      const dy = Math.abs(a.y - b.y);
      if (dx === 1 && dy === 1) {
        // Both orthogonal neighbors of a diagonal step must be walkable.
        const cells = grid.cells;
        const w = grid.width;
        expect(cells[a.y * w + b.x] === 1 && cells[b.y * w + a.x] === 1).toBe(true);
      }
    }
  });

  it('returns null for a goal on a disconnected island of the grid', () => {
    // A fully walled-off 1x1 room in the middle — unreachable from outside.
    const tiles = gridFromRows(['.....', '.###.', '.#.#.', '.###.', '.....']);
    const grid = buildWalkabilityGrid(tiles);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toBeNull();
  });

  it('returns null when start or goal is out of bounds, or sits on a blocked tile — no crash', () => {
    const tiles = gridFromRows(['...', '.#.', '...']);
    const grid = buildWalkabilityGrid(tiles);
    expect(findPath(grid, { x: -1, y: 0 }, { x: 1, y: 1 })).toBeNull();
    expect(findPath(grid, { x: 0, y: 0 }, { x: 99, y: 99 })).toBeNull();
    expect(findPath(grid, { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull(); // (1,1) is the Tree
  });

  it('treats water as blocked (foot movement only, no flying-mount crossing)', () => {
    const tiles = gridFromRows(['.....', '~~~~~', '.....']);
    const grid = buildWalkabilityGrid(tiles);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 0, y: 2 });
    expect(path).toBeNull();
  });

  it('carves building footprints out as blocked even though their tiles are nominally Path/Grass', () => {
    const tiles = gridFromRows(['.....', '.....', '.....', '.....', '.....']);
    const grid = buildWalkabilityGrid(tiles, [{ x: 1, y: 1, w: 3, h: 3 }]);
    const path = findPath(grid, { x: 0, y: 0 }, { x: 4, y: 4 });
    expect(path).not.toBeNull();
    for (const p of path!) {
      const insideBuilding = p.x >= 1 && p.x <= 3 && p.y >= 1 && p.y <= 3;
      expect(insideBuilding).toBe(false);
    }
  });

  it('compressPath keeps the route but drops redundant collinear waypoints', () => {
    const raw = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
    ];
    const compressed = compressPath(raw);
    expect(compressed).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
    ]);
  });

  it('findNearestWalkable snaps a click landed on solid geometry to the nearest open tile', () => {
    const tiles = gridFromRows(['.....', '.....', '..#..', '.....', '.....']);
    const grid = buildWalkabilityGrid(tiles);
    const snapped = findNearestWalkable(grid, { x: 2, y: 2 }, 3);
    expect(snapped).not.toBeNull();
    expect(snapped!.x === 2 && snapped!.y === 2).toBe(false);
  });

  it('findNearestWalkable gives up (null) beyond its search radius', () => {
    // A blocked tile surrounded by more blocked tiles well past radius 1.
    const tiles = gridFromRows(['#####', '#####', '#####', '#####', '#####']);
    const grid = buildWalkabilityGrid(tiles);
    expect(findNearestWalkable(grid, { x: 2, y: 2 }, 1)).toBeNull();
  });

  it('pathfindToClick fails gracefully (null, no throw) for a click deep inside solid geometry', () => {
    const tiles = gridFromRows(['#####', '#####', '#####', '#####', '#####']);
    tiles[0][0] = TileType.Grass;
    const grid = buildWalkabilityGrid(tiles);
    expect(() => pathfindToClick(grid, { x: 0, y: 0 }, { x: 4, y: 4 }, 2)).not.toThrow();
    expect(pathfindToClick(grid, { x: 0, y: 0 }, { x: 4, y: 4 }, 2)).toBeNull();
  });

  it('pathfindToClick snaps a near-miss click onto the nearest walkable tile and still routes there', () => {
    const tiles = gridFromRows(['.....', '.....', '..#..', '.....', '.....']);
    const grid = buildWalkabilityGrid(tiles);
    const path = pathfindToClick(grid, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).not.toBeNull();
    expect(path!.some((p) => p.x === 2 && p.y === 2)).toBe(false);
  });

  describe('performance (single click-triggered call, not per-frame)', () => {
    it('runs a worst-case full-grid search on the biggest zone size (240x150, no obstacles) well within a UI-click budget', () => {
      const width = 240;
      const height = 150;
      const tiles: TileType[][] = [];
      for (let y = 0; y < height; y++) tiles.push(new Array(width).fill(TileType.Grass));
      const grid = buildWalkabilityGrid(tiles);

      const start = performance.now();
      const path = findPath(grid, { x: 0, y: 0 }, { x: width - 1, y: height - 1 });
      const elapsedMs = performance.now() - start;

      expect(path).not.toBeNull();
      // Generous budget for a single click-triggered call (this is not run
      // per frame) — comfortably clears CI-machine variance while still
      // catching an accidental quadratic regression.
      expect(elapsedMs).toBeLessThan(300);
    });

    it('runs a worst-case UNREACHABLE search (must exhaust the whole reachable component) within budget', () => {
      const width = 240;
      const height = 150;
      const tiles: TileType[][] = [];
      for (let y = 0; y < height; y++) tiles.push(new Array(width).fill(TileType.Grass));
      // Wall off the goal completely so A* has to exhaust every reachable
      // tile before concluding there's no path — the actual worst case for
      // search time (a found path can stop early; "no path" cannot).
      for (let x = 0; x < width; x++) {
        tiles[height - 1][x] = TileType.Tree;
        tiles[height - 2][x] = TileType.Tree;
      }
      const grid = buildWalkabilityGrid(tiles);

      const start = performance.now();
      const path = findPath(grid, { x: 0, y: 0 }, { x: width - 1, y: height - 1 });
      const elapsedMs = performance.now() - start;

      expect(path).toBeNull();
      expect(elapsedMs).toBeLessThan(300);
    });
  });
});
