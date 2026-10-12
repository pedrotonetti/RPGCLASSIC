import * as THREE from 'three';
import { getClassById } from '../config/classes';
import { TILE_SIZE } from '../config/gameConfig';
import { TileType } from '../config/tiles';
import type { ClassMechanicDefinition, SkillDefinition, SkillTarget } from '../config/types';
import type { Game } from '../engine/Game';
import { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { getItemById, ITEM_DEFINITIONS } from '../data/items';
import { DEFAULT_PACK_WEIGHTS } from '../data/zones';
import { buildEnemyModel } from '../render/characterModel';
import { applyRareLook } from '../render/rareVariant';
import type { CharacterAnimatorLike, ActionName } from '../render/animation';
import { HELD_MESHES, DEFAULT_CLASS } from '../render/playerAvatar';
import { VfxManager, hitImpactColor } from '../render/vfx';
import { adaptiveModifiers, recordFight, shiftPackWeights, type AdaptiveModifiers } from './AdaptiveDifficulty';
import { recordEnemyDefeated, recordEnemyEngaged } from './AchievementSystem';
import { BLOCK_COOLDOWN, CombatEngine, DODGE_COOLDOWN, ITEM_COOLDOWN, type CombatEvent } from './CombatSystem';
import { audio } from './AudioSystem';
import { combatFeel, damagePopupStyle, hitSeverity } from './combatFeel';
import { CLASS_METER_MAX, FLOW_MAX_LEVEL, comboLabel } from './classMechanics';
import { archetypeProfileFor, chaseSpeedMultiplierFor } from './enemyArchetypes';
import { computeSkillLevelStats } from './skillMath';
import { activeStatusTypes, applyStatusEffect } from './statusEffects';
import type { DungeonRoomKind } from '../data/dungeonRooms';
import { pickEncounterEnemyIds } from './EncounterSystem';
import { pickSpawnPoints, rollPackSize, type TileRect } from './monsterSpawning';
import { notifyEnemyDefeated, notifyLevelChanged } from './QuestSystem';
import {
  RARE_MODEL_SCALE,
  RARE_TIER_MULTIPLIER,
  pityAfterFailedMountRoll,
  pityAfterKill,
  rareEncountersUnlocked,
  rarePrefixFor,
  rollRareLoot,
  rollRareSpawn,
} from './RareEncounterSystem';
import { incrementCounter } from './WorldStateSystem';
import { saveGame } from './SaveSystem';
import { el } from '../ui/dom';

/**
 * Monsters now live physically in the overworld — wandering near their spawn
 * point, noticing the player and closing in, and fighting right where they
 * stand — instead of being invisible dice rolls that teleport the player
 * into a separate battle arena. This module owns everything that used to be
 * BattleScreen: it spawns/AI-drives the monster models directly into
 * OverworldScreen's own scene, and builds the same combat HUD (hotbar,
 * enemy health bars, floating text) but shows/hides it as fights start and
 * end instead of swapping the whole screen.
 */

type MonsterState = 'idle' | 'chase' | 'engaged' | 'dead';

interface WorldMonster {
  enemy: Enemy;
  model: THREE.Group;
  baseScale: number;
  spawnX: number;
  spawnZ: number;
  state: MonsterState;
  wanderTarget: THREE.Vector2 | null;
  waitTimer: number;
  flashTime: number;
  respawnAt: number;
  labelEl: HTMLElement;
  hpFillEl: HTMLElement;
  /** Set for a dungeon's own fixed monster pods (see spawnDungeonEncounters) and for a world event's invasion band (see spawnEventBand) — never respawns once dead, matching an instance run being one-and-done per visit. */
  noRespawn?: boolean;
  /** Set only for a world event's band (systems/EventSystem.ts) — lets the event count, point at and despawn its monsters as a unit. */
  eventGroupId?: string;
  /** Index into this dungeon run's `encounters` array — every monster sharing one index belongs to the same fixed pod. */
  dungeonEncounterIndex?: number;
  /** The one boss monster of a dungeon run, if any. */
  isDungeonBoss?: boolean;
  /** Multiplies chase speed — a dungeon Distorção (Frenesi das Raízes); unset = 1. */
  chaseSpeedMult?: number;
  /** Stronger "Ancestral"/"Fulgente" spawn (RareEncounterSystem); reverts to ordinary on respawn. */
  variant?: 'rare';
  nameEl: HTMLElement;
  restoreLook?: () => void;
  /** Fase 7 hit flash: seconds left of the white silhouette (see beginHitFlash). 0 / undefined = not flashing. */
  hitFlashTime?: number;
  /** The meshes swapped to HIT_FLASH_MATERIAL and their real materials, reused between flashes so a hit doesn't allocate fresh arrays. */
  flashMeshes?: THREE.Mesh[];
  flashOriginals?: Array<THREE.Material | THREE.Material[]>;
  /** Fase 7 knockback: a short spring-back nudge away from the player, applied as a temporary offset (never a permanent displacement). */
  knockbackTime?: number;
  knockbackDirX?: number;
  knockbackDirZ?: number;
  knockbackAmp?: number;
  knockbackOffX?: number;
  knockbackOffZ?: number;
}

/**
 * One shared unlit material every hit-flashing enemy borrows for a couple of
 * frames — module-level and never disposed on purpose: it is a single
 * constant material reused for the whole session (like a palette), so
 * there's nothing per-zone to leak, and creating/disposing one per flash
 * would mean a shader recompile on every hit.
 */
const HIT_FLASH_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xfff4e0 });
const HIT_FLASH_DURATION = 0.07;
const KNOCKBACK_DURATION = 0.2;

/** One fixed-position monster pod along a dungeon's corridor — see spawnDungeonEncounters. */
export interface DungeonEncounterSpawn {
  atTile: { x: number; y: number };
  enemyIds: string[];
}

/** The one boss spawn of a dungeon run — see spawnDungeonEncounters. */
export interface DungeonBossSpawn {
  atTile: { x: number; y: number };
  enemyId: string;
  /** Existing enemy id whose 3D shape to reuse for the boss's model (see data/dungeons.ts's own doc comment on this). */
  visualId: string;
}

/**
 * Dungeons 2.0 run rules for spawnDungeonEncounters — the combined Distorções
 * (see systems/DungeonModifierSystem.ts) plus the run's room layout (see
 * systems/DungeonRoomSystem.ts). Every field is optional; omitted = the old
 * behavior.
 */
export interface DungeonSpawnRules {
  /** Per encounter index: 'shrine'/'trap' rooms spawn no monsters, 'elite' rooms spawn tougher "Elite" monsters. */
  roomKinds?: DungeonRoomKind[];
  /** Extra stat multiplier for an elite room's monsters (on top of tier + Distorções). */
  eliteStatMult?: number;
  enemyStatMult?: number;
  enemyActionIntervalMult?: number;
  enemyChaseSpeedMult?: number;
  /** A regular monster dying deals this share of the player's max HP (never lethal) and optionally burns. */
  deathBurst?: { maxHpPct: number; burn: boolean } | null;
}

export interface DungeonCombatHooks {
  /** Fired the instant every monster in one fixed pod is dead (never twice for the same index). */
  onEncounterCleared: (index: number) => void;
  /** Fired the instant the dungeon's boss dies — the caller already knows which boss from its own DungeonDefinition. */
  onBossDefeated: () => void;
}

interface HotbarSlot {
  skill: SkillDefinition;
  totalCooldown: number;
  cost: number;
  el: HTMLElement;
  fillEl: HTMLElement;
}

interface ItemHotbarSlot {
  itemId: string;
  el: HTMLElement;
  fillEl: HTMLElement;
  countEl: HTMLElement;
}

/**
 * Which of a class's own skillKinds get a travelling `launchProjectile`
 * instead of the shared instant hit-impact burst alone — mage/necromancer/
 * cleric cast a magic bolt, archer looses an arrow; everyone else (warrior/
 * paladin/assassin/monk) is a melee class, and gets `spawnMeleeSlash`
 * (see `showTargetImpact`) instead of a floating projectile.
 */
const RANGED_STYLE_BY_CLASS: Partial<Record<string, 'bolt' | 'arrow'>> = {
  mage: 'bolt',
  necromancer: 'bolt',
  cleric: 'bolt',
  archer: 'arrow',
};
/** Roughly when the cast/attack clip's hands (or bow) actually extend, not the very start of its wind-up — see `tryUseSkill`. */
const PROJECTILE_LAUNCH_DELAY_MS = 120;
/** Short and readable — a fireball that took a full second to cross a fight this size would read as sluggish, not weighty. */
const PROJECTILE_FLIGHT_DURATION = 0.3;

const FLASH_DURATION = 0.16;
const MONSTER_COUNT = 12;
const MIN_SPAWN_DIST_FROM_START = 6; // tiles
const MIN_SPAWN_SPACING = 5; // tiles
const AGGRO_RADIUS = 3.4;
const DEAGGRO_RADIUS = 6.0;
const ATTACK_RANGE = 1.15;
/** How far the player can retreat from every engaged monster before combat auto-ends — bigger than ATTACK_RANGE so backing off one step doesn't instantly re-trigger it. */
const ENGAGE_LEASH_RANGE = 4.0;
const CHASE_BASE_SPEED = 1.1;
const CHASE_SPEED_PER_STAT = 0.06;
const WANDER_RADIUS = 1.8;
const WANDER_SPEED = 0.55;
const RESPAWN_DELAY = 22; // seconds
/**
 * A respawn due while the player stands this close (world units) to the
 * spawn point waits RESPAWN_RETRY_DELAY more seconds instead — with bands
 * now respawning together, popping a whole pack back in right on top of
 * someone still looting the spot would be an ambush nobody could see coming.
 */
const RESPAWN_PLAYER_CLEARANCE = 7;
const RESPAWN_RETRY_DELAY = 4;
/**
 * Where each member of a band stands around its shared spawn point (world
 * units). Kept inside ±0.8 so the whole band stays on its anchor tile (half
 * a tile is 1 world unit) — an anchor is picked as grass, its neighbours
 * aren't guaranteed to be.
 */
