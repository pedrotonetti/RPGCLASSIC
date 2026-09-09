import { STORAGE_KEY } from '../config/gameConfig';
import { Player, type PlayerSaveData } from '../entities/Player';

export function hasSave(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveGame(player: Player): void {
  try {
    const data: PlayerSaveData = player.toSaveData();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Não foi possível salvar o jogo:', err);
  }
}

export function loadGame(): Player | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PlayerSaveData;
    return Player.fromSaveData(data);
  } catch (err) {
    console.warn('Não foi possível carregar o jogo salvo:', err);
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
