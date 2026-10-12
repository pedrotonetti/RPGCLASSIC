import { RARITY_LABEL, RARITY_ORDER } from '../config/rarity';
import type { EquipmentInstance, ItemRarity } from '../config/types';
import type { ItemModifiers } from '../data/affixes';
import { createStarterItem, generateLoot } from '../data/equipment';
import { getDungeonBossDefinition, type DungeonDefinition } from '../data/dungeons';
import type { Player } from '../entities/Player';
import { combineDungeonModifiers, seededRng, type DungeonRunPlan } from './DungeonModifierSystem';
import { formatClearTime, recordDungeonClear } from './DungeonRecordSystem';
import { ELITE_REWARD_BONUS, rollDungeonRooms, type DungeonRoomPlan } from './DungeonRoomSystem';
import { dungeonTierRewardMultiplier, dungeonTierRewardRarity, dungeonTierStatMultiplier } from './DungeonTierSystem';
import { incrementCounter } from './WorldStateSystem';

/**
 * Pure, THREE.js-free bookkeeping for one dungeon visit — kept separate from
 * `OverworldCombat`'s three.js/DOM-heavy monster AI so encounter progression
 * and the boss-completion payoff stay unit-testable in isolation (see
 * `DungeonSystem.test.ts`). `OverworldScreen`/`OverworldCombat` own the
 * actual monster spawning and call into this module at the right hooks
 * (a fixed encounter's last monster dying, the boss dying).
 */
export interface DungeonRunState {
  dungeonId: string;
  clearedEncounters: number;
  totalEncounters: number;
  bossDefeated: boolean;
  /** Which repeatable tier this run was entered at (see DungeonTierSystem) — 1 for a first-time clear or any run entered without picking a higher one. */
  tier: number;
  /** Dungeons 2.0: active Distorções (ids from data/dungeonModifiers.ts) — empty for a run started without a plan (legacy callers/tests). */
  modifierIds: string[];
  /** Which of `modifierIds` is the Distorção do dia (pays a little extra), if any. */
  featuredModifierId: string | null;
  /** One entry per `DungeonDefinition.encounters` index: what that room is this run (see DungeonRoomSystem). All 'combat' without a plan. */
  rooms: DungeonRoomPlan[];
  /** Room indices already cleared (pod defeated) or resolved (shrine/trap choice made) — guards against counting one room twice. */
  resolvedRooms: number[];
  elitesCleared: number;
  /** Run-long bonuses taken at shrines/altars, summed — applied on top of the Distorções' own player mods. */
  blessings: Partial<ItemModifiers>;
}

/**
 * Starts tracking a fresh run of `dungeon` at the given tier (1 by default —
 * a first-time clear, or a tier-1 replay) — call once per zone mount. With a
 * `plan` (see DungeonModifierSystem.planDungeonRun) the run also carries its
 * Distorções and a seeded room layout; without one every room is a plain
 * ambush and nothing extra applies, exactly as before Dungeons 2.0.
 */
export function startDungeonRun(dungeon: DungeonDefinition, tier = 1, plan?: DungeonRunPlan): DungeonRunState {
  const count = dungeon.encounters.length;
  const extraElites = plan ? combineDungeonModifiers(plan.modifierIds).extraElites : 0;
  const rooms = plan
    ? rollDungeonRooms(count, seededRng(plan.seed ^ 0x2f6b9a1d), extraElites)
    : Array.from({ length: count }, (): DungeonRoomPlan => ({ kind: 'combat' }));
  return {
    dungeonId: dungeon.id,
    clearedEncounters: 0,
    totalEncounters: count,
    bossDefeated: false,
    tier: Math.max(1, Math.round(tier)),
    modifierIds: plan ? [...plan.modifierIds] : [],
    featuredModifierId: plan && plan.modifierIds.includes(plan.featuredId) ? plan.featuredId : null,
    rooms,
    resolvedRooms: [],
    elitesCleared: 0,
    blessings: {},
  };
}

/**
 * Call once every time a fixed encounter pod is fully defeated, or a
 * shrine/trap room is resolved. Pass the room `index` whenever known: the
 * same index is then never counted twice, and an elite room bumps
 * `elitesCleared`. Returns a new state — never mutates the input.
 */
