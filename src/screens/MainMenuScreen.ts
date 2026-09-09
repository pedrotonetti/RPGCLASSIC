import * as THREE from 'three';
import { CLASS_DEFINITIONS } from '../config/classes';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { buildClassPreview } from '../render/characterModel';
import { clearSave, hasSave, loadGame } from '../systems/SaveSystem';
import { el } from '../ui/dom';
import { CharacterSelectScreen } from './CharacterSelectScreen';
import { OverworldScreen } from './OverworldScreen';

export class MainMenuScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private showcase!: THREE.Group;
  private time = 0;

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

    this.camera.position.set(0, 1.15, 4.4);
    this.camera.lookAt(0, 0.85, 0);

    const def = CLASS_DEFINITIONS[0];
    this.showcase = buildClassPreview(def.id);
    this.scene.add(this.showcase);

    this.buildUi();
  }

  unmount(): void {}

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    this.showcase.rotation.y = this.time * 0.6;
  }

  private buildUi(): void {
    const buttons: HTMLElement[] = [];

    if (hasSave()) {
      buttons.push(
        el('div', {
          className: 'btn primary',
          text: 'Continuar',
          onClick: () => {
            const player = loadGame();
            if (player) {
              this.game.goTo(new OverworldScreen(this.game, player));
            } else {
              // Corrupted/unreadable save: don't leave the button silently
              // doing nothing — clear it and let the player start fresh.
              clearSave();
              alert('Não foi possível carregar o jogo salvo (dados corrompidos). Iniciando um novo jogo.');
              this.game.goTo(new CharacterSelectScreen(this.game));
            }
          },
        }),
      );
    }

    buttons.push(
      el('div', {
        className: 'btn',
        text: 'Novo Jogo',
        onClick: () => this.game.goTo(new CharacterSelectScreen(this.game)),
      }),
    );

    const menu = el(
      'div',
      { className: 'main-menu screen' },
      [
        el('div', { className: 'top-bar' }, [
          el('h1', { className: 'pixel-title', text: 'RPG CLASSIC' }),
          el('div', { className: 'subtitle', text: 'agora em 3D — uma aventura em construção' }),
        ]),
        el('div', { className: 'bottom-bar' }, [
          el('div', { className: 'stack center' }, buttons),
          el('div', { className: 'hint', text: 'Setas/WASD para mover · Toque na tela em dispositivos móveis' }),
        ]),
      ],
    );
    this.game.uiRoot.append(menu);
  }
}
