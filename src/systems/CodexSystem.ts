import { RARITY_LABEL, RARITY_ORDER, rarityTier } from '../config/rarity';
import type { EnemyDefinition, EquipmentInstance, EquipmentSlot } from '../config/types';
import { BOSS_DEFINITIONS } from '../data/bosses';
import { DUNGEON_DEFINITIONS } from '../data/dungeons';
import { ENEMY_DEFINITIONS } from '../data/enemies';
import { EQUIPMENT_TEMPLATES } from '../data/equipment';
import { LORE_FRAGMENTS } from '../data/loreFragments';
import { MATERIAL_DEFINITIONS } from '../data/materials';
import { NPC_DEFINITIONS } from '../data/npcs';
import { ZONE_DEFINITIONS } from '../data/zones';
import { archetypeProfileFor } from './enemyArchetypes';

/**
 * O Códex de Ipêra: um registro persistente de tudo que o jogador já viu,
 * enfrentou, conheceu ou coletou. Puro (sem DOM/three) — `AchievementsScreen`
 * só desenha o que `codexEntryViews` devolve, e `AchievementSystem` lê as
 * contagens daqui para as conquistas "de códex".
 */
export type CodexSection = 'enemies' | 'bosses' | 'npcs' | 'materials' | 'equipment';

export const CODEX_SECTIONS: CodexSection[] = ['enemies', 'bosses', 'npcs', 'materials', 'equipment'];

export interface CodexEnemyRecord {
  seen: number;
  defeated: number;
}

export interface CodexState {
  /** Comuns e chefes, pela mesma chave (`EnemyDefinition.id`) — a aba só filtra por `isBoss`. */
  enemies: Record<string, CodexEnemyRecord>;
  /** NPC id -> quantas vezes o jogador conversou com ele. */
  npcs: Record<string, number>;
  /** Material id -> total já coletado. */
  materials: Record<string, number>;
  /** Equipment template id -> maior raridade (tier 0-4, ver config/rarity) já encontrada. */
  equipment: Record<string, number>;
}

export function createInitialCodexState(): CodexState {
  return { enemies: {}, npcs: {}, materials: {}, equipment: {} };
}

/** Defaults a save from before the Códex existed (or a partially-written one) into a fully-shaped state. */
export function normalizeCodexState(raw?: Partial<CodexState> | null): CodexState {
  return {
    enemies: { ...(raw?.enemies ?? {}) },
    npcs: { ...(raw?.npcs ?? {}) },
    materials: { ...(raw?.materials ?? {}) },
    equipment: { ...(raw?.equipment ?? {}) },
  };
}

export function cloneCodexState(state: CodexState): CodexState {
  const enemies: Record<string, CodexEnemyRecord> = {};
  for (const [id, rec] of Object.entries(state.enemies)) enemies[id] = { ...rec };
  return { enemies, npcs: { ...state.npcs }, materials: { ...state.materials }, equipment: { ...state.equipment } };
}

/** Looks an enemy id up across regular enemies and dungeon bosses (which live in separate data files). */
export function findEnemyDefinition(id: string): EnemyDefinition | undefined {
  return BOSS_DEFINITIONS.find((b) => b.id === id) ?? ENEMY_DEFINITIONS.find((e) => e.id === id);
}

function enemyDefinitionsFor(section: 'enemies' | 'bosses'): EnemyDefinition[] {
  if (section === 'bosses') return [...ENEMY_DEFINITIONS.filter((e) => e.isBoss), ...BOSS_DEFINITIONS];
  return ENEMY_DEFINITIONS.filter((e) => !e.isBoss);
}

// --- recording ------------------------------------------------------------

function enemyRecord(state: CodexState, id: string): CodexEnemyRecord {
  return (state.enemies[id] ??= { seen: 0, defeated: 0 });
}

/** Returns true the first time this enemy ever enters the Códex. */
export function recordEnemySeen(state: CodexState, enemyId: string): boolean {
  if (!findEnemyDefinition(enemyId)) return false;
  const first = state.enemies[enemyId] === undefined;
  enemyRecord(state, enemyId).seen += 1;
  return first;
}

/** Fighting an enemy and winning implies having seen it, so `seen` never lags behind `defeated`. */
export function recordEnemyDefeated(state: CodexState, enemyId: string): boolean {
  if (!findEnemyDefinition(enemyId)) return false;
  const first = state.enemies[enemyId] === undefined;
  const rec = enemyRecord(state, enemyId);
  rec.defeated += 1;
  rec.seen = Math.max(rec.seen, rec.defeated);
  return first;
}

