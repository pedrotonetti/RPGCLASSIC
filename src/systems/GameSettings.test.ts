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

beforeEach(() => {
  vi.stubGlobal('localStorage', makeMemoryStorage());
});

describe('loadSettings', () => {
  it('defaults to full music/sfx volume and no low-power override when nothing is stored', () => {
    const settings = loadSettings();
    expect(settings).toEqual({ musicVolume: 1, sfxVolume: 1, lowPowerOverride: null });
  });

  it('migrates the legacy on/off music key: "off" becomes musicVolume 0', () => {
    localStorage.setItem('rpgclassic:musicOn', 'off');
    const settings = loadSettings();
    expect(settings.musicVolume).toBe(0);
  });

  it('ignores the legacy key once the new settings key has ever been saved', () => {
    localStorage.setItem('rpgclassic:musicOn', 'off');
    saveSettings({ musicVolume: 0.7, sfxVolume: 0.5, lowPowerOverride: true });
    const settings = loadSettings();
    expect(settings.musicVolume).toBe(0.7);
  });

  it('falls back to defaults on corrupted stored JSON instead of throwing', () => {
    localStorage.setItem('rpgclassic:settings:v1', '{not json');
    expect(() => loadSettings()).not.toThrow();
    expect(loadSettings()).toEqual({ musicVolume: 1, sfxVolume: 1, lowPowerOverride: null });
  });
});

describe('saveSettings', () => {
  it('round-trips whatever was saved', () => {
    saveSettings({ musicVolume: 0.3, sfxVolume: 0.9, lowPowerOverride: false });
    expect(loadSettings()).toEqual({ musicVolume: 0.3, sfxVolume: 0.9, lowPowerOverride: false });
  });
});
