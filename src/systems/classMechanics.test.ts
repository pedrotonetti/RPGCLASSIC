import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLASS_DEFINITIONS, getClassById } from '../config/classes';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { COMBO_DAMAGE_PER_HIT, COMBO_MAX_STACKS, COMBO_WINDOW, CombatEngine, type CombatEvent } from './CombatSystem';
import {
  CLASS_METER_MAX,
  FAITH_PER_BLOCK,
  FAITH_PER_CAST,
  FAITH_PER_PERFECT_BLOCK,
  FATAL_STRIKE_LOW_HP_BONUS,
  FATAL_STRIKE_POWER,
  FLOW_FINISHER_BONUS,
  FLOW_MAX_LEVEL,
  FLOW_STACKS_PER_LEVEL,
  FURY_PER_BLOCK,
  FURY_PER_DAMAGE_TAKEN,
  FURY_PER_HIT,
  FURY_PER_PERFECT_BLOCK,
  MARKS_MAX,
  MARKS_PER_CRIT,
  MARKS_PER_HIT,
  MARK_DAMAGE_BONUS_PER_STACK,
  OVERCHARGE_DAMAGE_BONUS,
  OVERCHARGE_PER_BASIC,
  OVERCHARGE_PER_SPELL,
  PRECISION_MAX_CRIT_BONUS,
  PRECISION_PER_HIT,
  SOUL_DRAIN_LIFESTEAL,
  SOULS_PER_HIT,
  SOULS_PER_KILL,
  VOW_MAX_DAMAGE_REDUCTION,
  VOW_PER_BLOCK,
  VOW_PER_DAMAGE_TAKEN,
  VOW_PER_HIT,
  VOW_PER_PERFECT_BLOCK,
  classAbilityTarget,
  comboLabel,
  fatalStrikePower,
  flowLevelForCombo,
  isOverchargeCast,
  markDamageBonus,
  marksAfterHit,
  marksMeterValue,
  precisionCritBonus,
  vowDamageReduction,
} from './classMechanics';
import { applyStatusEffect } from './statusEffects';

/**
 * Same determinism approach as CombatSystem.test.ts: Math.random() is locked
 * to one value per test. 0.99 = every attack hits, never crits (both chances
 * cap well below it); 0 = every NORMAL attack misses (miss chance is always
 * >= 2%), which is exactly what proves a class ability's "never misses".
 */
function mockRandom(value: number) {
  return vi.spyOn(Math, 'random').mockReturnValue(value);
}

afterEach(() => {
  vi.restoreAllMocks();
});

function freshPlayer(classId: string, level = 1): Player {
  const player = Player.createNew('Testador', classId);
  player.level = level;
  player.currentHp = player.stats.maxHp;
  player.currentMp = player.stats.maxMp;
  return player;
}

/** An enemy that survives any hit and never acts on its own — so enemy swings can't add meter noise to a test about the player's own actions. */
function dummy(hp = 1_000_000, id = 'slime'): Enemy {
  const enemy = new Enemy(id);
  enemy.currentHp = hp;
  enemy.actionTimer = Number.POSITIVE_INFINITY;
  return enemy;
}

/** Lands `count` basic attacks on `targetIndex`, ticking past the basic attack's own 1.1s cooldown after each (well inside the 3s combo window). */
function basicAttacks(engine: CombatEngine, count: number, targetIndex = 0): CombatEvent[][] {
  const all: CombatEvent[][] = [];
  for (let i = 0; i < count; i++) {
    const result = engine.useSkill('basic_attack', targetIndex);
    expect(result.ok).toBe(true);
    if (result.ok) all.push(result.events);
    engine.tick(1.2);
  }
  return all;
}

type IncomingHit = 'unmitigated' | 'block' | 'perfectBlock' | 'dodge';

/** One enemy swing against `player` in a fresh engine, mitigated as asked — same timings as CombatSystem.test.ts's own block/dodge tests. */
function takeOneHit(player: Player, how: IncomingHit): CombatEngine {
  const enemy = new Enemy('slime'); // no skills: the AI draws no extra random value
  enemy.actionTimer = 0;
  const engine = new CombatEngine(player, [enemy]);
  let events: CombatEvent[];
  if (how === 'unmitigated') {
    engine.tick(0.1); // begins the telegraph (resolves at 0.55)
    events = engine.tick(0.5);
  } else if (how === 'block') {
    engine.tick(0.1); // resolves at 0.55
    engine.tick(0.3);
    engine.attemptBlock(); // started at 0.4
    events = engine.tick(0.3); // resolves at 0.7: 0.3s in, past the 0.15s perfect window
  } else if (how === 'perfectBlock') {
    engine.tick(0.2); // resolves at 0.65
    engine.tick(0.4);
    engine.attemptBlock(); // started at 0.6
    events = engine.tick(0.05); // resolves at 0.65: 0.05s in, inside the perfect window
  } else {
    engine.tick(0.1); // resolves at 0.55
    engine.tick(0.3);
    engine.attemptDodge(); // active until 0.65
    events = engine.tick(0.2);
  }
  const hit = events.find((e) => e.kind === 'damage' && e.targetIsPlayer);
  expect(hit, 'the enemy swing should have resolved').toBeDefined();
  expect(hit!.mitigation).toBe(how === 'unmitigated' ? undefined : how);
  return engine;
}

