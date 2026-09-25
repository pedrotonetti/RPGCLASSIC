import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { TILE_SIZE } from '../config/gameConfig';
import { isWalkable, TileType } from '../config/tiles';
import { createStarterItem, getEquipmentTemplate } from '../data/equipment';
import { getGemById } from '../data/gems';
import { getItemById } from '../data/items';
import { getMaterialById } from '../data/materials';
import { getMountById } from '../data/mounts';
import { dialogueLinesFor, getNpcById, NPC_DEFINITIONS, type NpcDefinition, type VendorInfo } from '../data/npcs';
import { arriveWorldPosition, getZoneById, MAIN_CITY_ID, subAreaNameAt, type ZoneDefinition, type ZoneExit } from '../data/zones';
import { dungeonsInHostZone, getDungeonById, type DungeonDefinition } from '../data/dungeons';
import { rarityTier, rarityToHex } from '../config/rarity';
import type { EquipmentSlot, ItemRarity } from '../config/types';
import { Player, type Act3Ending } from '../entities/Player';
import type { CharacterAnimatorLike } from '../render/animation';
import { GltfCharacterAnimator } from '../render/gltfCharacterAnimator';
import { buildMountModel } from '../render/characterModel';
import { animateDungeonPortal, buildDungeonPortalMesh } from '../render/dungeonPortal';
import { GltfActor, loadSkinnedInstance } from '../render/gltfModel';
import { loadNpcAvatar } from '../render/npcAvatar';
import { applyWeaponGem, type PlayerAvatar } from '../render/playerAvatar';
import { buildOverworldMeshes, tileCenterWorld, type BuildingCollider, type TreeCollider } from '../render/worldBuilder';
import { OverworldCombat } from '../systems/OverworldCombat';
import { buildWalkabilityGrid, pathfindToClick } from '../systems/Pathfinding';
import { completeDungeon, encounterProgressText, recordEncounterCleared, startDungeonRun, type DungeonRunState } from '../systems/DungeonSystem';
import { DUNGEON_TIER_CAP, dungeonTierStatMultiplier, selectableDungeonTiers } from '../systems/DungeonTierSystem';
import {
  currentQuest,
  ensureAct3Started,
  ensureAmaraRevealStarted,
  ensureClassCallingStarted,
  ensureQuestStarted,
  notifyTalkedTo,
  offerSideQuest,
  questTrackerText,
} from '../systems/QuestSystem';
import type { QuestDefinition } from '../data/quests';
import { saveGame } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { el, goToLazy } from '../ui/dom';
import { isTouchDevice } from '../ui/device';

const SLOT_LABELS: Record<EquipmentSlot, string> = { arma: 'Arma', armadura: 'Armadura', acessorio: 'Acessório' };

type Dir = 'up' | 'down' | 'left' | 'right';

/** Axis contribution of each held direction — combined into one input vector so opposite/diagonal keys blend naturally instead of snapping to a single facing. */
const DIR_AXIS: Record<Dir, { x: number; z: number }> = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
};

const PLAYER_SPEED = 3.6; // world units/second, free-roam walking pace (not grid-snapped)
const PLAYER_RADIUS = 0.34; // collision circle, roughly the character's own girth
const TURN_SPEED = 12; // how fast the avatar's facing catches up to its movement direction

// --- click-to-walk (minimap) ------------------------------------------
/** How close (world units) counts as "arrived" at an auto-walk waypoint before advancing to the next one. Well under half a tile (TILE_SIZE=2) so the follower doesn't overshoot and oscillate around it. */
const AUTO_WALK_WAYPOINT_EPS = 0.15;
/** How many tiles out from a clicked point on solid geometry (a tree, a building, water) findNearestWalkable is allowed to search for a walkable tile to snap onto — see Pathfinding.findNearestWalkable. */
const AUTO_WALK_SNAP_RADIUS = 3;
/** Seconds of near-zero progress toward the current waypoint before the auto-walker gives up — guards against a dynamic obstacle (an NPC) that wandered onto an already-computed path, which the pathfinder itself can't see. */
const AUTO_WALK_STUCK_LIMIT = 1.2;

/**
 * The default third-person camera rig: behind and above the avatar, angled
 * down at it. Grouped here (rather than as separate scattered constants) so
 * future work on camera positioning — a player-adjustable angle, a zoom
 * level, a different rig for boss fights, whatever comes next — has one
 * place to add to instead of hunting down every related number.
 *
 * Pulled back and raised well above the previous close, near-eye-level
 * chase-cam (distance 4.4 / height 3.1) into a more elevated overview,
 * closer to how Diablo/PW-style ARPGs frame the character: enough of the
 * surrounding ground stays in frame to actually read a scene (nearby NPCs,
 * a monster corridor, a room's layout) instead of mostly sky and whatever
 * is directly ahead. Still genuinely third-person and behind the avatar —
 * not a top-down/isometric switch — just angled further down.
 */
const CAMERA_RIG = {
  // Was 6.0 — roadside buildings (huts/houses placed right along a path,
  // see MapGenerator's placeBuildingsAlongPaths) loomed into frame at that
  // distance: their roofs are low-poly cones (a hut roof is literally a
  // 4-sided pyramid), so a few flat, mostly-unlit facets filling the edges
  // of a close frame reads as a huge dark wedge, not "oh, a rooftop".
  // Pulling the whole rig back gives every nearby object more headroom
  // before it dominates the frame, on top of the buffer fix below.
  distance: 7.5,
  height: 6.5,
  /** World-Y the camera looks at, relative to the avatar's own position — just above the feet, not the chest, so the steeper downward angle keeps the avatar centered instead of looking past their head. */
  lookHeight: 0.9,
};
/** Fallback camera lift (above the avatar) when no spot within CAMERA_RIG.distance clears every nearby tree/building — see desiredCameraPosition/updateCamera. Derived from the rig height (not an independent constant) so raising the default height can't accidentally leave this lower than normal. */
const CAM_LIFT_HEIGHT = CAMERA_RIG.height + 2.0;
/** How much cumulative resolveCameraXZ push (world units) counts as a "fully squeezed" cluster — see updateCamera's liftTarget. Small enough that a real dense cluster still ramps to full lift, large enough that one grazing nudge against a single tree doesn't. */
const CAM_LIFT_RAMP_RANGE = 1.5;
/**
 * The camera's azimuth (radians) around the avatar — a genuine constant,
 * never read from the avatar's own rotation. Earlier, desiredCameraPosition
 * derived its facing straight from avatar.rotation.y, which the avatar's
 * own turn-to-face-movement animation (updateMovement's turnToward) keeps
 * changing continuously — so the camera re-orbited behind the avatar's
 * new facing on every direction change/reversal instead of holding one
 * fixed viewing angle, which is what "a fixed third-person camera" (the
 * owner's own explicit ask) actually means: it translates to follow the
 * avatar's position, but never rotates with it. computeInputAxis keys off
 * this exact same constant (not the avatar's yaw) for the same reason.
 * Free to retune to a different fixed angle later (e.g. a more isometric
 * default) — just never wire it back to avatar.rotation.y.
 */
const CAMERA_YAW = 0;

/** Condensed in-game epilogue text for each of Ato 3's three endings — see LORE.md's "O final" for the full versions this summarizes. */
const ACT3_EPILOGUE_TEXT: Record<Act3Ending, string> = {
  corte:
    'Você sela Ipêra das Raízes para sempre. A Florescência não volta a acontecer, e os ipezais ficam em silêncio — visitá-los agora é luto, não convívio. Ipêra sobrevive, mais segura e mais pobre por isso. Zaya, que cresceu ouvindo as Raízes de longe, é quem mais sente essa perda — e parte em busca de alguma raiz ainda viva em outra terra, além-mar.',
  cura:
    'Você canaliza cura pela rede de raízes, e ela pega — mas não por completo, e não sem preço: veios de casca de Ipê começam a crescer pela sua própria pele. A Florescência volta, incompleta e instável. Ilva desaparece, convencida de que "quase deu certo" e determinada a terminar o trabalho sozinha, em algum lugar da Florescência ainda irregular.',
  abraco:
    'Você absorve parte da própria Sede para controlá-la — e funciona: Ipêra é salva. Mas você não sai dessa escolha totalmente humano aos olhos do seu povo: poderoso o bastante para manter a Sede sob controle sozinho(a), e por isso mesmo vigiado(a) com o mesmo misto de gratidão e medo que cercava o último Escolhido Verde antes da guerra contra o Jugo. Zaya é a única que não tem medo de você.',
};

const INTERACT_RANGE = TILE_SIZE * 1.3;
const NPC_COLLISION_RADIUS = 0.4;
// The player model's local origin is at its feet, but its hip pivot (where a
// straddling rider's weight actually rests) is ~0.84 above that. So the
// offset that lands the hip on the mount's back sits well below zero, not
// above it — this is the position of the character's ROOT, not the seat.
const MOUNT_SEAT_OFFSET = new THREE.Vector3(0, -0.08, -0.05);
const FLYING_HOVER_HEIGHT = 0.9;

interface NpcSlot {
  def: NpcDefinition;
  /** An invisible placeholder `THREE.Group` at first (see `buildNpcs`), swapped for the real loaded GLTF scene once `loadNpcAvatar` resolves — every distance/position read elsewhere (`updateInteraction`, `updateNpcLabels`, `canOccupy`) just reads `.position`, which is valid on either. */
  model: THREE.Group;
  labelEl: HTMLElement;
  /** Null until the real avatar loads in (see `buildNpcs`) — nothing to drive an Idle clip on before then. */
  actor: GltfActor | null;
}

interface DungeonPortalSlot {
  def: DungeonDefinition;
  group: THREE.Group;
  glowMaterial: THREE.MeshStandardMaterial;
  labelEl: HTMLElement;
}

/** Glow tint shared by every dungeon entrance portal — a corrupted violet distinct from any class's own accent color, so it always reads as "instance, not open world" from across the map. */
const DUNGEON_PORTAL_GLOW = 0x8a5cf5;

interface WildlifeSlot {
  model: THREE.Group;
  actor: GltfActor;
  home: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  moveT: number;
  moveDuration: number;
  waitTimer: number;
  /** Per-instance speed jitter so a handful of the same asset don't all move in lockstep. */
  speedScale: number;
}

// Grass tiles well clear of the village/road/pond, verified against the map
// at spawn time so a future map change can't silently place one in water.
const FOX_SPAWN_TILES: Array<{ x: number; y: number }> = [
  { x: 14, y: 10 },
  { x: 21, y: 6 },
  { x: 11, y: 17 },
  { x: 31, y: 9 },
  { x: 19, y: 19 },
];
const FOX_SCALE = 0.42;
const FOX_WANDER_RADIUS = 1.6;
const FOX_MOVE_SPEED = 0.6; // world units per second

/**
 * A single hand-placed "must be sought out" encounter (see
 * OverworldCombat.spawnFixedMonster) — a troll standing distinctively at the
 * pond's edge in Pedravale's own field, well clear of the pond's water
 * ellipse and every plaza/gate/street, rather than blending into
 * spawnMonsters' anonymous scatter. Ties into the "Contrato: O Troll da
 * Lagoa" bounty (data/quests.ts) — Bram's dialogue points here directly.
 * Grass-checked at spawn time exactly like FOX_SPAWN_TILES, so a future map
 * change can't silently bury it in a tree.
 */
const LAGOA_TROLL_TILE = { x: 58, y: 22 };

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.dispose();
    }
  });
}

