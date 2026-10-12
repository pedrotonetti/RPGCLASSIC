/**
 * Device-wide preferences — separate from `Player`'s own save data (these
 * apply across every character/slot on this device, not to one hero).
 * Pure data + pure load/save functions, same shape as every other systems
 * module here; the actual audio/render-quality effects live where those
 * systems already are (AudioSystem.setMusicVolume/setSfxVolume, Game's
 * lowPowerTier) — this module is only the persisted source of truth they
 * read from and write back to.
 */

export interface GameSettings {
  /** 0..1 — see AudioSystem.setMusicVolume. */
  musicVolume: number;
  /** 0..1 — see AudioSystem.setSfxVolume. */
  sfxVolume: number;
  /**
   * null = auto-detect (Game's own isTouchDevice() check, unchanged from
   * before this setting existed) — true/false forces the low-power render
   * tier on/off regardless of device. Applied at the next full page load
   * (Game's constructor reads it once) rather than live, since some of what
   * it drives (antialiasing, pixel ratio) is only ever set up once, when the
   * WebGLRenderer itself is constructed.
   */
  lowPowerOverride: boolean | null;
  /** 0..1 — Fase 7's procedural ambient beds (wind, birds, crickets, cave drips...); see AudioSystem.setAmbientVolume. */
  ambientVolume: number;
  /** 0 = off, 0.5 = suave, 1 = normal — camera shake strength on heavy hits; see systems/combatFeel.ts. */
  screenShake: number;
  /** Floating damage/heal numbers over enemies in combat. */
  damageNumbers: boolean;
  /** Accessibility: disables camera shake, hit-stop freeze frames and the combat zoom-out regardless of `screenShake`. */
  reduceMotion: boolean;
  /**
   * "Tamanho da interface" — scales HUD and menu text/controls (see
   * ui/uiScale.ts). Optional (absent = 'medio') so settings blobs saved
   * before it existed, and every other settings field added alongside it,
   * keep loading unchanged; read it through `uiScaleOf`.
   */
  uiScale?: UiScale;
  /** Small-screen HUD: quest tracker collapsed to a single tappable line. Optional (absent = expanded). */
  questTrackerCollapsed?: boolean;
  /*
   * The full options menu (Áudio/Gráficos/Câmera/Interface/Jogabilidade/
   * Controles/Acessibilidade tabs — see screens/SettingsScreen.ts). Every
   * group is an OPTIONAL nested object, same reasoning as uiScale above: a
   * blob saved before these existed (or one missing a single field, or
   * holding a hand-edited bad value) still loads, and every reader goes
   * through the matching `xxxOptionsOf(settings)` accessor below, which
   * fills defaults and sanitizes field by field.
   */
  audio?: Partial<AudioOptions>;
  graphics?: Partial<GraphicsOptions>;
  camera?: Partial<CameraOptions>;
  interface?: Partial<InterfaceOptions>;
  gameplay?: Partial<GameplayOptions>;
  touch?: Partial<TouchOptions>;
  accessibility?: Partial<AccessibilityOptions>;
  /** Desktop key remaps — only the actions the player changed (action id → normalized key); see systems/Keybindings.ts. */
  keybindings?: Record<string, string>;
}

export type UiScale = 'pequeno' | 'medio' | 'grande';

export const UI_SCALE_OPTIONS: Array<{ value: UiScale; label: string; factor: number }> = [
  { value: 'pequeno', label: 'Pequeno', factor: 0.9 },
  { value: 'medio', label: 'Médio', factor: 1 },
  { value: 'grande', label: 'Grande', factor: 1.15 },
];

/** The stored scale, falling back to 'medio' when absent or unrecognized (e.g. a hand-edited/corrupted value). */
export function uiScaleOf(settings: GameSettings): UiScale {
  const found = UI_SCALE_OPTIONS.find((o) => o.value === settings.uiScale);
  return found ? found.value : 'medio';
}

/** Multiplier applied to the UI for a given scale setting. */
export function uiScaleFactor(scale: UiScale): number {
  return UI_SCALE_OPTIONS.find((o) => o.value === scale)?.factor ?? 1;
}

const SETTINGS_KEY = 'rpgclassic:settings:v1';
/** The old music-only on/off toggle this setting screen replaces — see loadSettings' own migration. */
const LEGACY_MUSIC_KEY = 'rpgclassic:musicOn';

function defaultSettings(): GameSettings {
  return { musicVolume: 1, sfxVolume: 1, lowPowerOverride: null, ...defaultFeelSettings() };
}

