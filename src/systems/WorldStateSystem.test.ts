import { describe, expect, it } from 'vitest';
import {
  adjustFactionReputation,
  adjustWorldState,
  createInitialWorldState,
  getCounter,
  getFactionReputation,
  getZoneState,
  hasCompletedEvent,
  hasFlag,
  incrementCounter,
  markEventCompleted,
  setFlag,
  setZoneState,
  worldMoodFactor,
} from './WorldStateSystem';

describe('createInitialWorldState', () => {
  it('starts every axis neutral (50) and every collection empty', () => {
    const state = createInitialWorldState();
    expect(state.corruption).toBe(50);
    expect(state.hope).toBe(50);
    expect(state.trust).toBe(50);
    expect(state.natureBalance).toBe(50);
    expect(state.factionReputation).toEqual({});
    expect(state.flags).toEqual({});
    expect(state.counters).toEqual({});
    expect(state.completedEvents).toEqual({});
    expect(state.zoneStates).toEqual({});
  });
});

describe('adjustWorldState', () => {
  it('applies a delta to only the axes it mentions', () => {
    const state = createInitialWorldState();
    adjustWorldState(state, { hope: 10 });
    expect(state.hope).toBe(60);
    expect(state.corruption).toBe(50);
  });

  it('applies deltas to multiple axes in one call', () => {
    const state = createInitialWorldState();
    adjustWorldState(state, { corruption: -5, hope: 5, trust: 2 });
    expect(state.corruption).toBe(45);
    expect(state.hope).toBe(55);
    expect(state.trust).toBe(52);
    expect(state.natureBalance).toBe(50);
  });

  it('clamps at the 0..100 boundary in both directions', () => {
    const state = createInitialWorldState();
    adjustWorldState(state, { hope: 1000 });
    expect(state.hope).toBe(100);
    adjustWorldState(state, { corruption: -1000 });
    expect(state.corruption).toBe(0);
  });

  it('is a no-op for an axis left out of the delta or explicitly 0', () => {
    const state = createInitialWorldState();
    adjustWorldState(state, { hope: 0 });
    expect(state.hope).toBe(50);
    adjustWorldState(state, {});
    expect(state).toEqual(createInitialWorldState());
  });
});

describe('flags', () => {
  it('defaults to false/unset and reflects setFlag afterward', () => {
    const state = createInitialWorldState();
    expect(hasFlag(state, 'met_hermit')).toBe(false);
    setFlag(state, 'met_hermit');
    expect(hasFlag(state, 'met_hermit')).toBe(true);
  });

  it('can be explicitly set back to false', () => {
    const state = createInitialWorldState();
    setFlag(state, 'burned_grove', true);
    setFlag(state, 'burned_grove', false);
    expect(hasFlag(state, 'burned_grove')).toBe(false);
  });
});

describe('counters', () => {
  it('starts at 0 and accumulates', () => {
    const state = createInitialWorldState();
    expect(getCounter(state, 'corrupted_slain')).toBe(0);
    incrementCounter(state, 'corrupted_slain');
    incrementCounter(state, 'corrupted_slain', 4);
    expect(getCounter(state, 'corrupted_slain')).toBe(5);
  });
});

describe('faction reputation', () => {
  it('defaults to neutral (0) for an unknown faction', () => {
    const state = createInitialWorldState();
    expect(getFactionReputation(state, 'pedravale')).toBe(0);
  });

  it('accumulates and clamps to -100..100', () => {
    const state = createInitialWorldState();
    adjustFactionReputation(state, 'pedravale', 40);
    expect(getFactionReputation(state, 'pedravale')).toBe(40);
    adjustFactionReputation(state, 'pedravale', 1000);
    expect(getFactionReputation(state, 'pedravale')).toBe(100);
    adjustFactionReputation(state, 'pedravale', -1000);
    expect(getFactionReputation(state, 'pedravale')).toBe(-100);
  });
});

describe('completed events', () => {
  it('is false until markEventCompleted, then stays true', () => {
    const state = createInitialWorldState();
    expect(hasCompletedEvent(state, 'caravan_ambush')).toBe(false);
    markEventCompleted(state, 'caravan_ambush');
    expect(hasCompletedEvent(state, 'caravan_ambush')).toBe(true);
  });
});

describe('zone states', () => {
  it('is null until set, then reads back the exact label', () => {
    const state = createInitialWorldState();
    expect(getZoneState(state, 'pedravale')).toBeNull();
    setZoneState(state, 'pedravale', 'restored');
    expect(getZoneState(state, 'pedravale')).toBe('restored');
  });
});

describe('worldMoodFactor', () => {
  it('reads exactly 0.5 for the neutral starting state', () => {
    expect(worldMoodFactor(createInitialWorldState())).toBeCloseTo(0.5, 5);
  });

  it('rises toward 1 as hope overtakes corruption', () => {
    const state = createInitialWorldState();
    adjustWorldState(state, { hope: 50, corruption: -50 });
    expect(worldMoodFactor(state)).toBeCloseTo(1, 5);
  });

  it('falls toward 0 as corruption overtakes hope', () => {
    const state = createInitialWorldState();
    adjustWorldState(state, { hope: -50, corruption: 50 });
    expect(worldMoodFactor(state)).toBeCloseTo(0, 5);
  });

  it('stays within 0..1 at the extremes', () => {
    const state = createInitialWorldState();
    adjustWorldState(state, { hope: 100, corruption: -100 });
    expect(worldMoodFactor(state)).toBeLessThanOrEqual(1);
    adjustWorldState(state, { hope: -1000, corruption: 1000 });
    expect(worldMoodFactor(state)).toBeGreaterThanOrEqual(0);
  });
});
