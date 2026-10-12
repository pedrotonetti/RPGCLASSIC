import type { Game } from '../engine/Game';
import { applyAccessibilityOptions, applyInterfaceOptions, applyTouchOptions } from '../ui/interfaceOptions';
import { applyUiScale } from '../ui/mobile';
import { installSoundCaptions, setSoundCaptionsEnabled } from '../ui/soundCaptions';
import { audio } from './AudioSystem';
import { combatFeel } from './combatFeel';
import {
  accessibilityOptionsOf,
  audioOptionsOf,
  cameraOptionsOf,
  effectiveVolumes,
  gameplayOptionsOf,
  graphicsOptionsOf,
  interfaceOptionsOf,
  resolveGraphicsLevels,
  touchOptionsOf,
  uiScaleOf,
  type GameSettings,
} from './GameSettings';
import { setCameraOptions, setGameplayOptions } from './gameplayOptions';
import { configureGraphics } from './graphicsOptions';
import { setKeyBindings } from './Keybindings';

/**
 * The one place that pushes a GameSettings blob into every live system —
 * called at startup (main.ts, before and after the Game exists) and by the
 * settings screen after every change, so "applied at startup" and "applied
 * live" can never drift apart. Each step is cheap and idempotent.
 */

let current: GameSettings | null = null;
let backgroundHookInstalled = false;

function isBackgrounded(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function applyVolumes(settings: GameSettings): void {
  const v = effectiveVolumes(settings, isBackgrounded());
  audio.setMusicVolume(v.music);
  audio.setSfxVolume(v.sfx);
  audio.setAmbientVolume(v.ambient);
}

/** "Silenciar em segundo plano" needs to react to the tab hiding/showing, not just to settings changes. */
function installBackgroundHook(): void {
  if (backgroundHookInstalled || typeof document === 'undefined') return;
  backgroundHookInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (current && audioOptionsOf(current).muteInBackground) applyVolumes(current);
  });
}

export function applySettings(settings: GameSettings, game: Game | null = null): void {
  current = settings;
  installBackgroundHook();
  applyVolumes(settings);
  combatFeel.configure({ screenShake: settings.screenShake, damageNumbers: settings.damageNumbers, reduceMotion: settings.reduceMotion });
  applyUiScale(uiScaleOf(settings));
  setKeyBindings(settings.keybindings);
  setGameplayOptions(gameplayOptionsOf(settings));
  setCameraOptions(cameraOptionsOf(settings));
  applyInterfaceOptions(interfaceOptionsOf(settings));
  applyTouchOptions(touchOptionsOf(settings));
  const access = accessibilityOptionsOf(settings);
  applyAccessibilityOptions(access);
  installSoundCaptions();
  setSoundCaptionsEnabled(access.soundCaptions);
  const graphics = graphicsOptionsOf(settings);
  configureGraphics(game, resolveGraphicsLevels(graphics, game?.lowPowerTier ?? false), graphics.showFps);
}
