import { describe, expect, it } from 'vitest';
import { ENEMY_DEFINITIONS } from '../data/enemies';
import { pickEncounterEnemyIds } from './EncounterSystem';

describe('pickEncounterEnemyIds', () => {
  it('never hands out a boss as random field filler, at any level', () => {
    const bossIds = new Set(ENEMY_DEFINITIONS.filter((e) => e.isBoss).map((e) => e.id));
    expect(bossIds.size).toBeGreaterThan(0);
    for (const level of [1, 10, 18, 30, 60]) {
      for (let i = 0; i < 400; i++) {
        for (const id of pickEncounterEnemyIds(level)) expect(bossIds.has(id)).toBe(false);
      }
    }
  });

  it('still returns real enemy ids', () => {
    const allIds = new Set(ENEMY_DEFINITIONS.map((e) => e.id));
    for (const id of pickEncounterEnemyIds(5)) expect(allIds.has(id)).toBe(true);
  });
});
