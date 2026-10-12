import type { ItemModifiers } from './affixes';

export type MountKind = 'terrestre' | 'voadora';

/** What riding this mount into a fight changes — see `Player.itemEffects` (perk, always on while mounted) and `OverworldCombat.beginEngagement` (Investida, the first blow of a fight). */
export interface MountCombatProfile {
  /** Short name of the always-on perk while mounted, e.g. "Mordida Feroz". */
  perkName: string;
  /** One-line pt-BR description shown in the inventory's mount list (at stage 1 for an evolving mount). */
  perkText: string;
  /** Folded into `Player.itemEffects` while this mount is active (stacks on top of gear, like a dungeon blessing). */
  mods: Partial<ItemModifiers>;
  /** Extra `damageDealt` on the FIRST skill/attack of a fight started while mounted (the "Investida"). */
  chargeBonus: number;
}

/** How a mount is earned — checked by `systems/MountSystem.ts` (`earnedMountIds`). */
export type MountUnlock =
  | { kind: 'start' }
  | { kind: 'sideQuests'; count: number }
  | { kind: 'quest'; questId: string }
  | { kind: 'level'; level: number }
  | { kind: 'dungeonTier'; tier: number }
  | { kind: 'lore'; count: number };

/** One evolution stage of a flying mount: reached at `xp` total mount XP. */
export interface MountStage {
  name: string;
  xp: number;
  /** Added to the mount's base `speedMultiplier`. */
  speedBonus: number;
  /** Multiplies every numeric value of the mount's combat perk (mods + Investida). */
  perkMult: number;
}

export interface MountDefinition {
  id: string;
  name: string;
  kind: MountKind;
  description: string;
  color: number;
  /** Multiplies overworld movement speed (lower move duration). */
  speedMultiplier: number;
  /** Absent = no combat effect. */
  combat?: MountCombatProfile;
  unlock: MountUnlock;
  /** pt-BR hint shown on a locked mount ("Conclua 2 missões secundárias"). */
  unlockText: string;
  /** Flying mounts evolve: stage 0 is the base form. Absent = never evolves. */
  stages?: MountStage[];
}

/** XP thresholds shared by every evolving mount: stage 2 at 300, stage 3 at 900. */
const STAGE_XP = [0, 300, 900] as const;

function stages(names: [string, string, string]): MountStage[] {
  return [
    { name: names[0], xp: STAGE_XP[0], speedBonus: 0, perkMult: 1 },
    { name: names[1], xp: STAGE_XP[1], speedBonus: 0.2, perkMult: 1.5 },
    { name: names[2], xp: STAGE_XP[2], speedBonus: 0.45, perkMult: 2.2 },
  ];
}

/**
 * Ground mounts are real rigged glTF animals from Quaternius' CC0 "Ultimate
 * Animated Animal Pack"; the flying ones are built from those same animals
 * plus procedural wings (or Quaternius' CC0 dragon) — see
 * `render/mountModel.ts` and `public/models/CREDITS.md`.
 *
 * Progression: everyone starts on the plain brown horse; every other ground
 * mount is earned by completing side quests, and each flying mount by a
 * milestone. Mounts are equipped (one ground + one flying) from the
 * Inventory, and flying mounts evolve through 3 stages with mount XP earned
 * by flying and by winning fights while riding them.
 */
