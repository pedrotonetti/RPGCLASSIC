import { describe, expect, it } from 'vitest';
import { Player, type PlayerSaveData } from '../entities/Player';
import {
  BASELINE_SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  SAVE_MIGRATIONS,
  checksumOf,
  migrateSaveData,
  parseSave,
  readSaveText,
  sealSave,
  type SaveMigration,
  type SaveRecord,
} from './saveFormat';

/** What every save written before schemaVersion existed looks like: plain PlayerSaveData JSON, without the later-added `adaptive` field. */
function baselineSave(): SaveRecord {
  const player = Player.createNew('Heroi', 'mage');
  player.gold = 321;
  player.level = 4;
  const data = JSON.parse(JSON.stringify(player.toSaveData())) as SaveRecord;
  delete data.adaptive;
  return data;
}

describe('checksumOf', () => {
  it('is a stable 8-digit hex string that changes with the content', () => {
    expect(checksumOf('abc')).toBe(checksumOf('abc'));
    expect(checksumOf('abc')).toMatch(/^[0-9a-f]{8}$/);
    expect(checksumOf('abc')).not.toBe(checksumOf('abd'));
    expect(checksumOf('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('matches the published FNV-1a test vector', () => {
    expect(checksumOf('a')).toBe('e40c292c');
  });
});

describe('sealSave / parseSave', () => {
  it('round-trips data and reports a valid checksum with meta fields stripped', () => {
    const data = baselineSave();
    const parsed = parseSave(sealSave(data));
    expect(parsed).toMatchObject({ ok: true, version: CURRENT_SCHEMA_VERSION, checksum: 'valid' });
    if (parsed.ok) expect(parsed.data).toEqual(data);
  });

  it('keeps the stored text readable as a plain PlayerSaveData (flat, with two extra keys)', () => {
    const raw = JSON.parse(sealSave(baselineSave())) as SaveRecord;
    expect(raw.gold).toBe(321);
    expect(raw.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(typeof raw.checksum).toBe('string');
  });

  it('re-sealing replaces old meta instead of nesting it', () => {
    const data = baselineSave();
    const twice = parseSave(sealSave(JSON.parse(sealSave(data)) as SaveRecord));
    expect(twice.ok).toBe(true);
    if (twice.ok) expect(twice.data).toEqual(data);
  });

  it('treats a save with no schemaVersion and no checksum as the baseline', () => {
    const parsed = parseSave(JSON.stringify(baselineSave()));
    expect(parsed).toMatchObject({ ok: true, version: BASELINE_SCHEMA_VERSION, checksum: 'missing' });
  });

  it('rejects a payload edited after sealing', () => {
    const tampered = sealSave(baselineSave()).replace('"gold":321', '"gold":999999');
    expect(tampered).toContain('999999');
    expect(parseSave(tampered)).toEqual({ ok: false, reason: 'checksum' });
  });

  it('rejects a truncated file, a non-save object and non-objects', () => {
    expect(parseSave(sealSave(baselineSave()).slice(0, 40))).toEqual({ ok: false, reason: 'invalid' });
    expect(parseSave('{"foo":1}')).toEqual({ ok: false, reason: 'shape' });
    expect(parseSave('[1,2,3]')).toEqual({ ok: false, reason: 'shape' });
    expect(parseSave('null')).toEqual({ ok: false, reason: 'shape' });
    expect(parseSave('{"name":"x","classId":"mage","level":0}')).toEqual({ ok: false, reason: 'shape' });
  });
});

describe('migrateSaveData', () => {
  const chain: Record<number, SaveMigration> = {
    0: (d) => {
      const { oro, ...rest } = d;
      return { ...rest, gold: oro };
    },
    1: (d) => ({ ...d, extra: 'novo' }),
  };

  it('applies each step in order from the save version up to the target', () => {
    const out = migrateSaveData({ name: 'A', oro: 7 }, 0, chain, 2);
    expect(out).toEqual({ name: 'A', gold: 7, extra: 'novo' });
  });

  it('starts at the right step for a partially-old save', () => {
    expect(migrateSaveData({ name: 'A', gold: 7 }, 1, chain, 2)).toEqual({ name: 'A', gold: 7, extra: 'novo' });
  });

  it('is a plain copy when the save is already at the target', () => {
    const input = { name: 'A', gold: 7 };
    const out = migrateSaveData(input, 2, chain, 2);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });

  it('never mutates its input, even when a step mutates what it receives', () => {
    const input = { name: 'A', nested: { n: 1 } };
    migrateSaveData(input, 0, { 0: (d) => ({ ...d, nested: Object.assign(d.nested as object, { n: 2 }) }) }, 1);
    expect(input.nested.n).toBe(1);
  });

  it('throws on a missing step or a save newer than the target', () => {
    expect(() => migrateSaveData({}, 0, { 1: chain[1] }, 2)).toThrow();
    expect(() => migrateSaveData({}, 3, chain, 2)).toThrow();
  });

  it('the shipped chain has a step for every version below the current one', () => {
    for (let v = BASELINE_SCHEMA_VERSION; v < CURRENT_SCHEMA_VERSION; v++) expect(SAVE_MIGRATIONS[v]).toBeTypeOf('function');
  });
});

describe('readSaveText', () => {
  it('loads a baseline save unchanged: same player after migration as without it', () => {
    const baseline = baselineSave();
    const loaded = readSaveText(JSON.stringify(baseline));
    expect(loaded).toMatchObject({ ok: true, fromVersion: BASELINE_SCHEMA_VERSION, migrated: true, checksum: 'missing' });
    if (!loaded.ok) return;
    for (const [key, value] of Object.entries(baseline)) expect(loaded.data[key]).toEqual(value);

    const direct = Player.fromSaveData(baseline as unknown as PlayerSaveData).toSaveData();
    const viaMigration = Player.fromSaveData(loaded.data as unknown as PlayerSaveData).toSaveData();
    expect(viaMigration).toEqual(direct);
  });

  it('does not migrate a save already at the current version', () => {
    const loaded = readSaveText(sealSave(baselineSave()));
    expect(loaded).toMatchObject({ ok: true, migrated: false, checksum: 'valid' });
  });

  it('reports a save from a newer build instead of guessing', () => {
    expect(readSaveText(sealSave(baselineSave(), CURRENT_SCHEMA_VERSION + 1))).toEqual({ ok: false, reason: 'newer' });
  });

  it('surfaces parse failures with their reason', () => {
    expect(readSaveText('not json')).toEqual({ ok: false, reason: 'invalid' });
    expect(readSaveText('{}')).toEqual({ ok: false, reason: 'shape' });
  });

  it('fills in the adaptive-difficulty state when migrating a baseline save', () => {
    const loaded = readSaveText(JSON.stringify(baselineSave()));
    expect(loaded.ok && loaded.data.adaptive).toEqual({ recent: [] });
  });
});
