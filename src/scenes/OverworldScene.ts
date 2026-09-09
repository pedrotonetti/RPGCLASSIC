import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from '../config/gameConfig';
import { isWalkable, TileType, triggersEncounter } from '../config/tiles';
import { Player } from '../entities/Player';
import { ENCOUNTER_CHANCE_PER_STEP, pickEncounterEnemyIds } from '../systems/EncounterSystem';
import { generateOverworldMap, MAP_HEIGHT, MAP_WIDTH } from '../systems/MapGenerator';
import { saveGame } from '../systems/SaveSystem';

type Dir = 'up' | 'down' | 'left' | 'right';
const DIR_VECTORS: Record<Dir, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

const MOVE_DURATION_MS = 140;

export class OverworldScene extends Phaser.Scene {
  private player!: Player;
  private tiles: TileType[][] = [];
  private sprite!: Phaser.GameObjects.Image;
  private isMoving = false;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'W' | 'A' | 'S' | 'D', Phaser.Input.Keyboard.Key>;
  private touchDir: Dir | null = null;
  private hudHp!: Phaser.GameObjects.Text;
  private hudMp!: Phaser.GameObjects.Text;
  private hudGold!: Phaser.GameObjects.Text;

  constructor() {
    super('Overworld');
  }

  create(data: { player: Player }): void {
    this.player = data.player;
    this.isMoving = false;
    this.cameras.main.setBackgroundColor('#0d0a12');

    const { tiles } = generateOverworldMap();
    this.tiles = tiles;

    const map = this.make.tilemap({ data: tiles, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = map.addTilesetImage('tiles', 'tiles', TILE_SIZE, TILE_SIZE, 0, 0)!;
    const layer = map.createLayer(0, tileset, 0, 0)!;
    layer.setDepth(0);

    this.sprite = this.add.image(
      this.player.mapX * TILE_SIZE + TILE_SIZE / 2,
      this.player.mapY * TILE_SIZE + TILE_SIZE / 2,
      `player_overworld_${this.player.classId}`,
    );
    this.sprite.setDepth(10);

    this.cameras.main.setBounds(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);
    this.cameras.main.startFollow(this.sprite, true, 0.15, 0.15);
    // Note: intentionally left at zoom 1 — camera zoom warps scrollFactor(0)
    // HUD/touch-control elements away from their fixed screen position in Phaser.

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      W: this.input.keyboard!.addKey('W'),
      A: this.input.keyboard!.addKey('A'),
      S: this.input.keyboard!.addKey('S'),
      D: this.input.keyboard!.addKey('D'),
    };

    this.input.keyboard!.on('keydown-ESC', () => {
      saveGame(this.player);
      this.scene.start('MainMenu');
    });

    this.buildHud();
    this.buildTouchControls();

    saveGame(this.player);
  }

  private buildHud(): void {
    const panel = this.add.rectangle(4, 4, 150, 56, 0x1a1423, 0.75).setOrigin(0, 0).setScrollFactor(0).setDepth(20);
    panel.setStrokeStyle(1, 0x6b5f78);

    this.add
      .text(10, 8, `${this.player.name} — ${this.player.classDef.name} Nv.${this.player.level}`, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#f2c14e',
      })
      .setScrollFactor(0)
      .setDepth(21);

    this.hudHp = this.add
      .text(10, 22, '', { fontFamily: 'monospace', fontSize: '10px', color: '#e06b6b' })
      .setScrollFactor(0)
      .setDepth(21);
    this.hudMp = this.add
      .text(10, 34, '', { fontFamily: 'monospace', fontSize: '10px', color: '#6ba7e0' })
      .setScrollFactor(0)
      .setDepth(21);
    this.hudGold = this.add
      .text(10, 46, '', { fontFamily: 'monospace', fontSize: '10px', color: '#f2ede1' })
      .setScrollFactor(0)
      .setDepth(21);

    this.refreshHud();

    this.add
      .text(GAME_WIDTH - 6, 6, 'ESC: salvar e sair', {
        fontFamily: 'monospace',
        fontSize: '8px',
        color: '#6b5f78',
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(20);
  }

  private refreshHud(): void {
    this.hudHp.setText(`HP ${this.player.currentHp}/${this.player.stats.maxHp}`);
    this.hudMp.setText(`MP ${this.player.currentMp}/${this.player.stats.maxMp}`);
    this.hudGold.setText(`Ouro: ${this.player.gold}`);
  }

  private buildTouchControls(): void {
    const cx = 34;
    const cy = GAME_HEIGHT - 34;
    const size = 22;
    const gap = 24;
    const specs: Array<{ dir: Dir; x: number; y: number; label: string }> = [
      { dir: 'up', x: cx, y: cy - gap, label: '▲' },
      { dir: 'down', x: cx, y: cy + gap, label: '▼' },
      { dir: 'left', x: cx - gap, y: cy, label: '◀' },
      { dir: 'right', x: cx + gap, y: cy, label: '▶' },
    ];

    for (const spec of specs) {
      const btn = this.add
        .rectangle(spec.x, spec.y, size, size, 0x2a2038, 0.55)
        .setScrollFactor(0)
        .setDepth(20)
        .setStrokeStyle(1, 0x6b5f78)
        .setInteractive();
      this.add
        .text(spec.x, spec.y, spec.label, { fontFamily: 'monospace', fontSize: '12px', color: '#f2ede1' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(21);

      btn.on('pointerdown', () => (this.touchDir = spec.dir));
      btn.on('pointerup', () => {
        if (this.touchDir === spec.dir) this.touchDir = null;
      });
      btn.on('pointerout', () => {
        if (this.touchDir === spec.dir) this.touchDir = null;
      });
    }
  }

  private heldDirection(): Dir | null {
    if (this.cursors.up.isDown || this.wasd.W.isDown) return 'up';
    if (this.cursors.down.isDown || this.wasd.S.isDown) return 'down';
    if (this.cursors.left.isDown || this.wasd.A.isDown) return 'left';
    if (this.cursors.right.isDown || this.wasd.D.isDown) return 'right';
    return this.touchDir;
  }

  update(): void {
    if (this.isMoving) return;
    const dir = this.heldDirection();
    if (!dir) return;
    this.tryMove(dir);
  }

  private tryMove(dir: Dir): void {
    const { dx, dy } = DIR_VECTORS[dir];
    const nx = this.player.mapX + dx;
    const ny = this.player.mapY + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_WIDTH || ny >= MAP_HEIGHT) return;

    const destTile = this.tiles[ny][nx];
    if (!isWalkable(destTile)) return;

    this.isMoving = true;
    this.sprite.setFlipX(dx < 0 ? true : dx > 0 ? false : this.sprite.flipX);
    this.player.mapX = nx;
    this.player.mapY = ny;

    this.tweens.add({
      targets: this.sprite,
      x: nx * TILE_SIZE + TILE_SIZE / 2,
      y: ny * TILE_SIZE + TILE_SIZE / 2,
      duration: MOVE_DURATION_MS,
      onComplete: () => {
        this.isMoving = false;
        if (triggersEncounter(destTile) && Math.random() < ENCOUNTER_CHANCE_PER_STEP) {
          this.startEncounter();
        }
      },
    });
  }

  private startEncounter(): void {
    saveGame(this.player);
    const enemyIds = pickEncounterEnemyIds(this.player.level);
    this.scene.start('Battle', { player: this.player, enemyIds });
  }
}
