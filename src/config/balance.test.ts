import { describe, expect, it } from 'vitest';
import { BOSS_DEFINITIONS } from '../data/bosses';
import { ENEMY_DEFINITIONS } from '../data/enemies';
import { applyEnemyBalance, ENEMY_BALANCE, enemyAttackMultiplier, enemyHpMultiplier } from './balance';

describe('enemy difficulty curve (config/balance.ts)', () => {
  it('toughens every regular enemy and boss: more HP, and never less attack than its hand-authored sheet', () => {
    for (const def of [...ENEMY_DEFINITIONS, ...BOSS_DEFINITIONS]) {
      const balanced = applyEnemyBalance(def);
      expect(balanced.stats.maxHp, def.id).toBeGreaterThan(def.stats.maxHp);
      expect(balanced.stats.attack, def.id).toBeGreaterThanOrEqual(def.stats.attack);
      expect(balanced.stats.magicAttack, def.id).toBeGreaterThanOrEqual(def.stats.magicAttack);
    }
  });

  it('only touches maxHp/attack/magicAttack — defense, speed, luck, MP, rewards, skills and tier are the authored values', () => {
    for (const def of [...ENEMY_DEFINITIONS, ...BOSS_DEFINITIONS]) {
      const balanced = applyEnemyBalance(def);
      expect(balanced.stats.defense).toBe(def.stats.defense);
      expect(balanced.stats.magicDefense).toBe(def.stats.magicDefense);
      expect(balanced.stats.speed).toBe(def.stats.speed);
      expect(balanced.stats.luck).toBe(def.stats.luck);
      expect(balanced.stats.maxMp).toBe(def.stats.maxMp);
      expect(balanced.xpReward).toBe(def.xpReward);
      expect(balanced.goldReward).toBe(def.goldReward);
      expect(balanced.level).toBe(def.level);
      expect(balanced.skills).toBe(def.skills);
    }
  });

  it('keeps a genuinely-zero stat at zero (a melee-only enemy never gains magicAttack)', () => {
    const slime = ENEMY_DEFINITIONS.find((e) => e.id === 'slime')!;
    expect(slime.stats.magicAttack).toBe(0);
    expect(applyEnemyBalance(slime).stats.magicAttack).toBe(0);
  });

  it('HP grows with tier for regular enemies; bosses use their own flat multiplier', () => {
    expect(enemyHpMultiplier(10)).toBeGreaterThan(enemyHpMultiplier(1));
    expect(enemyHpMultiplier(1, true)).toBe(ENEMY_BALANCE.bossHpMult);
    expect(enemyHpMultiplier(20, true)).toBe(ENEMY_BALANCE.bossHpMult);
  });

  it('the attack boost is largest at the lowest tier and fades to (never below) its floor at higher tiers', () => {
    expect(enemyAttackMultiplier(1)).toBe(ENEMY_BALANCE.attackMultBase);
    expect(enemyAttackMultiplier(5)).toBeLessThan(enemyAttackMultiplier(1));
    expect(enemyAttackMultiplier(18)).toBe(ENEMY_BALANCE.attackMultMin);
    expect(enemyAttackMultiplier(100)).toBe(ENEMY_BALANCE.attackMultMin);
  });
});
