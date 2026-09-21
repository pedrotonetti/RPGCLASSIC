import * as THREE from 'three';
import { CLASS_DEFINITIONS, getClassById } from '../config/classes';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { buildClassPreview } from '../render/characterModel';
import { audio } from '../systems/AudioSystem';
import { deleteSlotSave, listSaveSlots, loadSlotSave, setActiveSlot, type SaveSlotEntry } from '../systems/SaveSystem';
import { el, goToLazy } from '../ui/dom';
import { IntroScreen } from './IntroScreen';

const MUSIC_PREF_KEY = 'rpgclassic:musicOn';

function musicPreferredOn(): boolean {
  return localStorage.getItem(MUSIC_PREF_KEY) !== 'off';
}

export class MainMenuScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private showcase!: THREE.Group;
  private motes!: THREE.Points;
  private moteVelocities: Float32Array = new Float32Array();
  private time = 0;
  private musicBtn!: HTMLElement;

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
    // Top surface at y=0 — was -0.02 (top at +0.105), which buried the
    // character's feet (at y≈0.045) inside the pedestal.
    pedestal.position.y = -0.125;
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

    this.buildMotes();
    this.buildUi();

    if (musicPreferredOn()) audio.startTheme();
  }

  unmount(): void {
    audio.stopTheme();
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    this.showcase.rotation.y = this.time * 0.6;

    // Slow drifting motes — a common "mysterious fantasy title screen"
    // touch (fireflies/dust catching the rim light). Each rises gently and
    // wraps back to the bottom once it drifts above the frame, so the
    // effect loops forever without ever resetting visibly.
    const positions = this.motes.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const vy = this.moteVelocities[i];
      let y = positions.getY(i) + vy * dt;
      if (y > 3.2) y = -0.5;
      positions.setY(i, y);
      const x = positions.getX(i) + Math.sin(this.time * 0.4 + i) * 0.0015;
      positions.setX(i, x);
    }
    positions.needsUpdate = true;
  }

  /** A handful of soft glowing motes drifting up through the scene — cheap atmosphere for the title screen. */
  private buildMotes(): void {
    const count = 60;
    const positions = new Float32Array(count * 3);
    this.moteVelocities = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 6;
      positions[i * 3 + 1] = Math.random() * 3.5 - 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 5;
      this.moteVelocities[i] = 0.12 + Math.random() * 0.18;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xf2c14e,
      size: 0.045,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(geo, mat);
    this.scene.add(this.motes);
  }

  private toggleMusic(): void {
    if (audio.isThemePlaying()) {
      audio.stopTheme();
      localStorage.setItem(MUSIC_PREF_KEY, 'off');
    } else {
      audio.startTheme();
      localStorage.setItem(MUSIC_PREF_KEY, 'on');
    }
    this.musicBtn.textContent = audio.isThemePlaying() ? '♪' : '✕';
  }

  private startNewGame(slot: number): void {
    setActiveSlot(slot);
    this.game.goTo(new IntroScreen(this.game));
  }

  private continueSlot(slot: number): void {
    const player = loadSlotSave(slot);
    if (player) {
      goToLazy(this.game, async () => {
        const [{ OverworldScreen }, { loadPlayerAvatar }] = await Promise.all([import('./OverworldScreen'), import('../render/playerAvatar')]);
        const avatar = await loadPlayerAvatar(player);
        return new OverworldScreen(this.game, player, avatar);
      });
    } else {
      // Corrupted/unreadable save: don't leave the button silently doing
      // nothing — clear it and let the player start a new character here.
      deleteSlotSave(slot);
      alert('Não foi possível carregar o jogo salvo (dados corrompidos). Iniciando um novo jogo.');
      this.startNewGame(slot);
    }
  }

  private deleteSlot(slot: number): void {
    if (!confirm('Tem certeza que deseja excluir este personagem? Esta ação não pode ser desfeita.')) return;
    deleteSlotSave(slot);
    this.game.goTo(new MainMenuScreen(this.game));
  }

  private buildSlotCard(slot: number, entry: SaveSlotEntry): HTMLElement {
    if (!entry) {
      return el('div', { className: 'save-slot empty' }, [
        el('div', { className: 'slot-info', text: `Slot ${slot + 1}: vazio` }),
        el('div', { className: 'btn primary', text: 'Novo Jogo', onClick: () => this.startNewGame(slot) }),
      ]);
    }
    const className = getClassById(entry.summary.classId).name;
    return el('div', { className: 'save-slot' }, [
      el('div', { className: 'slot-info', text: `Slot ${slot + 1}: ${entry.summary.name} — ${className} Nv.${entry.summary.level}` }),
      el('div', { className: 'row' }, [
        el('div', { className: 'btn primary', text: 'Continuar', onClick: () => this.continueSlot(slot) }),
        el('div', { className: 'btn danger', text: 'Excluir', onClick: () => this.deleteSlot(slot) }),
      ]),
    ]);
  }

  private buildUi(): void {
    const slots = listSaveSlots();
    const slotsEl = el(
      'div',
      { className: 'save-slots' },
      slots.map((entry, slot) => this.buildSlotCard(slot, entry)),
    );

    this.musicBtn = el('div', {
      className: 'btn music-toggle',
      text: musicPreferredOn() ? '♪' : '✕',
      onClick: () => this.toggleMusic(),
    });

    const menu = el(
      'div',
      { className: 'main-menu screen' },
      [
        this.musicBtn,
        el('div', { className: 'top-bar' }, [
          el('h1', { className: 'title-logo', text: 'VOZEIRO' }),
          el('div', { className: 'subtitle', text: 'As Raízes de Ipêra despertam. Só um Vozeiro pode ouvi-las.' }),
        ]),
        el('div', { className: 'bottom-bar' }, [
          slotsEl,
          el('div', { className: 'hint', text: 'Setas/WASD para mover · Toque na tela em dispositivos móveis' }),
        ]),
      ],
    );
    this.game.uiRoot.append(menu);
  }
}
