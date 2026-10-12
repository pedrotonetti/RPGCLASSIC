import { describe, expect, it } from 'vitest';
import { isWalkable, TileType } from '../config/tiles';
import { Player } from '../entities/Player';
import { buildEnemyModel } from '../render/characterModel';
import { notifyEnemyDefeated, notifyTalkedTo, offerSideQuest, questTrackerText } from '../systems/QuestSystem';
import { sideQuestsCompleted } from '../systems/MountSystem';
import { ACHIEVEMENT_DEFINITIONS } from './achievements';
import { CLASS_ZONE_THEMES } from './classZones';
import { BESPOKE_ENEMY_MODEL_IDS, ENEMY_DEFINITIONS, getEnemyById } from './enemies';
import { getEquipmentTemplate } from './equipment';
import { getItemById, ITEM_DEFINITIONS } from './items';
import { getMaterialById } from './materials';
import { getNpcById, NPC_DEFINITIONS, rocaApprenticeNpcId } from './npcs';
import {
  CLASS_PRELUDE_QUESTS,
  EXPANSION_QUESTS,
  getQuestById,
  QUEST_CHAIN,
  SIDE_QUEST_STARTERS,
  SIDE_QUESTS,
  type QuestDefinition,
} from './quests';
import { RECIPES } from './recipes';
import { WORLD_EVENT_DEFINITIONS } from './worldEvents';
import { MAIN_CITY_ID, ZONE_DEFINITIONS } from './zones';

/** Every enemy id some open-world zone explicitly fields (Pedravale has no list: it draws every regular enemy, weighted by level). */
function explicitPoolIds(): Set<string> {
  const ids = new Set<string>();
  for (const zone of Object.values(ZONE_DEFINITIONS)) for (const id of zone.monsterIds ?? []) ids.add(id);
  return ids;
}

/** The first quest of the chain `questId` belongs to (walking `nextQuestId` links backwards). */
function chainHead(questId: string, pool: QuestDefinition[]): string {
  let current = questId;
  for (let guard = 0; guard < 50; guard++) {
    const previous = pool.find((q) => q.nextQuestId === current);
    if (!previous) return current;
    current = previous.id;
  }
  throw new Error(`nextQuestId cycle around ${questId}`);
}

const ALL_SIDE = SIDE_QUESTS;
const PRE_DRAGON_MAIN_IDS = new Set([...CLASS_PRELUDE_QUESTS.map((q) => q.id), ...QUEST_CHAIN.filter((q) => q.id !== 'q6_dragon').map((q) => q.id)]);

/** True when a side quest can be reached without ever completing q6_dragon: its chain's starter is gated on a pre-dragon main beat, or on another side chain that itself is. */
function reachableBeforeDragon(questId: string, depth = 0): boolean {
  if (depth > 10) return false;
  const head = chainHead(questId, ALL_SIDE);
  const starter = SIDE_QUEST_STARTERS.find((s) => s.questId === head);
  if (!starter) return false;
  if (PRE_DRAGON_MAIN_IDS.has(starter.prerequisiteQuestId)) return true;
  if (ALL_SIDE.some((q) => q.id === starter.prerequisiteQuestId)) return reachableBeforeDragon(starter.prerequisiteQuestId, depth + 1);
  return false;
}

const NEW_ENEMY_IDS = ENEMY_DEFINITIONS.filter((e) => !BESPOKE_ENEMY_MODEL_IDS.includes(e.id)).map((e) => e.id);

