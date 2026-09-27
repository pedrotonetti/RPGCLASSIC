import { TILE_SIZE } from '../config/gameConfig';
import { CLASS_ZONE_THEMES, getClassZoneTheme } from './classZones';
import { DUNGEON_DEFINITIONS } from './dungeons';
import {
  generateDungeonMap,
  generateOverworldMap,
  generateVillageMap,
  mainCityArrivalTile,
  MAIN_CITY_CRAFTS_BOUNDS,
  MAIN_CITY_DOWNTOWN_BOUNDS,
  MAIN_CITY_GATES,
  MAIN_CITY_OLD_TOWN_BOUNDS,
  type GeneratedMap,
} from '../systems/MapGenerator';

export const MAIN_CITY_ID = 'main_city';

export interface ZoneExit {
  /** Tile the player must stand on to trigger the transition. */
  atTile: { x: number; y: number };
  toZone: string;
  /** World-space tile to arrive at in the destination zone. */
  arriveTile: { x: number; y: number };
}

export interface ZoneDefinition {
  id: string;
  name: string;
  generate: () => GeneratedMap;
  exits: ZoneExit[];
  /** Ground tint for this zone — lets each class's territory (and the main city) read as visually distinct. */
  accentColor: number;
  /** Enemy ids this zone's monsters are drawn from. Omit to use the level-weighted main city pool. */
  monsterIds?: string[];
  monsterCount: number;
  /**
   * Character level this zone is meant for — shown on the world map (see
   * ui/worldMapLayout.ts) as a soft guide, never an enforced gate, exactly
   * like `DungeonDefinition.recommendedLevel` at a dungeon's portal. Nothing
   * in this game hard-gates entering a zone by level. Set only on the
   * regional settlements so far.
   */
  recommendedLevel?: number;
  /**
   * Set for a dungeon instance's own linear-corridor zone (see
   * `data/dungeons.ts`) — when present, `OverworldScreen` spawns this
   * dungeon's fixed encounter pods and boss (via
   * `OverworldCombat.spawnDungeonEncounters`) instead of the usual random
   * `spawnMonsters` scatter, and shows the encounter-progress/boss-banner HUD.
   */
  dungeonId?: string;
  /**
   * The `WorldState.zoneStates[this.id]` value (see `systems/WorldStateSystem.ts`)
   * that marks this zone's own threat as resolved by story progress — a
   * quest's `onCompleteEffect.zoneState` is what actually sets it (see
   * data/quests.ts). Once reached, `effectiveMonsterCount` below halves this
   * zone's monster density; a zone with no `resolvedState` never reacts.
   */
  resolvedState?: string;
}

/**
 * `zone.monsterCount`, halved once `zoneState` (see `getZoneState`) matches
 * `zone.resolvedState` — the one demonstrable "reactive zone" payoff for
 * now: a settlement whose threat a quest chain resolved visibly calms down,
 * rather than `WorldState.zoneStates` staying a write-only ledger. Only
 * `OverworldScreen.mount`'s non-dungeon spawn path calls this.
 */
export function effectiveMonsterCount(zone: ZoneDefinition, zoneState: string | null): number {
  if (zone.resolvedState && zoneState === zone.resolvedState) return Math.round(zone.monsterCount * 0.5);
  return zone.monsterCount;
}

const MAIN_CITY_ACCENT = 0x4c8a3f; // the field's usual grass green — no special tint for the shared hub

// Roughly doubled from the original 18x14 / 24x18 so every class's territory
// gets a real village/town footprint instead of a cramped walled pen — see
// MapGenerator.ts's own doubled MAP_WIDTH/MAP_HEIGHT for the main city.
// Hoisted here (instead of each being a literal re-typed in both
// buildClassVillageZones and mainCityExits, as they used to be) so the two
// can never drift out of sync with each other again.
// Was 36x28/48x36 — widened ~3x per axis (~9x area), matching the main
// city's own resize in MapGenerator.ts. Every exit/arrival tile below is
// computed from these constants (Math.floor(width/2), height-3, etc.), not
// hardcoded, so they stay correct automatically; only the elder/mentor NPC
// positions (data/npcs.ts) needed an explicit fix, via the new
// villageClearingBounds export, since those WERE hardcoded absolute tiles.
export const START_VILLAGE_SIZE = { width: 110, height: 85 };
export const SECONDARY_VILLAGE_SIZE = { width: 145, height: 110 };

