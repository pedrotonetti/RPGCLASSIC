import type { EnemyArchetype, SkillDefinition, SkillKind } from '../config/types';

/**
 * Fase 3 — "Inimigos com personalidade": a small, DATA-driven behavior
 * profile per `EnemyArchetype`, consumed by two existing loops instead of
 * replacing them:
 *  - `OverworldCombat.updateMonster` (aggro radius / chase speed, before a
 *    fight starts) — see `chaseSpeedMultiplierFor`.
 *  - `CombatSystem`'s `beginEnemyAction`/`resolveEnemyAttack` (which skill
 *    an enemy leans on, and how HP-threshold state changes its damage/pace
 *    once engaged) — see `pickSkillForArchetype`, `isEnraged`,
 *    `archetypeDamageMultiplier`, `archetypeActionIntervalMultiplier`.
 *
 * `summoner` ("cria adds") and `mimic` ("copia padrões") are declared in the
 * shared `EnemyArchetype` union (config/types.ts) so the type is already
 * complete, but their profiles here are intentionally the neutral default:
 * a real "add" needs `CombatEngine` to be able to grow `this.enemies` mid-
 * fight (and `OverworldCombat` to spawn a matching 3D model for it), and a
 * real "copies patterns" needs a record of what it's copying FROM — both
 * are their own follow-up batch, not a same-day extension of this one. No
 * `EnemyDefinition` is tagged with either yet, so this never surfaces as an
 * enemy that's labeled "Invocador" but never actually summons anything.
 */

export interface ArchetypeProfile {
  id: EnemyArchetype | 'default';
  label: string;
  /** The telegraph's verb — `${enemyName} ${tellVerb}!` — this archetype's own readable "tell" (see PDF section 6: "telegraph, padrão reconhecível... uma resposta que o jogador consiga aprender"). */
  tellVerb: string;
  aggroRadiusMult: number;
  deaggroRadiusMult: number;
  chaseSpeedMult: number;
  /** Predador only: closes in faster the lower the player's own HP fraction is — see `chaseSpeedMultiplierFor`. */
  huntsWoundedPlayer: boolean;
  /** At/below this fraction of its own max HP, this archetype enrages (0 = never) — see `isEnraged`. */
  enrageBelowHpFraction: number;
  enrageDamageMult: number;
  enrageSpeedMult: number;
  /** Multiplies the base 55% chance `beginEnemyAction` already rolled to use a skill at all instead of a plain basic attack. */
  skillUseChanceMult: number;
  /** Weights skill choice toward whichever usable skill carries a `StatusInflict` (Controlador) — see `pickSkillForArchetype`. */
  prefersInflictSkill: boolean;
  /** Weights skill choice toward a usable skill of this `SkillKind` (Suporte's `heal`) — see `pickSkillForArchetype`. */
  preferredSkillKind?: SkillKind;
  /** Emboscador only: a one-time damage multiplier on the very first hit it lands in a fight — see `CombatSystem`'s `hasActed` bookkeeping. */
  ambushFirstHitMult?: number;
}

/** Every multiplier here is 1 (or the field's own "off" value) — an enemy with no `archetype` set behaves exactly as it always has. */
export const DEFAULT_ARCHETYPE_PROFILE: ArchetypeProfile = {
  id: 'default',
  label: 'Comum',
  tellVerb: 'vai atacar',
  aggroRadiusMult: 1,
  deaggroRadiusMult: 1,
  chaseSpeedMult: 1,
  huntsWoundedPlayer: false,
  enrageBelowHpFraction: 0,
  enrageDamageMult: 1,
  enrageSpeedMult: 1,
  skillUseChanceMult: 1,
  prefersInflictSkill: false,
};

