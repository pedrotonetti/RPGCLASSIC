import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/gameConfig';
import { generateAllTextures } from '../utils/textures';

export class PreloadScene extends Phaser.Scene {
  constructor() {
    super('Preload');
  }

  create(): void {
    const label = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Carregando...', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#f2ede1',
      })
      .setOrigin(0.5);

    generateAllTextures(this);

    label.destroy();
    this.scene.start('MainMenu');
  }
}
