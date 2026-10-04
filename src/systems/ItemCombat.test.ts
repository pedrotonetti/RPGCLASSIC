import { afterEach, describe, expect, it, vi } from 'vitest';
import { rarityTier } from '../config/rarity';
import type { EquipmentInstance } from '../config/types';
import { emptyModifiers, type ItemModifiers } from '../data/affixes';
import { createStarterItem } from '../data/equipment';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { CombatEngine, type CombatEvent } from './CombatSystem';
import { FURY_PER_HIT } from './classMechanics';
import type { ResolvedItemEffects } from './ItemPassives';
import { PITY_EPIC_THRESHOLD } from './LootPity';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 0.99 = every attack hits and never crits, with a fixed damage variance. */
function mockRandom(value: number) {
  return vi.spyOn(Math, 'random').mockReturnValue(value);
}

function freshPlayer(classId = 'warrior', level = 1): Player {
  const player = Player.createNew('Testador', classId);
  player.level = level;
  player.currentHp = player.stats.maxHp;
  player.currentMp = player.stats.maxMp;
  return player;
}

/** Survives any hit and never acts on its own. */
function dummy(hp = 1_000_000, id = 'slime'): Enemy {
  const enemy = new Enemy(id);
  enemy.currentHp = hp;
  enemy.actionTimer = Number.POSITIVE_INFINITY;
  return enemy;
}

function gear(templateId: string, rarity: 'vermelho' | 'laranja' | 'azul' | 'amarelo' = 'vermelho'): EquipmentInstance {
  return createStarterItem(templateId, rarity, 1, () => 0.5);
}

/** Replaces the item-effect evaluation step with a fixed result, so a hook can be tested apart from any item data. */
function fakeEffects(player: Player, mods: Partial<ItemModifiers>, statMult: ResolvedItemEffects['statMult'] = {}): void {
  vi.spyOn(player, 'itemEffects').mockReturnValue({ mods: { ...emptyModifiers(), ...mods }, statMult });
}

function hitDamage(events: CombatEvent[]): number {
  return events.find((e) => e.kind === 'damage' && e.actorIsPlayer)!.amount!;
}

/** Enemy construction draws from Math.random, so build the enemies BEFORE queueing a random sequence for the attack. */
function basicHit(player: Player, enemy: Enemy, bystander: Enemy): { engine: CombatEngine; events: CombatEvent[] } {
  const engine = new CombatEngine(player, [enemy, bystander]);
  const result = engine.useSkill('basic_attack', 0);
  expect(result.ok).toBe(true);
  return { engine, events: result.ok ? result.events : [] };
}

/** A plain hit on a durable enemy, with a second one alive so the fight never ends (and never levels the player up mid-test). */
function plainHit(player: Player): { engine: CombatEngine; events: CombatEvent[] } {
  return basicHit(player, dummy(), dummy());
}

/** The attack roll order is: miss check, crit check, damage variance — everything after falls back to 0.99. */
function queueCrit() {
  return vi.spyOn(Math, 'random').mockReturnValueOnce(0.99).mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValue(0.99);
}

/** One slime swing at `player`, timed like the existing block/dodge tests. */
function takeHit(player: Player, how: 'unmitigated' | 'perfectBlock', enemy = new Enemy('slime')): { engine: CombatEngine; events: CombatEvent[]; enemy: Enemy } {
  enemy.actionTimer = 0;
  const engine = new CombatEngine(player, [enemy]);
  let events: CombatEvent[];
  if (how === 'perfectBlock') {
    engine.tick(0.2);
    engine.tick(0.4);
    engine.attemptBlock();
    events = engine.tick(0.05);
  } else {
    engine.tick(0.1);
    events = engine.tick(0.5);
  }
  return { engine, events, enemy };
}