describe('class mechanic data contract', () => {
  it('each batch-2.1 class declares its mechanic with player-facing text, and ability text exists exactly when the engine implements a spend', () => {
    const expected: Record<string, { id: string; kind: string }> = {
      warrior: { id: 'fury', kind: 'meter' },
      archer: { id: 'precision', kind: 'meter' },
      cleric: { id: 'faith', kind: 'meter' },
      necromancer: { id: 'souls', kind: 'meter' },
      monk: { id: 'flow', kind: 'combo' },
      mage: { id: 'overcharge', kind: 'meter' },
      paladin: { id: 'vow', kind: 'meter' },
      assassin: { id: 'marks', kind: 'meter' },
    };
    for (const [classId, want] of Object.entries(expected)) {
      const mechanic = getClassById(classId).classMechanic;
      expect(mechanic?.id, classId).toBe(want.id);
      expect(mechanic?.kind, classId).toBe(want.kind);
      expect(mechanic!.name.length, classId).toBeGreaterThan(0);
      expect(mechanic!.description.length, classId).toBeGreaterThan(20);
    }
    for (const cls of CLASS_DEFINITIONS) {
      const mechanic = cls.classMechanic;
      if (!mechanic) continue;
      expect(Boolean(mechanic.ability), cls.id).toBe(classAbilityTarget(mechanic.id) !== null);
      if (mechanic.ability) expect(mechanic.ability.description.length, cls.id).toBeGreaterThan(20);
    }
    expect(classAbilityTarget('precision')).toBeNull();
    expect(classAbilityTarget('flow')).toBeNull();
    expect(classAbilityTarget('overcharge')).toBeNull();
    expect(classAbilityTarget('vow')).toBe('allEnemies');
    expect(classAbilityTarget('marks')).toBe('enemy');
    expect(classAbilityTarget(undefined)).toBeNull();
  });

  it('all 8 classes have their own mechanic id, and a passive meter announces when it fills', () => {
    expect(CLASS_DEFINITIONS).toHaveLength(8);
    const ids = CLASS_DEFINITIONS.map((c) => c.classMechanic?.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(8);
    expect(getClassById('mage').classMechanic?.readyMessage?.length).toBeGreaterThan(10);
    expect(getClassById('assassin').classMechanic?.steps).toBe(MARKS_MAX);
  });

  it('a class without any mechanic gains nothing, has no class ability, and keeps the generic combo label', () => {
    mockRandom(0.99);
    vi.spyOn(Player.prototype, 'classDef', 'get').mockReturnValue({ ...getClassById('warrior'), classMechanic: undefined });
    const engine = new CombatEngine(freshPlayer('warrior'), [dummy()]);
    basicAttacks(engine, 3);
    expect(engine.classMeterValue).toBe(0);
    expect(engine.classAbilityTarget()).toBeNull();
    expect(engine.useClassAbility(0)).toEqual({ ok: false, reason: 'unknown' });
    expect(engine.flowLevel).toBe(0);
    expect(comboLabel(undefined, engine.comboHits)).toBe('Combo x3');
  });

  it('every meter is battle-scoped: a new fight (a new engine) starts empty even for the same player', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior');
    const first = new CombatEngine(player, [dummy()]);
    basicAttacks(first, 10);
    expect(first.isClassMeterFull()).toBe(true);
    const second = new CombatEngine(player, [dummy()]);
    expect(second.classMeterValue).toBe(0);
  });
});

describe('Guerreiro — Fúria', () => {
  it('gains once per attack action that connects, and nothing from a miss', () => {
    const rand = mockRandom(0.99);
    const engine = new CombatEngine(freshPlayer('warrior'), [dummy()]);
    basicAttacks(engine, 1);
    expect(engine.classMeterValue).toBe(FURY_PER_HIT);
    rand.mockReturnValue(0); // a guaranteed miss
    basicAttacks(engine, 1);
    expect(engine.classMeterValue).toBe(FURY_PER_HIT);
  });

  it('an AoE that hits several enemies still counts as ONE action (no free multi-fill)', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior', 15);
    const engine = new CombatEngine(player, [dummy(), dummy(), dummy()]);
    const result = engine.useSkill('warrior_sweep');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events.filter((e) => e.kind === 'damage')).toHaveLength(3);
    expect(engine.classMeterValue).toBe(FURY_PER_HIT);
  });

  it('gains from an unmitigated hit taken, more from a block, most from a perfect block — and nothing from a dodge', () => {
    mockRandom(0.99);
    expect(takeOneHit(freshPlayer('warrior'), 'unmitigated').classMeterValue).toBe(FURY_PER_DAMAGE_TAKEN);
    expect(takeOneHit(freshPlayer('warrior'), 'block').classMeterValue).toBe(FURY_PER_BLOCK);
    expect(takeOneHit(freshPlayer('warrior'), 'perfectBlock').classMeterValue).toBe(FURY_PER_PERFECT_BLOCK);
    expect(takeOneHit(freshPlayer('warrior'), 'dodge').classMeterValue).toBe(0);
    expect(FURY_PER_PERFECT_BLOCK).toBeGreaterThan(FURY_PER_BLOCK);
  });

  it('Golpe Selvagem is refused until the meter is full, then hits far harder than a basic attack and empties the meter', () => {
    mockRandom(0.99);
    const engine = new CombatEngine(freshPlayer('warrior'), [dummy()]);
    const basics = basicAttacks(engine, 9);
    expect(engine.classMeterValue).toBe(9 * FURY_PER_HIT);
    expect(engine.useClassAbility(0)).toEqual({ ok: false, reason: 'meter' });
    expect(engine.classMeterValue).toBe(9 * FURY_PER_HIT); // a refused try costs nothing

    basicAttacks(engine, 1);
    expect(engine.isClassMeterFull()).toBe(true);
    const result = engine.useClassAbility(0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const hit = result.events.find((e) => e.kind === 'damage');
    expect(hit?.text).toContain('Golpe Selvagem');
    const lastBasic = basics[basics.length - 1].find((e) => e.kind === 'damage')!;
    // Same combo stack cap (6) on both hits, no crits: the difference is the 3.0x power.
    expect(hit!.amount!).toBeGreaterThan(lastBasic.amount! * 2);
    expect(engine.classMeterValue).toBe(0); // its own hit never refills Fúria
    expect(engine.useClassAbility(0)).toEqual({ ok: false, reason: 'meter' });
  });

  it('Golpe Selvagem never misses, even on a roll that makes every normal attack miss', () => {
    const rand = mockRandom(0.99);
    const engine = new CombatEngine(freshPlayer('warrior'), [dummy()]);
    basicAttacks(engine, 10);
    rand.mockReturnValue(0);
    const result = engine.useClassAbility(0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((e) => e.kind === 'miss')).toBe(false);
    expect(result.events.some((e) => e.kind === 'damage' && (e.amount ?? 0) > 0)).toBe(true);
  });

  it('refuses without spending the meter when the chosen target is already dead', () => {
    mockRandom(0.99);
    const enemies = [dummy(), dummy()];
    const engine = new CombatEngine(freshPlayer('warrior'), enemies);
    basicAttacks(engine, 10);
    enemies[1].currentHp = 0;
    expect(engine.useClassAbility(1)).toEqual({ ok: false, reason: 'unknown' });
    expect(engine.isClassMeterFull()).toBe(true);
  });
});

