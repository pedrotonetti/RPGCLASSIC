import { STORAGE_KEY } from '../config/gameConfig';
import { Player, type PlayerSaveData } from '../entities/Player';

export const SAVE_SLOT_COUNT = 3;

export interface SaveSlotSummary {
  classId: string;
  level: number;
  name: string;
}

export type SaveSlotEntry = { slot: number; summary: SaveSlotSummary } | null;

function slotKey(slot: number): string {
  return `${STORAGE_KEY}:slot${slot}`;
}

/**
 * Which slot the current session is playing. saveGame() always writes here,
 * so the many call sites throughout OverworldScreen/InventoryScreen/etc. can
 * keep calling it with just a Player and never need to know about slots —
 * MainMenuScreen sets this once when a slot is chosen or created.
 */
let activeSlot = 0;

export function setActiveSlot(slot: number): void {
  activeSlot = slot;
}

/**
 * One-time migration of the pre-slot save (the old single STORAGE_KEY) into
 * slot 0, so a returning player never loses progress. Only runs while no
 * slot-keyed save exists yet; safe to call repeatedly.
 */
function migrateLegacySave(): void {
  try {
    const anySlotExists = Array.from({ length: SAVE_SLOT_COUNT }, (_, i) => slotKey(i)).some(
      (key) => localStorage.getItem(key) !== null,
    );
    if (anySlotExists) return;
    const legacy = localStorage.getItem(STORAGE_KEY);
    if (!legacy) return;
    localStorage.setItem(slotKey(0), legacy);
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // If migration couldn't complete (e.g. quota), leave the legacy key in
    // place — readRawSlot(0) below still falls back to it directly.
  }
}

function readRawSlot(slot: number): string | null {
  try {
    const direct = localStorage.getItem(slotKey(slot));
    if (direct !== null) return direct;
    // Fallback for slot 0 in case migration above didn't get to run/persist.
    if (slot === 0) return localStorage.getItem(STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

export function listSaveSlots(): SaveSlotEntry[] {
  migrateLegacySave();
  const entries: SaveSlotEntry[] = [];
  for (let slot = 0; slot < SAVE_SLOT_COUNT; slot++) {
    const raw = readRawSlot(slot);
    if (!raw) {
      entries.push(null);
      continue;
    }
    try {
      const data = JSON.parse(raw) as PlayerSaveData;
      entries.push({ slot, summary: { classId: data.classId, level: data.level, name: data.name } });
    } catch {
      entries.push(null);
    }
  }
  return entries;
}

export function loadSlotSave(slot: number): Player | null {
  migrateLegacySave();
  try {
    const raw = readRawSlot(slot);
    if (!raw) return null;
    const data = JSON.parse(raw) as PlayerSaveData;
    const player = Player.fromSaveData(data);
    setActiveSlot(slot);
    return player;
  } catch (err) {
    console.warn('Não foi possível carregar o slot de salvamento:', err);
    return null;
  }
}

export function saveToSlot(slot: number, player: Player): void {
  try {
    const data: PlayerSaveData = player.toSaveData();
    localStorage.setItem(slotKey(slot), JSON.stringify(data));
    setActiveSlot(slot);
  } catch (err) {
    console.warn('Não foi possível salvar o jogo:', err);
  }
}

export function deleteSlotSave(slot: number): void {
  try {
    localStorage.removeItem(slotKey(slot));
    if (slot === 0) localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Saves into whichever slot is currently active (see `activeSlot` above). */
export function saveGame(player: Player): void {
  saveToSlot(activeSlot, player);
}
