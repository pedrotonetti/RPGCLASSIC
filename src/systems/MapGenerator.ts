import { TileType } from '../config/tiles';

// Was 80x48 — widened ~3x per axis (~9x total area) so the explorable
// countryside around Pedravale is meaningfully bigger, not just a token
// bump. The old-town plaza, downtown plaza, pond and every gate below are
// all placed at their existing absolute low-numbered coordinates near the
// map's origin corner (never centered), so none of them move — the extra
// space is purely new field/forest extending outward past them.
export const MAP_WIDTH = 240;
export const MAP_HEIGHT = 150;

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
  const plazaX1 = 30;
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
  // Was 4 — quadrupled so each gate reads as its own small outpost/hamlet
  // now that the field around it is ~9x bigger, instead of a bare 4-tile
  // nub in the middle of a much larger empty stretch.
  const GATE_STUB_LENGTH = 16;
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
    90,
    [
      { kind: 'hut', weight: 2 },
      { kind: 'house', weight: 6 },
      { kind: 'stall', weight: 3 },
      { kind: 'tower', weight: 1 },
    ],
    0.25,
  );

  // Scattered trees across the field — count scaled up with the map's area
  // (roughly 9x the old 80x48 map, same proportional-to-area approach as
  // the previous resize) so the bigger field doesn't read as barer than
  // before; buildings/roads/plaza/pond above are already Path/Water so
  // the Grass-only check here leaves every one of them untouched.
  for (let i = 0; i < 2300; i++) {
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
/**
 * The central clearing's geometry for a village of this size — exported so
 * `data/npcs.ts` can place the per-class elder/mentor NPCs relative to the
 * clearing (e.g. "3 tiles west of its wall") instead of a stale absolute
 * tile position that only made sense at one specific village size.
 */
export function villageClearingBounds(width: number, height: number): { cx: number; cy: number; vw: number; vh: number } {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  // Capped, not purely proportional to width/height — a town square should
  // stay roughly town-square-sized as the map grows, with the extra space
  // becoming wilderness AROUND the village. An uncapped 0.22 factor at the
  // ~3x-bigger village dimensions (see zones.ts) turned the whole clearing
  // into a vast, near-empty paved plaza — confirmed visually (walking from
  // its center in any direction showed nothing but bare pavement for many
  // seconds) before this cap was added.
  const vw = Math.min(10, Math.max(2, Math.floor(width * 0.22)));
  const vh = Math.min(8, Math.max(2, Math.floor(height * 0.22)));
  return { cx, cy, vw, vh };
}

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

  const { cx, cy, vw, vh } = villageClearingBounds(width, height);

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
          50,
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
          35,
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

// --- dungeon instances: fixed-layout linear corridors (see data/dungeons.ts) ---

/**
 * A dungeon map is a single north-south corridor, not a free-roam square —
 * "diversify the stages/instances" per the design brief means Diablo/PW-style
 * instances: a fixed gauntlet of monster chambers leading to one boss arena,
 * not another open village. Every span (entrance room, each
 * corridor-then-chamber pair, the final corridor, the boss arena) is carved
 * out of solid rock (TileType.Tree, reused here as "twisted corrupted root
 * wall" — see LORE.md's framing of monsters as corrupted ancestors, which
 * this reuses rather than inventing a new tile type/renderer) so the whole
 * thing reads as a tunnel, always the same shape for a given encounter count.
 */
const DUNGEON_WIDTH = 13;
const DUNGEON_CORRIDOR_HALF = 1; // 3-tile-wide connecting corridors
const DUNGEON_ROOM_HALF = 4; // ~9-tile-wide encounter chambers
const DUNGEON_BOSS_HALF = 5; // full-width boss arena
const DUNGEON_ENTRANCE_DEPTH = 5;
const DUNGEON_CORRIDOR_DEPTH = 5;
const DUNGEON_CHAMBER_DEPTH = 7;
const DUNGEON_BOSS_DEPTH = 11;

interface DungeonSpan {
  yTop: number;
  yBottom: number;
  half: number;
}

interface DungeonGeometry {
  width: number;
  height: number;
  spans: DungeonSpan[];
  bossSpan: DungeonSpan;
  playerStart: { x: number; y: number };
  exitTile: { x: number; y: number };
  encounterTiles: Array<{ x: number; y: number }>;
  bossTile: { x: number; y: number };
}

/**
 * Pure geometry (no tile grid) for a dungeon with `encounterCount` fixed
 * combat chambers before the boss — the single source of truth both
 * `dungeonLayout` (metadata `data/dungeons.ts` builds its fixed encounter/
 * boss tile positions from) and `generateDungeonMap` (which actually carves
 * the tile grid) derive from, so the two can never drift apart.
 */
function computeDungeonGeometry(encounterCount: number): DungeonGeometry {
  const width = DUNGEON_WIDTH;
  const cx = Math.floor(width / 2);
  const height =
    2 + // north/south solid-rock border rows
    DUNGEON_ENTRANCE_DEPTH +
    encounterCount * (DUNGEON_CORRIDOR_DEPTH + DUNGEON_CHAMBER_DEPTH) +
    DUNGEON_CORRIDOR_DEPTH +
    DUNGEON_BOSS_DEPTH;

  const spans: DungeonSpan[] = [];
  const ySouth = height - 1;
  const entranceTop = ySouth - DUNGEON_ENTRANCE_DEPTH;
  spans.push({ yTop: entranceTop, yBottom: ySouth - 1, half: DUNGEON_ROOM_HALF });
  const playerStart = { x: cx, y: ySouth - 2 };
  const exitTile = { x: cx, y: ySouth };

  let cursor = entranceTop - 1;
  const encounterTiles: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < encounterCount; i++) {
    const corridorBottom = cursor;
    const corridorTop = corridorBottom - DUNGEON_CORRIDOR_DEPTH + 1;
    spans.push({ yTop: corridorTop, yBottom: corridorBottom, half: DUNGEON_CORRIDOR_HALF });
    cursor = corridorTop - 1;

    const chamberBottom = cursor;
    const chamberTop = chamberBottom - DUNGEON_CHAMBER_DEPTH + 1;
    spans.push({ yTop: chamberTop, yBottom: chamberBottom, half: DUNGEON_ROOM_HALF });
    encounterTiles.push({ x: cx, y: Math.round((chamberTop + chamberBottom) / 2) });
    cursor = chamberTop - 1;
  }

  const finalCorridorBottom = cursor;
  const finalCorridorTop = finalCorridorBottom - DUNGEON_CORRIDOR_DEPTH + 1;
  spans.push({ yTop: finalCorridorTop, yBottom: finalCorridorBottom, half: DUNGEON_CORRIDOR_HALF });
  cursor = finalCorridorTop - 1;

  const bossBottom = cursor;
  const bossTop = Math.max(1, bossBottom - DUNGEON_BOSS_DEPTH + 1);
  const bossSpan = { yTop: bossTop, yBottom: bossBottom, half: DUNGEON_BOSS_HALF };
  spans.push(bossSpan);
  const bossTile = { x: cx, y: Math.round((bossTop + bossBottom) / 2) };

  return { width, height, spans, bossSpan, playerStart, exitTile, encounterTiles, bossTile };
}

