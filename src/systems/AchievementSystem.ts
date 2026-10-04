import { rarityTier } from '../config/rarity';
import type { ItemRarity } from '../config/types';
import {
  ACHIEVEMENT_DEFINITIONS,
  getAchievementById,
  type AchievementCondition,
  type AchievementCounter,
  type AchievementDefinition,
  type AchievementFlag,
  type AchievementReward,
} from '../data/achievements';
import { CHEST_DEFINITIONS } from '../data/chests';
import { lastCallingQuestIdForClass } from '../data/quests';
import type { Player } from '../entities/Player';
import {
  codexCounts,
  findEnemyDefinition,
  isMaterialId,
  recordEnemyDefeated as codexRecordEnemyDefeated,
  recordEnemySeen as codexRecordEnemySeen,
  recordMaterialCollected as codexRecordMaterialCollected,
  recordNpcMet as codexRecordNpcMet,
  syncCodexFromHoldings,
} from './CodexSystem';

/**
 * Conquistas: data-driven (`data/achievements.ts`) e quase sempre derivadas
 * de estado que o jogador já persiste (nível, missões, baús, equipamento,
 * eventos do mundo). Só o que não existe em lugar nenhum — abates, mortes,
 * materiais coletados, itens criados, zonas visitadas, "chefe sem dano" —
 * vive em `AchievementState`. Os `record*` abaixo são os ganchos finos que
 * os pontos de entrada existentes chamam; todos terminam em
 * `checkAchievements`, que desbloqueia, paga a recompensa e empilha o aviso
 * em `pending` para o HUD mostrar (ver ui/achievementToast.ts).
 */
export interface AchievementState {
  /** Ids desbloqueados, na ordem em que aconteceram. */
  unlocked: string[];
  counters: Record<string, number>;
  flags: Record<string, true>;
  /** Desbloqueios cujo aviso ainda não apareceu na tela — persistido para não perder um aviso se o jogador trocar de tela. */
  pending: string[];
}

export function createInitialAchievementState(): AchievementState {
  return { unlocked: [], counters: {}, flags: {}, pending: [] };
}

/** Defaults a save from before achievements existed (or a partially-written one) into a fully-shaped state. */
export function normalizeAchievementState(raw?: Partial<AchievementState> | null): AchievementState {
  return {
    unlocked: [...(raw?.unlocked ?? [])],
    counters: { ...(raw?.counters ?? {}) },
    flags: { ...(raw?.flags ?? {}) },
    pending: [...(raw?.pending ?? [])],
  };
}

export function cloneAchievementState(state: AchievementState): AchievementState {
  return normalizeAchievementState(state);
}

export function isUnlocked(state: AchievementState, id: string): boolean {
  return state.unlocked.includes(id);
}

export function getAchievementCounter(state: AchievementState, key: AchievementCounter): number {
  return state.counters[key] ?? 0;
}

function bump(state: AchievementState, key: AchievementCounter, amount = 1): void {
  state.counters[key] = (state.counters[key] ?? 0) + amount;
}

function setAchievementFlag(state: AchievementState, key: AchievementFlag | `zone:${string}`): void {
  state.flags[key] = true;
}

// --- evaluation -----------------------------------------------------------

export interface AchievementProgress {
  current: number;
  target: number;
}

function clampProgress(current: number, target: number): AchievementProgress {
  return { current: Math.max(0, Math.min(current, target)), target };
}

function resolveTarget(target: number | 'all', total: number): number {
  return target === 'all' ? total : target;
}

/** How far along a condition is, for both the unlock check and the screen's progress bar. Booleans report 0/1. */
export function conditionProgress(condition: AchievementCondition, player: Player): AchievementProgress {
  switch (condition.kind) {
    case 'counter':
      return clampProgress(getAchievementCounter(player.achievements, condition.key), condition.target);
    case 'flag':
      return clampProgress(player.achievements.flags[condition.key] ? 1 : 0, 1);
    case 'level':
      return clampProgress(player.level, condition.target);
    case 'codex': {
      const counts = codexCounts(player.codex, condition.section);
      return clampProgress(counts.completed, resolveTarget(condition.target, counts.total));
    }
    case 'bossDefeated':
      return clampProgress((player.codex.enemies[condition.enemyId]?.defeated ?? 0) > 0 ? 1 : 0, 1);
    case 'quest':
      return clampProgress(player.completedQuestIds.includes(condition.questId) ? 1 : 0, 1);
    case 'classCalling': {
      let lastId: string | null = null;
      try {
        lastId = lastCallingQuestIdForClass(player.classId);
      } catch {
        lastId = null;
      }
      return clampProgress(lastId !== null && player.completedQuestIds.includes(lastId) ? 1 : 0, 1);
    }
    case 'events':
      return clampProgress(condition.eventIds.filter((id) => player.worldState.completedEvents[id]).length, condition.eventIds.length);
    case 'ending':
      return clampProgress(player.act3Ending === condition.ending ? 1 : 0, 1);
    case 'chests': {
      const valid = new Set(CHEST_DEFINITIONS.map((c) => c.id));
      const opened = player.openedChestIds.filter((id) => valid.has(id)).length;
      return clampProgress(opened, resolveTarget(condition.target, CHEST_DEFINITIONS.length));
    }
    case 'dungeonsCleared':
      return clampProgress(Object.values(player.dungeonTiers).filter((tier) => tier > 0).length, condition.target);
    case 'zones':
      return clampProgress(condition.zoneIds.filter((id) => player.achievements.flags[`zone:${id}`]).length, condition.zoneIds.length);
    case 'equippedRarity': {
      const min = rarityTier(condition.min);
      const met = Object.values(player.equipment).some((item) => item !== undefined && rarityTier(item.rarity) >= min);
      return clampProgress(met ? 1 : 0, 1);
    }
  }
}