describe('expansion side quests: data integrity', () => {
  it('adds at least 12 distinct side quests, all with unique ids, all registered as side quests', () => {
    // The roça bounty is one quest per class — count it once for "distinct", all eight for ids.
    const distinct = new Set(EXPANSION_QUESTS.map((q) => (q.id.endsWith('_s1_formigueiro') ? 's1_formigueiro' : q.id)));
    expect(distinct.size).toBeGreaterThanOrEqual(12);
    const allIds = [...SIDE_QUESTS.map((q) => q.id)];
    expect(new Set(allIds).size).toBe(allIds.length);
    for (const q of EXPANSION_QUESTS) expect(SIDE_QUESTS, q.id).toContain(q);
  });

  it.each(EXPANSION_QUESTS.map((q) => q.id))('%s: giver, objective target, rewards and chain links all resolve', (questId) => {
    const quest = getQuestById(questId)!;
    expect(quest).toBeDefined();

    const giver = getNpcById(quest.giverNpcId);
    expect(ZONE_DEFINITIONS[giver.zoneId], `${questId} giver zone`).toBeDefined();
    expect(ZONE_DEFINITIONS[giver.zoneId].dungeonId, `${questId} giver must stand in the open world`).toBeUndefined();

    const obj = quest.objective;
    expect(obj.amount).toBeGreaterThan(0);
    if (obj.kind === 'talkTo') {
      const target = getNpcById(obj.targetId!);
      expect(ZONE_DEFINITIONS[target.zoneId]).toBeDefined();
    }
    if (obj.kind === 'defeat') {
      expect(obj.targetId, `${questId} should name its prey`).toBeDefined();
      const enemy = getEnemyById(obj.targetId!);
      expect(enemy.isBoss ?? false).toBe(false);
      // Must actually spawn somewhere it can be hunted: an explicit zone pool
      // (Pedravale's level-weighted field is a bonus, not relied on).
      expect(explicitPoolIds().has(obj.targetId!), `${questId}: ${obj.targetId} spawns in no zone pool`).toBe(true);
    }

    expect(quest.rewardXp).toBeGreaterThan(0);
    expect(quest.rewardGold).toBeGreaterThan(0);
    if (quest.rewardItem) {
      const template = getEquipmentTemplate(quest.rewardItem.templateId);
      if (template.fixedRarity) expect(quest.rewardItem.rarity, `${questId} unique reward rarity`).toBe(template.fixedRarity);
    }
    for (const stack of quest.onCompleteEffect?.grantItems ?? []) {
      expect(() => getItemById(stack.itemId)).not.toThrow();
      expect(stack.qty).toBeGreaterThan(0);
    }
    if (quest.onCompleteEffect?.grantItem) expect(() => getEquipmentTemplate(quest.onCompleteEffect!.grantItem!.templateId)).not.toThrow();
    if (quest.nextQuestId) expect(getQuestById(quest.nextQuestId), `${questId} next`).toBeDefined();

    // Reachable: the chain's first quest has a starter whose prerequisite is a real quest.
    const head = chainHead(questId, ALL_SIDE);
    const starter = SIDE_QUEST_STARTERS.find((s) => s.questId === head);
    expect(starter, `${questId}: chain head ${head} has no SIDE_QUEST_STARTERS entry`).toBeDefined();
    expect(getQuestById(starter!.prerequisiteQuestId), `${head} prerequisite`).toBeDefined();
    // The chain head is handed out by its own giver (offerSideQuest matches on giverNpcId).
    expect(getQuestById(head)!.giverNpcId).toBe(quest.giverNpcId);
  });

  it('every quest-dialogue/talkTo NPC referenced by the expansion has a briefing line while its quest is active', () => {
    for (const quest of EXPANSION_QUESTS) {
      const speaker = quest.objective.kind === 'talkTo' ? getNpcById(quest.objective.targetId!) : getNpcById(quest.giverNpcId);
      const briefed = (speaker.questDialogue ?? []).some((d) => d.questId === quest.id && (d.when ?? 'active') === 'active');
      expect(briefed, `${speaker.id} has no active-quest line for ${quest.id}`).toBe(true);
    }
  });

  it('opens at least 6 new side quests BEFORE q6_dragon, so early levels (and the first mounts) have real side content', () => {
    const early = EXPANSION_QUESTS.filter((q) => reachableBeforeDragon(q.id));
    // Per character: the class's own roça bounty counts once.
    const perCharacter = early.filter((q) => !q.id.endsWith('_s1_formigueiro') || q.id.startsWith('warrior_'));
    expect(perCharacter.length).toBeGreaterThanOrEqual(6);
    // Every class has its own level-1 side quest.
    for (const theme of CLASS_ZONE_THEMES) expect(reachableBeforeDragon(`${theme.classId}_s1_formigueiro`), theme.classId).toBe(true);
  });

  it('spreads across several zones and the 1-20 level band', () => {
    const giverZones = new Set(EXPANSION_QUESTS.map((q) => getNpcById(q.giverNpcId).zoneId));
    expect(giverZones.has(MAIN_CITY_ID)).toBe(true);
    expect(giverZones.size).toBeGreaterThanOrEqual(6);
    const preyLevels = EXPANSION_QUESTS.filter((q) => q.objective.kind === 'defeat').map((q) => getEnemyById(q.objective.targetId!).level);
    expect(Math.min(...preyLevels)).toBeLessThanOrEqual(2);
    expect(Math.max(...preyLevels)).toBeGreaterThanOrEqual(12);
  });
});

