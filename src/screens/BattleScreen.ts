import * as THREE from 'three';
import { getItemById } from '../data/items';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { getClassById } from '../config/classes';
import type { Skill } from '../config/types';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { buildClassModel, buildEnemyModel } from '../render/characterModel';
import { BattleEngine, type LogEntry, type PlayerAction, type RoundResult } from '../systems/CombatSystem';
import { generateOverworldMap } from '../systems/MapGenerator';
import { saveGame } from '../systems/SaveSystem';
import { el } from '../ui/dom';
import { OverworldScreen } from './OverworldScreen';

interface MenuEntry {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface EnemySlot {
  enemy: Enemy;
  model: THREE.Group;
  displayName: string;
  anchor: { x: number; y: number };
  labelEl: HTMLElement;
  hpFillEl: HTMLElement;
  flashTime: number;
  dead: boolean;
}

const ENTRY_DELAY = 0.85;
const FLASH_DURATION = 0.16;
const PLAYER_POS = new THREE.Vector3(-2.3, 0, 0.6);
const CAMERA_POS = new THREE.Vector3(0, 2.7, 7.2);
const CAMERA_LOOKAT = new THREE.Vector3(0, 1.15, -0.6);

export class BattleScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private playerModel!: THREE.Group;
  private playerFlashTime = 0;
  private enemySlots: EnemySlot[] = [];
  private engine!: BattleEngine;

  private statusPanel!: HTMLElement;
  private bottomPanel!: HTMLElement;

  private currentMenu: MenuEntry[] = [];
  private menuCursor = 0;
  private pendingTargetPick: ((index: number) => void) | null = null;
  private busy = false;

  private playback: { entries: LogEntry[]; index: number; timer: number; onDone: () => void } | null = null;

  private keydownHandler = (e: KeyboardEvent) => this.onKeyDown(e);

