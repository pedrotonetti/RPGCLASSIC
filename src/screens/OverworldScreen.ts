import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { isWalkable, TileType, triggersEncounter } from '../config/tiles';
import { NPC_DEFINITIONS, type NpcDefinition } from '../data/npcs';
import { Player } from '../entities/Player';
import { buildHumanCharacter, buildPlayerCharacter } from '../render/characterModel';
import { buildOverworldMeshes, tileCenterWorld } from '../render/worldBuilder';
import { ENCOUNTER_CHANCE_PER_STEP, pickEncounterEnemyIds } from '../systems/EncounterSystem';
import { generateOverworldMap, MAP_HEIGHT, MAP_WIDTH } from '../systems/MapGenerator';
import { ensureQuestStarted, notifyTalkedTo, questTrackerText } from '../systems/QuestSystem';
import { saveGame } from '../systems/SaveSystem';
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

const MOVE_DURATION = 0.16;
const CAM_DISTANCE = 4.4;
const CAM_HEIGHT = 3.1;
const LOOK_HEIGHT = 1.1;
const INTERACT_RANGE = 1;

interface NpcSlot {
  def: NpcDefinition;
  model: THREE.Group;
  labelEl: HTMLElement;
}

export class OverworldScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private tiles: TileType[][] = [];
  private playerModel!: THREE.Group;
  private dirLight!: THREE.DirectionalLight;
  private npcSlots: NpcSlot[] = [];

  private facing: Dir = 'down';
  private isMoving = false;
  private moveT = 0;
  private moveFrom = new THREE.Vector3();
  private moveTo = new THREE.Vector3();
  private walkTime = 0;
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

    this.playerModel = buildPlayerCharacter(this.player);
    this.scene.add(this.playerModel);
    this.snapPlayerModelToTile(this.player.mapX, this.player.mapY);
    this.applyFacingRotation();

    this.buildNpcs();
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
    if (!this.paused && !this.dialogueNpc) {
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
      this.updateInteraction();
    }

    this.updateCamera(dt);
    this.updateNpcLabels();
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
    if (this.npcSlots.some((s) => s.def.mapX === nx && s.def.mapY === ny)) return;

    this.player.mapX = nx;
    this.player.mapY = ny;
    this.moveFrom.copy(this.playerModel.position);
    tileCenterWorld(nx, ny, this.moveTo);
    this.moveT = 0;
    this.isMoving = true;
    this.pendingEncounterTile = destTile;
  }

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
    if (questMsg) saveGame(this.player);
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

    const hint = el('div', { className: 'hud-hint', text: 'ESC: menu' });
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
      text: 'Ranking Global',
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

    this.pauseOverlay = el('div', { className: 'panel pause-overlay' }, [
      el('h2', { text: 'Pausado' }),
      el('div', { className: 'stack' }, [resumeBtn, inventoryBtn, skillsBtn, rankingBtn, exitBtn]),
    ]);
    this.pauseOverlay.hidden = true;
    this.game.uiRoot.append(this.pauseOverlay);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.pauseOverlay.hidden = !this.paused;
    if (this.paused) saveGame(this.player);
  }
}
