import Phaser from 'phaser';
import { CLASS_DEFINITIONS } from '../config/classes';
import { GAME_HEIGHT, GAME_WIDTH } from '../config/gameConfig';
import type { CharacterClassDefinition } from '../config/types';
import { Player } from '../entities/Player';

const CARD_WIDTH = 96;
const CARD_HEIGHT = 90;
const CARD_GAP = 12;
const CARD_Y = 74;

export class CharacterSelectScene extends Phaser.Scene {
  private selectedIndex = 0;
  private cardBorders: Phaser.GameObjects.Rectangle[] = [];
  private detailsContainer!: Phaser.GameObjects.Container;

  constructor() {
    super('CharacterSelect');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1a1423');
    this.selectedIndex = 0;
    this.cardBorders = [];

    this.add
      .text(GAME_WIDTH / 2, 12, 'Escolha sua Classe', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#f2c14e',
      })
      .setOrigin(0.5, 0);

    const totalWidth = CLASS_DEFINITIONS.length * CARD_WIDTH + (CLASS_DEFINITIONS.length - 1) * CARD_GAP;
    const startX = GAME_WIDTH / 2 - totalWidth / 2 + CARD_WIDTH / 2;

    CLASS_DEFINITIONS.forEach((def, i) => {
      const x = startX + i * (CARD_WIDTH + CARD_GAP);

      const border = this.add
        .rectangle(x, CARD_Y, CARD_WIDTH, CARD_HEIGHT)
        .setStrokeStyle(2, 0x6b5f78)
        .setFillStyle(0x2a2038, 1)
        .setInteractive({ useHandCursor: true });
      this.cardBorders.push(border);

      this.add.image(x, CARD_Y - 18, `player_battle_${def.id}`).setScale(0.6);
      this.add
        .text(x, CARD_Y + 26, def.name, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#f2ede1',
        })
        .setOrigin(0.5);

      border.on('pointerdown', () => this.select(i));
      border.on('pointerover', () => this.select(i));
    });

    this.detailsContainer = this.add.container(0, 0);

    const backBtn = this.add
      .text(50, GAME_HEIGHT - 12, '< Voltar', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#a99bb5',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.scene.start('MainMenu'));

    const confirmBtn = this.add
      .text(GAME_WIDTH - 90, GAME_HEIGHT - 12, 'Começar Aventura >', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#f2c14e',
        backgroundColor: '#3a2e4a',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    confirmBtn.on('pointerdown', () => this.confirmSelection());

    this.input.keyboard?.on('keydown-LEFT', () => this.select((this.selectedIndex - 1 + CLASS_DEFINITIONS.length) % CLASS_DEFINITIONS.length));
    this.input.keyboard?.on('keydown-RIGHT', () => this.select((this.selectedIndex + 1) % CLASS_DEFINITIONS.length));
    this.input.keyboard?.on('keydown-ENTER', () => this.confirmSelection());

    this.select(0);
  }

  private select(index: number): void {
    this.selectedIndex = index;
    this.cardBorders.forEach((border, i) => {
      border.setStrokeStyle(2, i === index ? 0xf2c14e : 0x6b5f78);
    });
    this.renderDetails(CLASS_DEFINITIONS[index]);
  }

  private renderDetails(def: CharacterClassDefinition): void {
    this.detailsContainer.removeAll(true);
    const y = CARD_Y + CARD_HEIGHT / 2 + 12;

    const desc = this.add
      .text(GAME_WIDTH / 2, y, def.description, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#c9bfd4',
        wordWrap: { width: GAME_WIDTH - 60 },
        align: 'center',
      })
      .setOrigin(0.5, 0);

    const s = def.baseStats;
    const statLines = [
      `HP ${s.maxHp}  MP ${s.maxMp}  ATQ ${s.attack}  MAG ${s.magicAttack}`,
      `DEF ${s.defense}  RES ${s.magicDefense}  VEL ${s.speed}  SOR ${s.luck}`,
    ];
    const stats = this.add
      .text(GAME_WIDTH / 2, y + 24, statLines.join('\n'), {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#f2ede1',
        align: 'center',
        lineSpacing: 4,
      })
      .setOrigin(0.5, 0);

    const skillNames = def.skills.map((sk) => sk.name).join(', ');
    const skills = this.add
      .text(GAME_WIDTH / 2, y + 56, `Habilidades: ${skillNames}`, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#8ec9e0',
        align: 'center',
        wordWrap: { width: GAME_WIDTH - 60 },
      })
      .setOrigin(0.5, 0);

    this.detailsContainer.add([desc, stats, skills]);
  }

  private confirmSelection(): void {
    const def = CLASS_DEFINITIONS[this.selectedIndex];
    const typed = window.prompt('Como se chama seu herói?', 'Herói');
    const name = typed && typed.trim().length > 0 ? typed.trim().slice(0, 16) : 'Herói';
    const player = Player.createNew(name, def.id);
    this.scene.start('Overworld', { player });
  }
}
