/**
 * Dynamic local events (roadmap section 16): the scheduler that decides when
 * a temporary happening starts in the zone the player is in, ticks it down,
 * and resolves it with a reward or a consequence. Pure data + pure functions
 * only (no Three.js, no DOM) — time, rng and the world's state are all
 * injected, so every decision here is unit-testable. What an event actually
 * looks like on screen (a monster band, a merchant, fog...) lives in
 * screens/OverworldEvents.ts; what each one is lives in data/worldEvents.ts.
 *
 * Only one event is active at a time. Its timer runs only while the player
 * is in its zone (a dungeon trip freezes it; walking into another open zone
 * abandons it — see onZoneEnter), so an event can never expire unseen.
 */
import { TileType, isWalkable } from '../config/tiles';
import { getWorldEventById, WORLD_EVENT_DEFINITIONS, type WorldEventConditions, type WorldEventDefinition, type WorldEventReward } from '../data/worldEvents';
import type { Player } from '../entities/Player';
import { applyChoiceEffect, type ChoiceEffect } from './ChoiceSystem';
import { incrementCounter, type WorldState } from './WorldStateSystem';

export interface TilePoint {
  x: number;
  y: number;
}

export interface ActiveWorldEvent {
  defId: string;
  zoneId: string;
  /** Seconds of in-zone play left. */
  remaining: number;
  /** Null for events with no location (weather). */
  tile: TilePoint | null;
}

export interface WorldEventState {
  active: ActiveWorldEvent | null;
  /** defId → seconds of play before that event can roll again. */
  cooldowns: Record<string, number>;
  /** Not persisted: seconds until the next start roll. */
  nextCheckIn: number;
}

/** The only part of the state that survives a reload. */
export type WorldEventSave = Pick<WorldEventState, 'active' | 'cooldowns'>;

/** Seconds between start rolls while nothing is active. */
export const EVENT_CHECK_INTERVAL = 45;
/** Quiet time after loading a save / after an event ends before the next roll. */
export const EVENT_GRACE_SECONDS = 60;
/** Chance a roll starts something = (sum of eligible weights) * this, capped below. */
export const EVENT_CHANCE_PER_WEIGHT = 0.04;
export const EVENT_MAX_START_CHANCE = 0.85;
/** Fade envelope (seconds) for anything that eases in/out with the event — see eventIntensity. */
export const EVENT_FADE_IN = 5;
export const EVENT_FADE_OUT = 8;

export function createInitialEventState(): WorldEventState {
  return { active: null, cooldowns: {}, nextCheckIn: EVENT_GRACE_SECONDS };
}

/** Rebuilds a runtime state from whatever a save held — absent (old save) or malformed data falls back to "nothing happening". */
export function restoreEventState(raw: unknown): WorldEventState {
  const state = createInitialEventState();
  if (!raw || typeof raw !== 'object') return state;
  const data = raw as Partial<WorldEventSave>;
  const cooldowns = data.cooldowns;
  if (cooldowns && typeof cooldowns === 'object') {
    for (const [id, secs] of Object.entries(cooldowns)) {
      if (typeof secs === 'number' && Number.isFinite(secs) && secs > 0 && getWorldEventById(id)) state.cooldowns[id] = secs;
    }
  }
  const a = data.active;
  if (a && typeof a === 'object' && typeof a.defId === 'string' && typeof a.zoneId === 'string' && getWorldEventById(a.defId)) {
    const def = getWorldEventById(a.defId)!;
    const remaining = typeof a.remaining === 'number' && Number.isFinite(a.remaining) ? Math.min(a.remaining, def.durationSeconds) : 0;
    const tile = a.tile && typeof a.tile.x === 'number' && typeof a.tile.y === 'number' ? { x: a.tile.x, y: a.tile.y } : null;
    // A located event whose spot was lost has nothing to show — drop it rather than resume a ghost.
    if (remaining > 0 && (def.placement === 'none' || tile)) state.active = { defId: a.defId, zoneId: a.zoneId, remaining, tile };
  }
  return state;
}

export function serializeEventState(state: WorldEventState): WorldEventSave {
  return {
    active: state.active ? { ...state.active, tile: state.active.tile ? { ...state.active.tile } : null } : null,
    cooldowns: { ...state.cooldowns },
  };
}

export interface EventContext {
  zoneId: string;
  worldState: Pick<WorldState, 'corruption' | 'hope'>;
  playerLevel: number;
  night: boolean;
}

function meetsConditions(c: WorldEventConditions, ctx: EventContext): boolean {
  const { corruption, hope } = ctx.worldState;
  if (c.minCorruption !== undefined && corruption < c.minCorruption) return false;
  if (c.maxCorruption !== undefined && corruption > c.maxCorruption) return false;
  if (c.minHope !== undefined && hope < c.minHope) return false;
  if (c.maxHope !== undefined && hope > c.maxHope) return false;
  if (c.minPlayerLevel !== undefined && ctx.playerLevel < c.minPlayerLevel) return false;
  if (c.maxPlayerLevel !== undefined && ctx.playerLevel > c.maxPlayerLevel) return false;
  if (c.time === 'night' && !ctx.night) return false;
  if (c.time === 'day' && ctx.night) return false;
  return true;
}

