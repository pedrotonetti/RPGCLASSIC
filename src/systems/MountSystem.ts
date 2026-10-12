/**
 * Mount progression: which mounts a character has earned, which one of each
 * kind is equipped (from the Inventory), and how flying mounts evolve.
 *
 * - Ground mounts unlock by completed side quests (data/quests.ts SIDE_QUESTS
 *   + branching quests); the brown horse is everyone's starter.
 * - Flying mounts unlock by milestones (level, a main quest, a dungeon tier,
 *   lore fragments) and evolve through 3 stages with mount XP — earned by
 *   flying (`FLY_XP_PER_SECOND`) and by winning fights while riding
 *   (`FIGHT_XP_PER_ENEMY`).
 *
 * Everything here is derived from save-backed Player fields, so unlocks
 * survive reloads and an old save simply re-earns what its progress
 * already qualifies for (see `syncMountUnlocks`).
 */
import { BRANCHING_QUESTS } from '../data/branchingQuests';
import { getMountById, MOUNT_DEFINITIONS, mountAtStage, mountStageIndex, STARTER_MOUNT_ID, type MountDefinition, type MountKind } from '../data/mounts';
import { SIDE_QUESTS } from '../data/quests';
import type { Player } from '../entities/Player';

export const FLY_XP_PER_SECOND = 1;
export const FIGHT_XP_PER_ENEMY = 25;

const SIDE_QUEST_IDS = new Set([...SIDE_QUESTS, ...BRANCHING_QUESTS].map((q) => q.id));

/** The subset of Player this module reads/writes — keeps tests light. */
export type MountHolder = Pick<
  Player,
  'level' | 'completedQuestIds' | 'dungeonTiers' | 'discoveredLoreIds' | 'unlockedMounts' | 'activeMountId' | 'equippedMounts' | 'mountXp'
>;

export function sideQuestsCompleted(player: Pick<Player, 'completedQuestIds'>): number {
  return player.completedQuestIds.filter((id) => SIDE_QUEST_IDS.has(id)).length;
}

export function isMountEarned(player: MountHolder, def: MountDefinition): boolean {
  const u = def.unlock;
  switch (u.kind) {
    case 'start':
      return true;
    case 'sideQuests':
      return sideQuestsCompleted(player) >= u.count;
    case 'quest':
      return player.completedQuestIds.includes(u.questId);
    case 'level':
      return player.level >= u.level;
    case 'dungeonTier':
      return Object.values(player.dungeonTiers).some((tier) => tier >= u.tier);
    case 'lore':
      return player.discoveredLoreIds.length >= u.count;
  }
}

/**
 * Adds every mount the player's progress now qualifies for, auto-equipping
 * it if that kind's slot is still empty. Returns one pt-BR toast per new
 * mount (empty when nothing changed). Cheap — safe to call every second.
 */
export function syncMountUnlocks(player: MountHolder): string[] {
  const messages: string[] = [];
  for (const def of MOUNT_DEFINITIONS) {
    if (player.unlockedMounts.includes(def.id) || !isMountEarned(player, def)) continue;
    player.unlockedMounts.push(def.id);
    if (!player.equippedMounts[def.kind]) player.equippedMounts[def.kind] = def.id;
    if (def.unlock.kind !== 'start') {
      messages.push(`Nova montaria ${def.kind === 'voadora' ? 'voadora' : 'terrestre'}: ${def.name}! Equipe-a no Inventário.`);
    }
  }
  // Canonical order (as in data/mounts.ts) so menus never reshuffle.
  player.unlockedMounts.sort((a, b) => MOUNT_DEFINITIONS.findIndex((m) => m.id === a) - MOUNT_DEFINITIONS.findIndex((m) => m.id === b));
  return messages;
}

/** Equips an unlocked mount in its kind's slot. If the player is currently riding a mount of that kind, they switch to the new one. */
export function equipMount(player: MountHolder, mountId: string): boolean {
  if (!player.unlockedMounts.includes(mountId)) return false;
  const def = getMountById(mountId);
  player.equippedMounts[def.kind] = def.id;
  if (player.activeMountId && getMountById(player.activeMountId).kind === def.kind) player.activeMountId = def.id;
  return true;
}

export function mountStage(player: Pick<Player, 'mountXp'>, mountId: string): number {
  return mountStageIndex(getMountById(mountId), player.mountXp[mountId] ?? 0);
}

/** The ridden (or any given) mount's current name/speed/perk, after evolution. */
export function mountProfile(player: Pick<Player, 'mountXp'>, mountId: string) {
  const def = getMountById(mountId);
  const stage = mountStage(player, mountId);
  return { def, stage, ...mountAtStage(def, stage) };
}

/** Progress toward the next evolution, or null at the final stage / for a mount that doesn't evolve. */
export function nextEvolution(player: Pick<Player, 'mountXp'>, mountId: string): { name: string; xp: number; needed: number } | null {
  const def = getMountById(mountId);
  if (!def.stages) return null;
  const next = def.stages[mountStage(player, mountId) + 1];
  if (!next) return null;
  return { name: next.name, xp: Math.floor(player.mountXp[mountId] ?? 0), needed: next.xp };
}

/** Grants mount XP to an evolving mount. Returns an evolution toast when this pushed it into a new stage. */
export function addMountXp(player: Pick<Player, 'mountXp'>, mountId: string, amount: number): string | null {
  const def = getMountById(mountId);
  if (!def.stages || amount <= 0) return null;
  const before = mountStageIndex(def, player.mountXp[mountId] ?? 0);
  const maxXp = def.stages[def.stages.length - 1].xp;
  player.mountXp[mountId] = Math.min(maxXp, (player.mountXp[mountId] ?? 0) + amount);
  const after = mountStageIndex(def, player.mountXp[mountId]);
  return after > before ? `${def.stages[before].name} evoluiu para ${def.stages[after].name}!` : null;
}

/** M key: on foot → equipped ground mount → equipped flying mount → on foot (skipping empty slots). */
export function nextMountInCycle(player: MountHolder): string | null {
  const order: Array<string | null> = [null, player.equippedMounts.terrestre ?? null, player.equippedMounts.voadora ?? null].filter(
    (id, i) => i === 0 || id !== null,
  );
  const current = order.indexOf(player.activeMountId);
  return order[(current + 1) % order.length];
}

/** Sanitizes a stored equipped-mounts record against what's unlocked. */
export function normalizeEquippedMounts(raw: unknown, unlocked: string[]): Partial<Record<MountKind, string>> {
  const result: Partial<Record<MountKind, string>> = {};
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  for (const kind of ['terrestre', 'voadora'] as MountKind[]) {
    const id = source[kind];
    if (typeof id === 'string' && unlocked.includes(id) && getMountById(id).kind === kind) result[kind] = id;
  }
  if (!result.terrestre && unlocked.includes(STARTER_MOUNT_ID)) result.terrestre = STARTER_MOUNT_ID;
  return result;
}

export function normalizeMountXp(raw: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return result;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && MOUNT_DEFINITIONS.some((m) => m.id === id)) result[id] = value;
  }
  return result;
}
