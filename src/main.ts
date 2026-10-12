import { Game } from './engine/Game';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { applySettings } from './systems/applySettings';
import { loadSettings } from './systems/GameSettings';
import { isTouchDevice } from './ui/device';
import { installTouchGuards } from './ui/mobile';
import './ui/style.css';
import './ui/settings.css';

document.body.classList.toggle('is-touch', isTouchDevice());

const settings = loadSettings();
// Audio, combat feel, UI scale, key bindings, HUD/accessibility CSS... —
// everything that doesn't need the renderer — before the first screen
// builds, then once more with the Game for the renderer-side graphics
// options (render scale, FPS cap/counter).
applySettings(settings);
installTouchGuards();

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const game = new Game(canvas, uiRoot, settings.lowPowerOverride);
applySettings(settings, game);
game.goTo(new MainMenuScreen(game));