  constructor(
    private game: Game,
    private player: Player,
    private enemyIds: string[],
  ) {
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x241933);
    this.scene.fog = new THREE.Fog(0x241933, 9, 22);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(7, 40),
      new THREE.MeshStandardMaterial({ color: 0x352a44, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    const dirLight = new THREE.DirectionalLight(0xfff0e0, 1.0);
    dirLight.position.set(3, 6, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    const shadowCam = dirLight.shadow.camera as THREE.OrthographicCamera;
    shadowCam.left = -7;
    shadowCam.right = 7;
    shadowCam.top = 7;
    shadowCam.bottom = -7;
    this.scene.add(ambient, dirLight);

    this.camera.position.copy(CAMERA_POS);
    this.camera.lookAt(CAMERA_LOOKAT);

    const classDef = getClassById(this.player.classId);
    this.playerModel = buildClassModel(this.player.classId, classDef.color);
    this.playerModel.position.copy(PLAYER_POS);
    this.playerModel.rotation.y = Math.PI * 0.68;
    this.scene.add(this.playerModel);

    this.buildEnemies();

    this.engine = new BattleEngine(
      this.player,
      this.enemySlots.map((s) => s.enemy),
    );

    this.buildStatusPanel();
    this.buildBottomPanel();
    this.refreshPlayerStatus();

    window.addEventListener('keydown', this.keydownHandler);

    this.showMainMenu();
  }

  unmount(): void {
    window.removeEventListener('keydown', this.keydownHandler);
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.repositionEnemyLabels();
  }

  update(dt: number): void {
    if (this.playerFlashTime > 0) {
      this.playerFlashTime = Math.max(0, this.playerFlashTime - dt);
      const s = 1 + 0.15 * (this.playerFlashTime / FLASH_DURATION);
      this.playerModel.scale.setScalar(s);
    }
    for (const slot of this.enemySlots) {
      if (slot.flashTime > 0) {
        slot.flashTime = Math.max(0, slot.flashTime - dt);
        const s = 1 + 0.15 * (slot.flashTime / FLASH_DURATION);
        slot.model.scale.setScalar(s);
      }
    }

    if (this.playback) {
      this.playback.timer -= dt;
      if (this.playback.timer <= 0) this.advancePlayback();
    }
  }

  // --- setup -----------------------------------------------------------

  private buildEnemies(): void {
    const counts: Record<string, number> = {};
    const n = this.enemyIds.length;

    this.enemyIds.forEach((id, i) => {
      const enemy = new Enemy(id);
      const total = this.enemyIds.filter((other) => other === id).length;
      let displayName = enemy.name;
      if (total > 1) {
        counts[id] = (counts[id] ?? 0) + 1;
        displayName = `${enemy.name} ${String.fromCharCode(64 + counts[id])}`;
      }

      const model = buildEnemyModel(id, enemy.color);
      const x = (i - (n - 1) / 2) * 1.9;
      model.position.set(x, 0, -2.2);
      if (id === 'bat') model.position.y = 1.0;
      model.rotation.y = -Math.PI * 0.35;
      this.scene.add(model);

      const anchor = this.projectToScreen(new THREE.Vector3(x, model.position.y + 0.9, -2.2));
      const hpFillEl = el('div', { className: 'enemy-hpbar-fg' });
      const labelEl = el(
        'div',
        {
          className: 'enemy-label',
          style: { left: `${anchor.x}px`, top: `${anchor.y}px` },
          onClick: () => this.onEnemyPicked(i),
        },
        [el('div', { className: 'ename', text: displayName }), el('div', { className: 'enemy-hpbar-bg' }, [hpFillEl])],
      );
      this.game.uiRoot.append(labelEl);

      this.enemySlots.push({ enemy, model, displayName, anchor, labelEl, hpFillEl, flashTime: 0, dead: false });
    });

    this.refreshEnemyBars();
  }

  private projectToScreen(pos: THREE.Vector3): { x: number; y: number } {
    const p = pos.clone().project(this.camera);
    return {
      x: (p.x * 0.5 + 0.5) * window.innerWidth,
      y: (-p.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  private repositionEnemyLabels(): void {
    for (const slot of this.enemySlots) {
      const anchor = this.projectToScreen(
        new THREE.Vector3(slot.model.position.x, slot.model.position.y + 0.9, slot.model.position.z),
      );
      slot.anchor = anchor;
      slot.labelEl.style.left = `${anchor.x}px`;
      slot.labelEl.style.top = `${anchor.y}px`;
    }
  }

  private buildStatusPanel(): void {
    this.statusPanel = el('div', { className: 'panel battle-status' });
    this.game.uiRoot.append(this.statusPanel);
  }

  private buildBottomPanel(): void {
    this.bottomPanel = el('div', { className: 'panel battle-bottom' });
    this.game.uiRoot.append(this.bottomPanel);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowUp') this.moveCursor(-1);
    else if (e.key === 'ArrowDown') this.moveCursor(1);
    else if (e.key === 'Enter') this.confirmCursor();
    else if (e.key === 'Escape' && this.pendingTargetPick) {
      this.pendingTargetPick = null;
      this.showMainMenu();
    }
  }

  private moveCursor(delta: number): void {
    if (this.busy || this.currentMenu.length === 0) return;
    const len = this.currentMenu.length;
    this.menuCursor = (this.menuCursor + delta + len) % len;
    this.renderMenuList();
  }

  private confirmCursor(): void {
    if (this.busy || this.currentMenu.length === 0) return;
    const entry = this.currentMenu[this.menuCursor];
    if (!entry.disabled) entry.onSelect();
  }

  private onEnemyPicked(index: number): void {
    if (!this.pendingTargetPick) return;
    if (this.enemySlots[index].dead) return;
    const cb = this.pendingTargetPick;
    this.pendingTargetPick = null;
    cb(index);
  }

  // --- menu rendering ----------------------------------------------------

  private renderMenuList(): void {
    this.bottomPanel.replaceChildren();
    const list = el(
      'div',
      { className: 'battle-menu-list' },
      this.currentMenu.map((entry, i) =>
        el('div', {
          className: `battle-menu-item ${entry.disabled ? 'disabled' : ''} ${i === this.menuCursor ? 'active' : ''}`,
          text: `${i === this.menuCursor ? '▶ ' : '  '}${entry.label}`,
          onClick: () => {
            if (entry.disabled) return;
            this.menuCursor = i;
            entry.onSelect();
          },
        }),
      ),
    );
    this.bottomPanel.append(list);
  }

  private showMessage(text: string): void {
    this.bottomPanel.replaceChildren(el('div', { className: 'battle-message', text }));
  }

  // --- top-level menus -----------------------------------------------

  private showMainMenu(): void {
    this.busy = false;
    this.pendingTargetPick = null;
    this.menuCursor = 0;
    this.currentMenu = [
      { label: 'Atacar', onSelect: () => this.chooseAttack() },
      { label: 'Habilidade', onSelect: () => this.showSkillMenu() },
      { label: 'Item', onSelect: () => this.showItemMenu() },
      { label: 'Fugir', onSelect: () => this.performAction({ type: 'run' }) },
    ];
    this.renderMenuList();
  }

  private aliveEnemyIndexes(): number[] {
    return this.enemySlots.map((_, i) => i).filter((i) => !this.enemySlots[i].dead);
  }

  private chooseAttack(): void {
    const alive = this.aliveEnemyIndexes();
    if (alive.length === 1) {
      this.performAction({ type: 'attack', targetIndex: alive[0] });
      return;
    }
    this.enterTargetSelection('Escolha o alvo do ataque (clique em um inimigo)...', (index) =>
      this.performAction({ type: 'attack', targetIndex: index }),
    );
  }

  private showSkillMenu(): void {
    this.menuCursor = 0;
    this.currentMenu = [
      ...this.player.availableSkills.map((s) => ({
        label: `${s.name} (MP ${s.mpCost})`,
        disabled: this.player.currentMp < s.mpCost,
        onSelect: () => this.chooseSkill(s),
      })),
      { label: 'Voltar', onSelect: () => this.showMainMenu() },
    ];
    this.renderMenuList();
  }

  private chooseSkill(skill: Skill): void {
    if (skill.target === 'self' || skill.target === 'allEnemies') {
      this.performAction({ type: 'skill', skillId: skill.id });
      return;
    }
    const alive = this.aliveEnemyIndexes();
    if (alive.length === 1) {
      this.performAction({ type: 'skill', skillId: skill.id, targetIndex: alive[0] });
      return;
    }
    this.enterTargetSelection(`Escolha o alvo de ${skill.name} (clique em um inimigo)...`, (index) =>
      this.performAction({ type: 'skill', skillId: skill.id, targetIndex: index }),
    );
  }

  private showItemMenu(): void {
    this.menuCursor = 0;
    const entries: MenuEntry[] = Object.entries(this.player.inventory)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, qty]) => {
        const item = getItemById(itemId);
        return { label: `${item.name} x${qty}`, onSelect: () => this.performAction({ type: 'item', itemId }) };
      });
    if (entries.length === 0) entries.push({ label: '(sem itens)', disabled: true, onSelect: () => {} });
    entries.push({ label: 'Voltar', onSelect: () => this.showMainMenu() });
    this.currentMenu = entries;
    this.renderMenuList();
  }

  private enterTargetSelection(message: string, onPick: (index: number) => void): void {
    this.currentMenu = [];
    this.showMessage(message);
    this.pendingTargetPick = onPick;
  }

  // --- action resolution ------------------------------------------------

  private performAction(action: PlayerAction): void {
    this.busy = true;
    this.pendingTargetPick = null;
    this.currentMenu = [];
    this.showMessage('...');

    const result = this.engine.resolveRound(action);
    this.playback = { entries: result.entries, index: -1, timer: 0, onDone: () => this.onRoundResolved(result) };
    this.advancePlayback();
  }

  private advancePlayback(): void {
    if (!this.playback) return;
    this.playback.index += 1;
    if (this.playback.index >= this.playback.entries.length) {
      const done = this.playback.onDone;
      this.playback = null;
      done();
      return;
    }
    const entry = this.playback.entries[this.playback.index];
    this.showEntry(entry);
    this.playback.timer = ENTRY_DELAY;
  }

  private showEntry(entry: LogEntry): void {
    this.showMessage(entry.text);

    if (entry.actorIndex !== undefined) this.triggerFlash(entry.actorIndex);

    if (entry.targetIndex !== undefined) {
      const slot = this.enemySlots[entry.targetIndex];
      if (entry.targetHpAfter !== undefined) this.setEnemyHp(entry.targetIndex, entry.targetHpAfter);
      this.triggerFlash(entry.targetIndex);
      this.popupAt(slot.anchor, entry);
      if (entry.defeated) this.killEnemy(entry.targetIndex);
    } else if (entry.targetName === this.player.name) {
      this.playerFlashTime = FLASH_DURATION;
      this.refreshPlayerStatus();
      const anchor = this.projectToScreen(
        new THREE.Vector3(this.playerModel.position.x, this.playerModel.position.y + 1.5, this.playerModel.position.z),
      );
      this.popupAt(anchor, entry);
    }
  }

  private triggerFlash(enemyIndex: number): void {
    const slot = this.enemySlots[enemyIndex];
    if (slot && !slot.dead) slot.flashTime = FLASH_DURATION;
  }

  private setEnemyHp(index: number, hp: number): void {
    const slot = this.enemySlots[index];
    const ratio = Math.max(0, Math.min(1, hp / slot.enemy.stats.maxHp));
    slot.hpFillEl.style.width = `${ratio * 100}%`;
  }

  private killEnemy(index: number): void {
    const slot = this.enemySlots[index];
    slot.dead = true;
    slot.model.visible = false;
    slot.labelEl.classList.add('defeated');
  }

  private refreshEnemyBars(): void {
    this.enemySlots.forEach((slot, i) => this.setEnemyHp(i, slot.enemy.currentHp));
  }

  private refreshPlayerStatus(): void {
    const stats = this.player.stats;
    this.statusPanel.replaceChildren(
      el('div', { text: `${this.player.name} Nv.${this.player.level}` }),
      el('div', { text: `HP ${this.player.currentHp}/${stats.maxHp}   MP ${this.player.currentMp}/${stats.maxMp}` }),
    );
  }

  private popupAt(anchor: { x: number; y: number }, entry: LogEntry): void {
    let text = '';
    let color = '#ffffff';
    if (entry.missed) {
      text = 'Errou!';
      color = '#cccccc';
    } else if (entry.damage) {
      text = `-${entry.damage}`;
      color = entry.crit ? '#ffcf4e' : '#ffffff';
    } else if (entry.healed) {
      text = `+${entry.healed}`;
      color = '#6bff8e';
    } else {
      return;
    }

    const popup = el('div', {
      className: 'floating-text',
      text,
      style: { left: `${anchor.x}px`, top: `${anchor.y}px`, color, opacity: '1' },
    });
    this.game.uiRoot.append(popup);
    requestAnimationFrame(() => {
      popup.style.transform = 'translate(-50%, calc(-50% - 30px))';
      popup.style.opacity = '0';
    });
    setTimeout(() => popup.remove(), 750);
  }

  // --- round outcome -----------------------------------------------------

  private onRoundResolved(result: RoundResult): void {
    saveGame(this.player);

    if (result.outcome === 'ongoing') {
      this.showMainMenu();
      return;
    }

    if (result.outcome === 'victory' || result.outcome === 'fled') {
      setTimeout(() => this.game.goTo(new OverworldScreen(this.game, this.player)), 1200);
      return;
    }

    const { playerStart } = generateOverworldMap();
    this.player.mapX = playerStart.x;
    this.player.mapY = playerStart.y;
    this.player.currentHp = Math.max(1, Math.floor(this.player.stats.maxHp * 0.5));
    this.player.currentMp = this.player.stats.maxMp;
    this.player.gold = Math.floor(this.player.gold * 0.5);
    saveGame(this.player);
    this.showMessage('Você foi levado de volta à vila para se recuperar...');
    setTimeout(() => this.game.goTo(new OverworldScreen(this.game, this.player)), 1800);
  }
}
