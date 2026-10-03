import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { TILE_SIZE } from '../config/gameConfig';
import { isWalkable, TileType } from '../config/tiles';
import { createStarterItem, generateLoot, getEquipmentTemplate } from '../data/equipment';
import { chestsInZone, type ChestDefinition } from '../data/chests';
import { getGemById } from '../data/gems';
import { getItemById } from '../data/items';
import { getMaterialById } from '../data/materials';
import { getMountById } from '../data/mounts';
import { dialogueLinesFor, getNpcById, NPC_DEFINITIONS, type NpcDefinition, type VendorInfo } from '../data/npcs';
import {
  arriveWorldPosition,
  BALUARTE_AMANHECER_ID,
  effectiveMonsterCount,
  getZoneById,
  MAIN_CITY_ID,
  monsterFreeAreas,
  subAreaNameAt,
  type ZoneDefinition,
  type ZoneExit,
} from '../data/zones';
import { dungeonsInHostZone, getDungeonById, getDungeonByZoneId, type DungeonDefinition } from '../data/dungeons';
import { rarityTier, rarityToHex } from '../config/rarity';
import type { EquipmentSlot, ItemRarity } from '../config/types';
import { Player, type Act3Ending } from '../entities/Player';
import type { CharacterAnimatorLike } from '../render/animation';
import { GltfCharacterAnimator } from '../render/gltfCharacterAnimator';
import { allMountModelFiles, loadMountVisual } from '../render/mountModel';
import { animateDungeonPortal, buildDungeonPortalMesh } from '../render/dungeonPortal';
import { animateChestGlow, buildTreasureChestMesh, setChestOpened, type TreasureChestMesh } from '../render/treasureChest';
import { GltfActor, loadSkinnedInstance } from '../render/gltfModel';
import { loadNpcAvatar } from '../render/npcAvatar';
import { WildlifeManager } from '../render/wildlife';
import { pickWildlifeLayout } from '../systems/wildlifePlacement';
import { applyWeaponGem, type PlayerAvatar } from '../render/playerAvatar';
import { animateWaterMaterial, buildOverworldMeshes, tileCenterWorld, type BuildingCollider, type TreeCollider } from '../render/worldBuilder';
import { OverworldCombat } from '../systems/OverworldCombat';
import { buildWalkabilityGrid, findNearestWalkable, pathfindToClick } from '../systems/Pathfinding';
import { completeDungeon, encounterProgressText, recordEncounterCleared, startDungeonRun, type DungeonRunState } from '../systems/DungeonSystem';
import { DUNGEON_TIER_CAP, dungeonTierStatMultiplier, selectableDungeonTiers } from '../systems/DungeonTierSystem';
import {
  activeQuests,
  ensureAct3Started,
  ensureAmaraRevealStarted,
  ensureClassCallingStarted,
  ensureQuestStarted,
  notifyTalkedTo,
  offerSideQuest,
  questTrackerText,
} from '../systems/QuestSystem';
import { advanceGameClock, dayNightFactor, formatTimeOfDay, isNight } from '../systems/GameClock';
import { getZoneState, worldMoodFactor } from '../systems/WorldStateSystem';
import type { QuestDefinition } from '../data/quests';
import { saveGame } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { el, goToLazy } from '../ui/dom';
import { isTouchDevice } from '../ui/device';
import { buildGlobeIconSvg, buildWorldMapOverlay, type WorldMapOverlayHandle } from '../ui/worldMap';

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
 * Selectable third-person camera angle/distance presets, cycled one at a
 * time via the eye button below the minimap (see cycleCameraAngle) — never
 * automatically. Index 0 is the pre-existing default rig verbatim (same
 * distance/height/lookHeight this screen always used), so a player who
 * never touches the button sees no change at all.
 *
 * Every preset keeps the exact same CAMERA_YAW azimuth (see that constant's
 * own doc comment) — they vary only distance/height/lookHeight, never the
 * orbit angle itself. That's deliberate: computeInputAxis's screen-relative
 * input mapping and updateQuestIndicator's arrow bearing are both keyed off
 * CAMERA_YAW too, so leaving it untouched means switching presets can never
 * desync "which way is forward on screen" from what's actually rendered,
 * and can't reintroduce the "camera spins behind a moving character"
 * disorientation a continuously-rotating camera caused before (see
 * CAMERA_YAW's own history). The player's actual complaint (front of the
 * character being hard to read at the default angle) is instead addressed
 * by giving them a closer, lower, near-eye-level option and a pulled-back
 * overview, each a deliberate, readable angle rather than an automatic
 * re-orientation.
 */
const CAMERA_RIG_PRESETS: { distance: number; height: number; lookHeight: number; label: string }[] = [
  // Padrão — unchanged from the previous single fixed rig. Pulled back and
  // raised above the old close chase-cam below so roadside building roofs
  // (low-poly cones — a hut roof is literally a 4-sided pyramid) don't loom
  // into frame as a huge dark wedge; see the buffer fix in resolveCameraXZ.
  { distance: 7.5, height: 6.5, lookHeight: 0.9, label: 'Padrão' },
  // Próxima — the game's original chase-cam, before the pull-back above.
  // Closer and nearer eye level, so the avatar (and its facing) reads much
  // bigger on screen — the option for a player who wants to actually see
  // the character's front rather than an overview of the area around them.
  { distance: 4.4, height: 3.1, lookHeight: 1.1, label: 'Próxima' },
  // Panorâmica — pulled back and raised well past the default into a wide,
  // near top-down overview: more of the surrounding area in frame at once,
  // at the cost of the character itself reading much smaller.
  { distance: 11.5, height: 12.5, lookHeight: 0.7, label: 'Panorâmica' },
];
/** How far above the avatar (world units) the fallback camera lift adds on top of whichever preset's own height is currently active, when no spot within its distance clears every nearby tree/building — see desiredCameraPosition/updateCamera/cameraHeightFor. A flat extra (not itself a function of the active preset) so every preset gets the same amount of "lift clearance" headroom regardless of how close or far its own base height already is. */
const CAM_LIFT_EXTRA = 2.0;
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
// Per-mount seat offset/scale/hover height now live with the glTF creature
// itself in render/mountModel.ts (MountVisualConfig) — a goat and a
// pterodactyl need very different numbers, so one flat constant here no
// longer fits both.

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

interface ChestSlot {
  def: ChestDefinition;
  mesh: TreasureChestMesh;
  labelEl: HTMLElement;
  opened: boolean;
}

/**
 * A single hand-placed "must be sought out" encounter (see
 * OverworldCombat.spawnFixedMonster) — a troll standing distinctively at the
 * pond's edge in Pedravale's own field, well clear of the pond's water
 * ellipse and every plaza/gate/street, rather than blending into
 * spawnMonsters' anonymous scatter. Ties into the "Contrato: O Troll da
 * Lagoa" bounty (data/quests.ts) — Bram's dialogue points here directly.
 * Grass-checked at spawn time, so a future map
 * change can't silently bury it in a tree.
 */
const LAGOA_TROLL_TILE = { x: 58, y: 22 };

/**
 * q6_dragon's own "defeat young_dragon" objective had no live monster to
 * ever point at: `young_dragon` is deliberately excluded from every zone's
 * random scatter (see data/zones.ts's own comment on Baluarte do Amanhecer —
 * it's the story's one-of-a-kind corrupted guardian, not filler) but nothing
 * ever placed a hand-picked instance of it anywhere either, so the quest's
 * arrow/minimap marker (updateQuestIndicator) always came up empty and the
 * quest itself could never actually complete. Baluarte do Amanhecer — the
 * toughest regular field in the game, a frontier fort nobody has kept up for
 * generations — is exactly the zone that comment already earmarks for it.
 * Tile picked (and grass-checked, same as LAGOA_TROLL_TILE)
 * well clear of the fort's own buildings and spawn point, so it reads as a
 * ruin tucked into the tree line rather than something in the player's face
 * on arrival.
 */
const BALUARTE_DRAGON_TILE = { x: 44, y: 21 };

/**
 * "Siga para: X" cross-zone hint for a `defeat` objective, mirroring the one
 * `questIndicatorZoneHint` already gives `talkTo` — but a monster has no
 * single fixed home the way an NPC does (most wander whatever zone's random
 * scatter placed them in), so this only covers targets that DO have exactly
 * one home: today, `young_dragon` (see BALUARTE_DRAGON_TILE above). Add an
 * entry here for any future one-of-a-kind fixed encounter (spawnFixedMonster)
 * that a quest asks the player to defeat, so it never repeats this same
 * "quest exists, nothing points to it" gap.
 */
const DEFEAT_TARGET_HOME_ZONE: Record<string, string> = {
  young_dragon: BALUARTE_AMANHECER_ID,
};

/**
 * Frees GPU-side geometry/material/texture buffers for every Mesh under
 * `group` — NOT for a group holding GLTF-loaded clones (NPCs, the player
 * avatar, wildlife: see gltfModel.ts's `loadSkinnedInstance`/`loadNpcAvatar`,
 * which clone the scene graph via SkeletonUtils but reuse the SAME
 * geometry/material objects across every clone and the cached base model —
 * disposing those would corrupt every other live instance of that rig, not
 * just this one). Only ever call this on purely procedural content this
 * screen itself builds fresh every mount and nothing else references:
 * terrain/trees/buildings (worldBuilder.ts), dungeon portals, treasure
 * chests. `.map` is disposed explicitly — Material.dispose() does not
 * dispose textures assigned to it (grass/path ground textures are canvas
 * textures built fresh per zone; only `.map` is ever used in this codebase).
 */
function disposeGroup(group: THREE.Object3D): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      }
    }
  });
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds the small eye glyph for the camera-angle toggle button (see cycleCameraAngle) — a plain almond-eye outline plus a pupil, built the same way (currentColor, createElementNS) InventoryScreen's own equipment icons are, rather than sourcing external art or an emoji glyph that renders inconsistently across platforms. currentColor means it automatically follows the button's own text color, including the accent tint applied while a non-default angle is active. */
function buildEyeIconSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 32 20');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '14');
  svg.setAttribute('aria-hidden', 'true');
  const outline = document.createElementNS(SVG_NS, 'path');
  outline.setAttribute('d', 'M1 10 C6 2, 26 2, 31 10 C26 18, 6 18, 1 10 Z');
  outline.setAttribute('fill', 'none');
  outline.setAttribute('stroke', 'currentColor');
  outline.setAttribute('stroke-width', '2.4');
  outline.setAttribute('stroke-linejoin', 'round');
  const pupil = document.createElementNS(SVG_NS, 'circle');
  pupil.setAttribute('cx', '16');
  pupil.setAttribute('cy', '10');
  pupil.setAttribute('r', '4.6');
  pupil.setAttribute('fill', 'currentColor');
  svg.append(outline, pupil);
  return svg;
}

