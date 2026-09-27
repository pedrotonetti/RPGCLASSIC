import { describe, expect, it } from 'vitest';
import type { EnemyArchetype } from '../config/types';
import { makeSkill } from './skillMath';
import {
  ARCHETYPE_PROFILES,
  DEFAULT_ARCHETYPE_PROFILE,
  archetypeActionIntervalMultiplier,
  archetypeDamageMultiplier,
  archetypeProfileFor,
  chaseSpeedMultiplierFor,
  isEnraged,
  pickSkillForArchetype,
  telegraphTextFor,
} from './enemyArchetypes';

const ALL_ARCHETYPES: EnemyArchetype[] = ['predator', 'tank', 'support', 'ambusher', 'summoner', 'berserker', 'controller', 'guardian', 'mimic'];

const attackSkill = makeSkill({ id: 'atk', name: 'Golpe', description: '', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 5, baseCost: 0, basePower: 1 });
const inflictingSkill = makeSkill({ id: 'inflict', name: 'Veneno', description: '', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 5, baseCost: 0, basePower: 1, inflicts: { type: 'bleed', chance: 0.5 } });
const healSkill = makeSkill({ id: 'heal', name: 'Cura', description: '', kind: 'heal', target: 'self', unlockLevel: 1, baseCooldown: 5, baseCost: 0, basePower: 1 });

describe('archetypeProfileFor', () => {
  it('returns the neutral default (every multiplier a no-op) for an unset archetype', () => {
    expect(archetypeProfileFor(undefined)).toBe(DEFAULT_ARCHETYPE_PROFILE);
    expect(DEFAULT_ARCHETYPE_PROFILE.aggroRadiusMult).toBe(1);
    expect(DEFAULT_ARCHETYPE_PROFILE.deaggroRadiusMult).toBe(1);
    expect(DEFAULT_ARCHETYPE_PROFILE.chaseSpeedMult).toBe(1);
    expect(DEFAULT_ARCHETYPE_PROFILE.enrageBelowHpFraction).toBe(0);
    expect(DEFAULT_ARCHETYPE_PROFILE.skillUseChanceMult).toBe(1);
  });

  it('resolves every declared archetype to its own profile', () => {
    for (const archetype of ALL_ARCHETYPES) {
      const profile = archetypeProfileFor(archetype);
      expect(profile.id).toBe(archetype);
      expect(profile).toBe(ARCHETYPE_PROFILES[archetype]);
    }
  });
});

describe('isEnraged / archetypeDamageMultiplier / archetypeActionIntervalMultiplier', () => {
  it('never enrages a profile with enrageBelowHpFraction 0, at any HP including exactly 0', () => {
    const profile = archetypeProfileFor('predator'); // no enrage threshold set
    expect(isEnraged(profile, 1)).toBe(false);
    expect(isEnraged(profile, 0.01)).toBe(false);
    expect(isEnraged(profile, 0)).toBe(false);
    expect(archetypeDamageMultiplier(profile, 0)).toBe(1);
    expect(archetypeActionIntervalMultiplier(profile, 0)).toBe(1);
  });

  it('berserker enrages at/below its threshold, not above it', () => {
    const profile = archetypeProfileFor('berserker');
    expect(isEnraged(profile, 0.51)).toBe(false);
    expect(isEnraged(profile, 0.5)).toBe(true);
    expect(isEnraged(profile, 0.1)).toBe(true);
    expect(archetypeDamageMultiplier(profile, 0.5)).toBe(profile.enrageDamageMult);
    expect(archetypeDamageMultiplier(profile, 0.51)).toBe(1);
    // A smaller resulting interval means it acts sooner (enraged = faster).
    expect(archetypeActionIntervalMultiplier(profile, 0.3)).toBeCloseTo(1 / profile.enrageSpeedMult);
    expect(archetypeActionIntervalMultiplier(profile, 0.3)).toBeLessThan(1);
  });
});

