import { makeSkill } from '../systems/skillMath';
import type { EnemyDefinition } from '../config/types';

/**
 * `young_dragon`'s own skills, named (not inline in its `skills`/`phases`
 * fields) purely so its base kit and its expanded phase-2/3 kit (see its own
 * `phases` field below and `systems/BossPhaseSystem.ts`) can share the exact
 * same objects by reference instead of duplicating them.
 */
const DRAGON_CLAW = makeSkill({ id: 'dragon_claw', name: 'Garras Afiadas', description: 'Um ataque veloz com as garras.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.8 });
const DRAGON_BREATH = makeSkill({ id: 'dragon_breath', name: 'Sopro Flamejante', description: 'Um sopro de fogo que atinge tudo à frente e deixa queimaduras.', kind: 'magical', target: 'allEnemies', unlockLevel: 1, baseCooldown: 11, baseCost: 0, basePower: 1.9, inflicts: { type: 'burn', chance: 0.45 } });
/** Phase-2/3 signature move — see below. */
const DRAGON_CORRUPTED_ROAR = makeSkill({
  id: 'dragon_corrupted_roar',
  name: 'Rugido Corrompido',
  description: 'Um rugido que rasga o ar com a fome da Sede, queimando tudo ao redor.',
  kind: 'magical',
  target: 'allEnemies',
  unlockLevel: 1,
  baseCooldown: 9,
  baseCost: 0,
  basePower: 2.1,
  inflicts: { type: 'burn', chance: 0.6 },
});
const DRAGON_ENRAGED_SKILLS = [DRAGON_CLAW, DRAGON_BREATH, DRAGON_CORRUPTED_ROAR];

/**
 * Ordered roughly from weakest to strongest. `EncounterSystem` picks among
 * the enemies whose intended level is close to the player's level. Each
 * enemy acts on its own real-time timer (`actionInterval`, in seconds).
 *
 * `level` is this enemy's own difficulty tier (see the field's doc comment
 * in `config/types.ts`) — assigned here in step with this list's existing
 * weakest-to-strongest order and each entry's hand-tuned stats/xpReward/
 * goldReward. It climbs roughly 1-11 across the 11 regular enemies (matching
 * `EncounterSystem`'s own array-index-based "intended level" for this same
 * ordering), then jumps well past that curve for the one boss: q6_dragon
 * (see `data/quests.ts`) gates the fight behind reaching character level 10
 * and pays out ~2.5x any regular enemy's xp/gold and a guaranteed mythic
 * reward, so `young_dragon` is tuned here as a levels-above-the-pack spike
 * rather than "one more step" in the regular sequence.
 *
 * Every `name` below is written to read as LORE.md frames these fights: "os
 * monstros que o jogador enfrenta não são monstros aleatórios — são
 * ancestrais e criaturas que a Sede virou do avesso" — a corrupted Raiz, an
 * ancestor's memory, or an ordinary creature/traveler twisted by the Sede's
 * drought-like hunger, never a stock generic-fantasy label. `id` (used by
 * quest objectives, dungeon encounter pods, `monsterIds`, etc.) is left
 * untouched — only the display `name`/flavor changed here, per this file's
 * scope (no stat/balance changes). Every enemy id is currently a single
 * global name — this schema has no per-zone name override, so an id reused
 * across several villages' `monsterIds` (e.g. `goblin`, `bat`) always shows
 * the same name everywhere it's fought; see this session's report for the
 * regional-variant question this raises.
 *
 * `stats` below are the hand-authored BASE sheets — every fight actually
 * uses them scaled by the shared difficulty curve in `config/balance.ts`
 * (more HP at every tier, more attack at the low tiers, an armor floor on
 * every enemy hit). Re-tune difficulty there, not by editing these lines.
 */
export const ENEMY_DEFINITIONS: EnemyDefinition[] = [
  {
    id: 'slime',
    // A pool of Ipê sap that never dried into bark — the Sede curdled it mid-flow, so it slithers instead of settling.
    name: 'Seiva Ressequida',
    color: 0x6fcf97,
    stats: { maxHp: 16, maxMp: 0, attack: 4, magicAttack: 0, defense: 2, magicDefense: 1, speed: 3, luck: 2 },
    xpReward: 8,
    goldReward: 5,
    actionInterval: 3.2,
    skills: [],
    level: 1,
    archetype: 'guardian',
    weaknesses: ['fire'],
  },
  {
    id: 'bat',
    // An ancestor's warning, given wings and fangs instead of a voice — the same "sussurro" the Root Hollow dungeon is named for.
    name: 'Sussurro Alado',
    color: 0x9b59b6,
    stats: { maxHp: 14, maxMp: 0, attack: 5, magicAttack: 0, defense: 1, magicDefense: 1, speed: 8, luck: 4 },
    xpReward: 10,
    goldReward: 6,
    actionInterval: 2.2,
    skills: [],
    level: 2,
    archetype: 'ambusher',
    weaknesses: ['physical'],
    resistances: ['dark'],
  },
  {
    id: 'goblin',
    // A sapling of the Verdegal, budded and corrupted before it ever grew into a proper Ipê — small, quick, feral.
    name: 'Broto Retorcido',
    color: 0x7a8b3f,
    stats: { maxHp: 22, maxMp: 6, attack: 6, magicAttack: 1, defense: 3, magicDefense: 2, speed: 5, luck: 3 },
    xpReward: 14,
    goldReward: 10,
    actionInterval: 2.8,
    skills: [
      makeSkill({ id: 'goblin_slash', name: 'Golpe Sujo', description: 'Um ataque físico rápido e traiçoeiro.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.4 }),
    ],
    level: 3,
    archetype: 'predator',
    weaknesses: ['fire'],
  },
  {
    id: 'bandit',
    // A traveler the Sede's hunger drove feral before it ever twisted their body — still human-shaped, already lost.
    name: 'Andarilho Sedento',
    color: 0x8a6a3f,
    stats: { maxHp: 26, maxMp: 8, attack: 8, magicAttack: 1, defense: 4, magicDefense: 3, speed: 6, luck: 5 },
    xpReward: 17,
    goldReward: 16,
    actionInterval: 2.6,
    skills: [
      makeSkill({ id: 'bandit_ambush', name: 'Emboscada', description: 'Ataca de surpresa por trás.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.6 }),
    ],
    level: 4,
    archetype: 'ambusher',
  },
  {
    id: 'dark_wolf',
    // Already lore-fitting as-is — a wolf pack given shadow-shape by the Sede (see e.g. Nair's own chain in data/quests.ts) — left unchanged.
    name: 'Lobo Sombrio',
    color: 0x4a4a58,
    stats: { maxHp: 32, maxMp: 0, attack: 9, magicAttack: 0, defense: 4, magicDefense: 3, speed: 7, luck: 5 },
    xpReward: 22,
    goldReward: 18,
    actionInterval: 2.4,
    skills: [
      makeSkill({ id: 'wolf_bite', name: 'Mordida Feroz', description: 'Uma mordida selvagem com dano elevado.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.6 }),
    ],
    level: 5,
    archetype: 'predator',
    weaknesses: ['holy'],
    resistances: ['dark'],
  },
  {
    id: 'skeleton',
    // Literally an ancestor whose bones should have rested in the Raízes — the Sede's rot instead pulled them back up.
    name: 'Ancestral Descarnado',
    color: 0xd8d0c0,
    stats: { maxHp: 30, maxMp: 6, attack: 9, magicAttack: 2, defense: 6, magicDefense: 2, speed: 4, luck: 3 },
    xpReward: 24,
    goldReward: 18,
    actionInterval: 3.0,
    skills: [
      makeSkill({ id: 'skeleton_bone_throw', name: 'Arremesso de Ossos', description: 'Arremessa fragmentos ósseos afiados.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.5 }),
      // Suporte archetype's own real behavior (see systems/enemyArchetypes.ts and CombatSystem.resolveEnemySupportHeal): a self/ally heal, so an ancestor's rot-pulled bones knit back together mid-fight instead of just attacking.
      makeSkill({ id: 'skeleton_bone_mend', name: 'Remendo Ancestral', description: 'Chama fragmentos ósseos de volta para remendar a si mesmo.', kind: 'heal', target: 'self', unlockLevel: 1, baseCooldown: 10, baseCost: 0, basePower: 1.8 }),
    ],
    level: 6,
    archetype: 'support',
    weaknesses: ['physical', 'holy'],
    resistances: ['dark'],
  },
  {
    id: 'giant_spider',
    // Spins webs of dried root-fiber instead of silk — the Sede's own drought given a broodmother.
    name: 'Tecelã da Sede',
    color: 0x3a2f3a,
    stats: { maxHp: 28, maxMp: 10, attack: 8, magicAttack: 4, defense: 4, magicDefense: 4, speed: 9, luck: 6 },
    xpReward: 26,
    goldReward: 20,
    actionInterval: 2.3,
    skills: [
      // Fase 3 (systems/statusSynergies.ts): 'bleed' -> 'poison' now that the
      // type exists — "veneno corrosivo" was always poison in everything but
      // mechanics, and this also makes Combustão Tóxica (poison+burn) and
      // Paralisia Tóxica (poison+slow) reachable against a real enemy.
      makeSkill({ id: 'spider_venom', name: 'Picada Venenosa', description: 'Injeta veneno corrosivo no alvo.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.7, inflicts: { type: 'poison', chance: 0.5 } }),
    ],
    level: 7,
    archetype: 'controller',
    weaknesses: ['fire'],
  },
  {
    id: 'orc',
    // An ancestor-spirit the Sede fused to bark and stone until only the brute strength remained.
    name: 'Guerreiro de Casca Rachada',
    color: 0x5a7a3f,
    stats: { maxHp: 42, maxMp: 8, attack: 12, magicAttack: 1, defense: 7, magicDefense: 4, speed: 5, luck: 4 },
    xpReward: 34,
    goldReward: 28,
    actionInterval: 3.0,
    skills: [
      makeSkill({ id: 'orc_cleave', name: 'Golpe Cortante', description: 'Um golpe pesado de machado.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 8, baseCost: 0, basePower: 1.8 }),
    ],
    level: 8,
    archetype: 'tank',
    weaknesses: ['fire'],
    resistances: ['ice'],
  },
  {
    id: 'fire_elemental',
    // A flame the Sede's hunger never lets die — always burning, never fed enough (see the Rastro de Cinzas bounty in data/quests.ts).
    name: 'Brasa Faminta',
    color: 0xe0602d,
    stats: { maxHp: 36, maxMp: 20, attack: 4, magicAttack: 14, defense: 5, magicDefense: 8, speed: 6, luck: 5 },
    xpReward: 38,
    goldReward: 30,
    actionInterval: 2.6,
    skills: [
      makeSkill({ id: 'elemental_flame_burst', name: 'Explosão Flamejante', description: 'Libera uma onda de fogo que deixa o alvo queimando.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.9, inflicts: { type: 'burn', chance: 0.55 } }),
    ],
    level: 9,
    archetype: 'berserker',
    weaknesses: ['ice'],
    resistances: ['fire'],
  },
  {
    id: 'troll',
    // A serra guardian left parched and maddened by the same drought the Sede spreads through every root — hence its own pull toward the last open water (see the Contrato: O Troll da Lagoa bounty).
    name: 'Colosso Ressequido',
    color: 0x6a7a6a,
    stats: { maxHp: 60, maxMp: 4, attack: 14, magicAttack: 2, defense: 9, magicDefense: 5, speed: 3, luck: 3 },
    xpReward: 48,
    goldReward: 40,
    actionInterval: 3.4,
    skills: [
      makeSkill({ id: 'troll_smash', name: 'Esmagar', description: 'Um golpe brutal com os punhos.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 9, baseCost: 0, basePower: 2.0 }),
    ],
    level: 10,
    archetype: 'berserker',
    weaknesses: ['ice'],
  },
  {
    id: 'stone_golem',
    // An old sentinel Raiz fused to stone generations ago, still lumbering its post — hollowed and cracked by the Sede's drought instead of the ordinary wear of time.
    name: 'Guardião de Pedra Rachada',
    color: 0x8a8478,
    stats: { maxHp: 80, maxMp: 0, attack: 13, magicAttack: 0, defense: 14, magicDefense: 10, speed: 2, luck: 2 },
    xpReward: 56,
    goldReward: 46,
    actionInterval: 3.8,
    skills: [
      makeSkill({ id: 'golem_slam', name: 'Impacto Sísmico', description: 'Bate no chão com força devastadora.', kind: 'physical', target: 'allEnemies', unlockLevel: 1, baseCooldown: 12, baseCost: 0, basePower: 1.6 }),
    ],
    level: 11,
    archetype: 'guardian',
    weaknesses: ['ice'],
    resistances: ['physical'],
  },

  // --- Expansão de conteúdo: criaturas regionais ----------------------------
  // Ten more regular enemies, each a piece of Ipêra's own fauna/folk life the
  // Sede turned inside out — placed into specific zone pools (data/zones.ts,
  // data/classZones.ts) and quests (data/quests.ts) instead of being generic
  // filler. None has a bespoke 3D builder: each borrows an original enemy's
  // silhouette through `modelId`/`modelScale` (see config/types.ts and
  // render/characterModel.ts's buildBorrowedEnemyModel), tinted with its own
  // color. Stats follow the same hand-authored scale as the originals at the
  // same `level` — config/balance.ts layers the real difficulty curve on top.
  {
    id: 'sauva_ressequida',
    // Leaf-cutter ants that still cut — but now carry the green DOWN, into the roots, to feed whatever drinks there.
    name: 'Saúva Ressequida',
    color: 0xa0522d,
    stats: { maxHp: 15, maxMp: 0, attack: 5, magicAttack: 0, defense: 2, magicDefense: 1, speed: 7, luck: 3 },
    xpReward: 11,
    goldReward: 6,
    actionInterval: 2.4,
    skills: [
      makeSkill({ id: 'sauva_mandibula', name: 'Mandíbula Cortante', description: 'Corta como corta folha — e deixa a ferida aberta.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.3, inflicts: { type: 'bleed', chance: 0.25 } }),
    ],
    level: 2,
    archetype: 'predator',
    weaknesses: ['fire'],
    modelId: 'giant_spider',
    modelScale: 0.55,
  },
  {
    id: 'vagalume_brasa',
    // A firefly whose light the Sede turned into ember — it glows because it is burning from the inside.
    name: 'Vagalume de Brasa',
    color: 0xf2c14e,
    stats: { maxHp: 16, maxMp: 8, attack: 2, magicAttack: 7, defense: 1, magicDefense: 4, speed: 9, luck: 5 },
    xpReward: 13,
    goldReward: 8,
    actionInterval: 2.4,
    skills: [
      makeSkill({ id: 'vagalume_faisca', name: 'Faísca Errante', description: 'Uma fagulha que gruda na pele e continua queimando.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.4, inflicts: { type: 'burn', chance: 0.3 } }),
    ],
    level: 3,
    archetype: 'ambusher',
    weaknesses: ['ice'],
    resistances: ['fire'],
    modelId: 'fire_elemental',
    modelScale: 0.5,
  },
  {
    id: 'capivara_ressequida',
    // The calmest animal of the brejos, left with no water to sit in — the Sede made it stubborn, heavy and mean.
    name: 'Capivara do Brejo Seco',
    color: 0x8b6b4a,
    stats: { maxHp: 34, maxMp: 0, attack: 6, magicAttack: 0, defense: 6, magicDefense: 2, speed: 3, luck: 2 },
    xpReward: 18,
    goldReward: 12,
    actionInterval: 3.2,
    skills: [
      makeSkill({ id: 'capivara_investida', name: 'Investida Lamacenta', description: 'Avança com o peso todo e deixa o alvo atolado.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 8, baseCost: 0, basePower: 1.5, inflicts: { type: 'slow', chance: 0.3 } }),
    ],
    level: 4,
    archetype: 'tank',
    weaknesses: ['fire'],
    modelId: 'dark_wolf',
    modelScale: 0.9,
  },
  {
    id: 'espantalho_seca',
    // A roça scarecrow stuffed with dry Ipê straw — a hungry Raiz crawled into the straw and now it guards the field against the living.
    name: 'Espantalho da Seca',
    color: 0xc9a65a,
    stats: { maxHp: 28, maxMp: 10, attack: 6, magicAttack: 6, defense: 4, magicDefense: 3, speed: 5, luck: 4 },
    xpReward: 21,
    goldReward: 15,
    actionInterval: 2.8,
    skills: [
      makeSkill({ id: 'espantalho_palha', name: 'Palha Sufocante', description: 'Uma nuvem de palha seca que prende os movimentos.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.5, inflicts: { type: 'slow', chance: 0.45 } }),
    ],
    level: 5,
    archetype: 'controller',
    weaknesses: ['fire'],
    resistances: ['dark'],
    modelId: 'bandit',
    modelScale: 1,
  },
  {
    id: 'lobo_guara_sombrio',
    // The long-legged, solitary wolf of the cerrado — never a pack hunter before the Sede gave it a hunger too big for one.
    name: 'Lobo-Guará Sombrio',
    color: 0xb5542c,
    stats: { maxHp: 33, maxMp: 0, attack: 10, magicAttack: 0, defense: 4, magicDefense: 3, speed: 9, luck: 6 },
    xpReward: 25,
    goldReward: 19,
    actionInterval: 2.3,
    skills: [
      makeSkill({ id: 'guara_rasgo', name: 'Rasgo Esguio', description: 'Uma mordida rápida, de passagem, que abre um corte fundo.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 6, baseCost: 0, basePower: 1.6, inflicts: { type: 'bleed', chance: 0.35 } }),
    ],
    level: 6,
    archetype: 'predator',
    weaknesses: ['holy'],
    resistances: ['dark'],
    modelId: 'dark_wolf',
    modelScale: 1.15,
  },
  {
    id: 'guardiao_cipo',
    // A Raiz that wrapped itself in vines to shield the last saplings — it still shields them, from everyone.
    name: 'Guardião de Cipó',
    color: 0x4f7a3a,
    stats: { maxHp: 36, maxMp: 14, attack: 7, magicAttack: 7, defense: 6, magicDefense: 6, speed: 4, luck: 4 },
    xpReward: 28,
    goldReward: 22,
    actionInterval: 3.0,
    skills: [
      makeSkill({ id: 'cipo_laco', name: 'Laço de Cipó', description: 'Um cipó que se enrola nas pernas do alvo.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 1.4, inflicts: { type: 'slow', chance: 0.4 } }),
      // Same support behavior as the skeleton's own Remendo Ancestral (see systems/enemyArchetypes.ts).
      makeSkill({ id: 'cipo_seiva', name: 'Seiva Restauradora', description: 'Puxa seiva da terra para fechar as próprias rachaduras.', kind: 'heal', target: 'self', unlockLevel: 1, baseCooldown: 11, baseCost: 0, basePower: 1.6 }),
    ],
    level: 7,
    archetype: 'support',
    weaknesses: ['fire'],
    resistances: ['ice'],
    modelId: 'orc',
    modelScale: 1,
  },
  {
    id: 'carpideira_sedenta',
    // A mourner ancestor, paid once to weep at funerals — the Sede left her the weeping and took the tears.
    name: 'Carpideira Sedenta',
    color: 0x5b4a6e,
    stats: { maxHp: 30, maxMp: 20, attack: 3, magicAttack: 12, defense: 4, magicDefense: 8, speed: 6, luck: 5 },
    xpReward: 33,
    goldReward: 27,
    actionInterval: 2.7,
    skills: [
      makeSkill({ id: 'carpideira_lamento', name: 'Lamento Seco', description: 'Um choro sem lágrimas que gela até o osso.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 8, baseCost: 0, basePower: 1.7, inflicts: { type: 'freeze', chance: 0.25 } }),
    ],
    level: 8,
    archetype: 'controller',
    weaknesses: ['holy'],
    resistances: ['dark'],
    modelId: 'skeleton',
    modelScale: 0.95,
  },
  {
    id: 'jacare_leito',
    // Caimans stranded in the mud of the Vau's dried riverbed — they kept waiting for the water, and the Sede answered instead.
    name: 'Jacaré do Leito Seco',
    color: 0x4d5a3a,
    stats: { maxHp: 52, maxMp: 0, attack: 12, magicAttack: 0, defense: 10, magicDefense: 4, speed: 4, luck: 3 },
    xpReward: 40,
    goldReward: 32,
    actionInterval: 3.3,
    skills: [
      makeSkill({ id: 'jacare_bote', name: 'Bote do Leito', description: 'Uma bocada de surpresa, de dentro da lama.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 8, baseCost: 0, basePower: 1.9, inflicts: { type: 'bleed', chance: 0.35 } }),
    ],
    level: 9,
    archetype: 'tank',
    weaknesses: ['magical'],
    resistances: ['physical'],
    modelId: 'dark_wolf',
    modelScale: 1.3,
  },
  {
    id: 'colosso_sal',
    // A Zeladores-era sentinel buried in the beach sand below the Baluarte, crusted in sea salt until the salt itself learned to walk.
    name: 'Colosso de Sal',
    color: 0xd9d4c7,
    stats: { maxHp: 86, maxMp: 0, attack: 15, magicAttack: 0, defense: 15, magicDefense: 9, speed: 2, luck: 2 },
    xpReward: 62,
    goldReward: 50,
    actionInterval: 3.8,
    skills: [
      makeSkill({ id: 'sal_estilhaco', name: 'Estilhaço de Sal', description: 'Bate o corpo no chão e espalha cristais cortantes que travam os passos.', kind: 'physical', target: 'allEnemies', unlockLevel: 1, baseCooldown: 12, baseCost: 0, basePower: 1.7, inflicts: { type: 'slow', chance: 0.4 } }),
    ],
    level: 12,
    archetype: 'guardian',
    weaknesses: ['magical'],
    resistances: ['physical', 'ice'],
    modelId: 'stone_golem',
    modelScale: 1.1,
  },
  {
    id: 'raiz_sem_patria',
    // The roots the tide brings to the Baluarte's beach (see Batedora Inaê in data/npcs.ts): Ipê-shaped, but no Ipê of Ipêra — and it does not speak our language.
    name: 'Raiz Sem Pátria',
    color: 0x2e5a6a,
    stats: { maxHp: 64, maxMp: 30, attack: 8, magicAttack: 17, defense: 8, magicDefense: 12, speed: 7, luck: 6 },
    xpReward: 70,
    goldReward: 55,
    actionInterval: 2.6,
    skills: [
      makeSkill({ id: 'raiz_sussurro_estrangeiro', name: 'Sussurro Estrangeiro', description: 'Palavras numa língua sem raiz em Ipêra — e que envenenam quem as ouve.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 7, baseCost: 0, basePower: 2.0, inflicts: { type: 'poison', chance: 0.45 } }),
      makeSkill({ id: 'raiz_amarra_salgada', name: 'Amarra Salgada', description: 'Raízes molhadas de mar que prendem e gelam.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 10, baseCost: 0, basePower: 1.5, inflicts: { type: 'freeze', chance: 0.3 } }),
    ],
    level: 13,
    archetype: 'controller',
    weaknesses: ['fire'],
    // Ipêra's own ancestors (holy) and its own Sede (dark) both slide off something that was never theirs.
    resistances: ['holy', 'dark'],
    modelId: 'giant_spider',
    modelScale: 1.4,
  },
  {
    id: 'young_dragon',
    // Already lore-fitting as-is — see q6_dragon's own description in data/quests.ts ("um antigo guardião... corrompido pela Sede") — left unchanged.
    name: 'Guardião-Dragão Corrompido',
    color: 0xc73a3a,
    isBoss: true,
    stats: { maxHp: 160, maxMp: 40, attack: 18, magicAttack: 16, defense: 10, magicDefense: 10, speed: 7, luck: 6 },
    xpReward: 140,
    goldReward: 120,
    actionInterval: 2.6,
    skills: [DRAGON_CLAW, DRAGON_BREATH],
    level: 18,
    archetype: 'berserker',
    weaknesses: ['ice'],
    resistances: ['fire'],
    // Fase 3 (PDF section 7) — 100-65%: padrão básico (só as duas skills
    // acima). 65-30%: ganha o Rugido Corrompido. 30-0%: desesperado —
    // mesmo conjunto de skills, mas mais rápido e mais forte (ver
    // systems/BossPhaseSystem.ts; a fúria do próprio arquétipo Berserker já
    // entra em jogo em paralelo abaixo de 50%, então os multiplicadores
    // aqui ficam moderados para não somarem demais).
    phases: [
      {}, // opening phase — always active from the start, no threshold/transition of its own
      {
        hpThreshold: 0.65,
        transitionText: 'O Guardião-Dragão Corrompido ruge e suas escamas racham, vazando a Sede.',
        skills: DRAGON_ENRAGED_SKILLS,
      },
      {
        hpThreshold: 0.3,
        transitionText: 'Desesperado, o dragão arde por completo — cada movimento seu agora é uma ameaça.',
        skills: DRAGON_ENRAGED_SKILLS,
        damageMult: 1.2,
        actionIntervalMult: 0.85,
      },
    ],
  },
];

/**
 * The enemy ids `render/characterModel.ts`'s `buildEnemyModel` has a bespoke
 * builder for — the only valid values of `EnemyDefinition.modelId`.
 */
export const BESPOKE_ENEMY_MODEL_IDS: readonly string[] = [
  'slime',
  'bat',
  'goblin',
  'bandit',
  'dark_wolf',
  'skeleton',
  'giant_spider',
  'orc',
  'fire_elemental',
  'troll',
  'stone_golem',
  'young_dragon',
];

export function getEnemyById(id: string): EnemyDefinition {
  const found = ENEMY_DEFINITIONS.find((e) => e.id === id);
  if (!found) {
    throw new Error(`Inimigo desconhecido: ${id}`);
  }
  return found;
}
