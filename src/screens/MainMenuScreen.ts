import * as THREE from 'three';
import { CLASS_DEFINITIONS, getClassById } from '../config/classes';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { GltfActor } from '../render/gltfModel';
import { loadPreviewAvatar } from '../render/playerAvatar';
import { audio } from '../systems/AudioSystem';
import { deleteSlotSave, exportSlot, importSlot, listSaveSlots, loadSlot, previewImport, setActiveSlot, type SaveSlotEntry, type SaveSlotSummary } from '../systems/SaveSystem';
import { confirmDialog, noticeDialog } from '../ui/dialogs';
import { el, goToLazy } from '../ui/dom';
import { downloadTextFile, pickTextFile } from '../ui/files';
import { IntroScreen } from './IntroScreen';

/** Classic cheat-code key sequence — arrow keys then b, a. Nothing else on this screen listens for arrow keys, so it's safe to consume here without colliding with any real control. */
const KONAMI_SEQUENCE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
/** Rapid clicks on the logo, within this window, celebrate instead of doing nothing — see onLogoClick. */
const LOGO_CLICK_THRESHOLD = 8;
const LOGO_CLICK_WINDOW = 2.5;

function describeSlot(summary: SaveSlotSummary): string {
  let className = summary.classId;
  try {
    className = getClassById(summary.classId).name;
  } catch {
    // An unknown class id still deserves a readable card.
  }
  return `${summary.name} — ${className} Nv.${summary.level}`;
}

