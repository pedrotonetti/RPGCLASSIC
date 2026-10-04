import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from '../config/gameConfig';
import { Player, type PlayerSaveData } from '../entities/Player';
import { SAVE_SLOT_COUNT, deleteSlotSave, exportSlot, importSlot, listSaveSlots, loadSlot, loadSlotSave, previewImport, saveToSlot } from './SaveSystem';
import { CURRENT_SCHEMA_VERSION, sealSave, type SaveRecord } from './saveFormat';

const slotKey = (slot: number): string => `${STORAGE_KEY}:slot${slot}`;
const backupKey = (slot: number): string => `${slotKey(slot)}:backup`;

interface MemoryStorage extends Storage {
  /** Keys whose setItem should throw (simulating a full quota). */
  failOn: Set<string>;
}

function makeMemoryStorage(): MemoryStorage {
  const store = new Map<string, string>();
  const failOn = new Set<string>();
  return {
    failOn,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failOn.has(key)) throw new Error('QuotaExceededError');
      store.set(key, value);
    },
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  } as MemoryStorage;
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = makeMemoryStorage();
  vi.stubGlobal('localStorage', storage);
});

function hero(gold = 100): Player {
  const player = Player.createNew('Aurora', 'mage');
  player.gold = gold;
  return player;
}

function raw(key: string): string {
  const value = storage.getItem(key);
  if (value === null) throw new Error(`no value at ${key}`);
  return value;
}

function goldIn(key: string): number {
  return (JSON.parse(raw(key)) as PlayerSaveData).gold;
}

