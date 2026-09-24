import { isWalkable, TileType } from '../config/tiles';

/** A tile-space coordinate — never world units (see zones' own tileCenterWorld for that conversion). */
export interface GridPoint {
  x: number;
  y: number;
}

/**
 * A flattened (row-major, `y * width + x`) walkability mask used only by
 * this module — built once per click-to-walk request (see
 * `buildWalkabilityGrid`), never per frame. Kept as a typed array (not the
 * `TileType[][]` the rest of the game uses) so a worst-case 240x150 search
 * stays cheap: no per-tile function calls, no nested array indirection.
 */
export interface WalkabilityGrid {
  width: number;
  height: number;
  /** 1 = walkable, 0 = blocked. */
  cells: Uint8Array;
}

/** Axis-aligned tile-space footprint to carve out as blocked — matches `BuildingCollider`'s own footprint, just in tile units instead of world units (see OverworldScreen's own conversion when it calls this). */
export interface BlockedFootprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Combines plain tile walkability (config/tiles.ts — trees/water block,
 * grass/paths don't) with building footprints, which is NOT the same thing:
 * a building's own tiles are stamped `Path` at the grid level (see
 * MapGenerator's `stampFootprint`, so nothing scattered afterwards mistakes
 * the lot for open grass) but are still solid — their real blocking is a
 * separate `BuildingCollider` AABB that `OverworldScreen.canOccupy` checks
 * against, not the tile grid. Skipping that second source here would let a
 * path cut straight through a house. Flying-mount water-crossing is
 * deliberately NOT modeled — click-to-walk is a foot-movement convenience,
 * consistent with the "auto-walk" mode only ever driving normal ground
 * movement in OverworldScreen.
 */
export function buildWalkabilityGrid(tiles: TileType[][], buildingFootprints: BlockedFootprint[] = []): WalkabilityGrid {
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  const cells = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = tiles[y];
    for (let x = 0; x < width; x++) {
      cells[y * width + x] = isWalkable(row[x]) ? 1 : 0;
    }
  }
  for (const b of buildingFootprints) {
    const x0 = Math.max(0, b.x);
    const y0 = Math.max(0, b.y);
    const x1 = Math.min(width, b.x + b.w);
    const y1 = Math.min(height, b.y + b.h);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) cells[y * width + x] = 0;
    }
  }
  return { width, height, cells };
}

function inBounds(grid: WalkabilityGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

export function isWalkableAt(grid: WalkabilityGrid, p: GridPoint): boolean {
  return inBounds(grid, p.x, p.y) && grid.cells[p.y * grid.width + p.x] === 1;
}

/**
 * Spiral outward from `from` (ring by ring, radius 1..maxRadius) for the
 * nearest walkable tile — used to "snap" a click that landed on solid
 * geometry (a tree, a building, the map border) onto the nearest place the
 * player could actually stand, instead of refusing to path at all just
 * because the exact pixel clicked was one tile off a walkable one. Returns
 * null (never throws) if nothing walkable turns up within range, which the
 * caller treats as "unreachable".
 */
export function findNearestWalkable(grid: WalkabilityGrid, from: GridPoint, maxRadius = 3): GridPoint | null {
  if (isWalkableAt(grid, from)) return from;
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        // Ring only — interior points were already checked at a smaller r.
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const p = { x: from.x + dx, y: from.y + dy };
        if (isWalkableAt(grid, p)) return p;
      }
    }
  }
  return null;
}

const SQRT2 = Math.SQRT2;
/** Octile distance — the admissible heuristic for 8-directional movement (straight steps cost 1, diagonal steps cost sqrt(2)). */
function heuristic(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
}

/**
 * Binary min-heap over node indices, keyed by a shared external f-score
 * array. Doesn't support decrease-key directly — callers just push the same
 * index again when its score improves (the standard "lazy deletion" A*
 * trick) and `closed` skips any stale copy popped later. Simple, and fast
 * enough for a single click-triggered search over up to 36,000 nodes (see
 * Pathfinding.test.ts's own timing check).
 */
class MinHeap {
  private heap: number[] = [];
  constructor(private f: Float64Array) {}

  get size(): number {
    return this.heap.length;
  }

  push(i: number): void {
    const h = this.heap;
    h.push(i);
    let c = h.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (this.f[h[p]] <= this.f[h[c]]) break;
      [h[p], h[c]] = [h[c], h[p]];
      c = p;
    }
  }

  pop(): number {
    const h = this.heap;
    const top = h[0];
    const last = h.pop() as number;
    if (h.length > 0) {
      h[0] = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = p * 2 + 2;
        let smallest = p;
        if (l < h.length && this.f[h[l]] < this.f[h[smallest]]) smallest = l;
        if (r < h.length && this.f[h[r]] < this.f[h[smallest]]) smallest = r;
        if (smallest === p) break;
        [h[p], h[smallest]] = [h[smallest], h[p]];
        p = smallest;
      }
    }
    return top;
  }
}

/** The 8 grid neighbors, straight steps before diagonals (irrelevant to correctness, just a stable iteration order). */
const NEIGHBORS: Array<{ dx: number; dy: number; cost: number }> = [
  { dx: 1, dy: 0, cost: 1 },
  { dx: -1, dy: 0, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: 0, dy: -1, cost: 1 },
  { dx: 1, dy: 1, cost: SQRT2 },
  { dx: 1, dy: -1, cost: SQRT2 },
  { dx: -1, dy: 1, cost: SQRT2 },
  { dx: -1, dy: -1, cost: SQRT2 },
];