describe('expansion enemies', () => {
  it('adds at least 8 new regular enemies, each with a supported model, sane stats and a home zone', () => {
    expect(NEW_ENEMY_IDS.length).toBeGreaterThanOrEqual(8);
    const pools = explicitPoolIds();
    for (const id of NEW_ENEMY_IDS) {
      const e = getEnemyById(id);
      expect(e.isBoss ?? false, id).toBe(false);
      expect(e.modelId, `${id} needs a modelId`).toBeDefined();
      expect(BESPOKE_ENEMY_MODEL_IDS, `${id} modelId`).toContain(e.modelId);
      expect(e.modelScale ?? 1).toBeGreaterThan(0);
      expect(e.level).toBeGreaterThanOrEqual(1);
      expect(e.stats.maxHp).toBeGreaterThan(0);
      expect(e.xpReward).toBeGreaterThan(0);
      expect(e.archetype, id).toBeDefined();
      expect(['summoner', 'mimic'], `${id} uses a reserved archetype`).not.toContain(e.archetype);
      for (const skill of e.skills) if (skill.inflicts) expect(skill.inflicts.type, `${id} must not inflict stun directly`).not.toBe('stun');
      expect(pools.has(id), `${id} spawns in no zone`).toBe(true);
    }
  });

  it('renders each new enemy with its borrowed silhouette (not the slime fallback), resized by modelScale', () => {
    const countNodes = (g: { traverse: (cb: () => void) => void }) => {
      let n = 0;
      g.traverse(() => n++);
      return n;
    };
    for (const id of NEW_ENEMY_IDS) {
      const e = getEnemyById(id);
      const model = buildEnemyModel(id, e.color);
      const reference = buildEnemyModel(e.modelId!, e.color);
      // The wrapper adds exactly one outer group around the borrowed builder's own tree.
      expect(countNodes(model), id).toBe(countNodes(reference) + 1);
      expect(model.children[0].scale.x, id).toBeCloseTo(e.modelScale ?? 1);
    }
  });

  it('only the original enemies have bespoke builders, and no enemy borrows a model from a borrowed one', () => {
    for (const e of ENEMY_DEFINITIONS) {
      if (e.modelId) expect(getEnemyById(e.modelId).modelId, `${e.id} -> ${e.modelId}`).toBeUndefined();
    }
  });

  it('every zone pool names real, non-boss enemies', () => {
    for (const zone of Object.values(ZONE_DEFINITIONS)) {
      for (const id of zone.monsterIds ?? []) {
        expect(() => getEnemyById(id), `${zone.id}: ${id}`).not.toThrow();
        expect(getEnemyById(id).isBoss ?? false, `${zone.id}: ${id}`).toBe(false);
      }
    }
  });

  it('keeps each zone pool near its level band: start villages stay at tier 2 or below, the hub fields the new top tiers', () => {
    for (const theme of CLASS_ZONE_THEMES) {
      for (const id of theme.startMonsters) expect(getEnemyById(id).level, `${theme.startVillageId}: ${id}`).toBeLessThanOrEqual(2);
      for (const id of theme.secondaryMonsters) expect(getEnemyById(id).level, `${theme.secondaryVillageId}: ${id}`).toBeLessThanOrEqual(8);
    }
    const hub = ZONE_DEFINITIONS.baluarte_amanhecer.monsterIds!;
    expect(hub).toContain('raiz_sem_patria');
    expect(hub).toContain('colosso_sal');
  });
});