const PACK_OFFSETS: Array<{ dx: number; dz: number }> = [
  { dx: 0, dz: 0 },
  { dx: 0.7, dz: 0.25 },
  { dx: -0.6, dz: 0.4 },
  { dx: 0.15, dz: -0.7 },
  { dx: -0.55, dz: -0.5 },
];
const LABEL_VISIBLE_DISTANCE = 13; // world units — roughly where the scene fog starts hiding things anyway
/** Fires the class ability (Golpe Selvagem / Milagre da Fé / Dreno das Almas) — "R" for "recurso". Unbound anywhere else during combat (OverworldScreen only reads E/M/Escape/WASD/arrows). */
const CLASS_ABILITY_KEY = 'r';

/** Owns every monster on the map (model + simple AI) and the combat HUD that appears while the player is fighting one. */
export class OverworldCombat {
  private monsters: WorldMonster[] = [];
  private engine: CombatEngine | null = null;
  private engagedMonsters: WorldMonster[] = [];
  private clock = 0;

  private hotbar: HotbarSlot[] = [];
  private itemHotbar: ItemHotbarSlot[] = [];
  private hotbarEl: HTMLElement | null = null;
  private itemBarEl: HTMLElement | null = null;
  private messageEl!: HTMLElement;
  private comboEl!: HTMLElement;
  private blockFillEl!: HTMLElement;
  private dodgeFillEl!: HTMLElement;
  private messageHideAt = 0;
  private hudBuilt = false;

  /** This player's class mechanic (see config/classes.ts / classMechanics.ts), resolved once — a player's class never changes within one OverworldCombat. */
  private readonly classMechanic: ClassMechanicDefinition | undefined;
  /**
   * Persistent class-resource panel (Fúria/Precisão/Fé/Almas bar, or the
   * monk's Fluxo level) — built once in `ensureBaseHud`, then mounted INTO
   * each fight's hotbar element (absolutely positioned just above its slots,
   * so it tracks however many rows the hotbar wraps to) and detached along
   * with it at fight end. Null for a class without a mechanic.
   */
  private classMeterEl: HTMLElement | null = null;
  private classMeterFillEl: HTMLElement | null = null;
  private classMeterValueEl: HTMLElement | null = null;
  /** This fight's class-ability hotbar button — only for mechanics with an active ability (warrior/cleric/necromancer). */
  private classAbilityBtnEl: HTMLElement | null = null;
  /** Last-rendered state of the class panel — skips redundant per-frame DOM writes and detects the "just filled" moment. */
  private lastClassMeterText = '';
  private lastClassMeterReady = false;

  /** Prominent top-of-screen name/health banner shown only while fighting an `isBoss` enemy — distinct from the small per-monster nameplate every wandering monster gets. */
  private bossBannerEl: HTMLElement | null = null;
  private bossBannerNameEl: HTMLElement | null = null;
  private bossBannerFillEl: HTMLElement | null = null;
  private activeBossMonster: WorldMonster | null = null;
  /** Any damage the player took since this fight's engine was created — what "derrote um chefe sem ser atingido" (see AchievementSystem.recordEnemyDefeated) checks. */
  private tookDamageThisFight = false;
  /** This fight's tallies for systems/AdaptiveDifficulty.ts — reset when an engagement starts, recorded when it ends. */
  private fightStartClock = 0;
  private fightDamageTaken = 0;
  private fightPotionsUsed = 0;
  private adaptiveMods: AdaptiveModifiers;

  /** Set only inside a dungeon zone (see OverworldScreen.mount) — lets encounter/boss defeats drive that dungeon's own run-state tracking (DungeonSystem.ts) without OverworldCombat needing to know anything about dungeons itself. */
  private dungeonHooks: DungeonCombatHooks | null = null;
  /** Set alongside `dungeonHooks` for a distorted run — see DungeonSpawnRules.deathBurst. */
  private dungeonDeathBurst: { maxHpPct: number; burn: boolean } | null = null;

  private pendingTargetPick: ((monster: WorldMonster) => void) | null = null;
  private rareEnabled = false;
  private pendingRareNotes: string[] = [];

  /** Status-effect overlays + shared hit/impact and per-class ultimate bursts — see `render/vfx.ts`. */
  private vfx: VfxManager;
  /** A floating anchor (no visible mesh of its own) tracking the player's world position every frame — lets bleed/burn/slow show on the PLAYER too (see `render/vfx.ts`'s own doc comment on reciprocated afflictions) without this module needing a reference to the player's actual avatar model. */
  private playerVfxAnchor: THREE.Object3D;
  /** The camera passed to the latest update() — lets event-driven popups over the player project to screen space without threading it through processEvents. */
  private lastCamera: THREE.Camera | null = null;
  private scratchPopupPos = new THREE.Vector3();
  private playerWorldPos = new THREE.Vector3();

  constructor(
    private game: Game,
    private player: Player,
    private scene: THREE.Scene,
    private animator: CharacterAnimatorLike,
    private onDefeat: () => void,
    /** The player's own real GLTF avatar (`playerAvatar.ts`'s `PlayerAvatar.scene`) — used to snap the caster's facing toward the current target and to find the weapon-tip node a ranged skill's projectile should leave from (see `projectileOrigin`/`faceTarget`). */
    private avatarModel: THREE.Object3D,
  ) {
    this.vfx = new VfxManager(this.scene);
    this.playerVfxAnchor = new THREE.Object3D();
    this.scene.add(this.playerVfxAnchor);
    this.classMechanic = player.classDef.classMechanic;
    this.adaptiveMods = adaptiveModifiers(player.adaptive);
  }

  get inCombat(): boolean {
    return this.engine !== null;
  }

  /**
   * Scatters spawn points on grass tiles across the map, well clear of the
   * player's start, and fields a small band of the same enemy at each one
   * (size rolled from `packWeights` — see data/zones.ts's
   * ZoneDefinition.packWeights). A band's members wander around the same
   * spot, so walking into one pulls the whole band into a single
   * multi-enemy fight (beginEngagement already supports several engaged at
   * once). `enemyIds`, when given, restricts monsters to that pool (a
   * village's own weak/mid field) instead of the main city's level-weighted
   * pool; `minDistFromStart`/`minSpacing` should shrink for small village
   * maps so spawns aren't crowded out entirely; `avoid` keeps spawn points
   * out of a zone's town districts (see data/zones.ts's monsterFreeAreas).
   */
  spawnMonsters(
    tiles: TileType[][],
    startTile: { x: number; y: number },
    opts: {
      count?: number;
      enemyIds?: string[];
      minDistFromStart?: number;
      minSpacing?: number;
      packWeights?: number[];
      avoid?: TileRect[];
      /** Opt in to rare variants on mount and on respawns (RareEncounterSystem). */
      allowRare?: boolean;
    } = {},
  ): void {
    this.ensureBaseHud();

    const points = pickSpawnPoints(
      tiles,
      startTile,
      opts.count ?? MONSTER_COUNT,
      opts.minDistFromStart ?? MIN_SPAWN_DIST_FROM_START,
      opts.minSpacing ?? MIN_SPAWN_SPACING,
      opts.avoid ?? [],
    );
    const weights = shiftPackWeights(opts.packWeights ?? DEFAULT_PACK_WEIGHTS, this.adaptiveMods.packShift);
    for (const p of points) {
      const id = opts.enemyIds ? opts.enemyIds[Math.floor(Math.random() * opts.enemyIds.length)] : pickEncounterEnemyIds(this.player.level)[0];
      const size = Math.min(rollPackSize(weights), PACK_OFFSETS.length);
      for (let i = 0; i < size; i++) {
        const off = PACK_OFFSETS[i];
        this.monsters.push(this.buildMonster(id, p.x + off.dx / TILE_SIZE, p.y + off.dz / TILE_SIZE));
      }
    }
    if (opts.allowRare) {
      this.rareEnabled = true;
      this.rollRareOnMount();
    }
  }

  // Prefers a solo/pair so the elite doesn't drag a whole band in; a miss still feeds the pity counter.
  private rollRareOnMount(): void {
    if (!rareEncountersUnlocked(this.player.level)) return;
    if (!rollRareSpawn(this.player.zoneId, this.player.rarePity, 'mount')) {
      this.player.rarePity = pityAfterFailedMountRoll(this.player.rarePity);
      return;
    }
    const alive = this.monsters.filter((m) => m.state !== 'dead');
    const packmates = (m: WorldMonster) => alive.filter((o) => o !== m && Math.hypot(o.spawnX - m.spawnX, o.spawnZ - m.spawnZ) < 2.5).length;
    const loose = alive.filter((m) => packmates(m) <= 1);
    const pool = loose.length > 0 ? loose : alive;
    if (pool.length === 0) return;
    this.applyRareVariant(pool[Math.floor(Math.random() * pool.length)]);
    this.showMessage('Algo ancestral desperta nesta região — procure o brilho dourado.', 4200);
  }

  private applyRareVariant(m: WorldMonster): void {
    this.endHitFlash(m);
    const id = m.enemy.definitionId;
    m.variant = 'rare';
    m.enemy = new Enemy(id, RARE_TIER_MULTIPLIER, rarePrefixFor(id));
    m.baseScale *= RARE_MODEL_SCALE;
    m.model.scale.setScalar(m.baseScale);
    m.restoreLook = applyRareLook(m.model);
    m.nameEl.textContent = m.enemy.name;
    m.labelEl.classList.add('rare');
    this.setMonsterHp(m, m.enemy.stats.maxHp);
  }

  private clearRareVariant(m: WorldMonster): void {
    this.endHitFlash(m);
    m.variant = undefined;
    m.baseScale /= RARE_MODEL_SCALE;
    m.model.scale.setScalar(m.baseScale);
    m.restoreLook?.();
    m.restoreLook = undefined;
    m.labelEl.classList.remove('rare');
  }