describe('item passive hooks in the combat engine', () => {
  it('damageDealt scales the damage of a landed hit', () => {
    mockRandom(0.99);
    const base = hitDamage(plainHit(freshPlayer('warrior', 30)).events);
    const boosted = freshPlayer('warrior', 30);
    fakeEffects(boosted, { damageDealt: 0.5 });
    expect(hitDamage(plainHit(boosted).events) / base).toBeCloseTo(1.5, 1);
  });

  it('critDamage raises the crit multiplier above 1.6x', () => {
    const attack = (critDamage: number): CombatEvent[] => {
      const player = freshPlayer('warrior', 30);
      if (critDamage > 0) fakeEffects(player, { critDamage });
      const [enemy, bystander] = [dummy(), dummy()];
      queueCrit();
      const { events } = basicHit(player, enemy, bystander);
      vi.restoreAllMocks();
      return events;
    };
    const plain = attack(0);
    const boosted = attack(0.4);
    expect(plain.find((e) => e.kind === 'damage')!.crit).toBe(true);
    expect(hitDamage(boosted) / hitDamage(plain)).toBeCloseTo(2.0 / 1.6, 1);
  });

  it('lifeSteal heals the player for a share of the damage dealt', () => {
    mockRandom(0.99);
    const player = freshPlayer();
    player.currentHp = Math.floor(player.stats.maxHp / 2);
    const before = player.currentHp;
    fakeEffects(player, { lifeSteal: 0.2 });
    const { events } = plainHit(player);
    expect(player.currentHp - before).toBe(Math.round(hitDamage(events) * 0.2));
  });

  it('lifeSteal does not count overkill damage beyond the target\'s remaining HP', () => {
    mockRandom(0.99);
    const player = freshPlayer();
    player.currentHp = 1;
    fakeEffects(player, { lifeSteal: 0.25 });
    basicHit(player, dummy(4), dummy());
    expect(player.currentHp).toBeLessThanOrEqual(2);
  });

  it('thorns reflect a share of the damage taken back at the attacker', () => {
    mockRandom(0.99);
    const player = freshPlayer();
    fakeEffects(player, { thorns: 0.5 });
    const enemy = new Enemy('slime');
    enemy.currentHp = 100000;
    const { events } = takeHit(player, 'unmitigated', enemy);
    const taken = events.find((e) => e.kind === 'damage' && e.targetIsPlayer)!.amount!;
    expect(taken).toBeGreaterThan(0);
    expect(100000 - enemy.currentHp).toBe(Math.max(1, Math.round(taken * 0.5)));
    expect(events.some((e) => e.kind === 'damage' && e.actorIsPlayer && e.targetIndex === 0)).toBe(true);
  });

  it('thorns can finish off the attacker and credit the kill', () => {
    mockRandom(0.99);
    const player = freshPlayer();
    fakeEffects(player, { thorns: 0.5 });
    const enemy = new Enemy('slime');
    enemy.currentHp = 1;
    const { events, engine } = takeHit(player, 'unmitigated', enemy);
    expect(events.some((e) => e.kind === 'defeated')).toBe(true);
    expect(engine.outcome).toBe('victory');
  });

  it('damageTaken and damageReduction scale incoming hits both ways', () => {
    mockRandom(0.99);
    const taken = (mods: Partial<ItemModifiers>) => {
      const player = freshPlayer();
      if (Object.keys(mods).length > 0) fakeEffects(player, mods);
      return takeHit(player, 'unmitigated').events.find((e) => e.kind === 'damage' && e.targetIsPlayer)!.amount!;
    };
    const base = taken({});
    expect(taken({ damageTaken: 0.25 })).toBeGreaterThan(base);
    expect(taken({ damageReduction: 0.3 })).toBeLessThan(base);
  });

  it('mpCost discounts the mana a skill spends', () => {
    mockRandom(0.99);
    const spent = (templateId?: string) => {
      const player = freshPlayer('warrior', 5);
      if (templateId) player.equipment.arma = gear(templateId, 'laranja');
      const before = player.currentMp;
      const engine = new CombatEngine(player, [dummy(), dummy()]);
      expect(engine.useSkill('warrior_power_strike', 0).ok).toBe(true);
      return before - player.currentMp;
    };
    const full = spent();
    expect(full).toBeGreaterThan(0);
    expect(spent('grimorio_das_raizes')).toBe(Math.round(full * 0.8));
  });

  it('meterGain speeds up the class meter', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior');
    player.equipment.acessorio = gear('selo_do_eco', 'laranja');
    const { engine } = plainHit(player);
    expect(engine.classMeterValue).toBeCloseTo(FURY_PER_HIT * 1.5, 5);
  });

  it('on-hit status affixes proc on the enemy from a real equipped affix', () => {
    const player = freshPlayer('warrior');
    player.equipment.arma = { ...gear('espada_curta', 'azul'), affixes: [{ id: 'brasa', value: 0.16 }] };
    const [enemy, bystander] = [dummy(), dummy()];
    // miss check, crit check, variance, then the burn proc roll (0 is under any chance)
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.99).mockReturnValueOnce(0.99).mockReturnValueOnce(0.5).mockReturnValue(0);
    const { events } = basicHit(player, enemy, bystander);
    expect(enemy.statusEffects.some((s) => s.type === 'burn')).toBe(true);
    expect(events.some((e) => e.kind === 'statusApplied' && e.statusType === 'burn')).toBe(true);
  });

  it('conditional stat multipliers apply to effective stats only while the condition holds', () => {
    const player = freshPlayer('warrior', 10);
    player.equipment = { arma: gear('machado_das_brasas', 'azul'), armadura: gear('couraca_das_brasas', 'azul') };
    const engine = new CombatEngine(player, [dummy()]);
    player.currentHp = player.stats.maxHp;
    const healthy = engine.effectiveStats().attack;
    player.currentHp = Math.floor(player.stats.maxHp * 0.4);
    const hurt = engine.effectiveStats().attack;
    expect(hurt).toBe(Math.round(player.stats.attack * 1.2));
    expect(hurt).toBeGreaterThan(healthy);
  });

  it('goldFind boosts the gold of a victory', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior');
    player.equipment.acessorio = { ...gear('anel_sorte', 'azul'), affixes: [{ id: 'saque', value: 0.1 }] };
    const enemy = new Enemy('slime');
    enemy.currentHp = 1;
    enemy.actionTimer = Number.POSITIVE_INFINITY;
    const engine = new CombatEngine(player, [enemy]);
    const result = engine.useSkill('basic_attack', 0);
    expect(result.ok).toBe(true);
    const victory = result.ok ? result.events.find((e) => e.kind === 'victory') : undefined;
    expect(victory?.goldGained).toBe(Math.round(enemy.def.goldReward * 1.1));
  });
});

