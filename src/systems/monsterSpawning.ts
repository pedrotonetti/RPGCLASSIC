import { TileType } from '../config/tiles';

export type TileRect = { x0: number; y0: number; x1: number; y1: number };

/** Rolls a band size (1-based) from relative weights — index 0 is a solo, 1 a pair, and so on. */
export function rollPackSize(weights: number[], rand: () => number = Math.random): number {
  const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
  if (total <= 0) return 1;
  let roll = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= Math.max(0, weights[i]);
    if (roll < 0) return i + 1;
  }
  return weights.length;
}

/** Picks well-spaced grass tiles for monster spawn points, clear of the player's starting area and of every `avoid` rect. */
export function pickSpawnPoints(
  tiles: TileType[][],
  startTile: { x: number; y: number },
  count: number,
  minDistFromStart: number,
  minSpacing: number,
  avoid: TileRect[] = [],
): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < tiles.length; y++) {
    for (let x = 0; x < tiles[0].length; x++) {
      if (tiles[y][x] !== TileType.Grass) continue;
      if (Math.hypot(x - startTile.x, y - startTile.y) < minDistFromStart) continue;
      if (avoid.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)) continue;
      candidates.push({ x, y });
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const picked: Array<{ x: number; y: number }> = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= minSpacing)) picked.push(c);
  }
  return picked;
}
