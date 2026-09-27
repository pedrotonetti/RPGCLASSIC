import type { BossPhaseDefinition, SkillDefinition } from '../config/types';

/**
 * Fase 3 — "Bosses cinemáticos e multifase" (PDF section 7): pure logic for
 * a scripted boss fight's phase progression, consumed by `CombatEngine`
 * (which owns the one piece of mutable state this needs — `Enemy.phaseIndex`
 * — exactly like it already owns `currentHp`/`actionTimer`) and by
 * `Enemy.skills`'s own getter (see entities/Enemy.ts).
 *
 * A boss with no `EnemyDefinition.phases` at all behaves exactly as before
 * this module existed: one flat skill pool, no transitions, no multiplier —
 * every function here is a no-op for that enemy (`phases` is optional
 * precisely so a regular monster, or a boss nobody's scripted yet, needs no
 * changes anywhere else).
 *
 * Deliberately out of scope for this batch (see the PDF's own section 7
 * wishlist): a changed arena/lighting per phase, and a phase-specific
 * thematic reward — both need hooks (scene dressing, loot tables) this
 * batch doesn't touch. What IS real here: an opening state, later phases
 * reached by HP threshold with a one-time narrative beat, a full pattern
 * change (an optional new skill pool), and a final-phase enrage (just a
 * damage/speed multiplier on that last entry — no separate "enrage" code
 * path, it's the same mechanism as every other phase).
 */

/**
 * Which phase index is active at `hpFraction` — the one with the SMALLEST
 * `hpThreshold` that hpFraction has still crossed (i.e. the deepest phase
 * reached), so a single big hit that skips straight past an intermediate
 * threshold still lands on the right (not just the next) phase. Index 0
 * (the opening phase) needs no `hpThreshold` and is the fallback when none
 * of `phases[1:]`'s thresholds have been crossed yet.
 */
export function phaseIndexForHp(phases: BossPhaseDefinition[] | undefined, hpFraction: number): number {
  if (!phases || phases.length === 0) return 0;
  let best = 0;
  let bestThreshold = Infinity;
  for (let i = 1; i < phases.length; i++) {
    const threshold = phases[i].hpThreshold;
    if (threshold === undefined) continue; // malformed data — a real phase past index 0 always sets one
    if (hpFraction <= threshold && threshold < bestThreshold) {
      best = i;
      bestThreshold = threshold;
    }
  }
  return best;
}

/** `phases[phaseIndex]`'s own skill pool if it overrides one, else `baseSkills` unchanged — the one rule for "a phase with no `skills` field keeps the boss's base pool", centralized so every caller applies it identically. */
export function effectiveSkillsForPhase(baseSkills: SkillDefinition[], phases: BossPhaseDefinition[] | undefined, phaseIndex: number): SkillDefinition[] {
  return phases?.[phaseIndex]?.skills ?? baseSkills;
}

/** 1 normally; `phases[phaseIndex].damageMult` when that phase sets one. */
export function phaseDamageMultiplier(phases: BossPhaseDefinition[] | undefined, phaseIndex: number): number {
  return phases?.[phaseIndex]?.damageMult ?? 1;
}

/** 1 normally; `phases[phaseIndex].actionIntervalMult` when that phase sets one (below 1 acts faster). */
export function phaseActionIntervalMultiplier(phases: BossPhaseDefinition[] | undefined, phaseIndex: number): number {
  return phases?.[phaseIndex]?.actionIntervalMult ?? 1;
}