describe('unique and set triggers in a real fight', () => {
  it('Coração de Seiva heals on a kill', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior', 10);
    player.equipment.acessorio = gear('coracao_de_seiva');
    player.currentHp = Math.floor(player.stats.maxHp * 0.5);
    const before = player.currentHp;
    const { events } = basicHit(player, dummy(1), dummy());
    const trigger = events.find((e) => e.kind === 'heal' && e.text === 'Seiva Viva!');
    expect(trigger).toBeDefined();
    expect(player.currentHp - before).toBe(Math.round(player.stats.maxHp * 0.1));
    expect(events.findIndex((e) => e === trigger)).toBeLessThan(events.findIndex((e) => e.kind === 'defeated'));
  });

  it('Martelo do Último Zelador restores health and mana on a perfect block', () => {
    mockRandom(0.99);
    const player = freshPlayer('warrior', 10);
    player.equipment.arma = gear('martelo_do_zelador', 'laranja');
    player.currentHp = Math.floor(player.stats.maxHp * 0.5);
    player.currentMp = 0;
    const hpBefore = player.currentHp;
    const { events } = takeHit(player, 'perfectBlock');
    expect(events.find((e) => e.kind === 'damage' && e.targetIsPlayer)?.mitigation).toBe('perfectBlock');
    expect(player.currentHp - hpBefore).toBe(Math.round(player.stats.maxHp * 0.12));
    expect(player.currentMp).toBe(Math.round(player.stats.maxMp * 0.1));
  });

  it('Fome da Raiz restores mana when a hit crits', () => {
    const player = freshPlayer('mage', 10);
    player.equipment.arma = gear('grimorio_das_raizes', 'laranja');
    player.currentMp = 0;
    const [enemy, bystander] = [dummy(), dummy()];
    queueCrit();
    const { events } = basicHit(player, enemy, bystander);
    expect(events.find((e) => e.kind === 'damage')!.crit).toBe(true);
    expect(player.currentMp).toBe(Math.round(player.stats.maxMp * 0.05));
  });

  it('Manto da Sede makes mana come back faster only while HP is low', () => {
    const mpAfterOneSecond = (hpFraction: number): number => {
      const player = freshPlayer('mage', 10);
      player.equipment.armadura = gear('manto_da_sede');
      player.currentHp = Math.floor(player.stats.maxHp * hpFraction);
      player.currentMp = 0;
      new CombatEngine(player, [dummy()]).tick(1);
      return player.currentMp;
    };
    expect(mpAfterOneSecond(0.2)).toBeGreaterThan(mpAfterOneSecond(0.9) + 2);
  });

  it('Presa do Pacto hits harder and also hurts more to be hit by', () => {
    mockRandom(0.99);
    const bare = freshPlayer('warrior', 5);
    const pact = freshPlayer('warrior', 5);
    pact.equipment.arma = { ...gear('presa_do_pacto', 'laranja'), affixes: [] };
    const taken = (player: Player) => takeHit(player, 'unmitigated').events.find((e) => e.kind === 'damage' && e.targetIsPlayer)!.amount!;
    expect(taken(pact)).toBeGreaterThan(taken(bare));
    expect(hitDamage(plainHit(pact).events)).toBeGreaterThan(hitDamage(plainHit(bare).events));
  });
});

describe('pity in a real victory', () => {
  it('draws from and resets the player\'s persisted pity counter', () => {
    mockRandom(0.5);
    const player = freshPlayer('warrior');
    player.lootPity = { sinceEpic: PITY_EPIC_THRESHOLD, sinceLegendary: 0 };
    const enemy = new Enemy('stone_golem');
    enemy.currentHp = 1;
    enemy.actionTimer = Number.POSITIVE_INFINITY;
    const engine = new CombatEngine(player, [enemy]);
    const result = engine.useSkill('basic_attack', 0);
    expect(result.ok).toBe(true);
    const loot = result.ok ? result.events.find((e) => e.kind === 'victory')?.loot : undefined;
    expect(loot).toHaveLength(1);
    expect(rarityTier(loot![0].rarity)).toBeGreaterThanOrEqual(rarityTier('amarelo'));
    expect(player.lootPity.sinceEpic).toBe(0);
  });
});