describe('expansion items, recipes and vendors', () => {
  it('has unique consumable ids, positive prices and something to restore', () => {
    expect(new Set(ITEM_DEFINITIONS.map((i) => i.id)).size).toBe(ITEM_DEFINITIONS.length);
    for (const item of ITEM_DEFINITIONS) {
      expect(item.price).toBeGreaterThan(0);
      expect(item.healHp + item.healMp, item.id).toBeGreaterThan(0);
    }
    expect(() => getItemById('racao_montaria')).not.toThrow();
  });

  it('every recipe consumes real materials and produces a real item/template', () => {
    expect(new Set(RECIPES.map((r) => r.id)).size).toBe(RECIPES.length);
    for (const r of RECIPES) {
      expect(r.materials.length, r.id).toBeGreaterThan(0);
      for (const m of r.materials) {
        expect(() => getMaterialById(m.materialId), `${r.id}: ${m.materialId}`).not.toThrow();
        expect(m.qty).toBeGreaterThan(0);
      }
      const out = r.output;
      if (out.kind === 'item') expect(() => getItemById(out.itemId), r.id).not.toThrow();
      else expect(() => getEquipmentTemplate(out.templateId), r.id).not.toThrow();
      // Some vendor in the world runs this recipe's bench.
      expect(NPC_DEFINITIONS.some((n) => n.vendor?.kind === r.station && !n.vendor.noCrafting), `${r.id} station ${r.station}`).toBe(true);
    }
  });

  it('every vendor stocks only things that exist', () => {
    for (const npc of NPC_DEFINITIONS.filter((n) => n.vendor)) {
      for (const id of npc.vendor!.itemIds ?? []) expect(() => getItemById(id), `${npc.id}: ${id}`).not.toThrow();
      for (const id of npc.vendor!.equipmentTemplateIds ?? []) expect(() => getEquipmentTemplate(id), `${npc.id}: ${id}`).not.toThrow();
      expect(() => getMaterialById(npc.vendor!.craftMaterialId)).not.toThrow();
    }
  });
});

describe('expansion world events and achievements', () => {
  it('every event enemy list and item reward resolves', () => {
    for (const def of WORLD_EVENT_DEFINITIONS) {
      for (const id of def.enemyIds ?? []) {
        expect(getEnemyById(id).isBoss ?? false, `${def.id}: ${id}`).toBe(false);
        expect(def.kind, `${def.id}: enemyIds only make sense on an invasion`).toBe('invasao');
      }
      for (const stack of [...(def.reward?.grantItems ?? []), ...(def.consequence?.grantItems ?? [])]) expect(() => getItemById(stack.itemId)).not.toThrow();
      if (def.interactPrompt) expect(def.resolution).toBe('interact');
      for (const zoneId of def.zoneIds ?? []) expect(ZONE_DEFINITIONS[zoneId], `${def.id}: ${zoneId}`).toBeDefined();
    }
  });

  it('every "events" achievement names an event that some world event or quest can actually mark', () => {
    const markable = new Set<string>();
    for (const def of WORLD_EVENT_DEFINITIONS) if (def.reward?.markEventId) markable.add(def.reward.markEventId);
    for (const q of SIDE_QUESTS) if (q.onCompleteEffect?.markEventId) markable.add(q.onCompleteEffect.markEventId);
    for (const a of ACHIEVEMENT_DEFINITIONS) {
      if (a.condition.kind !== 'events') continue;
      for (const id of a.condition.eventIds) if (WORLD_EVENT_DEFINITIONS.some((d) => d.id === id)) expect(markable.has(id), `${a.id}: ${id}`).toBe(true);
    }
  });
});