  /**
   * Places a dungeon's monsters at FIXED points along its corridor instead
   * of `spawnMonsters`'s random scatter — a few enemies per encounter
   * clustered tightly around that pod's tile, plus one boss in the arena.
   * None of these ever respawn (an instance run is one-and-done per visit —
   * leaving and re-entering rebuilds the whole zone, and with it a fresh
   * run, from scratch anyway). `hooks` drives that dungeon's own
   * `DungeonSystem` run-state as each pod (and finally the boss) falls.
   */
  /**
   * `tierMultiplier` scales every spawned monster's (and the boss's) stats,
   * XP/gold reward and loot-tier signal — see `Enemy`'s own `tierMultiplier`
   * and `DungeonTierSystem.dungeonTierStatMultiplier`. 1 for a first-time
   * (or ordinary tier-1) run, so nothing here changes from before unless the
   * caller picked a higher tier at the portal.
   */
  spawnDungeonEncounters(encounters: DungeonEncounterSpawn[], boss: DungeonBossSpawn, hooks: DungeonCombatHooks, tierMultiplier = 1, rules: DungeonSpawnRules = {}): void {
    this.ensureBaseHud();
    this.dungeonHooks = hooks;
    this.dungeonDeathBurst = rules.deathBurst ?? null;
    const statMult = tierMultiplier * (rules.enemyStatMult ?? 1);
    const actionIntervalMult = rules.enemyActionIntervalMult ?? 1;
    const chaseSpeedMult = rules.enemyChaseSpeedMult ?? 1;

    // Small fixed offsets (world units) so a pod's monsters fan out instead
    // of stacking exactly on top of one another.
    const GROUP_OFFSETS: Array<{ dx: number; dy: number }> = [
      { dx: 0, dy: 0 },
      { dx: 0.45, dy: 0.15 },
      { dx: -0.45, dy: 0.15 },
      { dx: 0.25, dy: -0.4 },
      { dx: -0.25, dy: -0.4 },
    ];
    encounters.forEach((encounter, index) => {
      const kind = rules.roomKinds?.[index] ?? 'combat';
      if (kind === 'shrine' || kind === 'trap') return;
      const elite = kind === 'elite';
      encounter.enemyIds.forEach((enemyId, slot) => {
        const off = GROUP_OFFSETS[slot % GROUP_OFFSETS.length];
        const m = this.buildMonster(enemyId, encounter.atTile.x + off.dx / TILE_SIZE, encounter.atTile.y + off.dy / TILE_SIZE, {
          tierMultiplier: elite ? statMult * (rules.eliteStatMult ?? 1) : statMult,
          namePrefix: elite ? 'Elite' : undefined,
          scale: elite ? 1.25 : undefined,
          actionIntervalMult,
        });
        m.dungeonEncounterIndex = index;
        m.noRespawn = true;
        m.chaseSpeedMult = chaseSpeedMult;
        if (elite) m.labelEl.classList.add('elite');
        this.monsters.push(m);
      });
    });

    const bossMonster = this.buildMonster(boss.enemyId, boss.atTile.x, boss.atTile.y, { visualId: boss.visualId, scale: 1.6, tierMultiplier: statMult, actionIntervalMult });
    bossMonster.isDungeonBoss = true;
    bossMonster.noRespawn = true;
    bossMonster.chaseSpeedMult = chaseSpeedMult;
    this.monsters.push(bossMonster);
  }

  /**
   * Places a single, hand-picked monster at a fixed overworld tile — a
   * "must be sought out" encounter at a distinctive, memorable spot, as
   * opposed to spawnMonsters' anonymous random scatter. Reuses the exact
   * same buildMonster/AI lifecycle as any other wandering monster
   * (idle/chase/engage/respawn); the only difference from a normal monster
   * is that its spawn point is chosen by hand instead of picked at random.
   */
  spawnFixedMonster(enemyId: string, atTile: { x: number; y: number }, opts: { variant?: 'rare' } = {}): void {
    this.ensureBaseHud();
    this.monsters.push(this.buildMonster(enemyId, atTile.x, atTile.y, opts));
  }

  /** A temporary band for a world event (an invasion): same monsters/AI as spawnMonsters' bands, fanned around `atTile`, but they never respawn and can be counted/despawned by `groupId`. */
  spawnEventBand(groupId: string, enemyIds: string[], atTile: { x: number; y: number }): void {
    this.ensureBaseHud();
    enemyIds.forEach((enemyId, i) => {
      const off = PACK_OFFSETS[i % PACK_OFFSETS.length];
      const m = this.buildMonster(enemyId, atTile.x + off.dx / TILE_SIZE, atTile.y + off.dz / TILE_SIZE);
      m.noRespawn = true;
      m.eventGroupId = groupId;
      this.monsters.push(m);
    });
  }

  /** World-space (x,z) of every still-alive monster of an event band — empty once the band is beaten (or was never spawned). */
  eventBandPositions(groupId: string): Array<{ x: number; z: number }> {
    return this.monsters.filter((m) => m.eventGroupId === groupId && m.state !== 'dead').map((m) => ({ x: m.model.position.x, z: m.model.position.z }));
  }

  /** Removes an event band's monsters (dead or alive) from the world. A monster mid-fight is left alone — the caller only despawns while out of combat. */
  despawnEventBand(groupId: string): void {
    this.monsters = this.monsters.filter((m) => {
      if (m.eventGroupId !== groupId || m.state === 'engaged') return true;
      this.scene.remove(m.model);
      m.labelEl.remove();
      return false;
    });
  }

  private ensureBaseHud(): void {
    if (this.hudBuilt) return;
    this.hudBuilt = true;
    this.messageEl = el('div', { className: 'panel battle-message-bar' });
    this.messageEl.hidden = true;
    this.comboEl = el('div', { className: 'combo-badge' });
    this.comboEl.hidden = true;
    this.bossBannerNameEl = el('div', { className: 'boss-banner-name' });
    this.bossBannerFillEl = el('div', { className: 'boss-banner-hp-fill' });
    this.bossBannerEl = el('div', { className: 'boss-banner' }, [
      this.bossBannerNameEl,
      el('div', { className: 'boss-banner-hp-bg' }, [this.bossBannerFillEl]),
    ]);
    this.bossBannerEl.hidden = true;
    this.game.uiRoot.append(this.messageEl, this.comboEl, this.bossBannerEl);
    this.buildClassMeter();
  }

  /**
   * The class-resource panel (see `classMeterEl`): a name + value line over a
   * bar that fills UP as the resource grows (width-based, like the boss
   * banner's HP bar — the opposite of the hotbar's draining cooldown
   * overlays). For the monk's `combo` mechanic it shows the Fluxo level
   * instead, over a segmented bar. The mechanic's own description is its
   * tooltip/aria-label, so the HUD element itself explains what it does.
   */
  private buildClassMeter(): void {
    const mechanic = this.classMechanic;
    if (!mechanic) return;
    this.classMeterFillEl = el('div', { className: 'class-meter-fill' });
    this.classMeterValueEl = el('span', { className: 'class-meter-value' });
    this.classMeterEl = el(
      'div',
      {
        className: `class-meter mech-${mechanic.id} kind-${mechanic.kind}`,
        attrs: {
          title: mechanic.description,
          'aria-label': `${mechanic.name}: ${mechanic.description}`,
          role: 'meter',
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuenow': '0',
        },
      },
      [
        el('div', { className: 'class-meter-label' }, [el('span', { className: 'class-meter-name', text: mechanic.name }), this.classMeterValueEl]),
        el('div', { className: 'class-meter-bg' }, [this.classMeterFillEl]),
      ],
    );
    this.classMeterEl.hidden = true;

    if (mechanic.kind === 'combo') {
      // The combo badge itself is also relabeled for this class (see
      // refreshCombo) — give it the same explanation for assistive tech.
      this.comboEl.classList.add('flow');
      this.comboEl.setAttribute('aria-label', `${mechanic.name}: ${mechanic.description}`);
      this.comboEl.setAttribute('title', mechanic.description);
    }
  }

  private buildMonster(
    enemyId: string,
    tx: number,
    ty: number,
    opts: { visualId?: string; scale?: number; tierMultiplier?: number; variant?: 'rare'; namePrefix?: string; actionIntervalMult?: number } = {},
  ): WorldMonster {
    const enemy = new Enemy(enemyId, opts.tierMultiplier ?? 1, opts.namePrefix ?? '', opts.actionIntervalMult ?? 1);
    const model = buildEnemyModel(opts.visualId ?? enemyId, enemy.color);
    const spawnX = tx * 2 + 1;
    const spawnZ = ty * 2 + 1;
    const baseScale = opts.scale ?? (enemy.def.isBoss ? 1.15 : 1);
    model.scale.setScalar(baseScale);
    model.position.set(spawnX, enemyId === 'bat' ? 1.0 : 0, spawnZ);
    model.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(model);

    const hpFillEl = el('div', { className: 'enemy-hpbar-fg' });
    const nameEl = el('div', { className: 'ename', text: enemy.name });
    const labelEl = el(
      'div',
      {
        className: `enemy-label world ${enemy.def.isBoss ? 'boss' : ''}`,
        onClick: () => this.onMonsterPicked(monster),
      },
      [nameEl, el('div', { className: 'enemy-hpbar-bg' }, [hpFillEl])],
    );
    labelEl.hidden = true;
    this.game.uiRoot.append(labelEl);

    const monster: WorldMonster = {
      enemy,
      model,
      baseScale,
      spawnX,
      spawnZ,
      state: 'idle',
      wanderTarget: null,
      waitTimer: 1 + Math.random() * 3,
      flashTime: 0,
      respawnAt: -1,
      labelEl,
      hpFillEl,
      nameEl,
    };
    if (opts.variant === 'rare') this.applyRareVariant(monster);
    return monster;
  }

  /** Whether the player is currently in an active fight — used to gate passive HP regen, which should only apply while out of combat. */
  isEngaged(): boolean {
    return this.engine !== null;
  }

  /** World-space (x,z) of every currently-alive monster in this zone — read by OverworldScreen's minimap to draw a marker per live enemy instance. Cheap: at most a few dozen monsters per zone, called once a frame. */
  aliveMonsterPositions(): Array<{ x: number; z: number }> {
    return this.monsters.filter((m) => m.state !== 'dead').map((m) => ({ x: m.model.position.x, z: m.model.position.z }));
  }

