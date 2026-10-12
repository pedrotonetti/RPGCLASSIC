import { describe, expect, it } from 'vitest';
import { ROOM_EVENTS, getRoomEvent } from '../data/dungeonRooms';
import { seededRng } from './DungeonModifierSystem';
import { applyRoomOutcome, isCombatRoom, roomGoldAmount, rollDungeonRooms, rollRoomOutcome, type RoomPlayerLike } from './DungeonRoomSystem';

function hero(over: Partial<RoomPlayerLike> = {}): RoomPlayerLike {
  return { currentHp: 100, currentMp: 50, gold: 0, stats: { maxHp: 100, maxMp: 50 }, ...over };
}

describe('room event data', () => {
  it('every event has choices whose outcome chances sum to 1', () => {
    for (const event of ROOM_EVENTS) {
      expect(event.choices.length).toBeGreaterThanOrEqual(2);
      for (const choice of event.choices) {
        const total = choice.outcomes.reduce((s, o) => s + o.chance, 0);
        expect(total).toBeCloseTo(1);
      }
    }
  });

  it('the shrine offers the blessing / gold / heal trade-off', () => {
    const shrine = ROOM_EVENTS.find((e) => e.kind === 'shrine')!;
    const outcomes = shrine.choices.map((c) => c.outcomes[0]);
    expect(outcomes.some((o) => o.blessing)).toBe(true);
    expect(outcomes.some((o) => o.goldUnits)).toBe(true);
    expect(outcomes.some((o) => o.fullRestore)).toBe(true);
  });
});

describe('rollDungeonRooms', () => {
  it('returns one room per encounter, always opening with a plain ambush', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rooms = rollDungeonRooms(5, seededRng(seed));
      expect(rooms).toHaveLength(5);
      expect(rooms[0].kind).toBe('combat');
    }
  });

  it('never rolls more than one natural shrine, trap or elite, and gives special rooms an event id', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rooms = rollDungeonRooms(5, seededRng(seed));
      for (const kind of ['shrine', 'trap', 'elite'] as const) {
        expect(rooms.filter((r) => r.kind === kind).length).toBeLessThanOrEqual(1);
      }
      for (const room of rooms) {
        if (room.kind === 'shrine' || room.kind === 'trap') {
          expect(getRoomEvent(room.eventId!)?.kind).toBe(room.kind);
        } else {
          expect(room.eventId).toBeUndefined();
        }
      }
    }
  });

  it('guarantees at least one special room in a 3+ room run', () => {
    const allCombat = () => 0; // weight roll 0 = always 'combat'
    const rooms = rollDungeonRooms(3, allCombat);
    expect(rooms.filter((r) => !isCombatRoom(r.kind))).toHaveLength(1);
    expect(rooms[1].kind).toBe('shrine');
  });

  it('produces every room type across seeds (variety)', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 100; seed++) for (const r of rollDungeonRooms(4, seededRng(seed))) seen.add(r.kind);
    expect(seen).toEqual(new Set(['combat', 'elite', 'shrine', 'trap']));
  });

  it('extraElites converts plain ambushes (from the boss end, never the first room) into elite rooms', () => {
    const rooms = rollDungeonRooms(3, () => 0, 5);
    expect(rooms[0].kind).toBe('combat');
    expect(rooms.filter((r) => r.kind === 'elite').length).toBeGreaterThanOrEqual(1);
  });

  it('is deterministic for a seed', () => {
    expect(rollDungeonRooms(5, seededRng(77), 1)).toEqual(rollDungeonRooms(5, seededRng(77), 1));
  });
});

describe('room choices', () => {
  const pit = getRoomEvent('fosso_espinhos')!;
  const shrine = getRoomEvent('santuario_seiva')!;

  it('rollRoomOutcome picks by chance and rejects unknown choices', () => {
    expect(rollRoomOutcome(pit, 'saltar', () => 0.1).hpLossPct).toBeUndefined();
    expect(rollRoomOutcome(pit, 'saltar', () => 0.9).hpLossPct).toBe(0.2);
    expect(() => rollRoomOutcome(pit, 'voar', () => 0)).toThrow();
  });

  it('trap damage never kills', () => {
    const player = hero({ currentHp: 5 });
    const result = applyRoomOutcome(player, rollRoomOutcome(pit, 'saltar', () => 0.99), { recommendedLevel: 6, tier: 1 });
    expect(player.currentHp).toBe(1);
    expect(result.hpLost).toBe(4);
  });

  it('a mana cost is paid when possible, otherwise it costs health instead', () => {
    const rich = hero();
    applyRoomOutcome(rich, rollRoomOutcome(pit, 'desarmar', () => 0), { recommendedLevel: 6, tier: 1, fallbackHpLossPct: 0.15 });
    expect(rich.currentMp).toBe(35);
    expect(rich.currentHp).toBe(100);

    const dry = hero({ currentMp: 2 });
    const result = applyRoomOutcome(dry, rollRoomOutcome(pit, 'desarmar', () => 0), { recommendedLevel: 6, tier: 1, fallbackHpLossPct: 0.15 });
    expect(dry.currentMp).toBe(2);
    expect(dry.currentHp).toBe(85);
    expect(result.message).toContain('Sem mana');
  });

  it('shrine: gold scales with dungeon level and tier, heal restores fully, blessing is handed back', () => {
    const p = hero({ currentHp: 10, currentMp: 0 });
    const gold = applyRoomOutcome(p, rollRoomOutcome(shrine, 'ouro', () => 0), { recommendedLevel: 11, tier: 3 });
    expect(gold.gold).toBe(roomGoldAmount(1, 11, 3));
    expect(p.gold).toBe(gold.gold);
    expect(roomGoldAmount(1, 11, 3)).toBeGreaterThan(roomGoldAmount(1, 11, 1));
    expect(roomGoldAmount(1, 16, 1)).toBeGreaterThan(roomGoldAmount(1, 6, 1));

    const heal = applyRoomOutcome(p, rollRoomOutcome(shrine, 'cura', () => 0), { recommendedLevel: 11, tier: 3 });
    expect(heal.restored).toBe(true);
    expect(p.currentHp).toBe(100);
    expect(p.currentMp).toBe(50);

    const bless = applyRoomOutcome(p, rollRoomOutcome(shrine, 'bencao', () => 0), { recommendedLevel: 11, tier: 3 });
    expect(bless.blessing).toEqual({ damageDealt: 0.12 });
  });
});
