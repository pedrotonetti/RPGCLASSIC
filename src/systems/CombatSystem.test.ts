import { afterEach, describe, expect, it, vi } from 'vitest';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { CombatEngine, lootDropChance, materialDropChance } from './CombatSystem';
import * as equipmentModule from '../data/equipment';

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

describe('CombatEngine loot scaling by enemy tier', () => {
  it('drop-chance helpers scale with enemy level, cap sensibly, and give bosses a large floor regardless of level', () => {
    expect(lootDropChance(1, false)).toBeCloseTo(0.32 + 1 * 0.018, 5);
    expect(lootDropChance(18, false)).toBeGreaterThan(lootDropChance(1, false));
    expect(lootDropChance(18, false)).toBeLessThanOrEqual(0.85);
    expect(lootDropChance(1, true)).toBe(0.95);
    expect(lootDropChance(18, true)).toBe(0.95);

    expect(materialDropChance(18)).toBeGreaterThan(materialDropChance(1));
    expect(materialDropChance(1000)).toBeLessThanOrEqual(0.75);
  });

  it('a dropped item is leveled off the DEFEATED ENEMY\'s own tier, not just the (much lower) player level', () => {
    // random()=0.5 clears the miss check (capped at 0.25) without ever
    // crit-ing (capped at 0.5), and zeroes generateLoot's own +/-1 jitter
    // (0.5*2-1=0), so the resulting item level is an exact, deterministic
    // read of the enemyLevel*0.7 + characterLevel*0.3 formula. It also
    // clears stone_golem's own loot-drop-chance roll (0.32+11*0.018=0.518).
    mockRandom(0.5);
    const player = freshPlayer('warrior'); // level 1
    const enemy = new Enemy('stone_golem'); // level 11 per data/enemies.ts — far above the player's own level
    enemy.currentHp = 1;
    const engine = new CombatEngine(player, [enemy]);

    const result = engine.useSkill('basic_attack', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const victoryEvent = result.events.find((e) => e.kind === 'victory');
    expect(victoryEvent?.loot).toHaveLength(1);
    // 11*0.7 + 1*0.3 = 8 — driven by the enemy's tier, not the level-1 player.
    expect(victoryEvent!.loot![0].itemLevel).toBe(8);
  });

  it('statistically, defeating a high-tier enemy yields both a higher average item level and drops more often than a low-tier one, at the same player level', () => {
    const TRIALS = 500;
    const generateLootSpy = vi.spyOn(equipmentModule, 'generateLoot');

    function farmAverages(enemyId: string): { avgItemLevel: number; dropCount: number } {
      generateLootSpy.mockClear();
      let levelSum = 0;
      let dropCount = 0;
      for (let i = 0; i < TRIALS; i++) {
        const player = freshPlayer('warrior');
        const enemy = new Enemy(enemyId);
        enemy.currentHp = 1;
        const engine = new CombatEngine(player, [enemy]);
        let result = engine.useSkill('basic_attack', 0);
        // A miss just means no kill this swing — retry until it connects, so
        // the miss-chance roll doesn't add noise to the drop-rate comparison.
        while (result.ok && engine.outcome === 'ongoing') {
          engine.tick(1.2); // clears basic_attack's own (short) cooldown
          result = engine.useSkill('basic_attack', 0);
        }
        if (!result.ok) continue;
        const victoryEvent = result.events.find((e) => e.kind === 'victory');
        if (victoryEvent && victoryEvent.loot && victoryEvent.loot.length > 0) {
          dropCount += 1;
          levelSum += victoryEvent.loot[0].itemLevel;
        }
      }
      return { avgItemLevel: dropCount > 0 ? levelSum / dropCount : 0, dropCount };
    }

    const low = farmAverages('slime'); // level 1
    const high = farmAverages('stone_golem'); // level 11
    generateLootSpy.mockRestore();

    expect(high.dropCount).toBeGreaterThan(low.dropCount);
    expect(high.avgItemLevel).toBeGreaterThan(low.avgItemLevel + 3);
  });
});

describe('CombatEngine status effects', () => {
  it('a skill with `inflicts` applies a status effect on a successful hit, which then deals damage over time via tick()', () => {
    // 0.45 clears the miss check (capped at 0.25) and the crit check (capped
    // at 0.5) without triggering either, while still being under
    // warrior_charge's own 0.5 inflict chance — so the bleed always lands.
    mockRandom(0.45);
    const player = freshPlayer('warrior');
    player.currentMp = 100;
    const enemy = new Enemy('slime');
    enemy.currentHp = 1000; // stays alive through the DoT ticks that follow
    const engine = new CombatEngine(player, [enemy]);

    const result = engine.useSkill('warrior_charge', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((e) => e.kind === 'statusApplied' && e.statusType === 'bleed')).toBe(true);
    expect(enemy.statusEffects.some((s) => s.type === 'bleed')).toBe(true);

    const hpBeforeTick = enemy.currentHp;
    const tickEvents = engine.tick(1.0); // one full bleed tick interval
    expect(enemy.currentHp).toBeLessThan(hpBeforeTick);
    expect(tickEvents.some((e) => e.kind === 'statusTick' && e.statusType === 'bleed')).toBe(true);
  });

  it('bleed never duplicates into a second instance, and falls off entirely once its duration elapses', () => {
    mockRandom(0.45);
    const player = freshPlayer('warrior');
    player.currentMp = 100;
    const enemy = new Enemy('slime');
    enemy.currentHp = 1000;
    const engine = new CombatEngine(player, [enemy]);

    engine.useSkill('warrior_charge', 0);
    expect(enemy.statusEffects.filter((s) => s.type === 'bleed')).toHaveLength(1);

    engine.tick(20); // comfortably past bleed's own duration (well past warrior_charge's own cooldown too)
    expect(enemy.statusEffects.some((s) => s.type === 'bleed')).toBe(false);
  });

  it('slow scales down an afflicted enemy\'s action timer countdown (attack speed) and its own speedMultiplier reads <1', () => {
    mockRandom(0.45); // under mage_ice_lance's 0.6 inflict chance, same as above
    const player = freshPlayer('mage');
    player.currentMp = 100;
    const enemy = new Enemy('slime');
    enemy.currentHp = 1000; // stays alive through the hit so slow actually gets applied (not skipped by an outright kill)
    const engine = new CombatEngine(player, [enemy]);

    const result = engine.useSkill('mage_ice_lance', 0);
    expect(result.ok).toBe(true);
    expect(enemy.statusEffects.some((s) => s.type === 'slow')).toBe(true);
    expect(enemy.speedMultiplier).toBeLessThan(1);

    const before = enemy.actionTimer;
    engine.tick(1.0);
    const slowedDelta = before - enemy.actionTimer;
    expect(slowedDelta).toBeCloseTo(1.0 * enemy.speedMultiplier, 5);
    expect(slowedDelta).toBeLessThan(1.0); // strictly slower than an unaffected dt=1 countdown
  });

  it('a status tick that finishes off its target still resolves victory and emits "defeated"', () => {
    mockRandom(0.45);
    const player = freshPlayer('warrior');
    player.currentMp = 100;
    const enemy = new Enemy('slime');
    enemy.currentHp = 1000; // stays alive through the initial hit so bleed actually gets applied
    const engine = new CombatEngine(player, [enemy]);

    engine.useSkill('warrior_charge', 0);
    enemy.currentHp = 1; // now let the next bleed tick alone finish it off
    const events = engine.tick(1.0);

    expect(enemy.isAlive()).toBe(false);
    expect(events.some((e) => e.kind === 'defeated')).toBe(true);
    expect(engine.outcome).toBe('victory');
  });

  it('an enemy skill with `inflicts` can apply a status effect back onto the player, which then ticks down their HP', () => {
    mockRandom(0.45); // under giant_spider\'s spider_venom 0.5 inflict chance
    const player = freshPlayer('warrior');
    const enemy = new Enemy('giant_spider');
    enemy.actionTimer = 0;
    enemy.currentMp = enemy.stats.maxMp; // affords spider_venom's own mana cost
    const engine = new CombatEngine(player, [enemy]);

    engine.tick(0.1); // begins the telegraphed attack
    engine.tick(1.0); // resolves it

    expect(player.statusEffects.some((s) => s.type === 'bleed')).toBe(true);
    const hpBeforeTick = player.currentHp;
    const tickEvents = engine.tick(1.0);
    expect(player.currentHp).toBeLessThan(hpBeforeTick);
    expect(tickEvents.some((e) => e.kind === 'statusTick' && e.targetIsPlayer && e.statusType === 'bleed')).toBe(true);
  });
});
