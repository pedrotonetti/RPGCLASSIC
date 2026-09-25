import { describe, expect, it } from 'vitest';
import { Player } from '../entities/Player';
import { getEquipmentTemplate } from '../data/equipment';
import { getNpcById } from '../data/npcs';
import { firstCallingQuestIdForClass, firstQuestIdForClass, getQuestById, lastCallingQuestIdForClass, SIDE_QUEST_STARTERS } from '../data/quests';
import {
  ensureAmaraRevealStarted,
  ensureClassCallingStarted,
  ensureQuestStarted,
  notifyEnemyDefeated,
  notifyLevelChanged,
  notifyTalkedTo,
  offerSideQuest,
} from './QuestSystem';

function freshPlayer(classId = 'warrior'): Player {
  return Player.createNew('Testador', classId);
}

/** All 8 playable classes — see src/config/classes.ts. */
const ALL_CLASS_IDS = ['warrior', 'mage', 'archer', 'cleric', 'paladin', 'assassin', 'necromancer', 'monk'];

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

    expect(notifyEnemyDefeated(player, 'slime')).not.toBeNull();
    expect(notifyEnemyDefeated(player, 'goblin')).not.toBeNull();
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
      expect(notifyEnemyDefeated(player, 'goblin')).not.toBeNull();
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

describe('ensureClassCallingStarted', () => {
  it('does nothing before q6_dragon (the current end of the shared chain) is completed', () => {
    const player = freshPlayer('warrior');
    ensureClassCallingStarted(player);
    expect(player.activeQuestId).toBeNull();
  });

  it('does not override an already-active quest, even after q6_dragon is done', () => {
    const player = freshPlayer('warrior');
    player.completedQuestIds.push('q6_dragon');
    player.activeQuestId = 'q1_awaken';
    ensureClassCallingStarted(player);
    expect(player.activeQuestId).toBe('q1_awaken');
  });

  it('does not restart a class\'s calling chain once its first quest is already completed', () => {
    const player = freshPlayer('warrior');
    player.completedQuestIds.push('q6_dragon', firstCallingQuestIdForClass('warrior'));
    ensureClassCallingStarted(player);
    expect(player.activeQuestId).toBeNull();
  });

  it.each(ALL_CLASS_IDS)('starts the %s calling chain\'s first quest once q6_dragon is complete and no quest is active', (classId) => {
    const player = freshPlayer(classId);
    player.completedQuestIds.push('q6_dragon');

    ensureClassCallingStarted(player);

    expect(player.activeQuestId).toBe(firstCallingQuestIdForClass(classId));
  });
});

describe('CLASS_CALLING_QUESTS chains', () => {
  it.each(ALL_CLASS_IDS)('starts %s\'s first calling quest as a talkTo objective that advances to a second quest', (classId) => {
    const firstId = firstCallingQuestIdForClass(classId);
    const quest = getQuestById(firstId);

    expect(quest).toBeDefined();
    expect(quest!.objective.kind).toBe('talkTo');
    expect(quest!.nextQuestId).toBeTruthy();
  });

  it.each(ALL_CLASS_IDS)('completes %s\'s first calling quest by talking to its deliverer NPC, advancing activeQuestId via nextQuestId', (classId) => {
    const player = freshPlayer(classId);
    const firstId = firstCallingQuestIdForClass(classId);
    const quest = getQuestById(firstId)!;
    player.activeQuestId = firstId;
    const goldBefore = player.gold;

    const message = notifyTalkedTo(player, quest.objective.targetId!);

    expect(message).not.toBeNull();
    expect(player.completedQuestIds).toContain(firstId);
    expect(player.activeQuestId).toBe(quest.nextQuestId);
    expect(player.gold).toBe(goldBefore + quest.rewardGold);
  });

  it('walks the warrior calling chain end to end: convoy -> convoy defense -> first line of defense', () => {
    const player = freshPlayer('warrior');
    player.completedQuestIds.push('q6_dragon');
    ensureClassCallingStarted(player);
    expect(player.activeQuestId).toBe('warrior_pc1_convoy');

    expect(notifyTalkedTo(player, 'doroteia_comboio')).not.toBeNull();
    expect(player.activeQuestId).toBe('warrior_pc2_convoy_defense');

    for (let i = 0; i < 5; i++) {
      expect(notifyEnemyDefeated(player, 'dark_wolf')).not.toBeNull();
    }
    expect(notifyEnemyDefeated(player, 'dark_wolf')).not.toBeNull();
    expect(player.activeQuestId).toBe('warrior_pc3_first_line');

    player.level = 12;
    expect(notifyLevelChanged(player)).toBeNull();
    player.level = 13;
    const finalMessage = notifyLevelChanged(player);

    expect(finalMessage).not.toBeNull();
    expect(player.activeQuestId).toBeNull();
    expect(player.completedQuestIds).toEqual(
      expect.arrayContaining(['q6_dragon', 'warrior_pc1_convoy', 'warrior_pc2_convoy_defense', 'warrior_pc3_first_line']),
    );
  });

  it('walks the mage calling chain end to end: scroll -> attune -> seal breaks', () => {
    const player = freshPlayer('mage');
    player.completedQuestIds.push('q6_dragon');
    ensureClassCallingStarted(player);
    expect(player.activeQuestId).toBe('mage_pc1_scroll');

    expect(notifyTalkedTo(player, 'correio_bento')).not.toBeNull();
    expect(player.activeQuestId).toBe('mage_pc2_attune');

    player.level = 14;
    expect(notifyLevelChanged(player)).not.toBeNull();
    expect(player.activeQuestId).toBe('mage_pc3_seal_broken');

    for (let i = 0; i < 5; i++) {
      expect(notifyEnemyDefeated(player, 'skeleton')).not.toBeNull();
    }
    const finalMessage = notifyEnemyDefeated(player, 'skeleton');

    expect(finalMessage).not.toBeNull();
    expect(player.activeQuestId).toBeNull();
  });
});