export function recordNpcMet(state: CodexState, npcId: string): boolean {
  if (!NPC_DEFINITIONS.some((n) => n.id === npcId)) return false;
  const first = state.npcs[npcId] === undefined;
  state.npcs[npcId] = (state.npcs[npcId] ?? 0) + 1;
  return first;
}

export function isMaterialId(itemId: string): boolean {
  return MATERIAL_DEFINITIONS.some((m) => m.id === itemId);
}

/** Ignores ids that aren't crafting materials (the same `Player.addItem` also hands out potions and gems). */
export function recordMaterialCollected(state: CodexState, itemId: string, qty: number): boolean {
  if (qty <= 0 || !isMaterialId(itemId)) return false;
  const first = state.materials[itemId] === undefined;
  state.materials[itemId] = (state.materials[itemId] ?? 0) + qty;
  return first;
}

export function recordEquipmentFound(state: CodexState, instance: Pick<EquipmentInstance, 'templateId' | 'rarity'>): boolean {
  if (!EQUIPMENT_TEMPLATES.some((t) => t.id === instance.templateId)) return false;
  const tier = rarityTier(instance.rarity);
  const previous = state.equipment[instance.templateId];
  if (previous === undefined || tier > previous) state.equipment[instance.templateId] = tier;
  return previous === undefined;
}

export interface CodexHoldings {
  inventory: Record<string, number>;
  bag: EquipmentInstance[];
  equipment: Partial<Record<EquipmentSlot, EquipmentInstance>>;
}

/** Backfills discoveries from what the player already carries — the only retroactive source an old save has, and a safety net for loot picked up and sold before any hook ran. */
export function syncCodexFromHoldings(state: CodexState, holdings: CodexHoldings): void {
  for (const [itemId, qty] of Object.entries(holdings.inventory)) {
    if (qty > 0 && state.materials[itemId] === undefined) recordMaterialCollected(state, itemId, qty);
  }
  for (const instance of holdings.bag) recordEquipmentFound(state, instance);
  for (const instance of Object.values(holdings.equipment)) {
    if (instance) recordEquipmentFound(state, instance);
  }
}

// --- progress -------------------------------------------------------------

export interface CodexCounts {
  /** Entries the player has at least seen. */
  discovered: number;
  /** Entries fully "done": a defeated enemy/boss, or simply found for the other sections. */
  completed: number;
  total: number;
}

export function codexCounts(state: CodexState, section: CodexSection): CodexCounts {
  if (section === 'enemies' || section === 'bosses') {
    const defs = enemyDefinitionsFor(section);
    let discovered = 0;
    let completed = 0;
    for (const def of defs) {
      const rec = state.enemies[def.id];
      if (!rec) continue;
      if (rec.seen > 0 || rec.defeated > 0) discovered += 1;
      if (rec.defeated > 0) completed += 1;
    }
    return { discovered, completed, total: defs.length };
  }
  const found = (ids: string[], record: Record<string, number>): CodexCounts => {
    const n = ids.filter((id) => record[id] !== undefined).length;
    return { discovered: n, completed: n, total: ids.length };
  };
  if (section === 'npcs') return found(NPC_DEFINITIONS.map((n) => n.id), state.npcs);
  if (section === 'materials') return found(MATERIAL_DEFINITIONS.map((m) => m.id), state.materials);
  return found(EQUIPMENT_TEMPLATES.map((t) => t.id), state.equipment);
}

/** Whole-Códex completion, 0..1, across every section — what the screen's header summarizes. */
export function codexCompletion(state: CodexState): number {
  let discovered = 0;
  let total = 0;
  for (const section of CODEX_SECTIONS) {
    const counts = codexCounts(state, section);
    discovered += counts.discovered;
    total += counts.total;
  }
  return total === 0 ? 0 : discovered / total;
}

// --- views ----------------------------------------------------------------

export interface CodexEntryView {
  id: string;
  discovered: boolean;
  /** "???" until discovered. */
  name: string;
  description: string;
  /** Extra lines (counts, skills, where to find it) — empty until discovered. */
  details: string[];
  /** Optional swatch color (a material's own color, an equipment's best rarity color is resolved by the UI from `rarityTierFound`). */
  color?: number;
  /** Best rarity tier found, equipment entries only. */
  rarityTierFound?: number;
}

export const UNDISCOVERED_NAME = '???';
export const UNDISCOVERED_DESCRIPTION = 'Ainda não descoberto.';

