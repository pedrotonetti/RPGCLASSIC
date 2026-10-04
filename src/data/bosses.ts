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
 *
 * Like `data/enemies.ts`, these are BASE sheets: every fight scales them by
 * `config/balance.ts`'s shared curve (bosses get its flat `bossHpMult`).
 */
// --- boss_root_ooze's own skills (named so its base kit and phase-2 kit can
// share the same objects by reference — see EnemyDefinition.phases). ------
const OOZE_CORROSIVE_SLAM = makeSkill({ id: 'ooze_corrosive_slam', name: 'Investida Corrosiva', description: 'Arremessa o próprio corpo ácido contra o alvo.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.6 });
const OOZE_SPORE_BURST = makeSkill({ id: 'ooze_spore_burst', name: 'Esporos da Sede', description: 'Libera os esporos corrosivos que a Sede deixou nela, abrindo feridas que sangram.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 9, baseCost: 0, basePower: 1.8, inflicts: { type: 'bleed', chance: 0.5 } });
/** Phase-2 signature move. */
const OOZE_ACID_DELUGE = makeSkill({ id: 'ooze_acid_deluge', name: 'Dilúvio Ácido', description: 'Se contorce e derrama uma nuvem de esporos densa o bastante para abrir feridas profundas.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 10, baseCost: 0, basePower: 2.0, inflicts: { type: 'bleed', chance: 0.65 } });

// --- boss_bark_warden's own skills. ---------------------------------------
const WARDEN_ROOT_GRASP = makeSkill({ id: 'warden_root_grasp', name: 'Garras de Raiz', description: 'Prende o alvo com raízes retorcidas que brotam do chão.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.7 });
const WARDEN_BARK_SLAM = makeSkill({ id: 'warden_bark_slam', name: 'Impacto de Casca', description: 'Um golpe pesado que racha o chão de casca petrificada ao redor.', kind: 'physical', target: 'allEnemies', unlockLevel: 1, baseCooldown: 11, baseCost: 0, basePower: 1.6 });
const WARDEN_SAP_DRAIN = makeSkill({ id: 'warden_sap_drain', name: 'Sugar Seiva', description: 'Drena a seiva vital do alvo para si mesma.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 9, baseCost: 0, basePower: 1.5 });
/** Phase-2 signature move. */
const WARDEN_THORN_BARRAGE = makeSkill({ id: 'warden_thorn_barrage', name: 'Rajada de Espinhos', description: 'Racha ainda mais e dispara uma saraivada de espinhos de casca.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 8, baseCost: 0, basePower: 1.9, inflicts: { type: 'bleed', chance: 0.4 } });
const WARDEN_PHASE_2_SKILLS = [WARDEN_ROOT_GRASP, WARDEN_BARK_SLAM, WARDEN_SAP_DRAIN, WARDEN_THORN_BARRAGE];

// --- boss_voiceless_root's own skills. -------------------------------------
const VOICELESS_REND = makeSkill({ id: 'voiceless_rend', name: 'Dilacerar Ancestral', description: 'Rasga o ar com garras mais antigas que qualquer ipê de Ipêra.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.9 });
const VOICELESS_DIRGE = makeSkill({ id: 'voiceless_dirge', name: 'Cântico Sem Palavras', description: 'Emite um som em uma língua que ninguém em Ipêra reconhece.', kind: 'magical', target: 'allEnemies', unlockLevel: 1, baseCooldown: 10, baseCost: 0, basePower: 2.0 });
const VOICELESS_HOLLOW_ECHO = makeSkill({ id: 'voiceless_hollow_echo', name: 'Eco Oco', description: 'Um golpe final que ecoa como se viesse de muito mais longe do que Ipêra.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 13, baseCost: 0, basePower: 2.2 });
/** Phase-2/3 signature move. */
const VOICELESS_DEEP_WHISPER = makeSkill({ id: 'voiceless_deep_whisper', name: 'Sussurro Profundo', description: 'Baixa o cântico para um sussurro que dói mais fundo do que qualquer grito.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 9, baseCost: 0, basePower: 2.1, inflicts: { type: 'bleed', chance: 0.55 } });
const VOICELESS_LATE_SKILLS = [VOICELESS_REND, VOICELESS_DIRGE, VOICELESS_HOLLOW_ECHO, VOICELESS_DEEP_WHISPER];

export const BOSS_DEFINITIONS: EnemyDefinition[] = [
  {
    id: 'boss_root_ooze',
    name: 'Matriarca-Geleia',
    color: 0x4b1f5e,
    isBoss: true,
    archetype: 'controller',
    weaknesses: ['fire'],
    resistances: ['dark'],
    level: 9, // clearly above the early-game monster curve (goblin=3..troll=10) it's fought alongside, matching a boss's step up over wandering enemies at the same recommended character level
    stats: { maxHp: 100, maxMp: 20, attack: 12, magicAttack: 7, defense: 6, magicDefense: 5, speed: 4, luck: 4 },
    xpReward: 70,
    goldReward: 55,
    actionInterval: 2.6,
    skills: [OOZE_CORROSIVE_SLAM, OOZE_SPORE_BURST],
    // Fase 3 (PDF section 7): uma única virada de padrão a meio da luta —
    // ver systems/BossPhaseSystem.ts.
    phases: [
      {},
      {
        hpThreshold: 0.5,
        transitionText: 'A Matriarca-Geleia se contorce e libera uma nuvem de esporos ainda mais densa.',
        skills: [OOZE_CORROSIVE_SLAM, OOZE_SPORE_BURST, OOZE_ACID_DELUGE],
        damageMult: 1.15,
      },
    ],
  },
  {
    id: 'boss_bark_warden',
    name: 'Guardiã de Casca',
    color: 0x6a5a3a,
    isBoss: true,
    archetype: 'guardian',
    weaknesses: ['fire'],
    resistances: ['ice'],
    level: 13, // above stone_golem (11), the toughest regular enemy near this dungeon's recommended level
    stats: { maxHp: 170, maxMp: 30, attack: 16, magicAttack: 8, defense: 12, magicDefense: 9, speed: 3, luck: 4 },
    xpReward: 110,
    goldReward: 90,
    actionInterval: 2.8,
    skills: [WARDEN_ROOT_GRASP, WARDEN_BARK_SLAM, WARDEN_SAP_DRAIN],
    phases: [
      {},
      {
        hpThreshold: 0.5,
        transitionText: 'A Guardiã de Casca racha ainda mais, mas não cede — e agora dispara espinhos.',
        skills: WARDEN_PHASE_2_SKILLS,
        actionIntervalMult: 0.9,
      },
    ],
  },
  {
    id: 'boss_voiceless_root',
    name: 'A Raiz Sem Voz',
    color: 0x2a2f28,
    isBoss: true,
    archetype: 'berserker',
    weaknesses: ['holy'],
    resistances: ['dark'],
    level: 20, // above young_dragon (18, the base story's own final boss) — this dungeon is framed as content beyond that climax, and its loot should say so too
    stats: { maxHp: 340, maxMp: 60, attack: 24, magicAttack: 22, defense: 14, magicDefense: 14, speed: 6, luck: 6 },
    xpReward: 260,
    goldReward: 220,
    actionInterval: 2.3,
    skills: [VOICELESS_REND, VOICELESS_DIRGE, VOICELESS_HOLLOW_ECHO],
    // Fase 3 (PDF section 7) — o chefe mais forte do jogo ganha o tratamento
    // completo de 3 fases: padrão básico, uma nova skill a meio da luta, e
    // um desespero final mais rápido e mais forte perto do fim.
    phases: [
      {},
      {
        hpThreshold: 0.65,
        transitionText: 'A Raiz Sem Voz baixa o cântico para um sussurro que dói mais fundo.',
        skills: VOICELESS_LATE_SKILLS,
      },
      {
        hpThreshold: 0.3,
        transitionText: 'Não resta silêncio algum — cada eco agora é um grito.',
        skills: VOICELESS_LATE_SKILLS,
        damageMult: 1.25,
        actionIntervalMult: 0.8,
      },
    ],
  },
];

export function getBossById(id: string): EnemyDefinition | undefined {
  return BOSS_DEFINITIONS.find((b) => b.id === id);
}
