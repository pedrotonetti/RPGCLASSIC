import * as THREE from 'three';
import { getClassById } from '../config/classes';
import {
  GARMENT_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  HEAD_ACCESSORIES,
  HEIGHT_NOTCHES,
  defaultAppearance,
  randomizeAppearance,
  type CharacterAppearance,
  type ChoiceOption,
  type SwatchOption,
} from '../config/customization';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { Player } from '../entities/Player';
import { GltfActor } from '../render/gltfModel';
import { applyCosmeticVisual, cosmeticSlotsForClass, loadPreviewAvatar } from '../render/playerAvatar';
import { el, goToLazy } from '../ui/dom';
import { CharacterSelectScreen } from './CharacterSelectScreen';

const HEIGHT_LABELS = ['Baixo', 'Médio-', 'Médio', 'Médio+', 'Alto'];

/**
 * The preview here is the same real rigged GLTF model the adventure itself
 * uses (`render/playerAvatar.ts`), not a stand-in — except it loads
 * asynchronously (see `loadShowcase`), so `mount()` adds an empty placeholder
 * group first and swaps the real model in once its file resolves.
 *
 * 6 `CharacterAppearance` fields now have a real, visible home on this model
 * (see `playerAvatar.ts`'s `applyCosmeticVisual` for exactly how/why): height
 * (uniform scale), whether the class's own headwear mesh is worn
 * (`headAccessory`) and its tint (`primaryColor`), the class's own cape tint
 * (`secondaryColor`), and an attached hair accent for a few long-hair picks
 * (`hairStyle`+`hairColor`). Those 6 get their own picker below.
 *
 * The rest of `CharacterAppearance` (gender, skin tone, body type, face
 * shape, eyebrows, facial hair, scars, tattoos, eye color) has no separate
 * mesh or material slot on the class's single pre-baked texture atlas to
 * live on — that's the genuine ceiling of this asset pack, not an oversight
 * — so this screen doesn't offer pickers for them. They aren't wasted,
 * though: `randomizeAppearance` below still rolls them, and they still drive
 * the separate procedural mannequin `render/characterModel.ts` builds for
 * the Inventário/Habilidades showcases (see `buildPlayerCharacter`), which
 * has no such texture-atlas limit.
 */
