import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import type { Player } from '../entities/Player';
import { applySettings } from '../systems/applySettings';
import { audio } from '../systems/AudioSystem';
import {
  accessibilityOptionsOf,
  audioOptionsOf,
  cameraOptionsOf,
  gameplayOptionsOf,
  graphicsOptionsOf,
  interfaceOptionsOf,
  loadSettings,
  resetSettingsGroups,
  resolveGraphicsLevels,
  saveSettings,
  touchOptionsOf,
  UI_SCALE_OPTIONS,
  uiScaleOf,
  withGraphicsLevel,
  withGraphicsPreset,
  type AccessibilityOptions,
  type AudioOptions,
  type CameraOptions,
  type GameplayOptions,
  type GameSettings,
  type GraphicsLevels,
  type GraphicsPreset,
  type InterfaceOptions,
  type TouchOptions,
} from '../systems/GameSettings';
import {
  actionLabel,
  findKeyConflicts,
  KEY_ACTIONS,
  keyBindingOverrides,
  keyLabel,
  rebindKey,
  resolveKeyBindings,
  type KeyAction,
  type KeyActionDef,
} from '../systems/Keybindings';
import { el } from '../ui/dom';
import { addHotkeyHint, bindBackKey } from '../ui/menuKeys';
import { buildDevPanel } from './DevPanel';

type TabId = 'audio' | 'graficos' | 'camera' | 'interface' | 'jogabilidade' | 'controles' | 'acessibilidade';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'audio', label: 'Áudio' },
  { id: 'graficos', label: 'Gráficos' },
  { id: 'camera', label: 'Câmera' },
  { id: 'interface', label: 'Interface' },
  { id: 'jogabilidade', label: 'Jogabilidade' },
  { id: 'controles', label: 'Controles' },
  { id: 'acessibilidade', label: 'Acessibilidade' },
];

const ON_OFF = [
  { value: true, label: 'Ativado' },
  { value: false, label: 'Desativado' },
];

/** The tab last open this session — reopening Configurações lands where the player left off (not persisted: a fresh load starts on Áudio). */
let lastTab: TabId = 'audio';

/**
 * Configurações — a classic RPG options menu split into tabs (Áudio,
 * Gráficos, Câmera, Interface, Jogabilidade, Controles, Acessibilidade).
 *
 * Reachable from both the main menu (before any save is loaded — see
 * MainMenuScreen) and the pause overlay (mid-game — see
 * OverworldScreen.buildPauseOverlay), so it takes a plain `onBack` closure
 * instead of knowing about either caller's own navigation.
 *
 * Every change is saved (systems/GameSettings.ts) and pushed through
 * systems/applySettings.ts immediately — the same function main.ts runs at
 * startup — so what the player sees here is exactly what a reload gives
 * them. Options that only matter inside the 3D world (FOV, starting camera
 * rig, shadows, view distance) land when the overworld is rebuilt on the
 * way back; everything else applies on the spot.
 */
