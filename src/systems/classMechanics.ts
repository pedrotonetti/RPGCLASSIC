import type { SkillKind, SkillTarget } from '../config/types';

/**
 * Phase 2 ("Identidade") class mechanics — every tuning number and pure rule
 * behind each `ClassMechanicDefinition.id` (the player-facing name and
 * explanation live in `config/classes.ts`). `CombatEngine` owns the actual
 * state — a single battle-scoped `classMeter` number, created with the
 * engine and discarded with it, exactly like `comboCount` — and calls into
 * this module from its existing hook points (a landed attack, a heal/buff
 * cast, an enemy hit resolving against block/dodge, a `defeated` event).
 * Nothing here touches the DOM or Three.js, and nothing is ever saved: a
 * meter always starts empty and can't be banked from an easy fight into a
 * hard one.
 *
 * PACING — why these numbers. Per `config/balance.ts`'s measured sim, a
 * same-level trash mob dies in ~2.5-4s (roughly 3-6 player actions: the
 * basic attack cools down in 1.1s, skills in 3-8s), a pair in about twice
 * that, and enemies swing every ~2.2-3.8s. So a "real" fight — a pair or a
 * pack, the dungeons' standard pod — is ~8-12 player actions and ~4-8
 * enemy swings. Every meter below is sized to fill about ONCE in such a
 * fight, never in 1-2 actions: an earned payoff, not a rotation button. The
 * three spend abilities also never feed their own meter (a Dreno das Almas
 * that kills doesn't refill Almas, etc.), so a spend can't chain into
 * another.
 */

export const CLASS_METER_MAX = 100;

// --- Guerreiro: Fúria ---------------------------------------------------
// Fed by both halves of the warrior's kit: pressing the attack AND holding
// the line. Pure offense fills it in 10 connected actions; a normal fight's
// mix of hits, a couple of blocks and a hit or two taken gets there in ~6-8.

/** Per player action that connected with at least one target — an AoE (Fúria Implacável) counts once, so it isn't a free triple fill. */
export const FURY_PER_HIT = 10;
/** Per enemy hit caught by a normal (partial-mitigation) block. */
export const FURY_PER_BLOCK = 15;
/** Per perfect block — the harder timing earns noticeably more. */
export const FURY_PER_PERFECT_BLOCK = 25;
/** Per enemy hit taken fully unmitigated. Bleed/burn ticks on the player don't count — a 6-tick bleed would otherwise be a +60 windfall for doing nothing. */
export const FURY_PER_DAMAGE_TAKEN = 10;
/**
 * Golpe Selvagem's power (vs. attack, same scale as `SkillDefinition.basePower`):
 * Golpe Poderoso is 1.6 and the level-20 ultimate Golpe do Titã 4.0, so this
 * lands at "nearly two Golpes Poderosos" — big, but once per fight. It never
 * misses: a whole fight's worth of Fúria shouldn't vanish on a 5% roll.
 */
export const SAVAGE_STRIKE_POWER = 3.0;

// --- Arqueiro: Precisão -------------------------------------------------
// Passive: no spend. Five clean actions fill it; ANY miss (even one arrow of
// a volley) empties it. An archer's own miss chance sits at the 2-4% floor
// against most enemies (high luck), so in practice it ramps up over the
// first few shots of each fight and the rare miss is a real setback.

/** Per player action where every target was hit (no miss at all). */
export const PRECISION_PER_HIT = 20;
/**
 * Extra crit chance at a full meter, scaling linearly with it. Added ON TOP
 * of the normal 50% crit-chance cap (otherwise a mid-level archer, whose luck
 * alone reaches that cap around level 13, would gain nothing), so the hard
 * ceiling is 75%. With the 1.6x crit multiplier, a full meter is worth about
 * +15% expected damage — half of what a maxed combo (+30%) already gives.
 */
export const PRECISION_MAX_CRIT_BONUS = 0.25;

// --- Clérigo: Fé --------------------------------------------------------
// Fed by the cleric actually doing its job — healing and blessing — plus
// blocking. Levels 1-9 have exactly one heal/buff (Cura: 6s cooldown, 10 MP),
// so filling it takes ~3 casts, or 2 casts and a few blocks: it only shows up
// in the long, hard fights where the cleric is really healing, which is
// exactly when a free cleanse-and-heal matters.

/** Per heal or buff skill cast (the MP cost and cooldown are what gate it — casting at full HP still counts). */
export const FAITH_PER_CAST = 35;
/** Per enemy hit caught by a normal block — gives a caster something to build between Cura cooldowns. */
export const FAITH_PER_BLOCK = 10;
/** Per perfect block. */
export const FAITH_PER_PERFECT_BLOCK = 20;
/**
 * Milagre da Fé's heal power, fed through the engine's own `resolveHeal`
 * (so it scales with magic attack like every other cleric heal): equal to
 * Luz Purificadora's level-1 power (a level-15 skill), well under
 * Renascimento Divino's 5.0. What makes it special is being free (no MP, no
 * cooldown) and the full cleanse of bleed/burn/slow, not raw size.
 */
