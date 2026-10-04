import { describe, expect, it } from 'vitest';
import { BOSS_DEFINITIONS } from '../data/bosses';
import { ENEMY_DEFINITIONS } from '../data/enemies';
import { EQUIPMENT_TEMPLATES, createStarterItem } from '../data/equipment';
import { LORE_FRAGMENTS } from '../data/loreFragments';
import { MATERIAL_DEFINITIONS } from '../data/materials';
import { NPC_DEFINITIONS } from '../data/npcs';
import {
  CODEX_SECTIONS,
  loreCounts,
  loreEntryViews,
  UNDISCOVERED_NAME,
  cloneCodexState,
  codexCompletion,
  codexCounts,
  codexEntryViews,
  createInitialCodexState,
  normalizeCodexState,
  recordEnemyDefeated,
  recordEnemySeen,
  recordEquipmentFound,
  recordMaterialCollected,
  recordNpcMet,
  syncCodexFromHoldings,
} from './CodexSystem';

describe('CodexSystem — recording', () => {
  it('starts empty and normalizes partial/old data into a full shape', () => {
    expect(createInitialCodexState()).toEqual({ enemies: {}, npcs: {}, materials: {}, equipment: {} });
    expect(normalizeCodexState(undefined)).toEqual(createInitialCodexState());
    expect(normalizeCodexState({ npcs: { tobias: 2 } })).toEqual({ enemies: {}, npcs: { tobias: 2 }, materials: {}, equipment: {} });
  });

  it('tracks seen and defeated counts per enemy and flags the first discovery', () => {
    const codex = createInitialCodexState();
    expect(recordEnemySeen(codex, 'slime')).toBe(true);
    expect(recordEnemySeen(codex, 'slime')).toBe(false);
    expect(codex.enemies.slime).toEqual({ seen: 2, defeated: 0 });
    recordEnemyDefeated(codex, 'slime');
    expect(codex.enemies.slime).toEqual({ seen: 2, defeated: 1 });
  });

  it('never lets seen lag behind defeated, and a defeat alone discovers the enemy', () => {
    const codex = createInitialCodexState();
    expect(recordEnemyDefeated(codex, 'goblin')).toBe(true);
    expect(codex.enemies.goblin).toEqual({ seen: 1, defeated: 1 });
  });

  it('ignores ids the game does not define', () => {
    const codex = createInitialCodexState();
    expect(recordEnemySeen(codex, 'nao_existe')).toBe(false);
    expect(recordEnemyDefeated(codex, 'nao_existe')).toBe(false);
    expect(recordNpcMet(codex, 'ninguem')).toBe(false);
    expect(recordMaterialCollected(codex, 'potion_hp', 1)).toBe(false);
    expect(recordEquipmentFound(codex, { templateId: 'nada', rarity: 'verde' })).toBe(false);
    expect(codex).toEqual(createInitialCodexState());
  });

  it('records dungeon bosses (a separate data file) the same way as regular enemies', () => {
    const codex = createInitialCodexState();
    expect(recordEnemySeen(codex, BOSS_DEFINITIONS[0].id)).toBe(true);
    expect(codexCounts(codex, 'bosses').discovered).toBe(1);
  });

  it('counts NPC conversations and material totals', () => {
    const codex = createInitialCodexState();
    const npcId = NPC_DEFINITIONS[0].id;
    expect(recordNpcMet(codex, npcId)).toBe(true);
    expect(recordNpcMet(codex, npcId)).toBe(false);
    expect(codex.npcs[npcId]).toBe(2);
    const materialId = MATERIAL_DEFINITIONS[0].id;
    recordMaterialCollected(codex, materialId, 3);
    recordMaterialCollected(codex, materialId, 2);
    expect(codex.materials[materialId]).toBe(5);
  });

  it('keeps only the best rarity found per equipment template', () => {
    const codex = createInitialCodexState();
    const templateId = EQUIPMENT_TEMPLATES[0].id;
    expect(recordEquipmentFound(codex, { templateId, rarity: 'azul' })).toBe(true);
    expect(recordEquipmentFound(codex, { templateId, rarity: 'verde' })).toBe(false);
    expect(codex.equipment[templateId]).toBe(1);
    recordEquipmentFound(codex, { templateId, rarity: 'vermelho' });
    expect(codex.equipment[templateId]).toBe(3);
  });

  it('backfills materials and equipment from what the player already carries', () => {
    const codex = createInitialCodexState();
    syncCodexFromHoldings(codex, {
      inventory: { mat_herb: 4, potion_hp: 3, mat_leather: 0 },
      bag: [createStarterItem('anel_sorte', 'amarelo')],
      equipment: { arma: createStarterItem('espada_curta', 'verde') },
    });
    expect(codex.materials).toEqual({ mat_herb: 4 });
    expect(codex.equipment).toEqual({ anel_sorte: 2, espada_curta: 0 });
  });

  it('does not overwrite an already-tracked material total when syncing', () => {
    const codex = createInitialCodexState();
    codex.materials.mat_herb = 10;
    syncCodexFromHoldings(codex, { inventory: { mat_herb: 1 }, bag: [], equipment: {} });
    expect(codex.materials.mat_herb).toBe(10);
  });

  it('clones deeply so a saved copy never aliases the live state', () => {
    const codex = createInitialCodexState();
    recordEnemySeen(codex, 'slime');
    const copy = cloneCodexState(codex);
    recordEnemySeen(codex, 'slime');
    expect(copy.enemies.slime.seen).toBe(1);
  });
});

