import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_CATEGORY_ORDER,
  ACHIEVEMENT_DEFINITIONS,
  EXPLORATION_ZONE_IDS,
  getAchievementById,
  type AchievementDefinition,
} from '../data/achievements';
import { CHEST_DEFINITIONS } from '../data/chests';
import { createStarterItem } from '../data/equipment';
import { MATERIAL_DEFINITIONS } from '../data/materials';
import { NPC_DEFINITIONS } from '../data/npcs';
import { getQuestById, lastCallingQuestIdForClass } from '../data/quests';
import { ZONE_DEFINITIONS } from '../data/zones';
import { Player, type PlayerSaveData } from '../entities/Player';
import {
  achievementProgress,
  checkAchievements,
  consumePendingUnlock,
  createInitialAchievementState,
  describeReward,
  earnedTitles,
  getAchievementCounter,
  isUnlocked,
  normalizeAchievementState,
  observeAchievements,
  recordEnemyDefeated,
  recordEnemyEngaged,
  recordItemAcquired,
  recordItemCrafted,
  recordNpcTalkedTo,
  recordPlayerDefeated,
  recordZoneVisited,
} from './AchievementSystem';
import { codexCounts, findEnemyDefinition } from './CodexSystem';

function freshPlayer(classId = 'warrior'): Player {
  return Player.createNew('Testador', classId);
}

function ids(defs: AchievementDefinition[]): string[] {
  return defs.map((d) => d.id);
}

describe('achievement data', () => {
  it('has a focused catalog (18-26 entries) with unique ids and pt-BR text', () => {
    expect(ACHIEVEMENT_DEFINITIONS.length).toBeGreaterThanOrEqual(18);
    expect(ACHIEVEMENT_DEFINITIONS.length).toBeLessThanOrEqual(26);
    expect(new Set(ACHIEVEMENT_DEFINITIONS.map((a) => a.id)).size).toBe(ACHIEVEMENT_DEFINITIONS.length);
    for (const def of ACHIEVEMENT_DEFINITIONS) {
      expect(def.name.trim().length).toBeGreaterThan(0);
      expect(def.description.trim().length).toBeGreaterThan(0);
      expect(ACHIEVEMENT_CATEGORY_ORDER).toContain(def.category);
    }
  });

  it('only references things the game actually defines', () => {
    for (const def of ACHIEVEMENT_DEFINITIONS) {
      const c = def.condition;
      if (c.kind === 'bossDefeated') expect(findEnemyDefinition(c.enemyId)?.isBoss).toBe(true);
      if (c.kind === 'quest') expect(getQuestById(c.questId)).toBeDefined();
      if (c.kind === 'zones') for (const id of c.zoneIds) expect(ZONE_DEFINITIONS[id]).toBeDefined();
      if (c.kind === 'chests' && c.target !== 'all') expect(c.target).toBeLessThanOrEqual(CHEST_DEFINITIONS.length);
      if (c.kind === 'codex' && c.target !== 'all') {
        const player = freshPlayer();
        expect(c.target).toBeLessThanOrEqual(codexCounts(player.codex, c.section).total);
      }
    }
  });

  it('lets every playable class resolve its own calling quest line', () => {
    for (const classId of ['warrior', 'mage', 'archer', 'cleric', 'paladin', 'assassin', 'necromancer', 'monk']) {
      expect(getQuestById(lastCallingQuestIdForClass(classId))).toBeDefined();
    }
  });

  it('keeps spoilers hidden only for the three Ato 3 endings', () => {
    const hidden = ACHIEVEMENT_DEFINITIONS.filter((a) => a.hidden).map((a) => a.id);
    expect(hidden.sort()).toEqual(['final_abraco', 'final_corte', 'final_cura']);
  });

  it('asks for every explorable zone: Pedravale, 8 secondary villages, 2 settlements', () => {
    expect(EXPLORATION_ZONE_IDS.length).toBe(11);
    expect(new Set(EXPLORATION_ZONE_IDS).size).toBe(11);
  });
});

