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
import { NPC_DEFINITIONS, type NpcDefinition, type VendorInfo } from '../data/npcs';
import { arriveWorldPosition, getZoneById, type ZoneDefinition, type ZoneExit } from '../data/zones';
import { rarityTier, rarityToHex } from '../config/rarity';
import type { EquipmentSlot, ItemRarity } from '../config/types';
import { Player } from '../entities/Player';
import { CharacterAnimator } from '../render/animation';
import { buildHumanCharacter, buildMountModel, buildPlayerCharacter, getRig } from '../render/characterModel';
import { GltfActor, loadSkinnedInstance } from '../render/gltfModel';
import { buildOverworldMeshes, tileCenterWorld, type TreeCollider } from '../render/worldBuilder';
import { OverworldCombat } from '../systems/OverworldCombat';
import { ensureClassCallingStarted, ensureQuestStarted, notifyTalkedTo, questTrackerText } from '../systems/QuestSystem';
import { saveGame } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { el, goToLazy } from '../ui/dom';

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
const CAM_DISTANCE = 4.4;
const CAM_HEIGHT = 3.1;
const LOOK_HEIGHT = 1.1;
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
  model: THREE.Group;
  labelEl: HTMLElement;
}

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
  private playerModel!: THREE.Group;
  private mountModel: THREE.Group | null = null;
  /** Whichever object currently moves through the world — the rider alone, or the mount carrying them. */
  private avatar!: THREE.Object3D;
  private animator!: CharacterAnimator;
  private dirLight!: THREE.DirectionalLight;
  private npcSlots: NpcSlot[] = [];
  private wildlife: WildlifeSlot[] = [];
  private combat!: OverworldCombat;
  private zoneDef!: ZoneDefinition;
  private zoneRespawnTile = { x: 5, y: 5 };
  private time = 0;

  private isMoving = false;
  /** Whether input was active last frame — used only to detect the idle→active edge that re-snapshots movementRefYaw (see computeInputAxis). */
  private wasInputActive = false;
  /** Camera yaw snapshotted at the start of the current continuous input gesture — see computeInputAxis for why this can't just re-read avatar.rotation.y every frame. */
  private movementRefYaw = 0;

  private heldKeys = new Set<string>();
  /** Normalized {x,z} from the on-screen joystick, magnitude <=1; null while untouched. */
  private joystickAxis: { x: number; z: number } | null = null;
  private joystickPointerId: number | null = null;
  private keydownHandler = (e: KeyboardEvent) => this.onKeyDown(e);
  private keyupHandler = (e: KeyboardEvent) => this.onKeyUp(e);

  private camLookAt = new THREE.Vector3();

  private paused = false;
  private dialogueNpc: NpcDefinition | null = null;
  private dialogueLineIndex = 0;
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
  private mountSectionEl!: HTMLElement;
  private shopOverlay!: HTMLElement;
  private shopTitleEl!: HTMLElement;
  private shopBodyEl!: HTMLElement;
  private shopGoldEl!: HTMLElement;

  constructor(
    private game: Game,
    private player: Player,
  ) {
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  }

  mount(): void {
    ensureQuestStarted(this.player);
    ensureClassCallingStarted(this.player);

    this.scene.background = new THREE.Color(0x8ec9e8);
    this.scene.fog = new THREE.Fog(0x8ec9e8, 16, 46);

    this.zoneDef = getZoneById(this.player.zoneId);
    const { tiles, playerStart } = this.zoneDef.generate();
    this.tiles = tiles;
    this.zoneRespawnTile = playerStart;
    const { group, waterMaterial, treeColliders } = buildOverworldMeshes(tiles, this.zoneDef.accentColor);
    this.waterMaterial = waterMaterial;
    this.treeColliders = treeColliders;
    this.scene.add(group);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    const hemi = new THREE.HemisphereLight(0x8ec9e8, 0x4c8a3f, 0.55);
    this.scene.add(ambient, hemi);

    this.dirLight = new THREE.DirectionalLight(0xfff4e0, 1.0);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(1024, 1024);
    const cam = this.dirLight.shadow.camera as THREE.OrthographicCamera;
    cam.left = -9;
    cam.right = 9;
    cam.top = 9;
    cam.bottom = -9;
    cam.near = 1;
    cam.far = 30;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.playerModel = buildPlayerCharacter(this.player);
    this.animator = new CharacterAnimator(getRig(this.playerModel));
    this.avatar = this.playerModel;
    this.scene.add(this.playerModel);
    this.avatar.position.set(this.player.mapX, 0, this.player.mapY);

    if (this.player.activeMountId) this.setMounted(this.player.activeMountId, true);

    this.buildNpcs();
    this.spawnWildlife();
    this.positionCameraImmediate();

    this.combat = new OverworldCombat(this.game, this.player, this.scene, this.animator, () => this.handleDefeat());
    this.combat.spawnMonsters(tiles, playerStart, {
      count: this.zoneDef.monsterCount,
      enemyIds: this.zoneDef.monsterIds,
      minDistFromStart: this.zoneDef.monsterIds ? 3 : undefined,
      minSpacing: this.zoneDef.monsterIds ? 2 : undefined,
    });

    this.buildHud();
    this.buildJoystick();
    this.buildDialogueOverlay();
    this.buildShopOverlay();
    this.buildPauseOverlay();

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

    if (!this.paused && !this.dialogueNpc && !this.shopNpc) {
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
    this.updateCamera(dt);
    this.updateNpcLabels();
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

    if (e.key === 'e' || e.key === 'E') {
      if (this.nearbyNpc) this.openDialogue(this.nearbyNpc);
    }
    if (e.key === 'm' || e.key === 'M') {
      this.cycleMount();
    }
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
   * camera (desiredCameraPosition) re-derives its own forward from
   * avatar.rotation.y every frame. At the default yaw (0, facing +Z), the
   * camera's real right-hand side works out to world -X (the same
   * right-hand rotation math desiredCameraPosition uses), but
   * DIR_AXIS.right pointed at world +X — the opposite side. That's the
   * "axis feels inverted" bug: a direction could move the character toward
   * what looked like the wrong side of the screen depending on whatever
   * direction it last happened to be facing.
   *
   * The reference yaw used for this conversion is a SNAPSHOT
   * (movementRefYaw), taken once when input goes from idle to active, not
   * avatar.rotation.y read fresh every frame. Reading it fresh would feed
   * the avatar's own turn-to-face-target rotation back into the very
   * vector deciding that target: for pure "right", the resulting target is
   * always exactly 90° behind whatever the current yaw already is (proven
   * out — there's no fixed point), so the avatar would spin in place for
   * as long as the key was held instead of turning once and walking.
   * Freezing the reference for the gesture's duration removes the
   * feedback loop; it only updates again once input drops to zero and a
   * new gesture begins.
   */
  private computeInputAxis(): { x: number; z: number } {
    const local = this.computeLocalInputAxis();
    const active = local.x !== 0 || local.z !== 0;
    if (active && !this.wasInputActive) this.movementRefYaw = this.avatar.rotation.y;
    this.wasInputActive = active;
    if (!active) return local;

    const yaw = this.movementRefYaw;
    const forward = { x: Math.sin(yaw), z: Math.cos(yaw) }; // camera-forward at gesture start (see desiredCameraPosition)
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) }; // camera-right at gesture start
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

  /** Rebuilds the visible player model in place — used right after socketing a gem so its weapon glow shows immediately instead of waiting for the next zone load. */
  private rebuildPlayerVisual(): void {
    const mounted = this.mountModel !== null;
    const oldModel = this.playerModel;
    const newModel = buildPlayerCharacter(this.player);

    if (mounted) {
      this.mountModel!.remove(oldModel);
      newModel.position.copy(MOUNT_SEAT_OFFSET);
      newModel.rotation.y = 0;
      this.mountModel!.add(newModel);
    } else {
      const pos = oldModel.position.clone();
      const rotY = oldModel.rotation.y;
      this.scene.remove(oldModel);
      newModel.position.copy(pos);
      newModel.rotation.y = rotY;
      this.scene.add(newModel);
      this.avatar = newModel;
    }
    disposeGroup(oldModel);
    this.playerModel = newModel;
    this.animator = new CharacterAnimator(getRig(newModel));
    this.animator.setMounted(mounted);
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
    for (const npc of this.npcSlots) {
      const npcPos = npc.model.position;
      const dx = x - npcPos.x;
      const dz = z - npcPos.z;
      if (Math.hypot(dx, dz) < r + NPC_COLLISION_RADIUS) return false;
    }
    return true;
  }

  private updateMovement(dt: number): void {
    const axis = this.computeInputAxis();
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
      if (stepX !== 0 && this.canOccupy(pos.x + stepX, pos.z, PLAYER_RADIUS, flying)) {
        pos.x += stepX;
      }
      if (stepZ !== 0 && this.canOccupy(pos.x, pos.z + stepZ, PLAYER_RADIUS, flying)) {
        pos.z += stepZ;
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

  /** Leaves the current zone through `exit`, arriving at its destination — a full screen rebuild, same as the old battle/respawn transitions. */
  private transitionToZone(exit: ZoneExit): void {
    this.player.zoneId = exit.toZone;
    const arrive = arriveWorldPosition(exit.arriveTile);
    this.player.mapX = arrive.x;
    this.player.mapY = arrive.z;
    saveGame(this.player);
    this.game.goTo(new OverworldScreen(this.game, this.player));
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

  private buildNpcs(): void {
    for (const def of NPC_DEFINITIONS.filter((n) => n.zoneId === this.player.zoneId)) {
      const model = buildHumanCharacter(def.appearance, 'none');
      tileCenterWorld(def.mapX, def.mapY, model.position);
      model.rotation.y = Math.PI;
      this.scene.add(model);

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
      this.npcSlots.push({ def, model, labelEl });
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
    if (this.nearbyNpc) {
      this.promptEl.hidden = false;
      this.promptEl.textContent = `[E] Falar com ${this.nearbyNpc.name}`;
    } else {
      this.promptEl.hidden = true;
    }
  }

  private openDialogue(npc: NpcDefinition): void {
    this.dialogueNpc = npc;
    this.dialogueLineIndex = 0;
    this.dialogueOverlay.hidden = false;
    this.promptEl.hidden = true;
    this.renderDialogueLine();
    const questMsg = notifyTalkedTo(this.player, npc.id);
    if (questMsg) {
      saveGame(this.player);
      audio.questComplete();
      this.combat.showBanner(questMsg);
    } else {
      audio.npcTalk();
    }
  }

  private renderDialogueLine(): void {
    if (!this.dialogueNpc) return;
    this.dialogueNameEl.textContent = this.dialogueNpc.name;
    this.dialogueLineEl.textContent = this.dialogueNpc.dialogue[this.dialogueLineIndex];
  }

  private advanceDialogue(): void {
    if (!this.dialogueNpc) return;
    this.dialogueLineIndex += 1;
    if (this.dialogueLineIndex >= this.dialogueNpc.dialogue.length) {
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
   * (CAM_DISTANCE) every pass — not just once at the end. Doing the clamp
   * only after de-penetration was itself a bug: shrinking a resolved point
   * straight back toward the avatar can walk it right back into the same
   * tree it was just pushed clear of (worse the more clearance the push
   * needed), so both constraints have to be satisfied together, iterating
   * until neither moves anything. Returns whether a violation still
   * remained after all passes (a pathologically tight cluster with no spot
   * inside CAM_DISTANCE that's clear of everything) so the caller can fall
   * back to lifting the camera above canopy height instead.
   *
   * Used on BOTH the freshly-computed ideal camera target AND the actual
   * rendered camera.position after it lerps toward that target — the lerp
   * itself was a gap: while walking continuously through a dense area, the
   * ideal target keeps shifting every frame, and the smoothed position
   * chasing it can visibly lag into a tree's canopy even though each
   * individual target was already clear.
   */
  private resolveCameraXZ(x: number, z: number): { x: number; z: number; violated: boolean } {
    // A generous buffer, not just "clear of the canopy's own radius": the
    // camera isn't a point, it's a wide near-plane frustum, so a tree can
    // still clip into the edge of the frame even once its center is barely
    // outside the collision circle.
    const TREE_CAM_BUFFER = 1.1;
    const px = this.avatar.position.x;
    const pz = this.avatar.position.z;
    let violated = false;
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
      const distFromAvatar = Math.hypot(x - px, z - pz);
      if (distFromAvatar > CAM_DISTANCE) {
        const t = CAM_DISTANCE / distFromAvatar;
        x = px + (x - px) * t;
        z = pz + (z - pz) * t;
      }
      if (!violated) break;
    }
    return { x, z, violated };
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
  private desiredCameraPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const yaw = this.avatar.rotation.y;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    target
      .copy(this.avatar.position)
      .addScaledVector(forward, -CAM_DISTANCE)
      .add(new THREE.Vector3(0, CAM_HEIGHT, 0));

    const resolved = this.resolveCameraXZ(target.x, target.z);
    target.x = resolved.x;
    target.z = resolved.z;

    // Pathologically dense cluster (no spot within CAM_DISTANCE clears
    // every nearby tree) — lift the camera above canopy height instead,
    // which clears the clip regardless of how tightly packed the trees are
    // horizontally. Tree canopies top out around 1.9 world units (see
    // worldBuilder's lobe placement), well under this.
    if (resolved.violated) target.y = Math.max(target.y, this.avatar.position.y + 3.6);

    return target;
  }

  private positionCameraImmediate(): void {
    this.desiredCameraPosition(this.camera.position);
    this.camLookAt.copy(this.avatar.position).add(new THREE.Vector3(0, LOOK_HEIGHT, 0));
    this.camera.lookAt(this.camLookAt);
  }

  private updateCamera(dt: number): void {
    const desired = this.desiredCameraPosition();
    const followLerp = 1 - Math.exp(-dt * 6);
    this.camera.position.lerp(desired, followLerp);

    // The lerp above eases toward `desired`, which is only guaranteed clear
    // of trees AT THE MOMENT it was computed — while walking continuously
    // through a dense area that target shifts every frame, and the
    // easing camera can visibly lag into a canopy it hasn't caught up past
    // yet. Re-running the same push-away resolution directly on the actual
    // rendered position (not just the target it's chasing) keeps every
    // frame that's actually drawn clear, regardless of how it got there.
    const resolvedCam = this.resolveCameraXZ(this.camera.position.x, this.camera.position.z);
    this.camera.position.x = resolvedCam.x;
    this.camera.position.z = resolvedCam.z;
    if (resolvedCam.violated) this.camera.position.y = Math.max(this.camera.position.y, this.avatar.position.y + 3.6);

    const desiredLookAt = new THREE.Vector3().copy(this.avatar.position).add(new THREE.Vector3(0, LOOK_HEIGHT, 0));
    this.camLookAt.lerp(desiredLookAt, followLerp);
    this.camera.lookAt(this.camLookAt);

    this.dirLight.position.copy(this.avatar.position).add(new THREE.Vector3(6, 10, 4));
    this.dirLight.target.position.copy(this.avatar.position);
  }

  // --- HUD -------------------------------------------------------------

  private buildHud(): void {
    this.questTrackerEl = el('div', { className: 'quest-tracker', text: questTrackerText(this.player) });

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
    this.promptEl = el('div', { className: 'interact-prompt', text: '' });
    this.promptEl.hidden = true;

    this.game.uiRoot.append(panel, hint, this.questTrackerEl, this.promptEl);
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
    this.dialogueOverlay = el(
      'div',
      { className: 'panel dialogue-box', onClick: () => this.advanceDialogue() },
      [this.dialogueNameEl, this.dialogueLineEl, el('div', { className: 'dialogue-hint', text: '(clique, E ou Enter para continuar)' })],
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
      el('div', { className: 'stack' }, [resumeBtn, inventoryBtn, skillsBtn, rankingBtn]),
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
    this.paused = !this.paused;
    this.pauseOverlay.hidden = !this.paused;
    if (this.paused) saveGame(this.player);
  }
}
