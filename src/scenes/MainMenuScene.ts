import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/gameConfig';
import { hasSave, loadGame } from '../systems/SaveSystem';

function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  onClick: () => void,
): Phaser.GameObjects.Text {
  const btn = scene.add
    .text(x, y, text, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#f2ede1',
      backgroundColor: '#3a2e4a',
      padding: { x: 18, y: 8 },
    })
    .setOrigin(0.5)
    .setInteractive({ useHandCursor: true });

  btn.on('pointerover', () => btn.setStyle({ color: '#f2c14e' }));
  btn.on('pointerout', () => btn.setStyle({ color: '#f2ede1' }));
  btn.on('pointerdown', onClick);
  return btn;
}

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super('MainMenu');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1a1423');

    this.add
      .text(GAME_WIDTH / 2, 60, 'RPG CLASSIC', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#f2c14e',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    this.add
      .text(GAME_WIDTH / 2, 92, 'uma aventura em construção', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#a99bb5',
      })
      .setOrigin(0.5);

    let y = 150;
    if (hasSave()) {
      makeButton(this, GAME_WIDTH / 2, y, 'Continuar', () => {
        const player = loadGame();
        if (player) {
          this.scene.start('Overworld', { player });
        }
      });
      y += 42;
    }

    makeButton(this, GAME_WIDTH / 2, y, 'Novo Jogo', () => {
      this.scene.start('CharacterSelect');
    });

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT - 16, 'Setas/WASD para mover · Toque na tela em dispositivos móveis', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#6b5f78',
      })
      .setOrigin(0.5);
  }
}