export const ARCHETYPE_PROFILES: Record<EnemyArchetype, ArchetypeProfile> = {
  // Predador — persegue alvo vulnerável: relentless, never breaks pursuit,
  // and closes in faster the more wounded the player already looks.
  predator: {
    ...DEFAULT_ARCHETYPE_PROFILE,
    id: 'predator',
    label: 'Predador',
    tellVerb: 'avança com fome',
    aggroRadiusMult: 1.3,
    chaseSpeedMult: 1.25,
    huntsWoundedPlayer: true,
  },
  // Tanque — protege aliados: the first to notice and close in (so it's the
  // one standing between the player and the rest of a pod), lumbering but
  // never enraging or backing off.
  tank: {
    ...DEFAULT_ARCHETYPE_PROFILE,
    id: 'tank',
    label: 'Tanque',
    tellVerb: 'avança, escudo erguido',
    aggroRadiusMult: 1.15,
    chaseSpeedMult: 0.85,
  },
  // Suporte — cura/buffa e foge: hangs back before engaging, and leans hard
  // on healing its most wounded ally once one exists (see
  // `CombatSystem.resolveEnemySupportHeal` — the actual heal-an-ally
  // mechanic this profile's `preferredSkillKind` hooks into). Visually
  // retreating once badly hurt is a deliberately deferred follow-up (see
  // this session's own notes on `ENGAGE_LEASH_RANGE`) — "foge" today means
  // it prioritizes keeping everyone alive over pressing its own attack.
  support: {
    ...DEFAULT_ARCHETYPE_PROFILE,
    id: 'support',
    label: 'Suporte',
    tellVerb: 'prepara uma bênção',
    aggroRadiusMult: 0.8,
    chaseSpeedMult: 0.8,
    skillUseChanceMult: 1.6,
    preferredSkillKind: 'heal',
  },
  // Emboscador — inicia combate de surpresa: notices the player later than
  // average (waits), but once it commits it closes fast, and its first
  // landed hit carries a real surprise bonus. Not TOO small a radius, though
  // — see this session's own note on `guardian` below: an aggro radius that
  // barely clears ATTACK_RANGE risks the monster never actually noticing an
  // approaching player at all in an ordinary encounter.
  ambusher: {
    ...DEFAULT_ARCHETYPE_PROFILE,
    id: 'ambusher',
    label: 'Emboscador',
    tellVerb: 'salta da sombra',
    aggroRadiusMult: 0.85,
    chaseSpeedMult: 1.4,
    // Tuned to stay clear of CombatSystem.test.ts's own balance guard (a
    // fresh level-1 character never loses half its max HP to one hit from a
    // starting-village monster) — bat is the earliest ambusher a player can
    // meet, at level 1, so its very first (guaranteed-ambush) swing is
    // exactly the worst case that guard exists to catch.
    ambushFirstHitMult: 1.3,
  },
  // Invocador — reserved, see this module's own doc comment.
  summoner: { ...DEFAULT_ARCHETYPE_PROFILE, id: 'summoner', label: 'Invocador', tellVerb: 'conjura algo' },
  // Berserker — muda comportamento em HP baixo: ordinary until badly hurt,
  // then hits harder and acts faster.
  berserker: {
    ...DEFAULT_ARCHETYPE_PROFILE,
    id: 'berserker',
    label: 'Berserker',
    tellVerb: 'entra em fúria',
    enrageBelowHpFraction: 0.5,
    enrageDamageMult: 1.35,
    enrageSpeedMult: 1.4,
  },
  // Controlador — aplica slow/stun: leans hard on whichever of its skills
  // actually inflicts a status effect, over a plain damaging hit.
  controller: {
    ...DEFAULT_ARCHETYPE_PROFILE,
    id: 'controller',
    label: 'Controlador',
    tellVerb: 'mira para imobilizar',
    skillUseChanceMult: 1.5,
    prefersInflictSkill: true,
  },
  // Guardião — protege área/objetivo: territorial. Gives up the chase again
  // quickly if the player just keeps moving away, and closes in a touch
  // slower than average — but notices an approaching player at a fairly
  // ordinary distance. Originally tuned with a 0.5x aggro radius (1.7 world
  // units — barely past ATTACK_RANGE's own 1.15), which real e2e testing
  // (tests/e2e/combat.spec.ts against the Root Hollow dungeon's own
  // slime pod, which carries this archetype) showed was small enough that
  // a monster could stand right next to an approaching player and never
  // actually aggro at all, since the last stretch of closing distance
  // depends partly on the monster's own chase, not the player's approach
  // alone. 0.85 keeps "notices you a beat later than most" without that
  // failure mode.
  guardian: {
    ...DEFAULT_ARCHETYPE_PROFILE,
    id: 'guardian',
    label: 'Guardião',
    tellVerb: 'ergue-se em guarda',
    aggroRadiusMult: 0.85,
    deaggroRadiusMult: 0.5,
    chaseSpeedMult: 0.9,
  },
  // Mímico — reserved, see this module's own doc comment.
  mimic: { ...DEFAULT_ARCHETYPE_PROFILE, id: 'mimic', label: 'Mímico', tellVerb: 'observa e imita' },
};

