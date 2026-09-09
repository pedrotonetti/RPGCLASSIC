export enum TileType {
  Grass = 0,
  Path = 1,
  Water = 2,
  Tree = 3,
}

export const WALKABLE_TILES = new Set<TileType>([TileType.Grass, TileType.Path]);

export function isWalkable(tile: TileType): boolean {
  return WALKABLE_TILES.has(tile);
}