export const MIRACLE_HEAL_POWER = 3.0;

// --- Necromante: Almas --------------------------------------------------
// Kills are the defining source: one kill is worth 7.5 landed actions. A
// small per-hit trickle exists because the meter resets every fight and most
// fights are 1v1 (open-world monsters spawn spread out; every dungeon boss
// fights alone) — with kills alone, a 1v1's only kill would fill the meter
// exactly as the fight ends, and bosses could never trigger it at all. With
// both: in a pair or pack, the first kill (plus a hit or two) fills it, to
// drain the survivors; in a boss fight, ~13 landed actions do.

/** Per enemy defeated by the necromancer's own attacks or damage-over-time — never by the Dreno das Almas itself. */
export const SOULS_PER_KILL = 60;
/** Per player action that connected with at least one target (an AoE counts once). */
export const SOULS_PER_HIT = 8;
/** Dreno das Almas' power per target (vs. magic attack) — between Maldição's 1.3 AoE and the level-20 ultimate's 2.5 AoE. Never misses. */
export const SOUL_DRAIN_POWER = 2.0;
/** Share of the Dreno's TOTAL damage dealt (summed over every target hit) that heals the necromancer. */
export const SOUL_DRAIN_LIFESTEAL = 0.35;

// --- Monge: Fluxo -------------------------------------------------------
// Not a meter: reads the engine's shared combo counter (COMBO_MAX_STACKS = 6,
// +5% damage per stack, see CombatSystem.ts) as named levels, every 2 stacks
// one level. At the top level, every hit is a "finisher" with a small extra
// bonus — +10 points on top of the combo's own +30%, i.e. ~+7.7% relative:
// rewards holding a clean chain without becoming a new dominant damage source.

export const FLOW_STACKS_PER_LEVEL = 2;
/** Must equal the engine's COMBO_MAX_STACKS / FLOW_STACKS_PER_LEVEL — pinned by classMechanics.test.ts. */
export const FLOW_MAX_LEVEL = 3;
/** Added to the combo damage multiplier for every monk hit landed at FLOW_MAX_LEVEL. */
export const FLOW_FINISHER_BONUS = 0.1;

// --- Mago: Sobrecarga Arcana --------------------------------------------
// Passive trigger, no button: every spell cast charges the meter, and once
// it's full the NEXT damaging spell is free and hits harder. Four spell casts
// (or two plus a handful of basic attacks) fill it — the mage's own MP pool
// is the real limiter, so the charge shows up about once per real fight.

/** Per skill cast (damage spell or buff) — sized by cast, not by MP spent, so the pacing doesn't drift as skill costs scale with level. */
export const OVERCHARGE_PER_SPELL = 25;
/** Per basic attack: a trickle to build between spell cooldowns. */
export const OVERCHARGE_PER_BASIC = 8;
/** Extra damage on the overcharged spell, on top of it costing no MP — mostly a refund (the mage is mana-starved) plus a punchy hit. */
export const OVERCHARGE_DAMAGE_BONUS = 0.5;

// --- Paladino: Juramento ------------------------------------------------
// The defensive mirror of Fúria: it fills from HOLDING the line (blocks are
// the clean route; eating a hit is the slow fallback), only a trickle from
// attacking. Two blocks, a couple of hits taken and a handful of attacks
// fill it in a real fight. Passive half ("Fé Inabalável"): the fuller the
// Juramento, the less damage the paladin takes. Active half: Veredito Sagrado.

/** Per player action that connected with at least one target. */
export const VOW_PER_HIT = 4;
export const VOW_PER_BLOCK = 20;
export const VOW_PER_PERFECT_BLOCK = 30;
/** Per enemy hit taken fully unmitigated. */
export const VOW_PER_DAMAGE_TAKEN = 10;
/** Damage reduction at a full meter, scaling linearly with it — small enough that blocking stays the real defense. */
export const VOW_MAX_DAMAGE_REDUCTION = 0.15;
/** Veredito Sagrado's holy damage per enemy (vs. attack) — an AoE a notch under the level-20 ultimate's 2.8. Never misses. */
export const VERDICT_POWER = 1.8;
/** Veredito Sagrado's heal power through `resolveHeal` — Aura de Proteção's level-1 power; the heal is a bonus, not a Cura. */
export const VERDICT_HEAL_POWER = 2.0;

// --- Assassino: Marca da Morte ------------------------------------------
// Per-TARGET stacks, not a shared pool: every landed hit marks its target
// (a crit marks twice), up to MARKS_MAX. The marks also sharpen later hits on
// that target. At full marks Golpe Fatal consumes them; it hits harder the
// lower the target's HP, so it rewards finishing rather than opening. The HUD
// meter shows the most-marked living enemy.

