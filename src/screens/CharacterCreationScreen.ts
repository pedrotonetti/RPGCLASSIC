import * as THREE from 'three';
import { getClassById } from '../config/classes';
import {
  BODY_TYPES,
  EYEBROW_STYLES,
  EYE_COLORS,
  FACE_SHAPES,
  FACIAL_HAIR_STYLES,
  GARMENT_COLORS,
  GENDERS,
  HAIR_COLORS,
  HAIR_STYLES,
  HEAD_ACCESSORIES,
  HEIGHT_NOTCHES,
  SCAR_STYLES,
  SKIN_TONES,
  TATTOO_STYLES,
  defaultAppearance,
  randomizeAppearance,
  type CharacterAppearance,
  type ChoiceOption,
  type SwatchOption,
} from '../config/customization';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { Player } from '../entities/Player';
import { buildHumanCharacter, type ClassAccessory } from '../render/characterModel';
import { el } from '../ui/dom';
import { CharacterSelectScreen } from './CharacterSelectScreen';
import { OverworldScreen } from './OverworldScreen';

const CLASS_ACCESSORY: Record<string, ClassAccessory> = {
  warrior: 'sword',
  mage: 'staff',
  archer: 'bow',
  cleric: 'cross',
  paladin: 'shield',
  assassin: 'dagger',
  necromancer: 'grimoire',
  monk: 'fists',
};

const HEIGHT_LABELS = ['Baixo', 'Médio-', 'Médio', 'Médio+', 'Alto'];