describe('achievement state and persistence', () => {
  it('defaults a fresh or pre-feature player to an empty state', () => {
    const player = freshPlayer();
    expect(player.achievements).toEqual(createInitialAchievementState());
    expect(normalizeAchievementState(undefined)).toEqual(createInitialAchievementState());
  });

  it('loads an old save with no achievements/codex fields without crashing', () => {
    const save = freshPlayer().toSaveData() as Partial<PlayerSaveData>;
    delete save.achievements;
    delete save.codex;
    const loaded = Player.fromSaveData(save as PlayerSaveData);
    expect(loaded.achievements).toEqual(createInitialAchievementState());
    expect(loaded.codex).toEqual({ enemies: {}, npcs: {}, materials: {}, equipment: {} });
    expect(() => checkAchievements(loaded)).not.toThrow();
  });

  it('round-trips unlocks, counters, flags, pending toasts and the Códex through the save data', () => {
    const player = freshPlayer();
    recordEnemyDefeated(player, 'slime');
    recordNpcTalkedTo(player, NPC_DEFINITIONS[0].id);
    recordZoneVisited(player, 'main_city');

    const json = JSON.parse(JSON.stringify(player.toSaveData())) as PlayerSaveData;
    const loaded = Player.fromSaveData(json);
    expect(loaded.achievements).toEqual(player.achievements);
    expect(loaded.codex).toEqual(player.codex);
    expect(isUnlocked(loaded.achievements, 'primeira_gota')).toBe(true);
    expect(loaded.achievements.pending).toContain('primeira_gota');
    expect(loaded.achievements.flags['zone:main_city']).toBe(true);
  });

  it('saves a copy, so later play does not mutate what was already serialized', () => {
    const player = freshPlayer();
    const save = player.toSaveData();
    recordEnemyDefeated(player, 'slime');
    expect(save.achievements.unlocked).toEqual([]);
    expect(save.codex.enemies).toEqual({});
  });
});

