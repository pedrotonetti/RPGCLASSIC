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
 *
 * `hut`/`house`/`stall`/`tower` are the procedural street-lining pass's own
 * archetypes. `shop` is a hand-placed named storefront (see `Signage`), and
 * the rest are small hand-placed street props — fountains, lamp posts,
 * banners, crates, wells, a shrine, a notice board, a campfire — rendered by
 * `render/cityProps.ts`. Props are still ordinary placements (footprint,
 * collider, minimap, pathfinding all work the same way), they just get a
 * smaller collider that doesn't push the follow-camera around.
 */
export type BuildingKind =
  | 'hut'
  | 'house'
  | 'stall'
  | 'tower'
  | 'shop'
  | 'fountain'
  | 'lamp'
  | 'banner'
  | 'crates'
  | 'well'
  | 'shrine'
  | 'noticeboard'
  | 'campfire';

/**
 * What a named storefront is — drives its sign text, awning color and the
 * trade props out front (see `render/cityProps.ts`). The first five are the
 * vendor NPCs' own shops (`data/npcs.ts`'s `VendorKind` is exactly this
 * subset); the inn and the warehouse are the two non-vendor landmarks the
 * market square's own NPCs talk about.
 */
export type Signage = 'ferreiro' | 'tecelao' | 'boticario' | 'joalheiro' | 'artesao' | 'estalagem' | 'armazem';

export interface BuildingPlacement {
  kind: BuildingKind;
  /** Tile-space footprint: top-left corner + size. Axis-aligned, never rotated, so collision stays a plain AABB. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Set only on a `shop` — which storefront it is. */
  signage?: Signage;
}

/** Footprint size (in tiles) per building kind — the single source of truth both placement (here) and rendering (`worldBuilder.ts`) key off. */
export const BUILDING_FOOTPRINTS: Record<BuildingKind, { w: number; h: number }> = {
  hut: { w: 2, h: 2 },
  house: { w: 3, h: 3 },
  stall: { w: 1, h: 1 },
  tower: { w: 2, h: 2 },
  shop: { w: 3, h: 3 },
  fountain: { w: 3, h: 3 },
  lamp: { w: 1, h: 1 },
  banner: { w: 1, h: 1 },
  crates: { w: 1, h: 1 },
  well: { w: 1, h: 1 },
  shrine: { w: 1, h: 1 },
  noticeboard: { w: 1, h: 1 },
  campfire: { w: 1, h: 1 },
};

interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
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
function tooCloseToPlaced(x: number, y: number, w: number, h: number, placed: TileRect[], margin: number): boolean {
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
 *
 * `reserved` areas keep the same 1-tile clearance an already-placed building
 * gets; `blocked` tiles only forbid an outright overlap (margin 0) — for
 * small hand-placed props/NPC spots that are fine sitting right next to a
 * house's wall. Neither changes how many `rand()` calls a run consumes (a
 * rejected candidate has already drawn its skip/offset/kind rolls), so
 * reserving space here never reshuffles the rest of the map's buildings or
 * its tree scatter afterwards.
 */
