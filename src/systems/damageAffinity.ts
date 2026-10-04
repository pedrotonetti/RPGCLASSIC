import type { DamageElement, DamageTag } from '../config/types';

/**
 * Fase 3 — "Combate 2.0: fraquezas e resistências" (PDF section 5): every
 * player hit carries tags (its physical/magical kind, plus the skill's
 * element if it has one), and an `EnemyDefinition` lists the tags it is
 * weak or resistant to. Pure data lookup — `CombatEngine.landPlayerHit`
 * scales the hit by `affinityMultiplier` and surfaces `affinityLabel` as the
 * floating-text cue.
 */

export type DamageAffinity = 'weak' | 'resist';

export interface AffinityHolder {
  weaknesses?: DamageTag[];
  resistances?: DamageTag[];
}

export const WEAKNESS_MULTIPLIER = 1.35;
export const RESISTANCE_MULTIPLIER = 0.7;

/** `null` = neutral. A hit matching both a weakness and a resistance (any of its tags) cancels out to neutral. */
export function damageAffinity(target: AffinityHolder, kind: 'physical' | 'magical', element?: DamageElement): DamageAffinity | null {
  const tags: DamageTag[] = element ? [kind, element] : [kind];
  const weak = tags.some((t) => target.weaknesses?.includes(t));
  const resist = tags.some((t) => target.resistances?.includes(t));
  if (weak === resist) return null;
  return weak ? 'weak' : 'resist';
}

export function affinityMultiplier(affinity: DamageAffinity | null): number {
  if (affinity === 'weak') return WEAKNESS_MULTIPLIER;
  if (affinity === 'resist') return RESISTANCE_MULTIPLIER;
  return 1;
}

/** The floating-text / log cue for a hit's affinity, or null for a neutral hit. */
export function affinityLabel(affinity: DamageAffinity | null): string | null {
  if (affinity === 'weak') return 'Fraco!';
  if (affinity === 'resist') return 'Resistiu';
  return null;
}
