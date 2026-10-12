import { describe, expect, it } from 'vitest';
import { Player } from '../entities/Player';
import { DUNGEON_DEFINITIONS, getDungeonBossDefinition, getDungeonById } from '../data/dungeons';
import { rarityTier } from '../config/rarity';
import { checkAchievements, isUnlocked } from './AchievementSystem';
import { dayIndex, planDungeonRun } from './DungeonModifierSystem';
import { ELITE_REWARD_BONUS } from './DungeonRoomSystem';
import {
  addRunBlessing,
  chestRarityFloor,
  completeDungeon,
  encounterProgressText,
  recordEncounterCleared,
  runPlayerModifiers,
  runRewardBonus,
  startDungeonRun,
} from './DungeonSystem';
import { PITY_LEGENDARY_THRESHOLD } from './LootPity';
import { getCounter } from './WorldStateSystem';

function freshPlayer(): Player {
  return Player.createNew('Testador', 'warrior');
}

describe('DUNGEON_DEFINITIONS', () => {
  it('ships at least three dungeons spanning early/mid/late tiers', () => {
    expect(DUNGEON_DEFINITIONS.length).toBeGreaterThanOrEqual(3);
    const tiers = new Set(DUNGEON_DEFINITIONS.map((d) => d.tier));
    expect(tiers).toEqual(new Set(['early', 'mid', 'late']));
  });

  it('every dungeon has at least one fixed encounter and a resolvable boss', () => {
    for (const dungeon of DUNGEON_DEFINITIONS) {
      expect(dungeon.encounters.length).toBeGreaterThan(0);
      for (const encounter of dungeon.encounters) {
        expect(encounter.enemyIds.length).toBeGreaterThan(0);
      }
      const boss = getDungeonBossDefinition(dungeon);
      expect(boss.isBoss).toBe(true);
      expect(boss.stats.maxHp).toBeGreaterThan(0);
    }
  });

  it('places every dungeon portal at a distinct, fixed overworld position', () => {
    const keys = DUNGEON_DEFINITIONS.map((d) => `${d.portal.hostZoneId}:${d.portal.atTile.x},${d.portal.atTile.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives later-tier bosses a bigger stat/reward budget than earlier ones', () => {
    const early = getDungeonBossDefinition(getDungeonById('root_hollow'));
    const mid = getDungeonBossDefinition(getDungeonById('rotten_sap_gallery'));
    const late = getDungeonBossDefinition(getDungeonById('silent_root_rift'));
    expect(mid.stats.maxHp).toBeGreaterThan(early.stats.maxHp);
    expect(late.stats.maxHp).toBeGreaterThan(mid.stats.maxHp);
    expect(late.xpReward).toBeGreaterThan(early.xpReward);
  });

  it('every fixed encounter and the boss sit at a distinct tile within their own dungeon', () => {
    for (const dungeon of DUNGEON_DEFINITIONS) {
      const keys = [...dungeon.encounters.map((e) => `${e.atTile.x},${e.atTile.y}`), `${dungeon.bossTile.x},${dungeon.bossTile.y}`];
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('encounter progression', () => {
  it('starts a run at 0/N cleared, at tier 1 by default', () => {
    const dungeon = getDungeonById('root_hollow');
    const state = startDungeonRun(dungeon);
    expect(state.clearedEncounters).toBe(0);
    expect(state.totalEncounters).toBe(dungeon.encounters.length);
    expect(state.bossDefeated).toBe(false);
    expect(state.tier).toBe(1);
    expect(encounterProgressText(state)).toBe(`Emboscadas: 0/${dungeon.encounters.length}`);
  });

  it('can start a run at a higher tier, and the HUD text says so — a tier-1 run\'s text is unchanged', () => {
    const dungeon = getDungeonById('root_hollow');
    const tier1 = startDungeonRun(dungeon, 1);
    const tier3 = startDungeonRun(dungeon, 3);
    expect(encounterProgressText(tier1)).toBe(`Emboscadas: 0/${dungeon.encounters.length}`);
    expect(encounterProgressText(tier3)).toBe(`Emboscadas: 0/${dungeon.encounters.length} · Tier 3`);
  });

  it('advances one at a time as each fixed pod is cleared, without mutating the previous state', () => {
    const dungeon = getDungeonById('root_hollow');
    let state = startDungeonRun(dungeon);
    const initial = state;

    state = recordEncounterCleared(state);
    expect(state.clearedEncounters).toBe(1);
    expect(initial.clearedEncounters).toBe(0); // never mutated in place

    for (let i = 1; i < dungeon.encounters.length; i++) {
      state = recordEncounterCleared(state);
    }
    expect(state.clearedEncounters).toBe(dungeon.encounters.length);
  });

  it('never counts past the dungeon\'s total (defensive clamp)', () => {
    const dungeon = getDungeonById('root_hollow');
    let state = startDungeonRun(dungeon);
    for (let i = 0; i < dungeon.encounters.length + 5; i++) {
      state = recordEncounterCleared(state);
    }
    expect(state.clearedEncounters).toBe(dungeon.encounters.length);
  });
});

describe('completeDungeon', () => {
  it('defeating the boss grants the guaranteed bonus gold and a guaranteed item, on top of anything already granted', () => {
    const player = freshPlayer();
    const dungeon = getDungeonById('root_hollow');
    let state = startDungeonRun(dungeon);
    for (let i = 0; i < dungeon.encounters.length; i++) state = recordEncounterCleared(state);
    expect(state.clearedEncounters).toBe(dungeon.encounters.length);

    const goldBefore = player.gold;
    const bagSizeBefore = player.bag.length;

    const { state: finalState, reward } = completeDungeon(player, dungeon, state);

    expect(finalState.bossDefeated).toBe(true);
    expect(player.gold).toBe(goldBefore + dungeon.bonusGold);
    expect(reward.bonusGold).toBe(dungeon.bonusGold);
    expect(reward.itemGranted).toBe(true);
    expect(player.bag.length).toBe(bagSizeBefore + 1);
    expect(player.bag[player.bag.length - 1].templateId).toBe(dungeon.rewardItem.templateId);
    expect(player.bag[player.bag.length - 1].rarity).toBe(dungeon.rewardItem.rarity);
    expect(reward.message).toContain(dungeon.name);
  });

  it('still grants the guaranteed gold, and reports the miss, when the bag is full', () => {
    const player = freshPlayer();
    const dungeon = getDungeonById('root_hollow');
    while (!player.bagFull) player.addLoot({ uid: `filler_${player.bag.length}`, templateId: 'anel_sorte', rarity: 'verde', itemLevel: 1 });
    const goldBefore = player.gold;

    const { reward } = completeDungeon(player, dungeon, startDungeonRun(dungeon));

    expect(player.gold).toBe(goldBefore + dungeon.bonusGold);
    expect(reward.itemGranted).toBe(false);
  });

  it('grants noticeably more than a single open-world kill for each dungeon\'s own recommended level', () => {
    // Bonus gold alone (ignoring the boss's own goldReward, granted
    // separately through the ordinary combat path) already exceeds what a
    // full clear of any single field monster near that dungeon's own
    // recommended level pays out — the "meaningfully better" payoff bar.
    for (const dungeon of DUNGEON_DEFINITIONS) {
      const boss = getDungeonBossDefinition(dungeon);
      expect(dungeon.bonusGold + boss.goldReward).toBeGreaterThan(boss.goldReward * 1.5);
    }
  });
});

describe('completeDungeon — repeatable-tier scaling', () => {
  it('a tier-1 clear is byte-for-byte the same payout as before this feature existed', () => {
    const player = freshPlayer();
    const dungeon = getDungeonById('root_hollow');
    const state = startDungeonRun(dungeon, 1);
    const { reward } = completeDungeon(player, dungeon, state);
    expect(reward.tier).toBe(1);
    expect(reward.bonusGold).toBe(dungeon.bonusGold);
    expect(player.bag[player.bag.length - 1].rarity).toBe(dungeon.rewardItem.rarity);
  });

  it('a higher tier pays out proportionally more bonus gold and records the tier in the message', () => {
    const player = freshPlayer();
    const dungeon = getDungeonById('root_hollow');
    const state = startDungeonRun(dungeon, 3);
    const { reward } = completeDungeon(player, dungeon, state);
    expect(reward.tier).toBe(3);
    expect(reward.bonusGold).toBeGreaterThan(dungeon.bonusGold);
    expect(reward.message).toContain('Tier 3');
  });

  it('a higher tier escalates the guaranteed reward item up the rarity ladder', () => {
    const player = freshPlayer();
    const dungeon = getDungeonById('root_hollow'); // base reward rarity: azul
    const state = startDungeonRun(dungeon, 4);
    completeDungeon(player, dungeon, state);
    expect(player.bag[player.bag.length - 1].rarity).toBe('laranja');
  });

  it('records the dungeon\'s best-cleared tier on the player, and never lowers it on a later lower-tier replay', () => {
    const player = freshPlayer();
    const dungeon = getDungeonById('root_hollow');
    completeDungeon(player, dungeon, startDungeonRun(dungeon, 3));
    expect(player.dungeonTiers[dungeon.id]).toBe(3);

    completeDungeon(player, dungeon, startDungeonRun(dungeon, 1));
    expect(player.dungeonTiers[dungeon.id]).toBe(3); // still 3, not overwritten down to 1

    completeDungeon(player, dungeon, startDungeonRun(dungeon, 5));
    expect(player.dungeonTiers[dungeon.id]).toBe(5);
  });
});

describe('Dungeons 2.0 — planned runs (Distorções + varied rooms)', () => {
  const day = dayIndex(new Date(2026, 9, 11));

  it('a planned run carries its Distorções, the featured one, and a seeded room layout', () => {
    const dungeon = getDungeonById('silent_root_rift');
    const plan = planDungeonRun(dungeon, 5, day);
    const state = startDungeonRun(dungeon, 5, plan);
    expect(state.modifierIds).toEqual(plan.modifierIds);
    expect(state.featuredModifierId).toBe(plan.featuredId);
    expect(state.rooms).toHaveLength(dungeon.encounters.length);
    expect(state.rooms[0].kind).toBe('combat');
    expect(startDungeonRun(dungeon, 5, plan).rooms).toEqual(state.rooms); // same plan, same rooms
  });

  it('an unplanned run is all plain ambushes with no Distorções (legacy behaviour)', () => {
    const state = startDungeonRun(getDungeonById('root_hollow'), 2);
    expect(state.modifierIds).toEqual([]);
    expect(state.rooms.every((r) => r.kind === 'combat')).toBe(true);
    expect(runRewardBonus(state)).toBe(0);
  });

  it('recordEncounterCleared with an index never counts the same room twice, and tallies elites', () => {
    const dungeon = getDungeonById('rotten_sap_gallery');
    let state = startDungeonRun(dungeon, 1);
    state = { ...state, rooms: state.rooms.map((r, i) => (i === 2 ? { kind: 'elite' as const } : r)) };
    state = recordEncounterCleared(state, 2);
    const again = recordEncounterCleared(state, 2);
    expect(again).toBe(state);
    expect(state.clearedEncounters).toBe(1);
    expect(state.elitesCleared).toBe(1);
    expect(runRewardBonus(state)).toBeCloseTo(ELITE_REWARD_BONUS);
  });

  it("blessings stack into the run's player modifiers on top of the Distorções", () => {
    const dungeon = getDungeonById('root_hollow');
    const plan = { dungeonId: dungeon.id, tier: 2, modifierIds: ['fio_da_navalha'], featuredId: 'fio_da_navalha', seed: 1 };
    let state = startDungeonRun(dungeon, 2, plan);
    const before = state;
    state = addRunBlessing(state, { critChance: 0.1 });
    state = addRunBlessing(state, { damageDealt: 0.12 });
    expect(before.blessings).toEqual({});
    const mods = runPlayerModifiers(state);
    expect(mods.critChance).toBeCloseTo(0.25);
    expect(mods.damageDealt).toBeCloseTo(0.12);
    expect(mods.damageTaken).toBeCloseTo(0.25);
  });

  it('Player.itemEffects folds the run modifiers in, and heals shrink under Seiva Amarga', () => {
    const player = freshPlayer();
    const baseCrit = player.itemEffects().mods.critChance;
    player.dungeonRunMods = { critChance: 0.15 };
    expect(player.itemEffects().mods.critChance).toBeCloseTo(baseCrit + 0.15);
    player.dungeonRunMods = null;
    expect(player.itemEffects().mods.critChance).toBeCloseTo(baseCrit);

    player.currentHp = 1;
    player.dungeonHealingMult = 0.6;
    expect(player.heal(50)).toBe(30);
  });

  it('chest rarity floor climbs with tier and heavy Distorções, capped at Mítico', () => {
    expect(chestRarityFloor(1, 0)).toBe('azul');
    expect(chestRarityFloor(3, 0)).toBe('amarelo');
    expect(chestRarityFloor(5, 0)).toBe('vermelho');
    expect(chestRarityFloor(5, 0.6)).toBe('laranja');
    expect(chestRarityFloor(5, 5)).toBe('laranja');
    expect(rarityTier(chestRarityFloor(1, 0.5))).toBeGreaterThan(rarityTier(chestRarityFloor(1, 0.1)));
  });

  it('a distorted clear pays more gold, drops the Baú da Distorção at or above its floor, and records the run', () => {
    const player = freshPlayer();
    const dungeon = getDungeonById('root_hollow');
    const plan = { dungeonId: dungeon.id, tier: 1, modifierIds: ['casca_endurecida', 'seiva_amarga'], featuredId: 'casca_endurecida', seed: 9 };
    const state = startDungeonRun(dungeon, 1, plan);
    const bonus = runRewardBonus(state);
    expect(bonus).toBeGreaterThan(0);
    const bagBefore = player.bag.length;
    const { reward } = completeDungeon(player, dungeon, state, { elapsedSeconds: 200, rng: () => 0 });
    expect(reward.bonusGold).toBe(Math.round(dungeon.bonusGold * (1 + bonus)));
    expect(reward.chestItem).not.toBeNull();
    expect(rarityTier(reward.chestItem!.rarity)).toBeGreaterThanOrEqual(rarityTier(chestRarityFloor(1, bonus)));
    expect(player.bag.length).toBe(bagBefore + 2);
    expect(reward.newFastest).toBe(true);
    expect(reward.message).toContain('Baú da Distorção');
    expect(reward.message).toContain('Novo recorde: 3:20');
    expect(player.dungeonRecords[dungeon.id]).toEqual({ clears: 1, fastestSeconds: 200, fastestTier: 1, mostModifiers: 2 });
    expect(getCounter(player.worldState, 'dungeon_distorted_clears')).toBe(1);
  });

  it('the chest honors and feeds loot pity: a due Lendário guarantee beats the chest floor, then resets', () => {
    const player = freshPlayer();
    player.lootPity.sinceLegendary = PITY_LEGENDARY_THRESHOLD;
    const dungeon = getDungeonById('root_hollow');
    const plan = { dungeonId: dungeon.id, tier: 1, modifierIds: ['seiva_amarga'], featuredId: 'x', seed: 3 };
    const { reward } = completeDungeon(player, dungeon, startDungeonRun(dungeon, 1, plan), { rng: () => 0 });
    expect(rarityTier(reward.chestItem!.rarity)).toBeGreaterThanOrEqual(rarityTier('vermelho'));
    expect(player.lootPity.sinceLegendary).toBe(0);
  });

  it('three Distorções unlock Tripla Distorção; elites feed Caçador de Elites', () => {
    const player = freshPlayer();
    const dungeon = getDungeonById('silent_root_rift');
    const plan = { dungeonId: dungeon.id, tier: 5, modifierIds: ['seiva_amarga', 'frenesi_das_raizes', 'sede_voraz'], featuredId: 'x', seed: 4 };
    let state = startDungeonRun(dungeon, 5, plan);
    state = { ...state, rooms: state.rooms.map((r, i) => (i === 1 ? { kind: 'elite' as const } : r)) };
    state = recordEncounterCleared(state, 1);
    completeDungeon(player, dungeon, state, { rng: () => 0.5 });
    expect(getCounter(player.worldState, 'dungeon_three_distortion_clears')).toBe(1);
    expect(getCounter(player.worldState, 'dungeon_elites_slain')).toBe(1);
    const unlocked = checkAchievements(player).map((a) => a.id);
    expect(unlocked).toContain('tripla_distorcao');
    expect(isUnlocked(player.achievements, 'cacador_de_elites')).toBe(false);
  });

  it('an untimed or slower clear does not overwrite the speed record', () => {
    const player = freshPlayer();
    const dungeon = getDungeonById('root_hollow');
    completeDungeon(player, dungeon, startDungeonRun(dungeon, 1), { elapsedSeconds: 120 });
    const { reward } = completeDungeon(player, dungeon, startDungeonRun(dungeon, 2), { elapsedSeconds: 300 });
    expect(reward.newFastest).toBe(false);
    expect(player.dungeonRecords[dungeon.id].fastestSeconds).toBe(120);
    expect(player.dungeonRecords[dungeon.id].clears).toBe(2);
  });
});
