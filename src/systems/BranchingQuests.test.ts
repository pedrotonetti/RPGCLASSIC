import { describe, expect, it } from 'vitest';
import { BRANCHING_QUESTS, BRANCHING_QUEST_STARTERS, VAU_FACTION_ID } from '../data/branchingQuests';
import { getEquipmentTemplate } from '../data/equipment';
import { getEnemyById } from '../data/enemies';
import { dialogueLinesFor, getNpcById, NPC_DEFINITIONS } from '../data/npcs';
import { getQuestById, SIDE_QUEST_STARTERS, type QuestDefinition } from '../data/quests';
import { effectiveMonsterCount, getZoneById, MAIN_CITY_ID } from '../data/zones';
import { Player } from '../entities/Player';
import type { ChoiceEffect, QuestChoice } from './ChoiceSystem';
import { notifyEnemyDefeated, notifyTalkedTo, offerSideQuest, pendingQuestChoice, questTrackerText, resolveQuestChoice } from './QuestSystem';
import { getFactionReputation, getZoneState, hasFlag } from './WorldStateSystem';

function freshPlayer(): Player {
  return Player.createNew('Testador', 'warrior');
}

const DECISION_QUESTS = BRANCHING_QUESTS.filter((q) => q.choices);
const ALL_CHOICES: Array<{ quest: QuestDefinition; choice: QuestChoice }> = DECISION_QUESTS.flatMap((quest) => quest.choices!.map((choice) => ({ quest, choice })));

/** Plays the quest chain up to (but not including) the decision, the way a real save would reach it. */
function reachDecision(giverNpcId: string, firstQuestId: string, prerequisites: string[], defeatId: string, kills: number): Player {
  const player = freshPlayer();
  player.completedQuestIds.push(...prerequisites);
  expect(offerSideQuest(player, giverNpcId)).toBe(`Nova missão: ${getQuestById(firstQuestId)!.title}`);
  for (let i = 0; i < kills; i++) notifyEnemyDefeated(player, defeatId);
  return player;
}

const reachDoroteia = () => reachDecision('doroteia_comboio', 'doroteia_r1_saqueadores', ['q6_dragon'], 'bandit', 4);
const reachJoaquim = () => reachDecision('zefa_lavadeira', 'vau_r3_ossos_do_leito', ['q1_awaken', 'vau_r1_teias', 'vau_r2_benzedura'], 'skeleton', 5);

function hasGain(effect: ChoiceEffect): boolean {
  const w = effect.worldStateDelta ?? {};
  const factions = [...(effect.factionDeltas ?? []), ...(effect.factionDelta ? [effect.factionDelta] : [])];
  return (
    (effect.grantGold ?? 0) > 0 ||
    !!effect.grantItem ||
    (w.hope ?? 0) > 0 ||
    (w.trust ?? 0) > 0 ||
    (w.corruption ?? 0) < 0 ||
    (w.natureBalance ?? 0) > 0 ||
    factions.some((f) => f.amount > 0)
  );
}

function hasCost(effect: ChoiceEffect): boolean {
  const w = effect.worldStateDelta ?? {};
  const factions = [...(effect.factionDeltas ?? []), ...(effect.factionDelta ? [effect.factionDelta] : [])];
  return (
    (effect.grantGold ?? 0) < 0 ||
    (w.hope ?? 0) < 0 ||
    (w.trust ?? 0) < 0 ||
    (w.corruption ?? 0) > 0 ||
    (w.natureBalance ?? 0) < 0 ||
    factions.some((f) => f.amount < 0)
  );
}