  /**
   * World-space (x,z) of the nearest currently-alive monster matching
   * `enemyId` (any alive monster if omitted), or null if none exist — read
   * by OverworldScreen's quest-follow indicator to point at a concrete
   * "defeat" objective target. Reuses the same live `monsters` list
   * `aliveMonsterPositions` already tracks; equally cheap.
   */
  nearestAliveMonsterPosition(from: { x: number; z: number }, enemyId?: string): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null;
    let bestDistSq = Infinity;
    for (const m of this.monsters) {
      if (m.state === 'dead') continue;
      if (enemyId && m.enemy.definitionId !== enemyId) continue;
      const dx = m.model.position.x - from.x;
      const dz = m.model.position.z - from.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = { x: m.model.position.x, z: m.model.position.z };
      }
    }
    return best;
  }

  /** Advances monster AI, the active fight (if any), and refreshes all combat HUD elements. Call every frame. */
  update(dt: number, playerPos: THREE.Vector3, camera: THREE.Camera): void {
    this.clock += dt;
    this.lastCamera = camera;
    this.playerWorldPos.copy(playerPos);
    this.playerVfxAnchor.position.set(playerPos.x, playerPos.y + 1.1, playerPos.z);

    for (const m of this.monsters) {
      this.updateMonster(m, dt, playerPos);
    }
    this.updateLabels(camera, playerPos);

    if (this.engine) {
      const stillInRange = this.engagedMonsters.some(
        (m) => Math.hypot(playerPos.x - m.model.position.x, playerPos.z - m.model.position.z) <= ENGAGE_LEASH_RANGE,
      );
      if (!stillInRange) {
        // Walked away without winning or losing — combat (and its hotbar)
        // should end here instead of staying on screen indefinitely; nothing
        // previously checked distance once a fight had started.
        this.endEngagement('fled');
      } else {
        const events = this.engine.tick(dt);
        this.processEvents(events);
        this.refreshHotbarCooldowns();
        this.refreshCombo();
        this.refreshClassResource();
        this.refreshStatusOverlays();
        if (this.engine.outcome !== 'ongoing') this.endEngagement(this.engine.outcome);
      }
    }

    this.vfx.update(dt, this.clock);

    if (this.messageHideAt > 0 && this.clock >= this.messageHideAt) {
      this.messageEl.hidden = true;
      this.messageHideAt = 0;
    }
  }

  /** Keeps every engaged monster's and the player's own bleed/burn/slow overlay in sync with their current status effects — see `render/vfx.ts`. */
  private refreshStatusOverlays(): void {
    for (const m of this.engagedMonsters) {
      this.vfx.syncStatusOverlay(m.model, activeStatusTypes(m.enemy), { radius: 0.3 * m.baseScale, height: 1.0 * m.baseScale });
    }
    this.vfx.syncStatusOverlay(this.playerVfxAnchor, activeStatusTypes(this.player), { radius: 0.28, height: 0.9 });
  }

  private updateMonster(m: WorldMonster, dt: number, playerPos: THREE.Vector3): void {
    if (m.state === 'dead') {
      if (m.respawnAt >= 0 && this.clock >= m.respawnAt) {
        if (Math.hypot(playerPos.x - m.spawnX, playerPos.z - m.spawnZ) < RESPAWN_PLAYER_CLEARANCE) {
          m.respawnAt = this.clock + RESPAWN_RETRY_DELAY;
        } else {
          this.respawnMonster(m);
        }
      }
      return;
    }
    if (m.flashTime > 0) {
      m.flashTime = Math.max(0, m.flashTime - dt);
      m.model.scale.setScalar(m.baseScale * (1 + 0.15 * (m.flashTime / FLASH_DURATION)));
    }
    if (m.hitFlashTime && m.hitFlashTime > 0) {
      m.hitFlashTime = Math.max(0, m.hitFlashTime - dt);
      if (m.hitFlashTime === 0) this.endHitFlash(m);
    }
    if (m.knockbackTime && m.knockbackTime > 0) this.updateKnockback(m, dt);

    const dx = playerPos.x - m.model.position.x;
    const dz = playerPos.z - m.model.position.z;
    const dist = Math.hypot(dx, dz);

    if (m.state === 'engaged') {
      m.model.rotation.y = Math.atan2(dx, dz);
      return;
    }

    if (dist <= ATTACK_RANGE) {
      this.beginEngagement(m);
      return;
    }

    // Each archetype's own aggro/deaggro reach and chase pace (see
    // systems/enemyArchetypes.ts) — a plain multiplier on this file's own
    // existing constants, so an enemy with no archetype behaves exactly as
    // before (every multiplier defaults to 1).
    const profile = archetypeProfileFor(m.enemy.archetype);
    const aggroRadius = AGGRO_RADIUS * profile.aggroRadiusMult * this.adaptiveMods.aggroRadiusMult;
    const deaggroRadius = DEAGGRO_RADIUS * profile.deaggroRadiusMult;

    if (dist <= aggroRadius) {
      m.state = 'chase';
    } else if (m.state === 'chase' && dist > deaggroRadius) {
      m.state = 'idle';
      m.wanderTarget = null;
    }

    if (m.state === 'chase') {
      const playerHpFraction = this.player.currentHp / this.player.stats.maxHp;
      const speed = (CHASE_BASE_SPEED + m.enemy.stats.speed * CHASE_SPEED_PER_STAT) * profile.chaseSpeedMult * chaseSpeedMultiplierFor(profile, playerHpFraction) * (m.chaseSpeedMult ?? 1);
      m.model.position.x += (dx / dist) * speed * dt;
      m.model.position.z += (dz / dist) * speed * dt;
      m.model.rotation.y = Math.atan2(dx, dz);
      return;
    }

    // Idle: wander a little around the spawn point so the world feels alive
    // without monsters roaming far from where they were placed.
    if (!m.wanderTarget) {
      m.waitTimer -= dt;
      if (m.waitTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const r = 0.5 + Math.random() * WANDER_RADIUS;
        m.wanderTarget = new THREE.Vector2(m.spawnX + Math.cos(angle) * r, m.spawnZ + Math.sin(angle) * r);
      }
      return;
    }
    const tx = m.wanderTarget.x - m.model.position.x;
    const tz = m.wanderTarget.y - m.model.position.z;
    const td = Math.hypot(tx, tz);
    if (td < 0.08) {
      m.wanderTarget = null;
      m.waitTimer = 2 + Math.random() * 4;
      return;
    }
    m.model.position.x += (tx / td) * WANDER_SPEED * dt;
    m.model.position.z += (tz / td) * WANDER_SPEED * dt;
    m.model.rotation.y = Math.atan2(tx, tz);
  }

  // --- Fase 7: hit flash / knockback -------------------------------------

  /** Swaps every mesh of `m` to the shared white flash material for HIT_FLASH_DURATION — the classic "it got hit" silhouette blink. Restored by endHitFlash. */
  private beginHitFlash(m: WorldMonster): void {
    if (m.state === 'dead') return;
    if (m.hitFlashTime && m.hitFlashTime > 0) {
      m.hitFlashTime = HIT_FLASH_DURATION;
      return;
    }
    const meshes = (m.flashMeshes ??= []);
    const originals = (m.flashOriginals ??= []);
    meshes.length = 0;
    originals.length = 0;
    m.model.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes.push(mesh);
      originals.push(mesh.material);
      mesh.material = HIT_FLASH_MATERIAL;
    });
    m.hitFlashTime = HIT_FLASH_DURATION;
  }

  /** Puts every mesh's real material back — safe to call when not flashing. Must run before anything else swaps materials (applyRareLook / its restore). */
  private endHitFlash(m: WorldMonster): void {
    m.hitFlashTime = 0;
    const meshes = m.flashMeshes;
    const originals = m.flashOriginals;
    if (!meshes || !originals || meshes.length === 0) return;
    for (let i = 0; i < meshes.length; i++) meshes[i].material = originals[i];
    meshes.length = 0;
    originals.length = 0;
  }

  /** Starts a small spring-back shove away from the player, scaled by how heavy the hit was. Skipped under "Reduzir movimento". */
  private beginKnockback(m: WorldMonster, severity: number, crit: boolean): void {
    if (combatFeel.settings.reduceMotion || m.state === 'dead') return;
    if (severity < 0.12 && !crit) return;
    // Settle any shove still in flight first so its offset is never orphaned.
    if (m.knockbackTime && m.knockbackTime > 0) this.updateKnockback(m, m.knockbackTime);
    const dx = m.model.position.x - this.playerWorldPos.x;
    const dz = m.model.position.z - this.playerWorldPos.z;
    const d = Math.hypot(dx, dz) || 1;
    m.knockbackDirX = dx / d;
    m.knockbackDirZ = dz / d;
    m.knockbackAmp = Math.min(0.32, 0.12 + severity * 0.5 + (crit ? 0.06 : 0)) / Math.max(1, m.baseScale);
    m.knockbackOffX = 0;
    m.knockbackOffZ = 0;
    m.knockbackTime = KNOCKBACK_DURATION;
  }

  /** Applies this frame's knockback offset as a delta from the last one, so the monster ends exactly where it would have been without the shove. */
  private updateKnockback(m: WorldMonster, dt: number): void {
    const t = Math.max(0, (m.knockbackTime ?? 0) - dt);
    m.knockbackTime = t;
    const progress = 1 - t / KNOCKBACK_DURATION; // 0..1
    // Fast out, eased back: peaks 30% in, back to exactly 0 at the end.
    const env = t === 0 ? 0 : progress < 0.3 ? progress / 0.3 : 1 - (progress - 0.3) / 0.7;
    const amp = (m.knockbackAmp ?? 0) * Math.max(0, env);
    const nx = (m.knockbackDirX ?? 0) * amp;
    const nz = (m.knockbackDirZ ?? 0) * amp;
    m.model.position.x += nx - (m.knockbackOffX ?? 0);
    m.model.position.z += nz - (m.knockbackOffZ ?? 0);
    m.knockbackOffX = nx;
    m.knockbackOffZ = nz;
  }

  private respawnMonster(m: WorldMonster): void {
    if (m.variant === 'rare') this.clearRareVariant(m);
    m.enemy = new Enemy(m.enemy.definitionId);
    m.nameEl.textContent = m.enemy.name;
    m.model.position.set(m.spawnX, m.enemy.definitionId === 'bat' ? 1.0 : 0, m.spawnZ);
    m.model.visible = true;
    m.labelEl.classList.remove('defeated');
    m.state = 'idle';
    m.waitTimer = 1 + Math.random() * 3;
    m.respawnAt = -1;
    // One rare alive at a time, never mid-fight.
    if (this.rareEnabled && rareEncountersUnlocked(this.player.level) && !this.engine && !this.monsters.some((o) => o.variant === 'rare' && o.state !== 'dead') && rollRareSpawn(this.player.zoneId, this.player.rarePity, 'respawn')) {
      this.applyRareVariant(m);
      this.showMessage('Algo ancestral desperta nesta região — procure o brilho dourado.', 4200);
    }
    // The HP bar's width is only ever set by setMonsterHp, which so far had
    // only ever run from the damage-event handler — so the near-empty width
    // left over from the moment this same monster died stuck around through
    // the respawn (a freshly full Enemy behind a bar that still reads
    // "almost dead") until the player's first hit forced a fresh call.
    this.setMonsterHp(m, m.enemy.stats.maxHp);
  }

  private updateLabels(camera: THREE.Camera, playerPos: THREE.Vector3): void {
    for (const m of this.monsters) {
      if (m.state === 'dead') {
        m.labelEl.hidden = true;
        continue;
      }
      // A screen-space projection alone doesn't account for distance — a
      // monster on the far side of the map can still project to an on-screen
      // pixel if the camera happens to face roughly its direction, showing
      // its nameplate full-size with nothing visibly there. Only label
      // monsters actually close enough to matter (and to be visible before
      // the scene fog swallows them).
      const dx = playerPos.x - m.model.position.x;
      const dz = playerPos.z - m.model.position.z;
      if (m.state !== 'engaged' && Math.hypot(dx, dz) > LABEL_VISIBLE_DISTANCE) {
        m.labelEl.hidden = true;
        continue;
      }
      const anchor = this.projectToScreen(
        new THREE.Vector3(m.model.position.x, m.model.position.y + 0.9 * m.baseScale, m.model.position.z),
        camera,
      );
      if (anchor.behind) {
        m.labelEl.hidden = true;
        continue;
      }
      m.labelEl.hidden = false;
      m.labelEl.style.left = `${anchor.x}px`;
      m.labelEl.style.top = `${anchor.y}px`;
    }
  }

  private projectToScreen(pos: THREE.Vector3, camera: THREE.Camera): { x: number; y: number; behind: boolean } {
    const p = pos.clone().project(camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight, behind: p.z > 1 };
  }

  // --- engagement -------------------------------------------------------

  private beginEngagement(m: WorldMonster): void {
    m.state = 'engaged';
    m.labelEl.classList.remove('defeated');
    recordEnemyEngaged(this.player, m.enemy.definitionId);
    if (!this.engine) {
      this.tookDamageThisFight = false;
      this.fightStartClock = this.clock;
      this.fightDamageTaken = 0;
      this.fightPotionsUsed = 0;
      this.engine = new CombatEngine(this.player, []);
      this.buildHotbar();
      this.buildItemBar();
    }
    this.engine.enemies.push(m.enemy);
    this.engagedMonsters.push(m);

    if (m.enemy.def.isBoss && this.bossBannerEl && this.bossBannerNameEl && this.bossBannerFillEl) {
      this.activeBossMonster = m;
      this.bossBannerNameEl.textContent = m.enemy.name;
      this.bossBannerFillEl.style.width = '100%';
      this.bossBannerEl.hidden = false;
    }
  }

  private endEngagement(outcome: 'victory' | 'defeat' | 'fled'): void {
    if (outcome !== 'fled') {
      recordFight(this.player.adaptive, {
        died: outcome === 'defeat',
        hpLost: this.fightDamageTaken / Math.max(1, this.player.stats.maxHp),
        potions: this.fightPotionsUsed,
        seconds: this.clock - this.fightStartClock,
      });
      this.adaptiveMods = adaptiveModifiers(this.player.adaptive);
    }
    const rareNotes = this.pendingRareNotes.splice(0);
    if (outcome === 'victory') {
      let lastMessage: string | null = null;
      for (const m of this.engagedMonsters) {
        const msg = notifyEnemyDefeated(this.player, m.enemy.definitionId);
        if (msg) lastMessage = msg;
        recordEnemyDefeated(this.player, m.enemy.definitionId, { flawless: !this.tookDamageThisFight });
      }
      const levelMsg = notifyLevelChanged(this.player);
      if (levelMsg) lastMessage = levelMsg;
      if (rareNotes.length > 0) lastMessage = [lastMessage, ...rareNotes].filter(Boolean).join('\n');
      if (lastMessage) this.showMessage(lastMessage, rareNotes.length > 0 ? 3600 : 2200);
      saveGame(this.player);
    } else if (outcome === 'defeat') {
      this.showMessage('Você foi levado de volta à vila para se recuperar...', 2200);
      this.onDefeat();
    } else if (rareNotes.length > 0) {
      this.showMessage(rareNotes.join('\n'), 3600);
    }

    this.pendingTargetPick = null;
    for (const m of this.engagedMonsters) {
      if (m.state === 'engaged') {
        // Wasn't killed (fight ended some other way) — let it resume noticing the player normally.
        m.state = 'chase';
      }
      // Status effects are only ever ticked/expired by the (now-discarded)
      // CombatEngine — clearing them here (rather than leaving them frozen
      // forever on a monster that survives the fight, e.g. one the player
      // fled from mid-bleed) and explicitly dropping its VFX overlay too,
      // instead of waiting for a re-engagement that may never come.
      m.enemy.statusEffects = [];
      this.vfx.syncStatusOverlay(m.model, []);
    }
    this.engagedMonsters = [];
    this.player.statusEffects = [];
    this.vfx.syncStatusOverlay(this.playerVfxAnchor, []);
    this.engine = null;
    this.hotbar = [];
    this.itemHotbar = [];
    this.hotbarEl?.remove();
    this.itemBarEl?.remove();
    this.hotbarEl = null;
    this.itemBarEl = null;
    this.comboEl.hidden = true;
    // The class panel was mounted inside the (now removed) hotbar — detach it
    // explicitly too and forget its last-rendered state, so the next fight
    // (whose engine starts every meter back at 0) re-renders it from scratch.
    if (this.classMeterEl) {
      this.classMeterEl.hidden = true;
      this.classMeterEl.remove();
    }
    this.classAbilityBtnEl = null;
    this.lastClassMeterText = '';
    this.lastClassMeterReady = false;
    this.activeBossMonster = null;
    if (this.bossBannerEl) this.bossBannerEl.hidden = true;
  }

  // --- HUD ---------------------------------------------------------------

  private buildHotbar(): void {
    const classDef = getClassById(this.player.classId);
    const skills = [classDef.basicAttack, ...this.player.unlockedSkills.map((u) => u.skill)];

    const blockFillEl = el('div', { className: 'cd-fill' });
    this.blockFillEl = blockFillEl;
    const blockBtn = el('div', { className: 'hotbar-slot block', onClick: () => this.onBlockClicked() }, [
      el('div', { className: 'hotbar-name', text: 'Bloquear' }),
      el('div', { className: 'hotbar-level', text: 'Espaço' }),
      blockFillEl,
    ]);

    const dodgeFillEl = el('div', { className: 'cd-fill' });
    this.dodgeFillEl = dodgeFillEl;
    const dodgeBtn = el('div', { className: 'hotbar-slot dodge', onClick: () => this.onDodgeClicked() }, [
      el('div', { className: 'hotbar-name', text: 'Esquivar' }),
      el('div', { className: 'hotbar-level', text: 'Shift' }),
      dodgeFillEl,
    ]);

    const slotEls: HTMLElement[] = [];
    skills.forEach((skill, i) => {
      const isBasic = skill.id === classDef.basicAttack.id;
      const level = isBasic ? 1 : this.player.skillLevel(skill.id);
      const stats = computeSkillLevelStats(skill, level);
      const cost = this.player.discountedSkillCost(stats.cost);
      const fillEl = el('div', { className: 'cd-fill' });
      const costEl = el('div', { className: 'hotbar-cost', text: cost > 0 ? `MP ${cost}` : '' });
      const keyLabel = i === 0 ? 'Básico' : skill.isUltimate ? 'ULT' : `Nv.${level}`;
      const slotEl = el(
        'div',
        { className: `hotbar-slot ${skill.isUltimate ? 'ultimate' : ''}`, onClick: () => this.onHotbarClicked(skill.id) },
        [el('div', { className: 'hotbar-name', text: skill.name }), el('div', { className: 'hotbar-level', text: keyLabel }), costEl, fillEl],
      );
      slotEls.push(slotEl);
      this.hotbar.push({ skill, totalCooldown: stats.cooldown, cost, el: slotEl, fillEl });
    });

    // Class ability (warrior/cleric/necromancer): appended AFTER dodge/block so
    // it never shifts the numbered skill slots' own indices/keys.
    const mechanic = this.classMechanic;
    const extraSlots: HTMLElement[] = [];
    if (mechanic?.ability && this.engine?.classAbilityTarget()) {
      const ability = mechanic.ability;
      this.classAbilityBtnEl = el(
        'div',
        {
          className: `hotbar-slot class-ability mech-${mechanic.id}`,
          onClick: () => this.onClassAbilityClicked(),
          attrs: { title: ability.description, 'aria-label': `${ability.name} (${CLASS_ABILITY_KEY.toUpperCase()}): ${ability.description}` },
        },
        [
          el('div', { className: 'hotbar-name', text: ability.name }),
          el('div', { className: 'hotbar-level', text: CLASS_ABILITY_KEY.toUpperCase() }),
          el('div', { className: 'hotbar-cost', text: mechanic.name }),
        ],
      );
      extraSlots.push(this.classAbilityBtnEl);
    }

    this.hotbarEl = el('div', { className: 'hotbar' }, [...slotEls, dodgeBtn, blockBtn, ...extraSlots]);
    if (this.classMeterEl) {
      this.hotbarEl.append(this.classMeterEl);
      this.classMeterEl.hidden = false;
    }
    this.game.uiRoot.append(this.hotbarEl);
    this.refreshClassResource();
  }

  private buildItemBar(): void {
    // player.inventory is a shared bag for consumables AND crafting
    // materials/gems (see the vendor.craftMaterialId debit sites in
    // OverworldScreen.ts) — only real ITEM_DEFINITIONS entries belong in the
    // combat item hotbar, so a picked-up material can't crash getItemById.
    const consumableIds = new Set(ITEM_DEFINITIONS.map((i) => i.id));
    const itemIds = Object.keys(this.player.inventory).filter((id) => (this.player.inventory[id] ?? 0) > 0 && consumableIds.has(id));
    if (itemIds.length === 0) return;

    const slotEls: HTMLElement[] = [];
    itemIds.forEach((itemId) => {
      const item = getItemById(itemId);
      const fillEl = el('div', { className: 'cd-fill' });
      const countEl = el('div', { className: 'hotbar-cost', text: `x${this.player.inventory[itemId] ?? 0}` });
      const slotEl = el('div', { className: 'hotbar-slot item', onClick: () => this.onItemClicked(itemId) }, [
        el('div', { className: 'hotbar-name', text: item.name }),
        countEl,
        fillEl,
      ]);
      slotEls.push(slotEl);
      this.itemHotbar.push({ itemId, el: slotEl, fillEl, countEl });
    });

    this.itemBarEl = el('div', { className: 'item-hotbar' }, slotEls);
    this.game.uiRoot.append(this.itemBarEl);
  }

  /** Routed in from OverworldScreen's own keydown handler while a fight is ongoing. */
  handleKeyDown(e: KeyboardEvent): boolean {
    if (!this.engine) return false;
    if (e.key === 'Escape' && this.pendingTargetPick) {
      this.pendingTargetPick = null;
      this.showMessage('Alvo cancelado.', 1500);
      return true;
    }
    if (e.key === ' ') {
      this.onBlockClicked();
      return true;
    }
    if (e.key === 'Shift') {
      this.onDodgeClicked();
      return true;
    }
    if (e.key.toLowerCase() === CLASS_ABILITY_KEY && this.classAbilityBtnEl) {
      this.onClassAbilityClicked();
      return true;
    }
    const num = Number(e.key);
    if (num >= 1 && num <= this.hotbar.length) {
      this.onHotbarClicked(this.hotbar[num - 1].skill.id);
      return true;
    }
    return false;
  }

  private onMonsterPicked(m: WorldMonster): void {
    if (!this.pendingTargetPick || m.state !== 'engaged' || !m.enemy.isAlive()) return;
    const cb = this.pendingTargetPick;
    this.pendingTargetPick = null;
    cb(m);
  }

  private onHotbarClicked(skillId: string): void {
    if (!this.engine) return;
    const skill = this.hotbar.find((h) => h.skill.id === skillId)?.skill;
    if (!skill) return;

    if (skill.target === 'enemy') {
      const alive = this.engagedMonsters.filter((m) => m.enemy.isAlive());
      if (alive.length === 0) return;
      if (alive.length === 1) {
        this.tryUseSkill(skillId, this.engine.enemies.indexOf(alive[0].enemy));
        return;
      }
      this.showMessage(`Escolha o alvo de ${skill.name} (clique em um inimigo)...`, 4000);
      this.pendingTargetPick = (m) => this.tryUseSkill(skillId, this.engine!.enemies.indexOf(m.enemy));
      return;
    }
    this.tryUseSkill(skillId);
  }

  private tryUseSkill(skillId: string, targetIndex?: number): void {
    if (!this.engine) return;
    const skill = this.hotbar.find((h) => h.skill.id === skillId)?.skill ?? null;
    const result = this.engine.useSkill(skillId, targetIndex);
    if (!result.ok) {
      if (result.reason === 'cooldown') this.showMessage('Habilidade ainda em recarga...', 1200);
      else if (result.reason === 'mana') this.showMessage('Mana insuficiente!', 1200);
      return;
    }

    // Snap the caster to actually face whoever this skill is aimed at BEFORE
    // it plays — nothing about ordinary movement-facing (OverworldScreen)
    // ever turns the avatar toward a stationary combat target, so without
    // this a ranged skill's projectile could visibly launch sideways from
    // wherever the avatar last happened to be facing.
    if (skill && (skill.target === 'enemy' || skill.target === 'allEnemies')) this.faceCurrentTarget(targetIndex);

    const action = this.actionForSkill(skillId);
    this.animator.play(action, undefined, { isUltimate: skill?.isUltimate });
    if (action === 'cast') audio.castSpell();
    else audio.attackSwing();

    const rangedStyle = this.rangedStyleForSkill(skill);
    if (rangedStyle) {
      this.fireRangedSkillProjectiles(result.events, rangedStyle);
    } else {
      this.processEvents(result.events);
    }
    if (skill?.isUltimate) this.playUltimateVfx(skill.target, targetIndex);
    this.refreshHotbarCooldowns();
  }

  /** Whether `skill` should get a travelling `launchProjectile` instead of the shared instant hit-impact burst alone — see `RANGED_STYLE_BY_CLASS`. Ultimates are excluded: they already get their own bigger, bespoke burst (`ULTIMATE_BUILDERS`) instead. */
  private rangedStyleForSkill(skill: SkillDefinition | null): 'bolt' | 'arrow' | undefined {
    if (!skill || skill.isUltimate) return undefined;
    if (skill.kind !== 'physical' && skill.kind !== 'magical') return undefined;
    if (skill.target !== 'enemy' && skill.target !== 'allEnemies') return undefined;
    return RANGED_STYLE_BY_CLASS[this.player.classId];
  }

  /** Turns the avatar to face `targetIndex` (or, for a skill with no explicit single target — e.g. one auto-resolved against the sole engaged enemy — the first alive engaged enemy), and drops a brief "target lock" pulse under it. */
  private faceCurrentTarget(targetIndex?: number): void {
    if (!this.engine) return;
    const enemy = targetIndex !== undefined ? this.engine.enemies[targetIndex] : this.engagedMonsters.find((m) => m.enemy.isAlive())?.enemy;
    if (enemy) this.faceTarget(enemy);
  }

  private faceTarget(enemy: Enemy): void {
    const m = this.monsterForEnemy(enemy);
    if (!m) return;
    const dx = m.model.position.x - this.playerWorldPos.x;
    const dz = m.model.position.z - this.playerWorldPos.z;
    if (Math.hypot(dx, dz) > 0.001) this.avatarModel.rotation.y = Math.atan2(dx, dz);
    this.vfx.spawnTargetLock(m.model.position);
  }

  /**
   * The ranged counterpart to `processEvents(result.events)`: the skill's
   * actual hit/damage was already resolved synchronously by
   * `CombatEngine.useSkill` above (this never touches that, or its timing —
   * only how the RESULT is revealed), so this still runs `processEvents`
   * immediately for everything (HP bars, audio, defeated/victory, ...)
   * except each target's own popup + hit-impact burst, which it holds back
   * (`onDeferrableImpact`) and instead fires once a purely cosmetic
   * projectile visibly reaches that target — so the burst reads as the
   * projectile actually connecting instead of popping before it arrives.
   */
  private fireRangedSkillProjectiles(events: CombatEvent[], style: 'bolt' | 'arrow'): void {
    if (!this.engine) {
      this.processEvents(events);
      return;
    }
    const deferredByTarget = new Map<number, Array<() => void>>();
    this.processEvents(events, {
      onDeferrableImpact: (targetIndex, reveal) => {
        const list = deferredByTarget.get(targetIndex);
        if (list) list.push(reveal);
        else deferredByTarget.set(targetIndex, [reveal]);
      },
    });
    if (deferredByTarget.size === 0) return;

    const origin = this.projectileOrigin();
    for (const [targetIndex, reveals] of deferredByTarget) {
      const runReveals = () => reveals.forEach((r) => r());
      const enemy = this.engine.enemies[targetIndex];
      const m = this.monsterForEnemy(enemy);
      if (!m) {
        runReveals();
        continue;
      }
      const to = m.model.position.clone().add(new THREE.Vector3(0, 0.75, 0));
      const color = this.projectileColorForTarget(events, targetIndex);
      setTimeout(() => {
        this.vfx.launchProjectile(origin, to, style, color, PROJECTILE_FLIGHT_DURATION, runReveals);
      }, PROJECTILE_LAUNCH_DELAY_MS);
    }
  }

  /** The color a ranged skill's projectile (and the burst it triggers on arrival) should be, derived from that same skill call's own events for this target — matches whatever `spawnHitImpact` would have picked had it fired instantly. */
  private projectileColorForTarget(events: CombatEvent[], targetIndex: number): number {
    const damageEvent = events.find((e) => e.targetIndex === targetIndex && e.kind === 'damage');
    const statusEvent = events.find((e) => e.targetIndex === targetIndex && e.kind === 'statusApplied');
    return hitImpactColor(damageEvent?.skillKind ?? 'physical', statusEvent?.statusType);
  }

  /** World-space point a ranged skill's projectile should visibly leave from — the class's own socketed-weapon-gem anchor node (`playerAvatar.ts`'s `HELD_MESHES`, e.g. the mage's staff tip), so a fireball actually leaves the staff instead of the avatar's chest/center. Falls back to a rough chest-height point only if that node is somehow missing. */
  private projectileOrigin(): THREE.Vector3 {
    const anchorName = HELD_MESHES[this.player.classId]?.gemAnchor ?? HELD_MESHES[DEFAULT_CLASS].gemAnchor;
    const node = anchorName ? this.avatarModel.getObjectByName(anchorName) : null;
    if (node) return node.getWorldPosition(new THREE.Vector3());
    return this.playerWorldPos.clone().add(new THREE.Vector3(0, 1.1, 0));
  }

  private actionForSkill(skillId: string): ActionName {
    const skill = this.hotbar.find((h) => h.skill.id === skillId)?.skill;
    if (!skill) return 'attack';
    if (skill.kind === 'magical' || skill.kind === 'heal') return 'cast';
    if (skill.kind === 'buff') return 'defend';
    return 'attack';
  }

  /** Plays that class's own bespoke ultimate burst (see `render/vfx.ts`'s `ULTIMATE_BUILDERS`) at every position an ultimate — or a full-meter class ability — actually connected with. */
  private playUltimateVfx(target: SkillTarget, targetIndex?: number): void {
    let positions: THREE.Vector3[];
    if (target === 'self') {
      positions = [this.playerWorldPos.clone()];
    } else if (target === 'allEnemies') {
      positions = this.engagedMonsters.map((m) => m.model.position.clone());
    } else {
      const enemy = this.engine && targetIndex !== undefined ? this.engine.enemies[targetIndex] : undefined;
      const m = enemy ? this.monsterForEnemy(enemy) : undefined;
      positions = m ? [m.model.position.clone()] : [];
    }
    if (positions.length > 0) this.vfx.spawnUltimateVfx(this.player.classId, positions);
  }

  private onItemClicked(itemId: string): void {
    if (!this.engine) return;
    const result = this.engine.useItem(itemId);
    if (!result.ok) {
      if (result.reason === 'cooldown') this.showMessage('Aguarde para usar este item novamente...', 1200);
      return;
    }
    this.fightPotionsUsed += 1;
    this.animator.play('eat');
    audio.itemUse();
    this.processEvents(result.events);
    this.refreshItemHotbarCounts();
  }

  private onBlockClicked(): void {
    if (!this.engine) return;
    const result = this.engine.attemptBlock();
    if (!result.ok) {
      if (result.reason === 'cooldown') this.showMessage('Bloqueio ainda em recarga...', 1200);
      return;
    }
    this.animator.play('defend');
    this.processEvents(result.events);
  }

  private onDodgeClicked(): void {
    if (!this.engine) return;
    const result = this.engine.attemptDodge();
    if (!result.ok) {
      if (result.reason === 'cooldown') this.showMessage('Esquiva ainda em recarga...', 1200);
      return;
    }
    this.animator.play('dodge');
    audio.dodge();
    this.processEvents(result.events);
  }

  /** The class-ability button / key: checks the meter FIRST (so a multi-enemy fight never asks for a target it then can't use), then routes targeting exactly like a hotbar skill (`onHotbarClicked`). */
  private onClassAbilityClicked(): void {
    if (!this.engine) return;
    const ability = this.classMechanic?.ability;
    const target = this.engine.classAbilityTarget();
    if (!ability || !target) return;
    if (!this.engine.isClassMeterFull()) {
      this.showClassMeterNotReady();
      return;
    }
    if (target === 'enemy') {
      const alive = this.engagedMonsters.filter((m) => m.enemy.isAlive());
      if (alive.length === 0) return;
      if (alive.length === 1) {
        this.tryUseClassAbility(target, this.engine.enemies.indexOf(alive[0].enemy));
        return;
      }
      this.showMessage(`Escolha o alvo de ${ability.name} (clique em um inimigo)...`, 4000);
      this.pendingTargetPick = (m) => this.tryUseClassAbility(target, this.engine!.enemies.indexOf(m.enemy));
      return;
    }
    this.tryUseClassAbility(target);
  }

  private tryUseClassAbility(target: SkillTarget, targetIndex?: number): void {
    if (!this.engine) return;
    const result = this.engine.useClassAbility(targetIndex);
    if (!result.ok) {
      if (result.reason === 'meter') this.showClassMeterNotReady();
      return;
    }
    if (target !== 'self') this.faceCurrentTarget(targetIndex);
    // A melee strike for the warrior's Golpe Selvagem, a spell for the
    // cleric's/necromancer's — both with the class's own ultimate clip and
    // burst, since a full-meter payoff should read as a big moment.
    const action: ActionName = target === 'enemy' ? 'attack' : 'cast';
    this.animator.play(action, undefined, { isUltimate: true });
    if (action === 'cast') audio.castSpell();
    else audio.attackSwing();
    this.processEvents(result.events);
    this.playUltimateVfx(target, targetIndex);
    this.refreshClassResource();
  }

  private showClassMeterNotReady(): void {
    const mechanic = this.classMechanic;
    if (!mechanic?.ability) return;
    this.showMessage(`${mechanic.ability.name} ainda não está pronto — encha a barra de ${mechanic.name}.`, 1400);
  }

  // --- event processing ---------------------------------------------------

  private showMessage(text: string, durationMs: number): void {
    this.messageEl.textContent = text;
    this.messageEl.hidden = false;
    this.messageHideAt = this.clock + durationMs / 1000;
  }

  /** Same on-screen banner combat uses for level-ups/quest completions — for non-combat callers like dialogue. */
  showBanner(text: string, durationMs = 2200): void {
    this.showMessage(text, durationMs);
  }

  private monsterForEnemy(enemy: Enemy): WorldMonster | undefined {
    return this.engagedMonsters.find((m) => m.enemy === enemy);
  }

  /**
   * `onDeferrableImpact`, when given (only `fireRangedSkillProjectiles`
   * passes it), lets the caller hold back a specific target's own popup +
   * hit-impact burst instead of showing it right away — everything else
   * here (HP bars, audio, defeated/victory, ...) always runs immediately,
   * unaffected either way.
   */
  private processEvents(events: CombatEvent[], opts?: { onDeferrableImpact?: (targetIndex: number, reveal: () => void) => void }): void {
    if (!this.engine) return;
    for (const event of events) {
      if (event.kind === 'damage' && event.targetIsPlayer && (event.amount ?? 0) > 0) {
        this.tookDamageThisFight = true;
        this.fightDamageTaken += event.amount ?? 0;
      }
      if (event.text) this.showMessage(event.text, 2600);
      if (event.kind === 'telegraph') {
        this.messageEl.classList.add('telegraph');
        setTimeout(() => this.messageEl.classList.remove('telegraph'), 440);
        audio.telegraphWarning();
      }
      if (event.kind === 'bossPhase') {
        // A bigger narrative beat than a plain telegraph — shown longer
        // (overriding the generic 2600ms set above for every event's own
        // `text`) and with its own color/sound so a phase change reads as
        // "something has changed", not just another attack warning.
        this.showMessage(event.text, 4200);
        this.messageEl.classList.add('boss-phase');
        setTimeout(() => this.messageEl.classList.remove('boss-phase'), 900);
        if (this.bossBannerEl) {
          this.bossBannerEl.classList.add('phase-flash');
          setTimeout(() => this.bossBannerEl?.classList.remove('phase-flash'), 900);
        }
        audio.bossPhaseChange();
        // Fase 7: a heavier beat on top — freeze + big shake + a screen pulse.
        audio.bossPhaseStinger();
        combatFeel.onBossPhase();
        this.flashBossPhaseScreen();
      }
      if (event.kind === 'miss') audio.miss();
      if (event.kind === 'heal' || event.kind === 'buff') audio.itemUse();
      if (event.kind === 'stagger') audio.stagger();

      if (event.actorIndex !== undefined) this.triggerFlash(this.engine.enemies[event.actorIndex]);

      if (event.targetIndex !== undefined) {
        const enemy = this.engine.enemies[event.targetIndex];
        const m = this.monsterForEnemy(enemy);
        if (m) {
          if (event.targetHpAfter !== undefined) this.setMonsterHp(m, event.targetHpAfter);
          this.triggerFlash(enemy);
          if (event.kind === 'damage' && (event.amount ?? 0) > 0) {
            const severity = hitSeverity(event.amount ?? 0, enemy.stats.maxHp);
            combatFeel.onHit({ amount: event.amount ?? 0, targetMaxHp: enemy.stats.maxHp, crit: event.crit, killed: (event.targetHpAfter ?? 1) <= 0 });
            this.beginHitFlash(m);
            this.beginKnockback(m, severity, !!event.crit);
          }
          const revealImpact = () => {
            this.popupForEvent(event, this.labelAnchor(m));
            if (event.kind === 'damage' || event.kind === 'statusApplied' || event.kind === 'statusTick') {
              this.vfx.spawnHitImpact(m.model.position, event.skillKind ?? 'physical', event.statusType);
              // A melee class's own physical hit gets an extra slash flourish on top of the shared burst — a ranged class's physical hit (e.g. an archer's arrow) already got its own travelling projectile instead, so it doesn't also need this.
              if (event.kind === 'damage' && event.skillKind === 'physical' && !RANGED_STYLE_BY_CLASS[this.player.classId]) {
                this.vfx.spawnMeleeSlash(m.model.position, hitImpactColor('physical'));
              }
            }
          };
          // 'defeated' deliberately stays OUT of this deferral (unlike
          // 'damage'/'statusApplied'/'miss' below): `OverworldCombat.update`
          // tears the whole engagement down (`endEngagement`) the very next
          // frame once `CombatEngine.outcome` leaves 'ongoing', and that
          // teardown resets every still-`'engaged'` monster's state to
          // `'chase'` assuming nothing killed it — if this target's own
          // `killMonster` were still waiting on a projectile a few hundred ms
          // out, that reset would have it resume wandering, dead-but-walking,
          // after "Vitória!" already showed. A one-hit kill's target
          // disappearing an instant before its own killing shot visibly
          // lands is a far smaller, safer glitch than that.
          const deferrable = event.kind === 'damage' || event.kind === 'statusApplied' || event.kind === 'miss';
          if (opts?.onDeferrableImpact && deferrable) opts.onDeferrableImpact(event.targetIndex, revealImpact);
          else revealImpact();
        }
        if (event.kind === 'damage') audio.hitImpact(event.crit);
        if (event.kind === 'defeated' && m) {
          this.killMonster(m);
          audio.enemyDefeated();
        }
      } else if (event.targetIsPlayer) {
        if (event.kind === 'damage') {
          this.animator.play('hit');
          combatFeel.onHit({ amount: event.amount ?? 0, targetMaxHp: this.player.stats.maxHp, crit: event.crit, targetIsPlayer: true, mitigation: event.mitigation });
          if (event.mitigation !== 'dodge') this.popupForPlayerEvent(event);
          if (event.mitigation === 'block' || event.mitigation === 'perfectBlock') {
            audio.block(event.mitigation === 'perfectBlock');
          } else if (event.mitigation !== 'dodge') {
            audio.hitImpact(event.crit);
          }
        }
        if (event.kind === 'damage' || event.kind === 'heal' || event.kind === 'buff' || event.kind === 'statusApplied' || event.kind === 'statusTick') {
          this.vfx.spawnHitImpact(this.playerWorldPos, event.skillKind ?? 'physical', event.statusType);
        }
      }

      if (event.kind === 'victory') {
        this.animator.play('victory');
        audio.victory();
        if ((event.levelsGained ?? 0) > 0) audio.levelUp();
      } else if (event.kind === 'defeat') {
        audio.defeat();
      }
    }
  }

  private labelAnchor(m: WorldMonster): { x: number; y: number } {
    const rect = m.labelEl.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top };
  }

  private triggerFlash(enemy: Enemy): void {
    const m = this.monsterForEnemy(enemy);
    if (m && m.state !== 'dead') m.flashTime = FLASH_DURATION;
  }

  private setMonsterHp(m: WorldMonster, hp: number): void {
    const ratio = Math.max(0, Math.min(1, hp / m.enemy.stats.maxHp));
    m.hpFillEl.style.width = `${ratio * 100}%`;
    if (m === this.activeBossMonster && this.bossBannerFillEl) {
      this.bossBannerFillEl.style.width = `${ratio * 100}%`;
    }
  }

  // Guaranteed extra drop; gold instead when the bag is full.
  private grantRareReward(m: WorldMonster): void {
    incrementCounter(this.player.worldState, 'rares_defeated');
    const level = m.enemy.def.level;
    const item = rollRareLoot(level, this.player.level, this.player.stats.luck);
    if (this.player.addLoot(item)) {
      this.pendingRareNotes.push(`${m.enemy.name} derrotado! Saque raro garantido.`);
    } else {
      const gold = 40 + level * 12;
      this.player.gold += gold;
      this.pendingRareNotes.push(`${m.enemy.name} derrotado! Mochila cheia: +${gold} ouro no lugar do saque.`);
    }
  }

  private killMonster(m: WorldMonster): void {
    this.endHitFlash(m);
    m.knockbackTime = 0;
    m.knockbackOffX = 0;
    m.knockbackOffZ = 0;
    m.state = 'dead';
    m.model.visible = false;
    m.labelEl.hidden = true;
    m.respawnAt = m.noRespawn ? -1 : this.clock + RESPAWN_DELAY;
    if (!m.noRespawn && (m.variant === 'rare' || rareEncountersUnlocked(this.player.level))) {
      this.player.rarePity = pityAfterKill(this.player.rarePity, m.variant === 'rare');
      if (m.variant === 'rare') this.grantRareReward(m);
    }

    if (this.dungeonDeathBurst && !m.isDungeonBoss && m.dungeonEncounterIndex !== undefined) this.applyDeathBurst(this.dungeonDeathBurst);

    if (m.dungeonEncounterIndex !== undefined && this.dungeonHooks) {
      const index = m.dungeonEncounterIndex;
      const podStillAlive = this.monsters.some((other) => other.dungeonEncounterIndex === index && other.state !== 'dead');
      if (!podStillAlive) this.dungeonHooks.onEncounterCleared(index);
    }
    if (m.isDungeonBoss && this.dungeonHooks) {
      this.dungeonHooks.onBossDefeated();
    }
  }

  /** Brasas Vingativas (data/dungeonModifiers.ts): a dying dungeon monster scorches the player — never lethal, so it can't end a fight on its own. */
  private applyDeathBurst(burst: { maxHpPct: number; burn: boolean }): void {
    if (!this.player.isAlive()) return;
    const damage = Math.min(this.player.currentHp - 1, Math.round(this.player.stats.maxHp * burst.maxHpPct));
    if (damage <= 0) return;
    this.player.currentHp -= damage;
    if (burst.burn && this.engine) applyStatusEffect(this.player, 'burn', damage);
    this.vfx.spawnHitImpact(this.playerWorldPos, 'magical', 'burn');
    this.showMessage(`Brasas Vingativas: o inimigo explode! (-${damage} de vida)`, 1800);
  }

  /**
   * Fase 7: wording/colour now come from combatFeel.damagePopupStyle (same
   * texts as before) and each popup gets a variant class (crit/weak/resist/
   * heal/elemental/player) so style.css can size/animate them differently.
   * "Números de dano" off hides them entirely.
   */
  private popupForEvent(event: CombatEvent, anchor: { x: number; y: number }): void {
    if (!combatFeel.settings.damageNumbers) return;
    const style = damagePopupStyle(event);
    if (!style) return;

    const jitterX = (Math.random() - 0.5) * 20;
    const variantClass = ` floating-text--${style.variant}${style.element ? ` floating-text--${style.element}` : ''}`;
    const popup = el('div', {
      className: `floating-text${variantClass}`,
      text: style.text,
      style: { left: `${anchor.x + jitterX}px`, top: `${anchor.y}px`, color: style.color, opacity: '1' },
    });
    this.game.uiRoot.append(popup);
    const rise = style.variant === 'crit' || style.variant === 'weak' ? 44 : 30;
    requestAnimationFrame(() => {
      popup.style.transform = `translate(-50%, calc(-50% - ${rise}px))`;
      popup.style.opacity = '0';
    });
    setTimeout(() => popup.remove(), 750);
  }

  /** Damage the PLAYER takes — a red number over the hero (only enemies got popups before). */
  private popupForPlayerEvent(event: CombatEvent): void {
    if (!combatFeel.settings.damageNumbers || !this.lastCamera || !(event.amount && event.amount > 0)) return;
    this.scratchPopupPos.set(this.playerWorldPos.x, this.playerWorldPos.y + 1.9, this.playerWorldPos.z);
    const anchor = this.projectToScreen(this.scratchPopupPos, this.lastCamera);
    if (anchor.behind) return;
    this.popupForEvent(event, anchor);
  }

  /** A brief full-screen pulse for a boss phase change — skipped under "Reduzir movimento" (a flashing screen is exactly what that option is for avoiding). */
  private flashBossPhaseScreen(): void {
    if (combatFeel.settings.reduceMotion) return;
    const pulse = el('div', { className: 'boss-phase-pulse' });
    this.game.uiRoot.append(pulse);
    setTimeout(() => pulse.remove(), 900);
  }

  /** How many monsters are in the current fight — drives the camera's combat zoom (see OverworldScreen.updateCamera). */
  engagedCount(): number {
    return this.engine ? this.engagedMonsters.length : 0;
  }

  private refreshHotbarCooldowns(): void {
    if (!this.engine) return;
    for (const slot of this.hotbar) {
      const remaining = this.engine.cooldownRemaining(slot.skill.id);
      const fraction = slot.totalCooldown > 0 ? Math.min(1, remaining / slot.totalCooldown) : 0;
      slot.fillEl.style.height = `${fraction * 100}%`;
      slot.el.classList.toggle('no-mana', this.player.currentMp < slot.cost && remaining <= 0.05);
    }
    for (const slot of this.itemHotbar) {
      const remaining = this.engine.cooldownRemaining(`item_${slot.itemId}`);
      const fraction = Math.min(1, remaining / ITEM_COOLDOWN);
      slot.fillEl.style.height = `${fraction * 100}%`;
    }
    const blockRemaining = this.engine.blockCooldownRemaining();
    this.blockFillEl.style.height = `${Math.min(1, blockRemaining / BLOCK_COOLDOWN) * 100}%`;
    const dodgeRemaining = this.engine.dodgeCooldownRemaining();
    this.dodgeFillEl.style.height = `${Math.min(1, dodgeRemaining / DODGE_COOLDOWN) * 100}%`;
  }

  /** Every class sees "Combo xN"; the monk sees the same counter as its named Fluxo levels instead (see classMechanics.ts's `comboLabel`). */
  private refreshCombo(): void {
    if (!this.engine) return;
    const label = comboLabel(this.classMechanic?.id, this.engine.comboHits);
    if (label) {
      this.comboEl.textContent = label;
      this.comboEl.hidden = false;
      this.comboEl.classList.toggle('finisher', this.engine.flowLevel >= FLOW_MAX_LEVEL);
    } else {
      this.comboEl.hidden = true;
    }
  }

  /** Syncs the class panel (and the class-ability button's ready glow) with the engine — same read-state-then-write-DOM shape as `refreshCombo`, called every frame while engaged. */
  private refreshClassResource(): void {
    const mechanic = this.classMechanic;
    if (!this.engine || !mechanic || !this.classMeterEl || !this.classMeterFillEl || !this.classMeterValueEl) return;

    let fraction: number;
    let valueText: string;
    let full: boolean;
    if (mechanic.kind === 'combo') {
      const level = this.engine.flowLevel;
      fraction = level / FLOW_MAX_LEVEL;
      valueText = `Nível ${level}/${FLOW_MAX_LEVEL}`;
      full = level >= FLOW_MAX_LEVEL;
    } else {
      fraction = this.engine.classMeterFraction();
      valueText = mechanic.steps
        ? `${Math.round(fraction * mechanic.steps)}/${mechanic.steps}`
        : `${Math.floor(this.engine.classMeterValue)}/${CLASS_METER_MAX}`;
      full = this.engine.isClassMeterFull();
    }
    if (valueText === this.lastClassMeterText) return;
    this.lastClassMeterText = valueText;

    this.classMeterFillEl.style.width = `${fraction * 100}%`;
    this.classMeterValueEl.textContent = valueText;
    this.classMeterEl.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
    this.classMeterEl.classList.toggle('full', full);
    this.classAbilityBtnEl?.classList.toggle('ready', full);
    // Announce the moment a spendable meter fills — on touch screens (no
    // hover tooltips) this is what tells the player the button is live. Only
    // while the fight is still on: a killing blow that also fills the meter
    // is followed by one more refresh before `endEngagement` tears the HUD
    // down, and announcing there would bury the "Vitória!" message.
    if (full && !this.lastClassMeterReady && mechanic.ability && this.classAbilityBtnEl && this.engine.outcome === 'ongoing') {
      this.showMessage(`${mechanic.ability.name} pronto! (${CLASS_ABILITY_KEY.toUpperCase()})`, 2200);
    } else if (full && !this.lastClassMeterReady && mechanic.readyMessage && this.engine.outcome === 'ongoing') {
      this.showMessage(mechanic.readyMessage, 2200);
    }
    this.lastClassMeterReady = full;
  }

  private refreshItemHotbarCounts(): void {
    for (const slot of this.itemHotbar) {
      const count = this.player.inventory[slot.itemId] ?? 0;
      slot.countEl.textContent = `x${count}`;
      slot.el.classList.toggle('depleted', count <= 0);
    }
  }
}
