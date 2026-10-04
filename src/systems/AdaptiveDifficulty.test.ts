import { afterEach, describe, expect, it, vi } from 'vitest';
import { Enemy } from '../entities/Enemy';
import { Player, type PlayerSaveData } from '../entities/Player';
import { CombatEngine } from './CombatSystem';
import {
  ADAPTIVE_MIN_SAMPLES,
  ADAPTIVE_WINDOW,
  MAX_AGGRO_MULT,
  MAX_EVENT_CHANCE_MULT,
  MAX_PACK_SHIFT_EASIER,
  MAX_PACK_SHIFT_HARDER,
  MAX_REWARD_BONUS,
  MIN_AGGRO_MULT,
  MIN_EVENT_CHANCE_MULT,
  adaptiveModifiers,
  cloneAdaptiveState,
  createInitialAdaptiveState,
  fightPressure,
  normalizeAdaptiveState,
  recordFight,
  rewardMultiplier,
  shiftPackWeights,
  struggleScore,
  type AdaptiveState,
  type FightRecord,
} from './AdaptiveDifficulty';
import { rollPackSize } from './monsterSpawning';

const EASY: FightRecord = { died: false, hpLost: 0, potions: 0, seconds: 6 };
const ROUGH: FightRecord = { died: false, hpLost: 0.8, potions: 2, seconds: 50 };
const DEATH: FightRecord = { died: true, hpLost: 1, potions: 3, seconds: 30 };

function stateOf(...fights: FightRecord[]): AdaptiveState {
  const state = createInitialAdaptiveState();
  for (const f of fights) recordFight(state, f);
  return state;
}

describe('struggle score', () => {
  it('stays neutral until there are enough fights to judge', () => {
    expect(struggleScore(createInitialAdaptiveState())).toBe(0);
    expect(struggleScore(stateOf(DEATH, DEATH))).toBe(0);
    expect(ADAPTIVE_MIN_SAMPLES).toBe(3);
  });

  it('reads easy wins as dominating and rough fights as struggling', () => {
    expect(struggleScore(stateOf(EASY, EASY, EASY, EASY))).toBeLessThan(-0.5);
    expect(struggleScore(stateOf(ROUGH, ROUGH, ROUGH, ROUGH))).toBeGreaterThan(0.5);
  });

  it('keeps every fight pressure and the score inside [-1, 1]', () => {
    for (const f of [EASY, ROUGH, DEATH, { died: false, hpLost: 5, potions: 99, seconds: 9999 }, { died: false, hpLost: -3, potions: -1, seconds: -5 }]) {
      const p = fightPressure(f);
      expect(p).toBeGreaterThanOrEqual(-1);
      expect(p).toBeLessThanOrEqual(1);
    }
    expect(struggleScore(stateOf(DEATH, DEATH, DEATH, DEATH))).toBeLessThanOrEqual(1);
  });

  it('lets recent deaths outweigh easy wins around them, then recover as they leave the window', () => {
    const afterDeaths = stateOf(EASY, EASY, EASY, DEATH, DEATH);
    expect(struggleScore(afterDeaths)).toBeGreaterThanOrEqual(0.7);
    for (let i = 0; i < ADAPTIVE_WINDOW; i++) recordFight(afterDeaths, EASY);
    expect(struggleScore(afterDeaths)).toBeLessThan(0);
  });
});

describe('recording', () => {
  it('only remembers the most recent window of fights', () => {
    const state = stateOf(...Array.from({ length: ADAPTIVE_WINDOW + 5 }, () => EASY));
    expect(state.recent).toHaveLength(ADAPTIVE_WINDOW);
  });

  it('sanitizes garbage input into bounded records', () => {
    const state = createInitialAdaptiveState();
    recordFight(state, { died: false, hpLost: Number.NaN, potions: 1e9, seconds: Infinity });
    expect(state.recent[0]).toEqual({ died: false, hpLost: 0, potions: 20, seconds: 0 });
  });

  it('normalizes missing, malformed and oversized saved state', () => {
    expect(normalizeAdaptiveState(undefined)).toEqual(createInitialAdaptiveState());
    expect(normalizeAdaptiveState('lixo')).toEqual(createInitialAdaptiveState());
    expect(normalizeAdaptiveState({ recent: 'x' })).toEqual(createInitialAdaptiveState());
    const big = { recent: [...Array.from({ length: 30 }, () => ({ ...EASY })), null, 7, { hpLost: 'a' }] };
    const normalized = normalizeAdaptiveState(big);
    expect(normalized.recent.length).toBeLessThanOrEqual(ADAPTIVE_WINDOW);
    expect(normalized.recent.every((r) => r.hpLost >= 0 && r.hpLost <= 1)).toBe(true);
  });

  it('clones without sharing records', () => {
    const state = stateOf(EASY);
    const copy = cloneAdaptiveState(state);
    copy.recent[0].potions = 9;
    expect(state.recent[0].potions).toBe(0);
  });
});