/** Fase 7's additions, split out so their defaults (and sanitizing, below) live in one place. */
function defaultFeelSettings(): Pick<GameSettings, 'ambientVolume' | 'screenShake' | 'damageNumbers' | 'reduceMotion'> {
  return { ambientVolume: 1, screenShake: 1, damageNumbers: true, reduceMotion: false };
}

/** A hand-edited or partially-written blob shouldn't be able to put a string where a number goes — any Fase 7 field of the wrong type falls back to its default. */
function sanitizeFeelSettings(settings: GameSettings): GameSettings {
  const d = defaultFeelSettings();
  const unit = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback);
  settings.ambientVolume = unit(settings.ambientVolume, d.ambientVolume);
  settings.screenShake = unit(settings.screenShake, d.screenShake);
  if (typeof settings.damageNumbers !== 'boolean') settings.damageNumbers = d.damageNumbers;
  if (typeof settings.reduceMotion !== 'boolean') settings.reduceMotion = d.reduceMotion;
  return settings;
}

export function loadSettings(): GameSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      return sanitizeFeelSettings({ ...defaultSettings(), ...parsed });
    } catch {
      return defaultSettings();
    }
  }
  // No settings blob yet — migrate the old on/off-only music toggle, if
  // present, so an existing player's "I turned music off" preference isn't
  // silently reset back to full volume the first time this loads.
  const settings = defaultSettings();
  if (localStorage.getItem(LEGACY_MUSIC_KEY) === 'off') settings.musicVolume = 0;
  return settings;
}

