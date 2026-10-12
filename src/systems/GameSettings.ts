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