function buildClassVillageZones(): Record<string, ZoneDefinition> {
  const zones: Record<string, ZoneDefinition> = {};

  CLASS_ZONE_THEMES.forEach((theme, i) => {
    const startSeed = 4000 + i;
    const secondarySeed = 5000 + i;
    const startSize = START_VILLAGE_SIZE;
    const secondarySize = SECONDARY_VILLAGE_SIZE;

    const startArrive = { x: Math.floor(startSize.width / 2), y: startSize.height - 3 };
    const secondaryArriveFromStart = { x: Math.floor(secondarySize.width / 2), y: 2 };
    const cityArrive = mainCityArrivalTile(theme.classId);

    zones[theme.startVillageId] = {
      id: theme.startVillageId,
      name: theme.startVillageName,
      accentColor: theme.accentColor,
      monsterIds: theme.startMonsters,
      monsterCount: 30,
      generate: () =>
        generateVillageMap({ ...startSize, seed: startSeed, hasNorthGate: false, hasSouthGate: true, treeCount: 480, development: 'sparse' }),
      exits: [
        {
          atTile: { x: Math.floor(startSize.width / 2), y: startSize.height - 1 },
          toZone: theme.secondaryVillageId,
          arriveTile: secondaryArriveFromStart,
        },
      ],
    };

    zones[theme.secondaryVillageId] = {
      id: theme.secondaryVillageId,
      name: theme.secondaryVillageName,
      accentColor: theme.accentColor,
      monsterIds: theme.secondaryMonsters,
      monsterCount: 45,
      generate: () =>
        generateVillageMap({ ...secondarySize, seed: secondarySeed, hasNorthGate: true, hasSouthGate: true, treeCount: 700, development: 'developed' }),
      exits: [
        { atTile: { x: Math.floor(secondarySize.width / 2), y: 0 }, toZone: theme.startVillageId, arriveTile: startArrive },
        { atTile: { x: Math.floor(secondarySize.width / 2), y: secondarySize.height - 1 }, toZone: MAIN_CITY_ID, arriveTile: cityArrive },
      ],
    };
  });

  return zones;
}

/**
 * Settlements that belong to no single class — every class reaches them
 * the same way, from Pedravale, instead of through its own territory. Each
 * is an ordinary `ZoneDefinition` built from the same `generateVillageMap`
 * every class village uses (see buildRegionalSettlementZones), with one road
 * (its north gate) back to its own gate on Pedravale's border — see
 * MapGenerator's MAIN_CITY_REGIONAL_GATES, keyed by this same `zoneId`.
 *
 *  - 'satellite': a small settlement just outside Pedravale itself, for a
 *    character who has reached the city but not gone far past it yet.
 *  - 'hub': a regional hub further out — the first place with real content
 *    past the current story's own climax.
 *
 * Monster pools reuse existing `data/enemies.ts` ids only, picked by each
 * enemy's own `level` tier. The difficulty lever here is density (see
 * config/balance.ts: a single same-level trash mob is a short fight, a pair
 * costs a real chunk of HP, a pack of three is genuinely dangerous), set
 * against each class village's own ~1 monster per ~310-350 tiles:
 *
 *  - Ancoradouro do Vau: skeleton/giant_spider/orc/fire_elemental (tiers
 *    6-9) — one step past the tier 3-8 pools every class's secondary village
 *    fields, right for the roughly level 8-14 character who has just reached
 *    Pedravale. ~1 per 260 tiles: a little busier than a class village, so
 *    pairs happen, but still mostly single fights.
 *  - Baluarte do Amanhecer: fire_elemental/troll/stone_golem (tiers 9-11),
 *    the three toughest regular enemies in the game. `young_dragon` is
 *    deliberately left out: it's `isBoss` (boss HP curve, boss banner, boss
 *    loot odds) and it IS the story's own one-of-a-kind corrupted guardian
 *    (q6_dragon) — scattering dozens of them would cheapen that fight and
 *    flood the HUD with boss banners. The regular tiers top out at 11, below
 *    a level-20+ character, so this zone leans on density instead: ~1 per 245
 *    tiles, the densest open-world field in the game (still no more monsters
 *    in total than Pedravale's own 65), so pairs and packs of three — the
 *    fights config/balance.ts measured as genuinely dangerous — are routine
 *    here instead of occasional.
 */
export type RegionalSettlementKind = 'satellite' | 'hub';