describe('chaseSpeedMultiplierFor', () => {
  it('leaves every non-huntsWoundedPlayer archetype unchanged regardless of player HP', () => {
    for (const archetype of ALL_ARCHETYPES.filter((a) => a !== 'predator')) {
      const profile = archetypeProfileFor(archetype);
      expect(chaseSpeedMultiplierFor(profile, 1)).toBe(1);
      expect(chaseSpeedMultiplierFor(profile, 0)).toBe(1);
    }
  });

  it("predator closes in faster the lower the player's HP fraction is, capping at a 1.5x ceiling at 0 HP", () => {
    const profile = archetypeProfileFor('predator');
    expect(chaseSpeedMultiplierFor(profile, 1)).toBe(1);
    expect(chaseSpeedMultiplierFor(profile, 0)).toBeCloseTo(1.5);
    const half = chaseSpeedMultiplierFor(profile, 0.5);
    expect(half).toBeGreaterThan(1);
    expect(half).toBeLessThan(1.5);
  });

  it('clamps an out-of-range player HP fraction instead of extrapolating past its own bounds', () => {
    const profile = archetypeProfileFor('predator');
    expect(chaseSpeedMultiplierFor(profile, -1)).toBe(chaseSpeedMultiplierFor(profile, 0));
    expect(chaseSpeedMultiplierFor(profile, 2)).toBe(chaseSpeedMultiplierFor(profile, 1));
  });
});

describe('pickSkillForArchetype', () => {
  it('returns null when nothing is usable', () => {
    expect(pickSkillForArchetype(DEFAULT_ARCHETYPE_PROFILE, [])).toBeNull();
  });

  it('picks uniformly among usable skills for a profile with no preference (matches the pre-archetype behavior exactly)', () => {
    const rng = (() => {
      const seq = [0.9, 0.1];
      let i = 0;
      return () => seq[i++ % seq.length];
    })();
    expect(pickSkillForArchetype(DEFAULT_ARCHETYPE_PROFILE, [attackSkill, healSkill], rng)).toBe(healSkill);
    expect(pickSkillForArchetype(DEFAULT_ARCHETYPE_PROFILE, [attackSkill, healSkill], rng)).toBe(attackSkill);
  });

  it("controller strongly prefers a skill that carries a status inflict, when the preference roll (rng() < 0.8) succeeds", () => {
    const profile = archetypeProfileFor('controller');
    const rng = () => 0.1; // always "succeeds" the 0.8 preference roll, and always index 0 of whichever pool is picked from
    expect(pickSkillForArchetype(profile, [attackSkill, inflictingSkill], rng)).toBe(inflictingSkill);
  });

  it('controller falls back to the uniform pool when nothing usable actually inflicts anything', () => {
    const profile = archetypeProfileFor('controller');
    const rng = () => 0.1;
    expect(pickSkillForArchetype(profile, [attackSkill, healSkill], rng)).toBe(attackSkill);
  });

  it("support strongly prefers its heal skill when the preference roll succeeds, and falls back otherwise", () => {
    const profile = archetypeProfileFor('support');
    const alwaysSucceed = () => 0.1;
    expect(pickSkillForArchetype(profile, [attackSkill, healSkill], alwaysSucceed)).toBe(healSkill);
    // Preference roll fails (>= 0.8) -> falls through to the uniform pick.
    const seq = [0.95, 0.0];
    let i = 0;
    const failsPreference = () => seq[i++ % seq.length];
    expect(pickSkillForArchetype(profile, [attackSkill, healSkill], failsPreference)).toBe(attackSkill);
  });
});

describe('telegraphTextFor', () => {
  it('names the enemy and uses each profile\'s own tell verb', () => {
    expect(telegraphTextFor(DEFAULT_ARCHETYPE_PROFILE, 'Seiva Ressequida')).toBe('Seiva Ressequida vai atacar!');
    expect(telegraphTextFor(archetypeProfileFor('berserker'), 'Colosso Ressequido')).toBe('Colosso Ressequido entra em fúria!');
  });
});

describe('every declared archetype profile', () => {
  it('has a non-empty label and tell verb, and never a negative/zero multiplier that would freeze or reverse behavior', () => {
    for (const archetype of ALL_ARCHETYPES) {
      const profile = archetypeProfileFor(archetype);
      expect(profile.label.length).toBeGreaterThan(0);
      expect(profile.tellVerb.length).toBeGreaterThan(0);
      expect(profile.aggroRadiusMult).toBeGreaterThan(0);
      expect(profile.deaggroRadiusMult).toBeGreaterThan(0);
      expect(profile.chaseSpeedMult).toBeGreaterThan(0);
      expect(profile.skillUseChanceMult).toBeGreaterThan(0);
      expect(profile.enrageBelowHpFraction).toBeGreaterThanOrEqual(0);
      expect(profile.enrageBelowHpFraction).toBeLessThanOrEqual(1);
    }
  });
});
