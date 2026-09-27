import type { StatusEffectType } from '../config/types';
import { hasStatusEffect, type StatusEffectHolder } from './statusEffects';

/**
 * Fase 3 — "Combate 2.0: interações entre status" (PDF section 5): a small,
 * data-driven table of which two `StatusEffectType`s combine into a bonus
 * payoff, checked at the exact two points a NEW status is about to land on a
 * target (`CombatSystem`'s `landPlayerHit`/`resolveEnemyAttack`) — nothing
 * about `statusEffects.ts`'s own tick/apply/expire machinery changes; a
 * synergy is purely something the caller layers on top once it fires.
 *
 * The PDF's own four examples, adapted to this game's real status roster
 * (bleed/burn/slow/poison/freeze/stun — no "Impact"/"Lightning" damage tag
 * exists here, so those two are read as "a hit lands" and "immobilized by
 * cold", respectively, both of which this roster already expresses):
 *  - Burn + Bleed = Ferida Aberta
 *  - Poison + Burn = Combustão Tóxica (the PDF's "Poison + Fire" — burn IS
 *    this game's fire-damage-over-time, so no separate "fire" tag is needed)
 *  - Slow + Poison = Paralisia Tóxica (the PDF's "Slow + Lightning" — no
 *    lightning-tagged hit exists in this build, so paired with poison
 *    instead: a toxin potent enough to lock up already-slowed muscles)
 *  - Freeze + (any subsequent landed hit) = Estilhaçamento (the PDF's
 *    "Freeze + Impact" — see `checkFreezeShatter`, checked separately since
 *    it isn't gated on a NEW status being inflicted at all)
 */

export interface StatusSynergyResult {
  /** Shown in the bonus-damage event's own text (e.g. "Ferida Aberta!"). */
  label: string;
  /** The bonus hit's damage, as a fraction of the triggering hit's own damage. */
  bonusDamageFraction: number;
  /** The pre-existing effect this synergy burns off the target (never the newly-landing one, which still applies normally right after). */
  consumes: StatusEffectType;
  /** Whether this synergy's payoff also inflicts a fresh `stun` (see statusEffects.ts) — only if the bonus hit doesn't finish the target off. */
  inflictsStun: boolean;
}

interface SynergyRule {
  incoming: StatusEffectType;
  existing: StatusEffectType;
  label: string;
  bonusDamageFraction: number;
  inflictsStun: boolean;
}

/** Each real-world pairing listed both ways round, since either status could land first. */
const SYNERGY_RULES: SynergyRule[] = [
  { incoming: 'burn', existing: 'bleed', label: 'Ferida Aberta', bonusDamageFraction: 0.4, inflictsStun: false },
  { incoming: 'bleed', existing: 'burn', label: 'Ferida Aberta', bonusDamageFraction: 0.4, inflictsStun: false },
  { incoming: 'poison', existing: 'burn', label: 'Combustão Tóxica', bonusDamageFraction: 0.5, inflictsStun: false },
  { incoming: 'burn', existing: 'poison', label: 'Combustão Tóxica', bonusDamageFraction: 0.5, inflictsStun: false },
  { incoming: 'poison', existing: 'slow', label: 'Paralisia Tóxica', bonusDamageFraction: 0.25, inflictsStun: true },
  { incoming: 'slow', existing: 'poison', label: 'Paralisia Tóxica', bonusDamageFraction: 0.25, inflictsStun: true },
];

const FREEZE_SHATTER: Omit<SynergyRule, 'incoming' | 'existing'> = { label: 'Estilhaçamento', bonusDamageFraction: 0.6, inflictsStun: true };

/**
 * Checked right BEFORE a new status effect (`incomingType`) is actually
 * applied to `holder` — does it complete a known combo with something the
 * target already carries? Only ever fires off the PRE-EXISTING effect (the
 * one about to land still applies normally afterward, via the caller's own
 * `applyStatusEffect`), so a synergy never blocks its own trigger from
 * landing — it just adds a bonus on top.
 */
export function checkStatusSynergy(holder: StatusEffectHolder, incomingType: StatusEffectType): StatusSynergyResult | null {
  for (const rule of SYNERGY_RULES) {
    if (rule.incoming === incomingType && hasStatusEffect(holder, rule.existing)) {
      return { label: rule.label, bonusDamageFraction: rule.bonusDamageFraction, consumes: rule.existing, inflictsStun: rule.inflictsStun };
    }
  }
  return null;
}

/**
 * "Estilhaçamento": ANY hit that lands on an already-frozen target shatters
 * it — checked on every landed hit, independent of whether that hit also
 * tries to inflict some new status of its own (unlike `checkStatusSynergy`,
 * which only fires alongside a matching new inflict). Checked with the
 * target's status list from BEFORE this hit's own inflict roll, so the very
 * hit that first applies `freeze` can never shatter it on the spot — only a
 * later, separate hit (while freeze is still active) can.
 */
export function checkFreezeShatter(holder: StatusEffectHolder): StatusSynergyResult | null {
  if (!hasStatusEffect(holder, 'freeze')) return null;
  return { ...FREEZE_SHATTER, consumes: 'freeze' };
}
