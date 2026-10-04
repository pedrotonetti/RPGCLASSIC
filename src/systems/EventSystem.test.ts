import { describe, expect, it } from 'vitest';
import { TileType } from '../config/tiles';
import { getEquipmentTemplate } from '../data/equipment';
import { getGemById } from '../data/gems';
import { getItemById } from '../data/items';
import { createItinerantMerchantNpc, getWorldEventById, WORLD_EVENT_DEFINITIONS } from '../data/worldEvents';
import { Player } from '../entities/Player';
import {
  applyEventConsequence,
  completeActiveEvent,
  createInitialEventState,
  EVENT_CHECK_INTERVAL,
  EVENT_FADE_IN,
  EVENT_FADE_OUT,
  EVENT_GRACE_SECONDS,
  eventIntensity,
  eventWeight,
  formatEventTimeLeft,
  isEventEligible,
  onZoneEnter,
  pickEventTile,
  resolveEventReward,
  restoreEventState,
  serializeEventState,
  startChance,
  tickEvents,
  type EventContext,
  type EventTickContext,
} from './EventSystem';

const invasao = getWorldEventById('invasao_sede')!;
const mercador = getWorldEventById('mercador_itinerante')!;
const arvore = getWorldEventById('arvore_corrompida')!;
const nevoa = getWorldEventById('nevoa_ipera')!;

function ctx(overrides: Partial<EventContext> & { corruption?: number; hope?: number } = {}): EventContext {
  const { corruption = 50, hope = 50, ...rest } = overrides;
  return { zoneId: 'main_city', worldState: { corruption, hope }, playerLevel: 5, night: false, ...rest };
}

function tickCtx(overrides: Partial<EventTickContext> & { corruption?: number; hope?: number } = {}): EventTickContext {
  return { ...ctx(overrides), canStart: true, pickTile: () => ({ x: 10, y: 12 }), ...overrides } as EventTickContext;
}

function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Small deterministic LCG so statistical checks don't depend on Math.random. */
function lcg(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function readyState() {
  const state = createInitialEventState();
  state.nextCheckIn = 0;
  return state;
}

describe('world event data', () => {
  it('has unique ids and sane timings', () => {
    const ids = WORLD_EVENT_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of WORLD_EVENT_DEFINITIONS) {
      expect(d.weight).toBeGreaterThan(0);
      expect(d.durationSeconds).toBeGreaterThan(EVENT_FADE_IN + EVENT_FADE_OUT);
      expect(d.cooldownSeconds).toBeGreaterThan(d.durationSeconds);
      if (d.placement === 'near_player') expect(d.placementRadius?.[0]).toBeLessThan(d.placementRadius![1]);
    }
  });

  it('gives every interactive or combat event a reward and a consequence', () => {
    for (const d of WORLD_EVENT_DEFINITIONS.filter((e) => e.resolution !== 'timed')) {
      expect(d.reward).toBeDefined();
      expect(d.consequence).toBeDefined();
    }
  });

  it('builds a merchant whose stock all exists', () => {
    const npc = createItinerantMerchantNpc('main_city', { x: 4, y: 5 });
    expect(npc.vendor?.noCrafting).toBe(true);
    expect(npc.vendor?.stockRarity).toBe('azul');
    for (const id of npc.vendor?.equipmentTemplateIds ?? []) expect(() => getEquipmentTemplate(id)).not.toThrow();
    for (const id of npc.vendor?.itemIds ?? []) expect(() => getItemById(id)).not.toThrow();
    for (const id of npc.vendor?.gemIds ?? []) expect(() => getGemById(id)).not.toThrow();
    expect([npc.mapX, npc.mapY, npc.zoneId]).toEqual([4, 5, 'main_city']);
  });
});