export interface DungeonLayout {
  width: number;
  height: number;
  /** Where the player spawns on entering, just inside the exit gate. */
  playerStart: { x: number; y: number };
  /** Tile that leads back to the dungeon's host zone (see ZoneExit). */
  exitTile: { x: number; y: number };
  /** Center tile of each fixed encounter chamber, entrance-to-boss order. */
  encounterTiles: Array<{ x: number; y: number }>;
  /** Center tile of the boss arena. */
  bossTile: { x: number; y: number };
}

/** Metadata-only view of a dungeon's fixed layout — `data/dungeons.ts` uses this to place its encounters/boss without needing to generate (or duplicate the math behind) the actual tile grid. */
export function dungeonLayout(encounterCount: number): DungeonLayout {
  const g = computeDungeonGeometry(encounterCount);
  return { width: g.width, height: g.height, playerStart: g.playerStart, exitTile: g.exitTile, encounterTiles: g.encounterTiles, bossTile: g.bossTile };
}

export interface DungeonMapOptions {
  seed: number;
  /** Number of fixed combat chambers between the entrance and the boss arena. */
  encounterCount: number;
}

/** Builds the actual tile grid for a dungeon instance — a linear corridor/gauntlet, not a free-roam village. See `dungeonLayout` for the matching tile metadata. */
export function generateDungeonMap(opts: DungeonMapOptions): GeneratedMap {
  const rand = mulberry32(opts.seed);
  const g = computeDungeonGeometry(opts.encounterCount);
  const cx = Math.floor(g.width / 2);

  const tiles: TileType[][] = [];
  for (let y = 0; y < g.height; y++) tiles.push(new Array<TileType>(g.width).fill(TileType.Tree));

  for (const span of g.spans) {
    const x0 = Math.max(1, cx - span.half);
    const x1 = Math.min(g.width - 2, cx + span.half);
    for (let y = span.yTop; y <= span.yBottom; y++) {
      for (let x = x0; x <= x1; x++) tiles[y][x] = TileType.Grass;
    }
  }
  // Breach the south wall so the exit gate is reachable from just inside it.
  tiles[g.height - 1][cx] = TileType.Grass;

  // Sparse dead-root clutter across the wider rooms so they don't read as
  // empty rectangles — the corridor's own width (centered on cx) is left
  // untouched so the path stays guaranteed-connected however the dice land.
  for (let y = 1; y < g.height - 1; y++) {
    for (let x = 1; x < g.width - 1; x++) {
      if (tiles[y][x] !== TileType.Grass) continue;
      if (Math.abs(x - cx) <= DUNGEON_CORRIDOR_HALF) continue;
      if (rand() < 0.07) tiles[y][x] = TileType.Tree;
    }
  }
  // Guarantee every fixed encounter/boss/start/exit tile stayed clear even if
  // the clutter pass above happened to land right on one of them.
  for (const t of [g.playerStart, g.exitTile, g.bossTile, ...g.encounterTiles]) {
    tiles[t.y][t.x] = TileType.Grass;
  }

  // A corrupted shrine (reusing the same landmark tower every secondary
  // village gets) marks the boss arena as a real destination, not just the
  // last empty room.
  const buildings: BuildingPlacement[] = [];
  const shrine = placeLandmark(tiles, 'tower', Math.min(g.width - 3, cx + 2), g.bossSpan.yTop + 1);
  if (shrine) buildings.push(shrine);

  return { tiles, playerStart: g.playerStart, buildings };
}
