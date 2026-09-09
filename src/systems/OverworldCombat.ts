import * as THREE from 'three';
import { getClassById } from '../config/classes';
import { TileType } from '../config/tiles';
import type { SkillDefinition } from '../config/types';
import type { Game } from '../engine/Game';
import { Enemy } from '../entities/Enemy';
import type { Player } from '../entities/Player';
import { getItemById } from '../data/items';
import { buildEnemyModel } from '../render/characterModel';
import type { CharacterAnimator, ActionName } from '../render/animation';
import { BLOCK_COOLDOWN, CombatEngine, DODGE_COOLDOWN, ITEM_COOLDOWN, type CombatEvent } from './CombatSystem';
import { audio } from './AudioSystem';
import { computeSkillLevelStats } from './skillMath';
import { pickEncounterEnemyIds } from './EncounterSystem';
import { notifyEnemyDefeated, notifyLevelChanged } from './QuestSystem';
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

const FLASH_DURATION = 0.16;
const MONSTER_COUNT = 12;
const MIN_SPAWN_DIST_FROM_START = 6; // tiles
const MIN_SPAWN_SPACING = 5; // tiles
const AGGRO_RADIUS = 3.4;
const DEAGGRO_RADIUS = 6.0;
const ATTACK_RANGE = 1.15;
const CHASE_BASE_SPEED = 1.1;
const CHASE_SPEED_PER_STAT = 0.06;
const WANDER_RADIUS = 1.8;
const WANDER_SPEED = 0.55;
const RESPAWN_DELAY = 40; // seconds
const LABEL_VISIBLE_DISTANCE = 13; // world units — roughly where the scene fog starts hiding things anyway

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

  private pendingTargetPick: ((monster: WorldMonster) => void) | null = null;

  constructor(
    private game: Game,
    private player: Player,
    private scene: THREE.Scene,
    private animator: CharacterAnimator,
    private onDefeat: () => void,
  ) {}

  get inCombat(): boolean {
    return this.engine !== null;
  }

  /** Places a handful of monsters on grass tiles scattered across the map, well clear of the player's start. */
  spawnMonsters(tiles: TileType[][], startTile: { x: number; y: number }): void {
    this.messageEl = el('div', { className: 'panel battle-message-bar' });
    this.messageEl.hidden = true;
    this.comboEl = el('div', { className: 'combo-badge' });
    this.comboEl.hidden = true;
    this.game.uiRoot.append(this.messageEl, this.comboEl);

    const points = pickSpawnPoints(tiles, startTile, MONSTER_COUNT);
    for (const p of points) {
      const ids = pickEncounterEnemyIds(this.player.level);
      this.monsters.push(this.buildMonster(ids[0], p.x, p.y));
    }
  }

  private buildMonster(enemyId: string, tx: number, ty: number): WorldMonster {
    const enemy = new Enemy(enemyId);
    const model = buildEnemyModel(enemyId, enemy.color);
    const spawnX = tx * 2 + 1;
    const spawnZ = ty * 2 + 1;
    const baseScale = enemy.def.isBoss ? 1.15 : 1;
    model.scale.setScalar(baseScale);
    model.position.set(spawnX, enemyId === 'bat' ? 1.0 : 0, spawnZ);
    model.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(model);

    const hpFillEl = el('div', { className: 'enemy-hpbar-fg' });
    const labelEl = el(
      'div',
      {
        className: `enemy-label world ${enemy.def.isBoss ? 'boss' : ''}`,
        onClick: () => this.onMonsterPicked(monster),
      },
      [el('div', { className: 'ename', text: enemy.name }), el('div', { className: 'enemy-hpbar-bg' }, [hpFillEl])],
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
    };
    return monster;
  }

  /** Advances monster AI, the active fight (if any), and refreshes all combat HUD elements. Call every frame. */
  update(dt: number, playerPos: THREE.Vector3, camera: THREE.Camera): void {
    this.clock += dt;

    for (const m of this.monsters) {
      this.updateMonster(m, dt, playerPos);
    }
    this.updateLabels(camera, playerPos);

    if (this.engine) {
      const events = this.engine.tick(dt);
      this.processEvents(events);
      this.refreshHotbarCooldowns();
      this.refreshCombo();
      if (this.engine.outcome !== 'ongoing') this.endEngagement(this.engine.outcome);
    }

    if (this.messageHideAt > 0 && this.clock >= this.messageHideAt) {
      this.messageEl.hidden = true;
      this.messageHideAt = 0;
    }
  }

  private updateMonster(m: WorldMonster, dt: number, playerPos: THREE.Vector3): void {
    if (m.state === 'dead') {
      if (m.respawnAt >= 0 && this.clock >= m.respawnAt) this.respawnMonster(m);
      return;
    }
    if (m.flashTime > 0) {
      m.flashTime = Math.max(0, m.flashTime - dt);
      m.model.scale.setScalar(m.baseScale * (1 + 0.15 * (m.flashTime / FLASH_DURATION)));
    }

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

    if (dist <= AGGRO_RADIUS) {
      m.state = 'chase';
    } else if (m.state === 'chase' && dist > DEAGGRO_RADIUS) {
      m.state = 'idle';
      m.wanderTarget = null;
    }

    if (m.state === 'chase') {
      const speed = CHASE_BASE_SPEED + m.enemy.stats.speed * CHASE_SPEED_PER_STAT;
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

  private respawnMonster(m: WorldMonster): void {
    m.enemy = new Enemy(m.enemy.definitionId);
    m.model.position.set(m.spawnX, m.enemy.definitionId === 'bat' ? 1.0 : 0, m.spawnZ);
    m.model.visible = true;
    m.labelEl.classList.remove('defeated');
    m.state = 'idle';
    m.waitTimer = 1 + Math.random() * 3;
    m.respawnAt = -1;
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
    if (!this.engine) {
      this.engine = new CombatEngine(this.player, []);
      this.buildHotbar();
      this.buildItemBar();
    }
    this.engine.enemies.push(m.enemy);
    this.engagedMonsters.push(m);
  }

  private endEngagement(outcome: 'victory' | 'defeat' | 'fled'): void {
    if (outcome === 'victory') {
      let lastMessage: string | null = null;
      for (const m of this.engagedMonsters) {
        const msg = notifyEnemyDefeated(this.player, m.enemy.definitionId);
        if (msg) lastMessage = msg;
      }
      const levelMsg = notifyLevelChanged(this.player);
      if (levelMsg) lastMessage = levelMsg;
      if (lastMessage) this.showMessage(lastMessage, 2200);
      saveGame(this.player);
    } else if (outcome === 'defeat') {
      this.showMessage('Você foi levado de volta à vila para se recuperar...', 2200);
      this.onDefeat();
    }

    this.pendingTargetPick = null;
    for (const m of this.engagedMonsters) {
      if (m.state === 'engaged') {
        // Wasn't killed (fight ended some other way) — let it resume noticing the player normally.
        m.state = 'chase';
      }
    }
    this.engagedMonsters = [];
    this.engine = null;
    this.hotbar = [];
    this.itemHotbar = [];
    this.hotbarEl?.remove();
    this.itemBarEl?.remove();
    this.hotbarEl = null;
    this.itemBarEl = null;
    this.comboEl.hidden = true;
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
      const fillEl = el('div', { className: 'cd-fill' });
      const costEl = el('div', { className: 'hotbar-cost', text: stats.cost > 0 ? `MP ${stats.cost}` : '' });
      const keyLabel = i === 0 ? 'Básico' : skill.isUltimate ? 'ULT' : `Nv.${level}`;
      const slotEl = el(
        'div',
        { className: `hotbar-slot ${skill.isUltimate ? 'ultimate' : ''}`, onClick: () => this.onHotbarClicked(skill.id) },
        [el('div', { className: 'hotbar-name', text: skill.name }), el('div', { className: 'hotbar-level', text: keyLabel }), costEl, fillEl],
      );
      slotEls.push(slotEl);
      this.hotbar.push({ skill, totalCooldown: stats.cooldown, cost: stats.cost, el: slotEl, fillEl });
    });

    this.hotbarEl = el('div', { className: 'hotbar' }, [...slotEls, dodgeBtn, blockBtn]);
    this.game.uiRoot.append(this.hotbarEl);
  }

  private buildItemBar(): void {
    const itemIds = Object.keys(this.player.inventory).filter((id) => (this.player.inventory[id] ?? 0) > 0);
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
    const result = this.engine.useSkill(skillId, targetIndex);
    if (!result.ok) {
      if (result.reason === 'cooldown') this.showMessage('Habilidade ainda em recarga...', 1200);
      else if (result.reason === 'mana') this.showMessage('Mana insuficiente!', 1200);
      return;
    }
    const action = this.actionForSkill(skillId);
    this.animator.play(action);
    if (action === 'cast') audio.castSpell();
    else audio.attackSwing();
    this.processEvents(result.events);
    this.refreshHotbarCooldowns();
  }

  private actionForSkill(skillId: string): ActionName {
    const skill = this.hotbar.find((h) => h.skill.id === skillId)?.skill;
    if (!skill) return 'attack';
    if (skill.kind === 'magical' || skill.kind === 'heal') return 'cast';
    if (skill.kind === 'buff') return 'defend';
    return 'attack';
  }

  private onItemClicked(itemId: string): void {
    if (!this.engine) return;
    const result = this.engine.useItem(itemId);
    if (!result.ok) {
      if (result.reason === 'cooldown') this.showMessage('Aguarde para usar este item novamente...', 1200);
      return;
    }
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

  // --- event processing ---------------------------------------------------

  private showMessage(text: string, durationMs: number): void {
    this.messageEl.textContent = text;
    this.messageEl.hidden = false;
    this.messageHideAt = this.clock + durationMs / 1000;
  }

  private monsterForEnemy(enemy: Enemy): WorldMonster | undefined {
    return this.engagedMonsters.find((m) => m.enemy === enemy);
  }

  private processEvents(events: CombatEvent[]): void {
    if (!this.engine) return;
    for (const event of events) {
      if (event.text) this.showMessage(event.text, 2600);
      if (event.kind === 'telegraph') {
        this.messageEl.classList.add('telegraph');
        setTimeout(() => this.messageEl.classList.remove('telegraph'), 440);
        audio.telegraphWarning();
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
          this.popupForEvent(event, this.labelAnchor(m));
        }
        if (event.kind === 'damage') audio.hitImpact(event.crit);
        if (event.kind === 'defeated' && m) {
          this.killMonster(m);
          audio.enemyDefeated();
        }
      } else if (event.targetIsPlayer) {
        if (event.kind === 'damage') {
          this.animator.play('hit');
          if (event.mitigation === 'block' || event.mitigation === 'perfectBlock') {
            audio.block(event.mitigation === 'perfectBlock');
          } else if (event.mitigation !== 'dodge') {
            audio.hitImpact(event.crit);
          }
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
  }

  private killMonster(m: WorldMonster): void {
    m.state = 'dead';
    m.model.visible = false;
    m.labelEl.hidden = true;
    m.respawnAt = this.clock + RESPAWN_DELAY;
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

  private refreshCombo(): void {
    if (!this.engine) return;
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

/** Picks well-spaced grass tiles for monster spawn points, clear of the player's starting area. */
function pickSpawnPoints(
  tiles: TileType[][],
  startTile: { x: number; y: number },
  count: number,
): Array<{ x: number; y: number }> {
  const candidates: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < tiles.length; y++) {
    for (let x = 0; x < tiles[0].length; x++) {
      if (tiles[y][x] !== TileType.Grass) continue;
      if (Math.hypot(x - startTile.x, y - startTile.y) < MIN_SPAWN_DIST_FROM_START) continue;
      candidates.push({ x, y });
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const picked: Array<{ x: number; y: number }> = [];
  for (const c of candidates) {
    if (picked.length >= count) break;
    if (picked.every((p) => Math.hypot(p.x - c.x, p.y - c.y) >= MIN_SPAWN_SPACING)) picked.push(c);
  }
  return picked;
}