describe('ensureAmaraRevealStarted', () => {
  it('does nothing before the class\'s own calling chain is complete', () => {
    const player = freshPlayer('warrior');
    player.completedQuestIds.push('q6_dragon', 'warrior_pc1_convoy');
    ensureAmaraRevealStarted(player);
    expect(player.activeQuestId).toBeNull();
  });

  it('does not override an already-active quest', () => {
    const player = freshPlayer('warrior');
    player.completedQuestIds.push('q6_dragon', lastCallingQuestIdForClass('warrior'));
    player.activeQuestId = 'q1_awaken';
    ensureAmaraRevealStarted(player);
    expect(player.activeQuestId).toBe('q1_awaken');
  });

  it('does not restart the chain once its first quest is already completed', () => {
    const player = freshPlayer('warrior');
    player.completedQuestIds.push('q6_dragon', lastCallingQuestIdForClass('warrior'), 'amara_r1_evasion');
    ensureAmaraRevealStarted(player);
    expect(player.activeQuestId).toBeNull();
  });

  it.each(ALL_CLASS_IDS)('starts the class-agnostic reveal chain once %s\'s own calling chain is complete', (classId) => {
    const player = freshPlayer(classId);
    player.completedQuestIds.push('q6_dragon', lastCallingQuestIdForClass(classId));

    ensureAmaraRevealStarted(player);

    expect(player.activeQuestId).toBe('amara_r1_evasion');
  });
});

describe('AMARA_REVEAL_QUESTS chain', () => {
  it('walks the reveal chain end to end: evasion -> archives -> proof -> confession', () => {
    const player = freshPlayer('warrior');
    player.completedQuestIds.push('q6_dragon', lastCallingQuestIdForClass('warrior'));
    ensureAmaraRevealStarted(player);
    expect(player.activeQuestId).toBe('amara_r1_evasion');

    expect(notifyTalkedTo(player, 'tobias')).not.toBeNull();
    expect(player.activeQuestId).toBe('amara_r2_archives');

    expect(notifyTalkedTo(player, 'escrivao_aldo')).not.toBeNull();
    expect(player.activeQuestId).toBe('amara_r3_proof');

    for (let i = 0; i < 3; i++) {
      expect(notifyEnemyDefeated(player, 'skeleton')).not.toBeNull();
    }
    expect(notifyEnemyDefeated(player, 'skeleton')).not.toBeNull();
    expect(player.activeQuestId).toBe('amara_r4_confession');

    const finalMessage = notifyTalkedTo(player, 'tobias');
    expect(finalMessage).not.toBeNull();
    expect(player.activeQuestId).toBeNull();
    expect(player.completedQuestIds).toEqual(expect.arrayContaining(['amara_r1_evasion', 'amara_r2_archives', 'amara_r3_proof', 'amara_r4_confession']));
  });
});

