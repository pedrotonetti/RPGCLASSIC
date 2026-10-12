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
  /**
   * "Tamanho da interface" — scales HUD and menu text/controls (see
   * ui/uiScale.ts). Optional (absent = 'medio') so settings blobs saved
   * before it existed, and every other settings field added alongside it,
   * keep loading unchanged; read it through `uiScaleOf`.
   */
  uiScale?: UiScale;
  /** Small-screen HUD: quest tracker collapsed to a single tappable line. Optional (absent = expanded). */
  questTrackerCollapsed?: boolean;
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
  return { musicVolume: 1, sfxVolume: 1, lowPowerOverride: null };
}

export function loadSettings(): GameSettings {
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<GameSettings>;
      return { ...defaultSettings(), ...parsed };
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