function reconstructPath(cameFrom: Int32Array, current: number, width: number): GridPoint[] {
  const path: GridPoint[] = [];
  let idx: number = current;
  while (idx !== -1) {
    path.push({ x: idx % width, y: (idx / width) | 0 });
    idx = cameFrom[idx];
  }
  path.reverse();
  return path;
}

/**
 * Grid-based A* over 8-directional movement. Returns an ordered list of
 * tile-space waypoints from `start` to `goal` inclusive, or null if `start`/
 * `goal` are out of bounds, either sits on a blocked tile, or no walkable
 * path connects them (a disconnected "island" of the grid). Diagonal moves
 * are rejected when they'd cut a corner between two blocked orthogonal
 * neighbors, so the returned path never clips through a tree/building even
 * between two waypoints.
 *
 * Single click-triggered call, not a per-frame one (see the module doc on
 * `buildWalkabilityGrid`) — typed arrays + a binary heap keep even a
 * worst-case full-grid search (240x150 = 36,000 tiles, no path found) well
 * under what a single UI click can tolerate; see Pathfinding.test.ts for the
 * actual measured bound.
 */
export function findPath(grid: WalkabilityGrid, start: GridPoint, goal: GridPoint): GridPoint[] | null {
  const { width, height, cells } = grid;
  if (!inBounds(grid, start.x, start.y) || !inBounds(grid, goal.x, goal.y)) return null;
  const startIdx = start.y * width + start.x;
  const goalIdx = goal.y * width + goal.x;
  if (cells[startIdx] === 0 || cells[goalIdx] === 0) return null;
  if (startIdx === goalIdx) return [{ x: start.x, y: start.y }];

  const size = width * height;
  const gScore = new Float64Array(size).fill(Infinity);
  const fScore = new Float64Array(size).fill(Infinity);
  const cameFrom = new Int32Array(size).fill(-1);
  const closed = new Uint8Array(size);

  gScore[startIdx] = 0;
  fScore[startIdx] = heuristic(start.x, start.y, goal.x, goal.y);

  const heap = new MinHeap(fScore);
  heap.push(startIdx);

  while (heap.size > 0) {
    const current = heap.pop();
    if (closed[current]) continue; // stale duplicate from an earlier, worse push
    closed[current] = 1;
    if (current === goalIdx) return reconstructPath(cameFrom, current, width);

    const cx = current % width;
    const cy = (current / width) | 0;

    for (const n of NEIGHBORS) {
      const nx = cx + n.dx;
      const ny = cy + n.dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (cells[nIdx] === 0 || closed[nIdx]) continue;
      if (n.dx !== 0 && n.dy !== 0) {
        // Corner-cut guard: a diagonal step is only legal if BOTH tiles it
        // squeezes between are themselves walkable — otherwise the path
        // would visually clip through whichever one is solid.
        if (cells[cy * width + nx] === 0 || cells[ny * width + cx] === 0) continue;
      }
      const tentative = gScore[current] + n.cost;
      if (tentative < gScore[nIdx]) {
        cameFrom[nIdx] = current;
        gScore[nIdx] = tentative;
        fScore[nIdx] = tentative + heuristic(nx, ny, goal.x, goal.y);
        heap.push(nIdx);
      }
    }
  }
  return null;
}

/**
 * Collapses runs of collinear steps down to just their turning points (and
 * the start/end) — a raw grid path visits every single intervening tile,
 * but since the game's actual movement is continuous (not grid-snapped, see
 * OverworldScreen.updateMovement), walking a long straight stretch only
 * needs the two ends of it. This never changes the route itself (every
 * dropped point sat exactly on the straight line between its neighbors), so
 * it can't reintroduce clipping — it just means fewer waypoints for the
 * auto-walk follower to chase through.
 */
export function compressPath(path: GridPoint[]): GridPoint[] {
  if (path.length <= 2) return path;
  const out: GridPoint[] = [path[0]];
  let prevDx = Math.sign(path[1].x - path[0].x);
  let prevDy = Math.sign(path[1].y - path[0].y);
  for (let i = 1; i < path.length - 1; i++) {
    const dx = Math.sign(path[i + 1].x - path[i].x);
    const dy = Math.sign(path[i + 1].y - path[i].y);
    if (dx !== prevDx || dy !== prevDy) {
      out.push(path[i]);
      prevDx = dx;
      prevDy = dy;
    }
  }
  out.push(path[path.length - 1]);
  return out;
}

/**
 * The one entry point OverworldScreen's click-to-walk actually calls: snaps
 * an unwalkable goal (clicked inside solid geometry) onto the nearest
 * walkable tile within `snapRadius`, pathfinds to it, and compresses the
 * result. Returns null — a quiet "no route" — when the goal can't be
 * snapped to anything walkable nearby, or when the snapped goal simply isn't
 * connected to `start` (a disconnected island of the grid); either way the
 * caller is expected to no-op or show a brief hint, never crash.
 */
export function pathfindToClick(grid: WalkabilityGrid, start: GridPoint, clickedGoal: GridPoint, snapRadius = 3): GridPoint[] | null {
  const goal = findNearestWalkable(grid, clickedGoal, snapRadius);
  if (!goal) return null;
  const raw = findPath(grid, start, goal);
  if (!raw) return null;
  return compressPath(raw);
}