describe('eligibility and weights', () => {
  it('requires the world-state, level and time conditions', () => {
    expect(isEventEligible(invasao, ctx({ playerLevel: 2 }), {})).toBe(false);
    expect(isEventEligible(invasao, ctx({ playerLevel: 3 }), {})).toBe(true);
    expect(isEventEligible(arvore, ctx({ corruption: 34 }), {})).toBe(false);
    expect(isEventEligible(arvore, ctx({ corruption: 35 }), {})).toBe(true);
    expect(isEventEligible(mercador, ctx({ night: true }), {})).toBe(false);
    expect(isEventEligible(mercador, ctx({ night: false }), {})).toBe(true);
  });

  it('blocks an event on cooldown and one limited to other zones', () => {
    expect(isEventEligible(nevoa, ctx(), { [nevoa.id]: 10 })).toBe(false);
    expect(isEventEligible(nevoa, ctx(), { [nevoa.id]: 0 })).toBe(true);
    expect(isEventEligible({ ...nevoa, zoneIds: ['warrior_start'] }, ctx(), {})).toBe(false);
    expect(isEventEligible({ ...nevoa, zoneIds: ['main_city'] }, ctx(), {})).toBe(true);
  });

  it('makes invasions three times as likely once corruption passes 70', () => {
    const calm = eventWeight(invasao, ctx({ corruption: 70 }));
    const corrupted = eventWeight(invasao, ctx({ corruption: 71 }));
    expect(corrupted).toBeCloseTo(calm * 3, 5);
    expect(eventWeight(invasao, ctx({ corruption: 20 }))).toBeLessThan(calm);
  });

  it('makes the world busier overall when corruption is high', () => {
    const calm = startChance(ctx({ corruption: 50 }), {});
    const corrupted = startChance(ctx({ corruption: 90 }), {});
    expect(corrupted).toBeGreaterThan(calm);
    expect(corrupted).toBeLessThanOrEqual(0.85);
  });
});

describe('tickEvents — starting', () => {
  it('waits for the next-check timer before rolling at all', () => {
    const state = createInitialEventState();
    expect(tickEvents(state, 1, tickCtx(), () => 0)).toEqual([]);
    expect(state.active).toBeNull();
    expect(state.nextCheckIn).toBe(EVENT_GRACE_SECONDS - 1);
  });

  it('starts the first eligible event on a winning roll and records zone, duration and tile', () => {
    const state = readyState();
    const out = tickEvents(state, 1, tickCtx(), () => 0);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('started');
    expect(state.active).toEqual({ defId: invasao.id, zoneId: 'main_city', remaining: invasao.durationSeconds, tile: { x: 10, y: 12 } });
    expect(state.nextCheckIn).toBe(EVENT_CHECK_INTERVAL);
  });

  it('does not start anything on a losing roll, and rolls again a full interval later', () => {
    const state = readyState();
    expect(tickEvents(state, 1, tickCtx(), () => 0.99)).toEqual([]);
    expect(state.active).toBeNull();
    expect(state.nextCheckIn).toBe(EVENT_CHECK_INTERVAL);
  });

  it('never starts while canStart is false (a dungeon) but still ticks cooldowns', () => {
    const state = readyState();
    state.cooldowns[nevoa.id] = 30;
    expect(tickEvents(state, 10, tickCtx({ canStart: false }), () => 0)).toEqual([]);
    expect(state.active).toBeNull();
    expect(state.cooldowns[nevoa.id]).toBe(20);
  });

  it('skips an event that has no spot and falls through to another', () => {
    const state = readyState();
    const pickTile = (def: { id: string }) => (def.id === invasao.id ? null : { x: 3, y: 3 });
    const out = tickEvents(state, 1, tickCtx({ pickTile }), () => 0);
    expect(out[0].type).toBe('started');
    expect(state.active?.defId).toBe(mercador.id);
  });

  it('starts a locationless event (weather) without a tile picker', () => {
    const state = readyState();
    const out = tickEvents(state, 1, tickCtx({ pickTile: undefined, playerLevel: 1, night: true, corruption: 20 }), () => 0);
    expect(out[0].type).toBe('started');
    expect(state.active).toMatchObject({ defId: nevoa.id, tile: null });
  });

  it('starts nothing when every eligible event needs a spot and none has one', () => {
    const state = readyState();
    state.cooldowns[nevoa.id] = 999;
    expect(tickEvents(state, 1, tickCtx({ pickTile: () => null }), () => 0)).toEqual([]);
    expect(state.active).toBeNull();
    expect(state.nextCheckIn).toBe(EVENT_CHECK_INTERVAL);
  });

  it('picks by weight: a roll past the first event lands on the next one', () => {
    const state = readyState();
    // chance roll passes (0), then 0.99 of the total weight lands on the last eligible event
    tickEvents(state, 1, tickCtx(), sequence(0, 0.99));
    expect(state.active?.defId).toBe(nevoa.id);
  });

  it('starts invasions more often in a corrupted world', () => {
    const countInvasions = (corruption: number) => {
      const rng = lcg(42);
      let n = 0;
      for (let i = 0; i < 4000; i++) {
        const state = readyState();
        const out = tickEvents(state, 1, tickCtx({ corruption }), rng);
        if (out[0]?.def.id === invasao.id) n++;
      }
      return n;
    };
    const calm = countInvasions(50);
    const corrupted = countInvasions(90);
    expect(calm).toBeGreaterThan(0);
    expect(corrupted).toBeGreaterThan(calm * 2);
  });
});