describe('expansion NPC placement in class villages', () => {
  const classVillageIds = CLASS_ZONE_THEMES.flatMap((t) => [t.startVillageId, t.secondaryVillageId]);
  it.each(classVillageIds)('%s: every NPC stands on open ground, off every building/prop, reachable from the spawn and spread out', (zoneId) => {
    const map = ZONE_DEFINITIONS[zoneId].generate();
    const occupied = new Set<string>();
    for (const b of map.buildings) for (let dy = 0; dy < b.h; dy++) for (let dx = 0; dx < b.w; dx++) occupied.add(`${b.x + dx},${b.y + dy}`);
    const open = map.tiles.map((row, y) => row.map((t, x) => (occupied.has(`${x},${y}`) ? TileType.Tree : t)));
    const seen = new Set<string>();
    const stack = [map.playerStart];
    while (stack.length > 0) {
      const p = stack.pop()!;
      const key = `${p.x},${p.y}`;
      if (seen.has(key) || p.y < 0 || p.x < 0 || p.y >= open.length || p.x >= open[0].length || !isWalkable(open[p.y][p.x])) continue;
      seen.add(key);
      stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
    }
    const npcs = NPC_DEFINITIONS.filter((n) => n.zoneId === zoneId);
    // Only the NPCs this expansion placed are held to the reachability bar (the generated elder/mentor pair predates it).
    const newIds = new Set([...CLASS_ZONE_THEMES.map((t) => rocaApprenticeNpcId(t.classId)), 'rezadeira_socorro']);
    for (const npc of npcs.filter((n) => newIds.has(n.id))) {
      expect(isWalkable(map.tiles[npc.mapY][npc.mapX]), `${npc.id} tile`).toBe(true);
      expect(occupied.has(`${npc.mapX},${npc.mapY}`), `${npc.id} inside a building/prop`).toBe(false);
      expect(seen.has(`${npc.mapX},${npc.mapY}`), `${npc.id} unreachable`).toBe(true);
      expect(npc.mapX === map.playerStart.x && npc.mapY === map.playerStart.y, `${npc.id} on the spawn tile`).toBe(false);
      for (const other of npcs.filter((o) => o.id !== npc.id)) {
        expect(Math.hypot(other.mapX - npc.mapX, other.mapY - npc.mapY), `${npc.id} vs ${other.id}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe('expansion quests in play (QuestSystem)', () => {
  it('a brand-new character gets its roça bounty right after its first prelude beat, and it counts toward the mounts', () => {
    for (const theme of CLASS_ZONE_THEMES) {
      const player = Player.createNew('Testador', theme.classId);
      const giver = rocaApprenticeNpcId(theme.classId);
      expect(offerSideQuest(player, giver), 'not before the first beat').toBeNull();
      player.completedQuestIds.push(`${theme.classId}_q0_arrival`);
      expect(offerSideQuest(player, giver)).not.toBeNull();
      expect(player.sideQuestId).toBe(`${theme.classId}_s1_formigueiro`);
      // The HUD tracker names the prey by its display name, not its data id.
      expect(questTrackerText(player)).toContain('Saúva Ressequida');
      expect(questTrackerText(player)).not.toContain('sauva_ressequida');
      const before = sideQuestsCompleted(player);
      for (let i = 0; i < 5; i++) notifyEnemyDefeated(player, 'sauva_ressequida');
      expect(player.sideQuestId).toBeNull();
      expect(sideQuestsCompleted(player)).toBe(before + 1);
      expect(player.inventory.racao_montaria).toBe(2);
      expect(player.inventory.potion_hp ?? 0).toBeGreaterThanOrEqual(2);
    }
  });

  it('the Tropeiro chain runs from his capivara hunt to the talk with Mira, handing over ração and a set piece', () => {
    const player = Player.createNew('Testador', 'archer');
    player.completedQuestIds.push('q1_awaken');
    expect(offerSideQuest(player, 'tropeiro_amaro')).not.toBeNull();
    for (let i = 0; i < 5; i++) notifyEnemyDefeated(player, 'capivara_ressequida');
    expect(player.sideQuestId).toBe('tropeiro_r2_racao');
    const bagBefore = player.bag.length;
    expect(notifyTalkedTo(player, 'mira')).not.toBeNull();
    expect(player.sideQuestId).toBeNull();
    expect(player.inventory.racao_montaria).toBe(4);
    expect(player.bag.length).toBe(bagBefore + 1);
    expect(player.bag.at(-1)!.templateId).toBe('berrante_do_tropeiro');
  });

  it('Celeste\'s three contracts chain in order and wait for q3_new_blood', () => {
    const player = Player.createNew('Testador', 'mage');
    player.completedQuestIds.push('q2_first_steps');
    expect(offerSideQuest(player, 'recrutadora_celeste')).toBeNull();
    player.completedQuestIds.push('q3_new_blood');
    expect(offerSideQuest(player, 'recrutadora_celeste')).not.toBeNull();
    const chain: Array<[string, string, number]> = [
      ['contrato_espantalhos', 'espantalho_seca', 5],
      ['contrato_lobo_guara', 'lobo_guara_sombrio', 4],
      ['contrato_cipo', 'guardiao_cipo', 5],
    ];
    for (const [questId, enemyId, amount] of chain) {
      expect(player.sideQuestId).toBe(questId);
      for (let i = 0; i < amount; i++) notifyEnemyDefeated(player, enemyId);
    }
    expect(player.sideQuestId).toBeNull();
    expect(player.completedQuestIds).toEqual(expect.arrayContaining(chain.map(([id]) => id)));
  });

  it('Quitéria only opens her chain once the Vau\'s own benzedura is done', () => {
    const player = Player.createNew('Testador', 'cleric');
    player.completedQuestIds.push('q1_awaken', 'vau_r1_teias');
    expect(offerSideQuest(player, 'quiteria_benzedeira')).toBeNull();
    player.completedQuestIds.push('vau_r2_benzedura');
    expect(offerSideQuest(player, 'quiteria_benzedeira')).not.toBeNull();
    expect(player.sideQuestId).toBe('quiteria_r1_jacares');
  });
});
