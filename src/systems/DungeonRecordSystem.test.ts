import { describe, expect, it } from 'vitest';
import { Player, type PlayerSaveData } from '../entities/Player';
import { readSaveText, sealSave, CURRENT_SCHEMA_VERSION, type SaveRecord } from './saveFormat';
import {
  cloneDungeonRecords,
  describeDungeonRecord,
  formatClearTime,
  normalizeDungeonRecords,
  recordDungeonClear,
  type DungeonRecords,
} from './DungeonRecordSystem';

describe('recordDungeonClear', () => {
  it('counts clears, keeps the fastest time with its tier and the most Distorções', () => {
    const records: DungeonRecords = {};
    expect(recordDungeonClear(records, 'root_hollow', { tier: 1, seconds: 300, modifierCount: 1 }).newFastest).toBe(true);
    expect(recordDungeonClear(records, 'root_hollow', { tier: 2, seconds: 420, modifierCount: 3 }).newFastest).toBe(false);
    const third = recordDungeonClear(records, 'root_hollow', { tier: 3, seconds: 250.44, modifierCount: 2 });
    expect(third.newFastest).toBe(true);
    expect(records.root_hollow).toEqual({ clears: 3, fastestSeconds: 250.4, fastestTier: 3, mostModifiers: 3 });
  });

  it('an untimed clear still counts but never touches the speed record', () => {
    const records: DungeonRecords = {};
    const { newFastest } = recordDungeonClear(records, 'x', { tier: 1, modifierCount: 0 });
    expect(newFastest).toBe(false);
    expect(records.x).toEqual({ clears: 1, fastestSeconds: null, fastestTier: 0, mostModifiers: 0 });
  });
});

describe('normalizeDungeonRecords', () => {
  it('defaults missing/malformed data to an empty record set', () => {
    expect(normalizeDungeonRecords(undefined)).toEqual({});
    expect(normalizeDungeonRecords(null)).toEqual({});
    expect(normalizeDungeonRecords([1, 2])).toEqual({});
    expect(normalizeDungeonRecords('lixo')).toEqual({});
  });

  it('cleans bad fields per entry', () => {
    expect(normalizeDungeonRecords({ a: { clears: -3, fastestSeconds: 'rápido', mostModifiers: 2.7 }, b: 5 })).toEqual({
      a: { clears: 0, fastestSeconds: null, fastestTier: 0, mostModifiers: 2 },
    });
    const ok = { clears: 2, fastestSeconds: 99.5, fastestTier: 4, mostModifiers: 3 };
    expect(normalizeDungeonRecords({ ok })).toEqual({ ok });
  });

  it('clone is deep', () => {
    const records: DungeonRecords = { a: { clears: 1, fastestSeconds: 10, fastestTier: 1, mostModifiers: 1 } };
    const copy = cloneDungeonRecords(records);
    copy.a.clears = 99;
    expect(records.a.clears).toBe(1);
  });
});

describe('formatting', () => {
  it('formats m:ss', () => {
    expect(formatClearTime(0)).toBe('0:00');
    expect(formatClearTime(65.9)).toBe('1:05');
    expect(formatClearTime(600)).toBe('10:00');
  });

  it('describes a record for the portal panel', () => {
    expect(describeDungeonRecord(0, undefined)).toBe('Ainda não concluída.');
    expect(describeDungeonRecord(2, undefined)).toBe('Melhor tier: 2');
    expect(describeDungeonRecord(3, { clears: 4, fastestSeconds: 247, fastestTier: 2, mostModifiers: 2 })).toBe(
      'Melhor tier: 3 · Mais rápida: 4:07 (Tier 2) · Vitórias: 4',
    );
  });
});

describe('Save 2.0 integration', () => {
  it('a save from before Dungeons 2.0 (no dungeonRecords) still loads, with empty records — no schema bump', () => {
    const data = JSON.parse(JSON.stringify(Player.createNew('Antigo', 'mage').toSaveData())) as Partial<PlayerSaveData>;
    delete data.dungeonRecords;
    const loaded = readSaveText(sealSave(data as SaveRecord));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.fromVersion).toBe(CURRENT_SCHEMA_VERSION);
    const player = Player.fromSaveData(loaded.data as unknown as PlayerSaveData);
    expect(player.dungeonRecords).toEqual({});
  });

  it('records round-trip through a sealed save', () => {
    const player = Player.createNew('Recordista', 'warrior');
    recordDungeonClear(player.dungeonRecords, 'root_hollow', { tier: 2, seconds: 181, modifierCount: 2 });
    const loaded = readSaveText(sealSave(player.toSaveData() as unknown as SaveRecord));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const back = Player.fromSaveData(loaded.data as unknown as PlayerSaveData);
    expect(back.dungeonRecords).toEqual(player.dungeonRecords);
  });

  it('session-only run rules are never written to the save', () => {
    const player = Player.createNew('Sessão', 'warrior');
    player.dungeonRunMods = { critChance: 0.15 };
    player.dungeonHealingMult = 0.6;
    const data = player.toSaveData() as unknown as Record<string, unknown>;
    expect(data.dungeonRunMods).toBeUndefined();
    expect(data.dungeonHealingMult).toBeUndefined();
    expect(data.pendingDungeonPlan).toBeUndefined();
  });
});