export function recordEncounterCleared(state: DungeonRunState, index?: number): DungeonRunState {
  if (index !== undefined && state.resolvedRooms.includes(index)) return state;
  const elite = index !== undefined && state.rooms[index]?.kind === 'elite';
  return {
    ...state,
    clearedEncounters: Math.min(state.totalEncounters, state.clearedEncounters + 1),
    resolvedRooms: index !== undefined ? [...state.resolvedRooms, index] : state.resolvedRooms,
    elitesCleared: state.elitesCleared + (elite ? 1 : 0),
  };
}

/** Adds a shrine/altar blessing for the rest of the run. Returns a new state. */
export function addRunBlessing(state: DungeonRunState, blessing: Partial<ItemModifiers>): DungeonRunState {
  const blessings = { ...state.blessings };
  for (const [key, value] of Object.entries(blessing) as Array<[keyof ItemModifiers, number]>) {
    blessings[key] = (blessings[key] ?? 0) + value;
  }
  return { ...state, blessings };
}

/** Everything the run adds to the player's own modifiers right now: the Distorções' player-side effects plus any blessings. */
export function runPlayerModifiers(state: DungeonRunState): Partial<ItemModifiers> {
  const mods = { ...combineDungeonModifiers(state.modifierIds).playerMods };
  for (const [key, value] of Object.entries(state.blessings) as Array<[keyof ItemModifiers, number]>) {
    mods[key] = (mods[key] ?? 0) + value;
  }
  return mods;
}

/** The run's total reward bonus: its Distorções (+ the daily featured bonus) plus every elite room cleared so far. */
export function runRewardBonus(state: DungeonRunState): number {
  const fromModifiers = combineDungeonModifiers(state.modifierIds, state.featuredModifierId ?? undefined).rewardBonus;
  return Math.round((fromModifiers + state.elitesCleared * ELITE_REWARD_BONUS) * 1000) / 1000;
}

/**
 * The end-of-run Baú da Distorção's guaranteed minimum rarity: Raro (azul) at
 * tier 1-2, Épico at 3-4, Lendário at 5, one rung higher for a heavily
 * distorted run (reward bonus of 50%+), capped at Mítico. It's a FLOOR passed
 * to `generateLoot` — the roll can still land higher, and the loot pity
 * floor still wins if it's even higher.
 */
export function chestRarityFloor(tier: number, rewardBonus: number): ItemRarity {
  const t = Math.max(1, Math.round(tier));
  const index = 1 + Math.floor((t - 1) / 2) + (rewardBonus >= 0.5 ? 1 : 0);
  return RARITY_ORDER[Math.min(RARITY_ORDER.length - 1, index)];
}

/** Short "2/3 emboscadas" style text for the HUD — appends the run's tier only when it's above 1, so a first-time (tier-1) run's HUD text is byte-for-byte unchanged. */
export function encounterProgressText(state: DungeonRunState): string {
  const base = `Emboscadas: ${state.clearedEncounters}/${state.totalEncounters}`;
  return state.tier > 1 ? `${base} · Tier ${state.tier}` : base;
}

export interface DungeonCompletionReward {
  bonusGold: number;
  itemGranted: boolean;
  message: string;
  /** Which tier this clear paid out at (see DungeonTierSystem) — 1 for an ordinary/first-time clear. */
  tier: number;
  /** Reward bonus from Distorções + elites (0 for a run without a plan). */
  rewardBonus: number;
  /** The Baú da Distorção's item — only for a run with at least one Distorção; null when there was none or the bag was full. */
  chestItem: EquipmentInstance | null;
  /** True when this clear set the dungeon's fastest-run record. */
  newFastest: boolean;
}

export interface CompleteDungeonOptions {
  /** Game-time seconds the run took (see DungeonRunLayer) — omitted = not timed (no speed record). */
  elapsedSeconds?: number;
  /** Injected RNG for the chest roll (tests). */
  rng?: () => number;
}

