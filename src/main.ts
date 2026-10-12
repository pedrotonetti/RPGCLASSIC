import { Game } from './engine/Game';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { audio } from './systems/AudioSystem';
import { loadSettings, uiScaleOf } from './systems/GameSettings';
import { isTouchDevice } from './ui/device';
import { applyUiScale, installTouchGuards } from './ui/mobile';
import './ui/style.css';

document.body.classList.toggle('is-touch', isTouchDevice());

const settings = loadSettings();
audio.setMusicVolume(settings.musicVolume);
audio.setSfxVolume(settings.sfxVolume);
applyUiScale(uiScaleOf(settings));
installTouchGuards();

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const game = new Game(canvas, uiRoot, settings.lowPowerOverride);
game.goTo(new MainMenuScreen(game));
