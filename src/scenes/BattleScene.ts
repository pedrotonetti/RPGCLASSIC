import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/gameConfig';
import type { Skill } from '../config/types';
import { getItemById } from '../data/items';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { BattleEngine, type LogEntry, type PlayerAction, type RoundResult } from '../systems/CombatSystem';
import { generateOverworldMap } from '../systems/MapGenerator';
import { saveGame } from '../systems/SaveSystem';

interface MenuEntry {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

const ENTRY_DELAY_MS = 750;
const ENEMY_Y = 92;
const PLAYER_POS = { x: 70, y: 196 };
const BAR_WIDTH = 50;

export class BattleScene extends Phaser.Scene {
  private player!: Player;
  private enemies: Enemy[] = [];
  private engine!: BattleEngine;
  private enemyDisplayNames: string[] = [];

  private enemySprites: Phaser.GameObjects.Image[] = [];
  private enemyBarBg: Phaser.GameObjects.Rectangle[] = [];
  private enemyBarFg: Phaser.GameObjects.Rectangle[] = [];
  private enemyNameTexts: Phaser.GameObjects.Text[] = [];
  private playerSprite!: Phaser.GameObjects.Image;
  private playerStatusText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;

  private menuItems: Phaser.GameObjects.Text[] = [];
  private currentMenu: MenuEntry[] = [];
  private menuCursor = 0;
  private pendingTargetPick: ((index: number) => void) | null = null;
  private busy = false;

  private displayedPlayerHp = 0;
  private displayedEnemyHp: number[] = [];

  constructor() {
    super('Battle');
  }

  create(data: { player: Player; enemyIds: string[] }): void {
    this.player = data.player;
    this.enemies = data.enemyIds.map((id) => new Enemy(id));
    this.engine = new BattleEngine(this.player, this.enemies);
    this.enemyDisplayNames = this.computeDisplayNames(data.enemyIds);

    this.enemySprites = [];
    this.enemyBarBg = [];
    this.enemyBarFg = [];
    this.enemyNameTexts = [];
    this.menuItems = [];
    this.currentMenu = [];
    this.menuCursor = 0;
    this.pendingTargetPick = null;
    this.busy = false;

    this.displayedPlayerHp = this.player.currentHp;
    this.displayedEnemyHp = this.enemies.map((e) => e.currentHp);

    this.buildBackground();
    this.buildEnemies();
    this.buildPlayer();
    this.buildBottomPanel();
    this.buildKeyboardNav();

    this.showMainMenu();
  }

  private computeDisplayNames(enemyIds: string[]): string[] {
    const counts: Record<string, number> = {};
    return enemyIds.map((id) => {
      const total = enemyIds.filter((other) => other === id).length;
      if (total <= 1) return new Enemy(id).name;
      counts[id] = (counts[id] ?? 0) + 1;
      const letter = String.fromCharCode(64 + counts[id]); // A, B, C...
      return `${new Enemy(id).name} ${letter}`;
    });
  }

  private buildBackground(): void {
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x241933).setOrigin(0, 0).setDepth(0);
    this.add.rectangle(0, 150, GAME_WIDTH, 120, 0x2f2440).setOrigin(0, 0).setDepth(0);
  }

  private buildEnemies(): void {
    const n = this.enemies.length;
    const spacing = 110;
    const centerX = GAME_WIDTH / 2;

    this.enemies.forEach((enemy, i) => {
      const x = centerX + (i - (n - 1) / 2) * spacing;
      const y = ENEMY_Y;

      const sprite = this.add.image(x, y, `enemy_${enemy.definitionId}`).setDepth(5).setInteractive({ useHandCursor: true });
      sprite.on('pointerdown', () => this.onEnemySpriteClicked(i));
      this.enemySprites.push(sprite);

      const nameText = this.add
        .text(x, y - 46, this.enemyDisplayNames[i], {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#f2ede1',
        })
        .setOrigin(0.5)
        .setDepth(6);
      this.enemyNameTexts.push(nameText);

      const barBg = this.add.rectangle(x - BAR_WIDTH / 2, y - 36, BAR_WIDTH, 6, 0x1a1423).setOrigin(0, 0).setDepth(6);
      const barFg = this.add.rectangle(x - BAR_WIDTH / 2, y - 36, BAR_WIDTH, 6, 0xe06b6b).setOrigin(0, 0).setDepth(7);
      this.enemyBarBg.push(barBg);
      this.enemyBarFg.push(barFg);
    });

    this.refreshEnemyBars();
  }

