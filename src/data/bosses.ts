import { makeSkill } from '../systems/skillMath';
import type { EnemyDefinition } from '../config/types';

/**
 * Dungeon boss enemies for `data/dungeons.ts`'s instances — a separate file
 * from `data/enemies.ts` on purpose: another pass is actively adding a
 * level/tier field to that file's `ENEMY_DEFINITIONS` array, and appending
 * here instead sidesteps a needless merge conflict. Mechanically these are
 * still plain `EnemyDefinition`s fought through the exact same
 * `CombatEngine`/`OverworldCombat` machinery as any wandering monster — a
 * boss is just a much bigger stat/skill budget, not a new combat system.
 *
 * Ordered early -> mid -> late, matching the three dungeons in
 * `data/dungeons.ts`. For scale, compare `young_dragon` in `enemies.ts`
 * (the current story's own boss: 160 HP, 140 XP, 120 gold) — the late-game
 * dungeon boss below is intentionally a clear step above that, since it's
 * framed (see LORE.md's ending hooks) as content beyond the current story's
 * own climax.
 */
export const BOSS_DEFINITIONS: EnemyDefinition[] = [
  {
    id: 'boss_root_ooze',
    name: 'Matriarca-Geleia',
    color: 0x4b1f5e,
    isBoss: true,
    level: 9, // clearly above the early-game monster curve (goblin=3..troll=10) it's fought alongside, matching a boss's step up over wandering enemies at the same recommended character level
    stats: { maxHp: 100, maxMp: 20, attack: 12, magicAttack: 7, defense: 6, magicDefense: 5, speed: 4, luck: 4 },
    xpReward: 70,
    goldReward: 55,
    actionInterval: 2.6,
    skills: [
      makeSkill({
        id: 'ooze_corrosive_slam',
        name: 'Investida Corrosiva',
        description: 'Arremessa o próprio corpo ácido contra o alvo.',
        kind: 'physical',
        target: 'enemy',
        unlockLevel: 1,
        baseCooldown: 6,
        baseCost: 0,
        basePower: 1.6,
      }),
      makeSkill({
        id: 'ooze_spore_burst',
        name: 'Esporos da Sede',
        description: 'Libera os esporos corrosivos que a Sede deixou nela, abrindo feridas que sangram.',
        kind: 'magical',
        target: 'enemy',
        unlockLevel: 1,
        baseCooldown: 9,
        baseCost: 0,
        basePower: 1.8,
        inflicts: { type: 'bleed', chance: 0.5 },
      }),
    ],
  },
  {
    id: 'boss_bark_warden',
    name: 'Guardiã de Casca',
    color: 0x6a5a3a,
    isBoss: true,
    level: 13, // above stone_golem (11), the toughest regular enemy near this dungeon's recommended level
    stats: { maxHp: 170, maxMp: 30, attack: 16, magicAttack: 8, defense: 12, magicDefense: 9, speed: 3, luck: 4 },
    xpReward: 110,
    goldReward: 90,
    actionInterval: 2.8,
    skills: [
      makeSkill({
        id: 'warden_root_grasp',
        name: 'Garras de Raiz',
        description: 'Prende o alvo com raízes retorcidas que brotam do chão.',
        kind: 'physical',
        target: 'enemy',
        unlockLevel: 1,
        baseCooldown: 7,
        baseCost: 0,
        basePower: 1.7,
      }),
      makeSkill({
        id: 'warden_bark_slam',
        name: 'Impacto de Casca',
        description: 'Um golpe pesado que racha o chão de casca petrificada ao redor.',
        kind: 'physical',
        target: 'allEnemies',
        unlockLevel: 1,
        baseCooldown: 11,
        baseCost: 0,
        basePower: 1.6,
      }),
      makeSkill({
        id: 'warden_sap_drain',
        name: 'Sugar Seiva',
        description: 'Drena a seiva vital do alvo para si mesma.',
        kind: 'magical',
        target: 'enemy',
        unlockLevel: 1,
        baseCooldown: 9,
        baseCost: 0,
        basePower: 1.5,
      }),
    ],
  },
  {
    id: 'boss_voiceless_root',
    name: 'A Raiz Sem Voz',
    color: 0x2a2f28,
    isBoss: true,
    level: 20, // above young_dragon (18, the base story's own final boss) — this dungeon is framed as content beyond that climax, and its loot should say so too
    stats: { maxHp: 340, maxMp: 60, attack: 24, magicAttack: 22, defense: 14, magicDefense: 14, speed: 6, luck: 6 },
    xpReward: 260,
    goldReward: 220,
    actionInterval: 2.3,
    skills: [
      makeSkill({
        id: 'voiceless_rend',
        name: 'Dilacerar Ancestral',
        description: 'Rasga o ar com garras mais antigas que qualquer ipê de Ipêra.',
        kind: 'physical',
        target: 'enemy',
        unlockLevel: 1,
        baseCooldown: 6,
        baseCost: 0,
        basePower: 1.9,
      }),
      makeSkill({
        id: 'voiceless_dirge',
        name: 'Cântico Sem Palavras',
        description: 'Emite um som em uma língua que ninguém em Ipêra reconhece.',
        kind: 'magical',
        target: 'allEnemies',
        unlockLevel: 1,
        baseCooldown: 10,
        baseCost: 0,
        basePower: 2.0,
      }),
      makeSkill({
        id: 'voiceless_hollow_echo',
        name: 'Eco Oco',
        description: 'Um golpe final que ecoa como se viesse de muito mais longe do que Ipêra.',
        kind: 'magical',
        target: 'enemy',
        unlockLevel: 1,
        baseCooldown: 13,
        baseCost: 0,
        basePower: 2.2,
      }),
    ],
  },
];

export function getBossById(id: string): EnemyDefinition | undefined {
  return BOSS_DEFINITIONS.find((b) => b.id === id);
}
