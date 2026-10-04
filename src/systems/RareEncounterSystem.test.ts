import { describe, expect, it } from 'vitest';
import { RARITY_ORDER } from '../config/rarity';
import { createStarterItem } from '../data/equipment';
import { Enemy } from '../entities/Enemy';
import { Player } from '../entities/Player';
import {
  PITY_GUARANTEE,
  PITY_PER_FAILED_MOUNT_ROLL,
  RARE_MIN_LOOT_RARITY,
  RARE_MIN_PLAYER_LEVEL,
  RARE_TIER_MULTIPLIER,
  ensureMinRarity,
  normalizePity,
  pityAfterFailedMountRoll,
  pityAfterKill,
  rareBaseChance,
  rareDisplayName,
  rareEncountersUnlocked,
  rarePrefixFor,
  rareSpawnChance,
  rollRareLoot,
  rollRareSpawn,
} from './RareEncounterSystem';

describe('rareSpawnChance', () => {
  it('uses a small per-zone base chance with no pity, higher in tougher zones', () => {
    expect(rareSpawnChance('warrior_start', 0)).toBe(rareBaseChance('warrior_start'));
    expect(rareSpawnChance('warrior_start', 0)).toBeLessThan(0.1);
    expect(rareBaseChance('baluarte_amanhecer')).toBeGreaterThan(rareBaseChance('warrior_start'));
  });

  it('grows strictly with pity until the guarantee', () => {
    let previous = rareSpawnChance('main_city', 0);
    for (let pity = 1; pity < PITY_GUARANTEE; pity++) {
      const chance = rareSpawnChance('main_city', pity);
      expect(chance).toBeGreaterThanOrEqual(previous);
      expect(chance).toBeLessThan(1);
      previous = chance;
    }
    expect(rareSpawnChance('main_city', 20)).toBeGreaterThan(rareSpawnChance('main_city', 5));
  });

  it('is a sure thing once pity reaches the guarantee, in every zone and trigger', () => {
    for (const zone of ['main_city', 'warrior_start', 'baluarte_amanhecer', 'zona_inexistente']) {
      expect(rareSpawnChance(zone, PITY_GUARANTEE)).toBe(1);
      expect(rareSpawnChance(zone, PITY_GUARANTEE + 50, 'respawn')).toBe(1);
    }
  });

  it('rolls respawns less generously than mounts below the guarantee', () => {
    expect(rareSpawnChance('main_city', 10, 'respawn')).toBeLessThan(rareSpawnChance('main_city', 10, 'mount'));
  });

  it('rollRareSpawn compares the injected roll against the chance', () => {
    const chance = rareSpawnChance('main_city', 10);
    expect(rollRareSpawn('main_city', 10, 'mount', () => chance - 0.0001)).toBe(true);
    expect(rollRareSpawn('main_city', 10, 'mount', () => chance + 0.0001)).toBe(false);
    expect(rollRareSpawn('main_city', PITY_GUARANTEE, 'mount', () => 0.999999)).toBe(true);
  });

  it('guarantees a rare within a bounded number of ordinary kills (no unlucky streak lasts forever)', () => {
    let pity = 0;
    let kills = 0;
    // Worst-case luck: every roll before the guarantee fails.
    while (!rollRareSpawn('warrior_start', pity, 'mount', () => 0.9999)) {
      pity = pityAfterKill(pity, false);
      kills++;
      expect(kills).toBeLessThanOrEqual(PITY_GUARANTEE);
    }
    expect(kills).toBe(PITY_GUARANTEE);
  });
});

describe('rareEncountersUnlocked', () => {
  it('keeps brand-new characters safe from elites until they have a few levels', () => {
    expect(rareEncountersUnlocked(1)).toBe(false);
    expect(rareEncountersUnlocked(RARE_MIN_PLAYER_LEVEL - 1)).toBe(false);
    expect(rareEncountersUnlocked(RARE_MIN_PLAYER_LEVEL)).toBe(true);
    expect(rareEncountersUnlocked(30)).toBe(true);
  });
});