describe('Arqueiro — Precisão', () => {
  it('gains per clean attack, caps at the max, and any miss empties it', () => {
    const rand = mockRandom(0.99);
    const engine = new CombatEngine(freshPlayer('archer'), [dummy()]);
    basicAttacks(engine, 1);
    expect(engine.classMeterValue).toBe(PRECISION_PER_HIT);
    basicAttacks(engine, 6);
    expect(engine.classMeterValue).toBe(CLASS_METER_MAX);
    rand.mockReturnValue(0);
    basicAttacks(engine, 1);
    expect(engine.classMeterValue).toBe(0);
  });

  it('has no spend: the class ability is refused even at a full meter', () => {
    mockRandom(0.99);
    const engine = new CombatEngine(freshPlayer('archer'), [dummy()]);
    basicAttacks(engine, 5);
    expect(engine.isClassMeterFull()).toBe(true);
    expect(engine.classAbilityTarget()).toBeNull();
    expect(engine.useClassAbility(0)).toEqual({ ok: false, reason: 'unknown' });
    expect(engine.isClassMeterFull()).toBe(true);
  });

  it('the crit bonus scales linearly with the meter, up to its cap', () => {
    expect(precisionCritBonus(0)).toBe(0);
    expect(precisionCritBonus(CLASS_METER_MAX / 2)).toBeCloseTo(PRECISION_MAX_CRIT_BONUS / 2, 10);
    expect(precisionCritBonus(CLASS_METER_MAX)).toBeCloseTo(PRECISION_MAX_CRIT_BONUS, 10);
    expect(precisionCritBonus(CLASS_METER_MAX * 3)).toBeCloseTo(PRECISION_MAX_CRIT_BONUS, 10);
  });

  it('a full-Precisão archer crits on a roll that neither an empty-meter archer nor a full-Fúria warrior crits on', () => {
    const ROLL = 0.3;
    // Same formula as CombatSystem's resolveAttack — asserted as a
    // precondition so this test can't silently pass for the wrong reason.
    const baseCrit = (p: Player) => Math.min(0.5, Math.max(0.05, 0.05 + p.stats.luck * 0.015));

    const rand = mockRandom(0.99);
    const fullArcher = freshPlayer('archer');
    const fullArcherEngine = new CombatEngine(fullArcher, [dummy()]);
    basicAttacks(fullArcherEngine, 5);
    expect(fullArcherEngine.isClassMeterFull()).toBe(true);

    const warrior = freshPlayer('warrior');
    const warriorEngine = new CombatEngine(warrior, [dummy()]);
    basicAttacks(warriorEngine, 10);
    expect(warriorEngine.isClassMeterFull()).toBe(true);

    const emptyArcherEngine = new CombatEngine(freshPlayer('archer'), [dummy()]);

    expect(baseCrit(fullArcher)).toBeLessThan(ROLL);
    expect(baseCrit(fullArcher) + PRECISION_MAX_CRIT_BONUS).toBeGreaterThan(ROLL);
    expect(baseCrit(warrior)).toBeLessThan(ROLL);

    rand.mockReturnValue(ROLL); // above every miss chance (capped at 0.25): all three connect
    const critOf = (engine: CombatEngine) => {
      const result = engine.useSkill('basic_attack', 0);
      if (!result.ok) throw new Error('attack refused');
      return result.events.find((e) => e.kind === 'damage')!.crit;
    };
    expect(critOf(fullArcherEngine)).toBe(true);
    expect(critOf(emptyArcherEngine)).toBe(false);
    expect(critOf(warriorEngine)).toBe(false);
  });
});