describe('branching quest data', () => {
  it('defines two decision quests, each offering exactly three distinct options', () => {
    expect(DECISION_QUESTS).toHaveLength(2);
    for (const quest of DECISION_QUESTS) {
      expect(quest.choices).toHaveLength(3);
      expect(new Set(quest.choices!.map((c) => c.id)).size).toBe(3);
      for (const c of quest.choices!) {
        expect(c.label.trim().length).toBeGreaterThan(5);
        expect(c.summary.trim().length).toBeGreaterThan(20);
        expect(Object.keys(c.effect).length).toBeGreaterThan(0);
      }
    }
  });

  it('resolves through the ordinary quest lookups, with every NPC/enemy/item they reference defined', () => {
    for (const quest of BRANCHING_QUESTS) {
      expect(getQuestById(quest.id)).toBe(quest);
      expect(() => getNpcById(quest.giverNpcId)).not.toThrow();
      if (quest.objective.targetId) {
        if (quest.objective.kind === 'talkTo') expect(() => getNpcById(quest.objective.targetId!)).not.toThrow();
        else expect(() => getEnemyById(quest.objective.targetId!)).not.toThrow();
      }
      if (quest.nextQuestId) expect(getQuestById(quest.nextQuestId)).toBeDefined();
    }
    for (const { choice } of ALL_CHOICES) {
      if (choice.effect.grantItem) expect(() => getEquipmentTemplate(choice.effect.grantItem!.templateId)).not.toThrow();
    }
  });

  it('chains each decision behind a defeat leg, and registers its first leg as a side-quest starter', () => {
    for (const quest of DECISION_QUESTS) {
      const previous = BRANCHING_QUESTS.find((q) => q.nextQuestId === quest.id);
      expect(previous?.objective.kind).toBe('defeat');
      expect(quest.objective.kind).toBe('talkTo');
      expect(() => getNpcById(quest.objective.targetId!)).not.toThrow();
    }
    for (const starter of BRANCHING_QUEST_STARTERS) {
      expect(SIDE_QUEST_STARTERS).toContainEqual(starter);
      expect(getQuestById(starter.questId)).toBeDefined();
      expect(getQuestById(starter.prerequisiteQuestId)).toBeDefined();
    }
  });

  it('makes every option a real trade-off: something gained AND something paid, and no two options alike', () => {
    for (const { quest, choice } of ALL_CHOICES) {
      expect(hasGain(choice.effect), `${quest.id}/${choice.id} gains something`).toBe(true);
      expect(hasCost(choice.effect) || !!choice.effect.zoneState, `${quest.id}/${choice.id} costs something`).toBe(true);
    }
    for (const quest of DECISION_QUESTS) {
      const serialized = quest.choices!.map((c) => JSON.stringify(c.effect));
      expect(new Set(serialized).size).toBe(serialized.length);
    }
  });

  it('gives every option its own flag, and each decision spans WorldState, reputation and an item/gold payoff somewhere', () => {
    const flags = ALL_CHOICES.map(({ choice }) => choice.effect.setFlag);
    expect(flags.every(Boolean)).toBe(true);
    expect(new Set(flags).size).toBe(flags.length);
    for (const quest of DECISION_QUESTS) {
      const effects = quest.choices!.map((c) => c.effect);
      expect(effects.some((e) => e.worldStateDelta)).toBe(true);
      expect(effects.some((e) => e.factionDelta || e.factionDeltas)).toBe(true);
      expect(effects.some((e) => e.grantGold || e.grantItem)).toBe(true);
    }
  });
});

