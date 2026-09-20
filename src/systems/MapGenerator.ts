import { TileType } from '../config/tiles';

export const MAP_WIDTH = 80;
export const MAP_HEIGHT = 48;

export interface GeneratedMap {
  tiles: TileType[][];
  playerStart: { x: number; y: number };
  /** Procedural structures to render on top of this map's grass field — see `render/worldBuilder.ts`. */
  buildings: BuildingPlacement[];
}

/**
 * Low-poly building archetypes shared by every settlement — see
 * `render/worldBuilder.ts` for how each is actually built out of primitive
 * geometry (boxes/cones/cylinders), matching the existing tree style.
 */
export type BuildingKind = 'hut' | 'house' | 'stall' | 'tower';

export interface BuildingPlacement {
  kind: BuildingKind;
  /** Tile-space footprint: top-left corner + size. Axis-aligned, never rotated, so collision stays a plain AABB. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Footprint size (in tiles) per building kind — the single source of truth both placement (here) and rendering (`worldBuilder.ts`) key off. */
export const BUILDING_FOOTPRINTS: Record<BuildingKind, { w: number; h: number }> = {
  hut: { w: 2, h: 2 },
  house: { w: 3, h: 3 },
  stall: { w: 1, h: 1 },
  tower: { w: 2, h: 2 },
};

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
 * the old-town plaza (top-left) and the pond so the walk-in stub never needs
 * to fight existing terrain. Coordinates scale with MAP_WIDTH/MAP_HEIGHT —
 * see the doubled dimensions above (this used to be a 40x24 map).
 */
export const MAIN_CITY_GATES: Array<{ classId: string; x: number; y: number; side: 'east' | 'south' }> = [
  { classId: 'warrior', x: MAP_WIDTH - 1, y: 6, side: 'east' },
  { classId: 'mage', x: MAP_WIDTH - 1, y: 12, side: 'east' },
  { classId: 'archer', x: MAP_WIDTH - 1, y: 20, side: 'east' },
  { classId: 'cleric', x: MAP_WIDTH - 1, y: 28, side: 'east' },
  { classId: 'paladin', x: MAP_WIDTH - 1, y: 36, side: 'east' },
  { classId: 'assassin', x: MAP_WIDTH - 1, y: 42, side: 'east' },
  { classId: 'necromancer', x: 28, y: MAP_HEIGHT - 1, side: 'south' },
  { classId: 'monk', x: 56, y: MAP_HEIGHT - 1, side: 'south' },
];

/** World-space arrival point just inside a main city gate, for a class arriving from its secondary village. */
export function mainCityArrivalTile(classId: string): { x: number; y: number } {
  const gate = MAIN_CITY_GATES.find((g) => g.classId === classId)!;
  if (gate.side === 'east') return { x: gate.x - 2, y: gate.y };
  return { x: gate.x, y: gate.y - 2 };
}

// --- procedural building placement, shared by every generated map --------

interface BuildingKindWeight {
  kind: BuildingKind;
  weight: number;
}

/** Whether every tile of a `w`x`h` footprint anchored at (x,y) is open grass, at least one tile clear of the map border. */
function footprintFree(tiles: TileType[][], x: number, y: number, w: number, h: number): boolean {
  const height = tiles.length;
  const width = tiles[0].length;
  if (x < 1 || y < 1 || x + w > width - 1 || y + h > height - 1) return false;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      if (tiles[y + dy][x + dx] !== TileType.Grass) return false;
    }
  }
  return true;
}

/**
 * Claims a footprint by turning it into Path — not because a building is
 * "walkable" (its actual blocking comes from the `BuildingCollider` AABBs
 * `worldBuilder.buildOverworldMeshes` derives from these same placements,
 * checked in `OverworldScreen.canOccupy`/camera avoidance), but so nothing
 * generated afterwards mistakes the lot for open grass: monster/fox spawns
 * and the tree scatter below all gate themselves on `TileType.Grass`, so
 * stamping the footprint to Path keeps every one of them off of it for
 * free, and keeps a later building from overlapping an earlier one.
 */
function stampFootprint(tiles: TileType[][], x: number, y: number, w: number, h: number): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      tiles[y + dy][x + dx] = TileType.Path;
    }
  }
}

/**
 * Whether a candidate footprint comes within `margin` tiles of an already
 * placed one. `footprintFree` alone only rejects an exact tile overlap —
 * two buildings anchored off two different (but nearby) road tiles could
 * otherwise end up just one grass tile apart, a gap tight enough to box the
 * chase camera in between their roofs from certain angles. A 1-tile margin
 * keeps that from happening while still letting buildings sit close to the
 * road/plaza tiles they're lining (this only checks building-vs-building).
 */
function tooCloseToPlaced(x: number, y: number, w: number, h: number, placed: Array<{ x: number; y: number; w: number; h: number }>, margin: number): boolean {
  for (const other of placed) {
    const overlaps = x - margin < other.x + other.w && x + w + margin > other.x && y - margin < other.y + other.h && y + h + margin > other.y;
    if (overlaps) return true;
  }
  return false;
}

