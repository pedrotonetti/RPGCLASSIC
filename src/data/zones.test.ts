import { describe, expect, it } from 'vitest';
import { getQuestById } from './quests';
import { BALUARTE_AMANHECER_ID, effectiveMonsterCount, getZoneById } from './zones';

describe('effectiveMonsterCount', () => {
  const baluarte = getZoneById(BALUARTE_AMANHECER_ID);

  it('returns the zone\'s full monster count when its zoneState is unset or doesn\'t match resolvedState', () => {
    expect(effectiveMonsterCount(baluarte, null)).toBe(baluarte.monsterCount);
    expect(effectiveMonsterCount(baluarte, 'something_else')).toBe(baluarte.monsterCount);
  });

  it('halves the monster count once the zone reaches its own resolvedState', () => {
    expect(effectiveMonsterCount(baluarte, 'reerguido')).toBe(Math.round(baluarte.monsterCount * 0.5));
  });

  it('never reacts for a zone with no resolvedState of its own', () => {
    const ancoradouro = getZoneById('ancoradouro_vau');
    expect(ancoradouro.resolvedState).toBeUndefined();
    expect(effectiveMonsterCount(ancoradouro, 'reerguido')).toBe(ancoradouro.monsterCount);
  });
});

describe('worsenedState (the mirror of resolvedState)', () => {
  const city = getZoneById('main_city');

  it('adds 30% more monsters once the zone reaches its own worsenedState, and only then', () => {
    expect(city.worsenedState).toBe('faminto');
    expect(effectiveMonsterCount(city, 'faminto')).toBe(Math.round(city.monsterCount * 1.3));
    expect(effectiveMonsterCount(city, 'faminto')).toBeGreaterThan(city.monsterCount);
    expect(effectiveMonsterCount(city, null)).toBe(city.monsterCount);
    expect(effectiveMonsterCount(city, 'reerguido')).toBe(city.monsterCount);
  });

  it('never reacts for a zone with no worsenedState of its own', () => {
    const baluarte = getZoneById(BALUARTE_AMANHECER_ID);
    expect(baluarte.worsenedState).toBeUndefined();
    expect(effectiveMonsterCount(baluarte, 'faminto')).toBe(baluarte.monsterCount);
  });
});

describe('baluarte_r3_cisterna wires its own zoneState into ChoiceEffect', () => {
  it('labels the Baluarte do Amanhecer zone "reerguido" on completion, alongside its existing world-state/event effects', () => {
    const quest = getQuestById('baluarte_r3_cisterna');
    expect(quest).toBeDefined();
    expect(quest?.onCompleteEffect?.zoneState).toEqual({ zoneId: BALUARTE_AMANHECER_ID, state: 'reerguido' });
    expect(quest?.onCompleteEffect?.markEventId).toBe('baluarte_amanhecer_reerguido');
  });
});
