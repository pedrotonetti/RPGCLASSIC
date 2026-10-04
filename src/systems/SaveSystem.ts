import { STORAGE_KEY } from '../config/gameConfig';
import { Player, type PlayerSaveData } from '../entities/Player';
import { parseSave, readSaveText, sealSave, type SaveFormatError, type SaveRecord } from './saveFormat';

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

/** The previous save of this slot, copied here right before each overwrite. */
function backupKey(slot: number): string {
  return `${slotKey(slot)}:backup`;
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

function readBackup(slot: number): string | null {
  try {
    return localStorage.getItem(backupKey(slot));
  } catch {
    return null;
  }
}

type SlotFailure = 'empty' | 'newer' | 'corrupt';

interface ResolvedSlot {
  data: SaveRecord;
  player: Player | null;
  source: 'main' | 'backup';
  backupRaw: string | null;
}

/**
 * Picks the first readable copy of a slot — the live save, else the rolling
 * backup. A save from a NEWER game build never falls back to the backup:
 * that would silently discard progress this build just can't read.
 */
function resolveSlot(slot: number, opts: { buildPlayer: boolean }): ResolvedSlot | { failure: SlotFailure } {
  const main = readRawSlot(slot);
  if (main === null) return { failure: 'empty' };
  const candidates: Array<{ raw: string; source: 'main' | 'backup' }> = [{ raw: main, source: 'main' }];
  const backup = readBackup(slot);
  if (backup !== null) candidates.push({ raw: backup, source: 'backup' });

  for (const candidate of candidates) {
    const loaded = readSaveText(candidate.raw);
    if (!loaded.ok) {
      if (loaded.reason === 'newer' && candidate.source === 'main') return { failure: 'newer' };
      continue;
    }
    let player: Player | null = null;
    if (opts.buildPlayer) {
      try {
        player = Player.fromSaveData(loaded.data as unknown as PlayerSaveData);
      } catch (err) {
        console.warn('Save ilegível, tentando o backup:', err);
        continue;
      }
    }
    return { data: loaded.data, player, source: candidate.source, backupRaw: candidate.source === 'backup' ? candidate.raw : null };
  }
  return { failure: 'corrupt' };
}

function summaryOf(data: SaveRecord): SaveSlotSummary {
  return { classId: String(data.classId), level: Number(data.level), name: String(data.name) };
}

export function listSaveSlots(): SaveSlotEntry[] {
  migrateLegacySave();
  const entries: SaveSlotEntry[] = [];
  for (let slot = 0; slot < SAVE_SLOT_COUNT; slot++) {
    const resolved = resolveSlot(slot, { buildPlayer: false });
    entries.push('failure' in resolved ? null : { slot, summary: summaryOf(resolved.data) });
  }
  return entries;
}

export type SlotLoadResult =
  | { status: 'ok'; player: Player; recoveredFromBackup: boolean }
  | { status: 'empty' | 'newer' | 'corrupt' };

export function loadSlot(slot: number): SlotLoadResult {
  migrateLegacySave();
  try {
    const resolved = resolveSlot(slot, { buildPlayer: true });
    if ('failure' in resolved) return { status: resolved.failure };
    if (resolved.backupRaw !== null) {
      try {
        localStorage.setItem(slotKey(slot), resolved.backupRaw);
      } catch {
        // Restoring is best-effort; the loaded player still saves normally later.
      }
    }
    setActiveSlot(slot);
    return { status: 'ok', player: resolved.player!, recoveredFromBackup: resolved.source === 'backup' };
  } catch (err) {
    console.warn('Não foi possível carregar o slot de salvamento:', err);
    return { status: 'corrupt' };
  }
}

export function loadSlotSave(slot: number): Player | null {
  const result = loadSlot(slot);
  return result.status === 'ok' ? result.player : null;
}

/** Copies the slot's current save aside — only when it is itself intact, so a corrupt file never replaces a good backup. */
function backupSlot(slot: number): void {
  try {
    const current = readRawSlot(slot);
    if (current !== null && parseSave(current).ok) localStorage.setItem(backupKey(slot), current);
  } catch {
    // A full quota must not stop the real save below.
  }
}

function writeSlot(slot: number, player: Player): boolean {
  try {
    const text = sealSave(player.toSaveData() as unknown as SaveRecord);
    backupSlot(slot);
    localStorage.setItem(slotKey(slot), text);
    return true;
  } catch (err) {
    console.warn('Não foi possível salvar o jogo:', err);
    return false;
  }
}

export function saveToSlot(slot: number, player: Player): void {
  if (writeSlot(slot, player)) setActiveSlot(slot);
}

export function deleteSlotSave(slot: number): void {
  try {
    localStorage.removeItem(slotKey(slot));
    localStorage.removeItem(backupKey(slot));
    if (slot === 0) localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Saves into whichever slot is currently active (see `activeSlot` above). */
export function saveGame(player: Player): void {
  saveToSlot(activeSlot, player);
}

// --- export / import ---------------------------------------------------------

function fileSlug(text: string): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'heroi';
}

/** The slot's verified, current-schema save as downloadable JSON, or null when nothing readable is there. */
export function exportSlot(slot: number): { filename: string; text: string } | null {
  migrateLegacySave();
  const resolved = resolveSlot(slot, { buildPlayer: false });
  if ('failure' in resolved) return null;
  const { name, level } = summaryOf(resolved.data);
  return { filename: `sede-slot${slot + 1}-${fileSlug(name)}-nv${level}.json`, text: sealSave(resolved.data) };
}

export type ImportResult = { ok: true; summary: SaveSlotSummary } | { ok: false; error: string };

const MAX_IMPORT_CHARS = 5_000_000;

const IMPORT_ERROR: Record<SaveFormatError, string> = {
  invalid: 'O arquivo não é um JSON válido.',
  shape: 'O arquivo não parece ser um save do Sede.',
  checksum: 'O arquivo está corrompido ou foi alterado (verificação de integridade falhou).',
  newer: 'Este save foi criado por uma versão mais nova do jogo. Atualize o jogo para importá-lo.',
  migration: 'Não foi possível converter este save para a versão atual do jogo.',
};

function validateImport(text: string): { ok: true; player: Player } | { ok: false; error: string } {
  if (text.length > MAX_IMPORT_CHARS) return { ok: false, error: 'O arquivo é grande demais para ser um save.' };
  const loaded = readSaveText(text);
  if (!loaded.ok) return { ok: false, error: IMPORT_ERROR[loaded.reason] };
  try {
    return { ok: true, player: Player.fromSaveData(loaded.data as unknown as PlayerSaveData) };
  } catch {
    return { ok: false, error: 'O save contém dados que este jogo não reconhece (classe desconhecida?).' };
  }
}

function playerSummary(player: Player): SaveSlotSummary {
  return { classId: player.classId, level: player.level, name: player.name };
}

/** Dry run: what importing this file would put in a slot, without touching storage. */
export function previewImport(text: string): ImportResult {
  const valid = validateImport(text);
  return valid.ok ? { ok: true, summary: playerSummary(valid.player) } : valid;
}

/** Validates, migrates and writes the file into `slot` (the slot's old save goes to its backup). */
export function importSlot(slot: number, text: string): ImportResult {
  const valid = validateImport(text);
  if (!valid.ok) return valid;
  if (!writeSlot(slot, valid.player)) return { ok: false, error: 'Não foi possível gravar o save (armazenamento cheio?).' };
  return { ok: true, summary: playerSummary(valid.player) };
}