describe('offerSideQuest', () => {
  it('does nothing before the prerequisite quest is completed', () => {
    const player = freshPlayer();
    expect(offerSideQuest(player, 'baltazar_relicario')).toBeNull();
    expect(player.activeQuestId).toBeNull();
  });

  it('does nothing while a main-chain (or any other) quest is already active', () => {
    const player = freshPlayer();
    player.completedQuestIds.push('q6_dragon');
    player.activeQuestId = 'amara_r1_evasion';
    expect(offerSideQuest(player, 'baltazar_relicario')).toBeNull();
    expect(player.activeQuestId).toBe('amara_r1_evasion');
  });

  it('does nothing for an NPC that is not a side quest giver', () => {
    const player = freshPlayer();
    player.completedQuestIds.push('q6_dragon');
    expect(offerSideQuest(player, 'tobias')).toBeNull();
    expect(player.activeQuestId).toBeNull();
  });

  it('starts a lost NPC\'s own chain once its prerequisite is met and no quest is active', () => {
    const player = freshPlayer();
    player.completedQuestIds.push('q6_dragon');

    const message = offerSideQuest(player, 'baltazar_relicario');

    expect(message).not.toBeNull();
    expect(player.activeQuestId).toBe('relicario_r1_guardioes');
  });

  it('never restarts a side quest chain once its first quest is already completed', () => {
    const player = freshPlayer();
    player.completedQuestIds.push('q6_dragon', 'relicario_r1_guardioes');
    expect(offerSideQuest(player, 'baltazar_relicario')).toBeNull();
    expect(player.activeQuestId).toBeNull();
  });

  it('walks a two-quest lost-NPC chain end to end using the same generic nextQuestId/notifyTalkedTo/notifyEnemyDefeated machinery as the main chain', () => {
    const player = freshPlayer();
    player.completedQuestIds.push('q6_dragon');

    expect(offerSideQuest(player, 'baltazar_relicario')).not.toBeNull();
    expect(player.activeQuestId).toBe('relicario_r1_guardioes');

    for (let i = 0; i < 3; i++) {
      expect(notifyEnemyDefeated(player, 'skeleton')).not.toBeNull();
    }
    expect(notifyEnemyDefeated(player, 'skeleton')).not.toBeNull();
    expect(player.activeQuestId).toBe('relicario_r2_heranca');

    const finalMessage = notifyTalkedTo(player, 'baltazar_relicario');
    expect(finalMessage).not.toBeNull();
    expect(player.activeQuestId).toBeNull();
    expect(player.completedQuestIds).toEqual(expect.arrayContaining(['relicario_r1_guardioes', 'relicario_r2_heranca']));
  });

  it('walks a single-quest bounty end to end', () => {
    const player = freshPlayer();
    player.completedQuestIds.push('q6_dragon');

    expect(offerSideQuest(player, 'bram')).not.toBeNull();
    expect(player.activeQuestId).toBe('contrato_troll_lagoa');

    const message = notifyEnemyDefeated(player, 'troll');

    expect(message).not.toBeNull();
    expect(player.activeQuestId).toBeNull();
    expect(player.completedQuestIds).toContain('contrato_troll_lagoa');
  });

  it('offers each side quest giver in turn once every earlier one is already completed', () => {
    const player = freshPlayer();
    player.completedQuestIds.push(
      'q6_dragon',
      'relicario_r1_guardioes',
      'relicario_r2_heranca',
      'eremita_r1_cercado',
      'eremita_r2_partida',
      'nair_r1_ultimos_de_coivara',
      'contrato_troll_lagoa',
    );

    const message = offerSideQuest(player, 'cacador_ren');

    expect(message).not.toBeNull();
    expect(player.activeQuestId).toBe('contrato_cinzas_elemental');
  });

  it('closes the paladin gap: offers and completes Gareth\'s memorial chain', () => {
    const player = freshPlayer('paladin');
    player.completedQuestIds.push('q6_dragon');

    expect(offerSideQuest(player, 'gareth_escudo')).not.toBeNull();
    expect(player.activeQuestId).toBe('gareth_r1_memorial');

    for (let i = 0; i < 4; i++) {
      expect(notifyEnemyDefeated(player, 'skeleton')).not.toBeNull();
    }
    const message = notifyEnemyDefeated(player, 'skeleton');

    expect(message).not.toBeNull();
    expect(player.activeQuestId).toBeNull();
    expect(player.completedQuestIds).toContain('gareth_r1_memorial');
  });

  it('offers and completes a breadth-wave chain from the new "Praça do Mercado" NPCs', () => {
    const player = freshPlayer();
    player.completedQuestIds.push('q6_dragon');

    expect(offerSideQuest(player, 'nilza_mercado')).not.toBeNull();
    expect(player.activeQuestId).toBe('nilza_r1_barracas');

    for (let i = 0; i < 4; i++) {
      expect(notifyEnemyDefeated(player, 'bandit')).not.toBeNull();
    }
    const message = notifyEnemyDefeated(player, 'bandit');

    expect(message).not.toBeNull();
    expect(player.activeQuestId).toBeNull();
    expect(player.completedQuestIds).toContain('nilza_r1_barracas');
  });

  it.each(SIDE_QUEST_STARTERS.map((s) => s.questId))(
    'quest %s (every side quest, old and new) resolves to a real giver NPC and reward template',
    (questId) => {
      const quest = getQuestById(questId)!;
      expect(quest).toBeDefined();
      expect(() => getNpcById(quest.giverNpcId)).not.toThrow();
      if (quest.rewardItem) {
        expect(() => getEquipmentTemplate(quest.rewardItem!.templateId)).not.toThrow();
      }
    },
  );
});
