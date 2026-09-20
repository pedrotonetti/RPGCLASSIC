import type { EnemyDefinition, ItemRarity } from '../config/types';
import { dungeonLayout } from '../systems/MapGenerator';
import { getBossById } from './bosses';

/**
 * Diablo/PW-style dungeon instances: a fixed-location entrance portal on the
 * overworld, a linear corridor of hand-placed monster pods (see
 * `MapGenerator.generateDungeonMap`), and a named boss at the end. Separate
 * from the open-world `ZoneDefinition`s in `zones.ts` in spirit, but built
 * ON TOP of the same zone/exit machinery — `zones.ts` registers each
 * dungeon's `zoneId` as a normal `ZoneDefinition` so movement, collision, the
 * camera and `ZoneExit` all just work unchanged; only the fixed entrance
 * portal and the fixed (non-random) monster placement are dungeon-specific,
 * both handled in `OverworldScreen`/`OverworldCombat`.
 *
 * Adding a new dungeon means adding one `buildDungeon(...)` entry below —
 * no new code path, per the "diversify" part of the brief.
 */

/** One pod of monsters placed at a fixed point along the corridor — one entry in `enemyIds` spawns one monster. */
export interface DungeonEncounter {
  atTile: { x: number; y: number };
  enemyIds: string[];
}

export interface DungeonPortal {
  /** Which existing overworld zone hosts this dungeon's fixed entrance — see zones.ts. */
  hostZoneId: string;
  /** Fixed tile position of the entrance structure in that zone, always in the same place. */
  atTile: { x: number; y: number };
  /** Tile in the host zone the player arrives at when walking back out through the dungeon's own exit. */
  arriveTile: { x: number; y: number };
}

export interface DungeonBossRef {
  enemyId: string;
  /** An existing `data/enemies.ts` id whose 3D shape (see `render/characterModel.buildEnemyModel`) to reuse for the boss's model — the boss's own `enemyId` is never registered there, so it needs a stand-in silhouette. */
  visualId: string;
}

export interface DungeonDefinition {
  id: string;
  name: string;
  description: string;
  tier: 'early' | 'mid' | 'late';
  /** Shown to the player at the portal — a soft guide, not an enforced gate. */
  recommendedLevel: number;
  portal: DungeonPortal;
  /** This dungeon's own linear-corridor instance zone id, registered in zones.ts. */
  zoneId: string;
  seed: number;
  encounters: DungeonEncounter[];
  boss: DungeonBossRef;
  bossTile: { x: number; y: number };
  playerStart: { x: number; y: number };
  exitTile: { x: number; y: number };
  /**
   * Guaranteed bonus gold granted on TOP of the boss's own
   * `EnemyDefinition.goldReward`/`xpReward` (already paid out through the
   * ordinary combat-victory path, same as any monster) — this plus
   * `rewardItem` is the "instance clear" payoff that's meaningfully better
   * than an open-world kill, per the design brief.
   */
  bonusGold: number;
  rewardItem: { templateId: string; rarity: ItemRarity };
}

interface DungeonBlueprint {
  id: string;
  name: string;
  description: string;
  tier: DungeonDefinition['tier'];
  recommendedLevel: number;
  portalAtTile: { x: number; y: number };
  seed: number;
  /** One array per fixed encounter chamber, entrance-to-boss order; one enemy id per monster in that pod. */
  encounterEnemyIds: string[][];
  bossEnemyId: string;
  bossVisualId: string;
  bonusGold: number;
  rewardItem: { templateId: string; rarity: ItemRarity };
}

// Matches `data/zones.ts`'s own MAIN_CITY_ID constant. Kept as a literal
// (not an import) so this module never depends on zones.ts — zones.ts is the
// one that imports DUNGEON_DEFINITIONS to register each dungeon's own
// ZoneDefinition and its portal's host, so importing back from here would be
// a circular module dependency.
const MAIN_CITY_ID = 'main_city';

function buildDungeon(bp: DungeonBlueprint): DungeonDefinition {
  const layout = dungeonLayout(bp.encounterEnemyIds.length);
  return {
    id: bp.id,
    name: bp.name,
    description: bp.description,
    tier: bp.tier,
    recommendedLevel: bp.recommendedLevel,
    portal: {
      hostZoneId: MAIN_CITY_ID,
      atTile: bp.portalAtTile,
      arriveTile: { x: bp.portalAtTile.x, y: bp.portalAtTile.y + 2 },
    },
    zoneId: `dungeon_${bp.id}`,
    seed: bp.seed,
    encounters: bp.encounterEnemyIds.map((enemyIds, i) => ({ atTile: layout.encounterTiles[i], enemyIds })),
    boss: { enemyId: bp.bossEnemyId, visualId: bp.bossVisualId },
    bossTile: layout.bossTile,
    playerStart: layout.playerStart,
    exitTile: layout.exitTile,
    bonusGold: bp.bonusGold,
    rewardItem: bp.rewardItem,
  };
}

