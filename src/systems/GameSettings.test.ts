import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from './GameSettings';

/** No jsdom in this project's unit-test environment (vitest runs in plain
 * Node — see SaveSystem, which has the same localStorage dependency and no
 * test file for the same reason) — a minimal in-memory stub is enough since
 * GameSettings only ever calls getItem/setItem/removeItem. */
function makeMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as Storage;
}

/** Fase 7's ambient/combat-feel settings, at their defaults. */
const FEEL_DEFAULTS = { ambientVolume: 1, screenShake: 1, damageNumbers: true, reduceMotion: false };

beforeEach(() => {
  vi.stubGlobal('localStorage', makeMemoryStorage());
});

describe('loadSettings', () => {
  it('defaults to full music/sfx volume and no low-power override when nothing is stored', () => {
    const settings = loadSettings();
    expect(settings).toEqual({ ...FEEL_DEFAULTS, musicVolume: 1, sfxVolume: 1, lowPowerOverride: null });
  });

  it('migrates the legacy on/off music key: "off" becomes musicVolume 0', () => {
    localStorage.setItem('rpgclassic:musicOn', 'off');
    const settings = loadSettings();
    expect(settings.musicVolume).toBe(0);
  });

  it('ignores the legacy key once the new settings key has ever been saved', () => {
    localStorage.setItem('rpgclassic:musicOn', 'off');
    saveSettings({ ...FEEL_DEFAULTS, musicVolume: 0.7, sfxVolume: 0.5, lowPowerOverride: true });
    const settings = loadSettings();
    expect(settings.musicVolume).toBe(0.7);
  });

  it('falls back to defaults on corrupted stored JSON instead of throwing', () => {
    localStorage.setItem('rpgclassic:settings:v1', '{not json');
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings()).toEqual({ ...FEEL_DEFAULTS, musicVolume: 1, sfxVolume: 1, lowPowerOverride: null });
  });
});

describe('saveSettings', () => {
  it('round-trips whatever was saved', () => {
    saveSettings({ ...FEEL_DEFAULTS, musicVolume: 0.3, sfxVolume: 0.9, lowPowerOverride: false });
    expect(loadSettings()).toEqual({ ...FEEL_DEFAULTS, musicVolume: 0.3, sfxVolume: 0.9, lowPowerOverride: false });
  });
});

describe('Fase 7 settings (ambiente, tremor de tela, números de dano, reduzir movimento)', () => {
  it('fills the new keys with defaults for a blob saved before they existed', () => {
    localStorage.setItem('rpgclassic:settings:v1', JSON.stringify({ musicVolume: 0.4, sfxVolume: 0.6, lowPowerOverride: null }));
    const settings = loadSettings();
    expect(settings.musicVolume).toBe(0.4);
    expect(settings).toMatchObject(FEEL_DEFAULTS);
  });

  it('round-trips non-default values', () => {
    saveSettings({ musicVolume: 1, sfxVolume: 1, lowPowerOverride: null, ambientVolume: 0.25, screenShake: 0.5, damageNumbers: false, reduceMotion: true });
    expect(loadSettings()).toMatchObject({ ambientVolume: 0.25, screenShake: 0.5, damageNumbers: false, reduceMotion: true });
  });

  it('sanitizes wrong types and out-of-range values back to safe ones', () => {
    localStorage.setItem(
      'rpgclassic:settings:v1',
      JSON.stringify({ musicVolume: 1, sfxVolume: 1, lowPowerOverride: null, ambientVolume: 'alto', screenShake: 7, damageNumbers: 'sim', reduceMotion: 1 }),
    );
    const settings = loadSettings();
    expect(settings.ambientVolume).toBe(1);
    expect(settings.screenShake).toBe(1);
    expect(settings.damageNumbers).toBe(true);
    expect(settings.reduceMotion).toBe(false);
  });

  it('clamps a negative shake strength to 0 (off)', () => {
    localStorage.setItem('rpgclassic:settings:v1', JSON.stringify({ screenShake: -3 }));
    expect(loadSettings().screenShake).toBe(0);
  });
});