describe('saving', () => {
  it('writes the schema version and checksum, and stays readable as a plain PlayerSaveData', () => {
    saveToSlot(0, hero(250));
    const stored = JSON.parse(raw(slotKey(0))) as SaveRecord;
    expect(stored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(stored.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(stored.gold).toBe(250);
    expect(stored.name).toBe('Aurora');
  });

  it('round-trips the player through a slot', () => {
    const player = hero(777);
    player.level = 6;
    saveToSlot(1, player);
    const result = loadSlot(1);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.recoveredFromBackup).toBe(false);
    expect(result.player.toSaveData()).toEqual(player.toSaveData());
  });

  it('keeps the previous save as a backup before each overwrite', () => {
    saveToSlot(0, hero(100));
    expect(storage.getItem(backupKey(0))).toBeNull();
    saveToSlot(0, hero(200));
    expect(goldIn(backupKey(0))).toBe(100);
    saveToSlot(0, hero(300));
    expect(goldIn(backupKey(0))).toBe(200);
    expect(goldIn(slotKey(0))).toBe(300);
  });

  it('still saves when the backup write fails (full storage)', () => {
    saveToSlot(0, hero(100));
    storage.failOn.add(backupKey(0));
    saveToSlot(0, hero(200));
    expect(goldIn(slotKey(0))).toBe(200);
  });
});

describe('baseline saves (no schemaVersion, no checksum)', () => {
  function seedBaseline(slot: number, gold: number): PlayerSaveData {
    const data = JSON.parse(JSON.stringify(hero(gold).toSaveData())) as Partial<PlayerSaveData>;
    delete data.adaptive;
    storage.setItem(slotKey(slot), JSON.stringify(data));
    return data as PlayerSaveData;
  }

  it('lists and loads an existing save unchanged', () => {
    const baseline = seedBaseline(0, 555);
    expect(listSaveSlots()[0]).toEqual({ slot: 0, summary: { classId: 'mage', level: 1, name: 'Aurora' } });
    const player = loadSlotSave(0);
    expect(player).not.toBeNull();
    expect(player!.gold).toBe(555);
    expect(player!.toSaveData()).toEqual(Player.fromSaveData(baseline).toSaveData());
  });

  it('upgrades the stored format on the next save and keeps the old text as the backup', () => {
    seedBaseline(0, 555);
    const original = raw(slotKey(0));
    saveToSlot(0, loadSlotSave(0)!);
    expect((JSON.parse(raw(slotKey(0))) as SaveRecord).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(raw(backupKey(0))).toBe(original);
  });

  it('still migrates the pre-slot legacy key into slot 0', () => {
    storage.setItem(STORAGE_KEY, JSON.stringify(hero(42).toSaveData()));
    expect(listSaveSlots()[0]?.summary.name).toBe('Aurora');
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadSlotSave(0)!.gold).toBe(42);
  });

  it('lists every empty slot as null', () => {
    expect(listSaveSlots()).toEqual(Array.from({ length: SAVE_SLOT_COUNT }, () => null));
  });
});

describe('corruption and backup fallback', () => {
  function corruptMain(slot: number): void {
    storage.setItem(slotKey(slot), raw(slotKey(slot)).replace(/"gold":\d+/, '"gold":1'));
  }

  it('falls back to the backup when the live save fails its checksum, and restores it', () => {
    saveToSlot(0, hero(100));
    saveToSlot(0, hero(200));
    corruptMain(0);
    const result = loadSlot(0);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.recoveredFromBackup).toBe(true);
    expect(result.player.gold).toBe(100);
    expect(goldIn(slotKey(0))).toBe(100);
  });

  it('falls back to the backup when the live save is truncated JSON', () => {
    saveToSlot(0, hero(100));
    saveToSlot(0, hero(200));
    storage.setItem(slotKey(0), raw(slotKey(0)).slice(0, 30));
    const result = loadSlot(0);
    expect(result).toMatchObject({ status: 'ok', recoveredFromBackup: true });
    expect(listSaveSlots()[0]?.summary.name).toBe('Aurora');
  });

  it('reports corrupt when neither copy is readable, without deleting anything', () => {
    saveToSlot(0, hero(100));
    saveToSlot(0, hero(200));
    corruptMain(0);
    storage.setItem(backupKey(0), 'lixo');
    expect(loadSlot(0).status).toBe('corrupt');
    expect(listSaveSlots()[0]).toBeNull();
    expect(storage.getItem(slotKey(0))).not.toBeNull();
  });

  it('reports corrupt for a damaged save that never had a backup', () => {
    saveToSlot(0, hero(100));
    corruptMain(0);
    expect(loadSlot(0).status).toBe('corrupt');
  });

  it('does not let a corrupt live save replace a good backup on the next write', () => {
    saveToSlot(0, hero(100));
    saveToSlot(0, hero(200));
    corruptMain(0);
    storage.setItem(slotKey(0), '{"quebrado":');
    saveToSlot(0, hero(300));
    expect(goldIn(backupKey(0))).toBe(100);
    expect(goldIn(slotKey(0))).toBe(300);
  });

  it('falls back when the live save parses but cannot build a player (unknown class)', () => {
    saveToSlot(0, hero(100));
    saveToSlot(0, hero(200));
    storage.setItem(slotKey(0), sealSave({ ...(JSON.parse(raw(slotKey(0))) as SaveRecord), classId: 'classe_que_nao_existe' }));
    expect(loadSlot(0)).toMatchObject({ status: 'ok', recoveredFromBackup: true });
  });

  it('refuses a save from a newer build without touching it or using the older backup', () => {
    saveToSlot(0, hero(100));
    saveToSlot(0, hero(200));
    const future = sealSave(JSON.parse(raw(slotKey(0))) as SaveRecord, CURRENT_SCHEMA_VERSION + 1);
    storage.setItem(slotKey(0), future);
    expect(loadSlot(0).status).toBe('newer');
    expect(raw(slotKey(0))).toBe(future);
  });
});

describe('deleting', () => {
  it('removes the live save and its backup, including the legacy slot-0 key', () => {
    saveToSlot(0, hero(100));
    saveToSlot(0, hero(200));
    storage.setItem(STORAGE_KEY, 'legado');
    deleteSlotSave(0);
    expect(storage.getItem(slotKey(0))).toBeNull();
    expect(storage.getItem(backupKey(0))).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(loadSlot(0).status).toBe('empty');
  });

  it('leaves other slots alone', () => {
    saveToSlot(0, hero(1));
    saveToSlot(1, hero(2));
    deleteSlotSave(0);
    expect(loadSlotSave(1)!.gold).toBe(2);
  });
});

