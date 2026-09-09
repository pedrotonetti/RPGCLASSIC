import * as THREE from 'three';
import { getClassById } from '../config/classes';
import type { SkillDefinition } from '../config/types';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { getItemById } from '../data/items';
import { buildEnemyModel, buildPlayerCharacter, getRig } from '../render/characterModel';
import { CharacterAnimator, type ActionName } from '../render/animation';
import { BLOCK_COOLDOWN, CombatEngine, DODGE_COOLDOWN, ITEM_COOLDOWN, type CombatEvent } from '../systems/CombatSystem';
import { computeSkillLevelStats } from '../systems/skillMath';
import { makeGrainTexture } from '../render/worldBuilder';
import { generateOverworldMap } from '../systems/MapGenerator';
import { notifyEnemyDefeated, notifyLevelChanged } from '../systems/QuestSystem';
import { saveGame } from '../systems/SaveSystem';
import { el } from '../ui/dom';
import { OverworldScreen } from './OverworldScreen';

interface EnemySlot {
  enemy: Enemy;
  model: THREE.Group;
  anchor: { x: number; y: number };
  labelEl: HTMLElement;
  hpFillEl: HTMLElement;
  flashTime: number;
  dead: boolean;
}

interface HotbarSlot {
  skill: SkillDefinition;
  level: number;
  totalCooldown: number;
  cost: number;
  el: HTMLElement;
  fillEl: HTMLElement;
  costEl: HTMLElement;
}

interface ItemHotbarSlot {
  itemId: string;
  el: HTMLElement;
  fillEl: HTMLElement;
  countEl: HTMLElement;
}

const FLASH_DURATION = 0.16;
const PLAYER_POS = new THREE.Vector3(-2.3, 0, 0.6);
const CAMERA_POS = new THREE.Vector3(0, 2.7, 7.2);
const CAMERA_LOOKAT = new THREE.Vector3(0, 1.15, -0.6);

