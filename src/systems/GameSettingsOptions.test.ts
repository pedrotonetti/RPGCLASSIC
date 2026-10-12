import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accessibilityOptionsOf,
  audioOptionsOf,
  autoGraphicsLevels,
  cameraOptionsOf,
  DEFAULT_ACCESSIBILITY_OPTIONS,
  DEFAULT_AUDIO_OPTIONS,
  DEFAULT_CAMERA_OPTIONS,
  DEFAULT_GAMEPLAY_OPTIONS,
  DEFAULT_GRAPHICS_OPTIONS,
  DEFAULT_INTERFACE_OPTIONS,
  DEFAULT_TOUCH_OPTIONS,
  effectiveVolumes,
  gameplayOptionsOf,
  GRAPHICS_PRESET_LEVELS,
  graphicsOptionsOf,
  interfaceOptionsOf,
  loadSettings,
  matchGraphicsPreset,
  resetSettingsGroups,
  resolveGraphicsLevels,
  saveSettings,
  touchOptionsOf,
  withGraphicsLevel,
  withGraphicsPreset,
  type GameSettings,
} from './GameSettings';

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

const KEY = 'rpgclassic:settings:v1';

describe('option groups on an old settings blob', () => {
  it('every accessor falls back to its defaults when the group was never saved', () => {
    localStorage.setItem(KEY, JSON.stringify({ musicVolume: 0.5, sfxVolume: 1, lowPowerOverride: null }));
    const s = loadSettings();
    expect(audioOptionsOf(s)).toEqual(DEFAULT_AUDIO_OPTIONS);
    expect(graphicsOptionsOf(s)).toEqual(DEFAULT_GRAPHICS_OPTIONS);
    expect(cameraOptionsOf(s)).toEqual(DEFAULT_CAMERA_OPTIONS);
    expect(interfaceOptionsOf(s)).toEqual(DEFAULT_INTERFACE_OPTIONS);
    expect(gameplayOptionsOf(s)).toEqual(DEFAULT_GAMEPLAY_OPTIONS);
    expect(touchOptionsOf(s)).toEqual(DEFAULT_TOUCH_OPTIONS);
    expect(accessibilityOptionsOf(s)).toEqual(DEFAULT_ACCESSIBILITY_OPTIONS);
    // ...and the old fields themselves are untouched.
    expect(s.musicVolume).toBe(0.5);
  });

  it('defaults reproduce the game exactly as it played before these options', () => {
    expect(DEFAULT_CAMERA_OPTIONS.fov).toBe(60);
    expect(DEFAULT_CAMERA_OPTIONS.defaultView).toBe(0);
    expect(DEFAULT_GAMEPLAY_OPTIONS.textSpeed).toBe('instantaneo');
    expect(DEFAULT_GAMEPLAY_OPTIONS.lootPickup).toBe('tudo');
    expect(DEFAULT_GAMEPLAY_OPTIONS.confirmRare).toBe(true);
    expect(DEFAULT_GAMEPLAY_OPTIONS.autoTarget).toBe(false);
    expect(Object.values(DEFAULT_INTERFACE_OPTIONS).every((v) => v === true || v === 1)).toBe(true);
    expect(DEFAULT_GRAPHICS_OPTIONS.preset).toBe('auto');
  });
});

describe('sanitizing bad stored values', () => {
  it('replaces wrong types / unknown enum values field by field and clamps numbers', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        audio: { masterVolume: 9, muteInBackground: 'sim' },
        graphics: { preset: 'epico', shadows: 'max', renderScale: 0.1, fpsCap: 144, viewDistance: 'longa', showFps: 1 },
        camera: { fov: 200, defaultView: 7, rotateSensitivity: -1, invertRotation: true, smoothing: null },
        interface: { minimap: false, hudOpacity: 0 },
        gameplay: { textSpeed: 'turbo', autosaveMinutes: 3, tutorials: false },
        touch: { joystickSize: 5, joystickSide: 'cima' },
        accessibility: { colorblind: 'acromatopsia', highContrast: true },
      }),
    );
    const s = loadSettings();
    expect(audioOptionsOf(s)).toEqual({ masterVolume: 1, muteInBackground: false });
    const g = graphicsOptionsOf(s);
    expect(g.preset).toBe('auto');
    expect(g.shadows).toBe('alta');
    expect(g.renderScale).toBe(0.5);
    expect(g.fpsCap).toBe(0);
    expect(g.viewDistance).toBe('longa');
    expect(g.showFps).toBe(false);
    expect(cameraOptionsOf(s)).toEqual({ fov: 90, defaultView: 0, rotateSensitivity: 0.25, invertRotation: true, smoothing: true });
    expect(interfaceOptionsOf(s).minimap).toBe(false);
    expect(interfaceOptionsOf(s).hudOpacity).toBe(0.3);
    expect(gameplayOptionsOf(s)).toMatchObject({ textSpeed: 'instantaneo', autosaveMinutes: 2, tutorials: false });
    expect(touchOptionsOf(s)).toEqual({ joystickSize: 1.5, joystickOpacity: 1, joystickSide: 'esquerda' });
    expect(accessibilityOptionsOf(s)).toEqual({ colorblind: 'nenhum', highContrast: true, soundCaptions: false });
  });

  it('treats a non-object group (string, array, null) as absent', () => {
    localStorage.setItem(KEY, JSON.stringify({ camera: 'perto', interface: [1, 2], gameplay: null }));
    const s = loadSettings();
    expect(cameraOptionsOf(s)).toEqual(DEFAULT_CAMERA_OPTIONS);
    expect(interfaceOptionsOf(s)).toEqual(DEFAULT_INTERFACE_OPTIONS);
    expect(gameplayOptionsOf(s)).toEqual(DEFAULT_GAMEPLAY_OPTIONS);
  });

  it('round-trips non-default groups', () => {
    const s: GameSettings = {
      ...loadSettings(),
      camera: { ...DEFAULT_CAMERA_OPTIONS, fov: 75, defaultView: 2 },
      gameplay: { ...DEFAULT_GAMEPLAY_OPTIONS, textSpeed: 'lento', autosaveMinutes: 5 },
      keybindings: { interact: 'f' },
    };
    saveSettings(s);
    const loaded = loadSettings();
    expect(cameraOptionsOf(loaded)).toMatchObject({ fov: 75, defaultView: 2 });
    expect(gameplayOptionsOf(loaded)).toMatchObject({ textSpeed: 'lento', autosaveMinutes: 5 });
    expect(loaded.keybindings).toEqual({ interact: 'f' });
  });
});