function placeBuildingsAlongPaths(
  tiles: TileType[][],
  rand: () => number,
  maxBuildings: number,
  kinds: BuildingKindWeight[],
  skipChance: number,
  reserved: TileRect[] = [],
  blocked: TileRect[] = [],
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
  const allPlaced: TileRect[] = [...reserved];
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
    if (tooCloseToPlaced(x, y, w, h, blocked, 0)) continue;
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
 * Old-town plaza bounds (tile-space, inclusive) — "Praça da Fundação" in
 * lore/dialogue (see the archivist NPC's line in `data/npcs.ts`). Hoisted to
 * a module-level constant, rather than a local var inside
 * `generateOverworldMap`, purely so callers outside this file (the minimap's
 * sub-area label) can key off the exact same numbers the generator itself
 * carves — these two can never drift apart.
 */
export const MAIN_CITY_OLD_TOWN_BOUNDS = { x0: 2, y0: 2, x1: 9, y1: 8 };
const STREET_LENGTH = 12;
/**
 * Downtown plaza bounds (tile-space, inclusive) — "Praça do Mercado" in
 * lore/dialogue (see the guard NPC's line in `data/npcs.ts`). See
 * `MAIN_CITY_OLD_TOWN_BOUNDS`'s own doc comment for why this is hoisted here
 * instead of computed as a local inside `generateOverworldMap`.
 */
export const MAIN_CITY_DOWNTOWN_BOUNDS = {
  x0: 3,
  x1: 30,
  y0: MAIN_CITY_OLD_TOWN_BOUNDS.y1 + STREET_LENGTH + 1,
  y1: MAIN_CITY_OLD_TOWN_BOUNDS.y1 + STREET_LENGTH + 1 + 10,
};

// --- Pedravale's hand-placed landmarks --------------------------------------
//
// The follow-camera's yaw is FIXED (OverworldScreen's CAMERA_YAW = 0: always
// north of the avatar, looking south along +z), and every NPC faces north,
// toward it. So a storefront only ever reads on screen if its front faces
// north, with its keeper standing just north of it — which is why every shop
// below sits on the SOUTH side of the street/plaza it serves, and every NPC
// spot below has its matching prop one tile south of it (behind the NPC, as
// the camera sees it) rather than north (behind the camera).

/**
 * "Rua dos Ofícios" — Pedravale's crafts street: an east-west street one
 * block south of the market square, reached by a short lane from the
 * square's south edge, lined on its south side by the five vendor NPCs' own
 * workshops. Carved AFTER the procedural street-lining pass (see
 * generateOverworldMap) so only these hand-placed storefronts front it.
 */
// Ten rows south of the square: the block between them holds the buildings
// facing the square (3 rows deep) and then a tree-free green at least 5 rows
// deep — the follow-camera trails ~3.75 tiles north of the avatar and keeps
// ~1 more tile clear of any building, so anything taller than a lamp post
// closer than that to the street's north edge would fill the foreground of
// every view down the crafts street with the back of a roof.
export const MAIN_CITY_CRAFTS_STREET = { x0: 3, x1: 30, y0: MAIN_CITY_DOWNTOWN_BOUNDS.y1 + 10, y1: MAIN_CITY_DOWNTOWN_BOUNDS.y1 + 11 };
const MAIN_CITY_CRAFTS_LANE = { x0: 16, x1: 17, y0: MAIN_CITY_DOWNTOWN_BOUNDS.y1 + 1, y1: MAIN_CITY_CRAFTS_STREET.y0 - 1 };
/** Everything between the market square's south edge and the far side of the crafts street's shops — kept clear of the procedural pass AND the tree scatter entirely. */
const MAIN_CITY_CRAFTS_DISTRICT: TileRect = {
  x: MAIN_CITY_DOWNTOWN_BOUNDS.x0,
  y: MAIN_CITY_DOWNTOWN_BOUNDS.y1 + 1,
  w: MAIN_CITY_DOWNTOWN_BOUNDS.x1 - MAIN_CITY_DOWNTOWN_BOUNDS.x0 + 1,
  h: MAIN_CITY_CRAFTS_STREET.y1 + 5 - MAIN_CITY_DOWNTOWN_BOUNDS.y1,
};
/** The crafts street plus its storefronts, inclusive tile bounds — the minimap's "Rua dos Ofícios" sub-area label keys off this (see data/zones.ts subAreaNameAt). */
export const MAIN_CITY_CRAFTS_BOUNDS = {
  x0: MAIN_CITY_CRAFTS_STREET.x0,
  x1: MAIN_CITY_CRAFTS_STREET.x1,
  y0: MAIN_CITY_CRAFTS_STREET.y0 - 1,
  y1: MAIN_CITY_CRAFTS_DISTRICT.y + MAIN_CITY_CRAFTS_DISTRICT.h - 1,
};

export interface MainCityShop {
  signage: Signage;
  /** Top-left of the 3x3 `shop` footprint. */
  x: number;
  y: number;
  /** The paved strip along the shop's (north-facing) front. */
  apron: TileRect;
  /** Where this shop's keeper stands: the middle of the apron, right in front of the counter. */
  stand: { x: number; y: number };
}

function northFacingShop(signage: Signage, x: number, y: number): MainCityShop {
  const { w } = BUILDING_FOOTPRINTS.shop;
  return { signage, x, y, apron: { x, y: y - 1, w, h: 1 }, stand: { x: x + Math.floor(w / 2), y: y - 1 } };
}

const CRAFTS_SHOP_ROW_Y = MAIN_CITY_CRAFTS_STREET.y1 + 2;
const MARKET_SOUTH_ROW_Y = MAIN_CITY_DOWNTOWN_BOUNDS.y1 + 2;

/**
 * Every named storefront in Pedravale. The five vendor shops line the crafts
 * street (5-6 tiles apart, each with its own keeper — see data/npcs.ts,
 * which positions every vendor NPC at its shop's `stand` tile); the inn and
 * the warehouse face the market square from its south edge.
 */
export const MAIN_CITY_SHOPS: Record<Signage, MainCityShop> = {
  tecelao: northFacingShop('tecelao', 4, CRAFTS_SHOP_ROW_Y),
  boticario: northFacingShop('boticario', 9, CRAFTS_SHOP_ROW_Y),
  // Straight across from the lane's own mouth — the first shop the player
  // sees coming down from the market square.
  ferreiro: northFacingShop('ferreiro', 15, CRAFTS_SHOP_ROW_Y),
  joalheiro: northFacingShop('joalheiro', 21, CRAFTS_SHOP_ROW_Y),
  artesao: northFacingShop('artesao', 26, CRAFTS_SHOP_ROW_Y),
  estalagem: northFacingShop('estalagem', 8, MARKET_SOUTH_ROW_Y),
  armazem: northFacingShop('armazem', 23, MARKET_SOUTH_ROW_Y),
};

/**
 * Named spots for Pedravale's non-vendor NPCs, spread across the old-town
 * square, the street and the market square instead of the single cramped
 * row they used to share — each beside its own prop (placed one tile SOUTH
 * of it, see this section's header comment) so the town reads as people
 * going about their business, not a queue. data/npcs.ts positions NPCs from
 * these, never from a bare tile literal.
 */
export const MAIN_CITY_SPOTS = {
  /** Center of the Praça da Fundação, just north of the zone's own spawn tile — Tobias's long-standing spot. */
  foundersSquare: { x: 5, y: 4 },
  /** Beside the old square's founding Ipê shrine. */
  foundersShrine: { x: 3, y: 3 },
  /** Beside the archives' notice board, in the old square's north-east corner. */
  archivesBoard: { x: 8, y: 3 },
  /** Beside the old square's well. */
  oldTownWell: { x: 3, y: 6 },
  /** Guarding the old square's gate from inside, by its banner. */
  oldTownGate: { x: 8, y: 6 },
  /** On the street just outside the old-town gate, by a stack of parcels. */
  streetPost: { x: 8, y: 11 },
  /** Guarding the market square's entrance, by its gateway banners. */
  marketGate: { x: 9, y: 22 },
  /** In the middle of the market square's stalls. */
  marketStalls: { x: 6, y: 26 },
  /** At the fountain's north rim. */
  fountainNorth: { x: 16, y: 23 },
  /** At the fountain's west side. */
  fountainWest: { x: 12, y: 26 },
  /** The market square's north-east corner, by a campfire, looking out at the Verdegal. */
  verdegalLookout: { x: 28, y: 22 },
} satisfies Record<string, { x: number; y: number }>;

/**
 * Plain (non-storefront) buildings filling out the block between the market
 * square and the crafts street — the procedural pass is kept out of that
 * whole block (it would otherwise block the lane or crowd the storefronts),
 * so these stand in for what it would have put there.
 */
const MAIN_CITY_BLOCK_BUILDINGS: Array<{ kind: BuildingKind; x: number; y: number }> = [
  { kind: 'hut', x: 4, y: MARKET_SOUTH_ROW_Y },
  { kind: 'house', x: 12, y: MARKET_SOUTH_ROW_Y },
  { kind: 'house', x: 19, y: MARKET_SOUTH_ROW_Y },
  { kind: 'hut', x: 28, y: MARKET_SOUTH_ROW_Y },
];

/** Every hand-placed street prop in Pedravale — see each group's comment. Placed on the plazas' own paving or on the grass beside a street (stamped to paving). */
const MAIN_CITY_PROPS: Array<{ kind: BuildingKind; x: number; y: number }> = [
  // Praça da Fundação: each one tile south of its NPC spot above.
  { kind: 'shrine', x: 3, y: 4 },
  { kind: 'noticeboard', x: 8, y: 4 },
  { kind: 'well', x: 3, y: 7 },
  { kind: 'banner', x: 8, y: 7 },
  // The old-town gate, from the street side, and the courier's parcels.
  { kind: 'banner', x: 5, y: 9 },
  { kind: 'banner', x: 8, y: 9 },
  { kind: 'crates', x: 8, y: 12 },
  // Street lamps down the long street (clear of the lots the procedural
  // pass builds on along it — see its `blocked` list above).
  { kind: 'lamp', x: 5, y: 11 },
  { kind: 'lamp', x: 8, y: 14 },
  { kind: 'lamp', x: 5, y: 17 },
  // Praça do Mercado: gateway banners, the central fountain ringed by lamps,
  // a block of market stalls, the lookout's campfire.
  { kind: 'banner', x: 5, y: 21 },
  { kind: 'banner', x: 8, y: 21 },
  { kind: 'fountain', x: 15, y: 25 },
  { kind: 'lamp', x: 13, y: 24 },
  { kind: 'lamp', x: 19, y: 24 },
  { kind: 'lamp', x: 13, y: 28 },
  { kind: 'lamp', x: 19, y: 28 },
  { kind: 'stall', x: 4, y: 27 },
  { kind: 'stall', x: 6, y: 27 },
  { kind: 'stall', x: 8, y: 27 },
  { kind: 'stall', x: 4, y: 30 },
  { kind: 'stall', x: 6, y: 30 },
  { kind: 'stall', x: 8, y: 30 },
  { kind: 'stall', x: 22, y: 28 },
  { kind: 'stall', x: 24, y: 28 },
  { kind: 'stall', x: 26, y: 28 },
  { kind: 'crates', x: 28, y: 29 },
  { kind: 'campfire', x: 28, y: 23 },
  { kind: 'crates', x: 26, y: 24 },
  // The market square's south edge: the inn's and warehouse's goods, and the
  // banners marking the lane down to the crafts street.
  { kind: 'crates', x: 11, y: MARKET_SOUTH_ROW_Y - 1 },
  { kind: 'crates', x: 26, y: MARKET_SOUTH_ROW_Y - 1 },
  { kind: 'banner', x: MAIN_CITY_CRAFTS_LANE.x0 - 1, y: MAIN_CITY_CRAFTS_LANE.y0 },
  { kind: 'banner', x: MAIN_CITY_CRAFTS_LANE.x1 + 1, y: MAIN_CITY_CRAFTS_LANE.y0 },
  // Lamps down the lane, across the green.
  { kind: 'lamp', x: MAIN_CITY_CRAFTS_LANE.x1 + 1, y: MAIN_CITY_CRAFTS_LANE.y0 + 3 },
  { kind: 'lamp', x: MAIN_CITY_CRAFTS_LANE.x0 - 1, y: MAIN_CITY_CRAFTS_LANE.y0 + 6 },
  // Rua dos Ofícios: lamps in the gaps between storefronts, and across the street.
  { kind: 'lamp', x: 7, y: CRAFTS_SHOP_ROW_Y - 1 },
  { kind: 'lamp', x: 13, y: CRAFTS_SHOP_ROW_Y - 1 },
  { kind: 'lamp', x: 19, y: CRAFTS_SHOP_ROW_Y - 1 },
  { kind: 'lamp', x: 25, y: CRAFTS_SHOP_ROW_Y - 1 },
  { kind: 'lamp', x: 11, y: MAIN_CITY_CRAFTS_STREET.y0 - 1 },
  { kind: 'lamp', x: 22, y: MAIN_CITY_CRAFTS_STREET.y0 - 1 },
  // The crafts street's two ends, marked like the square's own entrances.
  { kind: 'banner', x: MAIN_CITY_CRAFTS_STREET.x0, y: MAIN_CITY_CRAFTS_STREET.y0 - 1 },
  { kind: 'banner', x: MAIN_CITY_CRAFTS_STREET.x1, y: MAIN_CITY_CRAFTS_STREET.y0 - 1 },
];

function rectOf(p: { kind: BuildingKind; x: number; y: number }): TileRect {
  return { x: p.x, y: p.y, ...BUILDING_FOOTPRINTS[p.kind] };
}

function carveRect(tiles: TileType[][], x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y][x] = TileType.Path;
}

/**
 * Places one hand-placed building or prop at a fixed spot: only onto open
 * ground (grass, or a plaza's own paving — never water, a tree or another
 * placement), then stamps its footprint to paving like every other
 * placement so nothing generated afterwards lands on it.
 */
function placeFixed(
  tiles: TileType[][],
  placed: BuildingPlacement[],
  kind: BuildingKind,
  x: number,
  y: number,
  signage?: Signage,
): BuildingPlacement | null {
  const { w, h } = BUILDING_FOOTPRINTS[kind];
  if (x < 1 || y < 1 || x + w > tiles[0].length - 1 || y + h > tiles.length - 1) return null;
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const t = tiles[y + dy][x + dx];
      if (t !== TileType.Grass && t !== TileType.Path) return null;
    }
  }
  if (tooCloseToPlaced(x, y, w, h, placed, 0)) return null;
  stampFootprint(tiles, x, y, w, h);
  const placement: BuildingPlacement = signage ? { kind, x, y, w, h, signage } : { kind, x, y, w, h };
  placed.push(placement);
  return placement;
}

