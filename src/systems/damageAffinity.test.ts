import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DamageTag, EnemyDefinition } from '../config/types';
import { BOSS_DEFINITIONS } from '../data/bosses';
import { ENEMY_DEFINITIONS } from '../data/enemies';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import { CombatEngine, type CombatEvent } from './CombatSystem';
import { RESISTANCE_MULTIPLIER, WEAKNESS_MULTIPLIER, affinityLabel, affinityMultiplier, damageAffinity } from './damageAffinity';

afterEach(() => {
  vi.restoreAllMocks();
});

/** 0.99 = every attack hits, never crits, fixed variance — so the same hit always rolls the same raw damage. */
function mockRandom(value: number) {
  return vi.spyOn(Math, 'random').mockReturnValue(value);
}

function playerOf(classId: string, level = 20): Player {
  const player = Player.createNew('Testador', classId);
  player.level = level;
  player.currentHp = player.stats.maxHp;
  player.currentMp = player.stats.maxMp;
  return player;
}

function target(id: string): Enemy {
  const enemy = new Enemy(id);
  enemy.currentHp = 1_000_000;
  enemy.actionTimer = Number.POSITIVE_INFINITY;
  return enemy;
}

/** The single damage event of one skill cast by a fresh class-`classId` player against a fresh `enemyId`. */
function hitOf(classId: string, skillId: string, enemyId: string): CombatEvent {
  const engine = new CombatEngine(playerOf(classId), [target(enemyId)]);
  const result = engine.useSkill(skillId, 0);
  if (!result.ok) throw new Error(`${skillId} refused: ${result.reason}`);
  return result.events.find((e) => e.kind === 'damage')!;
}

describe('damageAffinity (pure lookup)', () => {
  it('a hit is weak/resisted if its kind OR its element is listed; unlisted is neutral', () => {
    const def = { weaknesses: ['fire', 'physical'] as DamageTag[], resistances: ['ice'] as DamageTag[] };
    expect(damageAffinity(def, 'magical', 'fire')).toBe('weak');
    expect(damageAffinity(def, 'physical')).toBe('weak');
    expect(damageAffinity(def, 'magical', 'ice')).toBe('resist');
    expect(damageAffinity(def, 'magical')).toBeNull();
    expect(damageAffinity(def, 'magical', 'holy')).toBeNull();
    expect(damageAffinity({}, 'physical')).toBeNull();
  });

  it('a hit matching both a weakness and a resistance cancels out; two weak tags do not stack', () => {
    expect(damageAffinity({ weaknesses: ['fire'], resistances: ['magical'] }, 'magical', 'fire')).toBeNull();
    expect(damageAffinity({ weaknesses: ['physical', 'holy'] }, 'physical', 'holy')).toBe('weak');
  });

  it('multipliers and floating-text cues', () => {
    expect(affinityMultiplier('weak')).toBe(WEAKNESS_MULTIPLIER);
    expect(affinityMultiplier('resist')).toBe(RESISTANCE_MULTIPLIER);
    expect(affinityMultiplier(null)).toBe(1);
    expect(WEAKNESS_MULTIPLIER).toBeGreaterThan(1);
    expect(RESISTANCE_MULTIPLIER).toBeLessThan(1);
    expect(affinityLabel('weak')).toBe('Fraco!');
    expect(affinityLabel('resist')).toBe('Resistiu');
    expect(affinityLabel(null)).toBeNull();
  });
});