describe('Clérigo — Fé', () => {
  it('gains from casting a heal and from casting a buff, but not from attacking', () => {
    mockRandom(0.99);
    const player = freshPlayer('cleric', 10);
    const engine = new CombatEngine(player, [dummy()]);
    basicAttacks(engine, 2);
    expect(engine.classMeterValue).toBe(0);
    expect(engine.useSkill('cleric_heal').ok).toBe(true);
    expect(engine.classMeterValue).toBe(FAITH_PER_CAST);
    expect(engine.useSkill('cleric_blessing').ok).toBe(true);
    expect(engine.classMeterValue).toBe(2 * FAITH_PER_CAST);
  });

  it('gains from a block, more from a perfect block, and nothing from a hit taken or a dodge', () => {
    mockRandom(0.99);
    expect(takeOneHit(freshPlayer('cleric'), 'unmitigated').classMeterValue).toBe(0);
    expect(takeOneHit(freshPlayer('cleric'), 'block').classMeterValue).toBe(FAITH_PER_BLOCK);
    expect(takeOneHit(freshPlayer('cleric'), 'perfectBlock').classMeterValue).toBe(FAITH_PER_PERFECT_BLOCK);
    expect(takeOneHit(freshPlayer('cleric'), 'dodge').classMeterValue).toBe(0);
  });

  it('Milagre da Fé is refused until full, then heals, cleanses every affliction, and empties the meter', () => {
    mockRandom(0.99);
    const player = freshPlayer('cleric');
    const engine = new CombatEngine(player, [dummy()]);
    const castHeal = () => {
      player.currentMp = player.stats.maxMp;
      expect(engine.useSkill('cleric_heal').ok).toBe(true);
      engine.tick(7); // past Cura's own 6s cooldown
    };
    castHeal();
    castHeal();
    expect(engine.useClassAbility()).toEqual({ ok: false, reason: 'meter' });
    castHeal();
    expect(engine.isClassMeterFull()).toBe(true);

    applyStatusEffect(player, 'bleed', 20);
    applyStatusEffect(player, 'slow', 0);
    player.currentHp = 1;
    const result = engine.useClassAbility();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const heal = result.events.find((e) => e.kind === 'heal' && e.targetIsPlayer);
    expect(heal?.text).toContain('Milagre da Fé');
    expect(heal!.amount!).toBeGreaterThan(0);
    expect(player.currentHp).toBe(1 + heal!.amount!);
    expect(player.statusEffects).toEqual([]);
    expect(player.speedMultiplier).toBe(1);
    expect(engine.classMeterValue).toBe(0);
  });
});

describe('Necromante — Almas', () => {
  it('a kill is worth SOULS_PER_KILL on top of the hit that caused it; a non-lethal hit only SOULS_PER_HIT', () => {
    mockRandom(0.99);
    const engine = new CombatEngine(freshPlayer('necromancer'), [dummy(1), dummy()]);
    basicAttacks(engine, 1, 0);
    expect(engine.enemies[0].isAlive()).toBe(false);
    expect(engine.classMeterValue).toBe(SOULS_PER_KILL + SOULS_PER_HIT);
    basicAttacks(engine, 1, 1);
    expect(engine.classMeterValue).toBe(SOULS_PER_KILL + 2 * SOULS_PER_HIT);
    expect(SOULS_PER_KILL).toBeGreaterThan(SOULS_PER_HIT * 5); // kills stay the defining source
  });

  it('a kill by damage-over-time harvests a soul too', () => {
    mockRandom(0.99);
    const dying = dummy(1);
    const engine = new CombatEngine(freshPlayer('necromancer'), [dying, dummy()]);
    applyStatusEffect(dying, 'bleed', 100);
    const events = engine.tick(1.0); // one bleed tick
    expect(events.some((e) => e.kind === 'defeated')).toBe(true);
    expect(engine.classMeterValue).toBe(SOULS_PER_KILL);
  });

  it('Dreno das Almas is refused until full, then hits every engaged enemy without missing, heals for a share of the HP drained, and its own kills never refill Almas', () => {
    const rand = mockRandom(0.99);
    const player = freshPlayer('necromancer');
    const enemies = [dummy(1), dummy(), dummy()];
    const engine = new CombatEngine(player, enemies);
    basicAttacks(engine, 1, 0); // kill: 68
    basicAttacks(engine, 3, 1); // 92
    expect(engine.classMeterValue).toBe(SOULS_PER_KILL + 4 * SOULS_PER_HIT);
    expect(engine.useClassAbility()).toEqual({ ok: false, reason: 'meter' });
    basicAttacks(engine, 1, 1);
    expect(engine.isClassMeterFull()).toBe(true);

    enemies[2].currentHp = 5; // the drain will kill this one
    const hpBeforeByIndex = enemies.map((e) => e.currentHp);
    player.currentHp = 1;
    rand.mockReturnValue(0); // every normal attack would miss
    const result = engine.useClassAbility();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events.some((e) => e.kind === 'miss')).toBe(false);
    const damage = result.events.filter((e) => e.kind === 'damage');
    expect(damage.map((e) => e.targetIndex).sort()).toEqual([1, 2]); // every ALIVE engaged enemy, and only those
    expect(damage.every((e) => e.text.includes('Dreno das Almas'))).toBe(true);
    expect(enemies[2].isAlive()).toBe(false);

    const drained = damage.reduce((sum, e) => sum + Math.min(e.amount!, hpBeforeByIndex[e.targetIndex!]), 0);
    const heal = result.events.find((e) => e.kind === 'heal' && e.targetIsPlayer)!;
    expect(heal.amount).toBe(Math.min(player.stats.maxHp - 1, Math.round(drained * SOUL_DRAIN_LIFESTEAL)));
    expect(heal.amount!).toBeGreaterThan(0);

    expect(engine.classMeterValue).toBe(0); // the drain's own kill harvested nothing
    expect(engine.outcome).toBe('ongoing');
  });
});

