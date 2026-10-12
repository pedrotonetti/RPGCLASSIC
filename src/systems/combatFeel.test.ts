import { describe, expect, it } from 'vitest';
import {
  CombatFeel,
  MAX_HIT_STOP,
  MAX_SHAKE_OFFSET,
  combatZoomFactor,
  damagePopupStyle,
  hitSeverity,
  hitStopForHit,
  shakeTraumaForHit,
} from './combatFeel';

describe('hit severity / shake / hit-stop', () => {
  it('severity is the share of max HP removed, clamped', () => {
    expect(hitSeverity(25, 100)).toBe(0.25);
    expect(hitSeverity(500, 100)).toBe(1);
    expect(hitSeverity(10, 0)).toBe(0);
    expect(hitSeverity(-5, 100)).toBe(0);
  });

  it('shake scales with damage relative to max HP, not raw damage', () => {
    const chip = shakeTraumaForHit({ amount: 3, targetMaxHp: 100 });
    const big = shakeTraumaForHit({ amount: 30, targetMaxHp: 100 });
    const lateGameChip = shakeTraumaForHit({ amount: 300, targetMaxHp: 10000 });
    expect(big).toBeGreaterThan(chip);
    expect(lateGameChip).toBeCloseTo(chip, 6);
  });

  it('crits and kills shake harder; dodges never shake; blocks shake less', () => {
    const base = { amount: 10, targetMaxHp: 100 };
    expect(shakeTraumaForHit({ ...base, crit: true })).toBeGreaterThan(shakeTraumaForHit(base));
    expect(shakeTraumaForHit({ ...base, killed: true })).toBeGreaterThan(shakeTraumaForHit(base));
    expect(shakeTraumaForHit({ ...base, mitigation: 'dodge' })).toBe(0);
    expect(shakeTraumaForHit({ ...base, targetIsPlayer: true, mitigation: 'block' })).toBeLessThan(shakeTraumaForHit({ ...base, targetIsPlayer: true }));
  });

  it('only heavy moments get a hit-stop, never longer than the cap', () => {
    expect(hitStopForHit({ amount: 5, targetMaxHp: 100 })).toBe(0);
    expect(hitStopForHit({ amount: 5, targetMaxHp: 100, crit: true })).toBeGreaterThan(0);
    expect(hitStopForHit({ amount: 25, targetMaxHp: 100 })).toBeGreaterThan(0);
    expect(hitStopForHit({ amount: 5, targetMaxHp: 100, killed: true })).toBeGreaterThan(0);
    expect(hitStopForHit({ amount: 1000, targetMaxHp: 100, crit: true, killed: true })).toBeLessThanOrEqual(MAX_HIT_STOP);
    expect(hitStopForHit({ amount: 90, targetMaxHp: 100, mitigation: 'dodge' })).toBe(0);
  });
});

describe('combatZoomFactor', () => {
  it('is 1 outside combat and grows (capped) with the number of engaged enemies', () => {
    expect(combatZoomFactor(false, 3)).toBe(1);
    expect(combatZoomFactor(true, 0)).toBe(1);
    expect(combatZoomFactor(true, 1)).toBeGreaterThan(1);
    expect(combatZoomFactor(true, 3)).toBeGreaterThan(combatZoomFactor(true, 1));
    expect(combatZoomFactor(true, 50)).toBeCloseTo(1.18, 6);
  });
});

describe('damagePopupStyle', () => {
  it('keeps the original wording', () => {
    expect(damagePopupStyle({ kind: 'miss' })?.text).toBe('Errou!');
    expect(damagePopupStyle({ kind: 'damage', amount: 12 })?.text).toBe('-12');
    expect(damagePopupStyle({ kind: 'damage', amount: 12, affinity: 'weak' })?.text).toBe('-12 Fraco!');
    expect(damagePopupStyle({ kind: 'damage', amount: 12, affinity: 'resist' })?.text).toBe('-12 Resistiu');
    expect(damagePopupStyle({ kind: 'heal', amount: 7 })?.text).toBe('+7');
  });

  it('styles by type', () => {
    expect(damagePopupStyle({ kind: 'damage', amount: 12, crit: true })?.variant).toBe('crit');
    expect(damagePopupStyle({ kind: 'damage', amount: 12, element: 'fire' })).toMatchObject({ variant: 'elemental', element: 'fire' });
    expect(damagePopupStyle({ kind: 'damage', amount: 12, affinity: 'weak', element: 'ice' })).toMatchObject({ variant: 'weak', element: 'ice' });
    expect(damagePopupStyle({ kind: 'damage', amount: 12, targetIsPlayer: true })?.variant).toBe('player');
    expect(damagePopupStyle({ kind: 'heal', amount: 3 })?.variant).toBe('heal');
  });

  it('returns null for events that show no number', () => {
    expect(damagePopupStyle({ kind: 'buff' })).toBeNull();
    expect(damagePopupStyle({ kind: 'damage', amount: 0 })).toBeNull();
    expect(damagePopupStyle({ kind: 'defeated' })).toBeNull();
  });
});

