import type { StatusEffectType } from '../config/types';

/**
 * A real status-effect system layered on top of `CombatEngine`'s existing
 * damage/mitigation machinery (dodge/block/stagger — none of that is
 * reinvented here). Three effect types, each thematically tied to specific
 * skills (see `config/classes.ts`'s `inflicts` fields and this module's own
 * doc comments below):
 *
 *  - `bleed`: physical/bladed or corrupting damage-over-time.
 *  - `burn`: fire damage-over-time (mage's fire skills, a couple of
 *    fire-themed enemies, and one holy-fire ultimate).
 *  - `slow`: a flat multiplier on how fast the affected side acts — enemy
 *    attack-timers and overworld chase speed for an afflicted monster, the
 *    player's own cooldown recovery for an afflicted player (see
 *    `CombatEngine.tick`) — ice-themed mage skills only, since no enemy in
 *    this build has an ice theme to reciprocate it (bleed/burn both do, via
 *    `giant_spider`/`fire_elemental`/`young_dragon`/`boss_root_ooze`).
 *
 * Stacking rule (deliberately simple, per the task's own guidance): applying
 * an effect that's already active REFRESHES its duration and re-rolls its
 * tick damage/slow strength off the new hit — it never stacks multiple
 * instances of the same type on one target.
 */

export interface ActiveStatusEffect {
  type: StatusEffectType;
  /** Seconds remaining before this effect falls off entirely. */
  remaining: number;
  /** DoT types only (`bleed`/`burn`): flat damage applied on each tick. 0 for `slow`. */
  tickDamage: number;
  /** DoT types only: seconds between ticks. `Infinity` for `slow` (never ticks). */
  tickInterval: number;
  /** Countdown to the next tick. */
  tickTimer: number;
  /** `slow` only: multiplier (<1) applied to the holder's action/movement speed. 1 for DoT types. */
  slowMult: number;
}

export interface StatusEffectHolder {
  statusEffects: ActiveStatusEffect[];
}

const BLEED_DURATION = 6;
const BLEED_TICK_INTERVAL = 1;
/** Each tick deals this fraction of the hit that inflicted it. */
const BLEED_TICK_RATIO = 0.12;

const BURN_DURATION = 5;
const BURN_TICK_INTERVAL = 1;
const BURN_TICK_RATIO = 0.16;

const SLOW_DURATION = 4;
/** Afflicted side acts/moves at 55% of normal speed. */
const SLOW_MULTIPLIER = 0.55;

function buildEffect(type: StatusEffectType, triggeringHitDamage: number): ActiveStatusEffect {
  switch (type) {
    case 'bleed':
      return {
        type,
        remaining: BLEED_DURATION,
        tickDamage: Math.max(1, Math.round(triggeringHitDamage * BLEED_TICK_RATIO)),
        tickInterval: BLEED_TICK_INTERVAL,
        tickTimer: BLEED_TICK_INTERVAL,
        slowMult: 1,
      };
    case 'burn':
      return {
        type,
        remaining: BURN_DURATION,
        tickDamage: Math.max(1, Math.round(triggeringHitDamage * BURN_TICK_RATIO)),
        tickInterval: BURN_TICK_INTERVAL,
        tickTimer: BURN_TICK_INTERVAL,
        slowMult: 1,
      };
    case 'slow':
      return { type, remaining: SLOW_DURATION, tickDamage: 0, tickInterval: Infinity, tickTimer: Infinity, slowMult: SLOW_MULTIPLIER };
  }
}

/** Applies (or refreshes) one status effect on a holder — see the module doc comment for the refresh-not-stack rule. */
export function applyStatusEffect(holder: StatusEffectHolder, type: StatusEffectType, triggeringHitDamage: number): void {
  const fresh = buildEffect(type, triggeringHitDamage);
  const existing = holder.statusEffects.find((e) => e.type === type);
  if (existing) {
    existing.remaining = fresh.remaining;
    existing.tickDamage = fresh.tickDamage;
    existing.slowMult = fresh.slowMult;
    // tickTimer/tickInterval intentionally left alone: a refresh shouldn't
    // delay a tick that was already about to fire.
  } else {
    holder.statusEffects.push(fresh);
  }
}

export interface StatusTickResult {
  /** Total DoT damage to apply this frame, summed across every ticking effect. */
  damage: number;
  /** Which effect types actually ticked this frame (for event/VFX purposes). */
  ticked: StatusEffectType[];
  /** Which effect types just expired this frame. */
  expired: StatusEffectType[];
}

/** Advances every active effect on one holder by `dt`. Mutates `holder.statusEffects` in place (drops expired entries). */
export function tickStatusEffects(holder: StatusEffectHolder, dt: number): StatusTickResult {
  const result: StatusTickResult = { damage: 0, ticked: [], expired: [] };
  for (const effect of holder.statusEffects) {
    effect.remaining -= dt;
    if (Number.isFinite(effect.tickInterval)) {
      effect.tickTimer -= dt;
      // A loop, not a single `if`: a large enough `dt` (a slow frame, or a
      // test advancing the clock by several seconds at once) can cross more
      // than one tick interval in a single call — each one still counts.
      while (effect.tickTimer <= 0) {
        effect.tickTimer += effect.tickInterval;
        result.damage += effect.tickDamage;
        result.ticked.push(effect.type);
      }
    }
  }
  result.expired = holder.statusEffects.filter((e) => e.remaining <= 0).map((e) => e.type);
  if (result.expired.length > 0) {
    holder.statusEffects = holder.statusEffects.filter((e) => e.remaining > 0);
  }
  return result;
}

/** The combined speed multiplier (<1 while slowed, else 1) currently active on a holder. */
export function statusSpeedMultiplier(holder: StatusEffectHolder): number {
  let mult = 1;
  for (const e of holder.statusEffects) if (e.type === 'slow') mult *= e.slowMult;
  return mult;
}

export function hasStatusEffect(holder: StatusEffectHolder, type: StatusEffectType): boolean {
  return holder.statusEffects.some((e) => e.type === type);
}

/** The bare list of currently-active effect types — what VFX code needs to decide what to render, without caring about tick timing. */
export function activeStatusTypes(holder: StatusEffectHolder): StatusEffectType[] {
  return holder.statusEffects.map((e) => e.type);
}