describe('export and import', () => {
  it('exports a sealed JSON file named after the character', () => {
    const player = hero(900);
    player.name = 'Ágata Ñandú';
    player.level = 3;
    saveToSlot(2, player);
    const file = exportSlot(2)!;
    expect(file.filename).toBe('sede-slot3-agata-nandu-nv3.json');
    expect(JSON.parse(file.text)).toMatchObject({ gold: 900, schemaVersion: CURRENT_SCHEMA_VERSION });
  });

  it('exports nothing for an empty or unreadable slot', () => {
    expect(exportSlot(0)).toBeNull();
    saveToSlot(0, hero(1));
    storage.setItem(slotKey(0), 'lixo');
    expect(exportSlot(0)).toBeNull();
  });

  it('round-trips a save from one slot into another', () => {
    const player = hero(1234);
    player.xp = 17;
    saveToSlot(0, player);
    const file = exportSlot(0)!;
    const result = importSlot(2, file.text);
    expect(result).toEqual({ ok: true, summary: { classId: 'mage', level: 1, name: 'Aurora' } });
    expect(loadSlotSave(2)!.toSaveData()).toEqual(player.toSaveData());
  });

  it('imports a baseline (pre-schema) save file and upgrades it', () => {
    const data = JSON.parse(JSON.stringify(hero(88).toSaveData())) as Partial<PlayerSaveData>;
    delete data.adaptive;
    expect(importSlot(1, JSON.stringify(data)).ok).toBe(true);
    expect((JSON.parse(raw(slotKey(1))) as SaveRecord).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(loadSlotSave(1)!.gold).toBe(88);
  });

  it('keeps the replaced character as the slot backup', () => {
    saveToSlot(1, hero(10));
    const incoming = sealSave(JSON.parse(JSON.stringify(hero(20).toSaveData())) as SaveRecord);
    expect(importSlot(1, incoming).ok).toBe(true);
    expect(goldIn(slotKey(1))).toBe(20);
    expect(goldIn(backupKey(1))).toBe(10);
  });

  it('rejects bad files with a pt-BR reason and leaves the slot untouched', () => {
    saveToSlot(0, hero(5));
    const before = raw(slotKey(0));
    const good = sealSave(JSON.parse(JSON.stringify(hero(6).toSaveData())) as SaveRecord);
    const cases: Array<[string, RegExp]> = [
      ['isto não é json', /JSON/],
      ['{"foo":1}', /não parece/],
      [good.replace(/"gold":\d+/, '"gold":99999'), /corrompido|alterado/],
      [sealSave({ ...(JSON.parse(good) as SaveRecord), classId: 'nao_existe' }), /não reconhece/],
      [sealSave(JSON.parse(good) as SaveRecord, CURRENT_SCHEMA_VERSION + 1), /mais nova/],
      ['x'.repeat(5_000_001), /grande demais/],
    ];
    for (const [text, message] of cases) {
      const result = importSlot(0, text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatch(message);
    }
    expect(raw(slotKey(0))).toBe(before);
  });

  it('previews without writing anything', () => {
    const file = sealSave(JSON.parse(JSON.stringify(hero(6).toSaveData())) as SaveRecord);
    expect(previewImport(file)).toEqual({ ok: true, summary: { classId: 'mage', level: 1, name: 'Aurora' } });
    expect(storage.length).toBe(0);
  });

  it('reports a failed write instead of pretending to import', () => {
    storage.failOn.add(slotKey(0));
    const file = sealSave(JSON.parse(JSON.stringify(hero(6).toSaveData())) as SaveRecord);
    const result = importSlot(0, file);
    expect(result.ok).toBe(false);
  });
});