export interface RegionalSettlement {
  /** This settlement's zone id — also its own gate's id in MapGenerator's MAIN_CITY_GATES. */
  zoneId: string;
  name: string;
  kind: RegionalSettlementKind;
  /** See ZoneDefinition.recommendedLevel — a soft guide only. */
  recommendedLevel: number;
  size: { width: number; height: number };
  /** Must not collide with any other generated map's seed (class villages 4000-4007/5000-5007, dungeons 9001+, Pedravale 1337). */
  seed: number;
  treeCount: number;
  development: 'sparse' | 'developed';
  accentColor: number;
  monsterIds: string[];
  monsterCount: number;
  /** See ZoneDefinition.resolvedState. */
  resolvedState?: string;
}

export const ANCORADOURO_VAU_ID = 'ancoradouro_vau';
export const BALUARTE_AMANHECER_ID = 'baluarte_amanhecer';

export const REGIONAL_SETTLEMENTS: RegionalSettlement[] = [
  {
    zoneId: ANCORADOURO_VAU_ID,
    name: 'Ancoradouro do Vau',
    kind: 'satellite',
    recommendedLevel: 8,
    // Smaller than even a class's starting village — a hamlet, not a town.
    size: { width: 90, height: 70 },
    seed: 6001,
    treeCount: 330,
    development: 'sparse',
    // Dry river-clay ochre: the ford this hamlet was built on has all but
    // dried up under the Sede (see its NPCs in data/npcs.ts).
    accentColor: 0xb3925a,
    monsterIds: ['skeleton', 'giant_spider', 'orc', 'fire_elemental'],
    monsterCount: 24,
  },
  {
    zoneId: BALUARTE_AMANHECER_ID,
    name: 'Baluarte do Amanhecer',
    kind: 'hub',
    recommendedLevel: 20,
    size: { width: 140, height: 105 },
    seed: 6002,
    // Denser than any class village (~6% of tiles vs ~4.5-5%): the forest
    // is still pressing in on a fort nobody has kept up for generations.
    treeCount: 900,
    // 'developed' for its landmark tower (the bastion's watchtower) and its
    // square's fountain; everything else about it is a frontier outpost.
    development: 'developed',
    // A cold rose dawn — muted to a dusty, ashen green on the ground.
    accentColor: 0xc98bb0,
    monsterIds: ['fire_elemental', 'troll', 'stone_golem'],
    monsterCount: 60,
    // Set by baluarte_r3_cisterna's onCompleteEffect (data/quests.ts) — the
    // bastion's own three-quest chain ends on holding the cistern against
    // the drought-colossi, so its threat visibly recedes once that's done.
    resolvedState: 'reerguido',
  },
];

export function getRegionalSettlement(zoneId: string): RegionalSettlement {
  const found = REGIONAL_SETTLEMENTS.find((s) => s.zoneId === zoneId);
  if (!found) throw new Error(`Assentamento regional desconhecido: ${zoneId}`);
  return found;
}

/** Where someone arriving from Pedravale lands in a regional settlement: just inside its north gate. */
function regionalArrivalTile(settlement: RegionalSettlement): { x: number; y: number } {
  return { x: Math.floor(settlement.size.width / 2), y: 2 };
}

function buildRegionalSettlementZones(): Record<string, ZoneDefinition> {
  const zones: Record<string, ZoneDefinition> = {};
  for (const s of REGIONAL_SETTLEMENTS) {
    zones[s.zoneId] = {
      id: s.zoneId,
      name: s.name,
      accentColor: s.accentColor,
      monsterIds: s.monsterIds,
      monsterCount: s.monsterCount,
      recommendedLevel: s.recommendedLevel,
      resolvedState: s.resolvedState,
      generate: () =>
        generateVillageMap({ ...s.size, seed: s.seed, hasNorthGate: true, hasSouthGate: false, treeCount: s.treeCount, development: s.development }),
      exits: [{ atTile: { x: Math.floor(s.size.width / 2), y: 0 }, toZone: MAIN_CITY_ID, arriveTile: mainCityArrivalTile(s.zoneId) }],
    };
  }
  return zones;
}

/** Where one of Pedravale's gates leads: a regional settlement (gate id = its zone id) or a class's own secondary village (gate id = that class id). */
function mainCityGateDestination(gateId: string): Pick<ZoneExit, 'toZone' | 'arriveTile'> {
  const settlement = REGIONAL_SETTLEMENTS.find((s) => s.zoneId === gateId);
  if (settlement) return { toZone: settlement.zoneId, arriveTile: regionalArrivalTile(settlement) };
  const theme = getClassZoneTheme(gateId);
  const secondarySize = SECONDARY_VILLAGE_SIZE;
  return { toZone: theme.secondaryVillageId, arriveTile: { x: Math.floor(secondarySize.width / 2), y: secondarySize.height - 3 } };
}