describe('Monge — Fluxo', () => {
  it('every 2 combo stacks is one Fluxo level, and the top level lines up exactly with the engine combo cap', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(flowLevelForCombo)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(FLOW_MAX_LEVEL * FLOW_STACKS_PER_LEVEL).toBe(COMBO_MAX_STACKS);
  });

  it('the finisher is a modest extra — well under the combo bonus it stacks on top of', () => {
    expect(FLOW_FINISHER_BONUS).toBeGreaterThan(0);
    expect(FLOW_FINISHER_BONUS).toBeLessThanOrEqual((COMBO_MAX_STACKS * COMBO_DAMAGE_PER_HIT) / 2);
  });

  it('labels: the monk sees named Fluxo levels with a finisher callout at the top; every other class sees "Combo xN"', () => {
    expect(comboLabel('flow', 1)).toBeNull();
    expect(comboLabel('flow', 2)).toBe('Fluxo Nível 1');
    expect(comboLabel('flow', 5)).toBe('Fluxo Nível 2');
    expect(comboLabel('flow', 6)).toBe('Fluxo Nível 3 — Finalizador!');
    expect(comboLabel('fury', 1)).toBeNull();
    expect(comboLabel('fury', 4)).toBe('Combo x4');
    expect(comboLabel(undefined, 6)).toBe('Combo x6');
  });

  it('in combat, the monk climbs Fluxo levels hit by hit; any other class stays at level 0', () => {
    mockRandom(0.99);
    const monk = new CombatEngine(freshPlayer('monk'), [dummy()]);
    const levels: number[] = [];
    for (let i = 0; i < 7; i++) {
      basicAttacks(monk, 1);
      levels.push(monk.flowLevel);
    }
    expect(levels).toEqual([0, 1, 1, 2, 2, 3, 3]);

    const warrior = new CombatEngine(freshPlayer('warrior'), [dummy()]);
    basicAttacks(warrior, 6);
    expect(warrior.comboHits).toBe(6);
    expect(warrior.flowLevel).toBe(0);
  });

  it('hits at the top Fluxo level get the finisher bonus on top of the combo bonus — for the monk only', () => {
    mockRandom(0.99); // hit, no crit, variance 0.9 + 0.99*0.2
    const variance = 0.9 + 0.99 * 0.2;
    // resolveAttack's own formula for a basic attack (power 1.0, no minFraction) — as in CombatSystem.test.ts's armor test.
    const baseRoll = (engine: CombatEngine) => {
      const raw = Math.max(0, engine.effectiveStats().attack - engine.enemies[0].stats.defense * 0.6);
      return Math.max(1, Math.round(raw * variance));
    };
    const amountsOf = (engine: CombatEngine) => basicAttacks(engine, 6).map((events) => events.find((e) => e.kind === 'damage')!);

    const monk = new CombatEngine(freshPlayer('monk'), [dummy()]);
    const monkHits = amountsOf(monk);
    const monkBase = baseRoll(monk);
    expect(monkHits[4].amount).toBe(Math.round(monkBase * (1 + 5 * COMBO_DAMAGE_PER_HIT)));
    expect(monkHits[5].amount).toBe(Math.round(monkBase * (1 + 6 * COMBO_DAMAGE_PER_HIT + FLOW_FINISHER_BONUS)));
    expect(monkHits[5].text).toContain('Finalizador!');

    const warrior = new CombatEngine(freshPlayer('warrior'), [dummy()]);
    const warriorHits = amountsOf(warrior);
    expect(warriorHits[5].amount).toBe(Math.round(baseRoll(warrior) * (1 + 6 * COMBO_DAMAGE_PER_HIT)));
    expect(warriorHits[5].text).toContain('(Combo x6)');
  });

  it('an unmitigated hit taken, or letting the combo window lapse, breaks the Fluxo', () => {
    mockRandom(0.99);
    const lapse = new CombatEngine(freshPlayer('monk'), [dummy()]);
    basicAttacks(lapse, 6);
    expect(lapse.flowLevel).toBe(FLOW_MAX_LEVEL);
    lapse.tick(COMBO_WINDOW); // 1.2s already elapsed after the last hit + this = past the window
    expect(lapse.flowLevel).toBe(0);

    const enemy = dummy();
    const struck = new CombatEngine(freshPlayer('monk'), [enemy]);
    basicAttacks(struck, 6);
    expect(struck.flowLevel).toBe(FLOW_MAX_LEVEL);
    enemy.actionTimer = 0;
    struck.tick(0.1); // telegraph
    struck.tick(0.5); // lands unmitigated, well inside the combo window
    expect(struck.flowLevel).toBe(0);
  });
});

/** Neutral to every element and kind (no weaknesses/resistances), so these tests measure the class mechanic and nothing else. */
const bandit = () => dummy(1_000_000, 'bandit');

