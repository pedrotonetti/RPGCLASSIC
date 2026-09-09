import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { isWalkable, TileType, triggersEncounter } from '../config/tiles';
import { getMountById } from '../data/mounts';
import { NPC_DEFINITIONS, type NpcDefinition } from '../data/npcs';
import { Player } from '../entities/Player';
import { CharacterAnimator } from '../render/animation';
import { buildHumanCharacter, buildMountModel, buildPlayerCharacter, getRig } from '../render/characterModel';
import { GltfActor, loadSkinnedInstance } from '../render/gltfModel';
import { buildOverworldMeshes, tileCenterWorld } from '../render/worldBuilder';
import { ENCOUNTER_CHANCE_PER_STEP, pickEncounterEnemyIds } from '../systems/EncounterSystem';
import { generateOverworldMap, MAP_HEIGHT, MAP_WIDTH } from '../systems/MapGenerator';
import { ensureQuestStarted, notifyTalkedTo, questTrackerText } from '../systems/QuestSystem';
import { saveGame } from '../systems/SaveSystem';
import { audio } from '../systems/AudioSystem';
import { el } from '../ui/dom';
import { BattleScreen } from './BattleScreen';
import { InventoryScreen } from './InventoryScreen';
import { MainMenuScreen } from './MainMenuScreen';
import { RankingScreen } from './RankingScreen';
import { SkillTreeScreen } from './SkillTreeScreen';

type Dir = 'up' | 'down' | 'left' | 'right';