describe('tickEvents — running and ending', () => {
  function runningState(zoneId = 'main_city', remaining = 10) {
    const state = createInitialEventState();
    state.active = { defId: invasao.id, zoneId, remaining, tile: { x: 5, y: 5 } };
    return state;
  }

  it('counts the active event down while the player is in its zone', () => {
    const state = runningState();
    expect(tickEvents(state, 4, tickCtx(), () => 0)).toEqual([]);
    expect(state.active?.remaining).toBe(6);
  });

  it('expires it at zero: clears it, starts its cooldown and a quiet period', () => {
    const state = runningState('main_city', 3);
    const out = tickEvents(state, 3, tickCtx(), () => 0);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'expired', def: { id: invasao.id } });
    expect(state.active).toBeNull();
    expect(state.cooldowns[invasao.id]).toBe(invasao.cooldownSeconds);
    expect(state.nextCheckIn).toBeGreaterThanOrEqual(EVENT_GRACE_SECONDS);
  });

  it('does not roll a new event on the frame one expires', () => {
    const state = runningState('main_city', 1);
    state.nextCheckIn = 0;
    const out = tickEvents(state, 5, tickCtx(), () => 0);
    expect(out.map((t) => t.type)).toEqual(['expired']);
  });

  it('keeps the cooldown from letting the same event roll straight back', () => {
    const state = runningState('main_city', 1);
    tickEvents(state, 1, tickCtx(), () => 0);
    expect(isEventEligible(invasao, ctx(), state.cooldowns)).toBe(false);
    tickEvents(state, invasao.cooldownSeconds, tickCtx({ canStart: false }), () => 0);
    expect(isEventEligible(invasao, ctx(), state.cooldowns)).toBe(true);
  });

  it('freezes an event while the player is in another zone (a dungeon trip)', () => {
    const state = runningState('main_city', 10);
    expect(tickEvents(state, 50, tickCtx({ zoneId: 'root_hollow_zone', canStart: false }), () => 0)).toEqual([]);
    expect(state.active?.remaining).toBe(10);
  });

  it('never starts a second event while one is active', () => {
    const state = runningState('main_city', 100);
    state.nextCheckIn = 0;
    expect(tickEvents(state, 1, tickCtx(), () => 0)).toEqual([]);
    expect(state.active?.defId).toBe(invasao.id);
  });
});

describe('onZoneEnter', () => {
  function withActive(zoneId: string) {
    const state = createInitialEventState();
    state.active = { defId: arvore.id, zoneId, remaining: 100, tile: { x: 1, y: 1 } };
    return state;
  }

  it('leaves an event alone in its own zone', () => {
    const state = withActive('main_city');
    expect(onZoneEnter(state, 'main_city', true)).toEqual([]);
    expect(state.active).not.toBeNull();
  });

  it('abandons it on entering a different open-world zone, with a cooldown', () => {
    const state = withActive('main_city');
    const out = onZoneEnter(state, 'warrior_start', true);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'abandoned', def: { id: arvore.id } });
    expect(state.active).toBeNull();
    expect(state.cooldowns[arvore.id]).toBe(arvore.cooldownSeconds);
  });

  it('only freezes it when the new zone is a dungeon', () => {
    const state = withActive('main_city');
    expect(onZoneEnter(state, 'some_dungeon', false)).toEqual([]);
    expect(state.active).not.toBeNull();
  });
});