  private buildPlayer(): void {
    this.playerSprite = this.add.image(PLAYER_POS.x, PLAYER_POS.y, `player_battle_${this.player.classId}`).setDepth(5);
    this.playerStatusText = this.add
      .text(6, 6, '', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#f2ede1',
        backgroundColor: '#1a1423',
        padding: { x: 6, y: 4 },
      })
      .setDepth(20);
    this.refreshPlayerStatus();
  }

  private buildBottomPanel(): void {
    this.add.rectangle(0, GAME_HEIGHT - 70, GAME_WIDTH, 70, 0x1a1423, 0.9).setOrigin(0, 0).setDepth(10).setStrokeStyle(1, 0x6b5f78);
    this.messageText = this.add
      .text(16, GAME_HEIGHT - 62, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#f2ede1',
        wordWrap: { width: GAME_WIDTH - 32 },
      })
      .setDepth(11);
  }

  private buildKeyboardNav(): void {
    this.input.keyboard?.on('keydown-UP', () => this.moveCursor(-1));
    this.input.keyboard?.on('keydown-DOWN', () => this.moveCursor(1));
    this.input.keyboard?.on('keydown-ENTER', () => this.confirmCursor());
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.pendingTargetPick) {
        this.pendingTargetPick = null;
        this.showMainMenu();
      }
    });
  }

  /** Clears the visible menu and waits for the player to pick an enemy target. */
  private enterTargetSelection(message: string, onPick: (index: number) => void): void {
    this.menuItems.forEach((t) => t.destroy());
    this.menuItems = [];
    this.currentMenu = [];
    this.showMessage(message);
    this.pendingTargetPick = onPick;
  }

  private moveCursor(delta: number): void {
    if (this.busy || this.currentMenu.length === 0) return;
    const len = this.currentMenu.length;
    this.menuCursor = (this.menuCursor + delta + len) % len;
    this.updateMenuHighlight();
  }

  private confirmCursor(): void {
    if (this.busy || this.currentMenu.length === 0) return;
    const entry = this.currentMenu[this.menuCursor];
    if (!entry.disabled) entry.onSelect();
  }

  private onEnemySpriteClicked(index: number): void {
    if (!this.pendingTargetPick) return;
    if (!this.enemies[index].isAlive()) return;
    const cb = this.pendingTargetPick;
    this.pendingTargetPick = null;
    cb(index);
  }

  // --- Menu rendering -------------------------------------------------

  private renderMenu(entries: MenuEntry[]): void {
    this.currentMenu = entries;
    this.menuCursor = 0;
    this.menuItems.forEach((t) => t.destroy());
    this.menuItems = [];

    entries.forEach((entry, i) => {
      const t = this.add
        .text(24, GAME_HEIGHT - 64 + i * 15, entry.label, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#f2ede1',
        })
        .setDepth(12)
        .setInteractive({ useHandCursor: !entry.disabled });
      t.on('pointerover', () => {
        this.menuCursor = i;
        this.updateMenuHighlight();
      });
      t.on('pointerdown', () => {
        if (!entry.disabled) entry.onSelect();
      });
      this.menuItems.push(t);
    });

    this.messageText.setVisible(false);
    this.updateMenuHighlight();
  }

  private updateMenuHighlight(): void {
    this.currentMenu.forEach((entry, i) => {
      const t = this.menuItems[i];
      if (!t) return;
      t.setVisible(true);
      if (entry.disabled) {
        t.setColor('#5a5164');
        t.setText(`  ${entry.label}`);
      } else if (i === this.menuCursor) {
        t.setColor('#f2c14e');
        t.setText(`▶ ${entry.label}`);
      } else {
        t.setColor('#f2ede1');
        t.setText(`  ${entry.label}`);
      }
    });
  }

  private showMessage(text: string): void {
    this.menuItems.forEach((t) => t.setVisible(false));
    this.messageText.setVisible(true).setText(text);
  }

  // --- Top-level menus --------------------------------------------------

  private showMainMenu(): void {
    this.busy = false;
    this.pendingTargetPick = null;
    this.renderMenu([
      { label: 'Atacar', onSelect: () => this.chooseAttack() },
      { label: 'Habilidade', onSelect: () => this.showSkillMenu() },
      { label: 'Item', onSelect: () => this.showItemMenu() },
      { label: 'Fugir', onSelect: () => this.performAction({ type: 'run' }) },
    ]);
  }

  private aliveEnemyIndexes(): number[] {
    return this.enemies.map((_, i) => i).filter((i) => this.enemies[i].isAlive());
  }

  private chooseAttack(): void {
    const alive = this.aliveEnemyIndexes();
    if (alive.length === 1) {
      this.performAction({ type: 'attack', targetIndex: alive[0] });
      return;
    }
    this.enterTargetSelection('Escolha o alvo do ataque (toque em um inimigo)...', (index) =>
      this.performAction({ type: 'attack', targetIndex: index }),
    );
  }

  private showSkillMenu(): void {
    const skills = this.player.availableSkills;
    const entries: MenuEntry[] = skills.map((s) => ({
      label: `${s.name} (MP ${s.mpCost})`,
      disabled: this.player.currentMp < s.mpCost,
      onSelect: () => this.chooseSkill(s),
    }));
    entries.push({ label: 'Voltar', onSelect: () => this.showMainMenu() });
    this.renderMenu(entries);
  }

  private chooseSkill(skill: Skill): void {
    if (skill.target === 'self') {
      this.performAction({ type: 'skill', skillId: skill.id });
      return;
    }
    if (skill.target === 'allEnemies') {
      this.performAction({ type: 'skill', skillId: skill.id });
      return;
    }
    const alive = this.aliveEnemyIndexes();
    if (alive.length === 1) {
      this.performAction({ type: 'skill', skillId: skill.id, targetIndex: alive[0] });
      return;
    }
    this.enterTargetSelection(`Escolha o alvo de ${skill.name} (toque em um inimigo)...`, (index) =>
      this.performAction({ type: 'skill', skillId: skill.id, targetIndex: index }),
    );
  }

  private showItemMenu(): void {
    const entries: MenuEntry[] = Object.entries(this.player.inventory)
      .filter(([, qty]) => qty > 0)
      .map(([itemId, qty]) => {
        const item = getItemById(itemId);
        return { label: `${item.name} x${qty}`, onSelect: () => this.performAction({ type: 'item', itemId }) };
      });
    if (entries.length === 0) {
      entries.push({ label: '(sem itens)', disabled: true, onSelect: () => {} });
    }
    entries.push({ label: 'Voltar', onSelect: () => this.showMainMenu() });
    this.renderMenu(entries);
  }

  // --- Action resolution --------------------------------------------------

  private performAction(action: PlayerAction): void {
    this.busy = true;
    this.pendingTargetPick = null;
    this.menuItems.forEach((t) => t.destroy());
    this.menuItems = [];
    this.currentMenu = [];
    this.showMessage('...');

    const result = this.engine.resolveRound(action);
    this.playEntries(result.entries, 0, () => this.onRoundResolved(result));
  }

  private playEntries(entries: LogEntry[], index: number, onDone: () => void): void {
    if (index >= entries.length) {
      onDone();
      return;
    }
    const entry = entries[index];
    this.showMessage(entry.text);

    if (entry.targetIndex !== undefined) {
      if (entry.targetHpAfter !== undefined) this.displayedEnemyHp[entry.targetIndex] = entry.targetHpAfter;
      this.refreshEnemyBars();
      this.flashSprite(this.enemySprites[entry.targetIndex]);
      this.popupForEntry(entry, this.enemySprites[entry.targetIndex]);
    } else if (entry.targetName === this.player.name) {
      if (entry.targetHpAfter !== undefined) this.displayedPlayerHp = entry.targetHpAfter;
      this.refreshPlayerStatus();
      this.flashSprite(this.playerSprite);
      this.popupForEntry(entry, this.playerSprite);
    }

    this.time.delayedCall(ENTRY_DELAY_MS, () => this.playEntries(entries, index + 1, onDone));
  }

  private popupForEntry(entry: LogEntry, sprite: Phaser.GameObjects.Image): void {
    if (entry.missed) {
      this.popNumber(sprite, 'Errou!', '#cccccc');
    } else if (entry.damage) {
      this.popNumber(sprite, `-${entry.damage}`, entry.crit ? '#ffcf4e' : '#ffffff');
    } else if (entry.healed) {
      this.popNumber(sprite, `+${entry.healed}`, '#6bff8e');
    }
  }

  private onRoundResolved(result: RoundResult): void {
    saveGame(this.player);

    if (result.outcome === 'ongoing') {
      this.showMainMenu();
      return;
    }

    if (result.outcome === 'victory' || result.outcome === 'fled') {
      this.time.delayedCall(1200, () => this.scene.start('Overworld', { player: this.player }));
      return;
    }

    // defeat: respawn at the village, half HP, half gold as a penalty.
    const { playerStart } = generateOverworldMap();
    this.player.mapX = playerStart.x;
    this.player.mapY = playerStart.y;
    this.player.currentHp = Math.max(1, Math.floor(this.player.stats.maxHp * 0.5));
    this.player.currentMp = this.player.stats.maxMp;
    this.player.gold = Math.floor(this.player.gold * 0.5);
    saveGame(this.player);
    this.showMessage('Você foi levado de volta à vila para se recuperar...');
    this.time.delayedCall(1800, () => this.scene.start('Overworld', { player: this.player }));
  }

  // --- Visuals --------------------------------------------------------

  private refreshPlayerStatus(): void {
    const stats = this.player.stats;
    this.playerStatusText.setText(
      `${this.player.name} Nv.${this.player.level}\nHP ${this.displayedPlayerHp}/${stats.maxHp}   MP ${this.player.currentMp}/${stats.maxMp}`,
    );
  }

  private refreshEnemyBars(): void {
    this.enemies.forEach((enemy, i) => {
      const hp = this.displayedEnemyHp[i] ?? enemy.currentHp;
      const ratio = Phaser.Math.Clamp(hp / enemy.stats.maxHp, 0, 1);
      this.enemyBarFg[i].width = BAR_WIDTH * ratio;
      const alive = hp > 0;
      this.enemySprites[i].setAlpha(alive ? 1 : 0.25);
      this.enemyNameTexts[i].setAlpha(alive ? 1 : 0.4);
      this.enemyBarBg[i].setAlpha(alive ? 1 : 0.4);
    });
  }

  private flashSprite(sprite: Phaser.GameObjects.Image): void {
    this.tweens.add({ targets: sprite, alpha: 0.25, duration: 80, yoyo: true, repeat: 1 });
  }

  private popNumber(sprite: Phaser.GameObjects.Image, text: string, color: string): void {
    const t = this.add
      .text(sprite.x, sprite.y - 30, text, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(30);
    this.tweens.add({
      targets: t,
      y: t.y - 24,
      alpha: 0,
      duration: 700,
      onComplete: () => t.destroy(),
    });
  }
}