describe('CodexSystem — progress', () => {
  it('splits regular enemies and bosses, with young_dragon counted as a boss', () => {
    const regular = ENEMY_DEFINITIONS.filter((e) => !e.isBoss).length;
    const bosses = ENEMY_DEFINITIONS.filter((e) => e.isBoss).length + BOSS_DEFINITIONS.length;
    const codex = createInitialCodexState();
    expect(codexCounts(codex, 'enemies')).toEqual({ discovered: 0, completed: 0, total: regular });
    expect(codexCounts(codex, 'bosses')).toEqual({ discovered: 0, completed: 0, total: bosses });
    expect(codexCounts(codex, 'npcs').total).toBe(NPC_DEFINITIONS.length);
    expect(codexCounts(codex, 'materials').total).toBe(MATERIAL_DEFINITIONS.length);
    expect(codexCounts(codex, 'equipment').total).toBe(EQUIPMENT_TEMPLATES.length);
  });

  it('counts an enemy as discovered when seen but only completed once defeated', () => {
    const codex = createInitialCodexState();
    recordEnemySeen(codex, 'slime');
    expect(codexCounts(codex, 'enemies')).toMatchObject({ discovered: 1, completed: 0 });
    recordEnemyDefeated(codex, 'slime');
    expect(codexCounts(codex, 'enemies')).toMatchObject({ discovered: 1, completed: 1 });
    recordEnemyDefeated(codex, 'young_dragon');
    expect(codexCounts(codex, 'enemies').completed).toBe(1);
    expect(codexCounts(codex, 'bosses').completed).toBe(1);
  });

  it('reports whole-Códex completion between 0 and 1', () => {
    const codex = createInitialCodexState();
    expect(codexCompletion(codex)).toBe(0);
    recordNpcMet(codex, NPC_DEFINITIONS[0].id);
    const fraction = codexCompletion(codex);
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
  });
});

