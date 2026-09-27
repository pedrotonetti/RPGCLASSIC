/**
 * A continuously-advancing in-game clock — the missing prerequisite the
 * PDF roadmap's Fase 4 checklist calls out for NPC schedules and (later)
 * time-gated dynamic events. Nothing like this existed before: the closest
 * thing was WorldStateSystem's `worldMoodFactor`, which reads
 * hope/corruption, not time — this is a genuinely separate axis (what hour
 * it is right now), not a rename of that. Pure data + pure functions only,
 * matching WorldStateSystem's own style: nothing here knows about Three.js,
 * the DOM, or the player's other stats.
 *
 * Time only advances while `OverworldScreen.update()` actually calls
 * `advanceGameClock` (see its own gate — the same one HP/MP regen already
 * uses), so pausing/menus/dialogue don't burn daylight. `dayProgress` is
 * persisted on `Player` so the hour-of-day survives a reload instead of
 * resetting to dawn every time.
 */

export interface GameClockState {
  /** 0..1, wrapping — a fraction of one full day/night cycle. 0 = midnight. */
  dayProgress: number;
}

/** One full day/night cycle every 12 real minutes of active play — noticeable within a normal session without racing past it in seconds. */
const DAY_LENGTH_SECONDS = 12 * 60;

/** Starts at ~7:00 — a fresh character's very first morning in Pedravale, not an arbitrary midnight. */
export function createInitialGameClock(): GameClockState {
  return { dayProgress: 7 / 24 };
}

export function advanceGameClock(state: GameClockState, dtSeconds: number): void {
  state.dayProgress = (state.dayProgress + dtSeconds / DAY_LENGTH_SECONDS) % 1;
}

/** 0..24 (exclusive), e.g. 6.5 = 06:30. */
export function hourOfDay(state: GameClockState): number {
  return state.dayProgress * 24;
}

/** "06:30" — HUD display (see OverworldScreen.refreshHud). */
export function formatTimeOfDay(state: GameClockState): string {
  const totalMinutes = Math.floor(hourOfDay(state) * 60);
  const h = Math.floor(totalMinutes / 60) % 24;
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 0 (deepest night) .. 1 (brightest midday) — a single smooth cosine wave
 * over the full day, peaking at 13:00 and troughing at 01:00. Deliberately
 * continuous (no dawn/dusk piecewise cutover) so anything driven by it
 * (ambient light, later an NPC schedule) transitions smoothly rather than
 * snapping at a fixed hour.
 */
export function dayNightFactor(state: GameClockState): number {
  const hour = hourOfDay(state);
  return 0.5 + 0.5 * Math.cos(((hour - 13) / 24) * Math.PI * 2);
}

/** Below this, a schedule/event can treat the world as "asleep" — see dayNightFactor's own doc comment for why this reads off a continuous curve instead of a fixed hour. */
export function isNight(state: GameClockState): boolean {
  return dayNightFactor(state) < 0.35;
}