describe('pity bookkeeping', () => {
  it('adds one per ordinary kill, capped at the guarantee', () => {
    expect(pityAfterKill(0, false)).toBe(1);
    expect(pityAfterKill(PITY_GUARANTEE, false)).toBe(PITY_GUARANTEE);
  });

  it('resets to zero only when a rare is defeated', () => {
    expect(pityAfterKill(33, true)).toBe(0);
  });

  it('a failed mount roll adds a little pity, also capped', () => {
    expect(pityAfterFailedMountRoll(3)).toBe(3 + PITY_PER_FAILED_MOUNT_ROLL);
    expect(pityAfterFailedMountRoll(PITY_GUARANTEE - 1)).toBe(PITY_GUARANTEE);
  });

  it('normalizePity tolerates missing, negative, fractional and garbage values', () => {
    expect(normalizePity(undefined)).toBe(0);
    expect(normalizePity(null)).toBe(0);
    expect(normalizePity('12')).toBe(0);
    expect(normalizePity(Number.NaN)).toBe(0);
    expect(normalizePity(-4)).toBe(0);
    expect(normalizePity(7.9)).toBe(7);
    expect(normalizePity(9999)).toBe(PITY_GUARANTEE);
  });
});

describe('Player.rarePity persistence', () => {
  it('starts at 0 and survives a save round-trip', () => {
    const player = Player.createNew('Testador', 'warrior');
    expect(player.rarePity).toBe(0);
    player.rarePity = 17;
    const reloaded = Player.fromSaveData(JSON.parse(JSON.stringify(player.toSaveData())));
    expect(reloaded.rarePity).toBe(17);
  });

  it('defaults safely for a save from before this field existed', () => {
    const data = Player.createNew('Antigo', 'mage').toSaveData() as unknown as Record<string, unknown>;
    delete data.rarePity;
    const reloaded = Player.fromSaveData(data as never);
    expect(reloaded.rarePity).toBe(0);
  });
});

describe('rare variant identity', () => {
  it('picks a stable, distinct prefix per species', () => {
    for (const id of ['goblin', 'skeleton', 'troll', 'stone_golem']) {
      expect(rarePrefixFor(id)).toBe(rarePrefixFor(id));
      expect(['Ancestral', 'Fulgente']).toContain(rarePrefixFor(id));
    }
    expect(rareDisplayName('goblin', 'Broto Retorcido')).toBe(`${rarePrefixFor('goblin')} Broto Retorcido`);
  });

  it('is meaningfully stronger than a normal spawn', () => {
    expect(RARE_TIER_MULTIPLIER).toBeGreaterThan(1.3);
  });
});

describe('a rare Enemy instance', () => {
  it('carries the prefixed name and meaningfully stronger stats/rewards than an ordinary spawn', () => {
    const plain = new Enemy('goblin');
    const rare = new Enemy('goblin', RARE_TIER_MULTIPLIER, rarePrefixFor('goblin'));
    expect(plain.name).toBe('Broto Retorcido');
    expect(rare.name).toBe(rareDisplayName('goblin', 'Broto Retorcido'));
    expect(rare.stats.maxHp).toBeGreaterThan(plain.stats.maxHp * 1.4);
    expect(rare.stats.attack).toBeGreaterThan(plain.stats.attack);
    expect(rare.def.xpReward).toBeGreaterThan(plain.def.xpReward);
    expect(rare.def.goldReward).toBeGreaterThan(plain.def.goldReward);
    expect(rare.def.level).toBeGreaterThan(plain.def.level);
    expect(rare.currentHp).toBe(rare.stats.maxHp);
  });
});

describe('guaranteed rare loot', () => {
  it('ensureMinRarity lifts lower rarities and never downgrades higher ones', () => {
    expect(ensureMinRarity(createStarterItem('espada_curta', 'verde', 3)).rarity).toBe(RARE_MIN_LOOT_RARITY);
    expect(ensureMinRarity(createStarterItem('espada_curta', 'laranja', 3)).rarity).toBe('laranja');
    expect(ensureMinRarity(createStarterItem('espada_curta', 'amarelo', 3), 'azul').rarity).toBe('amarelo');
  });

  it('rollRareLoot never rolls below the floor, over many rolls', () => {
    const floor = RARITY_ORDER.indexOf(RARE_MIN_LOOT_RARITY);
    for (let i = 0; i < 300; i++) {
      const item = rollRareLoot(5, 5, 0);
      expect(RARITY_ORDER.indexOf(item.rarity)).toBeGreaterThanOrEqual(floor);
      expect(item.itemLevel).toBeGreaterThanOrEqual(1);
    }
  });
});