function weightedPick(items: BuildingKindWeight[], rand: () => number): BuildingKind {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let r = rand() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.kind;
  }
  return items[items.length - 1].kind;
}

/**
 * Scatters buildings on the grass lots bordering the map's existing
 * path/road tiles — the village clearings, the main city's streets and
 * plaza, every gate's walk-in stub — so a settlement reads as houses lining
 * a street instead of a bare clearing with trees around it. Each candidate
 * lot sits two tiles off its anchoring road tile (one tile of grass "yard"
 * as a gap, then the building), which is randomly chosen per candidate so
 * buildings end up on both sides of a street rather than only one.
 * `skipChance` and the road tiles' own natural gaps (a straight stretch of
 * road doesn't have infinite frontage) are what keep this from reading as a
 * solid, uniform wall of houses — some lots stay open grass.
 */
function placeBuildingsAlongPaths(
  tiles: TileType[][],
  rand: () => number,
  maxBuildings: number,
  kinds: BuildingKindWeight[],
  skipChance: number,
  reserved: BuildingPlacement[] = [],
): BuildingPlacement[] {
  const pathTiles: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < tiles.length; y++) {
    for (let x = 0; x < tiles[0].length; x++) {
      if (tiles[y][x] === TileType.Path) pathTiles.push({ x, y });
    }
  }
  // Shuffle (Fisher-Yates) so building placement isn't biased toward
  // whichever road happened to be carved/scanned first.
  for (let i = pathTiles.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pathTiles[i], pathTiles[j]] = [pathTiles[j], pathTiles[i]];
  }

  const OFFSETS: Array<{ dx: number; dy: number }> = [
    { dx: 2, dy: 0 },
    { dx: -2, dy: 0 },
    { dx: 0, dy: 2 },
    { dx: 0, dy: -2 },
  ];

  const placements: BuildingPlacement[] = [];
  const allPlaced: BuildingPlacement[] = [...reserved];
  for (const p of pathTiles) {
    if (placements.length >= maxBuildings) break;
    if (rand() < skipChance) continue;

    const off = OFFSETS[Math.floor(rand() * OFFSETS.length)];
    const kind = weightedPick(kinds, rand);
    const { w, h } = BUILDING_FOOTPRINTS[kind];

    let x: number;
    let y: number;
    if (off.dx > 0) {
      x = p.x + 2;
      y = p.y - Math.floor(h / 2);
    } else if (off.dx < 0) {
      x = p.x - 1 - w;
      y = p.y - Math.floor(h / 2);
    } else if (off.dy > 0) {
      x = p.x - Math.floor(w / 2);
      y = p.y + 2;
    } else {
      x = p.x - Math.floor(w / 2);
      y = p.y - 1 - h;
    }

    if (!footprintFree(tiles, x, y, w, h)) continue;
    if (tooCloseToPlaced(x, y, w, h, allPlaced, 1)) continue;
    stampFootprint(tiles, x, y, w, h);
    const placement = { kind, x, y, w, h };
    placements.push(placement);
    allPlaced.push(placement);
  }
  return placements;
}

/**
 * Reserves one landmark building's footprint at a fixed spot (rather than
 * the random street-lining pass above) — used for the single tower every
 * secondary village gets, so it reliably ends up facing the village's own
 * clearing instead of anywhere the random pass happens to land it.
 */
function placeLandmark(tiles: TileType[][], kind: BuildingKind, x: number, y: number): BuildingPlacement | null {
  const { w, h } = BUILDING_FOOTPRINTS[kind];
  if (!footprintFree(tiles, x, y, w, h)) return null;
  stampFootprint(tiles, x, y, w, h);
  return { kind, x, y, w, h };
}

