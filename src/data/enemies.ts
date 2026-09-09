import { makeSkill } from '../systems/skillMath';
import type { EnemyDefinition } from '../config/types';

/**
 * Ordered roughly from weakest to strongest. `EncounterSystem` picks among
 * the enemies whose intended level is close to the player's level. Each
 * enemy acts on its own real-time timer (`actionInterval`, in seconds).
 */
export const ENEMY_DEFINITIONS: EnemyDefinition[] = [
  {
    id: 'slime',
    name: 'Geleia',
    color: 0x6fcf97,
    stats: { maxHp: 16, maxMp: 0, attack: 4, magicAttack: 0, defense: 2, magicDefense: 1, speed: 3, luck: 2 },
    xpReward: 8,
    goldReward: 5,
    actionInterval: 3.2,
    skills: [],
  },
  {
    id: 'bat',
    name: 'Morcego',
    color: 0x9b59b6,
    stats: { maxHp: 14, maxMp: 0, attack: 5, magicAttack: 0, defense: 1, magicDefense: 1, speed: 8, luck: 4 },
    xpReward: 10,
    goldReward: 6,
    actionInterval: 2.2,
    skills: [],
  },
  {
    id: 'goblin',
    name: 'Goblin',
    color: 0x7a8b3f,
    stats: { maxHp: 22, maxMp: 6, attack: 6, magicAttack: 1, defense: 3, magicDefense: 2, speed: 5, luck: 3 },
    xpReward: 14,
    goldReward: 10,
    actionInterval: 2.8,
    skills: [
      makeSkill({ id: 'goblin_slash', name: 'Golpe Sujo', description: 'Um ataque físico rápido e traiçoeiro.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.4 }),
    ],
  },
  {
    id: 'bandit',
    name: 'Bandido',
    color: 0x8a6a3f,
    stats: { maxHp: 26, maxMp: 8, attack: 8, magicAttack: 1, defense: 4, magicDefense: 3, speed: 6, luck: 5 },
    xpReward: 17,
    goldReward: 16,
    actionInterval: 2.6,
    skills: [
      makeSkill({ id: 'bandit_ambush', name: 'Emboscada', description: 'Ataca de surpresa por trás.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.6 }),
    ],
  },
  {
    id: 'dark_wolf',
    name: 'Lobo Sombrio',
    color: 0x4a4a58,
    stats: { maxHp: 32, maxMp: 0, attack: 9, magicAttack: 0, defense: 4, magicDefense: 3, speed: 7, luck: 5 },
    xpReward: 22,
    goldReward: 18,
    actionInterval: 2.4,
    skills: [
      makeSkill({ id: 'wolf_bite', name: 'Mordida Feroz', description: 'Uma mordida selvagem com dano elevado.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.6 }),
    ],
  },
  {
    id: 'skeleton',
    name: 'Esqueleto',
    color: 0xd8d0c0,
    stats: { maxHp: 30, maxMp: 6, attack: 9, magicAttack: 2, defense: 6, magicDefense: 2, speed: 4, luck: 3 },
    xpReward: 24,
    goldReward: 18,
    actionInterval: 3.0,
    skills: [
      makeSkill({ id: 'skeleton_bone_throw', name: 'Arremesso de Ossos', description: 'Arremessa fragmentos ósseos afiados.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.5 }),
    ],
  },
  {
    id: 'giant_spider',
    name: 'Aranha Gigante',
    color: 0x3a2f3a,
    stats: { maxHp: 28, maxMp: 10, attack: 8, magicAttack: 4, defense: 4, magicDefense: 4, speed: 9, luck: 6 },
    xpReward: 26,
    goldReward: 20,
    actionInterval: 2.3,
    skills: [
      makeSkill({ id: 'spider_venom', name: 'Picada Venenosa', description: 'Injeta veneno corrosivo no alvo.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.7 }),
    ],
  },
  {
    id: 'orc',
    name: 'Orc Guerreiro',
    color: 0x5a7a3f,
    stats: { maxHp: 42, maxMp: 8, attack: 12, magicAttack: 1, defense: 7, magicDefense: 4, speed: 5, luck: 4 },
    xpReward: 34,
    goldReward: 28,
    actionInterval: 3.0,
    skills: [
      makeSkill({ id: 'orc_cleave', name: 'Golpe Cortante', description: 'Um golpe pesado de machado.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 8, baseCost: 0, basePower: 1.8 }),
    ],
  },
  {
    id: 'fire_elemental',
    name: 'Elemental de Fogo',
    color: 0xe0602d,
    stats: { maxHp: 36, maxMp: 20, attack: 4, magicAttack: 14, defense: 5, magicDefense: 8, speed: 6, luck: 5 },
    xpReward: 38,
    goldReward: 30,
    actionInterval: 2.6,
    skills: [
      makeSkill({ id: 'elemental_flame_burst', name: 'Explosão Flamejante', description: 'Libera uma onda de fogo.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.9 }),
    ],
  },
  {
    id: 'troll',
    name: 'Troll das Montanhas',
    color: 0x6a7a6a,
    stats: { maxHp: 60, maxMp: 4, attack: 14, magicAttack: 2, defense: 9, magicDefense: 5, speed: 3, luck: 3 },
    xpReward: 48,
    goldReward: 40,
    actionInterval: 3.4,
    skills: [
      makeSkill({ id: 'troll_smash', name: 'Esmagar', description: 'Um golpe brutal com os punhos.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 9, baseCost: 0, basePower: 2.0 }),
    ],
  },
  {
    id: 'stone_golem',
    name: 'Golem de Pedra',
    color: 0x8a8478,
    stats: { maxHp: 80, maxMp: 0, attack: 13, magicAttack: 0, defense: 14, magicDefense: 10, speed: 2, luck: 2 },
    xpReward: 56,
    goldReward: 46,
    actionInterval: 3.8,
    skills: [
      makeSkill({ id: 'golem_slam', name: 'Impacto Sísmico', description: 'Bate no chão com força devastadora.', kind: 'physical', target: 'allEnemies', unlockLevel: 1, baseCooldown: 12, baseCost: 0, basePower: 1.6 }),
    ],
  },
  {
    id: 'young_dragon',
    name: 'Guardião-Dragão Corrompido',
    color: 0xc73a3a,
    isBoss: true,
    stats: { maxHp: 160, maxMp: 40, attack: 18, magicAttack: 16, defense: 10, magicDefense: 10, speed: 7, luck: 6 },
    xpReward: 140,
    goldReward: 120,
    actionInterval: 2.6,
    skills: [
      makeSkill({ id: 'dragon_claw', name: 'Garras Afiadas', description: 'Um ataque veloz com as garras.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.8 }),
      makeSkill({ id: 'dragon_breath', name: 'Sopro Flamejante', description: 'Um sopro de fogo que atinge tudo à frente.', kind: 'magical', target: 'allEnemies', unlockLevel: 1, baseCooldown: 11, baseCost: 0, basePower: 1.9 }),
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