export class OverworldScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private tiles: TileType[][] = [];
  private waterMaterial: THREE.MeshStandardMaterial | null = null;
  private treeColliders: TreeCollider[] = [];
  private buildingColliders: BuildingCollider[] = [];
  private minimapCanvas!: HTMLCanvasElement;
  /** One tile-per-pixel render of the current zone's terrain, built once per mount — updateMinimap() blits this (cheap) instead of re-walking the whole tile grid every frame. */
  private minimapBg: HTMLCanvasElement | null = null;
  private playerModel!: THREE.Group;
  private mountModel: THREE.Group | null = null;
  /** Whichever object currently moves through the world — the rider alone, or the mount carrying them. */
  private avatar!: THREE.Object3D;
  private animator!: CharacterAnimatorLike;
  private dirLight!: THREE.DirectionalLight;
  private npcSlots: NpcSlot[] = [];
  private wildlife: WildlifeSlot[] = [];
  private combat!: OverworldCombat;
  private zoneDef!: ZoneDefinition;
  private zoneRespawnTile = { x: 5, y: 5 };
  private time = 0;

  private dungeonPortals: DungeonPortalSlot[] = [];
  private nearbyDungeon: DungeonDefinition | null = null;
  /** Set only when the CURRENT zone is a dungeon instance (see mount()) — null in any open-world zone, including one that hosts other dungeons' portals. */
  private activeDungeon: DungeonDefinition | null = null;
  private dungeonRunState: DungeonRunState | null = null;
  private dungeonProgressEl: HTMLElement | null = null;
  private dungeonCompleteEl: HTMLElement | null = null;
  private dungeonCompleteMessageEl: HTMLElement | null = null;
  /** The floating tier-choice panel shown at an already-cleared dungeon's portal — see openDungeonTierPicker. Rebuilt fresh each time it's opened, so it always reflects the player's current best-cleared tier. */
  private dungeonTierPickerEl: HTMLElement | null = null;
  /** Which dungeon `dungeonTierPickerEl` is currently showing tiers for, if any — lets updateInteraction auto-close it once the player walks away from that portal. */
  private dungeonTierPickerDungeon: DungeonDefinition | null = null;
  private act3ChoiceEl!: HTMLElement;
  private act3EpilogueEl!: HTMLElement;
  private act3EpilogueTextEl!: HTMLElement;

  private isMoving = false;
  /** Eases toward 1 when the camera is squeezed by a dense obstacle cluster (resolveCameraXZ can't find a clear spot), toward 0 otherwise — see updateCamera. Replaces a direct Math.max height snap, which was a visible one-frame lurch. */
  private cameraLiftBlend = 0;

  private heldKeys = new Set<string>();
  /** Normalized {x,z} from the on-screen joystick, magnitude <=1; null while untouched. */
  private joystickAxis: { x: number; z: number } | null = null;
  private joystickPointerId: number | null = null;

  /**
   * Click-to-walk (see the minimap's click handler): remaining world-space
   * waypoints to chase through, nearest first. Emptied the instant the
   * player gives ANY manual directional input (keyboard or joystick) — see
   * updateMovement — so auto-walk can never fight manual control, and
   * emptied on its own once the last waypoint is reached or the follower
   * gets stuck (see autoWalkStuckTime).
   */
  private autoWalkWaypoints: THREE.Vector3[] = [];
  /** Seconds the auto-walker has gone without making real progress toward its current waypoint — e.g. an NPC wandered onto the path after it was computed. Past AUTO_WALK_STUCK_LIMIT this cancels the walk instead of holding the player in place forever. */
  private autoWalkStuckTime = 0;
  private keydownHandler = (e: KeyboardEvent) => this.onKeyDown(e);
  private keyupHandler = (e: KeyboardEvent) => this.onKeyUp(e);

  private camLookAt = new THREE.Vector3();

  private paused = false;
  private dialogueNpc: NpcDefinition | null = null;
  private dialogueLineIndex = 0;
  /** The lines actually shown for this conversation — captured at open time via dialogueLinesFor, before notifyTalkedTo can mutate quest state out from under them. */
  private dialogueLines: string[] = [];
  private nearbyNpc: NpcDefinition | null = null;
  private shopNpc: NpcDefinition | null = null;

  private promptEl!: HTMLElement;
  private hpEl!: HTMLElement;
  private mpEl!: HTMLElement;
  private goldEl!: HTMLElement;
  private dialogueOverlay!: HTMLElement;
  private dialogueNameEl!: HTMLElement;
  private dialogueLineEl!: HTMLElement;
  private pauseOverlay!: HTMLElement;
  private questTrackerEl!: HTMLElement;
  private questZoneHintEl!: HTMLElement;
  /** Directional pointer toward the current quest's objective — see updateQuestIndicator. Hidden whenever there's nothing in the current zone to point at. */
  private questArrowEl!: HTMLElement;
  private mountSectionEl!: HTMLElement;
  private shopOverlay!: HTMLElement;
  private shopTitleEl!: HTMLElement;
  private shopBodyEl!: HTMLElement;
  private shopGoldEl!: HTMLElement;
  private tutorialOverlayEl: HTMLElement | null = null;
  /** True while the first-time tutorial overlay is up — blocks movement/interaction the same way a dialogue box does, but dismisses on its own button rather than Escape. */
  private showingTutorial = false;

  constructor(
    private game: Game,
    private player: Player,
    /** Pre-loaded by the caller (see the `goToLazy` sites that construct this screen) so `mount()` can stay fully synchronous — GLTF loading is async, but by the time we get here it's already resolved. */
    private avatarData: PlayerAvatar,
  ) {
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  }

  mount(): void {
    ensureQuestStarted(this.player);
    ensureClassCallingStarted(this.player);
    ensureAmaraRevealStarted(this.player);
    ensureAct3Started(this.player);

    this.scene.background = new THREE.Color(0x8ec9e8);
    this.scene.fog = new THREE.Fog(0x8ec9e8, 16, 46);

    this.zoneDef = getZoneById(this.player.zoneId);
    this.activeDungeon = this.zoneDef.dungeonId ? getDungeonById(this.zoneDef.dungeonId) : null;
    const { tiles, playerStart, buildings } = this.zoneDef.generate();
    this.tiles = tiles;
    this.zoneRespawnTile = playerStart;
    const { group, waterMaterial, treeColliders, buildingColliders } = buildOverworldMeshes(tiles, this.zoneDef.accentColor, buildings);
    this.waterMaterial = waterMaterial;
    this.treeColliders = treeColliders;
    this.buildingColliders = buildingColliders;
    this.scene.add(group);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    const hemi = new THREE.HemisphereLight(0x8ec9e8, 0x4c8a3f, 0.55);
    this.scene.add(ambient, hemi);

    this.dirLight = new THREE.DirectionalLight(0xfff4e0, 1.0);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    const cam = this.dirLight.shadow.camera as THREE.OrthographicCamera;
    // The shadow frustum recenters on the avatar every frame (see
    // updateCamera below), but buildings/trees are static — a house's roof
    // alone spans up to ~8.5 units (ConeGeometry radius 4.24 in
    // worldBuilder.ts), so the previous ±9 bound only fully contained one
    // if the avatar stood almost directly under it. Anywhere else nearby
    // (a very normal distance to be at while walking past one), the roof's
    // shadow got clipped by the frustum edge and re-clipped differently
    // every frame as the avatar moved — producing a stray, hard-edged dark
    // shape that appeared and shifted with movement, easy to mistake for a
    // moving creature. Widened to comfortably contain any building within
    // a much larger radius of the avatar; mapSize doubled to keep shadow
    // crispness at the larger area.
    cam.left = -16;
    cam.right = 16;
    cam.top = 16;
    cam.bottom = -16;
    cam.near = 1;
    cam.far = 30;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.playerModel = this.avatarData.scene;
    this.animator = new GltfCharacterAnimator(this.avatarData.actor, this.avatarData.weaponKind, this.avatarData.classId);
    this.avatar = this.playerModel;
    this.scene.add(this.playerModel);
    this.avatar.position.set(this.player.mapX, 0, this.player.mapY);

    if (this.player.activeMountId) this.setMounted(this.player.activeMountId, true);

    this.buildNpcs();

    // Safety net: a save's stored mapX/mapY predates whatever this zone's
    // generator produces on THIS load (a bigger map, a regenerated building
    // layout, ...) and can now land inside or right up against a building
    // that didn't exist there before. Rather than ever spawning the player
    // stuck inside a wall, fall back to the zone's own safe respawn tile —
    // the same spot handleDefeat already treats as safe.
    if (!this.canOccupy(this.avatar.position.x, this.avatar.position.z, PLAYER_RADIUS, this.isFlyingMounted())) {
      const safe = tileCenterWorld(this.zoneRespawnTile.x, this.zoneRespawnTile.y);
      this.avatar.position.set(safe.x, this.avatar.position.y, safe.z);
      this.player.mapX = safe.x;
      this.player.mapY = safe.z;
    }

    this.spawnWildlife();
    this.buildDungeonPortals();
    this.positionCameraImmediate();

    this.combat = new OverworldCombat(this.game, this.player, this.scene, this.animator, () => this.handleDefeat());
    if (this.activeDungeon) {
      const dungeon = this.activeDungeon;
      // Consumed immediately (reset to 1) so it can only ever apply to THIS
      // mount — walking back out through the corridor's own exit and back in
      // later always goes through enterDungeon (portal or tier picker) again,
      // which sets it fresh.
      const tier = this.player.pendingDungeonTier;
      this.player.pendingDungeonTier = 1;
      this.dungeonRunState = startDungeonRun(dungeon, tier);
      this.combat.spawnDungeonEncounters(
        dungeon.encounters,
        { atTile: dungeon.bossTile, enemyId: dungeon.boss.enemyId, visualId: dungeon.boss.visualId },
        {
          onEncounterCleared: (index) => this.onDungeonEncounterCleared(index),
          onBossDefeated: () => this.onDungeonBossDefeated(),
        },
        dungeonTierStatMultiplier(tier),
      );
    } else {
      this.combat.spawnMonsters(tiles, playerStart, {
        count: this.zoneDef.monsterCount,
        enemyIds: this.zoneDef.monsterIds,
        minDistFromStart: this.zoneDef.monsterIds ? 3 : undefined,
        minSpacing: this.zoneDef.monsterIds ? 2 : undefined,
      });
      if (this.player.zoneId === MAIN_CITY_ID && tiles[LAGOA_TROLL_TILE.y]?.[LAGOA_TROLL_TILE.x] === TileType.Grass) {
        this.combat.spawnFixedMonster('troll', LAGOA_TROLL_TILE);
      }
    }

    this.buildHud();
    this.buildJoystick();
    this.buildDialogueOverlay();
    this.buildShopOverlay();
    this.buildPauseOverlay();
    this.buildAct3Overlays();
    this.buildMinimap();
    if (this.activeDungeon) {
      this.buildDungeonHud();
      this.buildDungeonCompleteOverlay();
    }
    this.buildTutorialOverlay();

    window.addEventListener('keydown', this.keydownHandler);
    window.addEventListener('keyup', this.keyupHandler);

    saveGame(this.player);
  }

  unmount(): void {
    window.removeEventListener('keydown', this.keydownHandler);
    window.removeEventListener('keyup', this.keyupHandler);
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;

    if (!this.paused && !this.dialogueNpc && !this.shopNpc && !this.showingTutorial) {
      this.updateMovement(dt);
      this.updateInteraction();
      this.combat.update(dt, this.avatar.position, this.camera);
      // Mana already regens mid-fight too (CombatEngine.tick calls
      // regenMp on its own), but outside of combat nothing was ticking
      // either stat at all — walking around never restored HP or MP no
      // matter how long you waited.
      if (!this.combat.isEngaged()) {
        this.player.regenHp(dt);
        this.player.regenMp(dt);
      }
    }

    this.animator.setMoving(this.isMoving);
    this.animator.update(dt);
    this.animateMount(dt);
    this.animateWater();
    this.updateWildlife(dt);
    this.updateNpcActors(dt);
    this.updateCamera(dt);
    this.updateNpcLabels();
    this.updateDungeonPortals();
    this.updateMinimap();
    this.updateQuestIndicator();
    this.refreshHud();
  }

  private animateWater(): void {
    if (!this.waterMaterial) return;
    const shimmer = Math.sin(this.time * 1.4) * 0.06;
    this.waterMaterial.opacity = 0.82 + shimmer;
    this.waterMaterial.emissiveIntensity = 0.15 + Math.max(0, shimmer);
  }

  private animateMount(dt: number): void {
    if (!this.mountModel) return;
    const wings = this.mountModel.userData.wings as THREE.Object3D[] | undefined;
    if (wings) {
      const flap = Math.sin(this.time * 9) * 0.35;
      wings[0].rotation.z = -0.25 + flap;
      wings[1].rotation.z = 0.25 - flap;
    }
    void dt;
  }

  // --- input -----------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    this.heldKeys.add(e.key.toLowerCase());

    if (this.showingTutorial) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') this.dismissTutorial();
      return;
    }

    if (this.shopNpc) {
      if (e.key === 'Escape') this.closeShop();
      return;
    }

    if (this.dialogueNpc) {
      if (e.key === 'e' || e.key === 'E' || e.key === 'Enter' || e.key === ' ') this.advanceDialogue();
      else if (e.key === 'Escape') this.closeDialogue();
      return;
    }

    if (e.key === 'Escape') {
      this.togglePause();
      return;
    }
    if (this.paused) return;

    if (this.combat.inCombat && this.combat.handleKeyDown(e)) {
      e.preventDefault();
      return;
    }

    if (e.key === 'e' || e.key === 'E') this.tryInteract();
    if (e.key === 'm' || e.key === 'M') {
      this.cycleMount();
    }
  }

  /** Shared by the [E] key and the on-screen interact-prompt tap — the only two ways to talk to an NPC or enter a dungeon, on keyboard and touch respectively. */
  private tryInteract(): void {
    if (this.shopNpc || this.dialogueNpc || this.paused || this.showingTutorial) return;
    if (this.nearbyNpc) this.openDialogue(this.nearbyNpc);
    else if (this.nearbyDungeon) this.interactWithDungeonPortal(this.nearbyDungeon);
  }

  private cycleMount(): void {
    const mounts = this.player.unlockedMounts;
    if (mounts.length === 0) return;
    const currentIndex = this.player.activeMountId ? mounts.indexOf(this.player.activeMountId) : -1;
    const nextIndex = currentIndex + 1;
    this.setMounted(nextIndex >= mounts.length ? null : mounts[nextIndex]);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.heldKeys.delete(e.key.toLowerCase());
  }

  /** Combines every held keyboard direction into one normalized vector (diagonals blend naturally); the on-screen joystick is a free 2D drag, so it's used as-is (unclamped magnitude gives analog-speed movement) whenever no keyboard key is held. Raw screen-relative: x = right(+1)/left(-1), z = back(+1)/forward(-1) — not a world-space direction yet, see computeInputAxis. */
  private computeLocalInputAxis(): { x: number; z: number } {
    const k = this.heldKeys;
    const active: Dir[] = [];
    if (k.has('arrowup') || k.has('w')) active.push('up');
    if (k.has('arrowdown') || k.has('s')) active.push('down');
    if (k.has('arrowleft') || k.has('a')) active.push('left');
    if (k.has('arrowright') || k.has('d')) active.push('right');

    const axis = { x: 0, z: 0 };
    for (const dir of active) {
      axis.x += DIR_AXIS[dir].x;
      axis.z += DIR_AXIS[dir].z;
    }
    const len = Math.hypot(axis.x, axis.z);
    if (len > 0) {
      axis.x /= len;
      axis.z /= len;
      return axis;
    }
    return this.joystickAxis ?? axis;
  }

  /**
   * Converts screen-relative input ("up" = away from camera, "right" =
   * screen-right) into a world-space movement direction, relative to the
   * camera's facing — like a real third-person/PlayStation-style joystick,
   * where the stick direction always maps to what you see on screen no
   * matter which way the character is currently facing.
   *
   * Before this, the raw {x, z} from DIR_AXIS was used directly as a
   * WORLD-space vector. That happened to look right only for whichever
   * facing DIR_AXIS.right's sign was tuned against, because the chase
   * camera (desiredCameraPosition) used to re-derive its own forward from
   * avatar.rotation.y every frame. At the default yaw (0, facing +Z), the
   * camera's real right-hand side works out to world -X (the same
   * right-hand rotation math desiredCameraPosition uses), but
   * DIR_AXIS.right pointed at world +X — the opposite side. That's the
   * "axis feels inverted" bug: a direction could move the character toward
   * what looked like the wrong side of the screen depending on whatever
   * direction it last happened to be facing.
   *
   * The reference yaw is CAMERA_YAW — a fixed constant, not the avatar's
   * own rotation. It used to be a snapshot of avatar.rotation.y taken at
   * the start of each input gesture, specifically to avoid a feedback loop
   * (reading the avatar's own turn-to-face-target rotation back into the
   * very vector deciding that target spins the avatar in place forever for
   * pure "right" — proven out, there's no fixed point). Once the camera
   * itself stopped rotating with the avatar's facing (see CAMERA_YAW's own
   * comment), that whole snapshot dance became unnecessary: the reference
   * this function needs to match is the camera's fixed azimuth, which
   * never changes, so it can just be read directly.
   */
  private computeInputAxis(): { x: number; z: number } {
    const local = this.computeLocalInputAxis();
    if (local.x === 0 && local.z === 0) return local;

    const forward = { x: Math.sin(CAMERA_YAW), z: Math.cos(CAMERA_YAW) };
    const right = { x: -Math.cos(CAMERA_YAW), z: Math.sin(CAMERA_YAW) };
    const inputForward = -local.z;
    const inputRight = local.x;
    return {
      x: forward.x * inputForward + right.x * inputRight,
      z: forward.z * inputForward + right.z * inputRight,
    };
  }

  // --- mounts --------------------------------------------------------

  private isFlyingMounted(): boolean {
    return this.player.activeMountId !== null && getMountById(this.player.activeMountId).kind === 'voadora';
  }

  private setMounted(mountId: string | null, instant = false): void {
    if (mountId !== null && !this.player.unlockedMounts.includes(mountId)) return;

    if (mountId === null) {
      if (!this.mountModel) return;
      const worldPos = new THREE.Vector3();
      this.mountModel.getWorldPosition(worldPos);
      this.mountModel.remove(this.playerModel);
      this.scene.remove(this.mountModel);
      disposeGroup(this.mountModel);
      this.mountModel = null;
      this.playerModel.position.copy(worldPos);
      this.playerModel.position.y = 0;
      this.scene.add(this.playerModel);
      this.avatar = this.playerModel;
      this.player.setMount(null);
      if (instant) this.animator.setMounted(false);
      else {
        this.animator.setMounted(false);
        this.animator.play('dismount');
      }
    } else {
      const def = getMountById(mountId);
      if (this.mountModel) this.setMounted(null, true);

      const worldPos = new THREE.Vector3();
      this.avatar.getWorldPosition(worldPos);
      // buildLlama/buildCondor build their creature facing local +X (body
      // capsule rotated onto that axis, neck/head/legs placed along it), but
      // every other facing convention in this file (the player model's own
      // face, and the yaw math in updateMovement) treats +Z as "forward".
      // Wrapping the built model in its own group and rotating just that
      // inner group compensates for the mismatch, while the outer
      // `mountGroup` — the one movement code actually spins to face the
      // travel direction — stays in the +Z-forward convention everyone else
      // expects. Without this, the mount was visually rotated 90° off its
      // real heading: it read as a small, unrecognizable blob instead of a
      // creature facing the way it walks.
      const innerModel = buildMountModel(mountId, def.color);
      innerModel.rotation.y = -Math.PI / 2;
      const mountGroup = new THREE.Group();
      mountGroup.add(innerModel);
      if (innerModel.userData.wings) mountGroup.userData.wings = innerModel.userData.wings;
      mountGroup.position.copy(worldPos);
      if (def.kind === 'voadora') mountGroup.position.y = FLYING_HOVER_HEIGHT;
      mountGroup.rotation.y = this.avatar.rotation.y;

      this.scene.remove(this.playerModel);
      this.playerModel.position.copy(MOUNT_SEAT_OFFSET);
      this.playerModel.rotation.y = 0;
      mountGroup.add(this.playerModel);

      this.scene.add(mountGroup);
      this.mountModel = mountGroup;
      this.avatar = mountGroup;
      this.player.setMount(mountId);
      if (instant) this.animator.setMounted(true);
      else this.animator.play('mount', () => this.animator.setMounted(true));
    }
    if (!instant) audio.mountToggle();
    this.refreshMountSection();
  }

  /**
   * Refreshes the socketed-weapon-gem glow right after socketing/removing
   * one, instead of waiting for the next zone load. Unlike the old
   * procedural rig, the class's actual model/weapon mesh never changes here
   * — only the small glow stone pinned to it — so there's no model to
   * rebuild or re-parent at all.
   */
  private rebuildPlayerVisual(): void {
    applyWeaponGem(this.avatarData, this.player);
  }

  // --- movement (continuous, free-roam — no grid snapping) ---------------

  /** Which tile a world-space point falls in, or null if outside the current zone's map. */
  private tileAt(x: number, z: number): TileType | null {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(z / TILE_SIZE);
    if (ty < 0 || ty >= this.tiles.length || tx < 0 || tx >= this.tiles[0].length) return null;
    return this.tiles[ty][tx];
  }

  /** Whether a collision circle of radius `r` centered at (x,z) is clear of solid tiles and NPCs. */
  private canOccupy(x: number, z: number, r: number, flying: boolean): boolean {
    const offsets: Array<[number, number]> = [
      [-r, -r], [r, -r], [-r, r], [r, r], [0, 0],
    ];
    for (const [ox, oz] of offsets) {
      const tile = this.tileAt(x + ox, z + oz);
      if (tile === null) return false;
      const passable = isWalkable(tile) || (flying && tile === TileType.Water);
      if (!passable) return false;
    }
    // Buildings sit on tiles that are still nominally walkable at the grid
    // level (see MapGenerator's stampFootprint) — this AABB-vs-circle check
    // against their actual footprint is what really blocks the player from
    // walking through a wall, the same role treeColliders plays for the
    // camera below.
    for (const b of this.buildingColliders) {
      const nx = Math.max(b.minX, Math.min(x, b.maxX));
      const nz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - nx;
      const dz = z - nz;
      if (dx * dx + dz * dz < r * r) return false;
    }
    for (const npc of this.npcSlots) {
      const npcPos = npc.model.position;
      const dx = x - npcPos.x;
      const dz = z - npcPos.z;
      if (Math.hypot(dx, dz) < r + NPC_COLLISION_RADIUS) return false;
    }
    return true;
  }

  private updateMovement(dt: number): void {
    const manualAxis = this.computeInputAxis();
    const hasManualInput = manualAxis.x !== 0 || manualAxis.z !== 0;
    // Manual control always wins: ANY directional input — keyboard or
    // joystick — instantly drops whatever auto-walk path was following,
    // rather than the two fighting over the avatar's position.
    if (hasManualInput && this.autoWalkWaypoints.length > 0) this.cancelAutoWalk();

    const axis = hasManualInput ? manualAxis : this.autoWalkAxis();
    this.isMoving = axis.x !== 0 || axis.z !== 0;

    if (this.isMoving) {
      const mount = this.player.activeMountId ? getMountById(this.player.activeMountId) : null;
      const speed = PLAYER_SPEED * (mount?.speedMultiplier ?? 1);
      const flying = this.isFlyingMounted();
      const pos = this.avatar.position;
      const stepX = axis.x * speed * dt;
      const stepZ = axis.z * speed * dt;

      // Axis-separated collision so sliding along a wall/tree edge works
      // instead of a diagonal move getting fully blocked by one obstacle.
      let moved = false;
      if (stepX !== 0 && this.canOccupy(pos.x + stepX, pos.z, PLAYER_RADIUS, flying)) {
        pos.x += stepX;
        moved = true;
      }
      if (stepZ !== 0 && this.canOccupy(pos.x, pos.z + stepZ, PLAYER_RADIUS, flying)) {
        pos.z += stepZ;
        moved = true;
      }

      // Auto-walk stuck detection: a dynamic obstacle (an NPC) the static
      // pathfind couldn't have known about wandered onto the current
      // waypoint's tile after the path was computed. Rather than holding
      // the player in place indefinitely, give up on the walk past
      // AUTO_WALK_STUCK_LIMIT seconds of no real progress.
      if (!hasManualInput && this.autoWalkWaypoints.length > 0) {
        this.autoWalkStuckTime = moved ? 0 : this.autoWalkStuckTime + dt;
        if (this.autoWalkStuckTime >= AUTO_WALK_STUCK_LIMIT) this.cancelAutoWalk();
      }

      const targetYaw = Math.atan2(axis.x, axis.z);
      this.avatar.rotation.y = this.turnToward(this.avatar.rotation.y, targetYaw, TURN_SPEED * dt);

      this.player.mapX = pos.x;
      this.player.mapY = pos.z;

      const tx = Math.floor(pos.x / TILE_SIZE);
      const ty = Math.floor(pos.z / TILE_SIZE);
      const exit = this.zoneDef.exits.find((e) => e.atTile.x === tx && e.atTile.y === ty);
      if (exit) this.transitionToZone(exit);
    }
  }

  // --- click-to-walk (minimap) -------------------------------------------

  /** World-space direction toward the current auto-walk waypoint, normalized like computeInputAxis's own output — {0,0} once the path is exhausted. Advances through (and drops) waypoints already reached this frame, so a short first leg doesn't cost an extra idle frame. */
  private autoWalkAxis(): { x: number; z: number } {
    const pos = this.avatar.position;
    while (this.autoWalkWaypoints.length > 0) {
      const target = this.autoWalkWaypoints[0];
      const dx = target.x - pos.x;
      const dz = target.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= AUTO_WALK_WAYPOINT_EPS) {
        this.autoWalkWaypoints.shift();
        continue;
      }
      return { x: dx / dist, z: dz / dist };
    }
    return { x: 0, z: 0 };
  }

  private cancelAutoWalk(): void {
    this.autoWalkWaypoints = [];
    this.autoWalkStuckTime = 0;
  }

  /**
   * The minimap's click-to-walk entry point: converts a clicked tile into a
   * path (reusing the exact same walkability rules canOccupy applies to
   * every other movement — plain tile walkability from config/tiles.ts, plus
   * this zone's own building footprints — never a separately-defined notion
   * of "blocked") and hands the result to the per-frame follower above.
   * Fails silently (a brief on-screen hint, no crash) if the click landed
   * somewhere no route can reach.
   */
  private startAutoWalkTo(clickedTile: { x: number; y: number }): void {
    const startTile = { x: Math.floor(this.avatar.position.x / TILE_SIZE), y: Math.floor(this.avatar.position.z / TILE_SIZE) };
    // Buildings occupy tiles the grid still calls Path/Grass (see
    // MapGenerator's stampFootprint) — their real blocking is this exact
    // list of AABBs, the same one canOccupy checks. Converting world units
    // back to tile space here mirrors renderMinimapBackground's own
    // building-footprint conversion just below.
    const buildingFootprints = this.buildingColliders.map((b) => ({
      x: Math.floor(b.minX / TILE_SIZE),
      y: Math.floor(b.minZ / TILE_SIZE),
      w: Math.max(1, Math.round((b.maxX - b.minX) / TILE_SIZE)),
      h: Math.max(1, Math.round((b.maxZ - b.minZ) / TILE_SIZE)),
    }));
    const grid = buildWalkabilityGrid(this.tiles, buildingFootprints);
    const path = pathfindToClick(grid, startTile, clickedTile, AUTO_WALK_SNAP_RADIUS);
    if (!path || path.length === 0) {
      this.combat.showBanner('Sem caminho até ali.', 1400);
      return;
    }
    // Drop a leading waypoint that's just the tile the player is already
    // standing on — nothing to "walk toward" there.
    const toWalk = path[0].x === startTile.x && path[0].y === startTile.y ? path.slice(1) : path;
    this.autoWalkWaypoints = toWalk.map((p) => tileCenterWorld(p.x, p.y));
    this.autoWalkStuckTime = 0;
  }

  /** Converts a click/tap on the minimap canvas into world tile coordinates — the exact inverse of renderMinimapBackground's world-to-pixel scale — and kicks off a pathfind there. Reads the canvas's own displayed (CSS) size via getBoundingClientRect rather than its fixed internal MINIMAP_SIZE resolution, so this still maps correctly once the phone breakpoints in style.css shrink the minimap down (110px/90px). */
  private handleMinimapClick(ev: MouseEvent): void {
    if (!this.minimapBg || this.paused || this.dialogueNpc || this.shopNpc || this.showingTutorial) return;
    const rect = this.minimapCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const fracX = (ev.clientX - rect.left) / rect.width;
    const fracY = (ev.clientY - rect.top) / rect.height;
    if (fracX < 0 || fracX > 1 || fracY < 0 || fracY > 1) return;
    const worldX = fracX * this.minimapBg.width * TILE_SIZE;
    const worldZ = fracY * this.minimapBg.height * TILE_SIZE;
    this.startAutoWalkTo({ x: Math.floor(worldX / TILE_SIZE), y: Math.floor(worldZ / TILE_SIZE) });
  }

  /** Leaves the current zone through `exit`, arriving at its destination — a full screen rebuild, same as the old battle/respawn transitions. */
  private transitionToZone(exit: ZoneExit): void {
    this.player.zoneId = exit.toZone;
    const arrive = arriveWorldPosition(exit.arriveTile);
    this.player.mapX = arrive.x;
    this.player.mapY = arrive.z;
    saveGame(this.player);
    // Reuses the already-loaded avatar (same class, same model) instead of
    // reloading the GLTF — a zone change doesn't need to go through
    // `goToLazy`/`loadPlayerAvatar` again at all.
    this.game.goTo(new OverworldScreen(this.game, this.player, this.avatarData));
  }

  /** Rotates `current` toward `target` by at most `maxDelta` radians, the short way around the circle. */
  private turnToward(current: number, target: number, maxDelta: number): number {
    let delta = target - current;
    delta = ((delta + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (Math.abs(delta) <= maxDelta) return target;
    return current + Math.sign(delta) * maxDelta;
  }

  /** Teleports the player back to this zone's own safe spot and applies the usual defeat penalty — the in-place equivalent of BattleScreen's old handleDefeat. */
  private handleDefeat(): void {
    const respawnPos = tileCenterWorld(this.zoneRespawnTile.x, this.zoneRespawnTile.y);
    this.player.mapX = respawnPos.x;
    this.player.mapY = respawnPos.z;
    this.avatar.position.set(respawnPos.x, this.avatar.position.y, respawnPos.z);
    this.player.currentHp = Math.max(1, Math.floor(this.player.stats.maxHp * 0.5));
    this.player.currentMp = this.player.stats.maxMp;
    this.player.gold = Math.floor(this.player.gold * 0.5);
    saveGame(this.player);
  }

  // --- NPCs & dialogue --------------------------------------------------

  /**
   * NPCs render as the same rigged GLTF characters as the player (see
   * `render/npcAvatar.ts`), but loading one is async while `mount()` must
   * stay synchronous. So every NPC's slot/label/position bookkeeping is set
   * up immediately with a plain invisible placeholder standing in for
   * `.model` — every other place that reads `npcSlots[i].model.position`
   * (movement collision, interaction range, label tracking) works correctly
   * from frame one — and the placeholder is swapped for the real loaded
   * scene once its promise resolves. A one-frame (or one-network-roundtrip)
   * pop-in for a background NPC is fine; this isn't the player's own avatar,
   * which has to be fully loaded before its screen ever mounts.
   */
  private buildNpcs(): void {
    for (const def of NPC_DEFINITIONS.filter((n) => n.zoneId === this.player.zoneId)) {
      const placeholder = new THREE.Group();
      placeholder.visible = false;
      tileCenterWorld(def.mapX, def.mapY, placeholder.position);
      placeholder.rotation.y = Math.PI;
      this.scene.add(placeholder);

      // The label already tracks the NPC's exact screen position every frame
      // (updateNpcLabels), so it doubles as a tap target sitting right over
      // them — the only way to talk to an NPC on a device with no "E" key.
      // Only fires once the player has actually walked into interact range,
      // same distance gate the keyboard shortcut uses; tapping one from afar
      // is a no-op rather than teleporting the conversation to them.
      const labelEl = el('div', {
        className: 'npc-label',
        text: def.name,
        onClick: () => {
          if (this.nearbyNpc === def) this.openDialogue(def);
        },
      });
      this.game.uiRoot.append(labelEl);
      const slot: NpcSlot = { def, model: placeholder, labelEl, actor: null };
      this.npcSlots.push(slot);

      loadNpcAvatar(def)
        .then((avatar) => {
          avatar.scene.position.copy(placeholder.position);
          avatar.scene.rotation.y = Math.PI;
          this.scene.add(avatar.scene);
          this.scene.remove(placeholder);
          disposeGroup(placeholder);
          slot.model = avatar.scene;
          slot.actor = avatar.actor;
        })
        .catch((err) => {
          console.error(`Falha ao carregar avatar do NPC "${def.id}"`, err);
        });
    }
  }

  // --- ambient wildlife (real glTF asset, see public/models/CREDITS.md) --

  private spawnWildlife(): void {
    for (const tile of FOX_SPAWN_TILES) {
      if (this.tiles[tile.y]?.[tile.x] !== TileType.Grass) continue;
      this.spawnFoxAt(tile.x, tile.y);
    }
  }

  private async spawnFoxAt(tx: number, ty: number): Promise<void> {
    let model;
    try {
      model = await loadSkinnedInstance('fox.glb');
    } catch (err) {
      console.error('Falha ao carregar fox.glb', err);
      return;
    }
    const actor = new GltfActor(model);
    const sizeJitter = 0.85 + Math.random() * 0.3;
    model.scene.scale.setScalar(FOX_SCALE * sizeJitter);
    const home = tileCenterWorld(tx, ty);
    model.scene.position.copy(home);
    model.scene.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(model.scene);
    actor.play('Survey');

    this.wildlife.push({
      model: model.scene,
      actor,
      home,
      from: home.clone(),
      to: home.clone(),
      moveT: 1,
      moveDuration: 1,
      waitTimer: 1 + Math.random() * 3,
      speedScale: 0.75 + Math.random() * 0.5,
    });
  }

  private updateWildlife(dt: number): void {
    for (const fox of this.wildlife) {
      fox.actor.update(dt);

      if (fox.moveT < 1) {
        fox.moveT = Math.min(1, fox.moveT + dt / fox.moveDuration);
        fox.model.position.lerpVectors(fox.from, fox.to, fox.moveT);
        if (fox.moveT >= 1) {
          fox.actor.play('Survey');
          fox.waitTimer = 1.5 + Math.random() * 3.5;
        }
        continue;
      }

      fox.waitTimer -= dt;
      if (fox.waitTimer <= 0) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 0.6 + Math.random() * FOX_WANDER_RADIUS;
        fox.from.copy(fox.model.position);
        fox.to.set(fox.home.x + Math.cos(angle) * dist, fox.home.y, fox.home.z + Math.sin(angle) * dist);
        fox.moveDuration = fox.from.distanceTo(fox.to) / (FOX_MOVE_SPEED * fox.speedScale);
        fox.moveT = 0;
        fox.model.rotation.y = Math.atan2(fox.to.x - fox.from.x, fox.to.z - fox.from.z);
        fox.actor.play('Walk');
      }
    }
  }

  /** Drives each loaded NPC's Idle clip — cheap even at the ~15-per-zone high end, same per-instance AnimationMixer.update the ambient foxes use (see updateWildlife). Skips NPCs whose avatar hasn't finished loading yet (still on the placeholder, no actor). */
  private updateNpcActors(dt: number): void {
    for (const slot of this.npcSlots) {
      slot.actor?.update(dt);
    }
  }

  private updateNpcLabels(): void {
    for (const slot of this.npcSlots) {
      const pos = slot.model.position.clone().add(new THREE.Vector3(0, 1.55, 0));
      const p = pos.project(this.camera);
      if (p.z > 1) {
        slot.labelEl.hidden = true;
        continue;
      }
      slot.labelEl.hidden = false;
      slot.labelEl.style.left = `${(p.x * 0.5 + 0.5) * window.innerWidth}px`;
      slot.labelEl.style.top = `${(-p.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
  }

  private updateInteraction(): void {
    const found = this.npcSlots.find((s) => s.model.position.distanceTo(this.avatar.position) <= INTERACT_RANGE);
    this.nearbyNpc = found?.def ?? null;

    const foundPortal = this.dungeonPortals.find((p) => p.group.position.distanceTo(this.avatar.position) <= INTERACT_RANGE);
    this.nearbyDungeon = foundPortal?.def ?? null;
    if (this.dungeonTierPickerDungeon && this.nearbyDungeon !== this.dungeonTierPickerDungeon) this.closeDungeonTierPicker();

    const touch = isTouchDevice();
    if (this.nearbyNpc) {
      this.promptEl.hidden = false;
      this.promptEl.textContent = touch ? `Toque para falar com ${this.nearbyNpc.name}` : `[E] Falar com ${this.nearbyNpc.name}`;
    } else if (this.nearbyDungeon) {
      const alreadyCleared = (this.player.dungeonTiers[this.nearbyDungeon.id] ?? 0) > 0;
      const verb = alreadyCleared ? 'escolher o tier de' : 'entrar em';
      this.promptEl.hidden = false;
      this.promptEl.textContent = touch ? `Toque para ${verb} ${this.nearbyDungeon.name}` : `[E] ${alreadyCleared ? 'Escolher tier de' : 'Entrar em'} ${this.nearbyDungeon.name}`;
    } else {
      this.promptEl.hidden = true;
    }
  }

  private openDialogue(npc: NpcDefinition): void {
    this.dialogueNpc = npc;
    this.dialogueLineIndex = 0;
    // Unlike notifyTalkedTo below (which completes whichever quest is
    // ALREADY active), offerSideQuest can only ever START a fresh, unrelated
    // side quest (a lost NPC's own chain, a bounty), and only while
    // activeQuestId is free — see QuestSystem.offerSideQuest. Deliberately
    // run BEFORE dialogueLinesFor (the opposite order from notifyTalkedTo's
    // own placement below) so a chain that starts on this exact conversation
    // shows its own briefing line immediately, instead of this NPC's generic
    // default dialogue for one more visit.
    const sideQuestMsg = offerSideQuest(this.player, npc.id);
    // Captured BEFORE notifyTalkedTo, which can complete the active quest and
    // change activeQuestId out from under us — the lines a quest-conditioned
    // NPC shows for this conversation reflect the state the player walked up
    // with, not whatever quest they're handed immediately after.
    this.dialogueLines = dialogueLinesFor(npc, this.player.activeQuestId, this.player.completedQuestIds);
    this.dialogueOverlay.hidden = false;
    this.promptEl.hidden = true;
    this.renderDialogueLine();
    const questMsg = notifyTalkedTo(this.player, npc.id);
    if (questMsg) {
      saveGame(this.player);
      audio.questComplete();
      this.combat.showBanner(questMsg);
    } else if (sideQuestMsg) {
      saveGame(this.player);
      audio.npcTalk();
      this.combat.showBanner(sideQuestMsg);
    } else {
      audio.npcTalk();
    }
  }

  private renderDialogueLine(): void {
    if (!this.dialogueNpc) return;
    this.dialogueNameEl.textContent = this.dialogueNpc.name;
    this.dialogueLineEl.textContent = this.dialogueLines[this.dialogueLineIndex];
  }

  private advanceDialogue(): void {
    if (!this.dialogueNpc) return;
    this.dialogueLineIndex += 1;
    if (this.dialogueLineIndex >= this.dialogueLines.length) {
      this.closeDialogue();
      return;
    }
    this.renderDialogueLine();
  }

  private closeDialogue(): void {
    const npc = this.dialogueNpc;
    this.dialogueNpc = null;
    this.dialogueOverlay.hidden = true;
    this.refreshQuestTracker();
    if (npc?.vendor) this.openShop(npc);
    // The confrontation itself (talking to Ilva) already completed
    // act3_q2_confront via notifyTalkedTo above; the branching choice isn't
    // a quest objective (this schema has no branching mechanism) — it's
    // handed off here, once the player has actually read what she has to
    // say, rather than the instant the dialogue opens.
    if (npc?.id === 'ilva' && this.player.completedQuestIds.includes('act3_q2_confront') && !this.player.act3Ending) {
      this.openAct3Choice();
    }
  }

  // --- Ato 3: the branching choice (O Corte / A Cura Tentada / O Abraço) -

  private openAct3Choice(): void {
    this.act3ChoiceEl.hidden = false;
  }

  private resolveAct3Ending(ending: Act3Ending): void {
    this.player.act3Ending = ending;
    saveGame(this.player);
    this.act3ChoiceEl.hidden = true;
    this.act3EpilogueTextEl.textContent = ACT3_EPILOGUE_TEXT[ending];
    this.act3EpilogueEl.hidden = false;
  }

  private buildAct3Overlays(): void {
    const corteBtn = el('div', { className: 'btn', text: 'O Corte', onClick: () => this.resolveAct3Ending('corte') });
    const curaBtn = el('div', { className: 'btn', text: 'A Cura Tentada', onClick: () => this.resolveAct3Ending('cura') });
    const abracoBtn = el('div', { className: 'btn', text: 'O Abraço da Sede', onClick: () => this.resolveAct3Ending('abraco') });
    this.act3ChoiceEl = el('div', { className: 'panel act3-choice-overlay' }, [
      el('h2', { text: 'Uma ferida de gerações' }),
      el('p', { text: 'Ilva terminou de falar. A escolha de como lidar com a Sede — e com o que os Zeladores esconderam — agora é sua.' }),
      el('div', { className: 'stack' }, [corteBtn, curaBtn, abracoBtn]),
    ]);
    this.act3ChoiceEl.hidden = true;

    this.act3EpilogueTextEl = el('p', { text: '' });
    const closeEpilogueBtn = el('div', { className: 'btn primary', text: 'Continuar', onClick: () => { this.act3EpilogueEl.hidden = true; } });
    this.act3EpilogueEl = el('div', { className: 'panel act3-epilogue-overlay' }, [
      el('h2', { text: 'Ipêra, depois' }),
      this.act3EpilogueTextEl,
      closeEpilogueBtn,
    ]);
    this.act3EpilogueEl.hidden = true;

    this.game.uiRoot.append(this.act3ChoiceEl, this.act3EpilogueEl);
  }

  // --- first-time tutorial overlay ---------------------------------------

  /**
   * A one-time "how to play" overlay for a brand-new character — gated on
   * Player.hasSeenTutorial (persisted, so it never reappears once
   * dismissed, on this or any later mount/reload). Styled like every other
   * modal overlay in this file (.pause-overlay/.dungeon-complete-overlay);
   * only ever built here, once, and just left hidden for good afterward on
   * a character that has already seen it — cheap enough not to bother
   * skipping the DOM build entirely.
   */
  private buildTutorialOverlay(): void {
    const closeBtn = el('div', { className: 'btn primary', text: 'Entendi!', onClick: () => this.dismissTutorial() });
    this.tutorialOverlayEl = el('div', { className: 'panel tutorial-overlay' }, [
      el('h2', { text: 'Bem-vindo(a) a Ipêra' }),
      el('ul', { className: 'tutorial-steps' }, [
        el('li', { text: 'Mova-se com WASD, as setas do teclado, ou o joystick na tela.' }),
        el('li', { text: 'Enfrente as criaturas pelo caminho para ganhar XP e subir de nível.' }),
        el('li', { text: 'Siga a seta de missão para encontrar o alvo do seu objetivo atual.' }),
        el('li', { text: 'Aproxime-se de um NPC e pressione E (ou toque nele) para conversar.' }),
      ]),
      closeBtn,
    ]);
    this.tutorialOverlayEl.hidden = this.player.hasSeenTutorial;
    this.showingTutorial = !this.player.hasSeenTutorial;
    this.game.uiRoot.append(this.tutorialOverlayEl);
  }

  private dismissTutorial(): void {
    this.showingTutorial = false;
    if (this.tutorialOverlayEl) this.tutorialOverlayEl.hidden = true;
    if (!this.player.hasSeenTutorial) {
      this.player.hasSeenTutorial = true;
      saveGame(this.player);
    }
  }

  // --- dungeon instances (fixed entrance portals + the run itself) -------

  /** Drops one portal per dungeon whose fixed entrance lives in THIS zone (see DungeonDefinition.portal.hostZoneId) — a no-op zone-local list in every zone that hosts none. */
  private buildDungeonPortals(): void {
    for (const dungeon of dungeonsInHostZone(this.player.zoneId)) {
      const { group, glowMaterial } = buildDungeonPortalMesh(DUNGEON_PORTAL_GLOW);
      const pos = tileCenterWorld(dungeon.portal.atTile.x, dungeon.portal.atTile.y);
      group.position.copy(pos);
      this.scene.add(group);

      const labelEl = el(
        'div',
        {
          className: 'dungeon-portal-label',
          onClick: () => {
            if (this.nearbyDungeon === dungeon) this.interactWithDungeonPortal(dungeon);
          },
        },
        [el('div', { className: 'dname', text: dungeon.name }), el('div', { className: 'dlevel', text: `Nv. recomendado ${dungeon.recommendedLevel}` })],
      );
      this.game.uiRoot.append(labelEl);

      this.dungeonPortals.push({ def: dungeon, group, glowMaterial, labelEl });
    }
  }

  /** Keeps every portal's glow pulsing and its label tracking screen position — mirrors updateNpcLabels. */
  private updateDungeonPortals(): void {
    for (const p of this.dungeonPortals) {
      animateDungeonPortal(p.glowMaterial, this.time);

      const anchor = p.group.position.clone().add(new THREE.Vector3(0, 2.8, 0));
      const proj = anchor.project(this.camera);
      if (proj.z > 1) {
        p.labelEl.hidden = true;
        continue;
      }
      p.labelEl.hidden = false;
      p.labelEl.style.left = `${(proj.x * 0.5 + 0.5) * window.innerWidth}px`;
      p.labelEl.style.top = `${(-proj.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
  }

  /**
   * The single entry point for the portal label's click and the [E]/tap
   * interact prompt alike (see tryInteract): a dungeon never yet cleared
   * enters straight in at tier 1, exactly as before this endgame-loop
   * feature existed — only a dungeon with a recorded best-cleared tier
   * offers the tier picker instead.
   */
  private interactWithDungeonPortal(dungeon: DungeonDefinition): void {
    const bestTier = this.player.dungeonTiers[dungeon.id] ?? 0;
    if (bestTier <= 0) {
      this.enterDungeon(dungeon, 1);
      return;
    }
    this.openDungeonTierPicker(dungeon, bestTier);
  }

  /** Walks the player into a dungeon's own instance zone — same "arrive at a fixed tile" mechanics as any other zone transition, just triggered by an interact prompt instead of stepping on an exit tile. */
  private enterDungeon(dungeon: DungeonDefinition, tier: number): void {
    this.closeDungeonTierPicker();
    this.player.pendingDungeonTier = tier;
    this.player.zoneId = dungeon.zoneId;
    const arrive = arriveWorldPosition(dungeon.playerStart);
    this.player.mapX = arrive.x;
    this.player.mapY = arrive.z;
    saveGame(this.player);
    audio.encounterStart();
    this.game.goTo(new OverworldScreen(this.game, this.player, this.avatarData));
  }

  /**
   * Reuses the dungeon-portal-label's own floating, world-anchored idiom
   * (see updateDungeonPortals) instead of a whole new interaction pattern: a
   * small panel of tier rows anchored at the same portal, "Tier 1
   * (concluído)" through the player's best-cleared tier, plus exactly one
   * new tier to try next — never further, so tiers can't be skipped.
   */
  private openDungeonTierPicker(dungeon: DungeonDefinition, bestTier: number): void {
    this.closeDungeonTierPicker();
    const rows = selectableDungeonTiers(bestTier).map((tier) => {
      const cleared = tier <= bestTier;
      const label = cleared ? `Tier ${tier} (concluído)` : `Tier ${tier} (novo)`;
      return el('div', { className: 'tier-picker-row', text: label, onClick: () => this.enterDungeon(dungeon, tier) });
    });
    const capNote =
      bestTier >= DUNGEON_TIER_CAP
        ? el('div', { className: 'tier-picker-cap', text: 'Tier máximo alcançado.' })
        : null;
    const closeBtn = el('div', { className: 'tier-picker-row tier-picker-close', text: 'Cancelar', onClick: () => this.closeDungeonTierPicker() });
    this.dungeonTierPickerEl = el('div', { className: 'panel dungeon-tier-picker' }, [
      el('div', { className: 'dname', text: dungeon.name }),
      ...rows,
      capNote,
      closeBtn,
    ]);
    this.dungeonTierPickerDungeon = dungeon;
    this.game.uiRoot.append(this.dungeonTierPickerEl);
  }

  private closeDungeonTierPicker(): void {
    this.dungeonTierPickerEl?.remove();
    this.dungeonTierPickerEl = null;
    this.dungeonTierPickerDungeon = null;
  }

  /** The dungeon completion overlay's "instant warp" option — the walk-back-out corridor exit (a normal ZoneExit) works too, this just spares the walk. */
  private returnToHostZone(): void {
    const dungeon = this.activeDungeon;
    if (!dungeon) return;
    this.player.zoneId = dungeon.portal.hostZoneId;
    const arrive = arriveWorldPosition(dungeon.portal.arriveTile);
    this.player.mapX = arrive.x;
    this.player.mapY = arrive.z;
    saveGame(this.player);
    this.game.goTo(new OverworldScreen(this.game, this.player, this.avatarData));
  }

  private onDungeonEncounterCleared(index: number): void {
    if (!this.dungeonRunState) return;
    void index;
    this.dungeonRunState = recordEncounterCleared(this.dungeonRunState);
    this.refreshDungeonProgress();
    this.combat.showBanner('Emboscada eliminada!', 1600);
  }

  private onDungeonBossDefeated(): void {
    const dungeon = this.activeDungeon;
    if (!dungeon || !this.dungeonRunState || this.dungeonRunState.bossDefeated) return;
    const { state, reward } = completeDungeon(this.player, dungeon, this.dungeonRunState);
    this.dungeonRunState = state;
    saveGame(this.player);
    this.combat.showBanner(reward.message, 3200);
    if (this.dungeonCompleteMessageEl) this.dungeonCompleteMessageEl.textContent = reward.message;
    if (this.dungeonCompleteEl) this.dungeonCompleteEl.hidden = false;
  }

  private buildDungeonHud(): void {
    this.dungeonProgressEl = el('div', { className: 'dungeon-progress' });
    this.game.uiRoot.append(this.dungeonProgressEl);
    this.refreshDungeonProgress();
  }

  private refreshDungeonProgress(): void {
    if (this.dungeonProgressEl && this.dungeonRunState) {
      this.dungeonProgressEl.textContent = encounterProgressText(this.dungeonRunState);
    }
  }

  private buildDungeonCompleteOverlay(): void {
    const dungeon = this.activeDungeon;
    if (!dungeon) return;
    this.dungeonCompleteMessageEl = el('p', { text: '' });
    const returnBtn = el('div', { className: 'btn primary', text: `Retornar a ${this.zoneNameOf(dungeon.portal.hostZoneId)}`, onClick: () => this.returnToHostZone() });
    const stayBtn = el('div', { className: 'btn', text: 'Continuar explorando', onClick: () => { if (this.dungeonCompleteEl) this.dungeonCompleteEl.hidden = true; } });
    this.dungeonCompleteEl = el('div', { className: 'panel dungeon-complete-overlay' }, [
      el('h2', { text: 'Chefe derrotado!' }),
      this.dungeonCompleteMessageEl,
      el('div', { className: 'stack' }, [returnBtn, stayBtn]),
    ]);
    this.dungeonCompleteEl.hidden = true;
    this.game.uiRoot.append(this.dungeonCompleteEl);
  }

  private zoneNameOf(zoneId: string): string {
    try {
      return getZoneById(zoneId).name;
    } catch {
      return 'a vila';
    }
  }

  // --- shops (vendor NPCs: blacksmith, apothecary, artisan, jeweler) -----

  private openShop(npc: NpcDefinition): void {
    this.shopNpc = npc;
    this.shopOverlay.hidden = false;
    this.renderShop();
  }

  private closeShop(): void {
    this.shopNpc = null;
    this.shopOverlay.hidden = true;
  }

  private sellPrice(rarity: ItemRarity, itemLevel: number): number {
    return Math.round(10 * (rarityTier(rarity) + 1) * (1 + itemLevel * 0.15));
  }

  private renderShop(): void {
    const npc = this.shopNpc;
    if (!npc?.vendor) return;
    const vendor: VendorInfo = npc.vendor;

    this.shopTitleEl.textContent = `${npc.name} — ${npc.role}`;
    this.shopGoldEl.textContent = `Ouro: ${this.player.gold}`;

    const sections: HTMLElement[] = [];

    const buyRows: HTMLElement[] = [];
    for (const itemId of vendor.itemIds ?? []) {
      const item = getItemById(itemId);
      const craftGold = Math.round(item.price * 0.5);
      const craftQty = 2;
      buyRows.push(
        this.shopRow(
          item.name,
          item.description,
          item.price,
          () => {
            if (this.player.gold < item.price) return;
            this.player.gold -= item.price;
            this.player.addItem(itemId, 1);
            saveGame(this.player);
            this.renderShop();
          },
          undefined,
          {
            materialId: vendor.craftMaterialId,
            materialQty: craftQty,
            goldCost: craftGold,
            resultLabel: 'x2',
            onCraft: () => {
              if ((this.player.inventory[vendor.craftMaterialId] ?? 0) < craftQty || this.player.gold < craftGold) return;
              this.player.inventory[vendor.craftMaterialId] -= craftQty;
              if (this.player.inventory[vendor.craftMaterialId] <= 0) delete this.player.inventory[vendor.craftMaterialId];
              this.player.gold -= craftGold;
              this.player.addItem(itemId, 2);
              saveGame(this.player);
              this.renderShop();
            },
          },
        ),
      );
    }
    for (const templateId of vendor.equipmentTemplateIds ?? []) {
      const template = getEquipmentTemplate(templateId);
      const price = 60 + this.player.level * 8;
      const craftGold = Math.round(price * 0.5);
      const craftQty = 3;
      buyRows.push(
        this.shopRow(
          template.name,
          template.description,
          price,
          () => {
            if (this.player.gold < price || this.player.bagFull) return;
            this.player.gold -= price;
            this.player.addLoot(createStarterItem(templateId, 'verde', Math.max(1, this.player.level)));
            saveGame(this.player);
            this.renderShop();
          },
          undefined,
          {
            materialId: vendor.craftMaterialId,
            materialQty: craftQty,
            goldCost: craftGold,
            resultLabel: 'Raro',
            onCraft: () => {
              if ((this.player.inventory[vendor.craftMaterialId] ?? 0) < craftQty || this.player.gold < craftGold || this.player.bagFull) return;
              this.player.inventory[vendor.craftMaterialId] -= craftQty;
              if (this.player.inventory[vendor.craftMaterialId] <= 0) delete this.player.inventory[vendor.craftMaterialId];
              this.player.gold -= craftGold;
              this.player.addLoot(createStarterItem(templateId, 'azul', Math.max(1, this.player.level)));
              saveGame(this.player);
              this.renderShop();
            },
          },
          true,
        ),
      );
    }
    for (const gemId of vendor.gemIds ?? []) {
      const gem = getGemById(gemId);
      const craftGold = Math.round(gem.price * 0.5);
      const craftQty = 2;
      buyRows.push(
        this.shopRow(
          gem.name,
          gem.description,
          gem.price,
          () => {
            if (this.player.gold < gem.price) return;
            this.player.gold -= gem.price;
            this.player.addItem(gemId, 1);
            saveGame(this.player);
            this.renderShop();
          },
          gem.color,
          {
            materialId: vendor.craftMaterialId,
            materialQty: craftQty,
            goldCost: craftGold,
            resultLabel: 'x2',
            onCraft: () => {
              if ((this.player.inventory[vendor.craftMaterialId] ?? 0) < craftQty || this.player.gold < craftGold) return;
              this.player.inventory[vendor.craftMaterialId] -= craftQty;
              if (this.player.inventory[vendor.craftMaterialId] <= 0) delete this.player.inventory[vendor.craftMaterialId];
              this.player.gold -= craftGold;
              this.player.addItem(gemId, 2);
              saveGame(this.player);
              this.renderShop();
            },
          },
        ),
      );
    }
    sections.push(el('div', { className: 'shop-section' }, [el('h3', { text: 'Comprar' }), ...buyRows]));

    if (this.player.bag.length > 0) {
      const sellRows = this.player.bag.map((instance) => {
        const template = getEquipmentTemplate(instance.templateId);
        const price = this.sellPrice(instance.rarity, instance.itemLevel);
        return el(
          'div',
          { className: 'shop-row' },
          [
            el('div', { className: 'shop-row-info' }, [
              el('div', { className: 'item-name', text: `${template.name} (Nv.${instance.itemLevel})`, style: { color: rarityToHex(instance.rarity) } }),
            ]),
            el('div', {
              className: 'btn small',
              text: `Vender (${price}g)`,
              onClick: () => {
                this.player.bag = this.player.bag.filter((i) => i.uid !== instance.uid);
                if (instance.socketedGemId) this.player.addItem(instance.socketedGemId, 1);
                this.player.gold += price;
                saveGame(this.player);
                this.renderShop();
              },
            }),
          ],
        );
      });
      sections.push(el('div', { className: 'shop-section' }, [el('h3', { text: 'Vender' }), ...sellRows]));
    }

    if (vendor.kind === 'joalheiro') {
      sections.push(this.buildSocketSection());
    }

    this.shopBodyEl.replaceChildren(...sections);
  }

  private shopRow(
    name: string,
    description: string,
    price: number,
    onBuy: () => void,
    swatchColor?: number,
    craft?: { materialId: string; materialQty: number; goldCost: number; resultLabel: string; onCraft: () => void },
    requiresBagSpace = false,
  ): HTMLElement {
    const bagBlocked = requiresBagSpace && this.player.bagFull;
    const canAfford = this.player.gold >= price && !bagBlocked;
    const nameChildren: Array<HTMLElement | string> = [];
    if (swatchColor !== undefined) {
      nameChildren.push(el('span', { className: 'swatch gem-swatch', style: { background: `#${swatchColor.toString(16).padStart(6, '0')}` } }));
    }
    nameChildren.push(name);

    const buttons: HTMLElement[] = [
      el('div', {
        className: `btn small ${canAfford ? '' : 'disabled'}`,
        text: bagBlocked ? 'Mochila cheia' : `Comprar (${price}g)`,
        onClick: canAfford ? onBuy : undefined,
      }),
    ];
    if (craft) {
      const material = getMaterialById(craft.materialId);
      const owned = this.player.inventory[craft.materialId] ?? 0;
      const canCraft = owned >= craft.materialQty && this.player.gold >= craft.goldCost && !bagBlocked;
      buttons.push(
        el('div', {
          className: `btn small ${canCraft ? '' : 'disabled'}`,
          text: bagBlocked ? 'Mochila cheia' : `Fabricar → ${craft.resultLabel} (${owned}/${craft.materialQty}x ${material.name}, ${craft.goldCost}g)`,
          onClick: canCraft ? craft.onCraft : undefined,
        }),
      );
    }

    return el('div', { className: 'shop-row' }, [
      el('div', { className: 'shop-row-info' }, [
        el('div', { className: 'item-name' }, nameChildren),
        el('div', { className: 'item-rarity', text: description }),
      ]),
      el('div', { className: 'row shop-row-actions' }, buttons),
    ]);
  }

  /** Jeweler-only: socket an owned gem into an equipped item for a stat bonus and a glow. */
  private buildSocketSection(): HTMLElement {
    const ownedGems = Object.keys(this.player.inventory).filter((id) => id.startsWith('gem_') && (this.player.inventory[id] ?? 0) > 0);

    const slots: EquipmentSlot[] = ['arma', 'armadura', 'acessorio'];
    const rows: HTMLElement[] = [];
    for (const slot of slots) {
      const instance = this.player.equipment[slot];
      if (!instance) continue;
      const template = getEquipmentTemplate(instance.templateId);
      const gemBtns = ownedGems.map((gemId) => {
        const gem = getGemById(gemId);
        return el('div', {
          className: 'btn small',
          text: `${gem.name} x${this.player.inventory[gemId]}`,
          onClick: () => {
            this.player.inventory[gemId] -= 1;
            if (this.player.inventory[gemId] <= 0) delete this.player.inventory[gemId];
            if (instance.socketedGemId) this.player.addItem(instance.socketedGemId, 1);
            instance.socketedGemId = gemId;
            saveGame(this.player);
            if (slot === 'arma') this.rebuildPlayerVisual();
            this.renderShop();
          },
        });
      });
      if (instance.socketedGemId) {
        gemBtns.push(
          el('div', {
            className: 'btn small',
            text: 'Remover Gema',
            onClick: () => {
              this.player.addItem(instance.socketedGemId!, 1);
              delete instance.socketedGemId;
              saveGame(this.player);
              if (slot === 'arma') this.rebuildPlayerVisual();
              this.renderShop();
            },
          }),
        );
      }
      const actions =
        gemBtns.length > 0
          ? el('div', { className: 'row' }, gemBtns)
          : el('div', { className: 'item-rarity', text: 'Compre uma gema acima para engastar aqui.' });
      rows.push(
        el('div', { className: 'shop-row' }, [
          el('div', { className: 'shop-row-info' }, [
            el('div', {
              className: 'item-name',
              text: `${SLOT_LABELS[slot]}: ${template.name}${instance.socketedGemId ? ` (${getGemById(instance.socketedGemId).name} engastada)` : ''}`,
            }),
          ]),
          actions,
        ]),
      );
    }
    if (rows.length === 0) {
      return el('div', { className: 'shop-section' }, [
        el('h3', { text: 'Engastar Gema' }),
        el('div', { className: 'item-rarity', text: 'Equipe uma arma, armadura ou acessório primeiro.' }),
      ]);
    }
    return el('div', { className: 'shop-section' }, [el('h3', { text: 'Engastar Gema' }), ...rows]);
  }

  private buildShopOverlay(): void {
    this.shopTitleEl = el('h2', {});
    this.shopGoldEl = el('div', { className: 'subtitle' });
    this.shopBodyEl = el('div', { className: 'shop-body' });
    const closeBtn = el('div', { className: 'btn primary', text: 'Fechar', onClick: () => this.closeShop() });

    this.shopOverlay = el('div', { className: 'panel shop-overlay' }, [
      this.shopTitleEl,
      this.shopGoldEl,
      this.shopBodyEl,
      closeBtn,
    ]);
    this.shopOverlay.hidden = true;
    this.game.uiRoot.append(this.shopOverlay);
  }

  // --- camera --------------------------------------------------------

  /**
   * Pushes a candidate XZ point directly away from any tree canopy it
   * overlaps, and re-clamps it to the avatar's normal orbit distance
   * (CAMERA_RIG.distance) every pass — not just once at the end. Doing the
   * clamp only after de-penetration was itself a bug: shrinking a resolved
   * point straight back toward the avatar can walk it right back into the
   * same tree it was just pushed clear of (worse the more clearance the
   * push needed), so both constraints have to be satisfied together,
   * iterating until neither moves anything. Returns whether a violation
   * still remained after all passes (a pathologically tight cluster with
   * no spot inside CAMERA_RIG.distance that's clear of everything) so the
   * caller can fall back to lifting the camera above canopy height instead.
   *
   * Used on BOTH the freshly-computed ideal camera target AND the actual
   * rendered camera.position after it lerps toward that target — the lerp
   * itself was a gap: while walking continuously through a dense area, the
   * ideal target keeps shifting every frame, and the smoothed position
   * chasing it can visibly lag into a tree's canopy even though each
   * individual target was already clear.
   */
  /**
   * Pushes a candidate XZ point clear of one building's AABB, expanded by
   * `buffer` on every side. Unlike a tree's collision circle, a building can
   * be big enough (a 3x3-tile house, or more) that the naive "nearest point
   * on the box, then push away from it" trick breaks down once the point is
   * actually INSIDE the box: clamping x/z into range gives back the point
   * itself, so the "nearest point" distance comes out zero everywhere
   * inside, not just at the box's center — there's no single direction that
   * distance implies. Handled separately below by pushing out through
   * whichever wall is closest instead.
   */
  private pushOutOfBuildingBox(x: number, z: number, b: BuildingCollider, buffer: number): { x: number; z: number } | null {
    const insideX = x > b.minX && x < b.maxX;
    const insideZ = z > b.minZ && z < b.maxZ;
    if (insideX && insideZ) {
      const distLeft = x - b.minX;
      const distRight = b.maxX - x;
      const distTop = z - b.minZ;
      const distBottom = b.maxZ - z;
      const min = Math.min(distLeft, distRight, distTop, distBottom);
      if (min === distLeft) return { x: b.minX - buffer, z };
      if (min === distRight) return { x: b.maxX + buffer, z };
      if (min === distTop) return { x, z: b.minZ - buffer };
      return { x, z: b.maxZ + buffer };
    }
    const nx = Math.max(b.minX, Math.min(x, b.maxX));
    const nz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - nx;
    const dz = z - nz;
    const dist = Math.hypot(dx, dz);
    if (dist >= buffer) return null;
    if (dist > 0.0001) {
      const push = buffer - dist;
      return { x: x + (dx / dist) * push, z: z + (dz / dist) * push };
    }
    // On the boundary exactly — push away from the box's center instead of
    // dividing by zero.
    const bcx = (b.minX + b.maxX) / 2;
    const bcz = (b.minZ + b.maxZ) / 2;
    const toOut = Math.hypot(x - bcx, z - bcz) || 1;
    return { x: x + ((x - bcx) / toOut) * buffer, z: z + ((z - bcz) / toOut) * buffer };
  }

  /**
   * `pushMagnitude` is the total distance every pass had to shove the point
   * to clear obstacles — 0 when nothing was in the way, growing with how
   * deep the squeeze is. This exists (instead of just the boolean
   * `violated`) because a tight, irregular space like a dungeon
   * corridor/chamber doorway can flip `violated` true/false on literally
   * every single frame as the avatar (and the camera trailing it) crosses
   * the seam — driving the obstacle-lift straight off that boolean made the
   * lift height itself flicker between clear and fully-lifted several times
   * a second, a visibly janky "bug de tela" distinct from (and found after)
   * the earlier fixed-yaw fix. A continuous magnitude lets the caller ramp
   * the lift in proportional to how squeezed the camera actually is, so it
   * settles instead of flickering.
   */
  private resolveCameraXZ(x: number, z: number): { x: number; z: number; violated: boolean; pushMagnitude: number } {
    // A generous buffer, not just "clear of the canopy's own radius": the
    // camera isn't a point, it's a wide near-plane frustum, so a tree can
    // still clip into the edge of the frame even once its center is barely
    // outside the collision circle.
    const TREE_CAM_BUFFER = 1.1;
    // This is measured from the building's AABB — its WALLS' footprint —
    // but the roof overhangs past that: a hut's roof is a 4-sided cone of
    // radius 2.83 (worldBuilder.ts) sitting on a 2-tile (4-unit-wide) body,
    // so its corners stick out ~0.8 units past the collider; a house's
    // roof overhangs by ~1.2. A buffer measured only against the walls
    // and smaller than that overhang let the camera end up close enough
    // for the roof's own flat, mostly-unlit facets (low-poly cones, so a
    // few huge triangles, not a smooth dome) to fill much of the frame as
    // a giant dark wedge — reported as a "shadow bug" but it was the roof
    // geometry itself, not a shadow. Sized to clear the worst overhang
    // (house, ~1.2) plus the same near-plane-frustum margin as trees.
    const BUILDING_CAM_BUFFER = 2.2;
    const px = this.avatar.position.x;
    const pz = this.avatar.position.z;
    let violated = false;
    let pushMagnitude = 0;
    for (let pass = 0; pass < 8; pass++) {
      violated = false;
      for (const tree of this.treeColliders) {
        const ox = x - tree.x;
        const oz = z - tree.z;
        const dist = Math.hypot(ox, oz);
        const minDist = tree.radius + TREE_CAM_BUFFER;
        if (dist >= minDist) continue;
        violated = true;
        const pushDist = minDist - dist;
        pushMagnitude += pushDist;
        if (dist > 0.0001) {
          x += (ox / dist) * pushDist;
          z += (oz / dist) * pushDist;
        } else {
          // Degenerate case (candidate landed exactly on the tree's center)
          // — push back toward the avatar instead of dividing by zero.
          const toAvatar = Math.hypot(px - tree.x, pz - tree.z) || 1;
          x += ((px - tree.x) / toAvatar) * minDist;
          z += ((pz - tree.z) / toAvatar) * minDist;
        }
      }
      for (const b of this.buildingColliders) {
        const pushed = this.pushOutOfBuildingBox(x, z, b, BUILDING_CAM_BUFFER);
        if (!pushed) continue;
        violated = true;
        pushMagnitude += Math.hypot(pushed.x - x, pushed.z - z);
        x = pushed.x;
        z = pushed.z;
      }
      const distFromAvatar = Math.hypot(x - px, z - pz);
      if (distFromAvatar > CAMERA_RIG.distance) {
        const t = CAMERA_RIG.distance / distFromAvatar;
        x = px + (x - px) * t;
        z = pz + (z - pz) * t;
      }
      if (!violated) break;
    }
    return { x, z, violated, pushMagnitude };
  }

  /**
   * Places the camera behind the avatar, then steers it clear of any tree
   * canopy it would otherwise sit inside — nothing here checked for
   * obstacles at all originally, so standing next to a tree could put the
   * camera right inside its foliage: at that range a single flat-shaded
   * facet fills most of the frame as a big dark wedge, easy to mistake for
   * some giant creature's leg (or a stray dark blob floating at screen edge
   * when only part of a lobe pokes into the near plane).
   *
   * This checks against each tree's actual ground footprint (a circle)
   * rather than raycasting the low-poly mesh itself — a single ray can slip
   * past a facet that the camera's own body (and its wide near-plane
   * frustum) would still clip straight through.
   */
  /**
   * XZ + the rig's normal (unlifted) height only — the obstacle-lift
   * height is applied separately (see cameraLiftBlend) so it can be eased
   * in smoothly instead of snapped, both here and by every caller.
   */
  private desiredCameraPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const forward = new THREE.Vector3(Math.sin(CAMERA_YAW), 0, Math.cos(CAMERA_YAW));
    target
      .copy(this.avatar.position)
      .addScaledVector(forward, -CAMERA_RIG.distance)
      .add(new THREE.Vector3(0, CAMERA_RIG.height, 0));

    const resolved = this.resolveCameraXZ(target.x, target.z);
    target.x = resolved.x;
    target.z = resolved.z;
    return target;
  }

  /** this.avatar.position.y + the rig height, lifted by however much of CAM_LIFT_HEIGHT's extra clearance `blend` (0..1) currently calls for. */
  private cameraHeightFor(blend: number): number {
    return this.avatar.position.y + CAMERA_RIG.height + blend * (CAM_LIFT_HEIGHT - CAMERA_RIG.height);
  }

  private positionCameraImmediate(): void {
    this.desiredCameraPosition(this.camera.position);
    // No previous frame to ease the lift blend from at mount time — resolve
    // once and snap it straight to its correct value instead of easing in.
    const resolved = this.resolveCameraXZ(this.camera.position.x, this.camera.position.z);
    this.cameraLiftBlend = Math.min(1, resolved.pushMagnitude / CAM_LIFT_RAMP_RANGE);
    this.camera.position.y = this.cameraHeightFor(this.cameraLiftBlend);
    this.camLookAt.copy(this.avatar.position).add(new THREE.Vector3(0, CAMERA_RIG.lookHeight, 0));
    this.camera.lookAt(this.camLookAt);
  }

  private updateCamera(dt: number): void {
    const desired = this.desiredCameraPosition();
    const followLerp = 1 - Math.exp(-dt * 6);
    this.camera.position.x += (desired.x - this.camera.position.x) * followLerp;
    this.camera.position.z += (desired.z - this.camera.position.z) * followLerp;

    // The lerp above eases toward `desired`, which is only guaranteed clear
    // of trees AT THE MOMENT it was computed — while walking continuously
    // through a dense area that target shifts every frame, and the
    // easing camera can visibly lag into a canopy it hasn't caught up past
    // yet. Re-running the same push-away resolution directly on the actual
    // rendered position (not just the target it's chasing) keeps every
    // frame that's actually drawn clear, regardless of how it got there.
    //
    // The correction itself is eased, not snapped straight onto
    // camera.position — an irregular space (a dungeon chamber/corridor
    // doorway, reproduced via a scripted walk-through) can flip whether a
    // given point is "clear" or "inside a wall" on near-enough every frame
    // as the avatar crosses the seam, and snapping the FULL correction each
    // time turned that into a visible lateral jitter. A fast ease still
    // clears real clipping within a couple of frames without chasing every
    // one of those flickers to its full distance.
    const resolvedCam = this.resolveCameraXZ(this.camera.position.x, this.camera.position.z);
    const correctionLerp = 1 - Math.exp(-dt * 10);
    this.camera.position.x += (resolvedCam.x - this.camera.position.x) * correctionLerp;
    this.camera.position.z += (resolvedCam.z - this.camera.position.z) * correctionLerp;

    // Pathologically dense cluster (no spot within CAMERA_RIG.distance
    // clears every nearby tree/building) — lift the camera above obstacle
    // height instead, which clears the clip regardless of how tightly
    // packed things are horizontally. Tree canopies top out around 1.9
    // world units and most building roofs around 3.8-4.7 (see
    // worldBuilder's lobe/roof placement) — CAM_LIFT_HEIGHT clears both;
    // only the rare tower landmark's roof (~5.8) can still poke through in
    // this fallback path, an acceptable trade-off for how rarely it
    // triggers. Eased toward its target instead of snapped directly onto
    // camera.position.y (what this used to do): that hard jump was a
    // visible one-frame lurch — combined with a nearby tree/building's own
    // shadow, easy to mistake for something flashing into view — exactly
    // when squeezed by a dense cluster. Slower than the XZ followLerp on
    // purpose so the lift settles in on its own instead of fighting the
    // XZ chase in the same instant.
    //
    // Driven by the continuous pushMagnitude, not the boolean `violated` —
    // right at a chamber/corridor doorway `violated` itself can flip
    // true/false every single frame, which drove this ramp from 0 to 1 and
    // back over and over within a couple of seconds even WITH the easing
    // below (easing dampens a jittering target, it doesn't stop it from
    // being a jittering target). A magnitude that grows with how deep the
    // squeeze actually is only ramps up when there's a real, sustained
    // obstruction to clear.
    const liftTarget = Math.min(1, resolvedCam.pushMagnitude / CAM_LIFT_RAMP_RANGE);
    this.cameraLiftBlend += (liftTarget - this.cameraLiftBlend) * (1 - Math.exp(-dt * 4));
    this.camera.position.y = this.cameraHeightFor(this.cameraLiftBlend);

    const desiredLookAt = new THREE.Vector3().copy(this.avatar.position).add(new THREE.Vector3(0, CAMERA_RIG.lookHeight, 0));
    this.camLookAt.lerp(desiredLookAt, followLerp);
    this.camera.lookAt(this.camLookAt);

    this.dirLight.position.copy(this.avatar.position).add(new THREE.Vector3(6, 10, 4));
    this.dirLight.target.position.copy(this.avatar.position);
  }

  // --- HUD -------------------------------------------------------------

  private buildHud(): void {
    this.questTrackerEl = el('div', { className: 'quest-tracker', text: questTrackerText(this.player) });
    // "Different zone" case for a talkTo objective (see updateQuestIndicator)
    // — named separately from questTrackerEl so questTrackerText's own output
    // (asserted on by tests/e2e/quest.spec.ts) never has to change shape.
    this.questZoneHintEl = el('div', { className: 'quest-zone-hint', text: '' });
    this.questZoneHintEl.hidden = true;
    // Directional pointer toward the objective's world position — a single
    // reused DOM element repositioned/rotated every frame (see
    // updateQuestIndicator), same "one element, many frames" pattern as
    // every other world-anchored label in this file (dungeon portals, NPC
    // nameplates).
    this.questArrowEl = el('div', { className: 'quest-arrow' });
    this.questArrowEl.hidden = true;

    this.hpEl = el('div', { className: 'hud-hp' });
    this.mpEl = el('div', { className: 'hud-mp' });
    this.goldEl = el('div', {});
    const panel = el('div', { className: 'panel hud-panel' }, [
      el('div', { className: 'name-line', text: `${this.player.name} — ${this.player.classDef.name} Nv.${this.player.level}` }),
      this.hpEl,
      this.mpEl,
      this.goldEl,
    ]);
    this.refreshHud();

    const hint = el('div', { className: 'hud-hint', text: 'ESC: menu · M: montaria' });
    this.promptEl = el('div', { className: 'interact-prompt', text: '', onClick: () => this.tryInteract() });
    this.promptEl.hidden = true;

    // Escape opens the pause menu (Inventário/Habilidades/Ranking) on a
    // keyboard, but a touchscreen has no Escape key at all — without this
    // button those screens were completely unreachable on mobile.
    const menuBtn = el('div', { className: 'menu-btn', text: '☰', onClick: () => this.togglePause() });

    this.game.uiRoot.append(panel, hint, menuBtn, this.questTrackerEl, this.questZoneHintEl, this.questArrowEl, this.promptEl);
  }

  /** Keeps the always-visible HP/MP/gold readout live now that combat happens in-place instead of in a separate screen with its own status bar. */
  private refreshHud(): void {
    const stats = this.player.stats;
    this.hpEl.textContent = `HP ${this.player.currentHp}/${stats.maxHp}`;
    this.mpEl.textContent = `MP ${this.player.currentMp}/${stats.maxMp}`;
    this.goldEl.textContent = `Ouro: ${this.player.gold}`;
  }

  private refreshQuestTracker(): void {
    this.questTrackerEl.textContent = questTrackerText(this.player);
  }

  // --- quest-follow indicator --------------------------------------------

  /**
   * World-space (x,z) of the current quest's objective, if it has one THIS
   * SCREEN can actually point at — null for a `reachLevel` objective (no
   * location at all), a `talkTo` NPC standing in a different zone (see
   * questZoneHint for that case instead), or a `defeat` objective with
   * nothing currently alive to match. `talkTo` reads the NPC's own fixed
   * tile (data/npcs.ts); `defeat` reuses the exact live monster positions
   * the minimap's own marker layer already tracks (OverworldCombat).
   */
  private questIndicatorTarget(quest: QuestDefinition | null): { x: number; z: number } | null {
    if (!quest) return null;
    const obj = quest.objective;
    if (obj.kind === 'reachLevel') return null;
    if (obj.kind === 'talkTo') {
      const npc = getNpcById(obj.targetId!);
      if (npc.zoneId !== this.player.zoneId) return null;
      const pos = tileCenterWorld(npc.mapX, npc.mapY);
      return { x: pos.x, z: pos.z };
    }
    return this.combat.nearestAliveMonsterPosition({ x: this.avatar.position.x, z: this.avatar.position.z }, obj.targetId);
  }

  /** "Go to this zone" text for a `talkTo` objective whose NPC lives outside the player's current zone — the one case questIndicatorTarget can't offer a world position for. */
  private questIndicatorZoneHint(quest: QuestDefinition | null): string | null {
    if (!quest || quest.objective.kind !== 'talkTo') return null;
    const npc = getNpcById(quest.objective.targetId!);
    if (npc.zoneId === this.player.zoneId) return null;
    return `Siga para: ${getZoneById(npc.zoneId).name}`;
  }

  /**
   * Keeps the quest-follow arrow/hint live — called every frame (position
   * and rotation depend on the avatar's current position, which changes
   * continuously). Cheap: at most one nearest-monster scan reusing
   * OverworldCombat's own live list, no scene traversal.
   *
   * The arrow's bearing is computed analytically from the fixed camera yaw
   * (CAMERA_YAW never rotates with the avatar — see its own doc comment)
   * rather than by projecting through THREE.Camera, so it stays well-defined
   * even for a target far outside the frustum. Visibility (to decide
   * "highlight in place" vs "clamp to the edge") still uses the same
   * project()-based check every other world-anchored label in this file
   * uses (updateNpcLabels/updateDungeonPortals), so "on screen" means the
   * same thing everywhere.
   */
  private updateQuestIndicator(): void {
    const quest = currentQuest(this.player);
    const zoneHint = this.questIndicatorZoneHint(quest);
    this.questZoneHintEl.hidden = !zoneHint;
    if (zoneHint) this.questZoneHintEl.textContent = zoneHint;

    const target = this.questIndicatorTarget(quest);
    if (!target) {
      this.questArrowEl.hidden = true;
      return;
    }

    const dx = target.x - this.avatar.position.x;
    const dz = target.z - this.avatar.position.z;
    if (Math.hypot(dx, dz) < 0.05) {
      // Standing right on top of it — nothing useful to point at.
      this.questArrowEl.hidden = true;
      return;
    }

    const forward = { x: Math.sin(CAMERA_YAW), z: Math.cos(CAMERA_YAW) };
    const right = { x: -Math.cos(CAMERA_YAW), z: Math.sin(CAMERA_YAW) };
    const compForward = dx * forward.x + dz * forward.z;
    const compRight = dx * right.x + dz * right.z;
    // Screen-space bearing: +compForward reads as "up" on screen (Y grows
    // downward, hence the negation), +compRight as "right" — the exact
    // inverse of computeInputAxis's own forward/right recombination.
    const screenDX = compRight;
    const screenDY = -compForward;
    const bearingLen = Math.hypot(screenDX, screenDY) || 1;
    const dirX = screenDX / bearingLen;
    const dirY = screenDY / bearingLen;
    // 0deg = pointing up, matching the arrow glyph's own neutral orientation.
    const angleDeg = (Math.atan2(dirX, -dirY) * 180) / Math.PI;

    this.questArrowEl.hidden = false;

    const anchor = new THREE.Vector3(target.x, 1.4, target.z);
    const proj = anchor.project(this.camera);
    const onScreen = proj.z < 1 && proj.x >= -1 && proj.x <= 1 && proj.y >= -1 && proj.y <= 1;
    const w = window.innerWidth;
    const h = window.innerHeight;

    if (onScreen) {
      const sx = (proj.x * 0.5 + 0.5) * w;
      const sy = (-proj.y * 0.5 + 0.5) * h;
      this.questArrowEl.classList.add('on-target');
      this.questArrowEl.style.left = `${sx}px`;
      this.questArrowEl.style.top = `${sy}px`;
      this.questArrowEl.style.transform = 'translate(-50%, -50%) rotate(0deg)';
    } else {
      this.questArrowEl.classList.remove('on-target');
      const margin = 42;
      const halfW = w / 2 - margin;
      const halfH = h / 2 - margin;
      const scaleX = dirX !== 0 ? halfW / Math.abs(dirX) : Infinity;
      const scaleY = dirY !== 0 ? halfH / Math.abs(dirY) : Infinity;
      const scale = Math.min(scaleX, scaleY);
      const sx = w / 2 + dirX * scale;
      const sy = h / 2 + dirY * scale;
      this.questArrowEl.style.left = `${sx}px`;
      this.questArrowEl.style.top = `${sy}px`;
      this.questArrowEl.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
    }
  }

  // --- minimap -----------------------------------------------------------

  private static readonly MINIMAP_SIZE = 140;
  private static readonly MINIMAP_TILE_COLOR: Record<TileType, string> = {
    [TileType.Grass]: '#3f6b34',
    [TileType.Path]: '#c9b98a',
    [TileType.Water]: '#4a7ba6',
    [TileType.Tree]: '#173318',
  };

  private buildMinimap(): void {
    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.className = 'minimap-canvas';
    this.minimapCanvas.width = OverworldScreen.MINIMAP_SIZE;
    this.minimapCanvas.height = OverworldScreen.MINIMAP_SIZE;
    // Click/tap-to-walk — see handleMinimapClick. The minimap was purely
    // decorative before this (pointer-events: none in style.css); 'click'
    // fires for both a mouse click and a touch tap, so one listener covers
    // both without needing separate touch handling like the joystick does.
    this.minimapCanvas.addEventListener('click', (ev) => this.handleMinimapClick(ev));
    this.game.uiRoot.append(this.minimapCanvas);
    this.renderMinimapBackground();
  }

  /**
   * One tile = one pixel on an offscreen canvas, rendered once per zone
   * mount — zones can now be up to 240x150 tiles (see the world-size
   * expansion), and re-walking every tile every frame just to draw a
   * corner minimap would be pure waste when the terrain itself never
   * changes after mount. updateMinimap() just blits this (a single cheap
   * drawImage) and draws the few things that DO move on top of it.
   */
  private renderMinimapBackground(): void {
    const height = this.tiles.length;
    const width = this.tiles[0]?.length ?? 0;
    if (width === 0 || height === 0) {
      this.minimapBg = null;
      return;
    }
    const bg = document.createElement('canvas');
    bg.width = width;
    bg.height = height;
    const ctx = bg.getContext('2d')!;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        ctx.fillStyle = OverworldScreen.MINIMAP_TILE_COLOR[this.tiles[y][x]] ?? OverworldScreen.MINIMAP_TILE_COLOR[TileType.Grass];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Buildings on top, in a color distinct from every terrain tile, so
    // the village/city's actual layout of streets+houses reads at a
    // glance instead of just "some path tiles somewhere".
    ctx.fillStyle = '#8a6a45';
    for (const b of this.buildingColliders) {
      const tx = Math.floor(b.minX / TILE_SIZE);
      const ty = Math.floor(b.minZ / TILE_SIZE);
      const tw = Math.max(1, Math.ceil((b.maxX - b.minX) / TILE_SIZE));
      const th = Math.max(1, Math.ceil((b.maxZ - b.minZ) / TILE_SIZE));
      ctx.fillRect(tx, ty, tw, th);
    }
    this.minimapBg = bg;
  }

  private updateMinimap(): void {
    if (!this.minimapBg) return;
    const size = OverworldScreen.MINIMAP_SIZE;
    const ctx = this.minimapCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.minimapBg, 0, 0, size, size);

    const toMinimap = (worldX: number, worldZ: number): { x: number; y: number } => ({
      x: (worldX / TILE_SIZE / this.minimapBg!.width) * size,
      y: (worldZ / TILE_SIZE / this.minimapBg!.height) * size,
    });

    // Dungeon portals as small purple squares — unchanged from earlier work
    // this session, kept distinct from every marker kind added below.
    ctx.fillStyle = '#8a5cf5';
    for (const p of this.dungeonPortals) {
      const m = toMinimap(p.group.position.x, p.group.position.z);
      ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
    }

    // NPCs as small squares — vendor NPCs (blacksmith/apothecary/artisan/
    // jeweler) get a distinct teal so they read as "somewhere to trade" at a
    // glance, the closest thing this game has to a gatherable-resource node
    // (there's no ore/herb-node mechanic to mark instead — see this
    // session's own report). Every other NPC keeps the original yellow.
    ctx.fillStyle = '#e8d840';
    for (const slot of this.npcSlots) {
      if (slot.def.vendor) continue;
      const m = toMinimap(slot.model.position.x, slot.model.position.z);
      ctx.fillRect(m.x - 1.5, m.y - 1.5, 3, 3);
    }
    ctx.fillStyle = '#3fd9c7';
    for (const slot of this.npcSlots) {
      if (!slot.def.vendor) continue;
      const m = toMinimap(slot.model.position.x, slot.model.position.z);
      ctx.fillRect(m.x - 2, m.y - 2, 4, 4);
    }

    // Alive monsters — a small red diamond, visually distinct from every
    // dot/square above. Read fresh from OverworldCombat every frame (cheap:
    // at most a few dozen monsters per zone, the same live positions its own
    // AI already tracks) rather than snapshotting at mount time, so a
    // monster that wanders (or dies) is reflected immediately.
    ctx.fillStyle = '#d94f4f';
    for (const pos of this.combat.aliveMonsterPositions()) {
      const m = toMinimap(pos.x, pos.z);
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - 2.5);
      ctx.lineTo(m.x + 2.5, m.y);
      ctx.lineTo(m.x, m.y + 2.5);
      ctx.lineTo(m.x - 2.5, m.y);
      ctx.closePath();
      ctx.fill();
    }

    // The player, on top of everything — a small outlined dot so it stays
    // visible against both light (path) and dark (tree) terrain colors.
    const p = toMinimap(this.avatar.position.x, this.avatar.position.z);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#f2c14e';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#1a1423';
    ctx.stroke();

    // Current settlement/plaza name, as a caption strip along the bottom —
    // drawn directly on this same canvas (rather than a separate DOM label)
    // so it scales along with the minimap itself at the phone breakpoints
    // (style.css shrinks the whole canvas via CSS, this just rides along).
    // Recomputed every frame from the player's own tile — a handful of
    // bounds comparisons, not a map re-walk (see data/zones.ts's
    // subAreaNameAt), so this stays just as cheap as everything else here.
    const tileX = Math.floor(this.avatar.position.x / TILE_SIZE);
    const tileY = Math.floor(this.avatar.position.z / TILE_SIZE);
    const areaName = subAreaNameAt(this.player.zoneId, tileX, tileY);
    ctx.fillStyle = 'rgba(26, 20, 35, 0.78)';
    ctx.fillRect(0, size - 15, size, 15);
    ctx.fillStyle = '#f2ede3';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(areaName, size / 2, size - 7, size - 6);
  }

  /**
   * A draggable virtual joystick — replaces the old 4-button D-pad, whose
   * touch handling broke down the moment a finger slid from one button to
   * another (each button only released on its OWN pointerup, and touch
   * input implicitly captures the pointer to whatever element it first
   * landed on, so sliding across buttons never fired the new one's
   * pointerdown at all). A single draggable base sidesteps that entirely:
   * one pointer capture for the whole gesture, and the drag offset itself
   * IS the direction — no per-button edges to slip between.
   */
  private buildJoystick(): void {
    const RADIUS = 36; // px the knob can travel from center before clamping — tuned to the .joystick-base/.joystick-knob sizes in style.css

    const knob = el('div', { className: 'joystick-knob' });
    const base = el('div', { className: 'joystick-base' }, [knob]);
    const joystick = el('div', { className: 'joystick' }, [base]);

    const updateFromPointer = (ev: PointerEvent) => {
      const rect = base.getBoundingClientRect();
      const dx = ev.clientX - (rect.left + rect.width / 2);
      const dy = ev.clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy);
      const clampedX = dist > RADIUS ? (dx / dist) * RADIUS : dx;
      const clampedY = dist > RADIUS ? (dy / dist) * RADIUS : dy;
      knob.style.transform = `translate(${clampedX}px, ${clampedY}px)`;
      this.joystickAxis = { x: clampedX / RADIUS, z: clampedY / RADIUS };
    };

    const release = (ev: PointerEvent) => {
      if (ev.pointerId !== this.joystickPointerId) return;
      this.joystickPointerId = null;
      this.joystickAxis = null;
      knob.style.transform = 'translate(0, 0)';
    };

    base.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.joystickPointerId = ev.pointerId;
      base.setPointerCapture(ev.pointerId);
      updateFromPointer(ev);
    });
    base.addEventListener('pointermove', (ev) => {
      if (ev.pointerId === this.joystickPointerId) updateFromPointer(ev);
    });
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);

    this.game.uiRoot.append(joystick);
  }

  private buildDialogueOverlay(): void {
    this.dialogueNameEl = el('div', { className: 'dialogue-name' });
    this.dialogueLineEl = el('div', { className: 'dialogue-line' });
    // Its own click handler must stop the event from bubbling to the
    // dialogue-box's — otherwise a tap on "Pular" would also count as the
    // box's own "advance one line" click, firing both in the same gesture.
    const skipBtn = el('div', {
      className: 'dialogue-skip',
      text: 'Pular »',
      onClick: (ev) => {
        ev.stopPropagation();
        this.closeDialogue();
      },
    });
    this.dialogueOverlay = el(
      'div',
      { className: 'panel dialogue-box', onClick: () => this.advanceDialogue() },
      [
        this.dialogueNameEl,
        this.dialogueLineEl,
        el('div', { className: 'dialogue-hint', text: '(toque, E ou Enter para continuar)' }),
        skipBtn,
      ],
    );
    this.dialogueOverlay.hidden = true;
    this.game.uiRoot.append(this.dialogueOverlay);
  }

  private buildPauseOverlay(): void {
    const resumeBtn = el('div', { className: 'btn primary', text: 'Continuar Jogando', onClick: () => this.togglePause() });
    const skillsBtn = el('div', {
      className: 'btn',
      text: 'Árvore de Habilidades',
      onClick: () => {
        saveGame(this.player);
        goToLazy(this.game, async () => {
          const { SkillTreeScreen } = await import('./SkillTreeScreen');
          return new SkillTreeScreen(this.game, this.player);
        });
      },
    });
    const inventoryBtn = el('div', {
      className: 'btn',
      text: 'Inventário',
      onClick: () => {
        saveGame(this.player);
        goToLazy(this.game, async () => {
          const { InventoryScreen } = await import('./InventoryScreen');
          return new InventoryScreen(this.game, this.player);
        });
      },
    });
    const rankingBtn = el('div', {
      className: 'btn',
      text: 'Ranking (estimado)',
      onClick: () => {
        saveGame(this.player);
        goToLazy(this.game, async () => {
          const { RankingScreen } = await import('./RankingScreen');
          return new RankingScreen(this.game, this.player);
        });
      },
    });
    const questLogBtn = el('div', {
      className: 'btn',
      text: 'Missões',
      onClick: () => {
        saveGame(this.player);
        goToLazy(this.game, async () => {
          const { QuestLogScreen } = await import('./QuestLogScreen');
          return new QuestLogScreen(this.game, this.player);
        });
      },
    });
    const exitBtn = el('div', {
      className: 'btn',
      text: 'Salvar e Sair ao Menu',
      onClick: () => {
        saveGame(this.player);
        goToLazy(this.game, async () => {
          const { MainMenuScreen } = await import('./MainMenuScreen');
          return new MainMenuScreen(this.game);
        });
      },
    });

    this.mountSectionEl = el('div', { className: 'stack' });

    this.pauseOverlay = el('div', { className: 'panel pause-overlay' }, [
      el('h2', { text: 'Pausado' }),
      el('div', { className: 'stack' }, [resumeBtn, inventoryBtn, skillsBtn, rankingBtn, questLogBtn]),
      el('div', { className: 'pause-divider' }),
      this.mountSectionEl,
      el('div', { className: 'pause-divider' }),
      el('div', { className: 'stack' }, [exitBtn]),
    ]);
    this.pauseOverlay.hidden = true;
    this.game.uiRoot.append(this.pauseOverlay);
    this.refreshMountSection();
  }

  private refreshMountSection(): void {
    if (!this.mountSectionEl) return;
    const buttons: HTMLElement[] = [];
    for (const mountId of this.player.unlockedMounts) {
      const def = getMountById(mountId);
      const active = this.player.activeMountId === mountId;
      buttons.push(
        el('div', {
          className: `btn ${active ? 'primary' : ''}`,
          text: active ? `Montado: ${def.name}` : `Montar ${def.name} (${def.kind})`,
          onClick: () => this.setMounted(active ? null : mountId),
        }),
      );
    }
    if (this.player.activeMountId) {
      buttons.push(el('div', { className: 'btn', text: 'Desmontar', onClick: () => this.setMounted(null) }));
    }
    this.mountSectionEl.replaceChildren(...buttons);
  }

  private togglePause(): void {
    if (this.showingTutorial) return;
    this.paused = !this.paused;
    this.pauseOverlay.hidden = !this.paused;
    if (this.paused) saveGame(this.player);
  }
}