/**
 * Builds a proper (if small) city: an old-town plaza in the top-left corner
 * (unchanged in absolute position/size across the whole game's life so far —
 * every hardcoded NPC stall position in `data/npcs.ts` still lands correctly
 * inside it), connected by a long paved street to a much bigger new
 * downtown plaza, plus a walled gate leading out to each class's territory.
 * Grass tiles are where random encounters can trigger; buildings line every
 * one of these roads/plazas so Pedravale reads as an actual city rather
 * than a clearing with a forest around it.
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

  // Old-town plaza (safe, no encounters) — kept at its original size/position
  // so every NPC's hardcoded mapX/mapY (data/npcs.ts) still lands inside it.
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
  // Old-town gate, opens south towards the new city.
  tiles[villageY1][6] = TileType.Path;
  tiles[villageY1][7] = TileType.Path;

  // A long paved street south from the old-town gate...
  const streetLength = 12;
  for (let y = villageY1 + 1; y <= villageY1 + streetLength; y++) {
    tiles[y][6] = TileType.Path;
    tiles[y][7] = TileType.Path;
  }
  // ...opening onto a much bigger downtown plaza, Pedravale's real town
  // square — the bulk of the main city's buildings line this and the gates.
  const plazaX0 = 3;
  const plazaX1 = 19;
  const plazaY0 = villageY1 + streetLength + 1;
  const plazaY1 = plazaY0 + 10;
  for (let y = plazaY0; y <= plazaY1; y++) {
    for (let x = plazaX0; x <= plazaX1; x++) {
      tiles[y][x] = TileType.Path;
    }
  }

  // A pond obstacle out in the field, well clear of the plazas and every gate.
  const pondCx = 58;
  const pondCy = 15;
  const pondRx = 7;
  const pondRy = 5;
  for (let y = -pondRy; y <= pondRy; y++) {
    for (let x = -pondRx; x <= pondRx; x++) {
      if ((x * x) / (pondRx * pondRx) + (y * y) / (pondRy * pondRy) <= 1) {
        const tx = pondCx + x;
        const ty = pondCy + y;
        if (tx > 0 && tx < MAP_WIDTH - 1 && ty > 0 && ty < MAP_HEIGHT - 1) {
          tiles[ty][tx] = TileType.Water;
        }
      }
    }
  }

  // One gate per class, each with a longer walk-in stub than before — carved
  // last (before buildings/trees) so nothing scattered above ever blocks
  // them, and long enough to give each one a little building frontage too.
  const GATE_STUB_LENGTH = 4;
  for (const gate of MAIN_CITY_GATES) {
    tiles[gate.y][gate.x] = TileType.Path;
    for (let i = 1; i <= GATE_STUB_LENGTH; i++) {
      if (gate.side === 'east') tiles[gate.y][gate.x - i] = TileType.Path;
      else tiles[gate.y - i][gate.x] = TileType.Path;
    }
  }

  // Buildings line every street/plaza/gate stub laid out above — Pedravale
  // is the shared hub every class passes through, so it's the largest and
  // most built-up settlement in the game (denser mix, occasional towers).
  const buildings = placeBuildingsAlongPaths(
    tiles,
    rand,
    34,
    [
      { kind: 'hut', weight: 2 },
      { kind: 'house', weight: 6 },
      { kind: 'stall', weight: 3 },
      { kind: 'tower', weight: 1 },
    ],
    0.25,
  );

  // Scattered trees across the field — count scaled up with the map's area
  // (roughly 4x the old 40x24 map) so the bigger field doesn't read as barer
  // than before; buildings/roads/plaza/pond above are already Path/Water so
  // the Grass-only check here leaves every one of them untouched.
  for (let i = 0; i < 260; i++) {
    const x = 1 + Math.floor(rand() * (MAP_WIDTH - 2));
    const y = 1 + Math.floor(rand() * (MAP_HEIGHT - 2));
    if (tiles[y][x] === TileType.Grass) {
      tiles[y][x] = TileType.Tree;
    }
  }

  return { tiles, playerStart: { x: 5, y: 5 }, buildings };
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
  /** Sparse starting villages get a handful of huts; developed secondary villages get more buildings, more variety, and a landmark tower. */
  development: 'sparse' | 'developed';
}

/**
 * A small, self-contained village map: a walled clearing at the center with
 * north/south gates as requested, ringed by houses along its own edge and
 * ~one tile of yard, so it reads as a settlement built around a town square
 * rather than an empty walled pen. Reused for every class's starting and
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

  const buildings: BuildingPlacement[] = [];
  if (opts.development === 'developed') {
    // A single landmark building facing the square from its east side,
    // clear of both the north/south road column and the clearing wall —
    // e.g. the mage secondary village's "Torre dos Arcanos" is this same
    // procedural tower, just tinted with that zone's own accent color.
    const landmark = placeLandmark(tiles, 'tower', cx + vw + 2, cy - 1);
    if (landmark) buildings.push(landmark);
  }

  const streetBuildings =
    opts.development === 'developed'
      ? placeBuildingsAlongPaths(
          tiles,
          rand,
          18,
          [
            { kind: 'hut', weight: 3 },
            { kind: 'house', weight: 5 },
            { kind: 'stall', weight: 2 },
          ],
          0.3,
          buildings, // keeps clearance from the landmark tower placed above
        )
      : placeBuildingsAlongPaths(
          tiles,
          rand,
          12,
          [
            { kind: 'hut', weight: 8 },
            { kind: 'house', weight: 2 },
          ],
          0.32,
        );
  buildings.push(...streetBuildings);

  for (let i = 0; i < opts.treeCount; i++) {
    const x = 1 + Math.floor(rand() * (width - 2));
    const y = 1 + Math.floor(rand() * (height - 2));
    if (tiles[y][x] === TileType.Grass) tiles[y][x] = TileType.Tree;
  }

  return { tiles, playerStart: { x: cx, y: cy }, buildings };
}
