import { describe, expect, it } from 'vitest';
import { Player } from '../entities/Player';
import { firstQuestIdForClass, getQuestById } from '../data/quests';
import { ensureQuestStarted, notifyEnemyDefeated, notifyLevelChanged, notifyTalkedTo } from './QuestSystem';

function freshPlayer(classId = 'warrior'): Player {
  return Player.createNew('Testador', classId);
}

describe('ensureQuestStarted', () => {
  it('assigns the class\'s first prelude quest to a brand-new character', () => {
    const player = freshPlayer('warrior');
    expect(player.activeQuestId).toBeNull();
    ensureQuestStarted(player);
    expect(player.activeQuestId).toBe(firstQuestIdForClass('warrior'));
  });

  it('does not override an already-active quest', () => {
    const player = freshPlayer('warrior');
    player.activeQuestId = 'q1_awaken';
    ensureQuestStarted(player);
    expect(player.activeQuestId).toBe('q1_awaken');
  });

  it('does not restart the chain for a character with no active quest who has already completed one', () => {
    const player = freshPlayer('warrior');
    player.completedQuestIds.push('warrior_q0_arrival');
    ensureQuestStarted(player);
    expect(player.activeQuestId).toBeNull();
  });
});

describe('notifyTalkedTo', () => {
  it('is a no-op when the active quest objective is not talkTo', () => {
    const player = freshPlayer();
    player.activeQuestId = 'q2_first_steps'; // a 'defeat' objective
    expect(notifyTalkedTo(player, 'tobias')).toBeNull();
    expect(player.activeQuestId).toBe('q2_first_steps');
  });

  it('is a no-op when talking to an NPC other than the objective\'s target', () => {
    const player = freshPlayer();
    player.activeQuestId = 'q1_awaken'; // talkTo: tobias
    expect(notifyTalkedTo(player, 'bram')).toBeNull();
    expect(player.activeQuestId).toBe('q1_awaken');
    expect(player.completedQuestIds).toHaveLength(0);
  });

  it('completes the quest and advances activeQuestId to nextQuestId when talking to the right NPC', () => {
    const player = freshPlayer();
    player.activeQuestId = 'q1_awaken';
    const quest = getQuestById('q1_awaken')!;
    const goldBefore = player.gold;

    const message = notifyTalkedTo(player, 'tobias');

    expect(message).not.toBeNull();
    expect(player.completedQuestIds).toContain('q1_awaken');
    expect(player.activeQuestId).toBe(quest.nextQuestId);
    expect(player.gold).toBe(goldBefore + quest.rewardGold);
  });
});

describe('notifyEnemyDefeated', () => {
  it('accepts any enemy for a defeat objective with no targetId, completing once the amount is reached', () => {
    const player = freshPlayer();
    player.activeQuestId = 'q2_first_steps'; // defeat, no targetId, amount 3

    expect(notifyEnemyDefeated(player, 'slime')).toBeNull();
    expect(notifyEnemyDefeated(player, 'goblin')).toBeNull();
    expect(player.questProgress['q2_first_steps']).toBe(2);

    const message = notifyEnemyDefeated(player, 'bat');
    expect(message).not.toBeNull();
    expect(player.activeQuestId).toBe('q3_new_blood');
  });

  it('only counts the matching enemy id for a defeat objective with a targetId', () => {
    const player = freshPlayer();
    player.activeQuestId = 'q4_goblin_hunt'; // defeat, targetId 'goblin', amount 5

    expect(notifyEnemyDefeated(player, 'slime')).toBeNull();
    expect(player.questProgress['q4_goblin_hunt'] ?? 0).toBe(0);

    for (let i = 0; i < 4; i++) {
      expect(notifyEnemyDefeated(player, 'goblin')).toBeNull();
    }
    expect(player.questProgress['q4_goblin_hunt']).toBe(4);

    const message = notifyEnemyDefeated(player, 'goblin');
    expect(message).not.toBeNull();
    expect(player.activeQuestId).toBe('q5_the_calling');
  });
});

describe('notifyLevelChanged', () => {
  it('does not complete a reachLevel objective below the threshold, and fires exactly at it', () => {
    const player = freshPlayer();
    player.activeQuestId = 'q3_new_blood'; // reachLevel 5

    player.level = 4;
    expect(notifyLevelChanged(player)).toBeNull();
    expect(player.activeQuestId).toBe('q3_new_blood');

    player.level = 5;
    const message = notifyLevelChanged(player);
    expect(message).not.toBeNull();
    expect(player.activeQuestId).toBe('q4_goblin_hunt');
  });
});

describe('quest chain end', () => {
  it('clears activeQuestId once the final quest in the chain (no nextQuestId) completes', () => {
    const player = freshPlayer();
    player.activeQuestId = 'q6_dragon'; // defeat, targetId 'young_dragon', amount 1, no nextQuestId

    const message = notifyEnemyDefeated(player, 'young_dragon');

    expect(message).not.toBeNull();
    expect(player.completedQuestIds).toContain('q6_dragon');
    expect(player.activeQuestId).toBeNull();
  });
});