export function isEventEligible(def: WorldEventDefinition, ctx: EventContext, cooldowns: Record<string, number>): boolean {
  if (def.zoneIds && !def.zoneIds.includes(ctx.zoneId)) return false;
  if ((cooldowns[def.id] ?? 0) > 0) return false;
  return meetsConditions(def.conditions, ctx);
}

/** The def's base weight times every modifier that currently holds — the one place a world-state reading ("corruption > 70") turns into frequency. */
export function eventWeight(def: WorldEventDefinition, ctx: EventContext): number {
  let w = def.weight;
  for (const m of def.weightModifiers ?? []) {
    if (meetsConditions(m.when, ctx)) w *= m.multiplier;
  }
  return Math.max(0, w);
}

function eligibleCandidates(ctx: EventContext, cooldowns: Record<string, number>): Array<{ def: WorldEventDefinition; weight: number }> {
  const out: Array<{ def: WorldEventDefinition; weight: number }> = [];
  for (const def of WORLD_EVENT_DEFINITIONS) {
    if (!isEventEligible(def, ctx, cooldowns)) continue;
    const weight = eventWeight(def, ctx);
    if (weight > 0) out.push({ def, weight });
  }
  return out;
}

/** Probability that a start roll right now begins SOME event — rises with total eligible weight, so a corrupted world is simply busier. */
export function startChance(ctx: EventContext, cooldowns: Record<string, number>): number {
  return chanceOf(eligibleCandidates(ctx, cooldowns));
}

function chanceOf(candidates: Array<{ weight: number }>): number {
  return Math.min(EVENT_MAX_START_CHANCE, candidates.reduce((sum, c) => sum + c.weight, 0) * EVENT_CHANCE_PER_WEIGHT);
}

