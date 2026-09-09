import Phaser from 'phaser';
import { CLASS_DEFINITIONS } from '../config/classes';
import { TILE_SIZE } from '../config/gameConfig';
import { TileType } from '../config/tiles';
import { ENEMY_DEFINITIONS } from '../data/enemies';

const SKIN = 0xe8b98c;
const OVERWORLD_SPRITE = TILE_SIZE;
const BATTLE_SPRITE = 64;

function drawTile(gfx: Phaser.GameObjects.Graphics, index: number, type: TileType): void {
  const ox = index * TILE_SIZE;
  switch (type) {
    case TileType.Grass:
      gfx.fillStyle(0x5b9c4a, 1);
      gfx.fillRect(ox, 0, TILE_SIZE, TILE_SIZE);
      gfx.fillStyle(0x4a8a3a, 1);
      gfx.fillRect(ox + 3, 4, 2, 2);
      gfx.fillRect(ox + 10, 9, 2, 2);
      gfx.fillRect(ox + 6, 12, 2, 2);
      break;
    case TileType.Path:
      gfx.fillStyle(0xc2a267, 1);
      gfx.fillRect(ox, 0, TILE_SIZE, TILE_SIZE);
      gfx.fillStyle(0xab8a52, 1);
      gfx.fillRect(ox + 2, 3, 3, 2);
      gfx.fillRect(ox + 9, 8, 3, 2);
      gfx.fillRect(ox + 4, 12, 2, 2);
      break;
    case TileType.Water:
      gfx.fillStyle(0x3a6ea5, 1);
      gfx.fillRect(ox, 0, TILE_SIZE, TILE_SIZE);
      gfx.fillStyle(0x5b8fc7, 1);
      gfx.fillRect(ox, 5, TILE_SIZE, 2);
      gfx.fillRect(ox, 11, TILE_SIZE, 1);
      break;
    case TileType.Tree:
      gfx.fillStyle(0x5b9c4a, 1);
      gfx.fillRect(ox, 0, TILE_SIZE, TILE_SIZE);
      gfx.fillStyle(0x6b4423, 1);
      gfx.fillRect(ox + 6, 10, 4, 6);
      gfx.fillStyle(0x2f6b2f, 1);
      gfx.fillCircle(ox + 8, 7, 7);
      gfx.fillStyle(0x1f4a1f, 1);
      gfx.fillCircle(ox + 5, 5, 2);
      break;
  }
}

function drawOverworldPlayer(gfx: Phaser.GameObjects.Graphics, color: number): void {
  gfx.fillStyle(0x000000, 0.25);
  gfx.fillEllipse(8, 14, 10, 4);
  gfx.fillStyle(color, 1);
  gfx.fillCircle(8, 9, 6);
  gfx.fillStyle(SKIN, 1);
  gfx.fillCircle(8, 5, 3.5);
  gfx.fillStyle(0x1a1423, 1);
  gfx.fillRect(6, 4, 1, 1);
  gfx.fillRect(9, 4, 1, 1);
}

function drawClassAccessory(gfx: Phaser.GameObjects.Graphics, classId: string, cx: number, cy: number): void {
  switch (classId) {
    case 'warrior':
      gfx.fillStyle(0xbfbfbf, 1);
      gfx.fillRect(cx + 16, cy - 22, 5, 30);
      gfx.fillStyle(0x8a8a8a, 1);
      gfx.fillRect(cx + 12, cy - 24, 13, 5);
      break;
    case 'mage':
      gfx.fillStyle(0x2b3f7a, 1);
      gfx.fillTriangle(cx - 12, cy - 20, cx + 12, cy - 20, cx, cy - 46);
      gfx.fillStyle(0xf2c14e, 1);
      gfx.fillCircle(cx, cy - 46, 3);
      break;
    case 'archer':
      gfx.lineStyle(3, 0x6b4423, 1);
      gfx.beginPath();
      gfx.arc(cx + 20, cy, 18, Phaser.Math.DegToRad(110), Phaser.Math.DegToRad(250));
      gfx.strokePath();
      gfx.lineStyle(1, 0xe8e8e8, 1);
      gfx.lineBetween(cx + 14, cy - 15, cx + 14, cy + 15);
      break;
    case 'cleric':
      gfx.fillStyle(0xf2ede1, 1);
      gfx.fillRect(cx - 2, cy - 10, 4, 14);
      gfx.fillRect(cx - 6, cy - 5, 12, 4);
      break;
  }
}