export class CharacterCreationScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private appearance: CharacterAppearance;
  private heroName = 'Herói';
  private showcase!: THREE.Group;
  private time = 0;
  private scrollEl!: HTMLElement;

  constructor(
    private game: Game,
    private classId: string,
  ) {
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 50);
    const def = getClassById(classId);
    this.appearance = defaultAppearance(def.color, def.accentColor);
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x1a1423);
    this.scene.fog = new THREE.Fog(0x1a1423, 6, 15);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.05, 0.25, 24),
      new THREE.MeshStandardMaterial({ color: 0x3a2f4d, roughness: 0.8 }),
    );
    pedestal.position.y = -0.02;
    pedestal.receiveShadow = true;
    this.scene.add(pedestal);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const key = new THREE.DirectionalLight(0xf2ede1, 1.1);
    key.position.set(2.5, 4, 3);
    key.castShadow = true;
    const rim = new THREE.DirectionalLight(0xf2c14e, 0.5);
    rim.position.set(-3, 2, -3);
    this.scene.add(ambient, key, rim);

    this.camera.position.set(0, 0.9, 3.6);
    this.camera.lookAt(0, 0.75, 0);

    this.rebuildShowcase();
    this.buildUi();
  }

  unmount(): void {}

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    this.showcase.rotation.y = Math.sin(this.time * 0.4) * 0.5;
  }

  private rebuildShowcase(): void {
    if (this.showcase) {
      this.scene.remove(this.showcase);
      this.showcase.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
        }
      });
    }
    this.showcase = buildHumanCharacter(this.appearance, CLASS_ACCESSORY[this.classId] ?? 'none');
    this.scene.add(this.showcase);
  }

  private onAppearanceChanged(): void {
    this.rebuildShowcase();
    this.renderPanel();
  }

  private buildUi(): void {
    const def = getClassById(this.classId);

    this.scrollEl = el('div', { className: 'creation-scroll' });

    const backBtn = el('div', { className: 'btn', text: '< Voltar', onClick: () => this.game.goTo(new CharacterSelectScreen(this.game)) });
    const randomBtn = el('div', {
      className: 'btn',
      text: 'Aleatorizar',
      onClick: () => {
        this.appearance = randomizeAppearance(this.appearance);
        this.onAppearanceChanged();
      },
    });
    const confirmBtn = el('div', { className: 'btn primary', text: 'Começar Aventura >', onClick: () => this.confirm() });

    const panel = el('div', { className: 'creation-panel' }, [
      this.scrollEl,
      el('div', { className: 'creation-footer' }, [backBtn, randomBtn, confirmBtn]),
    ]);

    const screen = el('div', { className: 'creation-screen screen' }, [
      el('div', { className: 'creation-preview' }, [el('h1', { className: 'pixel-title', text: `Criar ${def.name}` })]),
      panel,
    ]);

    this.game.uiRoot.append(screen);
    this.renderPanel();
  }

  private swatchCategory(label: string, options: SwatchOption[], get: () => number, set: (v: number) => void): HTMLElement {
    return el('div', { className: 'creation-category' }, [
      el('div', { className: 'cat-label', text: label }),
      el(
        'div',
        { className: 'creation-options' },
        options.map((opt) =>
          el('div', {
            className: `swatch ${get() === opt.value ? 'selected' : ''}`,
            style: { background: `#${opt.value.toString(16).padStart(6, '0')}` },
            attrs: { title: opt.label },
            onClick: () => {
              set(opt.value);
              this.onAppearanceChanged();
            },
          }),
        ),
      ),
    ]);
  }

  private choiceCategory(label: string, options: ChoiceOption[], get: () => string, set: (v: string) => void): HTMLElement {
    return el('div', { className: 'creation-category' }, [
      el('div', { className: 'cat-label', text: label }),
      el(
        'div',
        { className: 'creation-options' },
        options.map((opt) =>
          el('div', {
            className: `choice-btn ${get() === opt.id ? 'selected' : ''}`,
            text: opt.label,
            onClick: () => {
              set(opt.id);
              this.onAppearanceChanged();
            },
          }),
        ),
      ),
    ]);
  }

  private renderPanel(): void {
    const a = this.appearance;
    const nameInput = el('input', {
      className: 'btn creation-name-input',
      attrs: { type: 'text', value: this.heroName, maxlength: '16', placeholder: 'Nome do herói' },
      style: { textAlign: 'center' },
    });
    nameInput.addEventListener('input', () => {
      this.heroName = nameInput.value;
    });

    const heightOptions: ChoiceOption[] = HEIGHT_NOTCHES.map((v, i) => ({ id: String(v), label: HEIGHT_LABELS[i] }));

    this.scrollEl.replaceChildren(
      nameInput,
      this.choiceCategory('Gênero', GENDERS, () => a.gender, (v) => (a.gender = v as CharacterAppearance['gender'])),
      this.swatchCategory('Tom de Pele', SKIN_TONES, () => a.skinTone, (v) => (a.skinTone = v)),
      this.choiceCategory('Compleição', BODY_TYPES, () => a.bodyType, (v) => (a.bodyType = v as CharacterAppearance['bodyType'])),
      this.choiceCategory(
        'Altura',
        heightOptions,
        () => String(a.heightScale),
        (v) => (a.heightScale = Number(v)),
      ),
      this.choiceCategory('Formato do Rosto', FACE_SHAPES, () => a.faceShape, (v) => (a.faceShape = v as CharacterAppearance['faceShape'])),
      this.swatchCategory('Cor dos Olhos', EYE_COLORS, () => a.eyeColor, (v) => (a.eyeColor = v)),
      this.choiceCategory('Sobrancelhas', EYEBROW_STYLES, () => a.eyebrowStyle, (v) => (a.eyebrowStyle = v as CharacterAppearance['eyebrowStyle'])),
      this.choiceCategory('Estilo de Cabelo', HAIR_STYLES, () => a.hairStyle, (v) => (a.hairStyle = v as CharacterAppearance['hairStyle'])),
      this.swatchCategory('Cor do Cabelo', HAIR_COLORS, () => a.hairColor, (v) => (a.hairColor = v)),
      this.choiceCategory('Pelos Faciais', FACIAL_HAIR_STYLES, () => a.facialHair, (v) => (a.facialHair = v as CharacterAppearance['facialHair'])),
      this.choiceCategory('Acessório de Cabeça', HEAD_ACCESSORIES, () => a.headAccessory, (v) => (a.headAccessory = v as CharacterAppearance['headAccessory'])),
      this.swatchCategory('Cor Primária', GARMENT_COLORS, () => a.primaryColor, (v) => (a.primaryColor = v)),
      this.swatchCategory('Cor Secundária', GARMENT_COLORS, () => a.secondaryColor, (v) => (a.secondaryColor = v)),
      this.choiceCategory('Cicatriz', SCAR_STYLES, () => a.scarStyle, (v) => (a.scarStyle = v as CharacterAppearance['scarStyle'])),
      this.choiceCategory('Tatuagem', TATTOO_STYLES, () => a.tattooStyle, (v) => (a.tattooStyle = v as CharacterAppearance['tattooStyle'])),
    );
  }

  private confirm(): void {
    const name = this.heroName.trim().length > 0 ? this.heroName.trim().slice(0, 16) : 'Herói';
    const player = Player.createNew(name, this.classId);
    player.appearance = this.appearance;
    this.game.goTo(new OverworldScreen(this.game, player));
  }
}