describe('Mago — Sobrecarga Arcana', () => {
  /** Casts Bola de Fogo `count` times with MP topped up, waiting out its 5s cooldown (and the combo window) after each. */
  function castFireballs(player: Player, engine: CombatEngine, count: number): CombatEvent[][] {
    const all: CombatEvent[][] = [];
    for (let i = 0; i < count; i++) {
      player.currentMp = player.stats.maxMp;
      const result = engine.useSkill('mage_fireball', 0);
      expect(result.ok).toBe(true);
      if (result.ok) all.push(result.events);
      engine.tick(6);
    }
    return all;
  }

  it('charges per spell cast (a buff counts), a little per basic attack', () => {
    mockRandom(0.99);
    const player = freshPlayer('mage');
    const engine = new CombatEngine(player, [bandit()]);
    basicAttacks(engine, 1);
    expect(engine.classMeterValue).toBe(OVERCHARGE_PER_BASIC);
    castFireballs(player, engine, 1);
    expect(engine.classMeterValue).toBe(OVERCHARGE_PER_BASIC + OVERCHARGE_PER_SPELL);
    player.currentMp = player.stats.maxMp;
    expect(engine.useSkill('mage_arcane_shield').ok).toBe(true);
    expect(engine.classMeterValue).toBe(OVERCHARGE_PER_BASIC + 2 * OVERCHARGE_PER_SPELL);
    expect(OVERCHARGE_PER_SPELL).toBeGreaterThan(OVERCHARGE_PER_BASIC);
  });

  it('a full Sobrecarga makes the next spell free (even at 0 MP) and stronger, then empties — and that cast never recharges it', () => {
    mockRandom(0.99);
    const player = freshPlayer('mage');
    const engine = new CombatEngine(player, [bandit()]);
    const [firstCast] = castFireballs(player, engine, 1);
    castFireballs(player, engine, 3);
    expect(engine.isClassMeterFull()).toBe(true);

    player.currentMp = 0;
    const result = engine.useSkill('mage_fireball', 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const empowered = result.events.find((e) => e.kind === 'damage')!;
    const normal = firstCast.find((e) => e.kind === 'damage')!;
    expect(empowered.text).toContain('Sobrecarga!');
    expect(normal.text).not.toContain('Sobrecarga');
    expect(player.currentMp).toBe(0);
    // Same combo stack, no crit on either: the difference is the empowered bonus.
    expect(empowered.amount! / normal.amount!).toBeGreaterThan(1 + OVERCHARGE_DAMAGE_BONUS - 0.1);
    expect(empowered.amount! / normal.amount!).toBeLessThan(1 + OVERCHARGE_DAMAGE_BONUS + 0.1);
    expect(engine.classMeterValue).toBe(0);
  });

  it('the cast after an empowered one is an ordinary paid cast that charges again', () => {
    mockRandom(0.99);
    const player = freshPlayer('mage');
    const engine = new CombatEngine(player, [bandit()]);
    castFireballs(player, engine, 4);
    player.currentMp = player.stats.maxMp;
    engine.useSkill('mage_fireball', 0);
    engine.tick(6);
    player.currentMp = player.stats.maxMp;
    expect(engine.useSkill('mage_fireball', 0).ok).toBe(true);
    expect(player.currentMp).toBeLessThan(player.stats.maxMp);
    expect(engine.classMeterValue).toBe(OVERCHARGE_PER_SPELL);
  });

  it('a basic attack never uses up a full Sobrecarga, and without one a mage with no MP still cannot cast', () => {
    mockRandom(0.99);
    const player = freshPlayer('mage');
    const engine = new CombatEngine(player, [bandit()]);
    castFireballs(player, engine, 4);
    const [basic] = basicAttacks(engine, 1);
    expect(basic.find((e) => e.kind === 'damage')!.text).not.toContain('Sobrecarga');
    expect(engine.isClassMeterFull()).toBe(true);

    const broke = freshPlayer('mage');
    broke.currentMp = 0;
    expect(new CombatEngine(broke, [bandit()]).useSkill('mage_fireball', 0)).toEqual({ ok: false, reason: 'mana' });
  });

  it('only a damaging, non-basic spell cast by a mage at a full meter counts as empowered', () => {
    expect(isOverchargeCast('overcharge', CLASS_METER_MAX, 'magical', false)).toBe(true);
    expect(isOverchargeCast('overcharge', CLASS_METER_MAX - 1, 'magical', false)).toBe(false);
    expect(isOverchargeCast('overcharge', CLASS_METER_MAX, 'magical', true)).toBe(false);
    expect(isOverchargeCast('overcharge', CLASS_METER_MAX, 'buff', false)).toBe(false);
    expect(isOverchargeCast('overcharge', CLASS_METER_MAX, 'physical', false)).toBe(false);
    expect(isOverchargeCast('faith', CLASS_METER_MAX, 'magical', false)).toBe(false);
    expect(isOverchargeCast(undefined, CLASS_METER_MAX, 'magical', false)).toBe(false);
  });

  it('has no button: the class ability is refused even at a full meter', () => {
    mockRandom(0.99);
    const player = freshPlayer('mage');
    const engine = new CombatEngine(player, [bandit()]);
    castFireballs(player, engine, 4);
    expect(engine.isClassMeterFull()).toBe(true);
    expect(engine.classAbilityTarget()).toBeNull();
    expect(engine.useClassAbility(0)).toEqual({ ok: false, reason: 'unknown' });
  });
});

describe('Paladino — Juramento', () => {
  it('gains a little per attack action (an AoE counts once), far more from blocking, and a middling amount from a hit taken', () => {
    mockRandom(0.99);
    const engine = new CombatEngine(freshPlayer('paladin'), [bandit()]);
    basicAttacks(engine, 1);
    expect(engine.classMeterValue).toBe(VOW_PER_HIT);

    const aoe = new CombatEngine(freshPlayer('paladin', 20), [bandit(), bandit(), bandit()]);
    expect(aoe.useSkill('paladin_ultimate').ok).toBe(true);
    expect(aoe.classMeterValue).toBe(VOW_PER_HIT);

    expect(takeOneHit(freshPlayer('paladin'), 'unmitigated').classMeterValue).toBe(VOW_PER_DAMAGE_TAKEN);
    expect(takeOneHit(freshPlayer('paladin'), 'block').classMeterValue).toBe(VOW_PER_BLOCK);
    expect(takeOneHit(freshPlayer('paladin'), 'perfectBlock').classMeterValue).toBe(VOW_PER_PERFECT_BLOCK);
    expect(takeOneHit(freshPlayer('paladin'), 'dodge').classMeterValue).toBe(0);
    expect(VOW_PER_PERFECT_BLOCK).toBeGreaterThan(VOW_PER_BLOCK);
    expect(VOW_PER_BLOCK).toBeGreaterThan(VOW_PER_DAMAGE_TAKEN);
    expect(VOW_PER_DAMAGE_TAKEN).toBeGreaterThan(VOW_PER_HIT);
  });

  it('Fé Inabalável: damage reduction scales linearly with the meter up to its cap, for the paladin only', () => {
    expect(vowDamageReduction('vow', 0)).toBe(0);
    expect(vowDamageReduction('vow', CLASS_METER_MAX / 2)).toBeCloseTo(VOW_MAX_DAMAGE_REDUCTION / 2, 10);
    expect(vowDamageReduction('vow', CLASS_METER_MAX)).toBeCloseTo(VOW_MAX_DAMAGE_REDUCTION, 10);
    expect(vowDamageReduction('vow', CLASS_METER_MAX * 3)).toBeCloseTo(VOW_MAX_DAMAGE_REDUCTION, 10);
    expect(vowDamageReduction('fury', CLASS_METER_MAX)).toBe(0);
    expect(vowDamageReduction(undefined, CLASS_METER_MAX)).toBe(0);
  });

  it('a full-Juramento paladin takes exactly the capped share less from the very same enemy hit', () => {
    mockRandom(0.99);
    const incomingDamage = (prefill: boolean): number => {
      const striker = new Enemy('troll');
      striker.actionTimer = Number.POSITIVE_INFINITY;
      const engine = new CombatEngine(freshPlayer('paladin', 5), [bandit(), striker]);
      if (prefill) {
        basicAttacks(engine, CLASS_METER_MAX / VOW_PER_HIT, 0);
        expect(engine.isClassMeterFull()).toBe(true);
      }
      striker.actionTimer = 0;
      engine.tick(0.1); // telegraph (resolves at +0.45)
      const hit = engine.tick(0.5).find((e) => e.kind === 'damage' && e.targetIsPlayer);
      expect(hit?.mitigation).toBeUndefined();
      return hit!.amount!;
    };
    const empty = incomingDamage(false);
    const full = incomingDamage(true);
    expect(full).toBeLessThan(empty);
    expect(full).toBe(Math.round(empty * (1 - VOW_MAX_DAMAGE_REDUCTION)));
  });

  it('Veredito Sagrado is refused until full, then hits every living enemy without missing, heals, and its own hits never refill the Juramento', () => {
    const rand = mockRandom(0.99);
    const player = freshPlayer('paladin');
    const enemies = [bandit(), bandit(), bandit()];
    enemies[2].currentHp = 0;
    const engine = new CombatEngine(player, enemies);
    basicAttacks(engine, CLASS_METER_MAX / VOW_PER_HIT - 1, 0);
    expect(engine.useClassAbility()).toEqual({ ok: false, reason: 'meter' });
    basicAttacks(engine, 1, 0);
    expect(engine.isClassMeterFull()).toBe(true);

    player.currentHp = 1;
    rand.mockReturnValue(0); // every normal attack would miss
    const result = engine.useClassAbility();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events.some((e) => e.kind === 'miss')).toBe(false);
    const damage = result.events.filter((e) => e.kind === 'damage');
    expect(damage.map((e) => e.targetIndex).sort()).toEqual([0, 1]);
    expect(damage.every((e) => e.text.includes('Veredito Sagrado') && (e.amount ?? 0) > 0)).toBe(true);
    const heal = result.events.find((e) => e.kind === 'heal' && e.targetIsPlayer)!;
    expect(heal.amount!).toBeGreaterThan(0);
    expect(player.currentHp).toBe(1 + heal.amount!);
    expect(engine.classMeterValue).toBe(0);
  });
});