const SLOT_LABEL: Record<EquipmentSlot, string> = { arma: 'Arma', armadura: 'Armadura', acessorio: 'Acessório' };

function undiscovered(id: string): CodexEntryView {
  return { id, discovered: false, name: UNDISCOVERED_NAME, description: UNDISCOVERED_DESCRIPTION, details: [] };
}

function enemyView(state: CodexState, def: EnemyDefinition): CodexEntryView {
  const rec = state.enemies[def.id];
  if (!rec || (rec.seen === 0 && rec.defeated === 0)) return undiscovered(def.id);
  const profile = archetypeProfileFor(def.archetype);
  const details = [`Encontrado ${rec.seen}x · Derrotado ${rec.defeated}x`];
  if (def.isBoss) {
    const dungeon = DUNGEON_DEFINITIONS.find((d) => d.boss.enemyId === def.id);
    if (dungeon) details.push(`Covil: ${dungeon.name}`);
  }
  if (rec.defeated > 0) {
    details.push(`Recompensa: ${def.xpReward} XP, ${def.goldReward} ouro`);
    for (const skill of def.skills) details.push(`${skill.name}: ${skill.description}`);
  }
  return {
    id: def.id,
    discovered: true,
    name: def.name,
    description: `Nível de ameaça ${def.level} · Estilo: ${profile.label}`,
    details,
    color: def.color,
  };
}

function npcView(state: CodexState, id: string): CodexEntryView {
  const npc = NPC_DEFINITIONS.find((n) => n.id === id);
  const talks = state.npcs[id];
  if (!npc || talks === undefined) return undiscovered(id);
  const zoneName = ZONE_DEFINITIONS[npc.zoneId]?.name ?? npc.zoneId;
  return { id, discovered: true, name: npc.name, description: npc.role, details: [`Local: ${zoneName}`, `Conversas: ${talks}`] };
}

function materialView(state: CodexState, id: string): CodexEntryView {
  const def = MATERIAL_DEFINITIONS.find((m) => m.id === id);
  const qty = state.materials[id];
  if (!def || qty === undefined) return undiscovered(id);
  return { id, discovered: true, name: def.name, description: def.description, details: [`Coletado: ${qty}`], color: def.color };
}

function equipmentView(state: CodexState, id: string): CodexEntryView {
  const template = EQUIPMENT_TEMPLATES.find((t) => t.id === id);
  const tier = state.equipment[id];
  if (!template || tier === undefined) return undiscovered(id);
  return {
    id,
    discovered: true,
    name: template.name,
    description: template.description,
    details: [`Tipo: ${SLOT_LABEL[template.slot]}`, `Melhor raridade encontrada: ${RARITY_LABEL[RARITY_ORDER[tier] ?? RARITY_ORDER[0]]}`],
    rarityTierFound: tier,
  };
}

export function codexEntryViews(state: CodexState, section: CodexSection): CodexEntryView[] {
  switch (section) {
    case 'enemies':
    case 'bosses':
      return enemyDefinitionsFor(section).map((def) => enemyView(state, def));
    case 'npcs':
      return NPC_DEFINITIONS.map((n) => npcView(state, n.id));
    case 'materials':
      return MATERIAL_DEFINITIONS.map((m) => materialView(state, m.id));
    case 'equipment':
      return EQUIPMENT_TEMPLATES.map((t) => equipmentView(state, t.id));
  }
}

// --- lore -----------------------------------------------------------------

/** Fragmentos de Memória live on `Player.discoveredLoreIds`, not in CodexState, so they are read by id list rather than as a CodexSection. */
export function loreCounts(discoveredIds: readonly string[]): CodexCounts {
  const found = new Set(discoveredIds);
  const n = LORE_FRAGMENTS.filter((f) => found.has(f.id)).length;
  return { discovered: n, completed: n, total: LORE_FRAGMENTS.length };
}

export function loreEntryViews(discoveredIds: readonly string[]): CodexEntryView[] {
  const found = new Set(discoveredIds);
  return LORE_FRAGMENTS.map((fragment) => {
    if (!found.has(fragment.id)) return undiscovered(fragment.id);
    const zoneName = ZONE_DEFINITIONS[fragment.zoneId]?.name ?? fragment.zoneId;
    return {
      id: fragment.id,
      discovered: true,
      name: fragment.title,
      description: `Local: ${zoneName}${fragment.nightOnly ? ' · só se revela à noite' : ''}`,
      details: [...fragment.lines],
    };
  });
}