export function saveSettings(settings: GameSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

// ---------------------------------------------------------------------------
// Full options menu — option groups, defaults and per-field sanitizing.
// ---------------------------------------------------------------------------

/** Field-level sanitizers shared by every group below. */
function pickNumber(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
}
function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}
function pickEnum<T extends string | number>(v: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(v as T) ? (v as T) : fallback;
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

// --- Áudio ----------------------------------------------------------------

export interface AudioOptions {
  /** 0..1 — multiplies music, effects and ambient together ("Volume geral"). */
  masterVolume: number;
  /** Silences everything while the tab/app is in the background. */
  muteInBackground: boolean;
}

export const DEFAULT_AUDIO_OPTIONS: AudioOptions = { masterVolume: 1, muteInBackground: false };

export function audioOptionsOf(settings: GameSettings): AudioOptions {
  const raw = asRecord(settings.audio);
  const d = DEFAULT_AUDIO_OPTIONS;
  return { masterVolume: pickNumber(raw.masterVolume, d.masterVolume, 0, 1), muteInBackground: pickBool(raw.muteInBackground, d.muteInBackground) };
}

/** What each bus is actually set to: its own slider × the master slider, or silence while backgrounded (when that option is on). */
export function effectiveVolumes(settings: GameSettings, backgrounded = false): { music: number; sfx: number; ambient: number } {
  const a = audioOptionsOf(settings);
  const k = backgrounded && a.muteInBackground ? 0 : a.masterVolume;
  return { music: settings.musicVolume * k, sfx: settings.sfxVolume * k, ambient: settings.ambientVolume * k };
}

// --- Gráficos -------------------------------------------------------------

export type ShadowQuality = 'off' | 'baixa' | 'alta';
export type ViewDistance = 'curta' | 'media' | 'longa';
export type EffectsQuality = 'baixo' | 'alto';
/** 0 = sem limite. */
export type FpsCap = 0 | 30 | 60;
export type GraphicsPreset = 'auto' | 'baixo' | 'medio' | 'alto' | 'ultra' | 'personalizado';

/** The individual knobs a preset sets — everything in GraphicsOptions except the preset itself and the FPS counter. */
export interface GraphicsLevels {
  shadows: ShadowQuality;
  /** 0.5..1 — multiplier on the device pixel ratio the renderer draws at. */
  renderScale: number;
  fpsCap: FpsCap;
  viewDistance: ViewDistance;
  effects: EffectsQuality;
}

export interface GraphicsOptions extends GraphicsLevels {
  /** 'auto' = the device-based tier the game always used (see Game.lowPowerTier); 'personalizado' = the player edited a field by hand. */
  preset: GraphicsPreset;
  /** Small FPS counter overlay in a corner. */
  showFps: boolean;
}

export const SHADOW_QUALITIES: readonly ShadowQuality[] = ['off', 'baixa', 'alta'];
export const VIEW_DISTANCES: readonly ViewDistance[] = ['curta', 'media', 'longa'];
export const EFFECTS_QUALITIES: readonly EffectsQuality[] = ['baixo', 'alto'];
export const FPS_CAPS: readonly FpsCap[] = [30, 60, 0];
export const GRAPHICS_PRESETS: readonly GraphicsPreset[] = ['auto', 'baixo', 'medio', 'alto', 'ultra', 'personalizado'];

/** The fixed presets' values. 'auto' resolves per device (see resolveGraphicsLevels); 'personalizado' has no table entry — it's whatever the fields hold. */
export const GRAPHICS_PRESET_LEVELS: Record<'baixo' | 'medio' | 'alto' | 'ultra', GraphicsLevels> = {
  baixo: { shadows: 'off', renderScale: 0.6, fpsCap: 30, viewDistance: 'curta', effects: 'baixo' },
  medio: { shadows: 'baixa', renderScale: 0.85, fpsCap: 60, viewDistance: 'media', effects: 'baixo' },
  alto: { shadows: 'alta', renderScale: 1, fpsCap: 0, viewDistance: 'media', effects: 'alto' },
  ultra: { shadows: 'alta', renderScale: 1, fpsCap: 0, viewDistance: 'longa', effects: 'alto' },
};

/** Exactly what the game rendered before these options existed: full detail on desktop, the 1024px shadow map on the low-power (phone/tablet) tier. */
export function autoGraphicsLevels(lowPowerTier: boolean): GraphicsLevels {
  return { shadows: lowPowerTier ? 'baixa' : 'alta', renderScale: 1, fpsCap: 0, viewDistance: 'media', effects: 'alto' };
}

export const DEFAULT_GRAPHICS_OPTIONS: GraphicsOptions = { preset: 'auto', ...autoGraphicsLevels(false), showFps: false };

export function graphicsOptionsOf(settings: GameSettings): GraphicsOptions {
  const raw = asRecord(settings.graphics);
  const d = DEFAULT_GRAPHICS_OPTIONS;
  return {
    preset: pickEnum(raw.preset, GRAPHICS_PRESETS, d.preset),
    shadows: pickEnum(raw.shadows, SHADOW_QUALITIES, d.shadows),
    renderScale: pickNumber(raw.renderScale, d.renderScale, 0.5, 1),
    fpsCap: pickEnum(raw.fpsCap, FPS_CAPS, d.fpsCap),
    viewDistance: pickEnum(raw.viewDistance, VIEW_DISTANCES, d.viewDistance),
    effects: pickEnum(raw.effects, EFFECTS_QUALITIES, d.effects),
    showFps: pickBool(raw.showFps, d.showFps),
  };
}

/** The levels actually rendered with: the preset's table entry, the device tier for 'auto', or the hand-set fields for 'personalizado'. */
export function resolveGraphicsLevels(g: GraphicsOptions, lowPowerTier: boolean): GraphicsLevels {
  if (g.preset === 'auto') return autoGraphicsLevels(lowPowerTier);
  if (g.preset === 'personalizado') return { shadows: g.shadows, renderScale: g.renderScale, fpsCap: g.fpsCap, viewDistance: g.viewDistance, effects: g.effects };
  return { ...GRAPHICS_PRESET_LEVELS[g.preset] };
}

/** Picking a preset copies its values into the individual fields (so a later hand edit starts from them). Picking Personalizado keeps whatever is currently rendered. */
export function withGraphicsPreset(g: GraphicsOptions, preset: GraphicsPreset, lowPowerTier: boolean): GraphicsOptions {
  const levels = preset === 'personalizado' ? resolveGraphicsLevels(g, lowPowerTier) : resolveGraphicsLevels({ ...g, preset }, lowPowerTier);
  return { ...g, ...levels, preset };
}

/** Editing one field by hand: starts from what's currently rendered, applies the change, and names the result — a fixed preset if it happens to match one exactly, otherwise Personalizado. */
export function withGraphicsLevel<K extends keyof GraphicsLevels>(g: GraphicsOptions, key: K, value: GraphicsLevels[K], lowPowerTier: boolean): GraphicsOptions {
  const levels: GraphicsLevels = { ...resolveGraphicsLevels(g, lowPowerTier), [key]: value };
  return { ...g, ...levels, preset: matchGraphicsPreset(levels) };
}

export function matchGraphicsPreset(levels: GraphicsLevels): GraphicsPreset {
  for (const name of ['baixo', 'medio', 'alto', 'ultra'] as const) {
    const p = GRAPHICS_PRESET_LEVELS[name];
    if (p.shadows === levels.shadows && p.renderScale === levels.renderScale && p.fpsCap === levels.fpsCap && p.viewDistance === levels.viewDistance && p.effects === levels.effects) return name;
  }
  return 'personalizado';
}

// --- Câmera ---------------------------------------------------------------

export type CameraView = 0 | 1 | 2;

export interface CameraOptions {
  /** Vertical field of view in degrees (the overworld always used 60). */
  fov: number;
  /** Which camera rig the overworld starts on: 0 Padrão, 1 Próxima, 2 Panorâmica (the eye button still cycles them). */
  defaultView: CameraView;
  /** 0.25..2 — multiplier on how fast the camera orbits (rotate keys / right-mouse drag). */
  rotateSensitivity: number;
  /** Flips the orbit direction for both keys and mouse drag. */
  invertRotation: boolean;
  /** Eased camera follow/zoom/orbit; off = the camera snaps straight onto its target every frame. */
  smoothing: boolean;
}

export const CAMERA_VIEWS: readonly CameraView[] = [0, 1, 2];
export const DEFAULT_CAMERA_OPTIONS: CameraOptions = { fov: 60, defaultView: 0, rotateSensitivity: 1, invertRotation: false, smoothing: true };

export function cameraOptionsOf(settings: GameSettings): CameraOptions {
  const raw = asRecord(settings.camera);
  const d = DEFAULT_CAMERA_OPTIONS;
  return {
    fov: Math.round(pickNumber(raw.fov, d.fov, 45, 90)),
    defaultView: pickEnum(raw.defaultView, CAMERA_VIEWS, d.defaultView),
    rotateSensitivity: pickNumber(raw.rotateSensitivity, d.rotateSensitivity, 0.25, 2),
    invertRotation: pickBool(raw.invertRotation, d.invertRotation),
    smoothing: pickBool(raw.smoothing, d.smoothing),
  };
}

// --- Interface ------------------------------------------------------------

export interface InterfaceOptions {
  minimap: boolean;
  questTracker: boolean;
  /** Names over NPCs, enemies and dungeon portals. */
  nameplates: boolean;
  enemyHealthBars: boolean;
  /** Keyboard hint line in the HUD and the little keycap badges on buttons. */
  keyHints: boolean;
  /** The in-game time of day under the HP/MP panel. */
  clock: boolean;
  /** 0.3..1 — opacity of the always-on HUD pieces. */
  hudOpacity: number;
}

export const DEFAULT_INTERFACE_OPTIONS: InterfaceOptions = { minimap: true, questTracker: true, nameplates: true, enemyHealthBars: true, keyHints: true, clock: true, hudOpacity: 1 };

export function interfaceOptionsOf(settings: GameSettings): InterfaceOptions {
  const raw = asRecord(settings.interface);
  const d = DEFAULT_INTERFACE_OPTIONS;
  return {
    minimap: pickBool(raw.minimap, d.minimap),
    questTracker: pickBool(raw.questTracker, d.questTracker),
    nameplates: pickBool(raw.nameplates, d.nameplates),
    enemyHealthBars: pickBool(raw.enemyHealthBars, d.enemyHealthBars),
    keyHints: pickBool(raw.keyHints, d.keyHints),
    clock: pickBool(raw.clock, d.clock),
    hudOpacity: pickNumber(raw.hudOpacity, d.hudOpacity, 0.3, 1),
  };
}

// --- Jogabilidade ---------------------------------------------------------

export type LootPickup = 'tudo' | 'desmontar-comuns';
export type TextSpeed = 'instantaneo' | 'rapido' | 'normal' | 'lento';
/** Minutes between periodic saves; 0 = only the game's usual event saves (zone change, combat, shop, pause...). */
export type AutosaveMinutes = 0 | 1 | 2 | 5 | 10;

export interface GameplayOptions {
  /** 'desmontar-comuns' turns Comum drops from fights straight into materials instead of filling the bag. */
  lootPickup: LootPickup;
  /** Ask before selling or salvaging a Raro-or-better (or upgraded/enchanted) item. */
  confirmRare: boolean;
  /** A single-target skill with several enemies engaged hits the nearest one instead of asking for a click. */
  autoTarget: boolean;
  /** Opens the pause menu when the window/app loses focus (menus themselves always pause). */
  pauseOnFocusLoss: boolean;
  /** Typewriter speed for NPC dialogue. */
  textSpeed: TextSpeed;
  autosaveMinutes: AutosaveMinutes;
  /** The first-time "how to play" overlay. */
  tutorials: boolean;
}

export const LOOT_PICKUPS: readonly LootPickup[] = ['tudo', 'desmontar-comuns'];
export const TEXT_SPEEDS: readonly TextSpeed[] = ['instantaneo', 'rapido', 'normal', 'lento'];
export const AUTOSAVE_MINUTES: readonly AutosaveMinutes[] = [0, 1, 2, 5, 10];

export const DEFAULT_GAMEPLAY_OPTIONS: GameplayOptions = {
  lootPickup: 'tudo',
  confirmRare: true,
  autoTarget: false,
  pauseOnFocusLoss: false,
  textSpeed: 'instantaneo',
  autosaveMinutes: 2,
  tutorials: true,
};

export function gameplayOptionsOf(settings: GameSettings): GameplayOptions {
  const raw = asRecord(settings.gameplay);
  const d = DEFAULT_GAMEPLAY_OPTIONS;
  return {
    lootPickup: pickEnum(raw.lootPickup, LOOT_PICKUPS, d.lootPickup),
    confirmRare: pickBool(raw.confirmRare, d.confirmRare),
    autoTarget: pickBool(raw.autoTarget, d.autoTarget),
    pauseOnFocusLoss: pickBool(raw.pauseOnFocusLoss, d.pauseOnFocusLoss),
    textSpeed: pickEnum(raw.textSpeed, TEXT_SPEEDS, d.textSpeed),
    autosaveMinutes: pickEnum(raw.autosaveMinutes, AUTOSAVE_MINUTES, d.autosaveMinutes),
    tutorials: pickBool(raw.tutorials, d.tutorials),
  };
}

// --- Controles (toque) ----------------------------------------------------

export type JoystickSide = 'esquerda' | 'direita';

export interface TouchOptions {
  /** 0.7..1.5 — scale of the on-screen joystick. */
  joystickSize: number;
  /** 0.3..1 */
  joystickOpacity: number;
  /** Which bottom corner the joystick sits in (the consumable bar swaps to the other side). */
  joystickSide: JoystickSide;
}

export const JOYSTICK_SIDES: readonly JoystickSide[] = ['esquerda', 'direita'];
export const DEFAULT_TOUCH_OPTIONS: TouchOptions = { joystickSize: 1, joystickOpacity: 1, joystickSide: 'esquerda' };

export function touchOptionsOf(settings: GameSettings): TouchOptions {
  const raw = asRecord(settings.touch);
  const d = DEFAULT_TOUCH_OPTIONS;
  return {
    joystickSize: pickNumber(raw.joystickSize, d.joystickSize, 0.7, 1.5),
    joystickOpacity: pickNumber(raw.joystickOpacity, d.joystickOpacity, 0.3, 1),
    joystickSide: pickEnum(raw.joystickSide, JOYSTICK_SIDES, d.joystickSide),
  };
}

// --- Acessibilidade -------------------------------------------------------

export type ColorblindMode = 'nenhum' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export interface AccessibilityOptions {
  colorblind: ColorblindMode;
  highContrast: boolean;
  /** On-screen captions for the game's sound effects ("[Golpe crítico]"). */
  soundCaptions: boolean;
}

export const COLORBLIND_MODES: readonly ColorblindMode[] = ['nenhum', 'protanopia', 'deuteranopia', 'tritanopia'];
export const DEFAULT_ACCESSIBILITY_OPTIONS: AccessibilityOptions = { colorblind: 'nenhum', highContrast: false, soundCaptions: false };

export function accessibilityOptionsOf(settings: GameSettings): AccessibilityOptions {
  const raw = asRecord(settings.accessibility);
  const d = DEFAULT_ACCESSIBILITY_OPTIONS;
  return {
    colorblind: pickEnum(raw.colorblind, COLORBLIND_MODES, d.colorblind),
    highContrast: pickBool(raw.highContrast, d.highContrast),
    soundCaptions: pickBool(raw.soundCaptions, d.soundCaptions),
  };
}

export type SettingsGroup = 'audio' | 'graphics' | 'camera' | 'interface' | 'gameplay' | 'touch' | 'accessibility' | 'keybindings';

/** "Restaurar padrão" for one tab's worth of options — drops the group(s) from the blob so every accessor falls back to its defaults again. */
export function resetSettingsGroups(settings: GameSettings, groups: SettingsGroup[]): GameSettings {
  const next = { ...settings };
  for (const g of groups) delete next[g];
  return next;
}