export const MOUNT_DEFINITIONS: MountDefinition[] = [
  // --- terrestres ---------------------------------------------------------
  {
    id: 'cavalo_marrom',
    name: 'Cavalo Baio',
    kind: 'terrestre',
    description: 'Um cavalo marrom comum, emprestado pelo estábulo da vila. Simples, mas não te deixa na mão.',
    color: 0x7a4e2d,
    speedMultiplier: 1.6,
    combat: { perkName: 'Arrancada', perkText: 'Primeiro golpe da luta +15% de dano.', mods: {}, chargeBonus: 0.15 },
    unlock: { kind: 'start' },
    unlockText: 'Montaria inicial.',
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
    unlock: { kind: 'sideQuests', count: 1 },
    unlockText: 'Conclua 1 missão secundária.',
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
    unlock: { kind: 'sideQuests', count: 2 },
    unlockText: 'Conclua 2 missões secundárias.',
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
    unlock: { kind: 'sideQuests', count: 4 },
    unlockText: 'Conclua 4 missões secundárias.',
  },
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
    unlock: { kind: 'sideQuests', count: 6 },
    unlockText: 'Conclua 6 missões secundárias.',
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
    unlock: { kind: 'sideQuests', count: 9 },
    unlockText: 'Conclua 9 missões secundárias.',
  },

  // --- voadoras -----------------------------------------------------------
  {
    id: 'condor',
    name: 'Pterodáctilo Ancestral',
    kind: 'voadora',
    description: 'Sobrevoa rios e desfiladeiros que a pé seriam intransponíveis.',
    color: 0x4a4a58,
    speedMultiplier: 2.2,
    unlock: { kind: 'level', level: 8 },
    unlockText: 'Alcance o nível 8.',
  },
  {
    id: 'pegaso',
    name: 'Pégaso',
    kind: 'voadora',
    description: 'Cavalo alado das nuvens altas. Evolui até se tornar o lendário Alicórnio.',
    color: 0xffffff,
    speedMultiplier: 2.1,
    combat: {
      perkName: 'Asas da Aurora',
      perkText: '-4% de dano recebido e +0,6% de mana por segundo.',
      mods: { damageReduction: 0.04, mpRegenPct: 0.006 },
      chargeBonus: 0.15,
    },
    unlock: { kind: 'level', level: 12 },
    unlockText: 'Alcance o nível 12.',
    stages: stages(['Pégaso', 'Pégaso Real', 'Alicórnio']),
  },
  {
    id: 'dragao',
    name: 'Dragão',
    kind: 'voadora',
    description: 'Chocado de um ovo achado no covil do dragão jovem. Cresce a cada voo.',
    color: 0xc0502a,
    speedMultiplier: 2.0,
    combat: {
      perkName: 'Sopro Ígneo',
      perkText: '+5% de dano e 12% de chance de queimar.',
      mods: { damageDealt: 0.05, burnChance: 0.12 },
      chargeBonus: 0.2,
    },
    unlock: { kind: 'quest', questId: 'q6_dragon' },
    unlockText: 'Derrote o dragão jovem (missão principal).',
    stages: stages(['Dragãozinho', 'Dragão Jovem', 'Dragão Ancestral']),
  },
  {
    id: 'grifo',
    name: 'Grifo',
    kind: 'voadora',
    description: 'Corpo de felino, asas de águia. Fiel a quem vence as Distorções.',
    color: 0xc79a4a,
    speedMultiplier: 2.15,
    combat: {
      perkName: 'Garras do Céu',
      perkText: '+5% de chance de crítico e +10% de dano crítico.',
      mods: { critChance: 0.05, critDamage: 0.1 },
      chargeBonus: 0.25,
    },
    unlock: { kind: 'dungeonTier', tier: 2 },
    unlockText: 'Conclua qualquer masmorra no Tier 2.',
    stages: stages(['Grifo', 'Grifo Dourado', 'Grifo Imperial']),
  },
  {
    id: 'cervo_estelar',
    name: 'Cervo Alado',
    kind: 'voadora',
    description: 'Um cervo de luz que só se revela a quem busca as memórias de Ipêra.',
    color: 0x9fe3ff,
    speedMultiplier: 2.05,
    combat: {
      perkName: 'Luz Estelar',
      perkText: '+1% de mana por segundo e -5% de custo de mana.',
      mods: { mpRegenPct: 0.01, mpCost: 0.05 },
      chargeBonus: 0.15,
    },
    unlock: { kind: 'lore', count: 5 },
    unlockText: 'Encontre 5 Fragmentos de Memória.',
    stages: stages(['Cervo Alado', 'Cervo Estelar', 'Cervo Celestial']),
  },
  {
    id: 'corcel_sombrio',
    name: 'Corcel Sombrio',
    kind: 'voadora',
    description: 'Um cavalo negro de asas de couro, nascido das cinzas da Sede.',
    color: 0x2a2228,
    speedMultiplier: 2.25,
    combat: {
      perkName: 'Fome das Cinzas',
      perkText: 'Roubo de vida 4% e +4% de dano.',
      mods: { lifeSteal: 0.04, damageDealt: 0.04 },
      chargeBonus: 0.25,
    },
    unlock: { kind: 'quest', questId: 'act3_q2_confront' },
    unlockText: 'Avance no Ato 3 (Confronto).',
    stages: stages(['Corcel Sombrio', 'Corcel das Cinzas', 'Corcel do Eclipse']),
  },
];

/** The mount every new character starts with. */
export const STARTER_MOUNT_ID = 'cavalo_marrom';

/** Old save ids that no longer exist → their replacement (the goat "llama" became the starter horse). */
const LEGACY_MOUNT_IDS: Record<string, string> = { llama: STARTER_MOUNT_ID };

/** Maps a stored id (possibly from an older save) to a current one, or null if it's unknown. */
export function normalizeMountId(id: string | null | undefined): string | null {
  if (!id) return null;
  const mapped = LEGACY_MOUNT_IDS[id] ?? id;
  return MOUNT_DEFINITIONS.some((m) => m.id === mapped) ? mapped : null;
}

export function getMountById(id: string): MountDefinition {
  const mapped = LEGACY_MOUNT_IDS[id] ?? id;
  const found = MOUNT_DEFINITIONS.find((m) => m.id === mapped);
  if (!found) throw new Error(`Montaria desconhecida: ${id}`);
  return found;
}

/** Index of the evolution stage reached with `xp` (always 0 for a mount that doesn't evolve). */
export function mountStageIndex(def: MountDefinition, xp: number): number {
  if (!def.stages) return 0;
  let index = 0;
  for (let i = 0; i < def.stages.length; i++) if (xp >= def.stages[i].xp) index = i;
  return index;
}

/** Display name, speed and combat profile of `def` at evolution stage `stage`. */
export function mountAtStage(def: MountDefinition, stage: number): { name: string; speedMultiplier: number; combat?: MountCombatProfile } {
  const s = def.stages?.[Math.min(stage, def.stages.length - 1)];
  if (!s) return { name: def.name, speedMultiplier: def.speedMultiplier, combat: def.combat };
  const combat = def.combat
    ? {
        ...def.combat,
        mods: Object.fromEntries(Object.entries(def.combat.mods).map(([k, v]) => [k, (v ?? 0) * s.perkMult])) as Partial<ItemModifiers>,
        chargeBonus: def.combat.chargeBonus * s.perkMult,
      }
    : undefined;
  return { name: s.name, speedMultiplier: def.speedMultiplier + s.speedBonus, combat };
}