export class SettingsScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private settings: GameSettings;
  private titleTapCount = 0;
  private titleTapWindow = 0;
  private devPanelEl: HTMLElement | null = null;
  private tab: TabId = lastTab;
  private tabsEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  /** Key-remap capture in progress ("Pressione uma tecla…"). */
  private capturingAction: KeyAction | null = null;
  private keyNotice = '';
  private captureHandler: ((ev: KeyboardEvent) => void) | null = null;

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

  private unbindBackKey: (() => void) | null = null;

  unmount(): void {
    this.unbindBackKey?.();
    this.stopCapture();
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(): void {}

  /** Saves and applies — every control below ends in this. */
  private persist(): void {
    saveSettings(this.settings);
    applySettings(this.settings, this.game);
  }

  // --- generic rows ----------------------------------------------------------

  private volumeRow(label: string, get: () => number, set: (v: number) => void): HTMLElement {
    return this.sliderRow(label, 0, 100, 1, () => get() * 100, (v) => set(v / 100), (v) => `${Math.round(v)}%`);
  }

  /** A range slider row (same look/structure the volume sliders always had: label, input.settings-slider, .settings-slider-value). */
  private sliderRow(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, format: (v: number) => string, className = '', onCommit?: () => void): HTMLElement {
    const valueEl = el('div', { className: 'settings-slider-value', text: format(get()) });
    const slider = el('input', {
      className: 'settings-slider',
      attrs: { type: 'range', min: String(min), max: String(max), step: String(step), value: String(Math.round(get() / step) * step), 'aria-label': label },
    }) as HTMLInputElement;
    slider.addEventListener('input', () => {
      const v = Number(slider.value);
      set(v);
      valueEl.textContent = format(v);
      this.persist();
    });
    if (onCommit) slider.addEventListener('change', onCommit);
    return el('div', { className: `settings-row${className ? ` ${className}` : ''}` }, [el('div', { className: 'settings-label', text: label }), slider, valueEl]);
  }

  /** A segmented row — one button per option, the active one highlighted; re-renders itself in place on every change. `after` runs once the change is saved/applied (e.g. a whole-tab re-render). */
  private choiceRow<T>(label: string, options: Array<{ value: T; label: string }>, get: () => T, set: (v: T) => void, className = '', after?: () => void): HTMLElement {
    const container = el('div', { className: 'settings-segmented' });
    const render = () => {
      container.replaceChildren(
        ...options.map((opt) =>
          el('div', {
            className: `btn settings-segment${get() === opt.value ? ' active' : ''}`,
            text: opt.label,
            onClick: () => {
              set(opt.value);
              this.persist();
              render();
              after?.();
            },
          }),
        ),
      );
    };
    render();
    return el('div', { className: `settings-row${className ? ` ${className}` : ''}` }, [el('div', { className: 'settings-label', text: label }), container]);
  }

  private toggleRow(label: string, get: () => boolean, set: (v: boolean) => void, className = ''): HTMLElement {
    return this.choiceRow(label, ON_OFF, get, set, className);
  }

  private hint(text: string): HTMLElement {
    return el('div', { className: 'settings-hint', text });
  }

  private section(text: string): HTMLElement {
    return el('div', { className: 'settings-section', text });
  }

  private resetButton(label: string, reset: () => void): HTMLElement {
    return el('div', { className: 'settings-reset-row' }, [
      el('div', {
        className: 'btn small settings-reset',
        text: label,
        onClick: () => {
          reset();
          this.persist();
          this.renderTab();
        },
      }),
    ]);
  }

  // --- option-group patch helpers ---------------------------------------------

  private patchAudio(p: Partial<AudioOptions>): void {
    this.settings.audio = { ...audioOptionsOf(this.settings), ...p };
  }
  private patchCamera(p: Partial<CameraOptions>): void {
    this.settings.camera = { ...cameraOptionsOf(this.settings), ...p };
  }
  private patchInterface(p: Partial<InterfaceOptions>): void {
    this.settings.interface = { ...interfaceOptionsOf(this.settings), ...p };
  }
  private patchGameplay(p: Partial<GameplayOptions>): void {
    this.settings.gameplay = { ...gameplayOptionsOf(this.settings), ...p };
  }
  private patchTouch(p: Partial<TouchOptions>): void {
    this.settings.touch = { ...touchOptionsOf(this.settings), ...p };
  }
  private patchAccessibility(p: Partial<AccessibilityOptions>): void {
    this.settings.accessibility = { ...accessibilityOptionsOf(this.settings), ...p };
  }

  // --- tabs ----------------------------------------------------------------------

  private audioTab(): HTMLElement[] {
    return [
      this.volumeRow('Volume geral', () => audioOptionsOf(this.settings).masterVolume, (v) => this.patchAudio({ masterVolume: v })),
      this.volumeRow('Volume da Música', () => this.settings.musicVolume, (v) => (this.settings.musicVolume = v)),
      this.volumeRow('Volume dos Efeitos', () => this.settings.sfxVolume, (v) => (this.settings.sfxVolume = v)),
      this.volumeRow('Volume do Ambiente', () => this.settings.ambientVolume, (v) => (this.settings.ambientVolume = v)),
      this.toggleRow('Silenciar em segundo plano', () => audioOptionsOf(this.settings).muteInBackground, (v) => this.patchAudio({ muteInBackground: v }), 'settings-row-bg-mute'),
      this.hint('O volume geral multiplica música, efeitos e ambiente. "Silenciar em segundo plano" corta o som enquanto você está em outra aba ou aplicativo.'),
      this.resetButton('Restaurar padrão do áudio', () => {
        this.settings = resetSettingsGroups(this.settings, ['audio']);
        this.settings.musicVolume = 1;
        this.settings.sfxVolume = 1;
        this.settings.ambientVolume = 1;
      }),
    ];
  }

  private graphicsTab(): HTMLElement[] {
    const low = this.game.lowPowerTier;
    const g = () => graphicsOptionsOf(this.settings);
    const lv = () => resolveGraphicsLevels(g(), low);
    const setLevel = <K extends keyof GraphicsLevels>(key: K, value: GraphicsLevels[K]) => {
      this.settings.graphics = withGraphicsLevel(g(), key, value, low);
    };
    const rerender = () => this.renderTab();
    const presets: Array<{ value: GraphicsPreset; label: string }> = [
      { value: 'auto', label: 'Automático' },
      { value: 'baixo', label: 'Baixo' },
      { value: 'medio', label: 'Médio' },
      { value: 'alto', label: 'Alto' },
      { value: 'ultra', label: 'Ultra' },
      { value: 'personalizado', label: 'Personalizado' },
    ];
    return [
      this.choiceRow('Qualidade gráfica', presets, () => g().preset, (v) => (this.settings.graphics = withGraphicsPreset(g(), v, low)), 'settings-row-gfx-preset', rerender),
      this.choiceRow(
        'Sombras',
        [
          { value: 'off' as const, label: 'Desligadas' },
          { value: 'baixa' as const, label: 'Baixa' },
          { value: 'alta' as const, label: 'Alta' },
        ],
        () => lv().shadows,
        (v) => setLevel('shadows', v),
        'settings-row-shadows',
        rerender,
      ),
      this.sliderRow('Escala de renderização', 50, 100, 5, () => lv().renderScale * 100, (v) => setLevel('renderScale', v / 100), (v) => `${Math.round(v)}%`, 'settings-row-render-scale', rerender),
      this.choiceRow(
        'Limite de FPS',
        [
          { value: 30 as const, label: '30' },
          { value: 60 as const, label: '60' },
          { value: 0 as const, label: 'Sem limite' },
        ],
        () => lv().fpsCap,
        (v) => setLevel('fpsCap', v),
        'settings-row-fps-cap',
        rerender,
      ),
      this.choiceRow(
        'Distância de visão',
        [
          { value: 'curta' as const, label: 'Curta' },
          { value: 'media' as const, label: 'Média' },
          { value: 'longa' as const, label: 'Longa' },
        ],
        () => lv().viewDistance,
        (v) => setLevel('viewDistance', v),
        'settings-row-view-distance',
        rerender,
      ),
      this.choiceRow(
        'Partículas e efeitos',
        [
          { value: 'baixo' as const, label: 'Baixo' },
          { value: 'alto' as const, label: 'Alto' },
        ],
        () => lv().effects,
        (v) => setLevel('effects', v),
        'settings-row-effects',
        rerender,
      ),
      this.toggleRow('Mostrar FPS', () => g().showFps, (v) => (this.settings.graphics = { ...g(), showFps: v }), 'settings-row-show-fps'),
      this.lowPowerRow(),
      this.hint(
        'Automático usa o perfil do aparelho (o mesmo de sempre). Escala de renderização, limite de FPS e o contador valem na hora; sombras e distância de visão, ao voltar ao mundo. O Modo Economia reduz sombra, anti-serrilhado e brilho para telas mais fracas e vale a partir do próximo carregamento do jogo.',
      ),
      this.resetButton('Restaurar padrão dos gráficos', () => {
        this.settings = resetSettingsGroups(this.settings, ['graphics']);
        this.settings.lowPowerOverride = null;
      }),
    ];
  }

  /** The 3-way "Automático / Ativado / Desativado" control for lowPowerOverride. */
  private lowPowerRow(): HTMLElement {
    return this.choiceRow(
      'Modo Economia (gráficos)',
      [
        { value: null as boolean | null, label: 'Automático' },
        { value: true as boolean | null, label: 'Ativado' },
        { value: false as boolean | null, label: 'Desativado' },
      ],
      () => this.settings.lowPowerOverride,
      (v) => (this.settings.lowPowerOverride = v),
      'settings-row-low-power',
    );
  }

  private cameraTab(): HTMLElement[] {
    const c = () => cameraOptionsOf(this.settings);
    return [
      this.sliderRow('Campo de visão (FOV)', 45, 90, 1, () => c().fov, (v) => this.patchCamera({ fov: v }), (v) => `${Math.round(v)}°`, 'settings-row-fov'),
      this.choiceRow(
        'Distância padrão',
        [
          { value: 0 as const, label: 'Padrão' },
          { value: 1 as const, label: 'Próxima' },
          { value: 2 as const, label: 'Panorâmica' },
        ],
        () => c().defaultView,
        (v) => this.patchCamera({ defaultView: v }),
        'settings-row-camera-view',
      ),
      this.sliderRow('Velocidade de giro', 25, 200, 5, () => c().rotateSensitivity * 100, (v) => this.patchCamera({ rotateSensitivity: v / 100 }), (v) => `${Math.round(v)}%`, 'settings-row-rotate-speed'),
      this.toggleRow('Inverter giro horizontal', () => c().invertRotation, (v) => this.patchCamera({ invertRotation: v }), 'settings-row-invert'),
      this.toggleRow('Suavização da câmera', () => c().smoothing, (v) => this.patchCamera({ smoothing: v }), 'settings-row-smoothing'),
      this.choiceRow(
        'Tremor de tela',
        [
          { value: 0, label: 'Desligado' },
          { value: 0.5, label: 'Suave' },
          { value: 1, label: 'Normal' },
        ],
        () => this.settings.screenShake,
        (v) => (this.settings.screenShake = v),
        'settings-row-shake',
      ),
      this.hint(
        `Gire a câmera com ${keyLabel(resolveKeyBindings(this.settings.keybindings).cameraLeft)}/${keyLabel(resolveKeyBindings(this.settings.keybindings).cameraRight)} ou arrastando com o botão direito do mouse; ${keyLabel(resolveKeyBindings(this.settings.keybindings).cameraReset)} volta ao ângulo padrão. O botão do olho continua alternando Padrão/Próxima/Panorâmica durante o jogo.`,
      ),
      this.resetButton('Restaurar padrão da câmera', () => {
        this.settings = resetSettingsGroups(this.settings, ['camera']);
        this.settings.screenShake = 1;
      }),
    ];
  }

  private interfaceTab(): HTMLElement[] {
    const i = () => interfaceOptionsOf(this.settings);
    return [
      this.toggleRow('Mostrar minimapa', () => i().minimap, (v) => this.patchInterface({ minimap: v }), 'settings-row-minimap'),
      this.toggleRow('Rastreador de missões', () => i().questTracker, (v) => this.patchInterface({ questTracker: v }), 'settings-row-quest-tracker'),
      this.toggleRow('Nomes sobre NPCs e inimigos', () => i().nameplates, (v) => this.patchInterface({ nameplates: v }), 'settings-row-nameplates'),
      this.toggleRow('Barras de vida dos inimigos', () => i().enemyHealthBars, (v) => this.patchInterface({ enemyHealthBars: v }), 'settings-row-enemy-bars'),
      this.toggleRow('Números de dano', () => this.settings.damageNumbers, (v) => (this.settings.damageNumbers = v), 'settings-row-damage-numbers'),
      this.toggleRow('Dicas de teclas', () => i().keyHints, (v) => this.patchInterface({ keyHints: v }), 'settings-row-key-hints'),
      this.toggleRow('Relógio do jogo', () => i().clock, (v) => this.patchInterface({ clock: v }), 'settings-row-clock'),
      this.sliderRow('Opacidade do HUD', 30, 100, 5, () => i().hudOpacity * 100, (v) => this.patchInterface({ hudOpacity: v / 100 }), (v) => `${Math.round(v)}%`, 'settings-row-hud-opacity'),
      this.resetButton('Restaurar padrão da interface', () => {
        this.settings = resetSettingsGroups(this.settings, ['interface']);
        this.settings.damageNumbers = true;
      }),
    ];
  }

  private gameplayTab(): HTMLElement[] {
    const gp = () => gameplayOptionsOf(this.settings);
    return [
      this.choiceRow(
        'Saque automático',
        [
          { value: 'tudo' as const, label: 'Coletar tudo' },
          { value: 'desmontar-comuns' as const, label: 'Desmontar comuns' },
        ],
        () => gp().lootPickup,
        (v) => this.patchGameplay({ lootPickup: v }),
        'settings-row-loot',
      ),
      this.toggleRow('Confirmar venda/desmonte de itens raros', () => gp().confirmRare, (v) => this.patchGameplay({ confirmRare: v }), 'settings-row-confirm-rare'),
      this.toggleRow('Alvo automático', () => gp().autoTarget, (v) => this.patchGameplay({ autoTarget: v }), 'settings-row-auto-target'),
      this.toggleRow('Pausar ao sair da janela', () => gp().pauseOnFocusLoss, (v) => this.patchGameplay({ pauseOnFocusLoss: v }), 'settings-row-focus-pause'),
      this.choiceRow(
        'Velocidade do texto',
        [
          { value: 'instantaneo' as const, label: 'Instantâneo' },
          { value: 'rapido' as const, label: 'Rápido' },
          { value: 'normal' as const, label: 'Normal' },
          { value: 'lento' as const, label: 'Lento' },
        ],
        () => gp().textSpeed,
        (v) => this.patchGameplay({ textSpeed: v }),
        'settings-row-text-speed',
      ),
      this.choiceRow(
        'Salvamento automático',
        [
          { value: 0 as const, label: 'Só nos eventos' },
          { value: 1 as const, label: '1 min' },
          { value: 2 as const, label: '2 min' },
          { value: 5 as const, label: '5 min' },
          { value: 10 as const, label: '10 min' },
        ],
        () => gp().autosaveMinutes,
        (v) => this.patchGameplay({ autosaveMinutes: v }),
        'settings-row-autosave',
      ),
      this.toggleRow('Mostrar tutoriais', () => gp().tutorials, (v) => this.patchGameplay({ tutorials: v }), 'settings-row-tutorials'),
      this.hint(
        '"Desmontar comuns" transforma saques Comuns das lutas direto em materiais. Alvo automático escolhe o inimigo mais próximo para habilidades de alvo único. Os menus sempre pausam o jogo; "Pausar ao sair da janela" também pausa quando você troca de aba ou de aplicativo. O jogo sempre salva ao trocar de zona, lutar, comprar e pausar — o intervalo acrescenta salvamentos periódicos.',
      ),
      this.resetButton('Restaurar padrão da jogabilidade', () => {
        this.settings = resetSettingsGroups(this.settings, ['gameplay']);
      }),
    ];
  }

  // --- Controles -------------------------------------------------------------

  private stopCapture(): void {
    if (this.captureHandler) window.removeEventListener('keydown', this.captureHandler, true);
    this.captureHandler = null;
    this.capturingAction = null;
  }

  private startCapture(action: KeyAction): void {
    this.stopCapture();
    this.capturingAction = action;
    this.keyNotice = '';
    // Capture phase on window + stopPropagation: the key never reaches the
    // menu's own Escape-to-go-back (ui/menuKeys.ts) or anything else.
    this.captureHandler = (ev: KeyboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.repeat) return;
      // Esc cancels — except on "Pausar", where it means "back to Esc".
      if (ev.key === 'Escape' && action !== 'pause') {
        this.stopCapture();
        this.renderTab();
        return;
      }
      const result = rebindKey(resolveKeyBindings(this.settings.keybindings), action, ev.key);
      if (result.ok) {
        this.settings.keybindings = keyBindingOverrides(result.bindings);
        this.keyNotice = result.swappedWith
          ? `${keyLabel(result.bindings[action])} já era de "${actionLabel(result.swappedWith)}" — as duas ações trocaram de tecla.`
          : '';
        this.persist();
      } else {
        this.keyNotice = result.reason ?? 'Tecla inválida.';
      }
      this.stopCapture();
      this.renderTab();
    };
    window.addEventListener('keydown', this.captureHandler, true);
    this.renderTab();
  }

  private keyRow(def: KeyActionDef, key: string, conflicted: boolean): HTMLElement {
    const capturing = this.capturingAction === def.id;
    return el('div', { className: `settings-row settings-key-row${conflicted ? ' conflict' : ''}`, attrs: { 'data-action': def.id } }, [
      el('div', { className: 'settings-label', text: def.label }),
      el('div', {
        className: `btn small settings-keycap${capturing ? ' active' : ''}`,
        text: capturing ? 'Pressione uma tecla…' : keyLabel(key),
        attrs: { 'aria-label': `Alterar tecla de ${def.label}` },
        onClick: () => (capturing ? (this.stopCapture(), this.renderTab()) : this.startCapture(def.id)),
      }),
    ]);
  }

  private controlsTab(): HTMLElement[] {
    const bindings = resolveKeyBindings(this.settings.keybindings);
    const conflicts = findKeyConflicts(bindings);
    const conflicted = new Set(conflicts.flatMap((c) => c.actions));
    const rows: HTMLElement[] = [this.section('Teclado (computador)')];
    let group = '';
    for (const def of KEY_ACTIONS) {
      if (def.group !== group) {
        group = def.group;
        rows.push(el('div', { className: 'settings-subsection', text: group }));
      }
      rows.push(this.keyRow(def, bindings[def.id], conflicted.has(def.id)));
    }
    if (conflicts.length > 0) {
      rows.push(
        el('div', {
          className: 'settings-hint settings-key-conflict',
          text: `Conflito: ${conflicts.map((c) => `${keyLabel(c.key)} → ${c.actions.map(actionLabel).join(' / ')}`).join('; ')}.`,
        }),
      );
    }
    if (this.keyNotice) rows.push(el('div', { className: 'settings-hint settings-key-notice', text: this.keyNotice }));
    rows.push(
      this.hint('Clique numa ação e pressione a nova tecla (Esc cancela). Se a tecla já for de outra ação, as duas trocam. As setas sempre andam e Esc sempre abre o menu.'),
      this.resetButton('Restaurar teclas padrão', () => {
        this.settings = resetSettingsGroups(this.settings, ['keybindings']);
        this.keyNotice = '';
      }),
    );

    const t = () => touchOptionsOf(this.settings);
    rows.push(
      this.section('Toque (celular/tablet)'),
      this.sliderRow('Tamanho do joystick', 70, 150, 5, () => t().joystickSize * 100, (v) => this.patchTouch({ joystickSize: v / 100 }), (v) => `${Math.round(v)}%`, 'settings-row-joystick-size'),
      this.sliderRow('Opacidade do joystick', 30, 100, 5, () => t().joystickOpacity * 100, (v) => this.patchTouch({ joystickOpacity: v / 100 }), (v) => `${Math.round(v)}%`, 'settings-row-joystick-opacity'),
      this.choiceRow(
        'Lado do joystick',
        [
          { value: 'esquerda' as const, label: 'Esquerda' },
          { value: 'direita' as const, label: 'Direita' },
        ],
        () => t().joystickSide,
        (v) => this.patchTouch({ joystickSide: v }),
        'settings-row-joystick-side',
      ),
      this.hint('Com o joystick à direita, a barra de itens de combate passa para a esquerda.'),
      this.resetButton('Restaurar padrão do toque', () => {
        this.settings = resetSettingsGroups(this.settings, ['touch']);
      }),
    );
    return rows;
  }

  private accessibilityTab(): HTMLElement[] {
    const a = () => accessibilityOptionsOf(this.settings);
    return [
      this.choiceRow(
        'Modo para daltonismo',
        [
          { value: 'nenhum' as const, label: 'Desligado' },
          { value: 'protanopia' as const, label: 'Protanopia' },
          { value: 'deuteranopia' as const, label: 'Deuteranopia' },
          { value: 'tritanopia' as const, label: 'Tritanopia' },
        ],
        () => a().colorblind,
        (v) => this.patchAccessibility({ colorblind: v }),
        'settings-row-colorblind',
      ),
      this.toggleRow('Alto contraste', () => a().highContrast, (v) => this.patchAccessibility({ highContrast: v }), 'settings-row-high-contrast'),
      this.uiScaleRow(),
      this.toggleRow('Reduzir movimento', () => this.settings.reduceMotion, (v) => (this.settings.reduceMotion = v), 'settings-row-reduce-motion'),
      this.toggleRow('Legendas de efeitos sonoros', () => a().soundCaptions, (v) => this.patchAccessibility({ soundCaptions: v }), 'settings-row-captions'),
      this.hint(
        'O modo para daltonismo corrige as cores da interface (vida/mana, raridade dos itens, marcadores) para separar melhor os tons difíceis de distinguir. Tamanho da interface aumenta textos e botões. Reduzir movimento desliga o tremor de tela, as pausas de impacto e o afastamento da câmera em combate.',
      ),
      this.resetButton('Restaurar padrão de acessibilidade', () => {
        this.settings = resetSettingsGroups(this.settings, ['accessibility']);
        delete this.settings.uiScale;
        this.settings.reduceMotion = false;
      }),
    ];
  }

  /** "Tamanho da interface" — Pequeno/Médio/Grande, applied live so the player sees this very screen resize as they pick. */
  private uiScaleRow(): HTMLElement {
    const container = el('div', { className: 'settings-segmented' });
    const render = () => {
      const current = uiScaleOf(this.settings);
      container.replaceChildren(
        ...UI_SCALE_OPTIONS.map((opt) =>
          el('div', {
            className: `btn settings-segment${current === opt.value ? ' active' : ''}`,
            text: opt.label,
            attrs: { 'data-ui-scale': opt.value },
            onClick: () => {
              this.settings.uiScale = opt.value;
              this.persist();
              render();
            },
          }),
        ),
      );
    };
    render();
    return el('div', { className: 'settings-row settings-ui-scale' }, [el('div', { className: 'settings-label', text: 'Tamanho da interface' }), container]);
  }

  private tabRows(tab: TabId): HTMLElement[] {
    switch (tab) {
      case 'audio':
        return this.audioTab();
      case 'graficos':
        return this.graphicsTab();
      case 'camera':
        return this.cameraTab();
      case 'interface':
        return this.interfaceTab();
      case 'jogabilidade':
        return this.gameplayTab();
      case 'controles':
        return this.controlsTab();
      case 'acessibilidade':
        return this.accessibilityTab();
    }
  }

  private selectTab(tab: TabId): void {
    if (tab !== this.tab) {
      this.stopCapture();
      this.keyNotice = '';
    }
    this.tab = tab;
    lastTab = tab;
    this.renderTab();
    this.contentEl?.parentElement?.scrollTo?.({ top: 0 });
  }

  private renderTab(): void {
    if (!this.tabsEl || !this.contentEl) return;
    this.tabsEl.replaceChildren(
      ...TABS.map((t) =>
        el('div', {
          className: `btn settings-tab${t.id === this.tab ? ' active' : ''}`,
          text: t.label,
          attrs: { role: 'tab', 'aria-selected': String(t.id === this.tab), 'data-tab': t.id },
          onClick: () => this.selectTab(t.id),
        }),
      ),
    );
    this.contentEl.replaceChildren(...this.tabRows(this.tab));
    this.contentEl.dataset.tab = this.tab;
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
    addHotkeyHint(backBtn, 'Esc');
    this.unbindBackKey = bindBackKey(backBtn);

    const title = el('h1', { text: 'Configurações', onClick: () => this.onTitleTap() });
    title.style.cursor = 'default';
    title.style.userSelect = 'none';
    // #ui-root defaults every child to pointer-events: none (see
    // MainMenuScreen's own title-logo for the same fix) — without this the
    // canvas underneath swallows every click and the 7-tap gesture below
    // never fires.
    title.style.pointerEvents = 'auto';

    this.devSlot = el('div', { className: 'settings-dev-slot' });
    this.tabsEl = el('div', { className: 'settings-tabs', attrs: { role: 'tablist' } });
    this.contentEl = el('div', { className: 'settings-tab-content', attrs: { role: 'tabpanel' } });

    const panel = el('div', { className: 'panel settings-panel' }, [this.contentEl, this.devSlot]);

    const screen = el('div', { className: 'settings-screen screen' }, [
      el('div', { className: 'top-bar' }, [title]),
      this.tabsEl,
      panel,
      el('div', { className: 'bottom-bar' }, [backBtn]),
    ]);
    this.game.uiRoot.append(screen);
    this.renderTab();
  }
}