function drawBattleHumanoid(gfx: Phaser.GameObjects.Graphics, color: number, classId: string): void {
  const cx = BATTLE_SPRITE / 2;
  const cy = BATTLE_SPRITE / 2 + 6;
  gfx.fillStyle(0x000000, 0.25);
  gfx.fillEllipse(cx, BATTLE_SPRITE - 6, 26, 8);
  // Legs
  gfx.fillStyle(0x2a2a35, 1);
  gfx.fillRect(cx - 9, cy + 10, 7, 16);
  gfx.fillRect(cx + 2, cy + 10, 7, 16);
  // Body (robe/armor)
  gfx.fillStyle(color, 1);
  gfx.fillRoundedRect(cx - 14, cy - 14, 28, 30, 6);
  // Arms
  gfx.fillStyle(color, 1);
  gfx.fillRoundedRect(cx - 20, cy - 8, 7, 18, 3);
  gfx.fillRoundedRect(cx + 13, cy - 8, 7, 18, 3);
  // Head
  gfx.fillStyle(SKIN, 1);
  gfx.fillCircle(cx, cy - 20, 11);
  gfx.fillStyle(0x1a1423, 1);
  gfx.fillRect(cx - 5, cy - 22, 2, 2);
  gfx.fillRect(cx + 3, cy - 22, 2, 2);
  drawClassAccessory(gfx, classId, cx, cy);
}

function drawEnemySprite(gfx: Phaser.GameObjects.Graphics, enemyId: string, color: number): void {
  const cx = BATTLE_SPRITE / 2;
  const cy = BATTLE_SPRITE / 2 + 6;
  gfx.fillStyle(0x000000, 0.25);
  gfx.fillEllipse(cx, BATTLE_SPRITE - 8, 26, 8);

  switch (enemyId) {
    case 'slime':
      gfx.fillStyle(color, 1);
      gfx.fillEllipse(cx, cy + 6, 30, 22);
      gfx.fillStyle(0xffffff, 0.5);
      gfx.fillEllipse(cx - 6, cy - 2, 10, 6);
      gfx.fillStyle(0x1a1423, 1);
      gfx.fillCircle(cx - 6, cy + 6, 2);
      gfx.fillCircle(cx + 6, cy + 6, 2);
      break;
    case 'bat':
      gfx.fillStyle(color, 1);
      gfx.fillTriangle(cx - 24, cy, cx - 4, cy - 10, cx - 4, cy + 10);
      gfx.fillTriangle(cx + 24, cy, cx + 4, cy - 10, cx + 4, cy + 10);
      gfx.fillCircle(cx, cy, 12);
      gfx.fillStyle(0xff5555, 1);
      gfx.fillCircle(cx - 4, cy - 2, 2);
      gfx.fillCircle(cx + 4, cy - 2, 2);
      break;
    case 'goblin':
      gfx.fillStyle(color, 1);
      gfx.fillRoundedRect(cx - 13, cy - 6, 26, 26, 5);
      gfx.fillCircle(cx, cy - 14, 10);
      gfx.fillStyle(0xffe08a, 1);
      gfx.fillCircle(cx - 4, cy - 15, 2);
      gfx.fillCircle(cx + 4, cy - 15, 2);
      break;
    case 'dark_wolf':
      gfx.fillStyle(color, 1);
      gfx.fillEllipse(cx, cy + 4, 40, 20);
      gfx.fillCircle(cx + 18, cy - 4, 12);
      gfx.fillTriangle(cx + 10, cy - 14, cx + 16, cy - 24, cx + 20, cy - 13);
      gfx.fillTriangle(cx + 22, cy - 14, cx + 28, cy - 24, cx + 30, cy - 13);
      gfx.fillStyle(0xffe08a, 1);
      gfx.fillCircle(cx + 22, cy - 5, 2);
      break;
    default:
      gfx.fillStyle(color, 1);
      gfx.fillCircle(cx, cy, 18);
  }
}

let generated = false;

/** Generates every placeholder texture the game needs, once per page load. */
export function generateAllTextures(scene: Phaser.Scene): void {
  if (generated) return;
  generated = true;

  const gfx = scene.make.graphics({ x: 0, y: 0 }, false);

  const tileTypes = [TileType.Grass, TileType.Path, TileType.Water, TileType.Tree];
  tileTypes.forEach((type, i) => drawTile(gfx, i, type));
  gfx.generateTexture('tiles', TILE_SIZE * tileTypes.length, TILE_SIZE);
  gfx.clear();

  for (const def of CLASS_DEFINITIONS) {
    drawOverworldPlayer(gfx, def.color);
    gfx.generateTexture(`player_overworld_${def.id}`, OVERWORLD_SPRITE, OVERWORLD_SPRITE);
    gfx.clear();

    drawBattleHumanoid(gfx, def.color, def.id);
    gfx.generateTexture(`player_battle_${def.id}`, BATTLE_SPRITE, BATTLE_SPRITE);
    gfx.clear();
  }

  for (const def of ENEMY_DEFINITIONS) {
    drawEnemySprite(gfx, def.id, def.color);
    gfx.generateTexture(`enemy_${def.id}`, BATTLE_SPRITE, BATTLE_SPRITE);
    gfx.clear();
  }

  gfx.fillStyle(0xffffff, 1);
  gfx.fillRect(0, 0, 4, 4);
  gfx.generateTexture('pixel', 4, 4);
  gfx.clear();

  gfx.destroy();
}