/**
 * Grants the dungeon-clear bonus (guaranteed gold + a guaranteed equipment
 * piece) ON TOP OF whatever the boss's own `EnemyDefinition.xpReward`/
 * `goldReward` already paid out through the normal combat-victory path
 * (`CombatSystem.checkVictory`, exactly like any wandering monster) — this
 * is the extra "cleared the instance" payoff the design brief asks for.
 * Both the bonus gold and the reward item's rarity scale up with
 * `state.tier` (see DungeonTierSystem) — at tier 1 (a first-time clear, or
 * an ordinary tier-1 replay) the multiplier is exactly 1 and the rarity is
 * exactly `dungeon.rewardItem.rarity`, so this is byte-for-byte the same
 * payout a fresh clear always granted. Also records this dungeon's new
 * best-cleared tier on `player.dungeonTiers` (never lowering it), which is
 * what unlocks the next tier's entry at the portal and what RankingScreen's
 * "highest tier cleared" readout shows.
 *
 * Dungeons 2.0 on top of that: the bonus gold is multiplied by
 * (1 + runRewardBonus), a run with any Distorção also drops the Baú da
 * Distorção (a rolled item with a guaranteed rarity floor — see
 * chestRarityFloor), and every clear updates `player.dungeonRecords` (clear
 * count, fastest time when `opts.elapsedSeconds` is given) plus a few
 * `worldState` counters the achievements read. A run started without a plan
 * has no Distorções and no elites, so it pays exactly what it always did.
 *
 * Mutates `player` (gold + bag + dungeonTiers + dungeonRecords); returns the
 * new run state (`bossDefeated: true`) alongside a small summary for the
 * completion banner/overlay. Safe to call only once per run — callers gate
 * on `!state.bossDefeated` (see OverworldCombat's kill hook) so a boss that
 * somehow dies twice in one run (it shouldn't — see `noRespawn`) can't
 * double-grant.
 */
export function completeDungeon(
  player: Player,
  dungeon: DungeonDefinition,
  state: DungeonRunState,
  opts: CompleteDungeonOptions = {},
): { state: DungeonRunState; reward: DungeonCompletionReward } {
  const tier = state.tier;
  const rewardBonus = runRewardBonus(state);
  const bonusGold = Math.round(dungeon.bonusGold * dungeonTierRewardMultiplier(tier) * (1 + rewardBonus));
  player.gold += bonusGold;
  const rarity = dungeonTierRewardRarity(dungeon.rewardItem.rarity, tier);
  const itemGranted = player.addLoot(createStarterItem(dungeon.rewardItem.templateId, rarity, Math.max(1, player.level)));
  player.dungeonTiers[dungeon.id] = Math.max(player.dungeonTiers[dungeon.id] ?? 0, tier);

  // Baú da Distorção — the payoff for accepting a distorted run. Goes through
  // generateLoot WITH the player's pity counters, so it both honors and feeds
  // LootPity like any other real drop; its floor only ever raises the roll.
  let chestItem: EquipmentInstance | null = null;
  const modifierCount = state.modifierIds.length;
  if (modifierCount > 0) {
    const bossLevel = Math.round(getDungeonBossDefinition(dungeon).level * dungeonTierStatMultiplier(tier));
    const loot = generateLoot(bossLevel, player.level, player.stats.luck + rewardBonus * 10, {
      pity: player.lootPity,
      minRarity: chestRarityFloor(tier, rewardBonus),
      rng: opts.rng,
    });
    if (player.addLoot(loot)) chestItem = loot;
    incrementCounter(player.worldState, 'dungeon_distorted_clears');
    if (modifierCount >= 3) incrementCounter(player.worldState, 'dungeon_three_distortion_clears');
  }
  if (state.elitesCleared > 0) incrementCounter(player.worldState, 'dungeon_elites_slain', state.elitesCleared);

  const { newFastest } = recordDungeonClear(player.dungeonRecords, dungeon.id, { tier, seconds: opts.elapsedSeconds, modifierCount });

  const tierSuffix = tier > 1 ? ` (Tier ${tier})` : '';
  let message = `${dungeon.name}${tierSuffix} concluída! +${bonusGold} ouro bônus${itemGranted ? ', item garantido recebido' : ' (mochila cheia — item perdido)'}.`;
  if (modifierCount > 0) {
    message += chestItem ? ` Baú da Distorção: item ${RARITY_LABEL[chestItem.rarity]}!` : ' Baú da Distorção perdido (mochila cheia).';
  }
  if (newFastest && opts.elapsedSeconds !== undefined) message += ` Novo recorde: ${formatClearTime(opts.elapsedSeconds)}!`;
  return { state: { ...state, bossDefeated: true }, reward: { bonusGold, itemGranted, message, tier, rewardBonus, chestItem, newFastest } };
}