describe('kills and bosses', () => {
  it('unlocks the first kill once and pays its gold exactly once', () => {
    const player = freshPlayer();
    const goldBefore = player.gold;
    const unlocked = recordEnemyDefeated(player, 'slime');
    expect(ids(unlocked)).toEqual(['primeira_gota']);
    expect(player.gold).toBe(goldBefore + (getAchievementById('primeira_gota')!.reward!.gold ?? 0));

    const goldAfter = player.gold;
    expect(recordEnemyDefeated(player, 'slime')).toEqual([]);
    checkAchievements(player);
    expect(player.gold).toBe(goldAfter);
    expect(player.achievements.unlocked.filter((id) => id === 'primeira_gota')).toHaveLength(1);
  });

  it('unlocks the 100-kill achievement at exactly 100 and grants its gold and XP', () => {
    const player = freshPlayer();
    for (let i = 0; i < 99; i++) recordEnemyDefeated(player, 'slime');
    expect(isUnlocked(player.achievements, 'cem_raizes')).toBe(false);
    const goldBefore = player.gold;
    const xpTotalBefore = player.level * 1000 + player.xp;
    const unlocked = recordEnemyDefeated(player, 'slime');
    expect(ids(unlocked)).toContain('cem_raizes');
    expect(getAchievementCounter(player.achievements, 'kills')).toBe(100);
    expect(player.gold).toBe(goldBefore + 100);
    expect(player.level * 1000 + player.xp).toBeGreaterThan(xpTotalBefore);
  });

  it('reports kill progress for the progress bar', () => {
    const player = freshPlayer();
    for (let i = 0; i < 37; i++) recordEnemyDefeated(player, 'bat');
    expect(achievementProgress(getAchievementById('cem_raizes')!, player)).toEqual({ current: 37, target: 100 });
    expect(achievementProgress(getAchievementById('quinhentas_memorias')!, player)).toEqual({ current: 37, target: 500 });
  });

  it('counts a regular enemy toward kills but not toward boss achievements', () => {
    const player = freshPlayer();
    recordEnemyDefeated(player, 'goblin', { flawless: true });
    expect(getAchievementCounter(player.achievements, 'bossKills')).toBe(0);
    expect(player.achievements.flags.flawlessBoss).toBeUndefined();
    expect(isUnlocked(player.achievements, 'sem_um_arranhao')).toBe(false);
  });

  it('unlocks the story boss achievements for young_dragon', () => {
    const player = freshPlayer();
    const unlocked = ids(recordEnemyDefeated(player, 'young_dragon'));
    expect(unlocked).toEqual(expect.arrayContaining(['primeira_gota', 'primeiro_guardiao', 'guardiao_dragao']));
    expect(unlocked).not.toContain('sem_um_arranhao');
    expect(earnedTitles(player.achievements)).toContain('Algoz do Guardião');
  });

  it('only awards "sem um arranhão" when the boss fell without the player taking damage', () => {
    const hit = freshPlayer();
    recordEnemyDefeated(hit, 'young_dragon', { flawless: false });
    expect(isUnlocked(hit.achievements, 'sem_um_arranhao')).toBe(false);

    const flawless = freshPlayer();
    const unlocked = ids(recordEnemyDefeated(flawless, 'young_dragon', { flawless: true }));
    expect(unlocked).toContain('sem_um_arranhao');
  });

  it('treats a dungeon boss (a different data file) as a boss too', () => {
    const player = freshPlayer();
    recordEnemyDefeated(player, 'boss_root_ooze', { flawless: true });
    expect(getAchievementCounter(player.achievements, 'bossKills')).toBe(1);
    expect(isUnlocked(player.achievements, 'sem_um_arranhao')).toBe(true);
    expect(isUnlocked(player.achievements, 'guardiao_dragao')).toBe(false);
  });

  it('unlocks the Bestiário only once every regular enemy type has been defeated', () => {
    const player = freshPlayer();
    const regular = codexCounts(player.codex, 'enemies');
    const regularIds = ['slime', 'bat', 'goblin', 'bandit', 'dark_wolf', 'skeleton', 'giant_spider', 'orc', 'fire_elemental', 'troll', 'stone_golem'];
    expect(regularIds.length).toBe(regular.total);
    for (const id of regularIds.slice(0, -1)) recordEnemyDefeated(player, id);
    expect(isUnlocked(player.achievements, 'bestiario_de_ipera')).toBe(false);
    recordEnemyDefeated(player, regularIds[regularIds.length - 1]);
    expect(isUnlocked(player.achievements, 'bestiario_de_ipera')).toBe(true);
  });

  it('records an engagement in the Códex without counting a kill', () => {
    const player = freshPlayer();
    recordEnemyEngaged(player, 'dark_wolf');
    expect(player.codex.enemies.dark_wolf).toEqual({ seen: 1, defeated: 0 });
    expect(getAchievementCounter(player.achievements, 'kills')).toBe(0);
  });
});

