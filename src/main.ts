import { Game } from './engine/Game';
import { MainMenuScreen } from './screens/MainMenuScreen';
import './ui/style.css';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui-root') as HTMLElement;

const game = new Game(canvas, uiRoot);
game.goTo(new MainMenuScreen(game));