describe('CodexSystem — entry views', () => {
  it('lists every entry of every section, all hidden behind "???" on an empty Códex', () => {
    const codex = createInitialCodexState();
    for (const section of CODEX_SECTIONS) {
      const views = codexEntryViews(codex, section);
      expect(views.length).toBe(codexCounts(codex, section).total);
      for (const view of views) {
        expect(view.discovered).toBe(false);
        expect(view.name).toBe(UNDISCOVERED_NAME);
        expect(view.details).toEqual([]);
      }
    }
  });

  it('reveals the real name for a seen enemy but holds its skills back until it is defeated', () => {
    const codex = createInitialCodexState();
    recordEnemySeen(codex, 'goblin');
    const seen = codexEntryViews(codex, 'enemies').find((v) => v.id === 'goblin')!;
    expect(seen.discovered).toBe(true);
    expect(seen.name).toBe(ENEMY_DEFINITIONS.find((e) => e.id === 'goblin')!.name);
    expect(seen.details.some((d) => d.includes('Golpe Sujo'))).toBe(false);

    recordEnemyDefeated(codex, 'goblin');
    const defeated = codexEntryViews(codex, 'enemies').find((v) => v.id === 'goblin')!;
    expect(defeated.details.some((d) => d.includes('Golpe Sujo'))).toBe(true);
    expect(defeated.details[0]).toContain('Derrotado 1x');
  });

  it('names the dungeon a boss lairs in', () => {
    const codex = createInitialCodexState();
    recordEnemySeen(codex, 'boss_root_ooze');
    const view = codexEntryViews(codex, 'bosses').find((v) => v.id === 'boss_root_ooze')!;
    expect(view.name).toBe('Matriarca-Geleia');
    expect(view.details.some((d) => d.startsWith('Covil:'))).toBe(true);
  });

  it('shows NPC role/zone, material description and equipment best rarity once discovered', () => {
    const codex = createInitialCodexState();
    const npc = NPC_DEFINITIONS[0];
    recordNpcMet(codex, npc.id);
    const npcView = codexEntryViews(codex, 'npcs').find((v) => v.id === npc.id)!;
    expect(npcView.name).toBe(npc.name);
    expect(npcView.description).toBe(npc.role);
    expect(npcView.details.some((d) => d.startsWith('Local:'))).toBe(true);

    recordMaterialCollected(codex, 'mat_herb', 2);
    const materialView = codexEntryViews(codex, 'materials').find((v) => v.id === 'mat_herb')!;
    expect(materialView.name).toBe('Erva Medicinal');
    expect(materialView.details).toEqual(['Coletado: 2']);

    recordEquipmentFound(codex, { templateId: 'espada_curta', rarity: 'vermelho' });
    const equipmentView = codexEntryViews(codex, 'equipment').find((v) => v.id === 'espada_curta')!;
    expect(equipmentView.name).toBe('Espada Curta');
    expect(equipmentView.rarityTierFound).toBe(3);
    expect(equipmentView.details).toContain('Melhor raridade encontrada: Lendário');
  });
});

describe('CodexSystem — lore tab', () => {
  it('lists every fragment as "???" until it is discovered', () => {
    const views = loreEntryViews([]);
    expect(views).toHaveLength(LORE_FRAGMENTS.length);
    for (const view of views) {
      expect(view.discovered).toBe(false);
      expect(view.name).toBe(UNDISCOVERED_NAME);
      expect(view.details).toEqual([]);
    }
    expect(loreCounts([])).toEqual({ discovered: 0, completed: 0, total: LORE_FRAGMENTS.length });
  });

  it('shows title, place and full text for a discovered fragment, leaving the rest hidden', () => {
    const found = LORE_FRAGMENTS[0];
    const views = loreEntryViews([found.id, 'frag_inexistente']);
    const view = views.find((v) => v.id === found.id)!;
    expect(view.discovered).toBe(true);
    expect(view.name).toBe(found.title);
    expect(view.description).toContain('Local:');
    expect(view.details).toEqual(found.lines);
    expect(views.filter((v) => v.discovered)).toHaveLength(1);
    expect(loreCounts([found.id, found.id, 'frag_inexistente']).discovered).toBe(1);
  });

  it('flags night-only fragments in their place line', () => {
    const night = LORE_FRAGMENTS.find((f) => f.nightOnly)!;
    expect(loreEntryViews([night.id]).find((v) => v.id === night.id)!.description).toContain('à noite');
  });
});
