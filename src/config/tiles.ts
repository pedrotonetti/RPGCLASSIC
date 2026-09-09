export enum TileType {
  Grass = 0,
  Path = 1,
  Water = 2,
  Tree = 3,
}

export const WALKABLE_TILES = new Set<TileType>([TileType.Grass, TileType.Path]);
/** Tiles where random encounters can trigger while walking. */
export const ENCOUNTER_TILES = new Set<TileType>([TileType.Grass]);

export function isWalkable(tile: TileType): boolean {
  return WALKABLE_TILES.has(tile);
}

export function triggersEncounter(tile: TileType): boolean {
  return ENCOUNTER_TILES.has(tile);
}