/**
 * Builds a proper (if small) city: an old-town plaza in the top-left corner
 * (unchanged in absolute position/size across the whole game's life so far),
 * connected by a long paved street to a much bigger new downtown plaza, the
 * crafts street one block south of that, plus a walled gate leading out to
 * each class's territory. Pedravale's NPCs stand at the named spots and
 * storefronts this lays out (MAIN_CITY_SPOTS / MAIN_CITY_SHOPS above).
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
  // (its NPC spots and the zone's own spawn tile, 5,5, sit inside it).
  const { x0: villageX0, y0: villageY0, x1: villageX1, y1: villageY1 } = MAIN_CITY_OLD_TOWN_BOUNDS;
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
  for (let y = villageY1 + 1; y <= villageY1 + STREET_LENGTH; y++) {
    tiles[y][6] = TileType.Path;
    tiles[y][7] = TileType.Path;
  }
  // ...opening onto a much bigger downtown plaza, Pedravale's real town
  // square — the bulk of the main city's buildings line this and the gates.
  const { x0: plazaX0, x1: plazaX1, y0: plazaY0, y1: plazaY1 } = MAIN_CITY_DOWNTOWN_BOUNDS;
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
  // The crafts district is reserved (kept clear with the usual 1-tile
  // clearance) and every hand-placed prop/NPC spot blocked, so the
  // procedural pass can't take a storefront's lot or wall in a street prop;
  // see placeBuildingsAlongPaths on why neither reshuffles the rest of the map.
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
    [MAIN_CITY_CRAFTS_DISTRICT],
    [...MAIN_CITY_PROPS.map(rectOf), ...Object.values(MAIN_CITY_SPOTS).map((s) => ({ x: s.x, y: s.y, w: 1, h: 1 }))],
  );

  // Pedravale's hand-placed layer, after the procedural pass (so it never
  // lines these with random buildings of its own) but before the tree
  // scatter (so no tree lands on any of it): the crafts street and its lane,
  // every named storefront with its paved apron, the block buildings
  // between the market square and the crafts street, and the street props.
  const lane = MAIN_CITY_CRAFTS_LANE;
  const craftsStreet = MAIN_CITY_CRAFTS_STREET;
  carveRect(tiles, lane.x0, lane.y0, lane.x1, lane.y1);
  carveRect(tiles, craftsStreet.x0, craftsStreet.y0, craftsStreet.x1, craftsStreet.y1);
  for (const shop of Object.values(MAIN_CITY_SHOPS)) {
    carveRect(tiles, shop.apron.x, shop.apron.y, shop.apron.x + shop.apron.w - 1, shop.apron.y + shop.apron.h - 1);
    placeFixed(tiles, buildings, 'shop', shop.x, shop.y, shop.signage);
  }
  for (const b of MAIN_CITY_BLOCK_BUILDINGS) placeFixed(tiles, buildings, b.kind, b.x, b.y);
  for (const p of MAIN_CITY_PROPS) placeFixed(tiles, buildings, p.kind, p.x, p.y);
  // Every NPC spot is guaranteed open paving, even the ones off the plazas.
  for (const spot of Object.values(MAIN_CITY_SPOTS)) tiles[spot.y][spot.x] = TileType.Path;

  // Scattered trees across the field — count scaled up with the map's area
  // (roughly 9x the old 80x48 map, same proportional-to-area approach as
  // the previous resize) so the bigger field doesn't read as barer than
  // before; buildings/roads/plaza/pond above are already Path/Water so
  // the Grass-only check here leaves every one of them untouched.
  // The crafts district's green stays a tended lawn (see
  // MAIN_CITY_CRAFTS_STREET on why nothing tall may stand there) — skipped
  // after drawing both coordinates, so the scatter everywhere else is exactly
  // what it would have been.
  const d = MAIN_CITY_CRAFTS_DISTRICT;
  for (let i = 0; i < 2300; i++) {
    const x = 1 + Math.floor(rand() * (MAP_WIDTH - 2));
    const y = 1 + Math.floor(rand() * (MAP_HEIGHT - 2));
    const inCraftsDistrict = x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h;
    if (tiles[y][x] === TileType.Grass && !inCraftsDistrict) {
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

  // Dress the town square itself, which is otherwise bare paving: lamp
  // posts near its corners, a well, banners flanking each gate opening, and
  // (developed villages only) a fountain north-west of the center. All on the
  // clearing's own paving, after the street pass and never on its center
  // tile (the zone's spawn) or the north/south road column; placeFixed
  // skips anything that wouldn't fit (a small test-sized village).
  const lampDx = vw - 3;
  const lampDy = vh - 3;
  const squareProps: Array<{ kind: BuildingKind; x: number; y: number }> = [
    { kind: 'lamp', x: cx - lampDx, y: cy - lampDy },
    { kind: 'lamp', x: cx + lampDx, y: cy - lampDy },
    { kind: 'lamp', x: cx - lampDx, y: cy + lampDy },
    { kind: 'lamp', x: cx + lampDx, y: cy + lampDy },
    { kind: 'well', x: cx + Math.ceil(vw / 2), y: cy + Math.ceil(vh / 2) - 1 },
    { kind: 'crates', x: cx + Math.ceil(vw / 2) + 1, y: cy + Math.ceil(vh / 2) - 1 },
  ];
  if (opts.hasSouthGate) squareProps.push({ kind: 'banner', x: cx - 1, y: cy + vh - 1 }, { kind: 'banner', x: cx + 1, y: cy + vh - 1 });
  if (opts.hasNorthGate) squareProps.push({ kind: 'banner', x: cx - 1, y: cy - vh + 1 }, { kind: 'banner', x: cx + 1, y: cy - vh + 1 });
  if (opts.development === 'developed') squareProps.push({ kind: 'fountain', x: cx - 5, y: cy - Math.max(3, vh - 4) });
  for (const p of squareProps) placeFixed(tiles, buildings, p.kind, p.x, p.y);

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