export class CharacterCreationScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private appearance: CharacterAppearance;
  private heroName = 'Herói';
  private showcase: THREE.Group = new THREE.Group();
  private showcaseActor: GltfActor | null = null;
  /** Bumped on every (re)load so a slower, superseded load can't clobber a newer one that already resolved (rapid height clicks). */
  private showcaseGen = 0;
  private time = 0;
  private scrollEl!: HTMLElement;

  constructor(
    private game: Game,
    private classId: string,
  ) {
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 50);
    const def = getClassById(classId);
    this.appearance = randomizeAppearance(defaultAppearance(def.color, def.accentColor));
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x1a1423);
    this.scene.fog = new THREE.Fog(0x1a1423, 6, 15);

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.05, 0.25, 24),
      new THREE.MeshStandardMaterial({ color: 0x3a2f4d, roughness: 0.8 }),
    );
    // Top surface at y=0 — was -0.02 (top at +0.105), which buried the
    // character's feet (at y≈0.045) inside the pedestal.
    pedestal.position.y = -0.125;
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

    this.scene.add(this.showcase);
    this.loadShowcase();
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
    this.showcaseActor?.update(dt);
  }

  /**
   * Loads the real class model async and swaps it in once ready — a brief
   * pop-in from the empty placeholder `mount()` starts with, same tradeoff
   * `OverworldScreen.spawnFoxAt` makes for ambient wildlife. Never disposes
   * the outgoing showcase's geometry/materials: `loadSkinnedInstance` clones
   * share those by reference (see three's `SkeletonUtils.clone`), so this
   * class's other loaded instances (or a subsequent reload here) still need
   * them alive.
   */
  private loadShowcase(): void {
    const gen = ++this.showcaseGen;
    loadPreviewAvatar(this.classId, this.appearance)
      .then((avatar) => {
        if (gen !== this.showcaseGen) return; // superseded by a newer appearance change
        this.scene.remove(this.showcase);
        this.showcase = avatar.scene;
        this.showcaseActor = avatar.actor;
        this.scene.add(this.showcase);
      })
      .catch((err) => console.error('Falha ao carregar modelo do herói', err));
  }

  /** Height (and "Aleatorizar", which may change it) needs a full model reload — it's a scale applied at load time. Every other cosmetic pick just gets re-applied to the already-loaded model instead — see `onCosmeticChanged`/`applyCosmeticVisual`. */
  private reloadShowcase(): void {
    this.loadShowcase();
    this.renderPanel();
  }

  private onCosmeticChanged(): void {
    applyCosmeticVisual({ scene: this.showcase, classId: this.classId }, this.appearance);
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
        this.reloadShowcase();
      },
    });
    const confirmBtn = el('div', { className: 'btn primary', text: 'Começar Aventura >', onClick: () => this.confirm() });

    const panel = el('div', { className: 'creation-panel' }, [
      this.scrollEl,
      el('div', { className: 'creation-footer' }, [backBtn, randomBtn, confirmBtn]),
    ]);

    const screen = el('div', { className: 'creation-screen screen' }, [
      el('div', { className: 'creation-preview' }, [
        el('h1', { className: 'pixel-title', text: `Criar ${def.name}` }),
        el('div', {
          className: 'subtitle',
          text: 'Este é o modelo do seu herói na aventura.',
          style: {
            position: 'absolute',
            top: '50px',
            left: '20px',
            maxWidth: '50%',
            fontSize: '12px',
            opacity: '0.8',
            textShadow: '1px 1px 0 #000',
          },
        }),
      ]),
      panel,
    ]);

    this.game.uiRoot.append(screen);
    this.renderPanel();
  }

  private heightCategory(): HTMLElement {
    const a = this.appearance;
    const heightOptions: ChoiceOption[] = HEIGHT_NOTCHES.map((v, i) => ({ id: String(v), label: HEIGHT_LABELS[i] }));
    return el('div', { className: 'creation-category height-category' }, [
      el('div', { className: 'cat-label', text: 'Altura' }),
      el(
        'div',
        { className: 'creation-options' },
        heightOptions.map((opt) =>
          el('div', {
            className: `choice-btn height-btn ${String(a.heightScale) === opt.id ? 'selected' : ''}`,
            text: opt.label,
            onClick: () => {
              a.heightScale = Number(opt.id);
              this.reloadShowcase();
            },
          }),
        ),
      ),
    ]);
  }

  /** Recolor/toggle pickers whose swatch is one of `SwatchOption`'s literal color values (hair color, primary/secondary garment color). */
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
              this.onCosmeticChanged();
            },
          }),
        ),
      ),
    ]);
  }

  /** Named-choice pickers (hair style, head accessory) — a labeled button per option instead of a color swatch. */
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
              this.onCosmeticChanged();
            },
          }),
        ),
      ),
    ]);
  }

  private renderPanel(): void {
    const a = this.appearance;
    const slots = cosmeticSlotsForClass(this.classId);
    const nameInput = el('input', {
      className: 'btn creation-name-input',
      attrs: { type: 'text', value: this.heroName, maxlength: '16', placeholder: 'Nome do herói' },
      style: { textAlign: 'center' },
    });
    nameInput.addEventListener('input', () => {
      this.heroName = nameInput.value;
    });

    const categories: HTMLElement[] = [this.heightCategory()];
    // Head accessory + its tint only shown for classes whose model actually
    // has a headwear mesh to toggle/tint (`cosmeticSlotsForClass`) — hidden
    // rather than left clickable-but-inert for the rest.
    if (slots.headwear) {
      categories.push(
        this.choiceCategory('Acessório de Cabeça', HEAD_ACCESSORIES, () => a.headAccessory, (v) => (a.headAccessory = v as CharacterAppearance['headAccessory'])),
        this.swatchCategory('Cor Primária (acessório)', GARMENT_COLORS, () => a.primaryColor, (v) => (a.primaryColor = v)),
      );
    }
    if (slots.cape) {
      categories.push(this.swatchCategory('Cor Secundária (capa)', GARMENT_COLORS, () => a.secondaryColor, (v) => (a.secondaryColor = v)));
    }
    categories.push(
      this.choiceCategory('Estilo de Cabelo', HAIR_STYLES, () => a.hairStyle, (v) => (a.hairStyle = v as CharacterAppearance['hairStyle'])),
      this.swatchCategory('Cor do Cabelo', HAIR_COLORS, () => a.hairColor, (v) => (a.hairColor = v)),
    );

    this.scrollEl.replaceChildren(
      nameInput,
      el('div', {
        className: 'creation-note',
        text: 'Estas escolhas aparecem no herói real da aventura. Acessório de cabeça liga/desliga o item já modelado da sua classe (sem mudar de formato). Estilos de cabelo compridos/presos ganham uma mecha anexada na cor escolhida; estilos curtos usam o cabelo já pintado no modelo. Traços que sua classe não tem como mostrar ficam ocultos aqui — e rosto, corpo, tom de pele e olhos só aparecem no mostruário do Inventário/Habilidades.',
      }),
      ...categories,
    );
  }

  private confirm(): void {
    const name = this.heroName.trim().length > 0 ? this.heroName.trim().slice(0, 16) : 'Herói';
    const player = Player.createNew(name, this.classId);
    player.appearance = this.appearance;
    goToLazy(this.game, async () => {
      const [{ OverworldScreen }, { loadPlayerAvatar }] = await Promise.all([import('./OverworldScreen'), import('../render/playerAvatar')]);
      const avatar = await loadPlayerAvatar(player);
      return new OverworldScreen(this.game, player, avatar);
    });
  }
}