export class BattleScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private playerModel!: THREE.Group;
  private animator!: CharacterAnimator;
  private playerFlashTime = 0;
  private enemySlots: EnemySlot[] = [];
  private engine!: CombatEngine;
  private ended = false;

  private statusPanel!: HTMLElement;
  private hpFillEl!: HTMLElement;
  private mpFillEl!: HTMLElement;
  private messageEl!: HTMLElement;
  private fleeFillEl!: HTMLElement;
  private blockFillEl!: HTMLElement;
  private dodgeFillEl!: HTMLElement;
  private comboEl!: HTMLElement;
  private hotbar: HotbarSlot[] = [];
  private itemHotbar: ItemHotbarSlot[] = [];

  private pendingTargetPick: ((index: number) => void) | null = null;

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

    const arenaTex = makeGrainTexture(0x352a44, 16);
    arenaTex.repeat.set(6, 6);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(7, 40),
      new THREE.MeshStandardMaterial({ color: 0xffffff, map: arenaTex, roughness: 0.9 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    const hemi = new THREE.HemisphereLight(0x6a5a8e, 0x241933, 0.5);
    const dirLight = new THREE.DirectionalLight(0xfff0e0, 1.0);
    dirLight.position.set(3, 6, 4);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.set(1024, 1024);
    const shadowCam = dirLight.shadow.camera as THREE.OrthographicCamera;
    shadowCam.left = -7;
    shadowCam.right = 7;
    shadowCam.top = 7;
    shadowCam.bottom = -7;
    this.scene.add(ambient, hemi, dirLight);

    this.camera.position.copy(CAMERA_POS);
    this.camera.lookAt(CAMERA_LOOKAT);

    this.playerModel = buildPlayerCharacter(this.player);
    this.playerModel.position.copy(PLAYER_POS);
    this.playerModel.rotation.y = Math.PI * 0.68;
    this.scene.add(this.playerModel);
    this.animator = new CharacterAnimator(getRig(this.playerModel));

    this.buildEnemies();
    this.engine = new CombatEngine(this.player, this.enemySlots.map((s) => s.enemy));

    this.buildStatusPanel();
    this.buildHotbar();
    this.buildItemBar();

    window.addEventListener('keydown', this.keydownHandler);
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
      this.playerModel.scale.setScalar(1 + 0.15 * (this.playerFlashTime / FLASH_DURATION));
    }
    for (const slot of this.enemySlots) {
      if (slot.flashTime > 0) {
        slot.flashTime = Math.max(0, slot.flashTime - dt);
        slot.model.scale.setScalar(1 + 0.15 * (slot.flashTime / FLASH_DURATION));
      }
    }
    this.animator.update(dt);

    if (this.ended) return;
    const events = this.engine.tick(dt);
    this.processEvents(events);
    this.refreshHotbarCooldowns();
    this.refreshStatusBars();
    this.refreshCombo();
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
      model.position.set(x, enemy.def.isBoss ? 0.2 : 0, -2.2);
      if (id === 'bat') model.position.y = 1.0;
      if (enemy.def.isBoss) model.scale.multiplyScalar(1.15);
      model.rotation.y = -Math.PI * 0.35;
      this.scene.add(model);

      const anchor = this.projectToScreen(new THREE.Vector3(x, model.position.y + 0.9, -2.2));
      const hpFillEl = el('div', { className: 'enemy-hpbar-fg' });
      const labelEl = el(
        'div',
        {
          className: `enemy-label ${enemy.def.isBoss ? 'boss' : ''}`,
          style: { left: `${anchor.x}px`, top: `${anchor.y}px` },
          onClick: () => this.onEnemyPicked(i),
        },
        [el('div', { className: 'ename', text: displayName }), el('div', { className: 'enemy-hpbar-bg' }, [hpFillEl])],
      );
      this.game.uiRoot.append(labelEl);

      this.enemySlots.push({ enemy, model, anchor, labelEl, hpFillEl, flashTime: 0, dead: false });
    });
  }

  private projectToScreen(pos: THREE.Vector3): { x: number; y: number } {
    const p = pos.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * window.innerWidth, y: (-p.y * 0.5 + 0.5) * window.innerHeight };
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
    this.hpFillEl = el('div', { className: 'stat-bar-fg hp' });
    this.mpFillEl = el('div', { className: 'stat-bar-fg mp' });
    this.statusPanel = el('div', { className: 'panel battle-status' }, [
      el('div', { className: 'name-line', text: `${this.player.name} Nv.${this.player.level}` }),
      el('div', { className: 'stat-bar-bg' }, [this.hpFillEl]),
      el('div', { className: 'stat-bar-bg' }, [this.mpFillEl]),
    ]);
    this.game.uiRoot.append(this.statusPanel);
    this.refreshStatusBars();

    this.messageEl = el('div', { className: 'panel battle-message-bar' });
    this.game.uiRoot.append(this.messageEl);

    this.comboEl = el('div', { className: 'combo-badge' });
    this.comboEl.hidden = true;
    this.game.uiRoot.append(this.comboEl);
  }

  private buildHotbar(): void {
    const classDef = getClassById(this.player.classId);
    const skills = [classDef.basicAttack, ...this.player.unlockedSkills.map((u) => u.skill)];

    const fleeFillEl = el('div', { className: 'cd-fill' });
    this.fleeFillEl = fleeFillEl;
    const fleeBtn = el(
      'div',
      { className: 'hotbar-slot flee', onClick: () => this.onFleeClicked() },
      [el('div', { className: 'hotbar-name', text: 'Fugir' }), fleeFillEl],
    );

    const blockFillEl = el('div', { className: 'cd-fill' });
    this.blockFillEl = blockFillEl;
    const blockBtn = el(
      'div',
      { className: 'hotbar-slot block', onClick: () => this.onBlockClicked() },
      [el('div', { className: 'hotbar-name', text: 'Bloquear' }), el('div', { className: 'hotbar-level', text: 'Espaço' }), blockFillEl],
    );

    const dodgeFillEl = el('div', { className: 'cd-fill' });
    this.dodgeFillEl = dodgeFillEl;
    const dodgeBtn = el(
      'div',
      { className: 'hotbar-slot dodge', onClick: () => this.onDodgeClicked() },
      [el('div', { className: 'hotbar-name', text: 'Esquivar' }), el('div', { className: 'hotbar-level', text: 'Shift' }), dodgeFillEl],
    );

    const slotEls: HTMLElement[] = [];
    skills.forEach((skill, i) => {
      const isBasic = skill.id === classDef.basicAttack.id;
      const level = isBasic ? 1 : this.player.skillLevel(skill.id);
      const stats = computeSkillLevelStats(skill, level);
      const fillEl = el('div', { className: 'cd-fill' });
      const costEl = el('div', { className: 'hotbar-cost', text: stats.cost > 0 ? `MP ${stats.cost}` : '' });
      const keyLabel = i === 0 ? 'Básico' : skill.isUltimate ? 'ULT' : `Nv.${level}`;
      const slotEl = el(
        'div',
        { className: `hotbar-slot ${skill.isUltimate ? 'ultimate' : ''}`, onClick: () => this.onHotbarClicked(skill.id) },
        [
          el('div', { className: 'hotbar-name', text: skill.name }),
          el('div', { className: 'hotbar-level', text: keyLabel }),
          costEl,
          fillEl,
        ],
      );
      slotEls.push(slotEl);
      this.hotbar.push({ skill, level, totalCooldown: stats.cooldown, cost: stats.cost, el: slotEl, fillEl, costEl });
    });

    const bar = el('div', { className: 'hotbar' }, [...slotEls, dodgeBtn, blockBtn, fleeBtn]);
    this.game.uiRoot.append(bar);
  }

  private buildItemBar(): void {
    const itemIds = Object.keys(this.player.inventory).filter((id) => (this.player.inventory[id] ?? 0) > 0);
    if (itemIds.length === 0) return;

    const slotEls: HTMLElement[] = [];
    itemIds.forEach((itemId) => {
      const item = getItemById(itemId);
      const fillEl = el('div', { className: 'cd-fill' });
      const countEl = el('div', { className: 'hotbar-cost', text: `x${this.player.inventory[itemId] ?? 0}` });
      const slotEl = el(
        'div',
        { className: 'hotbar-slot item', onClick: () => this.onItemClicked(itemId) },
        [el('div', { className: 'hotbar-name', text: item.name }), countEl, fillEl],
      );
      slotEls.push(slotEl);
      this.itemHotbar.push({ itemId, el: slotEl, fillEl, countEl });
    });

    const bar = el('div', { className: 'item-hotbar' }, slotEls);
    this.game.uiRoot.append(bar);
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && this.pendingTargetPick) {
      this.pendingTargetPick = null;
      this.showMessage('Alvo cancelado.');
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      this.onBlockClicked();
      return;
    }
    if (e.key === 'Shift') {
      this.onDodgeClicked();
      return;
    }
    const num = Number(e.key);
    if (num >= 1 && num <= this.hotbar.length) {
      this.onHotbarClicked(this.hotbar[num - 1].skill.id);
    }
  }

  private onEnemyPicked(index: number): void {
    if (!this.pendingTargetPick) return;
    if (this.enemySlots[index].dead) return;
    const cb = this.pendingTargetPick;
    this.pendingTargetPick = null;
    cb(index);
  }

  private aliveEnemyIndexes(): number[] {
    return this.enemySlots.map((_, i) => i).filter((i) => !this.enemySlots[i].dead);
  }

  private onHotbarClicked(skillId: string): void {
    if (this.ended) return;
    const skill = this.hotbar.find((h) => h.skill.id === skillId)?.skill;
    if (!skill) return;

    if (skill.target === 'enemy') {
      const alive = this.aliveEnemyIndexes();
      if (alive.length === 0) return;
      if (alive.length === 1) {
        this.tryUseSkill(skillId, alive[0]);
        return;
      }
      this.showMessage(`Escolha o alvo de ${skill.name} (clique em um inimigo)...`);
      this.pendingTargetPick = (index) => this.tryUseSkill(skillId, index);
      return;
    }

    this.tryUseSkill(skillId);
  }

  private tryUseSkill(skillId: string, targetIndex?: number): void {
    const result = this.engine.useSkill(skillId, targetIndex);
    if (!result.ok) {
      if (result.reason === 'cooldown') this.showMessage('Habilidade ainda em recarga...');
      else if (result.reason === 'mana') this.showMessage('Mana insuficiente!');
      return;
    }
    this.animator.play(this.actionForSkill(skillId));
    this.processEvents(result.events);
    this.refreshHotbarCooldowns();
    this.refreshStatusBars();
  }

  private actionForSkill(skillId: string): ActionName {
    const skill = this.hotbar.find((h) => h.skill.id === skillId)?.skill;
    if (!skill) return 'attack';
    if (skill.kind === 'magical' || skill.kind === 'heal') return 'cast';
    if (skill.kind === 'buff') return 'defend';
    return 'attack';
  }

  private onItemClicked(itemId: string): void {
    if (this.ended) return;
    const result = this.engine.useItem(itemId);
    if (!result.ok) {
      if (result.reason === 'cooldown') this.showMessage('Aguarde para usar este item novamente...');
      return;
    }
    this.animator.play('eat');
    this.processEvents(result.events);
    this.refreshItemHotbarCounts();
    this.refreshStatusBars();
  }

  private onFleeClicked(): void {
    if (this.ended) return;
    const result = this.engine.attemptFlee();
    if (!result.ok) {
      this.showMessage('Aguarde para tentar fugir novamente...');
      return;
    }
    this.processEvents(result.events);
  }

  private onBlockClicked(): void {
    if (this.ended) return;
    const result = this.engine.attemptBlock();
    if (!result.ok) {
      if (result.reason === 'cooldown') this.showMessage('Bloqueio ainda em recarga...');
      return;
    }
    this.animator.play('defend');
    this.processEvents(result.events);
  }

  private onDodgeClicked(): void {
    if (this.ended) return;
    const result = this.engine.attemptDodge();
    if (!result.ok) {
      if (result.reason === 'cooldown') this.showMessage('Esquiva ainda em recarga...');
      return;
    }
    this.animator.play('dodge');
    this.processEvents(result.events);
  }

  // --- event processing --------------------------------------------------

  private showMessage(text: string): void {
    this.messageEl.textContent = text;
  }

  private processEvents(events: CombatEvent[]): void {
    for (const event of events) {
      if (event.text) this.showMessage(event.text);
      if (event.kind === 'telegraph') {
        this.messageEl.classList.add('telegraph');
        setTimeout(() => this.messageEl.classList.remove('telegraph'), 440);
      }

      if (event.actorIndex !== undefined) this.triggerFlash(event.actorIndex);

      if (event.targetIndex !== undefined) {
        if (event.targetHpAfter !== undefined) this.setEnemyHp(event.targetIndex, event.targetHpAfter);
        this.triggerFlash(event.targetIndex);
        this.popupForEvent(event, this.enemySlots[event.targetIndex].anchor);
        if (event.kind === 'defeated') this.killEnemy(event.targetIndex);
      } else if (event.targetIsPlayer) {
        this.playerFlashTime = FLASH_DURATION;
        if (event.kind === 'damage') this.animator.play('hit');
        const anchor = this.projectToScreen(
          new THREE.Vector3(this.playerModel.position.x, this.playerModel.position.y + 1.5, this.playerModel.position.z),
        );
        this.popupForEvent(event, anchor);
      }

      if (event.kind === 'victory') {
        this.ended = true;
        this.animator.play('victory');
        const questMsg = this.processQuestUpdates();
        if (questMsg) this.showMessage(questMsg);
        saveGame(this.player);
        setTimeout(() => this.game.goTo(new OverworldScreen(this.game, this.player)), questMsg ? 1900 : 1400);
      } else if (event.kind === 'fled') {
        this.ended = true;
        saveGame(this.player);
        setTimeout(() => this.game.goTo(new OverworldScreen(this.game, this.player)), 1400);
      } else if (event.kind === 'defeat') {
        this.ended = true;
        this.handleDefeat();
      }
    }
  }

  private processQuestUpdates(): string | null {
    let lastMessage: string | null = null;
    for (const enemyId of this.enemyIds) {
      const msg = notifyEnemyDefeated(this.player, enemyId);
      if (msg) lastMessage = msg;
    }
    const levelMsg = notifyLevelChanged(this.player);
    if (levelMsg) lastMessage = levelMsg;
    return lastMessage;
  }

  private handleDefeat(): void {
    const { playerStart } = generateOverworldMap();
    this.player.mapX = playerStart.x;
    this.player.mapY = playerStart.y;
    this.player.currentHp = Math.max(1, Math.floor(this.player.stats.maxHp * 0.5));
    this.player.currentMp = this.player.stats.maxMp;
    this.player.gold = Math.floor(this.player.gold * 0.5);
    saveGame(this.player);
    setTimeout(() => {
      this.showMessage('Você foi levado de volta à vila para se recuperar...');
    }, 50);
    setTimeout(() => this.game.goTo(new OverworldScreen(this.game, this.player)), 1900);
  }

  private popupForEvent(event: CombatEvent, anchor: { x: number; y: number }): void {
    let text = '';
    let color = '#ffffff';
    if (event.kind === 'miss') {
      text = 'Errou!';
      color = '#cccccc';
    } else if (event.kind === 'damage' && event.amount) {
      text = `-${event.amount}`;
      color = event.crit ? '#ffcf4e' : '#ffffff';
    } else if (event.kind === 'heal' && event.amount) {
      text = `+${event.amount}`;
      color = '#6bff8e';
    } else {
      return;
    }

    const jitterX = (Math.random() - 0.5) * 20;
    const popup = el('div', {
      className: 'floating-text',
      text,
      style: { left: `${anchor.x + jitterX}px`, top: `${anchor.y}px`, color, opacity: '1' },
    });
    this.game.uiRoot.append(popup);
    requestAnimationFrame(() => {
      popup.style.transform = 'translate(-50%, calc(-50% - 30px))';
      popup.style.opacity = '0';
    });
    setTimeout(() => popup.remove(), 750);
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

  private refreshStatusBars(): void {
    const stats = this.player.stats;
    this.hpFillEl.style.width = `${Math.max(0, (this.player.currentHp / stats.maxHp) * 100)}%`;
    this.mpFillEl.style.width = `${Math.max(0, (this.player.currentMp / stats.maxMp) * 100)}%`;
  }

  private refreshHotbarCooldowns(): void {
    for (const slot of this.hotbar) {
      const remaining = this.engine.cooldownRemaining(slot.skill.id);
      const fraction = slot.totalCooldown > 0 ? Math.min(1, remaining / slot.totalCooldown) : 0;
      slot.fillEl.style.height = `${fraction * 100}%`;
      slot.el.classList.toggle('on-cooldown', remaining > 0.05);
      slot.el.classList.toggle('no-mana', this.player.currentMp < slot.cost && remaining <= 0.05);
    }
    for (const slot of this.itemHotbar) {
      const remaining = this.engine.cooldownRemaining(`item_${slot.itemId}`);
      const fraction = Math.min(1, remaining / ITEM_COOLDOWN);
      slot.fillEl.style.height = `${fraction * 100}%`;
    }
    const fleeRemaining = this.engine.fleeCooldownRemaining();
    this.fleeFillEl.style.height = `${Math.min(1, fleeRemaining / 4) * 100}%`;
    const blockRemaining = this.engine.blockCooldownRemaining();
    this.blockFillEl.style.height = `${Math.min(1, blockRemaining / BLOCK_COOLDOWN) * 100}%`;
    const dodgeRemaining = this.engine.dodgeCooldownRemaining();
    this.dodgeFillEl.style.height = `${Math.min(1, dodgeRemaining / DODGE_COOLDOWN) * 100}%`;
  }

  private refreshCombo(): void {
    const hits = this.engine.comboHits;
    if (hits > 1) {
      this.comboEl.textContent = `Combo x${hits}`;
      this.comboEl.hidden = false;
    } else {
      this.comboEl.hidden = true;
    }
  }

  private refreshItemHotbarCounts(): void {
    for (const slot of this.itemHotbar) {
      const count = this.player.inventory[slot.itemId] ?? 0;
      slot.countEl.textContent = `x${count}`;
      slot.el.classList.toggle('depleted', count <= 0);
    }
  }
}

