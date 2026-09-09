import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './config/gameConfig';
import { BattleScene } from './scenes/BattleScene';
import { BootScene } from './scenes/BootScene';
import { CharacterSelectScene } from './scenes/CharacterSelectScene';
import { MainMenuScene } from './scenes/MainMenuScene';
import { OverworldScene } from './scenes/OverworldScene';
import { PreloadScene } from './scenes/PreloadScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  pixelArt: true,
  backgroundColor: '#1a1423',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, PreloadScene, MainMenuScene, CharacterSelectScene, OverworldScene, BattleScene],
};

new Phaser.Game(config);