describe('modifiers stay gentle and bounded', () => {
  const samples: AdaptiveState[] = [
    createInitialAdaptiveState(),
    stateOf(EASY, EASY, EASY, EASY, EASY, EASY),
    stateOf(ROUGH, ROUGH, ROUGH, ROUGH),
    stateOf(DEATH, DEATH, DEATH, DEATH, DEATH),
    stateOf(EASY, ROUGH, EASY, DEATH, EASY),
  ];

  it('never leaves its documented bounds for any state', () => {
    for (const state of samples) {
      const m = adaptiveModifiers(state);
      expect(m.packShift).toBeGreaterThanOrEqual(MAX_PACK_SHIFT_EASIER);
      expect(m.packShift).toBeLessThanOrEqual(MAX_PACK_SHIFT_HARDER);
      expect(m.aggroRadiusMult).toBeGreaterThanOrEqual(MIN_AGGRO_MULT);
      expect(m.aggroRadiusMult).toBeLessThanOrEqual(MAX_AGGRO_MULT);
      expect(m.eventChanceMult).toBeGreaterThanOrEqual(MIN_EVENT_CHANCE_MULT);
      expect(m.eventChanceMult).toBeLessThanOrEqual(MAX_EVENT_CHANCE_MULT);
      expect(m.rewardBonus).toBeGreaterThanOrEqual(0);
      expect(m.rewardBonus).toBeLessThanOrEqual(MAX_REWARD_BONUS);
    }
  });

  it('is exactly neutral with no data', () => {
    expect(adaptiveModifiers(createInitialAdaptiveState())).toEqual({ score: 0, packShift: 0, aggroRadiusMult: 1, eventChanceMult: 1, rewardBonus: 0 });
    expect(rewardMultiplier(createInitialAdaptiveState())).toBe(1);
  });

  it('eases off and pays a bonus when struggling', () => {
    const m = adaptiveModifiers(stateOf(DEATH, DEATH, DEATH, DEATH));
    expect(m.packShift).toBeLessThan(0);
    expect(m.aggroRadiusMult).toBeLessThan(1);
    expect(m.eventChanceMult).toBeLessThan(1);
    expect(m.rewardBonus).toBeGreaterThan(0);
    expect(rewardMultiplier(stateOf(DEATH, DEATH, DEATH, DEATH))).toBeLessThanOrEqual(1 + MAX_REWARD_BONUS);
  });

  it('only nudges a dominating player slightly and never cuts their rewards', () => {
    const m = adaptiveModifiers(stateOf(EASY, EASY, EASY, EASY, EASY));
    expect(m.packShift).toBeGreaterThan(0);
    expect(m.packShift).toBeLessThanOrEqual(0.1);
    expect(m.aggroRadiusMult).toBeLessThanOrEqual(1.05);
    expect(m.rewardBonus).toBe(0);
    expect(rewardMultiplier(stateOf(EASY, EASY, EASY, EASY, EASY))).toBe(1);
  });

  it('gives no reward bonus for a merely mixed streak', () => {
    expect(adaptiveModifiers(stateOf(EASY, ROUGH, EASY, ROUGH)).rewardBonus).toBe(0);
  });
});

