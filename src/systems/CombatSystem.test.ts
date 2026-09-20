import { afterEach, describe, expect, it, vi } from 'vitest';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { CombatEngine } from './CombatSystem';

function freshPlayer(classId = 'warrior'): Player {
  return Player.createNew('Testador', classId);
}

/**
 * Locks Math.random() to a single value for a test. resolveAttack()'s miss
 * and crit rolls, its damage variance, and the enemy AI's skill-choice roll
 * all read from it. 0.99 guarantees a hit with no crit (both chances cap
 * below that); 0 guarantees a miss (miss chance is always > 0).
 */
function mockRandom(value: number): void {
  vi.spyOn(Math, 'random').mockReturnValue(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CombatEngine.useSkill failure reasons', () => {
  it('fails with "unknown" for a skill id that does not exist on the class', () => {
    const engine = new CombatEngine(freshPlayer(), [new Enemy('slime')]);
    expect(engine.useSkill('not_a_real_skill')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('fails with "mana" and does not start a cooldown when the player lacks the mana cost', () => {
    const player = freshPlayer('warrior');
    player.currentMp = 0;
    const engine = new CombatEngine(player, [new Enemy('slime')]);
    expect(engine.useSkill('warrior_power_strike')).toEqual({ ok: false, reason: 'mana' });
    expect(engine.cooldownRemaining('warrior_power_strike')).toBe(0);
  });

  it('fires once, then fails with "cooldown" on an immediate second use', () => {
    mockRandom(0.99);
    const enemy = new Enemy('slime');
    enemy.currentHp = 1_000_000; // stays alive regardless of hit strength — this test is only about the skill's own cooldown
    const engine = new CombatEngine(freshPlayer('warrior'), [enemy]);
    const first = engine.useSkill('warrior_power_strike');
    expect(first.ok).toBe(true);
    expect(engine.cooldownRemaining('warrior_power_strike')).toBeGreaterThan(0);
    expect(engine.useSkill('warrior_power_strike')).toEqual({ ok: false, reason: 'cooldown' });
  });

  it('fails with "dead" once the engine has already resolved a defeat', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior');
    player.currentHp = 1;
    const enemy = new Enemy('goblin');
    enemy.actionTimer = 0;
    const engine = new CombatEngine(player, [enemy]);

    engine.tick(0.1); // enemy's actionTimer hits 0: begins its telegraphed attack
    engine.tick(0.5); // telegraph elapses: attack resolves, unmitigated, damage >= 1

    expect(engine.outcome).toBe('defeat');
    expect(player.currentHp).toBe(0);
    expect(engine.useSkill('basic_attack', 0)).toEqual({ ok: false, reason: 'dead' });
  });
});

describe('CombatEngine damage application', () => {
  it('a landed hit reduces the target HP by exactly the reported amount', () => {
    mockRandom(0.99);
    const enemy = new Enemy('slime');
    const startHp = enemy.currentHp;
    const engine = new CombatEngine(freshPlayer('warrior'), [enemy]);

    const result = engine.useSkill('basic_attack', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const dmgEvent = result.events.find((e) => e.kind === 'damage');
    expect(dmgEvent?.amount).toBeGreaterThan(0);
    expect(enemy.currentHp).toBe(startHp - dmgEvent!.amount!);
    expect(dmgEvent!.targetHpAfter).toBe(enemy.currentHp);
  });

  it('a missed attack reports "miss" and leaves the target HP untouched', () => {
    mockRandom(0); // 0 < missChance is always true
    const enemy = new Enemy('slime');
    const startHp = enemy.currentHp;
    const engine = new CombatEngine(freshPlayer('warrior'), [enemy]);

    const result = engine.useSkill('basic_attack', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events.some((e) => e.kind === 'miss')).toBe(true);
    expect(result.events.some((e) => e.kind === 'damage')).toBe(false);
    expect(enemy.currentHp).toBe(startHp);
  });
});

describe('CombatEngine victory condition', () => {
  it('stays "ongoing" while any enemy survives and fires "victory" exactly once all are dead', () => {
    mockRandom(0.99);
    const enemyA = new Enemy('slime');
    const enemyB = new Enemy('slime');
    const engine = new CombatEngine(freshPlayer('warrior'), [enemyA, enemyB]);

    enemyA.currentHp = 1;
    const firstKill = engine.useSkill('basic_attack', 0);
    expect(firstKill.ok).toBe(true);
    expect(enemyA.isAlive()).toBe(false);
    expect(engine.outcome).toBe('ongoing');

    engine.tick(1.2); // clears basic_attack's own (short) cooldown from the first kill
    enemyB.currentHp = 1;
    const secondKill = engine.useSkill('basic_attack', 1);
    expect(secondKill.ok).toBe(true);
    expect(engine.outcome).toBe('victory');
    if (secondKill.ok) {
      expect(secondKill.events.filter((e) => e.kind === 'victory')).toHaveLength(1);
    }
  });
});

describe('CombatEngine block and dodge', () => {
  it('an unmitigated hit lands at full damage when neither block nor dodge is active', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior');
    const enemy = new Enemy('slime'); // no skills, so the AI draws no extra random value
    enemy.actionTimer = 0;
    const engine = new CombatEngine(player, [enemy]);

    engine.tick(0.1); // clock=0.1: begins telegraph, resolveAt=0.55
    const hpBefore = player.currentHp;
    const events = engine.tick(0.5); // clock=0.6: resolves

    const hit = events.find((e) => e.kind === 'damage' && e.targetIsPlayer);
    expect(hit?.mitigation).toBeUndefined();
    expect(hit!.amount).toBeGreaterThan(0);
    expect(player.currentHp).toBe(hpBefore - hit!.amount!);
  });

  it('a normal block (outside the perfect-block window) partially mitigates the hit', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior');
    const enemy = new Enemy('dark_wolf'); // hits hard enough that a 35%-of-full remainder still rounds to something nonzero
    enemy.actionTimer = 0;
    const engine = new CombatEngine(player, [enemy]);

    engine.tick(0.1); // resolveAt=0.55
    engine.tick(0.3); // clock=0.4, not yet resolved
    engine.attemptBlock(); // blockStartedAt=0.4, blockActiveUntil=0.9
    const hpBefore = player.currentHp;
    const events = engine.tick(0.3); // clock=0.7: 0.7-0.4=0.3 > 0.15 perfect-block window

    const hit = events.find((e) => e.kind === 'damage' && e.targetIsPlayer);
    expect(hit?.mitigation).toBe('block');
    expect(hit!.amount).toBeGreaterThan(0);
    expect(player.currentHp).toBe(hpBefore - hit!.amount!);
  });

  it('a perfect block (timed at the very start of the window) fully negates the hit', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior');
    const enemy = new Enemy('slime');
    enemy.actionTimer = 0;
    const engine = new CombatEngine(player, [enemy]);

    engine.tick(0.2); // resolveAt=0.65
    engine.tick(0.4); // clock=0.6, not yet resolved
    engine.attemptBlock(); // blockStartedAt=0.6
    const hpBefore = player.currentHp;
    const events = engine.tick(0.05); // clock=0.65: 0.65-0.6=0.05 <= 0.15 perfect window

    const hit = events.find((e) => e.kind === 'damage' && e.targetIsPlayer);
    expect(hit?.mitigation).toBe('perfectBlock');
    expect(hit?.amount).toBe(0);
    expect(player.currentHp).toBe(hpBefore);
  });

  it('a dodge negates the hit entirely while its window is active', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior');
    const enemy = new Enemy('slime');
    enemy.actionTimer = 0;
    const engine = new CombatEngine(player, [enemy]);

    engine.tick(0.1); // resolveAt=0.55
    engine.tick(0.3); // clock=0.4, not yet resolved
    engine.attemptDodge(); // dodgeActiveUntil=0.65
    const hpBefore = player.currentHp;
    const events = engine.tick(0.2); // clock=0.6, within the dodge window

    const hit = events.find((e) => e.kind === 'damage' && e.targetIsPlayer);
    expect(hit?.mitigation).toBe('dodge');
    expect(hit?.amount).toBe(0);
    expect(player.currentHp).toBe(hpBefore);
  });
});