export function isConditionMet(condition: AchievementCondition, player: Player): boolean {
  const { current, target } = conditionProgress(condition, player);
  return target > 0 && current >= target;
}

export function achievementProgress(def: AchievementDefinition, player: Player): AchievementProgress {
  return conditionProgress(def.condition, player);
}

// --- unlocking ------------------------------------------------------------

/** Re-evaluation guard: an XP reward can level the player into yet another level achievement, but never more than the number of definitions. */
const MAX_PASSES = ACHIEVEMENT_DEFINITIONS.length;

function applyReward(player: Player, reward: AchievementReward | undefined): void {
  if (!reward) return;
  if (reward.gold) player.gold += reward.gold;
  if (reward.xp) player.gainXp(reward.xp);
}

/**
 * Unlocks every achievement whose condition is now met, pays its reward once,
 * and queues its toast. Safe to call as often as convenient (every hook below
 * does, and the overworld HUD polls it) — an already-unlocked achievement is
 * skipped, so nothing ever pays twice. Returns what unlocked on THIS call.
 */
export function checkAchievements(player: Player): AchievementDefinition[] {
  syncCodexFromHoldings(player.codex, player);
  const state = player.achievements;
  const unlockedNow: AchievementDefinition[] = [];
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let progressed = false;
    for (const def of ACHIEVEMENT_DEFINITIONS) {
      if (isUnlocked(state, def.id) || !isConditionMet(def.condition, player)) continue;
      state.unlocked.push(def.id);
      state.pending.push(def.id);
      applyReward(player, def.reward);
      unlockedNow.push(def);
      progressed = true;
    }
    if (!progressed) break;
  }
  return unlockedNow;
}

/** Pops the oldest unlock whose toast hasn't been shown yet. */
export function consumePendingUnlock(player: Player): AchievementDefinition | null {
  while (player.achievements.pending.length > 0) {
    const id = player.achievements.pending.shift()!;
    const def = getAchievementById(id);
    if (def) return def;
  }
  return null;
}

/** pt-BR one-liner for a reward, e.g. "+100 ouro, +120 XP, título "Ceifador de Sede"" — empty when there is none. */
export function describeReward(reward: AchievementReward | undefined): string {
  if (!reward) return '';
  const parts: string[] = [];
  if (reward.gold) parts.push(`+${reward.gold} ouro`);
  if (reward.xp) parts.push(`+${reward.xp} XP`);
  if (reward.title) parts.push(`título "${reward.title}"`);
  return parts.join(', ');
}

/** Titles earned so far, in unlock order. */
export function earnedTitles(state: AchievementState): string[] {
  const titles: string[] = [];
  for (const id of state.unlocked) {
    const title = getAchievementById(id)?.reward?.title;
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

// --- hooks ----------------------------------------------------------------

/** A monster just engaged the player — adds it to the Códex as "seen". */
export function recordEnemyEngaged(player: Player, enemyId: string): void {
  codexRecordEnemySeen(player.codex, enemyId);
}

/**
 * Call once per enemy that fell in a victorious fight. `flawless` = the
 * player took no damage at any point in that fight; it only ever matters
 * when the enemy was a boss.
 */
export function recordEnemyDefeated(player: Player, enemyId: string, opts: { flawless?: boolean } = {}): AchievementDefinition[] {
  codexRecordEnemyDefeated(player.codex, enemyId);
  bump(player.achievements, 'kills');
  if (findEnemyDefinition(enemyId)?.isBoss) {
    bump(player.achievements, 'bossKills');
    if (opts.flawless) setAchievementFlag(player.achievements, 'flawlessBoss');
  }
  return checkAchievements(player);
}

export function recordNpcTalkedTo(player: Player, npcId: string): AchievementDefinition[] {
  codexRecordNpcMet(player.codex, npcId);
  return checkAchievements(player);
}

/** Called for every `Player.addItem` — only crafting materials count, anything else (potions, gems) is ignored. */
export function recordItemAcquired(player: Player, itemId: string, qty: number): void {
  if (qty <= 0 || !isMaterialId(itemId)) return;
  codexRecordMaterialCollected(player.codex, itemId, qty);
  bump(player.achievements, 'materialsCollected', qty);
}

export function recordPlayerDefeated(player: Player): AchievementDefinition[] {
  bump(player.achievements, 'deaths');
  return checkAchievements(player);
}

/** A vendor craft that produced an equipment piece — `rarity` is what it came out as. */
export function recordItemCrafted(player: Player, rarity: ItemRarity): AchievementDefinition[] {
  bump(player.achievements, 'itemsCrafted');
  if (rarityTier(rarity) >= rarityTier('azul')) bump(player.achievements, 'rareCrafted');
  return checkAchievements(player);
}

export function recordZoneVisited(player: Player, zoneId: string): void {
  setAchievementFlag(player.achievements, `zone:${zoneId}`);
}

/** The overworld HUD's periodic safety net — picks up everything derived (level from a quest's XP, a chest, a freshly equipped item, an ending) that no hook announced. */
export function observeAchievements(player: Player): AchievementDefinition[] {
  recordZoneVisited(player, player.zoneId);
  return checkAchievements(player);
}