export const MARKS_MAX = 5;
export const MARKS_PER_HIT = 1;
export const MARKS_PER_CRIT = 2;
/** Damage bonus per mark already on the target, for the assassin's own normal hits (max +10% at 5 marks). */
export const MARK_DAMAGE_BONUS_PER_STACK = 0.02;
/** Golpe Fatal's power against a full-HP target (vs. attack); never misses. */
export const FATAL_STRIKE_POWER = 2.0;
/** Extra power fraction at 0% target HP, scaling linearly with the HP missing (x1.8 at the very end). */
export const FATAL_STRIKE_LOW_HP_BONUS = 0.8;

/** Which mechanic ids have an active ability, and what it targets — `CombatEngine.useClassAbility` implements each one. */
const CLASS_ABILITY_TARGET: Record<string, SkillTarget> = {
  fury: 'enemy',
  faith: 'self',
  souls: 'allEnemies',
  vow: 'allEnemies',
  marks: 'enemy',
};

/** What `mechanicId`'s active ability targets, or null if that mechanic has no active ability (passive meters, `combo` mechanics, no mechanic at all). */
export function classAbilityTarget(mechanicId: string | undefined): SkillTarget | null {
  return (mechanicId && CLASS_ABILITY_TARGET[mechanicId]) || null;
}

/** The archer's extra crit chance for a given Precisão meter value (0 at empty, PRECISION_MAX_CRIT_BONUS at full). */
export function precisionCritBonus(meter: number): number {
  return PRECISION_MAX_CRIT_BONUS * Math.max(0, Math.min(1, meter / CLASS_METER_MAX));
}

/** The monk's Fluxo level for a given combo count: 0-1 hits = 0, 2-3 = 1, 4-5 = 2, 6+ = 3. */
export function flowLevelForCombo(comboHits: number): number {
  return Math.min(FLOW_MAX_LEVEL, Math.floor(Math.max(0, comboHits) / FLOW_STACKS_PER_LEVEL));
}

/** Extra combo-multiplier bonus a hit gets from the monk's Fluxo finisher — 0 for every other mechanic, and below the top Fluxo level. */
export function flowFinisherBonus(mechanicId: string | undefined, comboHits: number): number {
  return mechanicId === 'flow' && flowLevelForCombo(comboHits) >= FLOW_MAX_LEVEL ? FLOW_FINISHER_BONUS : 0;
}

/**
 * What the combat HUD's combo badge (and a landed hit's own message suffix)
 * says for `comboHits` consecutive hits, or null when there's nothing worth
 * showing yet (0-1 hits). The monk sees the same shared counter as named
 * Fluxo levels instead of every other class's raw "Combo xN".
 */
export function comboLabel(mechanicId: string | undefined, comboHits: number): string | null {
  if (mechanicId === 'flow') {
    const level = flowLevelForCombo(comboHits);
    if (level <= 0) return null;
    return level >= FLOW_MAX_LEVEL ? `Fluxo Nível ${level} — Finalizador!` : `Fluxo Nível ${level}`;
  }
  return comboHits > 1 ? `Combo x${comboHits}` : null;
}

/** Whether this skill cast is the mage's free, empowered one: a full Sobrecarga and a damaging (non-basic) spell. */
export function isOverchargeCast(mechanicId: string | undefined, meter: number, skillKind: SkillKind, isBasic: boolean): boolean {
  return mechanicId === 'overcharge' && meter >= CLASS_METER_MAX && skillKind === 'magical' && !isBasic;
}

/** How much Sobrecarga one cast adds. */
export function overchargeGain(isBasic: boolean): number {
  return isBasic ? OVERCHARGE_PER_BASIC : OVERCHARGE_PER_SPELL;
}

/** The paladin's Fé Inabalável: fraction of incoming damage shaved off for a given Juramento value (0 for every other mechanic). */
export function vowDamageReduction(mechanicId: string | undefined, meter: number): number {
  if (mechanicId !== 'vow') return 0;
  return VOW_MAX_DAMAGE_REDUCTION * Math.max(0, Math.min(1, meter / CLASS_METER_MAX));
}

/** Marks on a target after one more landed hit. */
export function marksAfterHit(current: number, crit: boolean): number {
  return Math.min(MARKS_MAX, current + (crit ? MARKS_PER_CRIT : MARKS_PER_HIT));
}

/** The assassin's damage bonus from the marks already on the target — 0 for every other mechanic. */
export function markDamageBonus(mechanicId: string | undefined, marks: number): number {
  return mechanicId === 'marks' ? MARK_DAMAGE_BONUS_PER_STACK * Math.max(0, Math.min(MARKS_MAX, marks)) : 0;
}

/** Marks as a 0..CLASS_METER_MAX meter value, so the generic class HUD can draw them. */
export function marksMeterValue(marks: number): number {
  return Math.min(CLASS_METER_MAX, (Math.max(0, marks) * CLASS_METER_MAX) / MARKS_MAX);
}

/** Golpe Fatal's power for a target at `hpFraction` of its max HP (0..1). */
export function fatalStrikePower(hpFraction: number): number {
  const missing = 1 - Math.max(0, Math.min(1, hpFraction));
  return FATAL_STRIKE_POWER * (1 + FATAL_STRIKE_LOW_HP_BONUS * missing);
}
