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

  return { tiles, playerStart: { x: 5, y: 5 } };
}
