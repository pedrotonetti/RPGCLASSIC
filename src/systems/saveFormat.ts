/**
 * Pure save-file format: schema version, ordered migrations and a cheap
 * integrity checksum. No storage, DOM or Player here — SaveSystem owns the
 * localStorage side. A stored save is the PlayerSaveData JSON itself plus two
 * top-level meta fields (`schemaVersion`, `checksum`), so tools that read the
 * slot as a plain PlayerSaveData keep working. A save with no `schemaVersion`
 * is the baseline (version 1): every save written before this module existed.
 */
import { normalizeAdaptiveState } from './AdaptiveDifficulty';

export const BASELINE_SCHEMA_VERSION = 1;
export const CURRENT_SCHEMA_VERSION = 2;

export type SaveRecord = Record<string, unknown>;
/** Receives a private deep copy, so it may mutate and return it. */
export type SaveMigration = (data: SaveRecord) => SaveRecord;

/** Keyed by the version a migration upgrades FROM; each step must land on from + 1. */
export const SAVE_MIGRATIONS: Record<number, SaveMigration> = {
  1: (data) => ({ ...data, adaptive: normalizeAdaptiveState(data.adaptive) }),
};

/** FNV-1a 32-bit, hex. Detects accidental corruption and hand edits, not tampering. */
export function checksumOf(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export type SaveFormatError = 'invalid' | 'shape' | 'checksum' | 'newer' | 'migration';

export type ParsedSave =
  | { ok: true; data: SaveRecord; version: number; checksum: 'valid' | 'missing' }
  | { ok: false; reason: Exclude<SaveFormatError, 'newer' | 'migration'> };

function isRecord(value: unknown): value is SaveRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The minimum a save needs to be worth loading — Player's own defaults cover everything else. */
export function looksLikeSave(value: unknown): value is SaveRecord {
  return isRecord(value) && typeof value.name === 'string' && typeof value.classId === 'string' && typeof value.level === 'number' && Number.isFinite(value.level) && value.level >= 1;
}

/** Writes `data` with its schema version and checksum. Meta keys already on `data` are replaced. */
export function sealSave(data: SaveRecord, version: number = CURRENT_SCHEMA_VERSION): string {
  const { schemaVersion: _v, checksum: _c, ...rest } = data;
  const body = { ...rest, schemaVersion: version };
  return JSON.stringify({ ...body, checksum: checksumOf(JSON.stringify(body)) });
}

/** Parses and verifies a stored/imported save WITHOUT migrating it; the meta fields are stripped from `data`. */
export function parseSave(raw: string): ParsedSave {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!looksLikeSave(parsed)) return { ok: false, reason: 'shape' };
  const { checksum, ...body } = parsed;
  if (checksum !== undefined && checksum !== checksumOf(JSON.stringify(body))) return { ok: false, reason: 'checksum' };
  const { schemaVersion, ...data } = body;
  const version = typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) && schemaVersion >= BASELINE_SCHEMA_VERSION ? schemaVersion : BASELINE_SCHEMA_VERSION;
  return { ok: true, data, version, checksum: checksum === undefined ? 'missing' : 'valid' };
}

/** Runs every migration from `fromVersion` up to `target`, in order, on a copy of `data`. Throws on a missing step or a version newer than `target`. */
export function migrateSaveData(
  data: SaveRecord,
  fromVersion: number,
  migrations: Record<number, SaveMigration> = SAVE_MIGRATIONS,
  target: number = CURRENT_SCHEMA_VERSION,
): SaveRecord {
  if (fromVersion > target) throw new Error(`Save de versão ${fromVersion} é mais novo que o suportado (${target}).`);
  let current: SaveRecord = JSON.parse(JSON.stringify(data));
  for (let v = fromVersion; v < target; v++) {
    const step = migrations[v];
    if (!step) throw new Error(`Falta a migração de save ${v} -> ${v + 1}.`);
    current = step(current);
  }
  return current;
}

export type LoadedSave =
  | { ok: true; data: SaveRecord; fromVersion: number; migrated: boolean; checksum: 'valid' | 'missing' }
  | { ok: false; reason: SaveFormatError };

/** Parse + verify + migrate to the current schema, never throwing. */
export function readSaveText(raw: string): LoadedSave {
  const parsed = parseSave(raw);
  if (!parsed.ok) return parsed;
  if (parsed.version > CURRENT_SCHEMA_VERSION) return { ok: false, reason: 'newer' };
  try {
    const data = migrateSaveData(parsed.data, parsed.version);
    return { ok: true, data, fromVersion: parsed.version, migrated: parsed.version < CURRENT_SCHEMA_VERSION, checksum: parsed.checksum };
  } catch {
    return { ok: false, reason: 'migration' };
  }
}
