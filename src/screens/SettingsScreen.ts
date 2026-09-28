import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import type { Player } from '../entities/Player';
import { audio } from '../systems/AudioSystem';
import { loadSettings, saveSettings, type GameSettings } from '../systems/GameSettings';
import { el } from '../ui/dom';
import { buildDevPanel } from './DevPanel';

/**
 * Reachable from both the main menu (before any save is loaded — see
 * MainMenuScreen) and the pause overlay (mid-game — see
 * OverworldScreen.buildPauseOverlay), so it takes a plain `onBack` closure
 * instead of knowing about either caller's own navigation — each wires up
 * whatever "back" actually means for it (return to the main menu, or
 * rebuild the exact same OverworldScreen).
 *
 * Music/SFX volume were the only thing genuinely missing supporting
 * infrastructure for (see AudioSystem's new musicGain/sfxGain split) —
 * everything else here (the low-power render override, the dev panel) just
 * surfaces a knob/tool that already existed one way or another.
 */
export class SettingsScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private settings: GameSettings;
  private titleTapCount = 0;
  private titleTapWindow = 0;
  private devPanelEl: HTMLElement | null = null;

  constructor(
    private game: Game,
    private onBack: () => void,
    private player: Player | null = null,
  ) {
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50);
    this.settings = loadSettings();
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x0d0a12);
    this.camera.position.set(0, 0, 5);
    this.buildUi();
  }

  unmount(): void {}

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(): void {}

  private persist(): void {
    saveSettings(this.settings);
  }

  private volumeRow(label: string, get: () => number, set: (v: number) => void): HTMLElement {
    const valueEl = el('div', { className: 'settings-slider-value', text: `${Math.round(get() * 100)}%` });
    const slider = el('input', {
      className: 'settings-slider',
      attrs: { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(get() * 100)) },
    }) as HTMLInputElement;
    slider.addEventListener('input', () => {
      const v = Number(slider.value) / 100;
      set(v);
      valueEl.textContent = `${Math.round(v * 100)}%`;
      this.persist();
    });
    return el('div', { className: 'settings-row' }, [el('div', { className: 'settings-label', text: label }), slider, valueEl]);
  }

  /** The 3-way "Automático / Ativado / Desativado" segmented control for lowPowerOverride — re-rendered in place on every change since only 3 buttons need it, cheaper than tracking each one's own active-class handle. */
  private lowPowerRow(): HTMLElement {
    const options: Array<{ value: boolean | null; label: string }> = [
      { value: null, label: 'Automático' },
      { value: true, label: 'Ativado' },
      { value: false, label: 'Desativado' },
    ];
    const container = el('div', { className: 'settings-segmented' });
    const render = () => {
      container.replaceChildren(
        ...options.map((opt) =>
          el('div', {
            className: `btn settings-segment${this.settings.lowPowerOverride === opt.value ? ' active' : ''}`,
            text: opt.label,
            onClick: () => {
              this.settings.lowPowerOverride = opt.value;
              this.persist();
              render();
            },
          }),
        ),
      );
    };
    render();
    return el('div', { className: 'settings-row' }, [
      el('div', { className: 'settings-label', text: 'Modo Economia (gráficos)' }),
      container,
    ]);
  }

  /**
   * Tapping the screen's own title 7 times within 2.5s reveals the dev
   * panel — same undiscoverable-on-purpose gesture MainMenuScreen's own
   * easter eggs use (see its onLogoClick), not a visible button, since this
   * is a testing tool for the player who asked for it, not a normal setting.
   */
  private onTitleTap(): void {
    const now = performance.now() / 1000;
    if (now - this.titleTapWindow > 2.5) this.titleTapCount = 0;
    this.titleTapWindow = now;
    this.titleTapCount += 1;
    if (this.titleTapCount >= 7 && !this.devPanelEl) {
      this.titleTapCount = 0;
      audio.secretFound();
      this.devPanelEl = buildDevPanel(this.player);
      this.devSlot?.append(this.devPanelEl);
    }
  }

  private devSlot: HTMLElement | null = null;

  private buildUi(): void {
    const backBtn = el('div', { className: 'btn primary', text: '< Voltar', onClick: () => this.onBack() });

    const title = el('h1', { text: 'Configurações', onClick: () => this.onTitleTap() });
    title.style.cursor = 'default';
    title.style.userSelect = 'none';
    // #ui-root defaults every child to pointer-events: none (see
    // MainMenuScreen's own title-logo for the same fix) — without this the
    // canvas underneath swallows every click and the 7-tap gesture below
    // never fires.
    title.style.pointerEvents = 'auto';

    this.devSlot = el('div', { className: 'settings-dev-slot' });

    const panel = el('div', { className: 'panel settings-panel' }, [
      this.volumeRow(
        'Volume da Música',
        () => this.settings.musicVolume,
        (v) => {
          this.settings.musicVolume = v;
          audio.setMusicVolume(v);
        },
      ),
      this.volumeRow(
        'Volume dos Efeitos',
        () => this.settings.sfxVolume,
        (v) => {
          this.settings.sfxVolume = v;
          audio.setSfxVolume(v);
        },
      ),
      this.lowPowerRow(),
      el('div', {
        className: 'settings-hint',
        text: 'O Modo Economia reduz sombra, anti-serrilhado e resolução de brilho para telas mais fracas — o ajuste manual vale a partir do próximo carregamento do jogo.',
      }),
      this.devSlot,
    ]);

    const screen = el('div', { className: 'settings-screen screen' }, [
      el('div', { className: 'top-bar' }, [title]),
      panel,
      el('div', { className: 'bottom-bar' }, [backBtn]),
    ]);
    this.game.uiRoot.append(screen);
  }
}
