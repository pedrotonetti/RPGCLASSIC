export type MountKind = 'terrestre' | 'voadora';

export interface MountDefinition {
  id: string;
  name: string;
  kind: MountKind;
  description: string;
  color: number;
  /** Multiplies overworld movement speed (lower move duration). */
  speedMultiplier: number;
}

/**
 * Ground and flying mounts. Both are unlocked from the start in this build
 * so they're easy to try out; gating them behind quests/gold is a natural
 * next step (see LORE.md / README "próximos passos").
 *
 * `id` stays stable (it's what a save stores in `unlockedMounts`/
 * `activeMountId` — see `entities/Player.ts`) even though the actual glTF
 * creature behind each one changed (see `render/mountModel.ts`): the
 * procedural llama/condor primitives were replaced with real rigged models
 * from a CC0 pack, and neither of those happened to be a llama or a condor.
 * `name`/`description` were retuned to match what's actually on screen now
 * instead of leaving a mismatched label on a reskinned mount — a mountain
 * goat still reads as "trilhas altas" (high trails), and a pterodactyl still
 * reads as "ancestral" and soaring over canyons, arguably better than the
 * animals they replace. `color` is unused now (the glTF ships its own
 * texture) but left in place — nothing outside the old procedural builder
 * ever read it as anything but a cosmetic tint, so it's harmless dead data
 * rather than something worth a separate cleanup pass.
 */
export const MOUNT_DEFINITIONS: MountDefinition[] = [
  {
    id: 'llama',
    name: 'Cabra-Real',
    kind: 'terrestre',
    description: 'Companheira leal das trilhas altas, mais rápida que caminhar.',
    color: 0xe8e0d0,
    speedMultiplier: 1.6,
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

export function getMountById(id: string): MountDefinition {
  const found = MOUNT_DEFINITIONS.find((m) => m.id === id);
  if (!found) throw new Error(`Montaria desconhecida: ${id}`);
  return found;
}