describe('Doroteia — "O Preço do Pão" is reachable end to end', () => {
  it('is offered by Doroteia once q6_dragon is behind the player, then hands over to the decision leg', () => {
    const player = reachDoroteia();
    expect(player.sideQuestId).toBe('doroteia_r2_despensa');
    expect(player.completedQuestIds).toContain('doroteia_r1_saqueadores');
    expect(questTrackerText(player)).toContain('Doroteia');
  });

  it('is not offered before its prerequisite, nor by anyone but Doroteia', () => {
    const early = freshPlayer();
    expect(offerSideQuest(early, 'doroteia_comboio')).toBeNull();
    const ready = freshPlayer();
    ready.completedQuestIds.push('q6_dragon');
    expect(offerSideQuest(ready, 'mira')).toBeNull();
  });

  it('does not complete by simply talking: the choice stays pending until picked', () => {
    const player = reachDoroteia();
    expect(notifyTalkedTo(player, 'doroteia_comboio')).toBeNull();
    expect(player.sideQuestId).toBe('doroteia_r2_despensa');
    expect(pendingQuestChoice(player, 'doroteia_comboio')?.id).toBe('doroteia_r2_despensa');
    expect(pendingQuestChoice(player, 'bram')).toBeNull();
  });

  it('"dividir" trades gold for trust, hope and Pedravale\'s goodwill', () => {
    const player = reachDoroteia();
    const goldBefore = player.gold;
    const corruptionBefore = player.worldState.corruption;
    const msg = resolveQuestChoice(player, 'doroteia_r2_despensa', 'dividir');
    expect(msg).toContain('Missão concluída: O Preço do Pão');
    expect(player.completedQuestIds).toContain('doroteia_r2_despensa');
    expect(player.sideQuestId).toBeNull();
    expect(hasFlag(player.worldState, 'comboio_acolhido')).toBe(true);
    expect(hasFlag(player.worldState, 'doroteia_r2_despensa.dividir')).toBe(true);
    expect(player.worldState.trust).toBe(58);
    expect(player.worldState.hope).toBe(54);
    expect(player.worldState.corruption).toBe(corruptionBefore - 3);
    expect(getFactionReputation(player.worldState, 'pedravale')).toBe(10);
    // +40 quest gold, -60 paid for the shared stores.
    expect(player.gold).toBe(goldBefore + 40 - 60);
    expect(getZoneState(player.worldState, MAIN_CITY_ID)).toBeNull();
  });

  it('"raiz_proibida" trades corruption and fear for a legendary relic', () => {
    const player = reachDoroteia();
    const bagBefore = player.bag.length;
    resolveQuestChoice(player, 'doroteia_r2_despensa', 'raiz_proibida');
    expect(hasFlag(player.worldState, 'raiz_proibida_usada')).toBe(true);
    expect(player.worldState.corruption).toBe(59);
    expect(player.worldState.natureBalance).toBe(43);
    expect(player.worldState.trust).toBe(46);
    expect(getFactionReputation(player.worldState, 'pedravale')).toBe(-6);
    expect(player.bag.length).toBe(bagBefore + 1);
    expect(player.bag[player.bag.length - 1].rarity).toBe('vermelho');
  });

  it('"vender_suprimentos" pays out gold but sours trust and makes Pedravale\'s field more crowded', () => {
    const player = reachDoroteia();
    const goldBefore = player.gold;
    resolveQuestChoice(player, 'doroteia_r2_despensa', 'vender_suprimentos');
    expect(hasFlag(player.worldState, 'comboio_abandonado')).toBe(true);
    expect(player.gold).toBe(goldBefore + 40 + 120);
    expect(player.worldState.trust).toBe(44);
    expect(player.worldState.hope).toBe(46);
    expect(getFactionReputation(player.worldState, 'pedravale')).toBe(-8);

    const state = getZoneState(player.worldState, MAIN_CITY_ID);
    expect(state).toBe('faminto');
    const city = getZoneById(MAIN_CITY_ID);
    expect(effectiveMonsterCount(city, state)).toBeGreaterThan(effectiveMonsterCount(city, null));
    expect(effectiveMonsterCount(city, null)).toBe(city.monsterCount);
  });

  it('refuses an unknown option or a quest that is not active, changing nothing', () => {
    const player = reachDoroteia();
    const before = JSON.stringify(player.toSaveData());
    expect(resolveQuestChoice(player, 'doroteia_r2_despensa', 'nao_existe')).toBeNull();
    expect(resolveQuestChoice(player, 'vau_r4_pedagio', 'reservar')).toBeNull();
    expect(resolveQuestChoice(player, 'doroteia_r1_saqueadores', 'dividir')).toBeNull();
    expect(JSON.stringify(player.toSaveData())).toBe(before);
    expect(resolveQuestChoice(player, 'doroteia_r2_despensa', 'dividir')).not.toBeNull();
    expect(resolveQuestChoice(player, 'doroteia_r2_despensa', 'dividir')).toBeNull();
  });

  it('never takes a player below zero gold when the "dividir" cost exceeds their purse', () => {
    const player = reachDoroteia();
    player.gold = 5;
    resolveQuestChoice(player, 'doroteia_r2_despensa', 'dividir');
    expect(player.gold).toBe(0);
  });
});

