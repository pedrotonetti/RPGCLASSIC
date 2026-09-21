import * as THREE from 'three';
import { getClassById } from '../config/classes';
import { HEIGHT_NOTCHES, defaultAppearance, type CharacterAppearance, type ChoiceOption } from '../config/customization';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { Player } from '../entities/Player';
import { GltfActor } from '../render/gltfModel';
import { loadPreviewAvatar } from '../render/playerAvatar';
import { el, goToLazy } from '../ui/dom';
import { CharacterSelectScreen } from './CharacterSelectScreen';

const HEIGHT_LABELS = ['Baixo', 'Médio-', 'Médio', 'Médio+', 'Alto'];

/**
 * The preview here is the same real rigged GLTF model the adventure itself
 * uses (`render/playerAvatar.ts`), not a stand-in — except it loads
 * asynchronously (see `loadShowcase`), so `mount()` adds an empty placeholder
 * group first and swaps the real model in once its file resolves. Of every
 * `CharacterAppearance` field, only `heightScale` has anywhere to go on the
 * model (a uniform scale) — skin tone, face, hair, markings and garment
 * colors have no home on the class's single pre-baked texture atlas, so this
 * screen no longer offers controls for them at all (see `defaultAppearance`
 * for what the rest quietly default to instead).
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
    this.appearance = defaultAppearance(def.color, def.accentColor);
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
    loadPreviewAvatar(this.classId, this.appearance.heightScale)
      .then((avatar) => {
        if (gen !== this.showcaseGen) return; // superseded by a newer height change
        this.scene.remove(this.showcase);
        this.showcase = avatar.scene;
        this.showcaseActor = avatar.actor;
        this.scene.add(this.showcase);
      })
      .catch((err) => console.error('Falha ao carregar modelo do herói', err));
  }

  private onHeightChanged(): void {
    this.loadShowcase();
    this.renderPanel();
  }

  private buildUi(): void {
    const def = getClassById(this.classId);

    this.scrollEl = el('div', { className: 'creation-scroll' });

    const backBtn = el('div', { className: 'btn', text: '< Voltar', onClick: () => this.game.goTo(new CharacterSelectScreen(this.game)) });
    const confirmBtn = el('div', { className: 'btn primary', text: 'Começar Aventura >', onClick: () => this.confirm() });

    const panel = el('div', { className: 'creation-panel' }, [
      this.scrollEl,
      el('div', { className: 'creation-footer' }, [backBtn, confirmBtn]),
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
              this.onHeightChanged();
            },
          }),
        ),
      ),
    ]);
  }

  private renderPanel(): void {
    const nameInput = el('input', {
      className: 'btn creation-name-input',
      attrs: { type: 'text', value: this.heroName, maxlength: '16', placeholder: 'Nome do herói' },
      style: { textAlign: 'center' },
    });
    nameInput.addEventListener('input', () => {
      this.heroName = nameInput.value;
    });

    this.scrollEl.replaceChildren(
      nameInput,
      el('div', {
        className: 'creation-note',
        text: 'A aparência do herói segue o modelo da classe — só a altura é ajustável.',
      }),
      this.heightCategory(),
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
