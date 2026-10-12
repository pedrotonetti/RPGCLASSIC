import type { ItemModifiers } from './affixes';

export type MountKind = 'terrestre' | 'voadora';

/** What riding this mount into a fight changes — see `Player.itemEffects` (perk, always on while mounted) and `OverworldCombat.beginEngagement` (Investida, the first blow of a fight). */
export interface MountCombatProfile {
  /** Short name of the always-on perk while mounted, e.g. "Mordida Feroz". */
  perkName: string;
  /** One-line pt-BR description shown in the pause menu's mount list. */
  perkText: string;
  /** Folded into `Player.itemEffects` while this mount is active (stacks on top of gear, like a dungeon blessing). */
  mods: Partial<ItemModifiers>;
  /** Extra `damageDealt` on the FIRST skill/attack of a fight started while mounted (the "Investida"). */
  chargeBonus: number;
}

export interface MountDefinition {
  id: string;
  name: string;
  kind: MountKind;
  description: string;
  color: number;
  /** Multiplies overworld movement speed (lower move duration). */
  speedMultiplier: number;
  /** Absent = no combat effect (e.g. the flying mount, which is about traversal). */
  combat?: MountCombatProfile;
}

/**
 * Ground mounts are real rigged glTF animals from Quaternius' CC0 "Ultimate
 * Animated Animal Pack" (see `render/mountModel.ts` and
 * `public/models/CREDITS.md`); the leopard and the unicorn are tinted/
 * decorated variants of the wolf and the white horse built at load time,
 * since no CC0 big cat or unicorn exists in the packs we can vendor.
 *
 * Every mount is unlocked from the start in this build so they're easy to
 * try out; gating them behind quests/gold is a natural next step.
 */
export const MOUNT_DEFINITIONS: MountDefinition[] = [
  {
    id: 'cavalo_branco',
    name: 'Corcel de Prata',
    kind: 'terrestre',
    description: 'Cavalo branco de crina longa, criado nos estábulos do Baluarte.',
    color: 0xf2f0ea,
    speedMultiplier: 1.9,
    combat: {
      perkName: 'Investida Nobre',
      perkText: 'Primeiro golpe da luta +40% de dano; -5% de dano recebido.',
      mods: { damageReduction: 0.05 },
      chargeBonus: 0.4,
    },
  },
  {
    id: 'unicornio',
    name: 'Unicórnio de Ipêra',
    kind: 'terrestre',
    description: 'Dizem que só aparece a quem ainda não bebeu da Sede.',
    color: 0xfaf6ff,
    speedMultiplier: 2.0,
    combat: {
      perkName: 'Chifre Sagrado',
      perkText: 'Roubo de vida 6% e +1% de mana por segundo.',
      mods: { lifeSteal: 0.06, mpRegenPct: 0.01 },
      chargeBonus: 0.2,
    },
  },
  {
    id: 'lobo',
    name: 'Lobo Cinzento',
    kind: 'terrestre',
    description: 'Um lobo das matas do Verdegal, leal até o último uivo.',
    color: 0x8a8a8a,
    speedMultiplier: 1.8,
    combat: {
      perkName: 'Mordida Feroz',
      perkText: '+6% de dano e 15% de chance de sangramento.',
      mods: { damageDealt: 0.06, bleedChance: 0.15 },
      chargeBonus: 0.25,
    },
  },
  {
    id: 'cervo',
    name: 'Cervo Real',
    kind: 'terrestre',
    description: 'Galhada imponente; nenhum predador ousa se aproximar.',
    color: 0x9a6b42,
    speedMultiplier: 1.75,
    combat: {
      perkName: 'Galhada',
      perkText: '-8% de dano recebido e 12% do dano refletido.',
      mods: { damageReduction: 0.08, thorns: 0.12 },
      chargeBonus: 0.25,
    },
  },
  {
    id: 'leopardo',
    name: 'Leopardo das Sombras',
    kind: 'terrestre',
    description: 'Silencioso e veloz — ataca antes de ser visto.',
    color: 0xd9a441,
    speedMultiplier: 1.95,
    combat: {
      perkName: 'Bote Certeiro',
      perkText: '+8% de chance de crítico e +15% de dano crítico.',
      mods: { critChance: 0.08, critDamage: 0.15 },
      chargeBonus: 0.3,
    },
  },
  {
    id: 'condor',
    name: 'Pterodáctilo Ancestral',
    kind: 'voadora',
    description: 'Sobrevoa rios e desfiladeiros que a pé seriam intransponíveis.',
    color: 0x4a4a58,
    speedMultiplier: 2.2,
  },
];

/** Every mount a player has by default (all of them, in this build). */
export const DEFAULT_UNLOCKED_MOUNTS: string[] = MOUNT_DEFINITIONS.map((m) => m.id);

/** Old save ids that no longer exist → their replacement (the goat "llama" became the white horse). */
const LEGACY_MOUNT_IDS: Record<string, string> = { llama: 'cavalo_branco' };

/** Maps a stored id (possibly from an older save) to a current one, or null if it's unknown. */
export function normalizeMountId(id: string | null | undefined): string | null {
  if (!id) return null;
  const mapped = LEGACY_MOUNT_IDS[id] ?? id;
  return MOUNT_DEFINITIONS.some((m) => m.id === mapped) ? mapped : null;
}

/** A save's unlocked list with legacy ids migrated, unknown ids dropped, and every default mount added. */
export function normalizeUnlockedMounts(ids: string[] | undefined): string[] {
  const result: string[] = [];
  for (const id of [...(ids ?? []), ...DEFAULT_UNLOCKED_MOUNTS]) {
    const mapped = normalizeMountId(id);
    if (mapped && !result.includes(mapped)) result.push(mapped);
  }
  // Keep the canonical menu order regardless of what the save listed first.
  return MOUNT_DEFINITIONS.map((m) => m.id).filter((id) => result.includes(id));
}

export function getMountById(id: string): MountDefinition {
  const mapped = LEGACY_MOUNT_IDS[id] ?? id;
  const found = MOUNT_DEFINITIONS.find((m) => m.id === mapped);
  if (!found) throw new Error(`Montaria desconhecida: ${id}`);
  return found;
}
