import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { getClassById } from '../config/classes';
import { isWalkable, TileType, triggersEncounter } from '../config/tiles';
import { Player } from '../entities/Player';
import { buildClassModel } from '../render/characterModel';
import { buildOverworldMeshes, tileCenterWorld } from '../render/worldBuilder';
import { ENCOUNTER_CHANCE_PER_STEP, pickEncounterEnemyIds } from '../systems/EncounterSystem';
import { generateOverworldMap, MAP_HEIGHT, MAP_WIDTH } from '../systems/MapGenerator';
import { saveGame } from '../systems/SaveSystem';
import { el } from '../ui/dom';
import { BattleScreen } from './BattleScreen';
import { MainMenuScreen } from './MainMenuScreen';

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

const MOVE_DURATION = 0.16;
const CAM_DISTANCE = 4.4;
const CAM_HEIGHT = 3.1;
const LOOK_HEIGHT = 1.1;

export class OverworldScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private tiles: TileType[][] = [];
  private playerModel!: THREE.Group;
  private dirLight!: THREE.DirectionalLight;

  private facing: Dir = 'down';
  private isMoving = false;
  private moveT = 0;
  private moveFrom = new THREE.Vector3();
  private moveTo = new THREE.Vector3();
  private walkTime = 0;

  private heldKeys = new Set<string>();
  private touchDir: Dir | null = null;
  private keydownHandler = (e: KeyboardEvent) => this.onKeyDown(e);
  private keyupHandler = (e: KeyboardEvent) => this.onKeyUp(e);

  private camLookAt = new THREE.Vector3();

  constructor(
    private game: Game,
    private player: Player,
  ) {
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x8ec9e8);
    this.scene.fog = new THREE.Fog(0x8ec9e8, 16, 46);

    const { tiles } = generateOverworldMap();
    this.tiles = tiles;
    const { group } = buildOverworldMeshes(tiles);
    this.scene.add(group);

    const ambient = new THREE.AmbientLight(0xffffff, 0.65);
    this.scene.add(ambient);

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

    const classDef = getClassById(this.player.classId);
    this.playerModel = buildClassModel(this.player.classId, classDef.color);
    this.scene.add(this.playerModel);
    this.snapPlayerModelToTile(this.player.mapX, this.player.mapY);
    this.applyFacingRotation();

    this.positionCameraImmediate();

    this.buildHud();
    this.buildDpad();

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
    if (this.isMoving) {
      this.moveT = Math.min(1, this.moveT + dt / MOVE_DURATION);
      this.playerModel.position.lerpVectors(this.moveFrom, this.moveTo, this.moveT);
      this.walkTime += dt;
      this.playerModel.position.y = Math.abs(Math.sin(this.walkTime * 13)) * 0.06;
      if (this.moveT >= 1) {
        this.isMoving = false;
        this.playerModel.position.y = 0;
        this.onArrivedAtTile();
      }
    } else {
      const dir = this.heldDirection();
      if (dir) this.tryMove(dir);
    }

    this.updateCamera(dt);
  }

  // --- input -----------------------------------------------------------

  private onKeyDown(e: KeyboardEvent): void {
    this.heldKeys.add(e.key.toLowerCase());
    if (e.key === 'Escape') {
      saveGame(this.player);
      this.game.goTo(new MainMenuScreen(this.game));
    }
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

  // --- movement ----------------------------------------------------------

  private tryMove(dir: Dir): void {
    this.facing = dir;
    this.applyFacingRotation();

    const { dx, dy } = DIR_TILE[dir];
    const nx = this.player.mapX + dx;
    const ny = this.player.mapY + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) return;

    const destTile = this.tiles[ny][nx];
    if (!isWalkable(destTile)) return;

    this.player.mapX = nx;
    this.player.mapY = ny;
    this.moveFrom.copy(this.playerModel.position);
    tileCenterWorld(nx, ny, this.moveTo);
    this.moveT = 0;
    this.isMoving = true;
    this.pendingEncounterTile = destTile;
  }

  private pendingEncounterTile: TileType | null = null;

  private onArrivedAtTile(): void {
    const tile = this.pendingEncounterTile;
    this.pendingEncounterTile = null;
    if (tile !== null && triggersEncounter(tile) && Math.random() < ENCOUNTER_CHANCE_PER_STEP) {
      this.startEncounter();
    }
  }

  private startEncounter(): void {
    saveGame(this.player);
    const enemyIds = pickEncounterEnemyIds(this.player.level);
    this.game.goTo(new BattleScreen(this.game, this.player, enemyIds));
  }

  private snapPlayerModelToTile(x: number, y: number): void {
    tileCenterWorld(x, y, this.playerModel.position);
  }

  private applyFacingRotation(): void {
    const f = DIR_FORWARD[this.facing];
    this.playerModel.rotation.y = Math.atan2(f.x, f.z);
  }

  // --- camera --------------------------------------------------------

  private desiredCameraPosition(target = new THREE.Vector3()): THREE.Vector3 {
    const forward = DIR_FORWARD[this.facing];
    return target
      .copy(this.playerModel.position)
      .addScaledVector(forward, -CAM_DISTANCE)
      .add(new THREE.Vector3(0, CAM_HEIGHT, 0));
  }

  private positionCameraImmediate(): void {
    this.desiredCameraPosition(this.camera.position);
    this.camLookAt.copy(this.playerModel.position).add(new THREE.Vector3(0, LOOK_HEIGHT, 0));
    this.camera.lookAt(this.camLookAt);
  }

  private updateCamera(dt: number): void {
    const desired = this.desiredCameraPosition();
    const followLerp = 1 - Math.exp(-dt * 6);
    this.camera.position.lerp(desired, followLerp);

    const desiredLookAt = new THREE.Vector3().copy(this.playerModel.position).add(new THREE.Vector3(0, LOOK_HEIGHT, 0));
    this.camLookAt.lerp(desiredLookAt, followLerp);
    this.camera.lookAt(this.camLookAt);

    this.dirLight.position.copy(this.playerModel.position).add(new THREE.Vector3(6, 10, 4));
    this.dirLight.target.position.copy(this.playerModel.position);
  }

  // --- HUD -------------------------------------------------------------

  private buildHud(): void {
    const classDef = getClassById(this.player.classId);
    const stats = this.player.stats;

    const panel = el(
      'div',
      { className: 'panel hud-panel' },
      [
        el('div', { className: 'name-line', text: `${this.player.name} — ${classDef.name} Nv.${this.player.level}` }),
        el('div', { className: 'hud-hp', text: `HP ${this.player.currentHp}/${stats.maxHp}` }),
        el('div', { className: 'hud-mp', text: `MP ${this.player.currentMp}/${stats.maxMp}` }),
        el('div', { text: `Ouro: ${this.player.gold}` }),
      ],
    );

    const hint = el('div', { className: 'hud-hint', text: 'ESC: salvar e sair' });

    this.game.uiRoot.append(panel, hint);
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
}
