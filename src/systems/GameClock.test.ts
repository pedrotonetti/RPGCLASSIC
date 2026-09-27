import { describe, expect, it } from 'vitest';
import { advanceGameClock, createInitialGameClock, dayNightFactor, formatTimeOfDay, hourOfDay, isNight } from './GameClock';

describe('createInitialGameClock', () => {
  it('starts at 07:00 — a fresh morning, not midnight', () => {
    const clock = createInitialGameClock();
    expect(hourOfDay(clock)).toBeCloseTo(7, 5);
    expect(formatTimeOfDay(clock)).toBe('07:00');
  });
});

describe('advanceGameClock', () => {
  it('moves dayProgress forward proportionally to elapsed seconds', () => {
    const clock = createInitialGameClock();
    const before = clock.dayProgress;
    advanceGameClock(clock, 60);
    expect(clock.dayProgress).toBeGreaterThan(before);
  });

  it('wraps around past midnight instead of exceeding 1', () => {
    const clock = { dayProgress: 0.999 };
    advanceGameClock(clock, 12 * 60); // a full day-length in seconds
    expect(clock.dayProgress).toBeGreaterThanOrEqual(0);
    expect(clock.dayProgress).toBeLessThan(1);
  });
});

describe('formatTimeOfDay', () => {
  it('pads hours and minutes to two digits', () => {
    expect(formatTimeOfDay({ dayProgress: 0 })).toBe('00:00');
    expect(formatTimeOfDay({ dayProgress: 0.5 })).toBe('12:00');
  });
});

describe('dayNightFactor', () => {
  it('peaks at 1 around 13:00 and troughs at 0 around 01:00', () => {
    expect(dayNightFactor({ dayProgress: 13 / 24 })).toBeCloseTo(1, 5);
    expect(dayNightFactor({ dayProgress: 1 / 24 })).toBeCloseTo(0, 5);
  });

  it('stays within 0..1 across the full cycle', () => {
    for (let h = 0; h < 24; h += 0.5) {
      const factor = dayNightFactor({ dayProgress: h / 24 });
      expect(factor).toBeGreaterThanOrEqual(0);
      expect(factor).toBeLessThanOrEqual(1);
    }
  });

  it('is symmetric around noon/midnight (14:00 and 12:00 are equally bright)', () => {
    expect(dayNightFactor({ dayProgress: 12 / 24 })).toBeCloseTo(dayNightFactor({ dayProgress: 14 / 24 }), 5);
  });
});

describe('isNight', () => {
  it('is true in the dead of night and false at midday', () => {
    expect(isNight({ dayProgress: 2 / 24 })).toBe(true);
    expect(isNight({ dayProgress: 13 / 24 })).toBe(false);
  });
});
