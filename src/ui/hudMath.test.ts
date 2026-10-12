import { describe, expect, it } from 'vitest';
import { formatCooldown, lowHpLevel } from './hudMath';

describe('lowHpLevel', () => {
  it('is 0 while healthy, 1 at/below 35%, 2 at/below 15%', () => {
    expect(lowHpLevel(100, 100)).toBe(0);
    expect(lowHpLevel(36, 100)).toBe(0);
    expect(lowHpLevel(35, 100)).toBe(1);
    expect(lowHpLevel(16, 100)).toBe(1);
    expect(lowHpLevel(15, 100)).toBe(2);
    expect(lowHpLevel(1, 100)).toBe(2);
  });

  it('stays off at 0 HP and with a broken max', () => {
    expect(lowHpLevel(0, 100)).toBe(0);
    expect(lowHpLevel(10, 0)).toBe(0);
    expect(lowHpLevel(10, Number.NaN)).toBe(0);
  });
});

describe('formatCooldown', () => {
  it('is empty when ready', () => {
    expect(formatCooldown(0)).toBe('');
    expect(formatCooldown(0.04)).toBe('');
    expect(formatCooldown(-1)).toBe('');
  });

  it('shows tenths with a comma under 10s, rounding up so it never reads 0,0 while still cooling', () => {
    expect(formatCooldown(2.41)).toBe('2,5');
    expect(formatCooldown(0.06)).toBe('0,1');
    expect(formatCooldown(9.95)).toBe('10');
  });

  it('shows whole seconds from 10s up', () => {
    expect(formatCooldown(10)).toBe('10');
    expect(formatCooldown(12.2)).toBe('13');
  });
});