describe('Assassino — Marca da Morte', () => {
  it("pure rules: crits mark twice, marks cap, damage bonus and the meter scale with marks, Golpe Fatal grows as the target's HP falls", () => {
    expect(marksAfterHit(0, false)).toBe(MARKS_PER_HIT);
    expect(marksAfterHit(0, true)).toBe(MARKS_PER_CRIT);
    expect(marksAfterHit(MARKS_MAX - 1, true)).toBe(MARKS_MAX);
    expect(marksAfterHit(MARKS_MAX, false)).toBe(MARKS_MAX);
    expect(marksMeterValue(0)).toBe(0);
    expect(marksMeterValue(MARKS_MAX)).toBe(CLASS_METER_MAX);
    expect(markDamageBonus('marks', 3)).toBeCloseTo(3 * MARK_DAMAGE_BONUS_PER_STACK, 10);
    expect(markDamageBonus('marks', MARKS_MAX * 2)).toBeCloseTo(MARKS_MAX * MARK_DAMAGE_BONUS_PER_STACK, 10);
    expect(markDamageBonus('fury', 3)).toBe(0);
    expect(fatalStrikePower(1)).toBeCloseTo(FATAL_STRIKE_POWER, 10);
    expect(fatalStrikePower(0)).toBeCloseTo(FATAL_STRIKE_POWER * (1 + FATAL_STRIKE_LOW_HP_BONUS), 10);
    expect(fatalStrikePower(0.25)).toBeGreaterThan(fatalStrikePower(0.75));
    expect(fatalStrikePower(5)).toBeCloseTo(FATAL_STRIKE_POWER, 10);
    expect(fatalStrikePower(-1)).toBeCloseTo(FATAL_STRIKE_POWER * (1 + FATAL_STRIKE_LOW_HP_BONUS), 10);
  });

  it('every landed hit marks its target and a crit marks twice; a miss marks nothing', () => {
    const rand = mockRandom(0.99);
    const engine = new CombatEngine(freshPlayer('assassin'), [bandit()]);
    basicAttacks(engine, 1);
    expect(engine.classMeterValue).toBe(marksMeterValue(MARKS_PER_HIT));
    rand.mockReturnValue(0.1); // above the miss floor, under the assassin's ~18% crit chance
    const [crit] = basicAttacks(engine, 1);
    expect(crit.find((e) => e.kind === 'damage')!.crit).toBe(true);
    expect(engine.classMeterValue).toBe(marksMeterValue(MARKS_PER_HIT + MARKS_PER_CRIT));
    rand.mockReturnValue(0); // a guaranteed miss
    basicAttacks(engine, 1);
    expect(engine.classMeterValue).toBe(marksMeterValue(MARKS_PER_HIT + MARKS_PER_CRIT));
  });

  it('marks are per target: the meter follows the most-marked living enemy', () => {
    mockRandom(0.99);
    const enemies = [bandit(), bandit()];
    const engine = new CombatEngine(freshPlayer('assassin'), enemies);
    basicAttacks(engine, 3, 0);
    basicAttacks(engine, 1, 1);
    expect(engine.classMeterValue).toBe(marksMeterValue(3));
    enemies[0].currentHp = 0;
    expect(engine.classMeterValue).toBe(marksMeterValue(1));
  });

  it('marks sharpen later hits on the marked target, for the assassin only', () => {
    mockRandom(0.99);
    const fifthHit = (engine: CombatEngine) => basicAttacks(engine, 5)[4].find((e) => e.kind === 'damage')!.amount!;
    const marked = fifthHit(new CombatEngine(freshPlayer('assassin', 15), [bandit()]));
    vi.spyOn(Player.prototype, 'classDef', 'get').mockReturnValue({ ...getClassById('assassin'), classMechanic: undefined });
    const plain = fifthHit(new CombatEngine(freshPlayer('assassin', 15), [bandit()]));
    expect(marked).toBeGreaterThan(plain);
  });

  it('Golpe Fatal needs 5 marks on the CHOSEN target (an AoE marks every enemy it hits), spends them, and never misses', () => {
    const rand = mockRandom(0.99);
    const enemies = [bandit(), bandit()];
    const engine = new CombatEngine(freshPlayer('assassin', 15), enemies);
    expect(engine.useSkill('assassin_blade_dance').ok).toBe(true); // 1 mark on each
    basicAttacks(engine, 3, 0);
    expect(engine.useClassAbility(0)).toEqual({ ok: false, reason: 'meter' }); // 4 marks
    basicAttacks(engine, 1, 0);
    expect(engine.isClassMeterFull()).toBe(true);
    expect(engine.useClassAbility(1)).toEqual({ ok: false, reason: 'meter' }); // enemy 1 only has 1

    rand.mockReturnValue(0); // every normal attack would miss
    const result = engine.useClassAbility(0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((e) => e.kind === 'miss')).toBe(false);
    const hit = result.events.find((e) => e.kind === 'damage')!;
    expect(hit.text).toContain('Golpe Fatal');
    expect(hit.targetIndex).toBe(0);
    expect(engine.classMeterValue).toBe(marksMeterValue(1)); // enemy 0's marks are gone, enemy 1 keeps its one
    expect(engine.useClassAbility(0)).toEqual({ ok: false, reason: 'meter' });
  });

  it("Golpe Fatal hits harder the lower the target's HP", () => {
    mockRandom(0.99);
    const fatalAt = (hpFraction: number): number => {
      const enemy = bandit();
      const engine = new CombatEngine(freshPlayer('assassin', 10), [enemy]);
      basicAttacks(engine, MARKS_MAX);
      enemy.currentHp = Math.round(enemy.stats.maxHp * hpFraction);
      const result = engine.useClassAbility(0);
      if (!result.ok) throw new Error('Golpe Fatal refused');
      return result.events.find((e) => e.kind === 'damage')!.amount!;
    };
    expect(fatalAt(0.25)).toBeGreaterThan(fatalAt(1));
  });

  it('refuses without spending anything when the chosen target is already dead', () => {
    mockRandom(0.99);
    const enemies = [bandit(), bandit()];
    const engine = new CombatEngine(freshPlayer('assassin'), enemies);
    basicAttacks(engine, MARKS_MAX, 0);
    enemies[1].currentHp = 0;
    expect(engine.useClassAbility(1)).toEqual({ ok: false, reason: 'unknown' });
    expect(engine.isClassMeterFull()).toBe(true);
  });
});
