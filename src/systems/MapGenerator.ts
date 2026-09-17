import { TileType } from '../config/tiles';

export const MAP_WIDTH = 40;
export const MAP_HEIGHT = 24;

export interface GeneratedMap {
  tiles: TileType[][];
  playerStart: { x: number; y: number };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * One border opening per class, carved into the main city's map, each
 * leading out toward that class's own secondary village. Kept well clear of
 * the village clearing (top-left) and the pond (map center) so the walk-in
 * stub never needs to fight existing terrain.
 */
export const MAIN_CITY_GATES: Array<{ classId: string; x: number; y: number; side: 'east' | 'south' }> = [
  { classId: 'warrior', x: MAP_WIDTH - 1, y: 3, side: 'east' },
  { classId: 'mage', x: MAP_WIDTH - 1, y: 6, side: 'east' },
  { classId: 'archer', x: MAP_WIDTH - 1, y: 10, side: 'east' },
  { classId: 'cleric', x: MAP_WIDTH - 1, y: 14, side: 'east' },
  { classId: 'paladin', x: MAP_WIDTH - 1, y: 18, side: 'east' },
  { classId: 'assassin', x: MAP_WIDTH - 1, y: 21, side: 'east' },
  { classId: 'necromancer', x: 14, y: MAP_HEIGHT - 1, side: 'south' },
  { classId: 'monk', x: 28, y: MAP_HEIGHT - 1, side: 'south' },
];

/** World-space arrival point just inside a main city gate, for a class arriving from its secondary village. */
export function mainCityArrivalTile(classId: string): { x: number; y: number } {
  const gate = MAIN_CITY_GATES.find((g) => g.classId === classId)!;
  if (gate.side === 'east') return { x: gate.x - 2, y: gate.y };
  return { x: gate.x, y: gate.y - 2 };
}

/**
 * Builds a small overworld: a safe walled village (path tiles) in the
 * top-left corner connected by a road to an open grass field dotted with
 * trees and a pond. Grass tiles are where random encounters can trigger.
 */
export function generateOverworldMap(seed = 1337): GeneratedMap {
  const rand = mulberry32(seed);
  const tiles: TileType[][] = [];
  for (let y = 0; y < MAP_HEIGHT; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < MAP_WIDTH; x++) {
      const isBorder = x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1;
      row.push(isBorder ? TileType.Tree : TileType.Grass);
    }
    tiles.push(row);
  }

  // Village clearing (safe, no encounters).
  const villageX0 = 2;
  const villageY0 = 2;
  const villageX1 = 9;
  const villageY1 = 8;
  for (let y = villageY0; y <= villageY1; y++) {
    for (let x = villageX0; x <= villageX1; x++) {
      const isEdge = x === villageX0 || y === villageY0 || x === villageX1 || y === villageY1;
      tiles[y][x] = isEdge ? TileType.Tree : TileType.Path;
    }
  }
  // Village gate, opens south towards the road.
  tiles[villageY1][6] = TileType.Path;
  tiles[villageY1][7] = TileType.Path;

  // A short road from the village gate leading into the field — the field
  // itself is grass so wandering further out is where encounters can happen.
  const roadLength = 4;
  for (let y = villageY1 + 1; y <= villageY1 + roadLength; y++) {
    tiles[y][6] = TileType.Path;
    tiles[y][7] = TileType.Path;
  }

  // A pond obstacle out in the field.
  const pondCx = 26;
  const pondCy = 14;
  for (let y = -3; y <= 3; y++) {
    for (let x = -4; x <= 4; x++) {
      if (x * x * 1.3 + y * y * 2 <= 16) {
        const tx = pondCx + x;
        const ty = pondCy + y;
        if (tx > 0 && tx < MAP_WIDTH - 1 && ty > 0 && ty < MAP_HEIGHT - 1) {
          tiles[ty][tx] = TileType.Water;
        }
      }
    }
  }

  // Scattered trees across the field.
  for (let i = 0; i < 70; i++) {
    const x = 1 + Math.floor(rand() * (MAP_WIDTH - 2));
    const y = 1 + Math.floor(rand() * (MAP_HEIGHT - 2));
    if (tiles[y][x] === TileType.Grass) {
      tiles[y][x] = TileType.Tree;
    }
  }

  // One gate per class, each with a short walk-in stub — carved last so
  // nothing scattered above ever blocks them.
  for (const gate of MAIN_CITY_GATES) {
    tiles[gate.y][gate.x] = TileType.Path;
    if (gate.side === 'east') {
      tiles[gate.y][gate.x - 1] = TileType.Path;
      tiles[gate.y][gate.x - 2] = TileType.Path;
    } else {
      tiles[gate.y - 1][gate.x] = TileType.Path;
      tiles[gate.y - 2][gate.x] = TileType.Path;
    }
  }

  return { tiles, playerStart: { x: 5, y: 5 } };
}

export interface VillageMapOptions {
  width: number;
  height: number;
  seed: number;
  /** Whether this village has a gate back toward its own starting village (secondary villages only). */
  hasNorthGate: boolean;
  /** Whether this village has a gate onward (starting villages, and secondary villages heading to the main city). */
  hasSouthGate: boolean;
  treeCount: number;
}

/**
 * A small, self-contained village map: a walled clearing at the center with
 * north/south gates as requested. Reused for every class's starting and
 * secondary village — visual identity comes from each zone's accent color
 * (see `render/worldBuilder.ts`) and NPC roster, not from a bespoke layout.
 */
export function generateVillageMap(opts: VillageMapOptions): GeneratedMap {
  const rand = mulberry32(opts.seed);
  const { width, height } = opts;
  const tiles: TileType[][] = [];
  for (let y = 0; y < height; y++) {
    const row: TileType[] = [];
    for (let x = 0; x < width; x++) {
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      row.push(isBorder ? TileType.Tree : TileType.Grass);
    }
    tiles.push(row);
  }

  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const vw = Math.max(2, Math.floor(width * 0.22));
  const vh = Math.max(2, Math.floor(height * 0.22));

  if (opts.hasNorthGate) {
    tiles[0][cx] = TileType.Path;
    for (let y = 1; y < cy - vh; y++) tiles[y][cx] = TileType.Path;
  }
  if (opts.hasSouthGate) {
    tiles[height - 1][cx] = TileType.Path;
    for (let y = cy + vh; y < height - 1; y++) tiles[y][cx] = TileType.Path;
  }

  for (let y = cy - vh; y <= cy + vh; y++) {
    for (let x = cx - vw; x <= cx + vw; x++) {
      if (x <= 0 || y <= 0 || x >= width - 1 || y >= height - 1) continue;
      const isEdge = x === cx - vw || y === cy - vh || x === cx + vw || y === cy + vh;
      tiles[y][x] = isEdge ? TileType.Tree : TileType.Path;
    }
  }
  // Open the clearing's own wall where each road meets it.
  if (opts.hasNorthGate) tiles[cy - vh][cx] = TileType.Path;
  if (opts.hasSouthGate) tiles[cy + vh][cx] = TileType.Path;

  for (let i = 0; i < opts.treeCount; i++) {
    const x = 1 + Math.floor(rand() * (width - 2));
    const y = 1 + Math.floor(rand() * (height - 2));
    if (tiles[y][x] === TileType.Grass) tiles[y][x] = TileType.Tree;
  }

  return { tiles, playerStart: { x: cx, y: cy } };
}