describe('completing and failing an event', () => {
  it('pays the reward scaled by level, applies its world-state delta and starts the cooldown', () => {
    const player = Player.createNew('Teste', 'warrior');
    player.level = 4;
    player.gold = 0;
    player.worldState.corruption = 60;
    player.worldEvents.active = { defId: arvore.id, zoneId: 'main_city', remaining: 50, tile: { x: 2, y: 2 } };
    const done = completeActiveEvent(player.worldEvents, player, arvore.id);
    expect(done).not.toBeNull();
    expect(done!.xp).toBe(25 + 8 * 4);
    expect(done!.gold).toBe(10 + 4 * 4);
    expect(player.gold).toBe(done!.gold);
    expect(player.worldState.corruption).toBe(56);
    expect(player.worldState.natureBalance).toBe(53);
    expect(player.worldState.counters[`evento_${arvore.id}_resolvido`]).toBe(1);
    expect(player.worldEvents.active).toBeNull();
    expect(player.worldEvents.cooldowns[arvore.id]).toBe(arvore.cooldownSeconds);
  });

  it('does nothing without a matching active event', () => {
    const player = Player.createNew('Teste', 'warrior');
    expect(completeActiveEvent(player.worldEvents, player)).toBeNull();
    player.worldEvents.active = { defId: arvore.id, zoneId: 'main_city', remaining: 50, tile: { x: 2, y: 2 } };
    expect(completeActiveEvent(player.worldEvents, player, invasao.id)).toBeNull();
    expect(player.worldEvents.active).not.toBeNull();
  });

  it('applies the consequence of an ignored invasion (corruption up, hope down)', () => {
    const player = Player.createNew('Teste', 'warrior');
    applyEventConsequence(player, invasao);
    expect(player.worldState.corruption).toBe(54);
    expect(player.worldState.hope).toBe(47);
    expect(player.worldState.counters[`evento_${invasao.id}_ignorado`]).toBe(1);
  });

  it('applies nothing for an event with no consequence', () => {
    const player = Player.createNew('Teste', 'warrior');
    applyEventConsequence(player, mercador);
    expect(player.worldState.corruption).toBe(50);
    expect(player.worldState.hope).toBe(50);
  });

  it('resolveEventReward scales xp and gold with level and folds gold into the effect', () => {
    const r = resolveEventReward({ xp: 10, xpPerLevel: 2, grantGold: 5, goldPerLevel: 1, worldStateDelta: { hope: 1 } }, 10);
    expect(r.xp).toBe(30);
    expect(r.gold).toBe(15);
    expect(r.effect).toEqual({ grantGold: 15, worldStateDelta: { hope: 1 } });
    expect(resolveEventReward({}, 10)).toEqual({ xp: 0, gold: 0, effect: { grantGold: undefined } });
  });
});

describe('persistence', () => {
  it('defaults safely for an old save with no event data (or garbage)', () => {
    for (const raw of [undefined, null, 5, 'x', {}, { active: 3, cooldowns: 'no' }]) {
      const state = restoreEventState(raw);
      expect(state.active).toBeNull();
      expect(state.cooldowns).toEqual({});
      expect(state.nextCheckIn).toBe(EVENT_GRACE_SECONDS);
    }
  });

  it('keeps a valid active event and cooldowns, dropping unknown ids and bad numbers', () => {
    const state = restoreEventState({
      active: { defId: invasao.id, zoneId: 'main_city', remaining: 99999, tile: { x: 3, y: 4 } },
      cooldowns: { [nevoa.id]: 30, ghost_event: 30, [mercador.id]: -5, [arvore.id]: Number.NaN },
    });
    expect(state.active).toEqual({ defId: invasao.id, zoneId: 'main_city', remaining: invasao.durationSeconds, tile: { x: 3, y: 4 } });
    expect(state.cooldowns).toEqual({ [nevoa.id]: 30 });
  });

  it('drops a located event that lost its tile, and one whose definition no longer exists', () => {
    expect(restoreEventState({ active: { defId: invasao.id, zoneId: 'main_city', remaining: 10, tile: null } }).active).toBeNull();
    expect(restoreEventState({ active: { defId: 'ghost', zoneId: 'main_city', remaining: 10, tile: null } }).active).toBeNull();
    expect(restoreEventState({ active: { defId: nevoa.id, zoneId: 'main_city', remaining: 10, tile: null } }).active).toMatchObject({ defId: nevoa.id });
  });

  it('serializes only the active event and cooldowns', () => {
    const state = createInitialEventState();
    state.active = { defId: invasao.id, zoneId: 'main_city', remaining: 20, tile: { x: 1, y: 2 } };
    state.cooldowns[nevoa.id] = 12;
    const saved = serializeEventState(state);
    expect(Object.keys(saved).sort()).toEqual(['active', 'cooldowns']);
    saved.active!.tile!.x = 99;
    expect(state.active.tile!.x).toBe(1);
  });

  it('round-trips through Player save data, and an old save loads with nothing happening', () => {
    const player = Player.createNew('Teste', 'warrior');
    player.worldEvents.active = { defId: arvore.id, zoneId: 'main_city', remaining: 77, tile: { x: 8, y: 9 } };
    player.worldEvents.cooldowns[nevoa.id] = 40;
    const saved = JSON.parse(JSON.stringify(player.toSaveData()));
    const reloaded = Player.fromSaveData(saved);
    expect(reloaded.worldEvents.active).toEqual({ defId: arvore.id, zoneId: 'main_city', remaining: 77, tile: { x: 8, y: 9 } });
    expect(reloaded.worldEvents.cooldowns).toEqual({ [nevoa.id]: 40 });

    delete saved.worldEvents;
    const old = Player.fromSaveData(saved);
    expect(old.worldEvents.active).toBeNull();
    expect(old.worldEvents.cooldowns).toEqual({});
  });
});

