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
 */
export const MOUNT_DEFINITIONS: MountDefinition[] = [
  {
    id: 'llama',
    name: 'Lhama-Real',
    kind: 'terrestre',
    description: 'Companheira leal das trilhas altas, mais rápida que caminhar.',
    color: 0xe8e0d0,
    speedMultiplier: 1.6,
  },
  {
    id: 'condor',
    name: 'Condor Ancestral',
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