describe('effectiveVolumes', () => {
  it('multiplies every bus by the master volume', () => {
    const s = { ...loadSettings(), musicVolume: 0.5, sfxVolume: 1, ambientVolume: 0.8, audio: { masterVolume: 0.5 } };
    expect(effectiveVolumes(s)).toEqual({ music: 0.25, sfx: 0.5, ambient: 0.4 });
  });

  it('silences everything in the background only when that option is on', () => {
    const s = { ...loadSettings(), audio: { muteInBackground: true } };
    expect(effectiveVolumes(s, true)).toEqual({ music: 0, sfx: 0, ambient: 0 });
    expect(effectiveVolumes(s, false).music).toBe(1);
    expect(effectiveVolumes(loadSettings(), true).music).toBe(1);
  });
});

describe('graphics presets', () => {
  it('auto resolves to the device tier the game always used', () => {
    expect(resolveGraphicsLevels(DEFAULT_GRAPHICS_OPTIONS, false)).toEqual(autoGraphicsLevels(false));
    expect(autoGraphicsLevels(false).shadows).toBe('alta');
    expect(autoGraphicsLevels(true).shadows).toBe('baixa');
    expect(autoGraphicsLevels(true).renderScale).toBe(1);
  });

  it('picking a preset copies its values into the fields', () => {
    const g = withGraphicsPreset(DEFAULT_GRAPHICS_OPTIONS, 'baixo', false);
    expect(g.preset).toBe('baixo');
    expect(g).toMatchObject(GRAPHICS_PRESET_LEVELS.baixo);
    expect(resolveGraphicsLevels(g, false)).toEqual(GRAPHICS_PRESET_LEVELS.baixo);
  });

  it('presets get progressively heavier', () => {
    const order = ['baixo', 'medio', 'alto', 'ultra'] as const;
    const scales = order.map((p) => GRAPHICS_PRESET_LEVELS[p].renderScale);
    expect([...scales].sort((a, b) => a - b)).toEqual(scales);
    expect(GRAPHICS_PRESET_LEVELS.baixo.shadows).toBe('off');
    expect(GRAPHICS_PRESET_LEVELS.ultra.viewDistance).toBe('longa');
  });

  it('editing one field turns the preset into Personalizado (or the preset it now matches)', () => {
    const alto = withGraphicsPreset(DEFAULT_GRAPHICS_OPTIONS, 'alto', false);
    const custom = withGraphicsLevel(alto, 'shadows', 'off', false);
    expect(custom.preset).toBe('personalizado');
    expect(resolveGraphicsLevels(custom, false).shadows).toBe('off');
    const ultra = withGraphicsLevel(alto, 'viewDistance', 'longa', false);
    expect(ultra.preset).toBe('ultra');
  });

  it('editing from Automático starts from what the device was rendering', () => {
    const g = withGraphicsLevel(DEFAULT_GRAPHICS_OPTIONS, 'fpsCap', 30, true);
    expect(g.preset).toBe('personalizado');
    expect(resolveGraphicsLevels(g, true)).toEqual({ ...autoGraphicsLevels(true), fpsCap: 30 });
  });

  it('matchGraphicsPreset recognizes exact table entries only', () => {
    expect(matchGraphicsPreset(GRAPHICS_PRESET_LEVELS.medio)).toBe('medio');
    expect(matchGraphicsPreset({ ...GRAPHICS_PRESET_LEVELS.medio, renderScale: 0.9 })).toBe('personalizado');
  });
});

describe('resetSettingsGroups', () => {
  it('drops just the named groups', () => {
    const s: GameSettings = { ...loadSettings(), camera: { fov: 80 }, interface: { minimap: false }, keybindings: { interact: 'f' } };
    const r = resetSettingsGroups(s, ['camera', 'keybindings']);
    expect(r.camera).toBeUndefined();
    expect(r.keybindings).toBeUndefined();
    expect(r.interface).toEqual({ minimap: false });
    expect(s.camera).toEqual({ fov: 80 });
  });
});