describe('defeat, NPCs, materials and crafting', () => {
  it('unlocks the first-death achievement and counts deaths', () => {
    const player = freshPlayer();
    expect(ids(recordPlayerDefeated(player))).toEqual(['terra_que_acolhe']);
    recordPlayerDefeated(player);
    expect(getAchievementCounter(player.achievements, 'deaths')).toBe(2);
  });

  it('adds met NPCs to the Códex and unlocks "Prosa de Fogueira" at 20 distinct ones', () => {
    const player = freshPlayer();
    for (const npc of NPC_DEFINITIONS.slice(0, 19)) recordNpcTalkedTo(player, npc.id);
    // Talking to the same person again never counts as a new acquaintance.
    recordNpcTalkedTo(player, NPC_DEFINITIONS[0].id);
    expect(isUnlocked(player.achievements, 'prosa_de_fogueira')).toBe(false);
    expect(ids(recordNpcTalkedTo(player, NPC_DEFINITIONS[19].id))).toEqual(['prosa_de_fogueira']);
    expect(player.codex.npcs[NPC_DEFINITIONS[0].id]).toBe(2);
  });

  it('ignores an unknown NPC id', () => {
    const player = freshPlayer();
    recordNpcTalkedTo(player, 'fantasma');
    expect(player.codex.npcs).toEqual({});
  });

  it('tallies materials through Player.addItem and ignores potions and gems', () => {
    const player = freshPlayer();
    player.addItem('mat_herb', 3);
    player.addItem('potion_hp', 5);
    player.addItem('gem_ruby', 1);
    expect(getAchievementCounter(player.achievements, 'materialsCollected')).toBe(3);
    expect(player.codex.materials).toEqual({ mat_herb: 3 });
  });

  it('unlocks "Colheita Farta" at 50 collected materials and "Mãos na Terra" at every material type', () => {
    const player = freshPlayer();
    player.addItem(MATERIAL_DEFINITIONS[0].id, 49);
    expect(checkAchievements(player)).toEqual([]);
    player.addItem(MATERIAL_DEFINITIONS[1].id, 1);
    expect(ids(checkAchievements(player))).toEqual(['colheita_farta']);

    for (const material of MATERIAL_DEFINITIONS) player.addItem(material.id, 1);
    expect(ids(checkAchievements(player))).toEqual(['oficio_completo']);
  });

  it('still counts materials spent on crafting, since the tally is monotonic', () => {
    const player = freshPlayer();
    recordItemAcquired(player, 'mat_iron_ore', 4);
    player.inventory.mat_iron_ore = 0;
    expect(getAchievementCounter(player.achievements, 'materialsCollected')).toBe(4);
  });

  it('only a Raro-or-better craft unlocks "Mãos de Artesão"', () => {
    const player = freshPlayer();
    expect(recordItemCrafted(player, 'verde')).toEqual([]);
    expect(getAchievementCounter(player.achievements, 'itemsCrafted')).toBe(1);
    expect(ids(recordItemCrafted(player, 'azul'))).toEqual(['maos_de_artesao']);
  });
});

