/**
 * The world's own persistent state — separate from the player's own stats/
 * inventory/quest progress (see `Player.ts`). Where those track "how strong
 * is the player", this tracks "what has the player's presence done to
 * Ipêra" — so returning to a place, or a story beat, can respond to more
 * than just character level. Pure data + pure functions only (no Three.js,
 * no DOM) — anything that turns these numbers into something on screen
 * (lighting, dialogue, spawns) lives in the systems/screens that read it.
 */

/** The four tracked axes, each clamped to 0..100 by every mutator below. */
export type WorldStateAxis = 'corruption' | 'hope' | 'trust' | 'natureBalance';

export interface WorldState {
  corruption: number;
  hope: number;
  trust: number;
  natureBalance: number;
  /** Named factions/groups (e.g. a village, a guild) → reputation, -100..100. Absent key reads as 0 (neutral) — see getFactionReputation. */
  factionReputation: Record<string, number>;
  /** One-off booleans a quest/event/dialogue can check later ("met the hermit", "chose to burn the grove"). */
  flags: Record<string, boolean>;
  /** Repeatable tallies ("corrupted creatures defeated") — unlike flags, these accumulate rather than just toggle. */
  counters: Record<string, number>;
  /** IDs of one-time world events already resolved, so they don't refire or re-offer their choice. */
  completedEvents: Record<string, true>;
  /** Per-zone state labels (e.g. a zone's id → 'corrupted' | 'restored') — deliberately just strings, not a fixed enum, so new zone states don't require touching this file. */
  zoneStates: Record<string, string>;
}

const AXIS_KEYS: WorldStateAxis[] = ['corruption', 'hope', 'trust', 'natureBalance'];

export function createInitialWorldState(): WorldState {
  return {
    corruption: 50,
    hope: 50,
    trust: 50,
    natureBalance: 50,
    factionReputation: {},
    flags: {},
    counters: {},
    completedEvents: {},
    zoneStates: {},
  };
}

function clampAxis(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Applies a delta to one or more axes at once, clamping each to 0..100. Every other mutator that touches an axis funnels through this so the clamp is never duplicated. */
export function adjustWorldState(state: WorldState, delta: Partial<Record<WorldStateAxis, number>>): void {
  for (const key of AXIS_KEYS) {
    const d = delta[key];
    if (d === undefined || d === 0) continue;
    state[key] = clampAxis(state[key] + d);
  }
}

export function setFlag(state: WorldState, key: string, value = true): void {
  state.flags[key] = value;
}

export function hasFlag(state: WorldState, key: string): boolean {
  return state.flags[key] === true;
}

export function incrementCounter(state: WorldState, key: string, amount = 1): number {
  const next = (state.counters[key] ?? 0) + amount;
  state.counters[key] = next;
  return next;
}

export function getCounter(state: WorldState, key: string): number {
  return state.counters[key] ?? 0;
}

export function adjustFactionReputation(state: WorldState, factionId: string, delta: number): number {
  const next = Math.max(-100, Math.min(100, Math.round((state.factionReputation[factionId] ?? 0) + delta)));
  state.factionReputation[factionId] = next;
  return next;
}

export function getFactionReputation(state: WorldState, factionId: string): number {
  return state.factionReputation[factionId] ?? 0;
}

export function markEventCompleted(state: WorldState, eventId: string): void {
  state.completedEvents[eventId] = true;
}

export function hasCompletedEvent(state: WorldState, eventId: string): boolean {
  return state.completedEvents[eventId] === true;
}

export function setZoneState(state: WorldState, zoneId: string, zoneStateKey: string): void {
  state.zoneStates[zoneId] = zoneStateKey;
}

export function getZoneState(state: WorldState, zoneId: string): string | null {
  return state.zoneStates[zoneId] ?? null;
}

/**
 * A single 0..1 "how does the world feel right now" reading, derived from
 * hope vs. corruption (trust/natureBalance don't drive it — they're their
 * own separate axes for dialogue/reputation logic to read directly, not
 * folded into "mood"). 0 = as dark/oppressive as Ipêra's baseline corrupted
 * state; 1 = fully hopeful/restored. Consumed by render code (ambient
 * light intensity, vignette darkness — see Game.ts/OverworldScreen.ts) so
 * the world visibly brightens as the player pushes hope up and corruption
 * down, instead of the player's own growing strength being the only thing
 * that changes session to session.
 */
export function worldMoodFactor(state: WorldState): number {
  const net = state.hope - state.corruption; // -100..100
  return clamp01(0.5 + net / 200);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
