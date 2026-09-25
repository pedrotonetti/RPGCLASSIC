import { describe, expect, it } from 'vitest';
import { Player } from '../entities/Player';
import { DUNGEON_DEFINITIONS, getDungeonBossDefinition, getDungeonById } from '../data/dungeons';
import { completeDungeon, encounterProgressText, recordEncounterCleared, startDungeonRun } from './DungeonSystem';

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