describe('CombatFeel', () => {
  it('freezes the simulation for the hit-stop and then resumes', () => {
    const feel = new CombatFeel();
    feel.requestHitStop(0.05);
    expect(feel.tick(0.016)).toBe(0);
    expect(feel.tick(0.016)).toBe(0);
    expect(feel.tick(0.016)).toBe(0);
    // Only 0.002s of stop left — the rest of the frame runs.
    expect(feel.tick(0.016)).toBeCloseTo(0.014, 6);
    expect(feel.tick(0.016)).toBe(0.016);
  });

  it('overlapping hit-stops take the max, not the sum', () => {
    const feel = new CombatFeel();
    feel.requestHitStop(0.05);
    feel.requestHitStop(0.04);
    feel.requestHitStop(0.05);
    expect(feel.tick(0.06)).toBeCloseTo(0.01, 6);
  });

  it('shake decays to zero and stays within the max offset', () => {
    const feel = new CombatFeel();
    feel.addTrauma(1);
    const out = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < 30; i++) {
      feel.tick(0.016);
      feel.shakeOffset(out);
      expect(Math.abs(out.x)).toBeLessThanOrEqual(MAX_SHAKE_OFFSET);
      expect(Math.abs(out.z)).toBeLessThanOrEqual(MAX_SHAKE_OFFSET);
    }
    for (let i = 0; i < 120; i++) feel.tick(0.016);
    expect(feel.currentTrauma()).toBe(0);
    expect(feel.shakeOffset(out)).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('shakeOffset writes into the given object (no allocation)', () => {
    const feel = new CombatFeel();
    feel.addTrauma(0.8);
    feel.tick(0.01);
    const out = { x: 0, y: 0, z: 0 };
    expect(feel.shakeOffset(out)).toBe(out);
  });

  it('"Tremor de tela" desligado: no trauma accumulates', () => {
    const feel = new CombatFeel();
    feel.configure({ screenShake: 0 });
    feel.onHit({ amount: 90, targetMaxHp: 100, crit: true });
    expect(feel.currentTrauma()).toBe(0);
    // Hit-stop is independent of the shake option.
    expect(feel.isHitStopped()).toBe(true);
  });

  it('"Suave" halves the shake amplitude compared to "Normal"', () => {
    const normal = new CombatFeel();
    const soft = new CombatFeel();
    soft.configure({ screenShake: 0.5 });
    for (const f of [normal, soft]) {
      f.addTrauma(0.9);
      f.tick(0.02);
    }
    const a = normal.shakeOffset({ x: 0, y: 0, z: 0 });
    const b = soft.shakeOffset({ x: 0, y: 0, z: 0 });
    expect(b.x).toBeCloseTo(a.x * 0.5, 6);
  });

  it('"Reduzir movimento" disables shake, hit-stop and zoom, and clears anything in flight', () => {
    const feel = new CombatFeel();
    feel.onBossPhase();
    expect(feel.isHitStopped()).toBe(true);
    expect(feel.currentTrauma()).toBeGreaterThan(0);
    feel.configure({ reduceMotion: true });
    expect(feel.isHitStopped()).toBe(false);
    expect(feel.currentTrauma()).toBe(0);
    feel.onBossPhase();
    feel.onHit({ amount: 100, targetMaxHp: 100, crit: true, killed: true });
    expect(feel.tick(0.016)).toBe(0.016);
    expect(feel.currentTrauma()).toBe(0);
    expect(feel.zoomEnabled()).toBe(false);
  });

  it('a boss phase change is a stronger cue than an ordinary crit', () => {
    const boss = new CombatFeel();
    const crit = new CombatFeel();
    boss.onBossPhase();
    crit.onHit({ amount: 10, targetMaxHp: 100, crit: true });
    expect(boss.currentTrauma()).toBeGreaterThan(crit.currentTrauma());
  });

  it('reset drops shake and freeze', () => {
    const feel = new CombatFeel();
    feel.onBossPhase();
    feel.reset();
    expect(feel.currentTrauma()).toBe(0);
    expect(feel.tick(0.016)).toBe(0.016);
  });
});
