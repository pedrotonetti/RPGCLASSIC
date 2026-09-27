import { describe, expect, it } from 'vitest';
import type { BossPhaseDefinition } from '../config/types';
import { makeSkill } from './skillMath';
import { effectiveSkillsForPhase, phaseActionIntervalMultiplier, phaseDamageMultiplier, phaseIndexForHp } from './BossPhaseSystem';

const baseSkill = makeSkill({ id: 'base', name: 'Base', description: '', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 5, baseCost: 0, basePower: 1 });
const phase2Skill = makeSkill({ id: 'p2', name: 'Fase 2', description: '', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 5, baseCost: 0, basePower: 1.5 });

const TWO_PHASES: BossPhaseDefinition[] = [{}, { hpThreshold: 0.5, transitionText: 'metade', skills: [phase2Skill], damageMult: 1.2, actionIntervalMult: 0.8 }];
const THREE_PHASES: BossPhaseDefinition[] = [
  {},
  { hpThreshold: 0.65, transitionText: 'fase 2' },
  { hpThreshold: 0.3, transitionText: 'fase 3', damageMult: 1.3 },
];

describe('phaseIndexForHp', () => {
  it('returns 0 for an enemy with no phases at all, at any HP', () => {
    expect(phaseIndexForHp(undefined, 1)).toBe(0);
    expect(phaseIndexForHp(undefined, 0)).toBe(0);
    expect(phaseIndexForHp([], 0.1)).toBe(0);
  });

  it('stays at 0 above every threshold', () => {
    expect(phaseIndexForHp(TWO_PHASES, 1)).toBe(0);
    expect(phaseIndexForHp(TWO_PHASES, 0.51)).toBe(0);
  });

  it('crosses into phase 1 exactly at its threshold, not just below it', () => {
    expect(phaseIndexForHp(TWO_PHASES, 0.5)).toBe(1);
    expect(phaseIndexForHp(TWO_PHASES, 0.2)).toBe(1);
    expect(phaseIndexForHp(TWO_PHASES, 0)).toBe(1);
  });

  it('with 3 phases, resolves each band to its own index', () => {
    expect(phaseIndexForHp(THREE_PHASES, 1)).toBe(0);
    expect(phaseIndexForHp(THREE_PHASES, 0.7)).toBe(0);
    expect(phaseIndexForHp(THREE_PHASES, 0.65)).toBe(1);
    expect(phaseIndexForHp(THREE_PHASES, 0.4)).toBe(1);
    expect(phaseIndexForHp(THREE_PHASES, 0.3)).toBe(2);
    expect(phaseIndexForHp(THREE_PHASES, 0)).toBe(2);
  });

  it('jumps straight to the deepest applicable phase on a big HP drop, never landing on an intermediate one', () => {
    // A single hit taking a fresh boss from 100% straight to 10% should land
    // on phase 2 directly, not phase 1 (which the fight technically also
    // "passed through" but was never actually observed at).
    expect(phaseIndexForHp(THREE_PHASES, 0.1)).toBe(2);
  });
});

describe('effectiveSkillsForPhase', () => {
  it('falls back to the base pool when phases is undefined or the current phase sets none', () => {
    expect(effectiveSkillsForPhase([baseSkill], undefined, 0)).toEqual([baseSkill]);
    expect(effectiveSkillsForPhase([baseSkill], THREE_PHASES, 1)).toEqual([baseSkill]); // phase 1 above sets no skills override
  });

  it("uses the active phase's own skill pool when it sets one", () => {
    expect(effectiveSkillsForPhase([baseSkill], TWO_PHASES, 1)).toEqual([phase2Skill]);
  });
});

describe('phaseDamageMultiplier / phaseActionIntervalMultiplier', () => {
  it('is 1 (no change) for an enemy with no phases, or a phase that sets neither field', () => {
    expect(phaseDamageMultiplier(undefined, 0)).toBe(1);
    expect(phaseActionIntervalMultiplier(undefined, 0)).toBe(1);
    expect(phaseDamageMultiplier(THREE_PHASES, 0)).toBe(1);
    expect(phaseDamageMultiplier(THREE_PHASES, 1)).toBe(1); // phase 1 sets no damageMult
  });

  it("reads the active phase's own multipliers when it sets them", () => {
    expect(phaseDamageMultiplier(TWO_PHASES, 1)).toBe(1.2);
    expect(phaseActionIntervalMultiplier(TWO_PHASES, 1)).toBe(0.8);
    expect(phaseDamageMultiplier(THREE_PHASES, 2)).toBe(1.3);
  });
});