export function archetypeProfileFor(archetype: EnemyArchetype | undefined): ArchetypeProfile {
  if (!archetype) return DEFAULT_ARCHETYPE_PROFILE;
  return ARCHETYPE_PROFILES[archetype];
}

/** True once this archetype's own HP-threshold rage kicks in (0 `enrageBelowHpFraction` means it never does). */
export function isEnraged(profile: ArchetypeProfile, hpFraction: number): boolean {
  return profile.enrageBelowHpFraction > 0 && hpFraction <= profile.enrageBelowHpFraction;
}

/** 1 normally; `enrageDamageMult` once this archetype's own enrage threshold is crossed. */
export function archetypeDamageMultiplier(profile: ArchetypeProfile, hpFraction: number): number {
  return isEnraged(profile, hpFraction) ? profile.enrageDamageMult : 1;
}

/** Divides the next action-timer interval (so a SMALLER result acts sooner) once enraged; 1 (no change) otherwise. */
export function archetypeActionIntervalMultiplier(profile: ArchetypeProfile, hpFraction: number): number {
  return isEnraged(profile, hpFraction) ? 1 / profile.enrageSpeedMult : 1;
}

/** Predador's "hunts vulnerable prey": 1x at full player HP, ramping up to +50% at 0 HP; 1 (unchanged) for every other archetype. */
export function chaseSpeedMultiplierFor(profile: ArchetypeProfile, playerHpFraction: number): number {
  if (!profile.huntsWoundedPlayer) return 1;
  const fraction = Math.min(1, Math.max(0, playerHpFraction));
  return 1 + (1 - fraction) * 0.5;
}

/**
 * Which of `usable` (already MP-affordable) skills this archetype reaches
 * for, weighted by `prefersInflictSkill`/`preferredSkillKind` before falling
 * back to the plain uniform pick every enemy used before this module existed
 * — an archetype with neither set (the default profile, or any archetype
 * that doesn't name a preference) picks exactly like that original code did.
 * `rng` is injectable so this stays a deterministically testable pure
 * function; real callers just use the default `Math.random`.
 */
export function pickSkillForArchetype(profile: ArchetypeProfile, usable: SkillDefinition[], rng: () => number = Math.random): SkillDefinition | null {
  if (usable.length === 0) return null;
  const pickFrom = (pool: SkillDefinition[]) => pool[Math.floor(rng() * pool.length)];
  if (profile.prefersInflictSkill) {
    const inflicting = usable.filter((s) => !!s.inflicts);
    if (inflicting.length > 0 && rng() < 0.8) return pickFrom(inflicting);
  }
  if (profile.preferredSkillKind) {
    const preferred = usable.filter((s) => s.kind === profile.preferredSkillKind);
    if (preferred.length > 0 && rng() < 0.8) return pickFrom(preferred);
  }
  return pickFrom(usable);
}

/** `${enemyName} ${tellVerb}!` — this archetype's own readable wind-up line, shown the same way (and for the same fixed `TELEGRAPH_DURATION`) the old one-size-fits-all "vai atacar!" was. */
export function telegraphTextFor(profile: ArchetypeProfile, enemyName: string): string {
  return `${enemyName} ${profile.tellVerb}!`;
}