function weightedPick<T extends { weight: number }>(items: T[], rng: () => number): T {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

export type EventTransition =
  | { type: 'started'; event: ActiveWorldEvent; def: WorldEventDefinition }
  | { type: 'expired'; event: ActiveWorldEvent; def: WorldEventDefinition }
  | { type: 'abandoned'; event: ActiveWorldEvent; def: WorldEventDefinition };

export type EventEndTransition = Exclude<EventTransition, { type: 'started' }>;

export interface EventTickContext extends EventContext {
  /** False while no new event may begin here (a dungeon) — timers still run. */
  canStart: boolean;
  /** Supplied by the screen for 'near_player' events: a spot for this def, or null when the surroundings have none right now. */
  pickTile?: (def: WorldEventDefinition) => TilePoint | null;
}

/**
 * Advances every timer by `dt` seconds of active play and returns what
 * changed. Never touches the player — the caller applies consequences (see
 * applyEventConsequence) for 'expired'/'abandoned', and calls
 * completeActiveEvent when the player resolves it.
 */
export function tickEvents(state: WorldEventState, dt: number, ctx: EventTickContext, rng: () => number = Math.random): EventTransition[] {
  for (const id of Object.keys(state.cooldowns)) {
    state.cooldowns[id] -= dt;
    if (state.cooldowns[id] <= 0) delete state.cooldowns[id];
  }

  const active = state.active;
  if (active) {
    // Frozen while the player is elsewhere (e.g. inside a dungeon) — see the file header.
    if (active.zoneId !== ctx.zoneId) return [];
    active.remaining -= dt;
    if (active.remaining > 0) return [];
    const def = getWorldEventById(active.defId);
    state.active = null;
    state.nextCheckIn = Math.max(state.nextCheckIn, EVENT_GRACE_SECONDS);
    if (!def) return [];
    state.cooldowns[def.id] = def.cooldownSeconds;
    return [{ type: 'expired', event: active, def }];
  }

  if (!ctx.canStart) return [];
  state.nextCheckIn -= dt;
  if (state.nextCheckIn > 0) return [];
  state.nextCheckIn = EVENT_CHECK_INTERVAL;

  let candidates = eligibleCandidates(ctx, state.cooldowns);
  if (rng() >= chanceOf(candidates)) return [];

  while (candidates.length > 0) {
    const pick = weightedPick(candidates, rng);
    let tile: TilePoint | null = null;
    if (pick.def.placement === 'near_player') {
      tile = ctx.pickTile?.(pick.def) ?? null;
      if (!tile) {
        candidates = candidates.filter((c) => c !== pick);
        continue;
      }
    }
    state.active = { defId: pick.def.id, zoneId: ctx.zoneId, remaining: pick.def.durationSeconds, tile };
    return [{ type: 'started', event: state.active, def: pick.def }];
  }
  return [];
}

/**
 * Call when entering a zone (a screen mount). An active event bound to a
 * DIFFERENT open-world zone is abandoned — the world moved on without the
 * player; pass `isOpenZone: false` for a dungeon, which just freezes it.
 */
export function onZoneEnter(state: WorldEventState, zoneId: string, isOpenZone: boolean): EventEndTransition[] {
  const active = state.active;
  if (!active || !isOpenZone || active.zoneId === zoneId) return [];
  state.active = null;
  state.nextCheckIn = Math.max(state.nextCheckIn, EVENT_GRACE_SECONDS);
  const def = getWorldEventById(active.defId);
  if (!def) return [];
  state.cooldowns[def.id] = def.cooldownSeconds;
  return [{ type: 'abandoned', event: active, def }];
}

/** Concrete XP/gold this reward pays a character of `playerLevel`, plus the ChoiceEffect applyChoiceEffect should run (gold already folded in). */
export function resolveEventReward(reward: WorldEventReward, playerLevel: number): { xp: number; gold: number; effect: ChoiceEffect } {
  const { xp: baseXp, xpPerLevel, goldPerLevel, ...choice } = reward;
  const xp = Math.round((baseXp ?? 0) + (xpPerLevel ?? 0) * playerLevel);
  const gold = Math.round((choice.grantGold ?? 0) + (goldPerLevel ?? 0) * playerLevel);
  return { xp, gold, effect: { ...choice, grantGold: gold || undefined } };
}

export interface EventCompletion {
  def: WorldEventDefinition;
  xp: number;
  gold: number;
  levelsGained: number;
}

/** The player resolved the active event: pays its reward, starts its cooldown and clears it. Null if nothing is active (or it isn't `defId`). */
export function completeActiveEvent(state: WorldEventState, player: Player, defId?: string): EventCompletion | null {
  const active = state.active;
  if (!active || (defId !== undefined && active.defId !== defId)) return null;
  const def = getWorldEventById(active.defId);
  state.active = null;
  state.nextCheckIn = Math.max(state.nextCheckIn, EVENT_GRACE_SECONDS);
  if (!def) return null;
  state.cooldowns[def.id] = def.cooldownSeconds;
  incrementCounter(player.worldState, `evento_${def.id}_resolvido`);
  const { xp, gold, effect } = resolveEventReward(def.reward ?? {}, player.level);
  applyChoiceEffect(player, effect);
  const levelsGained = xp > 0 ? player.gainXp(xp) : 0;
  return { def, xp, gold, levelsGained };
}

/** What the world does to a player who let the event lapse (expired or abandoned). */
export function applyEventConsequence(player: Player, def: WorldEventDefinition): void {
  incrementCounter(player.worldState, `evento_${def.id}_ignorado`);
  if (def.consequence) applyChoiceEffect(player, def.consequence);
}

/** 0..1 ease-in over the first seconds and ease-out over the last — what weather-style visuals scale with. */
export function eventIntensity(def: WorldEventDefinition, remaining: number): number {
  const elapsed = def.durationSeconds - remaining;
  return Math.max(0, Math.min(1, elapsed / EVENT_FADE_IN, remaining / EVENT_FADE_OUT));
}

/** "4:05" */
export function formatEventTimeLeft(seconds: number): string {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A free grass tile between `minDist` and `maxDist` tiles (euclidean) from
 * `origin`, or null when the surroundings have none. Needs all four
 * neighbours walkable too, so an event never lands in a one-tile clearing.
 */
export function pickEventTile(
  tiles: TileType[][],
  origin: TilePoint,
  minDist: number,
  maxDist: number,
  opts: { avoid?: TileRect[]; isBlocked?: (x: number, y: number) => boolean } = {},
  rng: () => number = Math.random,
): TilePoint | null {
  const height = tiles.length;
  const width = tiles[0]?.length ?? 0;
  const avoid = opts.avoid ?? [];
  const open = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && isWalkable(tiles[y][x]) && !opts.isBlocked?.(x, y);
  const candidates: TilePoint[] = [];
  for (let y = Math.max(1, Math.floor(origin.y - maxDist)); y <= Math.min(height - 2, Math.ceil(origin.y + maxDist)); y++) {
    for (let x = Math.max(1, Math.floor(origin.x - maxDist)); x <= Math.min(width - 2, Math.ceil(origin.x + maxDist)); x++) {
      const d = Math.hypot(x - origin.x, y - origin.y);
      if (d < minDist || d > maxDist) continue;
      if (tiles[y][x] !== TileType.Grass || opts.isBlocked?.(x, y)) continue;
      if (avoid.some((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)) continue;
      if (!open(x - 1, y) || !open(x + 1, y) || !open(x, y - 1) || !open(x, y + 1)) continue;
      candidates.push({ x, y });
    }
  }
  if (candidates.length === 0) return null;
  return candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
}