describe('shiftPackWeights', () => {
  const weights = [0.4, 0.3, 0.2, 0.1];

  it('returns an equal copy for a zero shift', () => {
    const out = shiftPackWeights(weights, 0);
    expect(out).toEqual(weights);
    expect(out).not.toBe(weights);
  });

  it('moves weight toward solos for a negative shift and toward big bands for a positive one', () => {
    const easier = shiftPackWeights(weights, -0.25);
    const harder = shiftPackWeights(weights, 0.1);
    expect(easier[0]).toBeGreaterThan(weights[0]);
    expect(easier[3]).toBeLessThan(weights[3]);
    expect(harder[0]).toBeLessThan(weights[0]);
    expect(harder[3]).toBeGreaterThan(weights[3]);
  });

  it('never zeroes a pack size at the extreme bounds, so variety survives', () => {
    for (const shift of [MAX_PACK_SHIFT_EASIER, MAX_PACK_SHIFT_HARDER]) {
      expect(shiftPackWeights(weights, shift).every((w) => w > 0)).toBe(true);
    }
  });

  it('leaves a single-weight table alone and still rolls a valid size', () => {
    expect(shiftPackWeights([1], -0.25)).toEqual([1]);
    expect(rollPackSize(shiftPackWeights(weights, -0.25), () => 0.999)).toBeLessThanOrEqual(weights.length);
  });

  it('measurably shrinks the average band when struggling', () => {
    const mean = (w: number[]): number => {
      let sum = 0;
      const total = w.reduce((a, b) => a + b, 0);
      w.forEach((x, i) => (sum += ((i + 1) * x) / total));
      return sum;
    };
    expect(mean(shiftPackWeights(weights, MAX_PACK_SHIFT_EASIER))).toBeLessThan(mean(weights));
    expect(mean(shiftPackWeights(weights, MAX_PACK_SHIFT_HARDER))).toBeGreaterThan(mean(weights));
  });
});

describe('persistence on the player', () => {
  it('defaults a fresh player and an old save to an empty state', () => {
    const player = Player.createNew('Testador', 'warrior');
    expect(player.adaptive).toEqual(createInitialAdaptiveState());
    const save = player.toSaveData() as Partial<PlayerSaveData>;
    delete save.adaptive;
    expect(Player.fromSaveData(save as PlayerSaveData).adaptive).toEqual(createInitialAdaptiveState());
  });

  it('round-trips recorded fights through the save data without sharing state', () => {
    const player = Player.createNew('Testador', 'warrior');
    recordFight(player.adaptive, ROUGH);
    const json = JSON.parse(JSON.stringify(player.toSaveData())) as PlayerSaveData;
    const loaded = Player.fromSaveData(json);
    expect(loaded.adaptive).toEqual(player.adaptive);
    recordFight(player.adaptive, EASY);
    expect(json.adaptive.recent).toHaveLength(1);
  });
});

describe('combat integration', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function victoryFor(player: Player): { xp: number; gold: number; enemy: Enemy } {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const enemy = new Enemy('stone_golem');
    enemy.currentHp = 1;
    const engine = new CombatEngine(player, [enemy]);
    const result = engine.useSkill('basic_attack', 0);
    if (!result.ok) throw new Error('skill failed');
    const victory = result.events.find((e) => e.kind === 'victory')!;
    return { xp: victory.xpGained ?? 0, gold: victory.goldGained ?? 0, enemy };
  }

  it('leaves enemy stats untouched whatever the player performance', () => {
    const struggling = Player.createNew('Testador', 'warrior');
    for (let i = 0; i < 5; i++) recordFight(struggling.adaptive, DEATH);
    const baseline = new Enemy('stone_golem');
    const engine = new CombatEngine(struggling, [new Enemy('stone_golem')]);
    expect(engine.enemies[0].stats).toEqual(baseline.stats);
    expect(engine.enemies[0].currentHp).toBe(baseline.currentHp);
  });

  it('pays exactly the base reward to a neutral player and a small bonus to a struggling one', () => {
    const neutral = victoryFor(Player.createNew('Testador', 'warrior'));
    expect(neutral.xp).toBe(neutral.enemy.def.xpReward);

    const struggling = Player.createNew('Testador', 'warrior');
    for (let i = 0; i < 5; i++) recordFight(struggling.adaptive, DEATH);
    const boosted = victoryFor(struggling);
    expect(boosted.xp).toBe(Math.round(neutral.xp * (1 + MAX_REWARD_BONUS)));
    expect(boosted.gold).toBeGreaterThan(neutral.gold);
    expect(boosted.gold).toBeLessThanOrEqual(Math.round(neutral.gold * (1 + MAX_REWARD_BONUS)));
  });

  it('never reduces rewards for a player who dominates', () => {
    const dominant = Player.createNew('Testador', 'warrior');
    for (let i = 0; i < 6; i++) recordFight(dominant.adaptive, EASY);
    const neutral = victoryFor(Player.createNew('Testador', 'warrior'));
    expect(victoryFor(dominant).xp).toBe(neutral.xp);
  });
});
