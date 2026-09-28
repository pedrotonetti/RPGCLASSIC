import { describe, expect, it } from 'vitest';
import { audio } from './AudioSystem';

/** No real AudioContext in this test environment — that's fine, these tests
 * only cover the getter/setter/clamping contract the settings screen relies
 * on (see screens/SettingsScreen.ts's volumeRow), not actual sound output. */
describe('AudioSystem volume', () => {
  it('defaults both music and sfx volume to 1 (full, matching pre-settings loudness)', () => {
    expect(audio.getMusicVolume()).toBe(1);
    expect(audio.getSfxVolume()).toBe(1);
  });

  it('stores and reports back whatever music volume is set, within range', () => {
    audio.setMusicVolume(0.4);
    expect(audio.getMusicVolume()).toBe(0.4);
  });

  it('stores and reports back whatever sfx volume is set, within range', () => {
    audio.setSfxVolume(0.65);
    expect(audio.getSfxVolume()).toBe(0.65);
  });

  it('clamps music volume above 1 down to 1', () => {
    audio.setMusicVolume(3);
    expect(audio.getMusicVolume()).toBe(1);
  });

  it('clamps negative volume up to 0', () => {
    audio.setSfxVolume(-2);
    expect(audio.getSfxVolume()).toBe(0);
  });
});