export class MainMenuScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private showcase = new THREE.Group();
  private showcaseActor: GltfActor | null = null;
  private motes!: THREE.Points;
  private moteVelocities: Float32Array = new Float32Array();
  private corruptionMotes!: THREE.Points;
  private corruptionVelocities: Float32Array = new Float32Array();
  private rim!: THREE.DirectionalLight;
  private time = 0;
  private settingsBtn!: HTMLElement;

  // "Something watches from the fog" — a rare, brief glimpse of a pair of
  // glowing eyes far behind the distant silhouette, never guaranteed on any
  // given visit so it stays a genuine "did I just see that?" moment instead
  // of a scripted beat. Built once in mount(), only ever shown/hidden and
  // faded via opacity — never rebuilt — so triggering it repeatedly costs
  // nothing beyond a few float multiplications per frame.
  private watcherEyes!: THREE.Group;
  private watcherState: 'hidden' | 'fadein' | 'hold' | 'fadeout' = 'hidden';
  private watcherPhaseTimer = 0;
  private nextWatcherCheck = 8 + Math.random() * 10;

  private logoClickCount = 0;
  private logoClickWindowTimer = 0;
  private konamiBuffer: string[] = [];
  private secretToastEl!: HTMLElement;
  private secretToastTimer = 0;
  /** Counts down the one-shot 'Cheer' clip (see celebrateSecret) so it can revert to 'Idle' itself — a raw GltfActor has no auto-revert-on-finish of its own (unlike GltfCharacterAnimator, which this screen doesn't use). */
  private celebrateTimer = 0;

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
    this.rim = new THREE.DirectionalLight(0xf2c14e, 0.5);
    this.rim.position.set(-3, 2, -3);
    this.scene.add(ambient, key, this.rim);

    this.camera.position.set(0, 1.15, 4.4);
    this.camera.lookAt(0, 0.85, 0);

    const def = CLASS_DEFINITIONS[0];
    this.scene.add(this.showcase);
    loadPreviewAvatar(def.id)
      .then((avatar) => {
        this.scene.remove(this.showcase);
        this.showcase = avatar.scene;
        this.showcaseActor = avatar.actor;
        this.scene.add(this.showcase);
      })
      .catch((err) => console.error('Falha ao carregar modelo da classe', err));

    this.buildMotes();
    this.buildCorruptionMotes();
    this.buildDistantSilhouette();
    this.buildWatcherEyes();
    this.buildUi();

    window.addEventListener('keydown', this.onKeyDown);
    // A classic hidden signature — costs nothing, never seen by a player who
    // doesn't open devtools, and this codebase already has plenty of real
    // lore to quote instead of a generic "hello world".
    console.log(
      '%cAs Raízes ouvem quem escuta.',
      'color:#f2c14e; font-family: serif; font-size: 14px; font-style: italic;',
    );

    // Volume itself is already applied (main.ts calls audio.setMusicVolume
    // from the same persisted settings before this screen ever mounts) —
    // this only decides whether to bother starting the theme's oscillators
    // at all when it would just play at silent 0% anyway.
    if (audio.getMusicVolume() > 0) audio.startTheme();
  }

  unmount(): void {
    audio.stopTheme();
    window.removeEventListener('keydown', this.onKeyDown);
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    this.showcase.rotation.y = this.time * 0.6;
    this.showcaseActor?.update(dt);

    // A slow, small orbit instead of a fixed shot — enough to read as a
    // living camera (parallax between the showcase and the distant
    // silhouette behind it) without ever being fast enough to distract from
    // the save-slot UI in front of it.
    this.camera.position.x = Math.sin(this.time * 0.08) * 0.55;
    this.camera.position.z = 4.4 + Math.cos(this.time * 0.08) * 0.25;
    this.camera.lookAt(0, 0.85, 0);

    // A faint breathing pulse on the rim light — Ipêra's own corruption/hope
    // axes (see systems/WorldStateSystem.ts) already frame this world as
    // something alive underfoot; a light that visibly breathes is the
    // cheapest way to make the title screen itself feel the same way.
    this.rim.intensity = 0.5 + Math.sin(this.time * 0.9) * 0.12;

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

    this.updateCorruptionMotes(dt);
    this.updateWatcherGlimpse(dt);

    if (this.logoClickWindowTimer > 0) {
      this.logoClickWindowTimer -= dt;
      if (this.logoClickWindowTimer <= 0) this.logoClickCount = 0;
    }
    if (this.secretToastTimer > 0) {
      this.secretToastTimer -= dt;
      if (this.secretToastTimer <= 0) this.secretToastEl.classList.remove('visible');
    }
    if (this.celebrateTimer > 0) {
      this.celebrateTimer -= dt;
      if (this.celebrateTimer <= 0) this.showcaseActor?.play('Idle', { fade: 0.4 });
    }
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

  /**
   * A second, sparser mote layer in the Sede's own corruption violet — sinks
   * instead of rising, the opposite pull from the gold hope motes above.
   * Ties the title screen's atmosphere directly to the corruption/hope axes
   * this world already tracks (WorldStateSystem.ts) instead of being a
   * generic "add particles" flourish.
   */
  private buildCorruptionMotes(): void {
    const count = 24;
    const positions = new Float32Array(count * 3);
    this.corruptionVelocities = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 7;
      positions[i * 3 + 1] = Math.random() * 3 + 0.5;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;
      this.corruptionVelocities[i] = 0.05 + Math.random() * 0.08;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x7a4fb3,
      size: 0.06,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.corruptionMotes = new THREE.Points(geo, mat);
    this.scene.add(this.corruptionMotes);
  }

  private updateCorruptionMotes(dt: number): void {
    const positions = this.corruptionMotes.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      let y = positions.getY(i) - this.corruptionVelocities[i] * dt;
      if (y < -0.5) y = 3.5;
      positions.setY(i, y);
    }
    positions.needsUpdate = true;
  }

  /**
   * A small, mostly-silhouetted twisted shape far behind the showcase
   * pedestal — deliberately much darker/simpler than IntroScreen's own
   * blossoming hero tree (that one's the Florescência in bloom; this one is
   * just an ominous watcher shape at the edge of the fog, seen from much
   * further away) rather than sharing that builder as-is.
   */
  private buildDistantSilhouette(): void {
    // Fog is set to (near 6, far 14) above — anything placed past ~13 units
    // from the camera (it orbits around z≈4.4) renders as flat background
    // color, not a silhouette. z=-5 puts this roughly mid-fog: present and
    // readably shaped, not a wasted, fully-swallowed mesh.
    const mat = new THREE.MeshStandardMaterial({ color: 0x120e18, roughness: 1, flatShading: true });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.45, 3.2, 7), mat);
    trunk.position.set(-2.4, 1.4, -5);
    trunk.rotation.z = 0.12;
    this.scene.add(trunk);
    const lobes: Array<[number, number, number, number]> = [
      [-2.4, 3.0, -5, 1.3],
      [-3.3, 2.7, -4.5, 0.9],
      [-1.6, 3.4, -5.4, 0.85],
    ];
    for (const [x, y, z, s] of lobes) {
      const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), mat);
      canopy.position.set(x, y, z);
      this.scene.add(canopy);
    }
  }

  /** Built once, hidden by default — see updateWatcherGlimpse for the fade state machine that reveals it. */
  private buildWatcherEyes(): void {
    // fog: false is deliberate — these read as a light source (something
    // glowing IN the fog, not a solid object fogged like everything else),
    // which is also the only way they'd stay visible at all: nested inside
    // the distant silhouette's canopy (see buildDistantSilhouette), a fogged
    // material at this distance would render indistinguishable from the fog
    // color itself.
    const mat = new THREE.MeshBasicMaterial({ color: 0xc23b3b, transparent: true, opacity: 0, fog: false });
    const left = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), mat);
    const right = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), mat.clone());
    left.position.set(-2.55, 2.85, -4.9);
    right.position.set(-2.28, 2.85, -4.9);
    this.watcherEyes = new THREE.Group();
    this.watcherEyes.add(left, right);
    this.scene.add(this.watcherEyes);
  }

  /**
   * A rare, unscripted "something in the fog" beat: each tick has a small
   * chance to start a glimpse once `nextWatcherCheck` elapses, so most
   * visits to the title screen never show it at all — the ones that do feel
   * found, not scheduled. Pure opacity fades on two already-built spheres;
   * no allocation happens here, ever.
   */
  private updateWatcherGlimpse(dt: number): void {
    const [left, right] = this.watcherEyes.children as THREE.Mesh[];
    const leftMat = left.material as THREE.MeshBasicMaterial;
    const rightMat = right.material as THREE.MeshBasicMaterial;

    if (this.watcherState === 'hidden') {
      this.nextWatcherCheck -= dt;
      if (this.nextWatcherCheck <= 0) {
        // ~1 in 3 checks actually starts a glimpse; the other 2 just push the
        // next check further out, so the wait between real glimpses varies a lot.
        if (Math.random() < 0.33) {
          this.watcherState = 'fadein';
          this.watcherPhaseTimer = 0;
        } else {
          this.nextWatcherCheck = 10 + Math.random() * 14;
        }
      }
      return;
    }

    this.watcherPhaseTimer += dt;
    if (this.watcherState === 'fadein') {
      const t = Math.min(1, this.watcherPhaseTimer / 1.2);
      leftMat.opacity = rightMat.opacity = t * 0.85;
      if (t >= 1) {
        this.watcherState = 'hold';
        this.watcherPhaseTimer = 0;
      }
    } else if (this.watcherState === 'hold') {
      if (this.watcherPhaseTimer >= 1.6) {
        this.watcherState = 'fadeout';
        this.watcherPhaseTimer = 0;
      }
    } else if (this.watcherState === 'fadeout') {
      const t = Math.min(1, this.watcherPhaseTimer / 1.4);
      leftMat.opacity = rightMat.opacity = (1 - t) * 0.85;
      if (t >= 1) {
        this.watcherState = 'hidden';
        this.nextWatcherCheck = 25 + Math.random() * 35;
      }
    }
  }

  /** Konami code (see KONAMI_SEQUENCE) — the only keyboard input this screen listens for. */
  private onKeyDown = (ev: KeyboardEvent): void => {
    this.konamiBuffer.push(ev.key);
    if (this.konamiBuffer.length > KONAMI_SEQUENCE.length) this.konamiBuffer.shift();
    if (this.konamiBuffer.length === KONAMI_SEQUENCE.length && this.konamiBuffer.every((k, i) => k === KONAMI_SEQUENCE[i])) {
      this.konamiBuffer = [];
      this.triggerKonamiSecret();
    }
  };

  private triggerKonamiSecret(): void {
    audio.secretFound();
    // Force an immediate glimpse regardless of the ambient timer — a
    // deliberately-entered code gets an immediate, guaranteed payoff rather
    // than competing with the same rare roll a passive visit gets.
    if (this.watcherState === 'hidden') {
      this.watcherState = 'fadein';
      this.watcherPhaseTimer = 0;
    }
    this.showSecretToast('As Raízes reconhecem esse gesto. Alguém, há muito tempo, ensinou esse código a quem o carrega.');
  }

  /** 8 clicks on the logo within 2.5s — see LOGO_CLICK_THRESHOLD/LOGO_CLICK_WINDOW. */
  private onLogoClick(): void {
    this.logoClickWindowTimer = LOGO_CLICK_WINDOW;
    this.logoClickCount += 1;
    if (this.logoClickCount >= LOGO_CLICK_THRESHOLD) {
      this.logoClickCount = 0;
      this.logoClickWindowTimer = 0;
      this.celebrateSecret();
    }
  }

  private celebrateSecret(): void {
    audio.secretFound();
    if (this.showcaseActor) {
      this.showcaseActor.play('Cheer', { loop: false, fade: 0.15 });
      this.celebrateTimer = this.showcaseActor.duration('Cheer') || 2;
    }
    this.showSecretToast('O Escolhido Verde agradece a atenção — mas a Sede não espera.');
  }

  private showSecretToast(text: string): void {
    this.secretToastEl.textContent = text;
    this.secretToastEl.classList.add('visible');
    this.secretToastTimer = 4.5;
  }

  private openSettings(): void {
    goToLazy(this.game, async () => {
      const { SettingsScreen } = await import('./SettingsScreen');
      return new SettingsScreen(this.game, () => this.game.goTo(new MainMenuScreen(this.game)));
    });
  }

  private startNewGame(slot: number): void {
    setActiveSlot(slot);
    this.game.goTo(new IntroScreen(this.game));
  }

  private async onNewGameClick(slot: number, occupied: boolean): Promise<void> {
    if (occupied) {
      const ok = await confirmDialog(this.game.uiRoot, {
        title: 'Substituir personagem?',
        message: `O Slot ${slot + 1} já tem um personagem. Começar um novo jogo aqui substitui esse progresso. Exporte o save antes se quiser guardá-lo.`,
        confirmLabel: 'Novo Jogo',
        danger: true,
      });
      if (!ok) return;
    }
    this.startNewGame(slot);
  }

  private async continueSlot(slot: number): Promise<void> {
    const result = loadSlot(slot);
    if (result.status === 'ok') {
      const { player } = result;
      if (result.recoveredFromBackup) {
        await noticeDialog(this.game.uiRoot, 'Save restaurado', 'O último salvamento deste slot estava corrompido. Carregamos o backup do salvamento anterior.');
      }
      goToLazy(this.game, async () => {
        const [{ OverworldScreen }, { loadPlayerAvatar }] = await Promise.all([import('./OverworldScreen'), import('../render/playerAvatar')]);
        const avatar = await loadPlayerAvatar(player);
        return new OverworldScreen(this.game, player, avatar);
      });
    } else if (result.status === 'newer') {
      await noticeDialog(this.game.uiRoot, 'Save de versão mais nova', 'Este personagem foi salvo por uma versão mais nova do jogo. Atualize o jogo para continuar. Nada foi apagado.');
    } else if (result.status === 'empty') {
      this.game.goTo(new MainMenuScreen(this.game));
    } else {
      // Corrupted/unreadable save (and no usable backup): don't leave the
      // button silently doing nothing — clear it and let the player start a
      // new character here.
      await noticeDialog(this.game.uiRoot, 'Save corrompido', 'Não foi possível carregar o jogo salvo (dados corrompidos). Iniciando um novo jogo.');
      deleteSlotSave(slot);
      this.startNewGame(slot);
    }
  }

  private async deleteSlot(slot: number): Promise<void> {
    const ok = await confirmDialog(this.game.uiRoot, {
      title: 'Excluir personagem?',
      message: `Tem certeza que deseja excluir o personagem do Slot ${slot + 1}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    deleteSlotSave(slot);
    this.game.goTo(new MainMenuScreen(this.game));
  }

  private async exportSlotFile(slot: number): Promise<void> {
    const file = exportSlot(slot);
    if (!file) {
      await noticeDialog(this.game.uiRoot, 'Exportação falhou', 'Não foi possível ler o save deste slot.');
      return;
    }
    downloadTextFile(file.filename, file.text);
  }

  private async importIntoSlot(slot: number, occupied: boolean): Promise<void> {
    const text = await pickTextFile();
    if (text === null) return;
    const preview = previewImport(text);
    if (!preview.ok) {
      await noticeDialog(this.game.uiRoot, 'Importação falhou', preview.error);
      return;
    }
    if (occupied) {
      const ok = await confirmDialog(this.game.uiRoot, {
        title: 'Substituir personagem?',
        message: `Importar ${describeSlot(preview.summary)} substitui o personagem atual do Slot ${slot + 1}.`,
        confirmLabel: 'Importar',
        danger: true,
      });
      if (!ok) return;
    }
    const result = importSlot(slot, text);
    if (!result.ok) {
      await noticeDialog(this.game.uiRoot, 'Importação falhou', result.error);
      return;
    }
    this.game.goTo(new MainMenuScreen(this.game));
  }

  private buildSlotCard(slot: number, entry: SaveSlotEntry): HTMLElement {
    const importBtn = el('div', { className: 'btn small', text: 'Importar', onClick: () => void this.importIntoSlot(slot, entry !== null) });
    if (!entry) {
      return el('div', { className: 'save-slot empty' }, [
        el('div', { className: 'slot-info', text: `Slot ${slot + 1}: vazio` }),
        el('div', { className: 'row' }, [el('div', { className: 'btn primary', text: 'Novo Jogo', onClick: () => void this.onNewGameClick(slot, false) }), importBtn]),
      ]);
    }
    return el('div', { className: 'save-slot' }, [
      el('div', { className: 'slot-info', text: `Slot ${slot + 1}: ${describeSlot(entry.summary)}` }),
      el('div', { className: 'row' }, [
        el('div', { className: 'btn primary', text: 'Continuar', onClick: () => void this.continueSlot(slot) }),
        el('div', { className: 'btn danger', text: 'Excluir', onClick: () => void this.deleteSlot(slot) }),
      ]),
      el('div', { className: 'slot-tools' }, [
        el('div', { className: 'btn small', text: 'Novo Jogo', onClick: () => void this.onNewGameClick(slot, true) }),
        el('div', { className: 'btn small', text: 'Exportar', onClick: () => void this.exportSlotFile(slot) }),
        importBtn,
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

    this.settingsBtn = el('div', {
      className: 'btn settings-toggle',
      text: '⚙',
      onClick: () => this.openSettings(),
    });

    this.secretToastEl = el('div', { className: 'menu-secret-toast' });

    const menu = el(
      'div',
      { className: 'main-menu screen' },
      [
        this.settingsBtn,
        el('div', { className: 'top-bar' }, [
          // Not a real button — no visible affordance hints at this, on
          // purpose (see onLogoClick/LOGO_CLICK_THRESHOLD); a title-screen
          // easter egg that announces itself isn't one.
          el('h1', { className: 'title-logo', text: 'SEDE', onClick: () => this.onLogoClick() }),
          el('div', { className: 'subtitle', text: 'As Raízes de Ipêra apodrecem. Só um Escolhido Verde pode salvá-las.' }),
          this.secretToastEl,
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
