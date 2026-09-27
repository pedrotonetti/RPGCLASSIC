import type { StatusEffectType } from '../config/types';

/**
 * A real status-effect system layered on top of `CombatEngine`'s existing
 * damage/mitigation machinery (dodge/block/stagger — none of that is
 * reinvented here). Six effect types, each thematically tied to specific
 * skills (see `config/classes.ts`'s `inflicts` fields and this module's own
 * doc comments below), plus a combo layer (`systems/statusSynergies.ts`) that
 * turns two of these landing on the same target into a bonus effect (Fase 3
 * — PDF section 5, e.g. "Burn + Bleed = Ferida Aberta"):
 *
 *  - `bleed`: physical/bladed or corrupting damage-over-time.
 *  - `burn`: fire damage-over-time (mage's fire skills, a couple of
 *    fire-themed enemies, and one holy-fire ultimate).
 *  - `poison`: a slower, longer-lingering damage-over-time — a corrosive/
 *    venomous affliction distinct from bleed's "open wound" framing (see
 *    `giant_spider`'s own venom skill).
 *  - `slow`: a flat multiplier on how fast the affected side acts — enemy
 *    attack-timers and overworld chase speed for an afflicted monster, the
 *    player's own cooldown recovery for an afflicted player (see
 *    `CombatEngine.tick`) — ice-themed mage skills only, since no enemy in
 *    this build has an ice theme to reciprocate it (bleed/burn/poison all
 *    do, via `giant_spider`/`fire_elemental`/`young_dragon`/`boss_root_ooze`).
 *  - `freeze`: like `slow` but far more severe and much shorter — the
 *    afflicted side is nearly locked in place rather than merely slowed.
 *  - `stun`: the harshest of the three speed-affecting types — the same
 *    mechanism as `slow`/`freeze` (a 0 multiplier instead of a fractional
 *    one), so an enemy's action timer simply never counts down, and a
 *    stunned player's cooldowns never recover, while it's active. Never
 *    inflicted directly by a skill today — only ever a `statusSynergies.ts`
 *    combo payoff (e.g. "Estilhaçamento").
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
  /** DoT types only (`bleed`/`burn`/`poison`): flat damage applied on each tick. 0 for the speed-affecting types. */
  tickDamage: number;
  /** DoT types only: seconds between ticks. `Infinity` for a speed-affecting type (never ticks). */
  tickInterval: number;
  /** Countdown to the next tick. */
  tickTimer: number;
  /** `slow`/`freeze`/`stun` only: multiplier applied to the holder's action/movement speed (0 for `stun`). 1 for DoT types. */
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

/** Lower per-tick than bleed/burn, but ticks for longer overall — a lingering corrosive/venomous DoT rather than a sharp wound. */
const POISON_DURATION = 9;
const POISON_TICK_INTERVAL = 1.5;
const POISON_TICK_RATIO = 0.1;

const SLOW_DURATION = 4;
/** Afflicted side acts/moves at 55% of normal speed. */
const SLOW_MULTIPLIER = 0.55;

/** Short and severe — nearly locks the target in place, but wears off quickly (also see statusSynergies.ts's "Estilhaçamento": a hit landing on a frozen target shatters it and consumes this early). */
const FREEZE_DURATION = 2.5;
const FREEZE_MULTIPLIER = 0.12;

/** A pure speed-affecting effect, same shape as slow/freeze but a full stop — see this module's own doc comment on why nothing inflicts it directly. */
const STUN_DURATION = 1.5;

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
    case 'poison':
      return {
        type,
        remaining: POISON_DURATION,
        tickDamage: Math.max(1, Math.round(triggeringHitDamage * POISON_TICK_RATIO)),
        tickInterval: POISON_TICK_INTERVAL,
        tickTimer: POISON_TICK_INTERVAL,
        slowMult: 1,
      };
    case 'slow':
      return { type, remaining: SLOW_DURATION, tickDamage: 0, tickInterval: Infinity, tickTimer: Infinity, slowMult: SLOW_MULTIPLIER };
    case 'freeze':
      return { type, remaining: FREEZE_DURATION, tickDamage: 0, tickInterval: Infinity, tickTimer: Infinity, slowMult: FREEZE_MULTIPLIER };
    case 'stun':
      return { type, remaining: STUN_DURATION, tickDamage: 0, tickInterval: Infinity, tickTimer: Infinity, slowMult: 0 };
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

/** The combined speed multiplier (<1 while slowed/frozen/stunned, else 1) currently active on a holder — a `stun` (multiplier 0) freezes an enemy's action timer entirely and stops a player's cooldowns from recovering at all, the harshest of the three. */
export function statusSpeedMultiplier(holder: StatusEffectHolder): number {
  let mult = 1;
  for (const e of holder.statusEffects) if (e.type === 'slow' || e.type === 'freeze' || e.type === 'stun') mult *= e.slowMult;
  return mult;
}

export function hasStatusEffect(holder: StatusEffectHolder, type: StatusEffectType): boolean {
  return holder.statusEffects.some((e) => e.type === type);
}

/** The bare list of currently-active effect types — what VFX code needs to decide what to render, without caring about tick timing. */
export function activeStatusTypes(holder: StatusEffectHolder): StatusEffectType[] {
  return holder.statusEffects.map((e) => e.type);
}
