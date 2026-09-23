import { Game } from './engine/Game';
import { MainMenuScreen } from './screens/MainMenuScreen';
import { isTouchDevice } from './ui/device';
import './ui/style.css';

document.body.classList.toggle('is-touch', isTouchDevice());

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const game = new Game(canvas, uiRoot);
game.goTo(new MainMenuScreen(game));