describe('enemy affinity data', () => {
  const all: EnemyDefinition[] = [...ENEMY_DEFINITIONS, ...BOSS_DEFINITIONS];
  const VALID: DamageTag[] = ['physical', 'magical', 'fire', 'ice', 'holy', 'dark'];

  it('only uses real damage tags, never lists a tag as both weakness and resistance', () => {
    for (const def of all) {
      for (const tag of [...(def.weaknesses ?? []), ...(def.resistances ?? [])]) expect(VALID, `${def.id}: ${tag}`).toContain(tag);
      const overlap = (def.weaknesses ?? []).filter((t) => def.resistances?.includes(t));
      expect(overlap, def.id).toEqual([]);
    }
  });

  it('gives the roster real variety, including elements every elemental class can exploit', () => {
    expect(all.filter((d) => d.weaknesses?.length).length).toBeGreaterThanOrEqual(8);
    expect(all.filter((d) => d.resistances?.length).length).toBeGreaterThanOrEqual(5);
    const weakTo = new Set(all.flatMap((d) => d.weaknesses ?? []));
    for (const tag of ['physical', 'fire', 'ice', 'holy'] as DamageTag[]) expect(weakTo.has(tag), tag).toBe(true);
  });

  it('survives the balance/tier scaling a live Enemy applies to its definition', () => {
    expect(new Enemy('skeleton').def.weaknesses).toContain('holy');
    expect(new Enemy('skeleton', 2).def.weaknesses).toContain('holy');
    expect(new Enemy('boss_voiceless_root').def.resistances).toContain('dark');
  });
});

describe('affinity in combat damage', () => {
  it('a weakness raises the damage by WEAKNESS_MULTIPLIER and cues "Fraco!"; a resistance lowers it and cues "Resistiu"', () => {
    mockRandom(0.99);
    const weak = hitOf('warrior', 'basic_attack', 'skeleton'); // weak to physical
    expect(weak.affinity).toBe('weak');
    expect(weak.text).toContain('Fraco!');

    // Same enemy, same roll — only the lookup is stubbed neutral — isolates the multiplier.
    const skeletonDef = new Enemy('skeleton').def;
    const spy = vi.spyOn(Enemy.prototype, 'def', 'get');
    spy.mockReturnValue({ ...skeletonDef, weaknesses: [], resistances: [] });
    const neutral = hitOf('warrior', 'basic_attack', 'skeleton');
    expect(neutral.affinity).toBeUndefined();
    expect(neutral.text).not.toContain('Fraco!');
    expect(weak.amount! / neutral.amount!).toBeCloseTo(WEAKNESS_MULTIPLIER, 1);

    spy.mockReturnValue({ ...skeletonDef, weaknesses: [], resistances: ['physical'] });
    const resisted = hitOf('warrior', 'basic_attack', 'skeleton');
    expect(resisted.affinity).toBe('resist');
    expect(resisted.text).toContain('Resistiu');
    expect(resisted.amount! / neutral.amount!).toBeCloseTo(RESISTANCE_MULTIPLIER, 1);
  });

  it('elemental skills trigger the element, not just the kind: fire/ice mage spells, holy cleric, dark necromancer', () => {
    mockRandom(0.99);
    expect(hitOf('mage', 'mage_fireball', 'slime').affinity).toBe('weak');
    expect(hitOf('mage', 'mage_fireball', 'fire_elemental').affinity).toBe('resist');
    expect(hitOf('mage', 'mage_ice_lance', 'fire_elemental').affinity).toBe('weak');
    expect(hitOf('mage', 'mage_ice_lance', 'slime').affinity).toBeUndefined();
    expect(hitOf('cleric', 'cleric_smite', 'skeleton').affinity).toBe('weak');
    expect(hitOf('necromancer', 'necro_drain', 'skeleton').affinity).toBe('resist');
    expect(hitOf('paladin', 'paladin_holy_strike', 'dark_wolf').affinity).toBe('weak');
  });

  it('a skill with no element and a basic attack stay neutral against elemental-only weaknesses', () => {
    mockRandom(0.99);
    expect(hitOf('mage', 'basic_attack', 'slime').affinity).toBeUndefined();
    expect(hitOf('warrior', 'basic_attack', 'slime').affinity).toBeUndefined();
  });

  it('the paladin\'s Veredito Sagrado is holy: it exploits a holy weakness', () => {
    mockRandom(0.99);
    const player = playerOf('paladin');
    const engine = new CombatEngine(player, [target('skeleton')]);
    for (let i = 0; i < 25; i++) {
      engine.useSkill('basic_attack', 0);
      engine.tick(1.2);
    }
    const result = engine.useClassAbility();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.find((e) => e.kind === 'damage')!.affinity).toBe('weak');
  });
});
