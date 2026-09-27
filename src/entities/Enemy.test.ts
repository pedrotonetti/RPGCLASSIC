import { describe, expect, it } from 'vitest';
import { applyEnemyBalance } from '../config/balance';
import { getBossById } from '../data/bosses';
import { getEnemyById } from '../data/enemies';
import { Enemy } from './Enemy';

describe('Enemy stat resolution (shared difficulty curve)', () => {
  it('an ordinary spawn fights with its definition run through config/balance.ts, not the raw hand-authored sheet', () => {
    const slime = new Enemy('slime');
    expect(slime.stats).toEqual(applyEnemyBalance(getEnemyById('slime')).stats);
    expect(slime.stats.maxHp).toBeGreaterThan(getEnemyById('slime').stats.maxHp);
    expect(slime.currentHp).toBe(slime.stats.maxHp);
  });

  it('dungeon bosses (data/bosses.ts) go through the same curve', () => {
    const ooze = new Enemy('boss_root_ooze');
    expect(ooze.stats).toEqual(applyEnemyBalance(getBossById('boss_root_ooze')!).stats);
  });
});

describe('Enemy tierMultiplier (repeatable-dungeon scaling)', () => {
  it('defaults to no tier scaling at all — identical to an explicit tier-1 spawn', () => {
    const plain = new Enemy('slime');
    const explicitTierOne = new Enemy('slime', 1);
    expect(plain.stats).toEqual(explicitTierOne.stats);
    expect(plain.def.xpReward).toBe(explicitTierOne.def.xpReward);
    expect(plain.def.goldReward).toBe(explicitTierOne.def.goldReward);
    expect(plain.def.level).toBe(explicitTierOne.def.level);
  });

  it('scales every positive stat, XP/gold reward and the loot-tier level by the given multiplier', () => {
    const base = new Enemy('goblin').def;
    const scaled = new Enemy('goblin', 2).def;

    expect(scaled.stats.maxHp).toBe(Math.round(base.stats.maxHp * 2));
    expect(scaled.stats.attack).toBe(Math.round(base.stats.attack * 2));
    expect(scaled.stats.defense).toBe(Math.round(base.stats.defense * 2));
    expect(scaled.xpReward).toBe(Math.round(base.xpReward * 2));
    expect(scaled.goldReward).toBe(Math.round(base.goldReward * 2));
    expect(scaled.level).toBe(Math.round(base.level * 2));
  });

  it('a scaled-up enemy starts combat at its own scaled max HP, not the base one', () => {
    const base = new Enemy('goblin');
    const scaled = new Enemy('goblin', 2.5);
    expect(scaled.currentHp).toBe(scaled.stats.maxHp);
    expect(scaled.currentHp).toBeGreaterThan(base.currentHp);
  });

  it('never scales a genuinely-zero stat away from zero (e.g. a melee-only enemy\'s magicAttack)', () => {
    const scaled = new Enemy('slime', 3.4).def; // slime: magicAttack 0, maxMp 0
    expect(scaled.stats.magicAttack).toBe(0);
    expect(scaled.stats.maxMp).toBe(0);
  });

  it('leaves name/color/skills/isBoss untouched — only numbers scale', () => {
    const base = new Enemy('goblin').def;
    const scaled = new Enemy('goblin', 3).def;
    expect(scaled.name).toBe(base.name);
    expect(scaled.color).toBe(base.color);
    expect(scaled.skills).toBe(base.skills);
    expect(scaled.isBoss).toBe(base.isBoss);
  });
});