describe('Zefa and Joaquim — "Quem Bebe Primeiro" is reachable end to end', () => {
  it('opens after the existing Vau chain: Zefa sends the player after the bones, then to Joaquim for the decision', () => {
    const player = reachJoaquim();
    expect(player.sideQuestId).toBe('vau_r4_pedagio');
    expect(questTrackerText(player)).toContain('Joaquim');
    expect(pendingQuestChoice(player, 'joaquim_vau')?.id).toBe('vau_r4_pedagio');
    expect(pendingQuestChoice(player, 'zefa_lavadeira')).toBeNull();
    expect(notifyTalkedTo(player, 'joaquim_vau')).toBeNull();
    expect(player.sideQuestId).toBe('vau_r4_pedagio');
  });

  it('is not offered before the Vau\'s own chain is finished, and Joaquim\'s own offers are untouched', () => {
    const mid = freshPlayer();
    mid.completedQuestIds.push('q1_awaken', 'vau_r1_teias');
    expect(offerSideQuest(mid, 'zefa_lavadeira')).toBeNull();
    const fresh = freshPlayer();
    fresh.completedQuestIds.push('q1_awaken');
    expect(offerSideQuest(fresh, 'joaquim_vau')).toBe('Nova missão: Teias no Leito Seco');
  });

  it('"reservar" lifts the Vau and hope at Pedravale\'s expense, with no money', () => {
    const player = reachJoaquim();
    const goldBefore = player.gold;
    resolveQuestChoice(player, 'vau_r4_pedagio', 'reservar');
    expect(hasFlag(player.worldState, 'vau_reservado')).toBe(true);
    expect(getFactionReputation(player.worldState, VAU_FACTION_ID)).toBe(12);
    expect(getFactionReputation(player.worldState, 'pedravale')).toBe(-6);
    expect(player.worldState.hope).toBe(55);
    expect(player.worldState.natureBalance).toBe(54);
    expect(player.gold).toBe(goldBefore + 60);
  });

  it('"canal" swaps the Vau\'s loyalty for Pedravale\'s coin and a rare ring', () => {
    const player = reachJoaquim();
    const goldBefore = player.gold;
    const bagBefore = player.bag.length;
    resolveQuestChoice(player, 'vau_r4_pedagio', 'canal');
    expect(hasFlag(player.worldState, 'vau_canalizado')).toBe(true);
    expect(getFactionReputation(player.worldState, 'pedravale')).toBe(10);
    expect(getFactionReputation(player.worldState, VAU_FACTION_ID)).toBe(-10);
    expect(player.worldState.natureBalance).toBe(44);
    expect(player.gold).toBe(goldBefore + 60 + 90);
    expect(player.bag.length).toBe(bagBefore + 1);
    expect(player.bag[player.bag.length - 1].templateId).toBe('anel_sorte');
  });

  it('"pedagio" pays the most but costs trust, hope and both factions', () => {
    const player = reachJoaquim();
    const goldBefore = player.gold;
    resolveQuestChoice(player, 'vau_r4_pedagio', 'pedagio');
    expect(hasFlag(player.worldState, 'vau_pedagio_da_agua')).toBe(true);
    expect(player.gold).toBe(goldBefore + 60 + 160);
    expect(player.worldState.trust).toBe(45);
    expect(player.worldState.hope).toBe(46);
    expect(player.worldState.corruption).toBe(53);
    expect(getFactionReputation(player.worldState, VAU_FACTION_ID)).toBe(-6);
    expect(getFactionReputation(player.worldState, 'pedravale')).toBe(-4);
  });
});

