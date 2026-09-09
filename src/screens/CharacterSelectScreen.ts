import * as THREE from 'three';
import { CLASS_DEFINITIONS } from '../config/classes';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import type { CharacterClassDefinition } from '../config/types';
import { Player } from '../entities/Player';
import { buildClassModel } from '../render/characterModel';
import { el } from '../ui/dom';
import { MainMenuScreen } from './MainMenuScreen';
import { OverworldScreen } from './OverworldScreen';

export class CharacterSelectScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private selectedIndex = 0;
  private showcase: THREE.Group | null = null;
  private time = 0;

  private cardEls: HTMLElement[] = [];
  private detailsEl!: HTMLElement;
  private nameInput!: HTMLInputElement;

  constructor(private game: Game) {
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50);
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x1a1423);
    this.scene.fog = new THREE.Fog(0x1a1423, 6, 14);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.05, 0.25, 24),
      new THREE.MeshStandardMaterial({ color: 0x3a2f4d, roughness: 0.8 }),
    );
    pedestal.position.y = -0.02;
    pedestal.receiveShadow = true;
    this.scene.add(pedestal);

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    const key = new THREE.DirectionalLight(0xf2ede1, 1.1);
    key.position.set(2.5, 4, 3);
    key.castShadow = true;
    const rim = new THREE.DirectionalLight(0xf2c14e, 0.5);
    rim.position.set(-3, 2, -3);
    this.scene.add(ambient, key, rim);

    this.camera.position.set(0, 0.85, 6.2);
    this.camera.lookAt(0, 0.55, 0);

    this.buildUi();
    this.select(0);
  }

  unmount(): void {}

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    if (this.showcase) this.showcase.rotation.y = this.time * 0.6;
  }

  private buildUi(): void {
    const cards = el(
      'div',
      { className: 'class-cards' },
      CLASS_DEFINITIONS.map((def, i) => {
        const card = el(
          'div',
          { className: 'class-card', onClick: () => this.select(i) },
          [
            el('div', {
              className: 'preview',
              style: { display: 'flex', alignItems: 'center', justifyContent: 'center' },
            }, [
              el('div', {
                style: {
                  width: '46px',
                  height: '46px',
                  borderRadius: '50%',
                  background: `#${def.color.toString(16).padStart(6, '0')}`,
                  border: '2px solid rgba(255,255,255,0.35)',
                },
              }),
            ]),
            el('div', { className: 'name', text: def.name }),
          ],
        );
        this.cardEls.push(card);
        return card;
      }),
    );

    this.detailsEl = el('div', { className: 'char-details panel' });

    this.nameInput = el('input', {
      className: 'btn',
      attrs: { type: 'text', value: 'Herói', maxlength: '16', placeholder: 'Nome do herói' },
      style: { textAlign: 'center', width: '220px' },
    });

    const backBtn = el('div', { className: 'btn', text: '< Voltar', onClick: () => this.game.goTo(new MainMenuScreen(this.game)) });
    const confirmBtn = el('div', { className: 'btn primary', text: 'Começar Aventura >', onClick: () => this.confirm() });

    const screen = el(
      'div',
      { className: 'char-select screen' },
      [
        el('div', { className: 'top-bar' }, [el('h1', { text: 'Escolha sua Classe' }), cards]),
        el('div', { className: 'bottom-bar' }, [
          this.detailsEl,
          this.nameInput,
          el('div', { className: 'row nav-row' }, [backBtn, confirmBtn]),
        ]),
      ],
    );
    this.game.uiRoot.append(screen);
  }

  private select(index: number): void {
    this.selectedIndex = index;
    this.cardEls.forEach((card, i) => card.classList.toggle('selected', i === index));

    const def = CLASS_DEFINITIONS[index];
    this.renderDetails(def);

    if (this.showcase) {
      this.scene.remove(this.showcase);
      disposeGroup(this.showcase);
    }
    this.showcase = buildClassModel(def.id, def.color);
    this.scene.add(this.showcase);
  }

  private renderDetails(def: CharacterClassDefinition): void {
    const s = def.baseStats;
    const statLines = [
      `HP ${s.maxHp}  MP ${s.maxMp}  ATQ ${s.attack}  MAG ${s.magicAttack}`,
      `DEF ${s.defense}  RES ${s.magicDefense}  VEL ${s.speed}  SOR ${s.luck}`,
    ].join('\n');
    const skillNames = def.skills.map((sk) => sk.name).join(', ');

    this.detailsEl.replaceChildren(
      el('div', { className: 'desc', text: def.description }),
      el('div', { className: 'stats', text: statLines }),
      el('div', { className: 'skills', text: `Habilidades: ${skillNames}` }),
    );
  }

  private confirm(): void {
    const def = CLASS_DEFINITIONS[this.selectedIndex];
    const typed = this.nameInput.value.trim();
    const name = typed.length > 0 ? typed.slice(0, 16) : 'Herói';
    const player = Player.createNew(name, def.id);
    this.game.goTo(new OverworldScreen(this.game, player));
  }
}

function disposeGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) m.dispose();
    }
  });
}