/**
 * Three dungeons spanning early/mid/late game, all entered from Pedravale
 * (every class passes through it, so a fixed portal there is reachable by
 * everyone without needing eight separate copies). See `data/bosses.ts` for
 * each boss's full stat/skill sheet.
 */
export const DUNGEON_DEFINITIONS: DungeonDefinition[] = [
  buildDungeon({
    id: 'root_hollow',
    name: 'Toca das Raízes Sussurrantes',
    description:
      'Uma fenda recém-aberta na borda de Pedravale, de onde vêm sussurros que ninguém consegue traduzir. Perfeita para um Vozeiro ainda novo provar sua voz.',
    tier: 'early',
    recommendedLevel: 6,
    portalAtTile: { x: 24, y: 6 },
    seed: 9001,
    encounterEnemyIds: [
      ['slime', 'slime'],
      ['bat', 'slime'],
      ['goblin', 'bat'],
    ],
    bossEnemyId: 'boss_root_ooze',
    bossVisualId: 'slime',
    bonusGold: 60,
    rewardItem: { templateId: 'amuleto_vitalidade', rarity: 'azul' },
  }),
  buildDungeon({
    id: 'rotten_sap_gallery',
    name: 'Galeria da Seiva Podre',
    description:
      'Um poço de raízes que já serviu Pedravale antes de secar. A Sede o reabriu por dentro, e agora ele desce bem mais fundo do que antes.',
    tier: 'mid',
    recommendedLevel: 11,
    portalAtTile: { x: 60, y: 35 },
    seed: 9002,
    encounterEnemyIds: [
      ['goblin', 'goblin'],
      ['bandit', 'dark_wolf'],
      ['skeleton', 'skeleton', 'bat'],
      ['giant_spider', 'bandit'],
    ],
    bossEnemyId: 'boss_bark_warden',
    bossVisualId: 'stone_golem',
    bonusGold: 140,
    rewardItem: { templateId: 'bracelete_arcano', rarity: 'amarelo' },
  }),
  buildDungeon({
    id: 'silent_root_rift',
    name: 'Fenda da Raiz Silenciosa',
    description:
      'O Guardião-Dragão Corrompido não vigiava só as ruínas — vigiava o que havia embaixo delas. Agora que ele caiu, a fenda está aberta.',
    tier: 'late',
    recommendedLevel: 16,
    portalAtTile: { x: 45, y: 30 },
    seed: 9003,
    encounterEnemyIds: [
      ['orc', 'orc'],
      ['fire_elemental', 'skeleton'],
      ['troll'],
      ['stone_golem', 'orc'],
      ['fire_elemental', 'fire_elemental'],
    ],
    bossEnemyId: 'boss_voiceless_root',
    bossVisualId: 'young_dragon',
    bonusGold: 320,
    rewardItem: { templateId: 'talisma_velocidade', rarity: 'laranja' },
  }),
];

export function getDungeonById(id: string): DungeonDefinition {
  const found = DUNGEON_DEFINITIONS.find((d) => d.id === id);
  if (!found) throw new Error(`Instância desconhecida: ${id}`);
  return found;
}

export function getDungeonByZoneId(zoneId: string): DungeonDefinition | undefined {
  return DUNGEON_DEFINITIONS.find((d) => d.zoneId === zoneId);
}

/** Every dungeon whose fixed portal lives in the given overworld zone — what `OverworldScreen` renders portals for. */
export function dungeonsInHostZone(hostZoneId: string): DungeonDefinition[] {
  return DUNGEON_DEFINITIONS.filter((d) => d.portal.hostZoneId === hostZoneId);
}

/** Resolves a dungeon's boss `EnemyDefinition` — callers don't need to import `data/bosses.ts` directly. */
export function getDungeonBossDefinition(dungeon: DungeonDefinition): EnemyDefinition {
  const def = getBossById(dungeon.boss.enemyId);
  if (!def) throw new Error(`Chefe desconhecido para a instância ${dungeon.id}: ${dungeon.boss.enemyId}`);
  return def;
}