export class OverworldScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private tiles: TileType[][] = [];
  private waterMaterial: THREE.MeshStandardMaterial | null = null;
  private treeColliders: TreeCollider[] = [];
  private buildingColliders: BuildingCollider[] = [];
  /** The procedural terrain/tree/building group built fresh every mount (buildOverworldMeshes) — kept so unmount() can dispose its GPU resources; see disposeGroup's own doc comment for why this is safe here but never for NPCs/wildlife/the player avatar. */
  private terrainGroup!: THREE.Group;
  private minimapCanvas!: HTMLCanvasElement;
  /** One tile-per-pixel render of the current zone's terrain, built once per mount — updateMinimap() blits this (cheap) instead of re-walking the whole tile grid every frame. */
  private minimapBg: HTMLCanvasElement | null = null;
  /** True while the tap-to-expand minimap overlay is open (see setMinimapExpanded) — the small corner minimap's own click still does click-to-walk exactly as before; this is a completely separate affordance (the small expand badge overlaid on its corner). Gates movement/interaction in update() the same way paused/dialogueNpc/shopNpc/showingTutorial already do, so the avatar can't wander unseen while the player is looking at the big map. */
  private minimapExpanded = false;
  private minimapExpandBtn!: HTMLElement;
  private minimapBackdropEl!: HTMLElement;
  private minimapCloseBtn!: HTMLElement;
  /** The minimap's second corner badge — opens the "Mapa Mundi" world-map overlay (see openWorldMap). */
  private worldMapOpenBtn!: HTMLElement;
  /** Built lazily on first open (see openWorldMap) — a player who never looks at it never pays for its DOM. */
  private worldMap: WorldMapOverlayHandle | null = null;
  /** True while the world-map overlay is up — gates movement/combat in update() exactly like minimapExpanded does. */
  private worldMapOpen = false;
  /** Whether the pause menu was showing when the world map was opened from it — closeWorldMap puts it back, so closing reads as "back" rather than dropping straight into gameplay. */
  private worldMapReturnToPause = false;
  private playerModel!: THREE.Group;
  private mountModel: THREE.Group | null = null;
  /** Drives the currently-mounted creature's own idle/walk clip (see animateMount) — null whenever unmounted. */
  private mountActor: GltfActor | null = null;
  /** Bumped on every setMounted(...) call that starts a mount load — see attachMountVisual's own comment on why a stale load must be able to tell it lost the race. */
  private mountLoadToken = 0;
  /** Whichever object currently moves through the world — the rider alone, or the mount carrying them. */
  private avatar!: THREE.Object3D;
  private animator!: CharacterAnimatorLike;
  private dirLight!: THREE.DirectionalLight;
  private ambientLight!: THREE.AmbientLight;
  private hemiLight!: THREE.HemisphereLight;
  /** Cache of the last-applied worldMoodFactor/dayNightFactor (see applyWorldMood) — lets the per-frame check in update() skip re-writing light intensities/the vignette uniform when NEITHER has genuinely moved since. -1 (impossible for either 0..1 factor) forces the first call after mount to always apply. Once the game clock is actively advancing, dayNightFactor changes continuously, so this mostly only skips real work while paused/idle — mood alone used to be the only reason to ever write these. */
  private lastAppliedWorldMood = -1;
  private lastAppliedDayNight = -1;
  private npcSlots: NpcSlot[] = [];
  /** Ambient, non-attackable creatures and flower patches — see render/wildlife.ts. Null inside a dungeon. */
  private wildlife: WildlifeManager | null = null;
  private combat!: OverworldCombat;
  private zoneDef!: ZoneDefinition;
  private zoneRespawnTile = { x: 5, y: 5 };
  private time = 0;

  private dungeonPortals: DungeonPortalSlot[] = [];
  private nearbyDungeon: DungeonDefinition | null = null;
  private chestSlots: ChestSlot[] = [];
  private nearbyChest: ChestDefinition | null = null;
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

  /** Which CAMERA_RIG_PRESETS entry is active — cycled by the eye button (see cycleCameraAngle). 0 (the pre-existing default) unless the player has pressed it. */
  private cameraAngleIndex = 0;
  private cameraAngleBtn!: HTMLElement;
  /**
   * The rig values updateCamera actually renders with this frame — start
   * equal to the default preset, then ease toward whichever preset
   * cameraAngleIndex points at (see updateCamera's own rigLerp). Separate
   * mutable fields (not just reading CAMERA_RIG_PRESETS[cameraAngleIndex]
   * directly) so switching presets eases smoothly over a few frames instead
   * of snap-cutting distance/height/lookHeight the instant the button is
   * pressed, the same way the camera already eases toward the avatar's
   * position every frame rather than snapping to it.
   */
  private camDistance = CAMERA_RIG_PRESETS[0].distance;
  private camHeight = CAMERA_RIG_PRESETS[0].height;
  private camLookHeight = CAMERA_RIG_PRESETS[0].lookHeight;

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
  // Reusable scratch vectors for the per-frame camera math below
  // (desiredCameraPosition/updateCamera) — these used to be `new
  // THREE.Vector3(...)` every single call, allocating garbage every frame
  // regardless of whether anything actually moved. Safe to share across
  // calls because each is fully consumed (read out into camera.position/
  // dirLight.position) before the next frame reuses it — never held across
  // frames or read after being overwritten.
  private scratchCamForward = new THREE.Vector3();
  private scratchDesiredCamPos = new THREE.Vector3();
  private scratchLookAt = new THREE.Vector3();
  /** Constant offset, never mutated — safe to `.add()` (which doesn't touch its argument) every frame without recreating it. */
  private readonly scratchDirLightOffset = new THREE.Vector3(6, 10, 4);
  /** Shared by updateNpcLabels/updateDungeonPortals/updateChests — all three run sequentially in update(), each fully finishing (reading the projected x/y into a label's CSS position) before the next entity or method reuses it. */
  private scratchLabelAnchor = new THREE.Vector3();

  private paused = false;
  private dialogueNpc: NpcDefinition | null = null;
  private dialogueLineIndex = 0;
  /** The lines actually shown for this conversation — captured at open time via dialogueLinesFor, before notifyTalkedTo can mutate quest state out from under them. */
  private dialogueLines: string[] = [];
  private nearbyNpc: NpcDefinition | null = null;
  private shopNpc: NpcDefinition | null = null;

  private promptEl!: HTMLElement;
  private nameLineEl!: HTMLElement;
  private hpEl!: HTMLElement;
  private mpEl!: HTMLElement;
  private goldEl!: HTMLElement;
  private clockEl!: HTMLElement;
  /** Thin always-on bar pinned to the bottom of the screen — its inner fill's width is set by refreshHud() to player.xp/xpToNextLevel, so a kill's XP gain reads as immediate visible progress even between level-ups. */
  private xpBarFillEl!: HTMLElement;
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
    this.terrainGroup = group;
    this.scene.add(group);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.hemiLight = new THREE.HemisphereLight(0x8ec9e8, 0x4c8a3f, 0.55);
    this.scene.add(this.ambientLight, this.hemiLight);
    this.applyWorldMood();

    this.dirLight = new THREE.DirectionalLight(0xfff4e0, 1.0);
    this.dirLight.castShadow = true;
    // Halved on phones/tablets (see Game.lowPowerTier) — this map re-renders
    // every frame (the frustum recenters on the avatar below), so its
    // resolution is a continuous per-frame cost, not a one-time one.
    const shadowRes = this.game.lowPowerTier ? 1024 : 2048;
    this.dirLight.shadow.mapSize.set(shadowRes, shadowRes);
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

    this.prefetchMountModels();
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

    if (!this.activeDungeon) {
      this.wildlife = new WildlifeManager(this.scene, (x, z) => this.canOccupy(x, z, 0.2, false));
      this.wildlife.spawn(
        pickWildlifeLayout(tiles, {
          start: playerStart,
          // Off building footprints (tiles under a building are still
          // nominally grass — see canOccupy) and out of Pedravale's town
          // districts, so herds and flower beds read as the countryside.
          avoid: [...monsterFreeAreas(this.zoneDef.id), ...buildings.map((b) => ({ x0: b.x - 1, y0: b.y - 1, x1: b.x + b.w, y1: b.y + b.h }))],
          lowPower: this.game.lowPowerTier,
        }),
      );
    }
    this.buildDungeonPortals();
    this.buildChests();
    this.positionCameraImmediate();

    this.combat = new OverworldCombat(this.game, this.player, this.scene, this.animator, () => this.handleDefeat(), this.playerModel);
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
        count: effectiveMonsterCount(this.zoneDef, getZoneState(this.player.worldState, this.zoneDef.id)),
        enemyIds: this.zoneDef.monsterIds,
        minDistFromStart: this.zoneDef.monsterIds ? 3 : undefined,
        minSpacing: this.zoneDef.monsterIds ? 2 : undefined,
        packWeights: this.zoneDef.packWeights,
        avoid: monsterFreeAreas(this.zoneDef.id),
      });
      if (this.player.zoneId === MAIN_CITY_ID && tiles[LAGOA_TROLL_TILE.y]?.[LAGOA_TROLL_TILE.x] === TileType.Grass) {
        this.combat.spawnFixedMonster('troll', LAGOA_TROLL_TILE);
      }
      if (this.player.zoneId === BALUARTE_AMANHECER_ID && tiles[BALUARTE_DRAGON_TILE.y]?.[BALUARTE_DRAGON_TILE.x] === TileType.Grass) {
        this.combat.spawnFixedMonster('young_dragon', BALUARTE_DRAGON_TILE);
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

    // Every zone travel / dungeon enter / dungeon exit constructs a brand
    // new OverworldScreen (each with its own `scene`), so the outgoing one's
    // whole scene graph becomes unreachable once Game.goTo swaps `current` —
    // but the renderer's GPU-side buffers for any geometry/material/texture
    // that was never disposed live on regardless (dispose() is what tells
    // the renderer to free them; letting the JS object itself get GC'd does
    // not). Without this, every single zone hop leaked the outgoing zone's
    // entire terrain — a real, repeated cost in a dungeon-crawling ARPG,
    // and the kind of thing that shows up as progressive slowdown over a
    // long session on a weaker/mobile GPU. NPCs/wildlife/the player avatar
    // are deliberately left alone — see disposeGroup's own doc comment.
    disposeGroup(this.terrainGroup);
    this.wildlife?.dispose();
    for (const p of this.dungeonPortals) disposeGroup(p.group);
    for (const c of this.chestSlots) disposeGroup(c.mesh.group);
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;

    if (!this.paused && !this.dialogueNpc && !this.shopNpc && !this.showingTutorial && !this.minimapExpanded && !this.worldMapOpen) {
      advanceGameClock(this.player.gameClock, dt);
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
    this.wildlife?.update(dt, this.avatar.position, isNight(this.player.gameClock));
    this.updateNpcActors(dt);
    this.updateNpcSchedules();
    this.updateCamera(dt);
    this.updateNpcLabels();
    this.updateDungeonPortals();
    this.updateChests();
    this.updateMinimap();
    this.updateQuestIndicator();
    this.refreshHud();
    // Was only ever re-rendered when a dialogue closed — a kill toward a
    // "derrote inimigos (N/total)" objective updated player.questProgress
    // immediately (see QuestSystem.notifyEnemyDefeated) but the tracker text
    // itself sat frozen at whatever it showed on mount until the player next
    // talked to someone. Cheap enough (one string build) to just run every
    // frame like refreshHud already does.
    this.refreshQuestTracker();
    this.applyWorldMood();
  }

  /**
   * Blends two independent 0..1 signals into the overworld's ambient/
   * hemisphere light and the shared vignette darkness:
   *  - worldMoodFactor(player.worldState) — 0 = as dark/oppressive as
   *    Ipêra's corrupted baseline, 1 = fully hopeful/restored. Only moves
   *    when a quest/choice changes corruption/hope, so it's a slow nudge.
   *  - dayNightFactor(player.gameClock) — 0 = deep night, 1 = full midday
   *    (see systems/GameClock.ts). Changes continuously while the clock
   *    runs, so THIS is now the dominant swing (a day/night cycle should
   *    read as a real, visible change, not a subtle nudge) — mood stays a
   *    smaller nudge on top of it, same shape as before day/night existed.
   * At mood=0.5 and dayNight=0.5 (dawn/dusk, the cosine curve's own
   * midpoint) this reproduces the exact original tuned defaults — the same
   * "invisible at neutral" property the mood-only version had, just anchored
   * to neutral TIME as well as neutral mood now.
   */
  private applyWorldMood(): void {
    const mood = worldMoodFactor(this.player.worldState);
    const dayNight = dayNightFactor(this.player.gameClock);
    if (Math.abs(mood - this.lastAppliedWorldMood) < 0.001 && Math.abs(dayNight - this.lastAppliedDayNight) < 0.001) return;
    this.lastAppliedWorldMood = mood;
    this.lastAppliedDayNight = dayNight;
    const moodDelta = (mood - 0.5) * 2; // -1 (fully corrupted) .. 1 (fully hopeful)
    const dayNightDelta = (dayNight - 0.5) * 2; // -1 (deep night) .. 1 (full midday)
    this.ambientLight.intensity = 0.4 + dayNightDelta * 0.22 + moodDelta * 0.12;
    this.hemiLight.intensity = 0.55 + dayNightDelta * 0.25 + moodDelta * 0.12;
    this.game.setVignetteDarkness(1.15 - dayNightDelta * 0.25 - moodDelta * 0.15);
  }

  private animateWater(): void {
    if (this.waterMaterial) animateWaterMaterial(this.waterMaterial, this.time);
  }

  /** Drives the mounted creature's own baked idle/walk clip — real animation from its glTF (see render/mountModel.ts), not the old hand-coded wing-flap sine wave. */
  private animateMount(dt: number): void {
    if (!this.mountActor) return;
    this.mountActor.play(this.isMoving ? 'walk' : 'idle');
    this.mountActor.update(dt);
  }

  // --- input -----------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    this.heldKeys.add(e.key.toLowerCase());

    if (this.showingTutorial) {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') this.dismissTutorial();
      return;
    }

    // Escape (a keyboard-only equivalent of tapping the close badge/backdrop)
    // dismisses the expanded minimap instead of opening the pause menu —
    // matches the "tap again/tap X/tap outside" dismissal the touch overlay
    // already offers, without also pausing (and saving) underneath it.
    if (this.minimapExpanded) {
      if (e.key === 'Escape') this.setMinimapExpanded(false);
      return;
    }

    // Same for the world map — Escape closes it (back to the pause menu if
    // that's where it was opened from), and swallows every other key so
    // nothing (E, M, a skill hotkey) acts on the frozen world behind it.
    if (this.worldMapOpen) {
      if (e.key === 'Escape') this.closeWorldMap();
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
    else if (this.nearbyChest) this.openChest(this.nearbyChest);
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

    // Bumped unconditionally (mount OR dismount) so a still-in-flight
    // attachMountVisual from whatever the player asked for just before this
    // call can tell it lost the race — see that method's own comment. Without
    // this, mounting then immediately dismounting before the glTF finished
    // loading would silently attach the mount right after the dismount, with
    // nothing on screen showing anything happened in between.
    this.mountLoadToken++;

    if (mountId === null) {
      const wasMounted = this.mountModel !== null || this.player.activeMountId !== null;
      if (!wasMounted) return;
      this.player.setMount(null);
      if (this.mountModel) {
        const worldPos = new THREE.Vector3();
        this.mountModel.getWorldPosition(worldPos);
        this.mountModel.remove(this.playerModel);
        this.scene.remove(this.mountModel);
        disposeGroup(this.mountModel);
        this.mountModel = null;
        this.mountActor = null;
        this.playerModel.position.copy(worldPos);
        this.playerModel.position.y = 0;
        this.scene.add(this.playerModel);
        this.avatar = this.playerModel;
      }
      if (instant) this.animator.setMounted(false);
      else {
        this.animator.setMounted(false);
        this.animator.play('dismount');
      }
    } else {
      if (this.mountModel) this.setMounted(null, true);

      const worldPos = new THREE.Vector3();
      this.avatar.getWorldPosition(worldPos);
      const facingY = this.avatar.rotation.y;
      this.player.setMount(mountId);
      // The glTF creature load is async (network fetch + parse the first
      // time; near-instant afterwards via loadSkinnedInstance's own cache —
      // see prefetchMountModels), so the actual scene swap happens in
      // attachMountVisual once it resolves.
      const token = this.mountLoadToken;
      void this.attachMountVisual(mountId, worldPos, facingY, instant, token);
    }
    if (!instant) audio.mountToggle();
    this.refreshMountSection();
  }

  /** The async second half of mounting — see setMounted's else-branch. Builds the real glTF creature, seats the rider on its back at that mount's own tuned offset (see `render/mountModel.ts`'s `MountVisualConfig`), and starts its idle/walk animation. */
  private async attachMountVisual(
    mountId: string,
    worldPos: THREE.Vector3,
    facingY: number,
    instant: boolean,
    token: number,
  ): Promise<void> {
    let visual;
    try {
      visual = await loadMountVisual(mountId);
    } catch (err) {
      console.error(`Falha ao carregar o modelo da montaria "${mountId}"`, err);
      return;
    }
    // The player cycled mounts again (or dismounted) before this load
    // finished — the load that "won" already set up its own mountGroup, or
    // there's none wanted any more; either way, don't attach this stale one.
    if (token !== this.mountLoadToken) return;

    const mountGroup = new THREE.Group();
    mountGroup.add(visual.scene);
    mountGroup.position.copy(worldPos);
    mountGroup.position.y = visual.config.hoverHeight;
    mountGroup.rotation.y = facingY;

    this.scene.remove(this.playerModel);
    this.playerModel.position.copy(visual.config.seatOffset);
    this.playerModel.rotation.y = 0;
    mountGroup.add(this.playerModel);

    this.scene.add(mountGroup);
    this.mountModel = mountGroup;
    this.mountActor = visual.actor;
    this.avatar = mountGroup;
    if (instant) this.animator.setMounted(true);
    else this.animator.play('mount', () => this.animator.setMounted(true));
    // audio.mountToggle()/refreshMountSection() already fired synchronously
    // from setMounted the moment the player asked to mount — not repeated
    // here once the glTF itself finishes loading, or a real mount would play
    // its toggle sound twice.
  }

  /** Fire-and-forget cache warm-up so the first time the player actually mounts, `loadSkinnedInstance`'s own promise cache (see `render/gltfModel.ts`) already has both creature files parsed instead of stalling the swap on a network fetch — same idea as the ambient foxes' own load (render/wildlife.ts), just without anything to add to the scene yet. */
  private prefetchMountModels(): void {
    for (const file of allMountModelFiles()) {
      loadSkinnedInstance(file).catch((err) => console.error(`Falha ao pré-carregar montaria "${file}"`, err));
    }
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
   * This zone's current walkability grid — plain tile walkability from
   * config/tiles.ts, plus this zone's own building footprints (a building's
   * tiles are still stamped Path/Grass at the grid level, see MapGenerator's
   * stampFootprint; their real blocking is this exact list of AABBs, the
   * same one canOccupy checks). Shared by startAutoWalkTo (click-to-walk) and
   * buildChests (snapping a hidden chest's desired tile onto solid ground
   * that's actually walkable) so both use the exact same notion of
   * "blocked" — never two independently-drifting definitions.
   */
  private currentWalkabilityGrid() {
    const buildingFootprints = this.buildingColliders.map((b) => ({
      x: Math.floor(b.minX / TILE_SIZE),
      y: Math.floor(b.minZ / TILE_SIZE),
      w: Math.max(1, Math.round((b.maxX - b.minX) / TILE_SIZE)),
      h: Math.max(1, Math.round((b.maxZ - b.minZ) / TILE_SIZE)),
    }));
    return buildWalkabilityGrid(this.tiles, buildingFootprints);
  }

  /**
   * The minimap's click-to-walk entry point: converts a clicked tile into a
   * path (reusing the exact same walkability rules canOccupy applies to
   * every other movement — see currentWalkabilityGrid) and hands the result
   * to the per-frame follower above. Fails silently (a brief on-screen hint,
   * no crash) if the click landed somewhere no route can reach.
   */
  private startAutoWalkTo(clickedTile: { x: number; y: number }): void {
    const startTile = { x: Math.floor(this.avatar.position.x / TILE_SIZE), y: Math.floor(this.avatar.position.z / TILE_SIZE) };
    const grid = this.currentWalkabilityGrid();
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

  /**
   * Converts a click/tap on the minimap canvas into world tile coordinates —
   * the exact inverse of updateMinimap's world-to-pixel scale (including its
   * 180° rotation — see that method's own doc comment on why it's there) —
   * and kicks off a pathfind there. Reads the canvas's own displayed (CSS)
   * size via getBoundingClientRect rather than its fixed internal
   * MINIMAP_SIZE resolution, so this still maps correctly once the phone
   * breakpoints in style.css shrink the minimap down (110px/90px).
   *
   * While the map is expanded (see setMinimapExpanded), this same handler
   * dismisses it instead of pathfinding — deliberately reusing the small
   * minimap's own click event rather than adding a second listener, so the
   * two behaviors can never both fire for the same tap. The SEPARATE
   * expand/close affordances (the corner badge and the close button) are
   * what open/close the overlay in the first place; the small minimap's own
   * click always does click-to-walk, exactly as before this feature.
   */
  private handleMinimapClick(ev: MouseEvent): void {
    if (this.minimapExpanded) {
      this.setMinimapExpanded(false);
      return;
    }
    if (!this.minimapBg || this.paused || this.dialogueNpc || this.shopNpc || this.showingTutorial) return;
    const rect = this.minimapCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const fracX = (ev.clientX - rect.left) / rect.width;
    const fracY = (ev.clientY - rect.top) / rect.height;
    if (fracX < 0 || fracX > 1 || fracY < 0 || fracY > 1) return;
    // 1 - frac, not frac — see updateMinimap's 180° rotation.
    const worldX = (1 - fracX) * this.minimapBg.width * TILE_SIZE;
    const worldZ = (1 - fracY) * this.minimapBg.height * TILE_SIZE;
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

  /** Drives each loaded NPC's Idle clip — cheap even at the ~15-per-zone high end, same per-instance AnimationMixer.update the ambient foxes use (see render/wildlife.ts). Skips NPCs whose avatar hasn't finished loading yet (still on the placeholder, no actor). */
  private updateNpcActors(dt: number): void {
    for (const slot of this.npcSlots) {
      slot.actor?.update(dt);
    }
  }

  /**
   * The first real "NPC schedule" — see NpcDefinition.nightHidden's own doc
   * comment. Just a visibility toggle on the model already sitting in the
   * scene (the exact same `.visible` pattern already used for a
   * still-loading NPC's placeholder and for pooled monster respawns
   * elsewhere in this file) — no add/remove/dispose, so crossing the day/
   * night threshold mid-session is as cheap as any other frame.
   * updateNpcLabels/updateInteraction below both already respect
   * `model.visible`, so hiding it here is the single source of truth for
   * "this NPC isn't here right now".
   */
  private updateNpcSchedules(): void {
    const night = isNight(this.player.gameClock);
    for (const slot of this.npcSlots) {
      if (slot.def.nightHidden) slot.model.visible = !night;
    }
  }

  private updateNpcLabels(): void {
    for (const slot of this.npcSlots) {
      // Only a nightHidden NPC's own invisibility means "not here right
      // now" — any other NPC's model can be momentarily invisible for an
      // unrelated reason (still on the load placeholder, see buildNpcs) that
      // was never gated by this check before and shouldn't start being now.
      if (slot.def.nightHidden && !slot.model.visible) {
        slot.labelEl.hidden = true;
        continue;
      }
      this.scratchLabelAnchor.copy(slot.model.position);
      this.scratchLabelAnchor.y += 1.55;
      const p = this.scratchLabelAnchor.project(this.camera);
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
    // The NEAREST NPC in range, not merely the first one in list order — with
    // townsfolk standing a couple of tiles apart, "first" could pick someone
    // behind the player over the one they actually walked up to.
    let found: NpcSlot | null = null;
    let foundDist = INTERACT_RANGE;
    for (const s of this.npcSlots) {
      if (s.def.nightHidden && !s.model.visible) continue; // closed for the night — see updateNpcSchedules
      const d = s.model.position.distanceTo(this.avatar.position);
      if (d <= foundDist) {
        found = s;
        foundDist = d;
      }
    }
    this.nearbyNpc = found?.def ?? null;

    const foundPortal = this.dungeonPortals.find((p) => p.group.position.distanceTo(this.avatar.position) <= INTERACT_RANGE);
    this.nearbyDungeon = foundPortal?.def ?? null;
    if (this.dungeonTierPickerDungeon && this.nearbyDungeon !== this.dungeonTierPickerDungeon) this.closeDungeonTierPicker();

    const foundChest = this.chestSlots.find((c) => !c.opened && c.mesh.group.position.distanceTo(this.avatar.position) <= INTERACT_RANGE);
    this.nearbyChest = foundChest?.def ?? null;

    const touch = isTouchDevice();
    if (this.nearbyNpc) {
      this.promptEl.hidden = false;
      this.promptEl.textContent = touch ? `Toque para falar com ${this.nearbyNpc.name}` : `[E] Falar com ${this.nearbyNpc.name}`;
    } else if (this.nearbyDungeon) {
      const alreadyCleared = (this.player.dungeonTiers[this.nearbyDungeon.id] ?? 0) > 0;
      const verb = alreadyCleared ? 'escolher o tier de' : 'entrar em';
      this.promptEl.hidden = false;
      this.promptEl.textContent = touch ? `Toque para ${verb} ${this.nearbyDungeon.name}` : `[E] ${alreadyCleared ? 'Escolher tier de' : 'Entrar em'} ${this.nearbyDungeon.name}`;
    } else if (this.nearbyChest) {
      this.promptEl.hidden = false;
      this.promptEl.textContent = touch ? `Toque para abrir ${this.nearbyChest.name}` : `[E] Abrir ${this.nearbyChest.name}`;
    } else {
      this.promptEl.hidden = true;
    }
  }

  private openDialogue(npc: NpcDefinition): void {
    this.dialogueNpc = npc;
    this.dialogueLineIndex = 0;
    // Unlike notifyTalkedTo below (which completes whichever quest is
    // ALREADY active, in either slot), offerSideQuest can only ever START a
    // fresh, unrelated side quest (a lost NPC's own chain, a bounty), and
    // only while the SIDE slot (player.sideQuestId) is free — it runs
    // alongside the main chain, not just while that one is idle — see
    // QuestSystem.offerSideQuest. Deliberately run BEFORE dialogueLinesFor
    // (the opposite order from notifyTalkedTo's own placement below) so a
    // chain that starts on this exact conversation shows its own briefing
    // line immediately, instead of this NPC's generic default dialogue for
    // one more visit.
    const sideQuestMsg = offerSideQuest(this.player, npc.id);
    // Captured BEFORE notifyTalkedTo, which can complete an active quest and
    // change activeQuestId/sideQuestId out from under us — the lines a
    // quest-conditioned NPC shows for this conversation reflect the state
    // the player walked up with, not whatever quest they're handed
    // immediately after.
    this.dialogueLines = dialogueLinesFor(npc, [this.player.activeQuestId, this.player.sideQuestId], this.player.completedQuestIds, this.player.worldState.factionReputation);
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

      this.scratchLabelAnchor.copy(p.group.position);
      this.scratchLabelAnchor.y += 2.8;
      const proj = this.scratchLabelAnchor.project(this.camera);
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

  // --- hidden treasure chests (map secrets) -------------------------------

  /**
   * Places every `data/chests.ts` chest whose `zoneId` matches this zone.
   * `atTile` is a desired position, not a hand-verified one (see that file's
   * own doc comment) — snapped onto the nearest actually-walkable tile with
   * `findNearestWalkable`, the same helper click-to-walk already uses to
   * recover from an unwalkable click, off the same `currentWalkabilityGrid`
   * click-to-walk uses, so both share one notion of "blocked". A chest this
   * save already has in `player.openedChestIds` is built already-opened
   * (dull trim, lid open, no glow) instead of skipped entirely, so walking
   * back up to a looted chest still shows it sitting there, depleted.
   */
  private buildChests(): void {
    const grid = this.currentWalkabilityGrid();
    for (const def of chestsInZone(this.player.zoneId)) {
      const snapped = findNearestWalkable(grid, def.atTile) ?? def.atTile;
      const mesh = buildTreasureChestMesh();
      const pos = tileCenterWorld(snapped.x, snapped.y);
      mesh.group.position.copy(pos);
      this.scene.add(mesh.group);

      const opened = this.player.openedChestIds.includes(def.id);
      if (opened) setChestOpened(mesh, true);

      const labelEl = el('div', { className: 'chest-label', text: def.name });
      labelEl.hidden = true;
      this.game.uiRoot.append(labelEl);

      this.chestSlots.push({ def, mesh, labelEl, opened });
    }
  }

  /** Keeps every unopened chest's glint pulsing and its label tracking screen position — mirrors updateDungeonPortals/updateNpcLabels. An opened chest's label still tracks position (so it's still readable up close) but its glow stays off. */
  private updateChests(): void {
    for (const c of this.chestSlots) {
      if (!c.opened) animateChestGlow(c.mesh.glowMaterial, this.time);

      this.scratchLabelAnchor.copy(c.mesh.group.position);
      this.scratchLabelAnchor.y += 0.9;
      // Distance in WORLD space, read before .project() below mutates this
      // same vector into screen/NDC space — comparing world-space distance
      // against a post-projection vector (as this used to) compares two
      // unrelated coordinate systems, so it was effectively always "too far"
      // for any chest not standing right at the world origin. That's why no
      // chest label has ever actually shown up in play.
      const distance = this.scratchLabelAnchor.distanceTo(this.avatar.position);
      const proj = this.scratchLabelAnchor.project(this.camera);
      if (proj.z > 1 || distance > INTERACT_RANGE * 2.5) {
        c.labelEl.hidden = true;
        continue;
      }
      c.labelEl.hidden = false;
      c.labelEl.style.left = `${(proj.x * 0.5 + 0.5) * window.innerWidth}px`;
      c.labelEl.style.top = `${(-proj.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
  }

  /** The single entry point for the [E]/tap interact prompt (see tryInteract) — grants the chest's fixed gold plus one rolled loot item, marks it depleted for good (persisted in player.openedChestIds), and flips its mesh to the opened look. A no-op if this exact chest is somehow already opened (defensive — nearbyChest's own detection already excludes opened chests). */
  private openChest(def: ChestDefinition): void {
    const slot = this.chestSlots.find((c) => c.def.id === def.id);
    if (!slot || slot.opened) return;
    slot.opened = true;
    setChestOpened(slot.mesh, true);
    this.player.openedChestIds.push(def.id);
    this.player.gold += def.goldReward;
    this.player.addLoot(generateLoot(def.lootLevel, this.player.level));
    this.nearbyChest = null;
    this.promptEl.hidden = true;
    saveGame(this.player);
    audio.chestOpen();
    this.combat.showBanner(`${def.name}: +${def.goldReward} ouro, 1 item recebido.`);
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
   * (this.camDistance — the active camera preset's own distance) every
   * pass — not just once at the end. Doing the clamp only after
   * de-penetration was itself a bug: shrinking a resolved point straight
   * back toward the avatar can walk it right back into the same tree it
   * was just pushed clear of (worse the more clearance the push needed), so
   * both constraints have to be satisfied together, iterating until neither
   * moves anything. Returns whether a violation still remained after all
   * passes (a pathologically tight cluster with no spot inside that
   * distance that's clear of everything) so the caller can fall back to
   * lifting the camera above canopy height instead.
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
        // Street props (lamps, banners, the fountain...) sit well below the
        // camera — steering around each one would just jostle it across a
        // plaza full of them.
        if (b.blocksCamera === false) continue;
        const pushed = this.pushOutOfBuildingBox(x, z, b, BUILDING_CAM_BUFFER);
        if (!pushed) continue;
        violated = true;
        pushMagnitude += Math.hypot(pushed.x - x, pushed.z - z);
        x = pushed.x;
        z = pushed.z;
      }
      const distFromAvatar = Math.hypot(x - px, z - pz);
      if (distFromAvatar > this.camDistance) {
        const t = this.camDistance / distFromAvatar;
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
  private desiredCameraPosition(target: THREE.Vector3 = this.scratchDesiredCamPos): THREE.Vector3 {
    this.scratchCamForward.set(Math.sin(CAMERA_YAW), 0, Math.cos(CAMERA_YAW));
    target.copy(this.avatar.position).addScaledVector(this.scratchCamForward, -this.camDistance);
    target.y += this.camHeight;

    const resolved = this.resolveCameraXZ(target.x, target.z);
    target.x = resolved.x;
    target.z = resolved.z;
    return target;
  }

  /** this.avatar.position.y + the currently active preset's own height, lifted by however much of CAM_LIFT_EXTRA's clearance `blend` (0..1) currently calls for. */
  private cameraHeightFor(blend: number): number {
    return this.avatar.position.y + this.camHeight + blend * CAM_LIFT_EXTRA;
  }

  private positionCameraImmediate(): void {
    this.desiredCameraPosition(this.camera.position);
    // No previous frame to ease the lift blend from at mount time — resolve
    // once and snap it straight to its correct value instead of easing in.
    const resolved = this.resolveCameraXZ(this.camera.position.x, this.camera.position.z);
    this.cameraLiftBlend = Math.min(1, resolved.pushMagnitude / CAM_LIFT_RAMP_RANGE);
    this.camera.position.y = this.cameraHeightFor(this.cameraLiftBlend);
    this.camLookAt.copy(this.avatar.position).add(new THREE.Vector3(0, this.camLookHeight, 0));
    this.camera.lookAt(this.camLookAt);
  }

  private updateCamera(dt: number): void {
    // Eases camDistance/camHeight/camLookHeight toward whichever preset
    // cameraAngleIndex currently points at (see cycleCameraAngle) — a
    // no-op most frames, since the target only actually moves the instant
    // the eye button is pressed. Runs before desiredCameraPosition/
    // cameraHeightFor below so this frame's render already reflects
    // however far the ease has gotten.
    const rigTarget = CAMERA_RIG_PRESETS[this.cameraAngleIndex];
    const rigLerp = 1 - Math.exp(-dt * 5);
    this.camDistance += (rigTarget.distance - this.camDistance) * rigLerp;
    this.camHeight += (rigTarget.height - this.camHeight) * rigLerp;
    this.camLookHeight += (rigTarget.lookHeight - this.camLookHeight) * rigLerp;

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

    // Pathologically dense cluster (no spot within the active preset's own
    // distance clears every nearby tree/building) — lift the camera above
    // obstacle height instead, which clears the clip regardless of how
    // tightly packed things are horizontally. Tree canopies top out around
    // 1.9 world units and most building roofs around 3.8-4.7 (see
    // worldBuilder's lobe/roof placement) — CAM_LIFT_EXTRA clears both from
    // any preset's own base height; only the rare tower landmark's roof
    // (~5.8) can still poke through in
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

    this.scratchLookAt.copy(this.avatar.position);
    this.scratchLookAt.y += this.camLookHeight;
    this.camLookAt.lerp(this.scratchLookAt, followLerp);
    this.camera.lookAt(this.camLookAt);

    this.dirLight.position.copy(this.avatar.position).add(this.scratchDirLightOffset);
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

    this.nameLineEl = el('div', { className: 'name-line' });
    this.hpEl = el('div', { className: 'hud-hp' });
    this.mpEl = el('div', { className: 'hud-mp' });
    this.goldEl = el('div', {});
    this.clockEl = el('div', { className: 'hud-clock' });
    const panel = el('div', { className: 'panel hud-panel' }, [this.nameLineEl, this.hpEl, this.mpEl, this.goldEl, this.clockEl]);

    this.xpBarFillEl = el('div', { className: 'xp-bar-fill' });
    const xpBar = el('div', { className: 'xp-bar', attrs: { title: 'Experiência até o próximo nível' } }, [this.xpBarFillEl]);

    this.refreshHud();

    const hint = el('div', { className: 'hud-hint', text: 'ESC: menu · M: montaria' });
    this.promptEl = el('div', { className: 'interact-prompt', text: '', onClick: () => this.tryInteract() });
    this.promptEl.hidden = true;

    // Escape opens the pause menu (Inventário/Habilidades/Ranking) on a
    // keyboard, but a touchscreen has no Escape key at all — without this
    // button those screens were completely unreachable on mobile.
    const menuBtn = el('div', { className: 'menu-btn', text: '☰', onClick: () => this.togglePause() });

    // Camera-angle toggle — visible on both touch and desktop (unlike
    // menuBtn above, which only ever shows up on touch): the player asked
    // for this "principalmente no mobile" but a mouse player benefits from
    // it too, and there's no keyboard shortcut standing in for it the way
    // Escape already covers the pause menu on desktop.
    this.cameraAngleBtn = el('div', {
      className: 'camera-angle-btn',
      onClick: () => this.cycleCameraAngle(),
      attrs: { title: `Ângulo da câmera: ${CAMERA_RIG_PRESETS[0].label}`, 'aria-label': 'Mudar ângulo da câmera' },
    });
    this.cameraAngleBtn.append(buildEyeIconSvg());

    this.game.uiRoot.append(
      panel,
      hint,
      menuBtn,
      this.cameraAngleBtn,
      this.questTrackerEl,
      this.questZoneHintEl,
      this.questArrowEl,
      this.promptEl,
      xpBar,
    );
  }

  /**
   * Cycles to the next CAMERA_RIG_PRESETS entry — the eye button's own click
   * handler. A single explicit step per tap, never automatic: updateCamera
   * still eases camDistance/camHeight/camLookHeight smoothly toward the new
   * preset every frame, so this reads as a deliberate push-in/pull-out
   * rather than a snap-cut, but the STEP itself only ever happens because
   * the player asked for it.
   */
  private cycleCameraAngle(): void {
    this.cameraAngleIndex = (this.cameraAngleIndex + 1) % CAMERA_RIG_PRESETS.length;
    const preset = CAMERA_RIG_PRESETS[this.cameraAngleIndex];
    this.cameraAngleBtn.classList.toggle('alt-angle', this.cameraAngleIndex !== 0);
    this.cameraAngleBtn.setAttribute('title', `Ângulo da câmera: ${preset.label}`);
  }

  /** Keeps the always-visible HP/MP/gold/level/XP readout live now that combat happens in-place instead of in a separate screen with its own status bar. Called every frame (see update()), so a level-up or an XP tick from a kill shows immediately — this used to build the name-line's "Nv.X" once in buildHud() and never touch it again, silently going stale the moment the player leveled up. */
  private refreshHud(): void {
    const stats = this.player.stats;
    this.nameLineEl.textContent = `${this.player.name} — ${this.player.classDef.name} Nv.${this.player.level}`;
    this.hpEl.textContent = `HP ${this.player.currentHp}/${stats.maxHp}`;
    this.mpEl.textContent = `MP ${this.player.currentMp}/${stats.maxMp}`;
    this.goldEl.textContent = `Ouro: ${this.player.gold}`;
    const xpFraction = Math.min(1, Math.max(0, this.player.xp / this.player.xpToNextLevel));
    this.xpBarFillEl.style.width = `${xpFraction * 100}%`;
    this.clockEl.textContent = `${isNight(this.player.gameClock) ? '🌙' : '☀️'} ${formatTimeOfDay(this.player.gameClock)}`;
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

  /**
   * "Go to this zone" text for an objective questIndicatorTarget can't offer
   * a world position for: a `talkTo` NPC standing in a different zone, or a
   * `defeat` target with a known fixed home (DEFEAT_TARGET_HOME_ZONE) that
   * just isn't alive in the player's CURRENT zone right now (either they're
   * elsewhere entirely, or they're in the right zone but haven't found the
   * hand-placed spot yet).
   */
  private questIndicatorZoneHint(quest: QuestDefinition | null): string | null {
    if (!quest) return null;
    if (quest.objective.kind === 'talkTo') {
      const npc = getNpcById(quest.objective.targetId!);
      if (npc.zoneId === this.player.zoneId) return null;
      return `Siga para: ${getZoneById(npc.zoneId).name}`;
    }
    if (quest.objective.kind === 'defeat') {
      const homeZoneId = DEFEAT_TARGET_HOME_ZONE[quest.objective.targetId!];
      if (!homeZoneId || homeZoneId === this.player.zoneId) return null;
      return `Siga para: ${getZoneById(homeZoneId).name}`;
    }
    return null;
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
   *
   * With a side quest now able to run alongside the main chain (see
   * QuestSystem's QuestSlot), there can be two tracked quests at once but
   * still only one arrow — this picks whichever tracked quest currently HAS
   * something to point at (a `talkTo`/`defeat` objective, in that tracking
   * order: main chain first, side quest second), so a main-chain
   * `reachLevel` objective (no location at all) doesn't leave the arrow
   * blank while a perfectly point-able side quest sits right there. Both
   * quests still get their own line in `.quest-tracker` (questTrackerText)
   * regardless of which one the arrow is currently following.
   */
  private updateQuestIndicator(): void {
    const quests = activeQuests(this.player);
    const quest = quests.find((q) => this.questIndicatorTarget(q) || this.questIndicatorZoneHint(q)) ?? quests[0] ?? null;
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
  /** Internal canvas resolution while expanded (see setMinimapExpanded) — the CSS side just stretches `.minimap-canvas.expanded` to a big centered box, but the canvas's own pixel grid is bumped up to match (updateMinimap resizes it on the fly) so "one tile = one pixel" still holds instead of the small 140px bitmap just getting blurrily upscaled. */
  private static readonly MINIMAP_SIZE_EXPANDED = 420;
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
    // Click/tap-to-walk (or, while expanded, dismiss — see
    // handleMinimapClick) — the minimap was purely decorative before this
    // (pointer-events: none in style.css); 'click' fires for both a mouse
    // click and a touch tap, so one listener covers both without needing
    // separate touch handling like the joystick does.
    this.minimapCanvas.addEventListener('click', (ev) => this.handleMinimapClick(ev));
    this.game.uiRoot.append(this.minimapCanvas);
    this.renderMinimapBackground();

    // Tap-to-expand — a SEPARATE small badge overlaid on the minimap's own
    // corner (see .minimap-expand-btn in style.css: same top/right anchor as
    // .minimap-canvas itself, so it sits reliably on its corner at every
    // phone breakpoint without needing to know the canvas's current
    // shrunk-down width/height). Deliberately not reusing minimapCanvas's own
    // click — see handleMinimapClick's doc comment for why click-to-walk and
    // expand must never compete for the same gesture.
    this.minimapExpandBtn = el('div', {
      className: 'minimap-expand-btn',
      text: '⤢',
      onClick: () => this.toggleMinimapExpand(),
      attrs: { title: 'Expandir mapa', 'aria-label': 'Expandir mapa' },
    });
    // Dims/hides the rest of the HUD behind the big expanded map and gives
    // "tap outside" a target — see setMinimapExpanded. Hidden (display:none)
    // whenever the map isn't expanded, so it never intercepts clicks then.
    this.minimapBackdropEl = el('div', { className: 'minimap-backdrop', onClick: () => this.setMinimapExpanded(false) });
    this.minimapCloseBtn = el('div', {
      className: 'minimap-close-btn',
      text: '✕',
      onClick: () => this.setMinimapExpanded(false),
      attrs: { title: 'Fechar mapa', 'aria-label': 'Fechar mapa' },
    });
    // "Mapa Mundi" — the expand badge's twin on the minimap's other top
    // corner (see .worldmap-open-btn in style.css), for the whole world's
    // layout rather than this zone's terrain. Also reachable from the pause
    // menu; this is just the one-tap route.
    this.worldMapOpenBtn = el('div', {
      className: 'worldmap-open-btn',
      onClick: () => this.openWorldMap(),
      attrs: { title: 'Mapa Mundi', 'aria-label': 'Abrir mapa mundi' },
    });
    this.worldMapOpenBtn.append(buildGlobeIconSvg());
    this.game.uiRoot.append(this.minimapBackdropEl, this.minimapExpandBtn, this.worldMapOpenBtn, this.minimapCloseBtn);
  }

  /**
   * Toggles the enlarged minimap overlay. Refuses to OPEN while any other
   * modal-ish state already owns the screen (paused/dialogue/shop/tutorial)
   * — mirrors handleMinimapClick's own guard — but always allows closing,
   * so a click-to-close never gets stuck refused mid-transition.
   */
  private toggleMinimapExpand(): void {
    if (!this.minimapExpanded && (this.paused || this.dialogueNpc || this.shopNpc || this.showingTutorial)) return;
    this.setMinimapExpanded(!this.minimapExpanded);
  }

  private setMinimapExpanded(value: boolean): void {
    if (this.minimapExpanded === value) return;
    this.minimapExpanded = value;
    this.minimapCanvas.classList.toggle('expanded', value);
    this.minimapBackdropEl.classList.toggle('visible', value);
    this.minimapCloseBtn.classList.toggle('visible', value);
    this.minimapExpandBtn.classList.toggle('hidden-while-expanded', value);
    this.worldMapOpenBtn.classList.toggle('hidden-while-expanded', value);
  }

  /**
   * Opens the "Mapa Mundi" overlay (ui/worldMap.ts) — a read-only diagram
   * of every settlement, with this zone marked. Refuses while a dialogue,
   * shop or the tutorial owns the screen (same guard as
   * toggleMinimapExpand); from the pause menu it temporarily hides the menu
   * instead, and closeWorldMap brings it back.
   */
  private openWorldMap(): void {
    if (this.worldMapOpen || this.dialogueNpc || this.shopNpc || this.showingTutorial) return;
    this.setMinimapExpanded(false);
    if (!this.worldMap) {
      this.worldMap = buildWorldMapOverlay({
        currentZoneId: this.player.zoneId,
        playerClassId: this.player.classId,
        onClose: () => this.closeWorldMap(),
      });
      this.game.uiRoot.append(this.worldMap.root);
    }
    this.worldMap.refreshLocation(this.player.zoneId, this.worldMapLocationText());
    this.worldMap.root.hidden = false;
    this.worldMapReturnToPause = this.paused;
    if (this.paused) this.pauseOverlay.hidden = true;
    this.worldMapOpen = true;
  }

  private closeWorldMap(): void {
    if (!this.worldMapOpen) return;
    this.worldMapOpen = false;
    if (this.worldMap) this.worldMap.root.hidden = true;
    if (this.worldMapReturnToPause && this.paused) this.pauseOverlay.hidden = false;
    this.worldMapReturnToPause = false;
  }

  /** The world map's "Você está em: …" line — the same settlement/plaza name the minimap's own caption shows, or the dungeon's name plus the settlement its portal stands in. */
  private worldMapLocationText(): string {
    const dungeon = getDungeonByZoneId(this.player.zoneId);
    if (dungeon) return `${dungeon.name} (${this.zoneNameOf(dungeon.portal.hostZoneId)})`;
    const zoneName = this.zoneDef.name;
    const areaName = subAreaNameAt(this.player.zoneId, Math.floor(this.avatar.position.x / TILE_SIZE), Math.floor(this.avatar.position.z / TILE_SIZE));
    return areaName === zoneName ? zoneName : `${zoneName} — ${areaName}`;
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
    const size = this.minimapExpanded ? OverworldScreen.MINIMAP_SIZE_EXPANDED : OverworldScreen.MINIMAP_SIZE;
    // Bumping a canvas's width/height (not just its CSS size) clears its
    // contents, but that's harmless here — this whole function redraws it
    // from scratch every single frame regardless, so there's no content to
    // lose. Only actually resizes on the frame setMinimapExpanded flips the
    // state (every other frame this is a same-value no-op check).
    if (this.minimapCanvas.width !== size || this.minimapCanvas.height !== size) {
      this.minimapCanvas.width = size;
      this.minimapCanvas.height = size;
    }
    const ctx = this.minimapCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, size, size);

    // The camera's own fixed framing (CAMERA_YAW=0 — see computeInputAxis's
    // doc comment) has "forward" (W) increase world Z and "right" (D)
    // DECREASE world X. A minimap drawn straight from world coordinates (no
    // rotation) put those backwards on screen: walking forward moved the
    // dot DOWN the map, and walking right moved it LEFT — technically
    // consistent with raw world space, but inverted from what the player
    // sees happening in the 3D view right above it. A single 180° rotation
    // around the canvas center (translate to the far corner, then rotate)
    // is exactly a "flip both axes" — it fixes both at once without
    // touching renderMinimapBackground's own tile-color loop or any single
    // marker's position math below. Restored before the caption strip so
    // that text stays upright and anchored at the visual bottom, not
    // rotated with everything above it. handleMinimapClick's own inverse
    // mapping was updated to match — see its own doc comment.
    ctx.save();
    ctx.translate(size, size);
    ctx.rotate(Math.PI);
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
    ctx.restore();

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
    // Strip height/font scale with `size` (15px/10px at the normal
    // MINIMAP_SIZE=140 — unchanged from before this ratio existed) so the
    // caption stays legible rather than looking tiny once the expanded view
    // bumps the canvas up to MINIMAP_SIZE_EXPANDED.
    const stripH = Math.round(size * (15 / OverworldScreen.MINIMAP_SIZE));
    const fontPx = Math.round(size * (10 / OverworldScreen.MINIMAP_SIZE));
    ctx.fillStyle = 'rgba(26, 20, 35, 0.78)';
    ctx.fillRect(0, size - stripH, size, stripH);
    ctx.fillStyle = '#f2ede3';
    ctx.font = `${fontPx}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(areaName, size / 2, size - stripH / 2, size - 6);
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
    // An in-place overlay (see openWorldMap), not a separate screen like the
    // buttons above — no zone rebuild on the way back.
    const worldMapBtn = el('div', { className: 'btn', text: 'Mapa Mundi', onClick: () => this.openWorldMap() });
    const settingsBtn = el('div', {
      className: 'btn',
      text: 'Configurações',
      onClick: () => {
        saveGame(this.player);
        goToLazy(this.game, async () => {
          const { SettingsScreen } = await import('./SettingsScreen');
          // this.avatarData is already loaded (see the constructor's own
          // comment) — no need to re-fetch it, unlike the other buttons
          // above that go through a fresh screen construction.
          return new SettingsScreen(
            this.game,
            () => this.game.goTo(new OverworldScreen(this.game, this.player, this.avatarData)),
            this.player,
          );
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
      el('div', { className: 'stack' }, [resumeBtn, inventoryBtn, skillsBtn, rankingBtn, questLogBtn, worldMapBtn, settingsBtn]),
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
    if (this.paused) {
      // Both are centered overlays (see .minimap-canvas.expanded and
      // .pause-overlay in style.css) with no z-index arbitrating between
      // them — collapsing one before showing the other avoids the two ever
      // fighting for the same screen center instead of relying on
      // DOM-append-order stacking.
      this.setMinimapExpanded(false);
      saveGame(this.player);
    }
  }
}