describe('derived achievements', () => {
  it('unlocks the level milestones from the player level, several at once if needed', () => {
    const player = freshPlayer();
    player.debugSetLevel(10);
    expect(ids(checkAchievements(player))).toEqual(['raiz_firme']);
    player.debugSetLevel(30);
    expect(ids(checkAchievements(player))).toEqual(['voz_das_raizes', 'escolhido_pleno']);
  });

  it('counts opened hidden chests from the persisted openedChestIds (so old saves count too), ignoring unknown ids', () => {
    const player = freshPlayer();
    player.openedChestIds.push(CHEST_DEFINITIONS[0].id, CHEST_DEFINITIONS[1].id, 'bau_que_nao_existe');
    expect(checkAchievements(player)).toEqual([]);
    player.openedChestIds.push(CHEST_DEFINITIONS[2].id);
    expect(ids(checkAchievements(player))).toEqual(['faro_para_segredos']);
  });

  it('unlocks Andarilho de Ipêra only after every explorable zone was visited', () => {
    const player = freshPlayer();
    for (const zoneId of EXPLORATION_ZONE_IDS.slice(0, -1)) recordZoneVisited(player, zoneId);
    expect(checkAchievements(player)).toEqual([]);
    expect(achievementProgress(getAchievementById('andarilho_de_ipera')!, player)).toEqual({ current: 10, target: 11 });
    recordZoneVisited(player, EXPLORATION_ZONE_IDS[EXPLORATION_ZONE_IDS.length - 1]);
    expect(ids(checkAchievements(player))).toEqual(['andarilho_de_ipera']);
  });

  it('observeAchievements marks the current zone as visited and runs the check', () => {
    const player = freshPlayer();
    player.zoneId = 'main_city';
    player.debugSetLevel(10);
    const unlocked = observeAchievements(player);
    expect(player.achievements.flags['zone:main_city']).toBe(true);
    expect(ids(unlocked)).toEqual(['raiz_firme']);
  });

  it('unlocks the dungeon achievement from dungeonTiers', () => {
    const player = freshPlayer();
    player.dungeonTiers.root_hollow = 0;
    expect(checkAchievements(player)).toEqual([]);
    player.dungeonTiers.root_hollow = 1;
    expect(ids(checkAchievements(player))).toEqual(['raizes_fundas']);
  });

  it('unlocks the equipment rarity achievements from what is equipped', () => {
    const player = freshPlayer();
    expect(checkAchievements(player)).toEqual([]);
    player.equipment.arma = createStarterItem('espada_curta', 'azul');
    expect(ids(checkAchievements(player))).toEqual(['brilho_raro']);
    player.equipment.armadura = createStarterItem('armadura_couro', 'vermelho');
    expect(ids(checkAchievements(player))).toEqual(['lenda_nas_maos']);
  });

  it('adds equipped and carried gear to the Códex when it checks', () => {
    const player = freshPlayer();
    player.bag.push(createStarterItem('anel_sorte', 'amarelo'));
    checkAchievements(player);
    expect(player.codex.equipment.anel_sorte).toBe(2);
    expect(player.codex.equipment.espada_curta).toBe(0);
  });

  it('completes "Chamado Cumprido" only with the player\'s own class calling line', () => {
    const mage = freshPlayer('mage');
    mage.completedQuestIds.push(lastCallingQuestIdForClass('warrior'));
    expect(checkAchievements(mage)).toEqual([]);
    mage.completedQuestIds.push(lastCallingQuestIdForClass('mage'));
    expect(ids(checkAchievements(mage))).toEqual(['chamado_cumprido']);
  });

  it('unlocks exactly the ending the player chose', () => {
    const player = freshPlayer();
    player.act3Ending = 'cura';
    expect(ids(checkAchievements(player))).toEqual(['final_cura']);
    expect(earnedTitles(player.achievements)).toEqual(['Curandeiro de Ipêra']);
  });
});

describe('toast queue and reward text', () => {
  it('queues each unlock once and hands them out oldest first', () => {
    const player = freshPlayer();
    recordEnemyDefeated(player, 'young_dragon');
    const first = consumePendingUnlock(player);
    const second = consumePendingUnlock(player);
    expect(first?.id).toBe('primeira_gota');
    expect(second?.id).toBe('primeiro_guardiao');
    let drained = 2;
    while (consumePendingUnlock(player)) drained++;
    expect(drained).toBe(player.achievements.unlocked.length);
    expect(consumePendingUnlock(player)).toBeNull();
  });

  it('does not re-queue something already unlocked', () => {
    const player = freshPlayer();
    recordEnemyDefeated(player, 'slime');
    while (consumePendingUnlock(player)) {
      // drain
    }
    checkAchievements(player);
    expect(player.achievements.pending).toEqual([]);
  });

  it('describes rewards in pt-BR and tolerates a missing one', () => {
    expect(describeReward({ gold: 100, xp: 120, title: 'Ceifador de Sede' })).toBe('+100 ouro, +120 XP, título "Ceifador de Sede"');
    expect(describeReward({ title: 'Intocável' })).toBe('título "Intocável"');
    expect(describeReward(undefined)).toBe('');
  });

  it('lists earned titles in unlock order without duplicates', () => {
    const state = createInitialAchievementState();
    state.unlocked.push('maos_de_artesao', 'sem_um_arranhao', 'maos_de_artesao');
    expect(earnedTitles(state)).toEqual(['Artesão', 'Intocável']);
  });
});
