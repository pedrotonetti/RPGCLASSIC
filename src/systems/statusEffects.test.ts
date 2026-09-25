import { describe, expect, it } from 'vitest';
import {
  activeStatusTypes,
  applyStatusEffect,
  hasStatusEffect,
  statusSpeedMultiplier,
  tickStatusEffects,
  type StatusEffectHolder,
} from './statusEffects';

function holder(): StatusEffectHolder {
  return { statusEffects: [] };
}

describe('applyStatusEffect', () => {
  it('adds a fresh effect with a duration and a tick-derived damage for DoT types', () => {
    const h = holder();
    applyStatusEffect(h, 'bleed', 100);
    expect(h.statusEffects).toHaveLength(1);
    expect(h.statusEffects[0].type).toBe('bleed');
    expect(h.statusEffects[0].remaining).toBeGreaterThan(0);
    expect(h.statusEffects[0].tickDamage).toBeGreaterThan(0);
  });

  it('refreshes duration/strength instead of stacking a second instance of the same type', () => {
    const h = holder();
    applyStatusEffect(h, 'bleed', 10);
    const firstTickDamage = h.statusEffects[0].tickDamage;
    h.statusEffects[0].remaining = 0.5; // let it nearly expire
    applyStatusEffect(h, 'bleed', 100); // reapply with a much bigger hit
    expect(h.statusEffects).toHaveLength(1); // still one entry, not two
    expect(h.statusEffects[0].remaining).toBeGreaterThan(0.5); // duration refreshed
    expect(h.statusEffects[0].tickDamage).toBeGreaterThan(firstTickDamage); // strength re-rolled off the new hit
  });

  it('slow carries no tick damage but does carry a <1 speed multiplier', () => {
    const h = holder();
    applyStatusEffect(h, 'slow', 50);
    expect(h.statusEffects[0].tickDamage).toBe(0);
    expect(h.statusEffects[0].slowMult).toBeLessThan(1);
    expect(h.statusEffects[0].slowMult).toBeGreaterThan(0);
  });

  it('different effect types on the same holder coexist independently', () => {
    const h = holder();
    applyStatusEffect(h, 'bleed', 20);
    applyStatusEffect(h, 'burn', 20);
    expect(h.statusEffects).toHaveLength(2);
    expect(hasStatusEffect(h, 'bleed')).toBe(true);
    expect(hasStatusEffect(h, 'burn')).toBe(true);
    expect(hasStatusEffect(h, 'slow')).toBe(false);
  });
});

describe('tickStatusEffects', () => {
  it('deals no damage before the first tick interval elapses', () => {
    const h = holder();
    applyStatusEffect(h, 'bleed', 100);
    const result = tickStatusEffects(h, 0.1);
    expect(result.damage).toBe(0);
    expect(result.ticked).toEqual([]);
  });

  it('deals its tick damage once the tick interval elapses, and keeps ticking on subsequent intervals', () => {
    const h = holder();
    applyStatusEffect(h, 'bleed', 100);
    const expectedTick = h.statusEffects[0].tickDamage;

    const first = tickStatusEffects(h, 1.0); // exactly one tick interval
    expect(first.damage).toBe(expectedTick);
    expect(first.ticked).toEqual(['bleed']);

    const second = tickStatusEffects(h, 1.0);
    expect(second.damage).toBe(expectedTick);
  });

  it('sums damage across multiple ticks that land within one large dt', () => {
    const h = holder();
    applyStatusEffect(h, 'burn', 100);
    const per = h.statusEffects[0].tickDamage;
    const result = tickStatusEffects(h, 3.0); // 3 whole tick intervals in one frame
    expect(result.damage).toBe(per * 3);
    expect(result.ticked).toHaveLength(3);
  });

  it('expires and removes the effect once its full duration has elapsed', () => {
    const h = holder();
    applyStatusEffect(h, 'slow', 10);
    const duration = h.statusEffects[0].remaining;
    const result = tickStatusEffects(h, duration + 0.01);
    expect(result.expired).toEqual(['slow']);
    expect(h.statusEffects).toHaveLength(0);
    expect(hasStatusEffect(h, 'slow')).toBe(false);
  });

  it('slow never deals damage, however long it ticks', () => {
    const h = holder();
    applyStatusEffect(h, 'slow', 999);
    const result = tickStatusEffects(h, 100);
    expect(result.damage).toBe(0);
    expect(result.ticked).toEqual([]);
  });
});

describe('statusSpeedMultiplier / activeStatusTypes', () => {
  it('is 1 with no active slow', () => {
    const h = holder();
    applyStatusEffect(h, 'bleed', 10);
    expect(statusSpeedMultiplier(h)).toBe(1);
  });

  it('drops below 1 while slow is active', () => {
    const h = holder();
    applyStatusEffect(h, 'slow', 10);
    expect(statusSpeedMultiplier(h)).toBeLessThan(1);
  });

  it('activeStatusTypes reflects exactly the currently-active effect types', () => {
    const h = holder();
    applyStatusEffect(h, 'burn', 10);
    applyStatusEffect(h, 'slow', 10);
    expect(activeStatusTypes(h).sort()).toEqual(['burn', 'slow']);
  });
});
