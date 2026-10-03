import { TileType } from '../config/tiles';
import type { TileRect } from './monsterSpawning';

/**
 * Ambient, non-attackable wildlife — never part of OverworldCombat, so
 * nothing here can be targeted, engaged or killed. The fox is the vendored
 * glTF asset (public/models/fox.glb); every other species is a procedural
 * low-poly build (render/wildlife.ts), the same approach every enemy model
 * already takes.
 */
export type WildlifeSpecies = 'fox' | 'rabbit' | 'deer' | 'butterfly' | 'bird';

export interface WildlifeSite {
  species: WildlifeSpecies;
  /** Tile the creature calls home — it wanders/flutters/circles around this. */
  x: number;
  y: number;
}

export interface WildlifeLayout {
  /** Tiles that get a small clump of flowers (ipê-coloured — see render/wildlife.ts). */
  flowerPatches: Array<{ x: number; y: number }>;
  creatures: WildlifeSite[];
}

export interface WildlifeLayoutOptions {
  /** The zone's own spawn tile — kept clear so arriving never lands in a herd. */
  start: { x: number; y: number };
  /** Building footprints / town districts nothing should spawn inside. */
  avoid?: TileRect[];
  /** Phones/tablets (Game.lowPowerTier): roughly half the creatures, fewer patches. */
  lowPower?: boolean;
  rand?: () => number;
}

const PATCH_SPACING = 5; // tiles between flower patches
const FOREST_EDGE_RADIUS = 2; // a tree within this many tiles = "at the forest's edge"
const START_CLEARANCE = 4;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Where this zone's flowers and animals go. Flowers favour grass at a
 * forest's edge (a tree within FOREST_EDGE_RADIUS tiles) so the woods are
 * what feels alive, and every patch gets at least one creature of its own —
 * a butterfly always, often a second, and sometimes a rabbit nibbling at
 * it. Foxes and deer roam other forest-edge grass; birds circle over the
 * densest woods. Counts scale with how much open grass the zone actually
 * has, so a small village isn't crowded and Pedravale's huge Verdegal isn't
 * empty.
 */
export function pickWildlifeLayout(tiles: TileType[][], opts: WildlifeLayoutOptions): WildlifeLayout {
  const rand = opts.rand ?? Math.random;
  const avoid = opts.avoid ?? [];
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;

  const isTree = (x: number, y: number) => tiles[y]?.[x] === TileType.Tree;
  const treesNear = (x: number, y: number, r: number) => {
    let n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (isTree(x + dx, y + dy)) n++;
    return n;
  };
  const blocked = (x: number, y: number) =>
    Math.hypot(x - opts.start.x, y - opts.start.y) < START_CLEARANCE ||
    avoid.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1);

  const forestEdge: Array<{ x: number; y: number }> = [];
  const openGrass: Array<{ x: number; y: number }> = [];
  const deepForest: Array<{ x: number; y: number }> = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const t = tiles[y][x];
      if (t === TileType.Tree && treesNear(x, y, 2) >= 9) deepForest.push({ x, y });
      if (t !== TileType.Grass || blocked(x, y)) continue;
      if (treesNear(x, y, FOREST_EDGE_RADIUS) > 0) forestEdge.push({ x, y });
      else openGrass.push({ x, y });
    }
  }

  const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  shuffle(forestEdge);
  shuffle(openGrass);
  shuffle(deepForest);

  const grassCount = forestEdge.length + openGrass.length;
  const scale = opts.lowPower ? 0.5 : 1;
  // Flowers are two instanced draw calls no matter how many there are, and
  // creatures beyond render/wildlife.ts's ACTIVE_RADIUS aren't simulated or
  // drawn at all — so density here is cheap; what matters is that a walk
  // through any stretch of woods actually runs into some.
  const patchTarget = Math.round(clamp(grassCount / 260, 8, 110) * (opts.lowPower ? 0.6 : 1));

  const farFrom = (taken: Array<{ x: number; y: number }>, p: { x: number; y: number }, spacing: number) =>
    taken.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= spacing);

  const flowerPatches: Array<{ x: number; y: number }> = [];
  for (const p of forestEdge) {
    if (flowerPatches.length >= patchTarget) break;
    if (farFrom(flowerPatches, p, PATCH_SPACING)) flowerPatches.push(p);
  }

  const creatures: WildlifeSite[] = [];
  for (const patch of flowerPatches) {
    creatures.push({ species: 'butterfly', ...patch });
    if (!opts.lowPower && rand() < 0.45) creatures.push({ species: 'butterfly', ...patch });
    if (rand() < 0.4 * (opts.lowPower ? 0.6 : 1)) creatures.push({ species: 'rabbit', ...patch });
  }

  // Roamers only keep their distance from their own kind — a deer grazing
  // beside a flower patch is exactly the point, and checking against the
  // patches too crowded every fox/deer out of a small zone's limited edge.
  const placeRoamers = (species: WildlifeSpecies, pool: Array<{ x: number; y: number }>, count: number, spacing: number) => {
    const own: Array<{ x: number; y: number }> = [];
    for (const p of pool) {
      if (own.length >= count) break;
      if (!farFrom(own, p, spacing)) continue;
      creatures.push({ species, ...p });
      own.push(p);
    }
  };
  placeRoamers('fox', forestEdge, Math.round(clamp(patchTarget / 8, 3, 12) * scale), 4);
  placeRoamers('rabbit', openGrass.length > 0 ? openGrass : forestEdge, Math.round(clamp(patchTarget / 8, 2, 12) * scale), 4);
  placeRoamers('deer', forestEdge, Math.round(clamp(patchTarget / 9, 2, 12) * scale), 5);
  placeRoamers('bird', deepForest.length > 0 ? deepForest : forestEdge, Math.round(clamp(patchTarget / 9, 2, 12) * scale), 6);

  return { flowerPatches, creatures };
}