describe('flags rewrite later dialogue', () => {
  const DOROTEIA_FLAGS = ['comboio_acolhido', 'raiz_proibida_usada', 'comboio_abandonado'];
  const JOAQUIM_FLAGS = ['vau_reservado', 'vau_canalizado', 'vau_pedagio_da_agua'];

  function linesWith(npcId: string, completed: string[], flags: string[], active: Array<string | null> = [null, null]): string[] {
    return dialogueLinesFor(getNpcById(npcId), active, completed, {}, Object.fromEntries(flags.map((f) => [f, true])));
  }

  it('Doroteia says something different for each way the decision went, and something else again with no decision', () => {
    const doroteia = getNpcById('doroteia_comboio');
    const baseline = linesWith('doroteia_comboio', ['q6_dragon'], []);
    expect(baseline).toBe(doroteia.dialogue);
    const variants = DOROTEIA_FLAGS.map((flag) => linesWith('doroteia_comboio', ['q6_dragon', 'doroteia_r2_despensa'], [flag]));
    expect(new Set(variants.map((v) => v.join('|'))).size).toBe(3);
    for (const v of variants) expect(v).not.toBe(baseline);
  });

  it('Zeladora Sable remembers the forbidden root, and only that', () => {
    const sable = getNpcById('zeladora_sable');
    expect(linesWith('zeladora_sable', [], [])).toBe(sable.dialogue);
    expect(linesWith('zeladora_sable', [], ['comboio_abandonado'])).toBe(sable.dialogue);
    const remembers = linesWith('zeladora_sable', [], ['raiz_proibida_usada']);
    expect(remembers).not.toBe(sable.dialogue);
    expect(remembers.join(' ')).toContain('ipezal');
  });

  it('Joaquim holds the decision briefing while it is pending', () => {
    const lines = linesWith('joaquim_vau', ['q1_awaken', 'vau_r1_teias', 'vau_r2_benzedura', 'vau_r3_ossos_do_leito'], [], ['vau_r4_pedagio', null]);
    expect(lines.join(' ')).toContain('de quem era a água');
  });

  it('Joaquim and Quitéria answer each water decision, overriding their "chain completed" line', () => {
    for (const npcId of ['joaquim_vau', 'quiteria_benzedeira']) {
      const completed = ['q1_awaken', 'vau_r1_teias', 'vau_r2_benzedura', 'vau_r3_ossos_do_leito', 'vau_r4_pedagio'];
      const plain = linesWith(npcId, completed, []);
      const variants = JOAQUIM_FLAGS.map((flag) => linesWith(npcId, completed, [flag]));
      expect(new Set(variants.map((v) => v.join('|'))).size, npcId).toBe(3);
      for (const v of variants) expect(v, npcId).not.toEqual(plain);
    }
  });

  it('an active quest briefing still outranks a flag line (the NPC is mid-errand)', () => {
    const lines = linesWith('doroteia_comboio', ['q6_dragon', 'doroteia_r1_saqueadores'], ['comboio_acolhido'], ['doroteia_r2_despensa', null]);
    expect(lines.join(' ')).toContain('Alguém vai ficar com fome');
  });

  it('every flag an NPC listens for is actually set by some option', () => {
    const settable = new Set(ALL_CHOICES.map(({ choice }) => choice.effect.setFlag));
    for (const npc of NPC_DEFINITIONS) {
      for (const entry of npc.flagDialogue ?? []) expect(settable.has(entry.flag), `${npc.id}: ${entry.flag}`).toBe(true);
    }
  });
});