describe('eventIntensity / formatEventTimeLeft', () => {
  it('eases in over the first seconds and out over the last', () => {
    const d = nevoa.durationSeconds;
    expect(eventIntensity(nevoa, d)).toBe(0);
    expect(eventIntensity(nevoa, d - EVENT_FADE_IN / 2)).toBeCloseTo(0.5, 5);
    expect(eventIntensity(nevoa, d / 2)).toBe(1);
    expect(eventIntensity(nevoa, EVENT_FADE_OUT / 2)).toBeCloseTo(0.5, 5);
    expect(eventIntensity(nevoa, 0)).toBe(0);
  });

  it('formats seconds as m:ss, rounding up and never going negative', () => {
    expect(formatEventTimeLeft(245)).toBe('4:05');
    expect(formatEventTimeLeft(59.2)).toBe('1:00');
    expect(formatEventTimeLeft(-3)).toBe('0:00');
  });
});

describe('pickEventTile', () => {
  const grass = (w: number, h: number): TileType[][] => Array.from({ length: h }, () => Array.from({ length: w }, () => TileType.Grass));
  const origin = { x: 15, y: 15 };

  it('returns a free grass tile inside the requested ring', () => {
    const tiles = grass(31, 31);
    for (let i = 0; i < 20; i++) {
      const t = pickEventTile(tiles, origin, 5, 8, {}, lcg(i + 1))!;
      const d = Math.hypot(t.x - origin.x, t.y - origin.y);
      expect(d).toBeGreaterThanOrEqual(5);
      expect(d).toBeLessThanOrEqual(8);
    }
  });

  it('respects avoid rects and blocked tiles', () => {
    const tiles = grass(31, 31);
    expect(pickEventTile(tiles, origin, 5, 8, { avoid: [{ x0: 0, y0: 0, x1: 30, y1: 30 }] })).toBeNull();
    expect(pickEventTile(tiles, origin, 5, 8, { isBlocked: () => true })).toBeNull();
    const t = pickEventTile(tiles, origin, 5, 8, { isBlocked: (x) => x < 15 })!;
    expect(t.x).toBeGreaterThanOrEqual(15);
  });

  it('skips tiles that are not grass and tiles hemmed in by obstacles', () => {
    const tiles = grass(31, 31).map((row) => row.map(() => TileType.Tree));
    expect(pickEventTile(tiles, origin, 5, 8)).toBeNull();
    tiles[15][20] = TileType.Grass;
    expect(pickEventTile(tiles, origin, 5, 8)).toBeNull();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) tiles[15 + dy][20 + dx] = TileType.Path;
    expect(pickEventTile(tiles, origin, 5, 8)).toEqual({ x: 20, y: 15 });
  });

  it('stays inside the map near an edge', () => {
    const tiles = grass(12, 12);
    for (let i = 0; i < 30; i++) {
      const t = pickEventTile(tiles, { x: 1, y: 1 }, 2, 6, {}, lcg(i + 7))!;
      expect(t.x).toBeGreaterThanOrEqual(1);
      expect(t.y).toBeGreaterThanOrEqual(1);
    }
  });
});