const DIR_TILE: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const DIR_FORWARD: Record<Dir, THREE.Vector3> = {
  up: new THREE.Vector3(0, 0, -1),
  down: new THREE.Vector3(0, 0, 1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
};

const BASE_MOVE_DURATION = 0.16;
const CAM_DISTANCE = 4.4;
const CAM_HEIGHT = 3.1;
const LOOK_HEIGHT = 1.1;
const INTERACT_RANGE = 1;
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
  private playerModel!: THREE.Group;
  private mountModel: THREE.Group | null = null;
  /** Whichever object currently moves through the world — the rider alone, or the mount carrying them. */
  private avatar!: THREE.Object3D;
  private animator!: CharacterAnimator;
  private dirLight!: THREE.DirectionalLight;
  private npcSlots: NpcSlot[] = [];
  private wildlife: WildlifeSlot[] = [];
  private time = 0;

  private facing: Dir = 'down';
  private isMoving = false;
  private moveT = 0;
  private moveFrom = new THREE.Vector3();
  private moveTo = new THREE.Vector3();
  private pendingEncounterTile: TileType | null = null;

  private heldKeys = new Set<string>();
  private touchDir: Dir | null = null;
  private keydownHandler = (e: KeyboardEvent) => this.onKeyDown(e);
  private keyupHandler = (e: KeyboardEvent) => this.onKeyUp(e);

  private camLookAt = new THREE.Vector3();

  private paused = false;
  private dialogueNpc: NpcDefinition | null = null;
  private dialogueLineIndex = 0;
  private nearbyNpc: NpcDefinition | null = null;

  private promptEl!: HTMLElement;
  private dialogueOverlay!: HTMLElement;
  private dialogueNameEl!: HTMLElement;
  private dialogueLineEl!: HTMLElement;
  private pauseOverlay!: HTMLElement;
  private questTrackerEl!: HTMLElement;
  private mountSectionEl!: HTMLElement;

  constructor(
    private game: Game,
    private player: Player,
  ) {
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  }

  mount(): void {
    ensureQuestStarted(this.player);

    this.scene.background = new THREE.Color(0x8ec9e8);
    this.scene.fog = new THREE.Fog(0x8ec9e8, 16, 46);

    const { tiles } = generateOverworldMap();
    this.tiles = tiles;
    const { group, waterMaterial } = buildOverworldMeshes(tiles);
    this.waterMaterial = waterMaterial;
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
    tileCenterWorld(this.player.mapX, this.player.mapY, this.avatar.position);
    this.applyFacingRotation();

    if (this.player.activeMountId) this.setMounted(this.player.activeMountId, true);

    this.buildNpcs();
    this.spawnWildlife();
    this.positionCameraImmediate();

    this.buildHud();
    this.buildDpad();
    this.buildDialogueOverlay();
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

    if (!this.paused && !this.dialogueNpc) {
      if (this.isMoving) {
        this.moveT = Math.min(1, this.moveT + dt / this.currentMoveDuration());
        this.avatar.position.lerpVectors(this.moveFrom, this.moveTo, this.moveT);
        if (this.moveT >= 1) {
          this.isMoving = false;
          this.onArrivedAtTile();
        }
      } else {
        const dir = this.heldDirection();
        if (dir) this.tryMove(dir);
      }
      this.updateInteraction();
    }

    this.animator.setMoving(this.isMoving);
    this.animator.update(dt);
    this.animateMount(dt);
    this.animateWater();
    this.updateWildlife(dt);
    this.updateCamera(dt);
    this.updateNpcLabels();
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

    if (e.key === 'e' || e.key === 'E') {
      if (this.nearbyNpc) this.openDialogue(this.nearbyNpc);
    }
    if ((e.key === 'm' || e.key === 'M') && !this.isMoving) {
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

  private heldDirection(): Dir | null {
    const k = this.heldKeys;
    if (k.has('arrowup') || k.has('w')) return 'up';
    if (k.has('arrowdown') || k.has('s')) return 'down';
    if (k.has('arrowleft') || k.has('a')) return 'left';
    if (k.has('arrowright') || k.has('d')) return 'right';
    return this.touchDir;
  }

  // --- mounts --------------------------------------------------------

  private isFlyingMounted(): boolean {
    return this.player.activeMountId !== null && getMountById(this.player.activeMountId).kind === 'voadora';
  }

  private currentMoveDuration(): number {
    const mount = this.player.activeMountId ? getMountById(this.player.activeMountId) : null;
    return BASE_MOVE_DURATION / (mount?.speedMultiplier ?? 1);
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
      const mountGroup = buildMountModel(mountId, def.color);
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

  // --- movement ----------------------------------------------------------

  private tryMove(dir: Dir): void {
    this.facing = dir;
    this.applyFacingRotation();

    const { dx, dy } = DIR_TILE[dir];
    const nx = this.player.mapX + dx;
    const ny = this.player.mapY + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) return;

    const destTile = this.tiles[ny][nx];
    const canCross = isWalkable(destTile) || (this.isFlyingMounted() && destTile === TileType.Water);
    if (!canCross) return;
    if (this.npcSlots.some((s) => s.def.mapX === nx && s.def.mapY === ny)) return;

    this.player.mapX = nx;
    this.player.mapY = ny;
    this.moveFrom.copy(this.avatar.position);
    tileCenterWorld(nx, ny, this.moveTo);
    if (this.isFlyingMounted()) this.moveTo.y = FLYING_HOVER_HEIGHT;
    this.moveT = 0;
    this.isMoving = true;
    this.pendingEncounterTile = destTile;
  }

  private onArrivedAtTile(): void {
    const tile = this.pendingEncounterTile;
    this.pendingEncounterTile = null;
    if (this.isFlyingMounted()) return; // soaring above danger
    if (tile !== null && triggersEncounter(tile) && Math.random() < ENCOUNTER_CHANCE_PER_STEP) {
      this.startEncounter();
    }
  }

  private startEncounter(): void {
    audio.encounterStart();
    saveGame(this.player);
    const enemyIds = pickEncounterEnemyIds(this.player.level);
    this.game.goTo(new BattleScreen(this.game, this.player, enemyIds));
  }

  private applyFacingRotation(): void {
    const f = DIR_FORWARD[this.facing];
    this.avatar.rotation.y = Math.atan2(f.x, f.z);
  }

  // --- NPCs & dialogue --------------------------------------------------

  private buildNpcs(): void {
    for (const def of NPC_DEFINITIONS) {
      const model = buildHumanCharacter(def.appearance, 'none');
      tileCenterWorld(def.mapX, def.mapY, model.position);
      model.rotation.y = Math.PI;
      this.scene.add(model);

      const labelEl = el('div', { className: 'npc-label', text: def.name });
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
    const found = this.npcSlots.find(
      (s) => Math.abs(s.def.mapX - this.player.mapX) <= INTERACT_RANGE && Math.abs(s.def.mapY - this.player.mapY) <= INTERACT_RANGE,
    );
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
    this.dialogueNpc = null;
    this.dialogueOverlay.hidden = true;
    this.refreshQuestTracker();
  }

  // --- camera --------------------------------------------------------

  private desiredCameraPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const forward = DIR_FORWARD[this.facing];
    return target
      .copy(this.avatar.position)
      .addScaledVector(forward, -CAM_DISTANCE)
      .add(new THREE.Vector3(0, CAM_HEIGHT, 0));
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

    const desiredLookAt = new THREE.Vector3().copy(this.avatar.position).add(new THREE.Vector3(0, LOOK_HEIGHT, 0));
    this.camLookAt.lerp(desiredLookAt, followLerp);
    this.camera.lookAt(this.camLookAt);

    this.dirLight.position.copy(this.avatar.position).add(new THREE.Vector3(6, 10, 4));
    this.dirLight.target.position.copy(this.avatar.position);
  }

  // --- HUD -------------------------------------------------------------

  private buildHud(): void {
    const stats = this.player.stats;

    this.questTrackerEl = el('div', { className: 'quest-tracker', text: questTrackerText(this.player) });

    const panel = el(
      'div',
      { className: 'panel hud-panel' },
      [
        el('div', { className: 'name-line', text: `${this.player.name} — ${this.player.classDef.name} Nv.${this.player.level}` }),
        el('div', { className: 'hud-hp', text: `HP ${this.player.currentHp}/${stats.maxHp}` }),
        el('div', { className: 'hud-mp', text: `MP ${this.player.currentMp}/${stats.maxMp}` }),
        el('div', { text: `Ouro: ${this.player.gold}` }),
      ],
    );

    const hint = el('div', { className: 'hud-hint', text: 'ESC: menu · M: montaria' });
    this.promptEl = el('div', { className: 'interact-prompt', text: '' });
    this.promptEl.hidden = true;

    this.game.uiRoot.append(panel, hint, this.questTrackerEl, this.promptEl);
  }

  private refreshQuestTracker(): void {
    this.questTrackerEl.textContent = questTrackerText(this.player);
  }

  private buildDpad(): void {
    const makeBtn = (className: string, dir: Dir, label: string) =>
      el('div', {
        className: `dpad-btn ${className}`,
        text: label,
        onPointerDown: (ev) => {
          ev.preventDefault();
          this.touchDir = dir;
        },
        onPointerUp: () => {
          if (this.touchDir === dir) this.touchDir = null;
        },
      });

    const dpad = el('div', { className: 'dpad' }, [
      makeBtn('dpad-up', 'up', '▲'),
      makeBtn('dpad-down', 'down', '▼'),
      makeBtn('dpad-left', 'left', '◀'),
      makeBtn('dpad-right', 'right', '▶'),
    ]);
    this.game.uiRoot.append(dpad);
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
        this.game.goTo(new SkillTreeScreen(this.game, this.player));
      },
    });
    const inventoryBtn = el('div', {
      className: 'btn',
      text: 'Inventário',
      onClick: () => {
        saveGame(this.player);
        this.game.goTo(new InventoryScreen(this.game, this.player));
      },
    });
    const rankingBtn = el('div', {
      className: 'btn',
      text: 'Ranking (estimado)',
      onClick: () => {
        saveGame(this.player);
        this.game.goTo(new RankingScreen(this.game, this.player));
      },
    });
    const exitBtn = el('div', {
      className: 'btn',
      text: 'Salvar e Sair ao Menu',
      onClick: () => {
        saveGame(this.player);
        this.game.goTo(new MainMenuScreen(this.game));
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