function mainCityExits(): ZoneExit[] {
  return MAIN_CITY_GATES.map((gate) => ({ atTile: { x: gate.x, y: gate.y }, ...mainCityGateDestination(gate.id) }));
}

const CLASS_VILLAGE_ZONES = buildClassVillageZones();
const REGIONAL_SETTLEMENT_ZONES = buildRegionalSettlementZones();

/** A sickly, corrupted-root tint distinct from every village's own accent and from the main city's plain grass green — every dungeon shares it so an instance always reads as "not open-world" the instant it loads. */
const DUNGEON_ACCENT = 0x5a4a6e;

function buildDungeonZones(): Record<string, ZoneDefinition> {
  const zones: Record<string, ZoneDefinition> = {};
  for (const dungeon of DUNGEON_DEFINITIONS) {
    zones[dungeon.zoneId] = {
      id: dungeon.zoneId,
      name: dungeon.name,
      accentColor: DUNGEON_ACCENT,
      generate: () => generateDungeonMap({ seed: dungeon.seed, encounterCount: dungeon.encounters.length }),
      exits: [{ atTile: dungeon.exitTile, toZone: dungeon.portal.hostZoneId, arriveTile: dungeon.portal.arriveTile }],
      // Monsters here are placed at fixed points, not scattered by
      // spawnMonsters — see OverworldScreen.mount's dungeonId branch.
      monsterCount: 0,
      dungeonId: dungeon.id,
    };
  }
  return zones;
}

const DUNGEON_ZONES = buildDungeonZones();

export const ZONE_DEFINITIONS: Record<string, ZoneDefinition> = {
  [MAIN_CITY_ID]: {
    id: MAIN_CITY_ID,
    name: 'Pedravale',
    accentColor: MAIN_CITY_ACCENT,
    generate: () => generateOverworldMap(),
    exits: mainCityExits(),
    monsterCount: 65,
  },
  ...CLASS_VILLAGE_ZONES,
  ...REGIONAL_SETTLEMENT_ZONES,
  ...DUNGEON_ZONES,
};

export function getZoneById(id: string): ZoneDefinition {
  const found = ZONE_DEFINITIONS[id];
  if (!found) throw new Error(`Zona desconhecida: ${id}`);
  return found;
}

export function startZoneForClass(classId: string): string {
  return getClassZoneTheme(classId).startVillageId;
}

/** World-space (not tile) position for a zone's arrival tile — the center of that tile. */
export function arriveWorldPosition(arriveTile: { x: number; y: number }): { x: number; z: number } {
  return { x: arriveTile.x * TILE_SIZE + TILE_SIZE / 2, z: arriveTile.y * TILE_SIZE + TILE_SIZE / 2 };
}

/**
 * The main city's two named plazas surfaced so far only through NPC
 * dialogue (see the archivist's and guard's lines in `data/npcs.ts`) —
 * "Praça da Fundação" (the old-town square) and "Praça do Mercado" (the
 * newer downtown one) — plus "o Verdegal", the name Zaya's dialogue gives
 * the wider field/forest surrounding Pedravale out to where each class's own
 * territory begins. Bounds are read straight from MapGenerator's own layout
 * constants (never duplicated here) so this can't drift out of sync with
 * the actual generated map.
 */
function withinBounds(b: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;
}

/**
 * The zone's own settlement/sub-area name for a given tile — used by the
 * minimap's location label. Every zone falls back to its plain
 * `ZoneDefinition.name`; only the main city currently subdivides further,
 * since it's the one zone whose own NPCs name distinct plazas within it.
 */
export function subAreaNameAt(zoneId: string, tileX: number, tileY: number): string {
  const zone = getZoneById(zoneId);
  if (zoneId === MAIN_CITY_ID) {
    if (withinBounds(MAIN_CITY_OLD_TOWN_BOUNDS, tileX, tileY)) return 'Praça da Fundação';
    if (withinBounds(MAIN_CITY_DOWNTOWN_BOUNDS, tileX, tileY)) return 'Praça do Mercado';
    if (withinBounds(MAIN_CITY_CRAFTS_BOUNDS, tileX, tileY)) return 'Rua dos Ofícios';
    return 'o Verdegal';
  }
  return zone.name;
}
