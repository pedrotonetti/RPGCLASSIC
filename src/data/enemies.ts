import type { EnemyDefinition } from '../config/types';

/**
 * Ordered roughly from weakest to strongest. `EncounterSystem` picks among
 * the enemies whose intended level is close to the player's level.
 */
export const ENEMY_DEFINITIONS: EnemyDefinition[] = [
  {
    id: 'slime',
    name: 'Geleia',
    color: 0x6fcf97,
    stats: {
      maxHp: 14,
      maxMp: 0,
      attack: 4,
      magicAttack: 0,
      defense: 2,
      magicDefense: 1,
      speed: 3,
      luck: 2,
    },
    xpReward: 8,
    goldReward: 5,
    skills: [],
  },
  {
    id: 'bat',
    name: 'Morcego',
    color: 0x9b59b6,
    stats: {
      maxHp: 12,
      maxMp: 0,
      attack: 5,
      magicAttack: 0,
      defense: 1,
      magicDefense: 1,
      speed: 8,
      luck: 4,
    },
    xpReward: 10,
    goldReward: 6,
    skills: [],
  },
  {
    id: 'goblin',
    name: 'Goblin',
    color: 0x7a8b3f,
    stats: {
      maxHp: 20,
      maxMp: 4,
      attack: 6,
      magicAttack: 1,
      defense: 3,
      magicDefense: 2,
      speed: 5,
      luck: 3,
    },
    xpReward: 14,
    goldReward: 10,
    skills: [
      {
        id: 'goblin_slash',
        name: 'Golpe Sujo',
        description: 'Um ataque físico rápido e traiçoeiro.',
        mpCost: 2,
        target: 'enemy',
        kind: 'physical',
        power: 1.4,
        unlockLevel: 1,
      },
    ],
  },
  {
    id: 'dark_wolf',
    name: 'Lobo Sombrio',
    color: 0x4a4a58,
    stats: {
      maxHp: 30,
      maxMp: 0,
      attack: 9,
      magicAttack: 0,
      defense: 4,
      magicDefense: 3,
      speed: 7,
      luck: 5,
    },
    xpReward: 22,
    goldReward: 18,
    skills: [
      {
        id: 'wolf_bite',
        name: 'Mordida Feroz',
        description: 'Uma mordida selvagem com dano elevado.',
        mpCost: 0,
        target: 'enemy',
        kind: 'physical',
        power: 1.6,
        unlockLevel: 1,
      },
    ],
  },
];

export function getEnemyById(id: string): EnemyDefinition {
  const found = ENEMY_DEFINITIONS.find((e) => e.id === id);
  if (!found) {
    throw new Error(`Inimigo desconhecido: ${id}`);
  }
  return found;
}
