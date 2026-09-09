import { makeBasicAttack, makeSkill, makeUltimate } from '../systems/skillMath';
import type { CharacterClassDefinition } from './types';

/**
 * Data-driven class registry. To add a new class for players to pick from,
 * append a new `CharacterClassDefinition` here — no other file needs to
 * change. Each class has a free basic attack, four regular tree skills
 * (level 1-10, upgraded with skill points) and one ultimate (auto-scales
 * with character level, up to 100).
 */
export const CLASS_DEFINITIONS: CharacterClassDefinition[] = [
  {
    id: 'warrior',
    name: 'Guerreiro',
    description: 'Especialista em combate corpo a corpo. Muita vida e defesa.',
    color: 0xb33a3a,
    accentColor: 0x8a8a8a,
    baseStats: { maxHp: 32, maxMp: 6, attack: 9, magicAttack: 2, defense: 7, magicDefense: 3, speed: 5, luck: 4 },
    growth: { maxHp: 6, maxMp: 1, attack: 2, magicAttack: 0, defense: 2, magicDefense: 1, speed: 1, luck: 1 },
    basicAttack: makeBasicAttack('physical'),
    skills: [
      makeSkill({ id: 'warrior_power_strike', name: 'Golpe Poderoso', description: 'Um ataque físico devastador em um inimigo.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 5, baseCost: 10, basePower: 1.6 }),
      makeSkill({ id: 'warrior_charge', name: 'Investida Brutal', description: 'Avança com força total contra o alvo.', kind: 'physical', target: 'enemy', unlockLevel: 5, baseCooldown: 8, baseCost: 14, basePower: 1.9 }),
      makeSkill({ id: 'warrior_war_cry', name: 'Grito de Guerra', description: 'Eleva sua fúria, aumentando o dano dos próximos golpes.', kind: 'buff', target: 'self', unlockLevel: 10, baseCooldown: 16, baseCost: 18, basePower: 1.2, buffStat: 'attack' }),
      makeSkill({ id: 'warrior_sweep', name: 'Fúria Implacável', description: 'Um golpe giratório que acerta todos os inimigos.', kind: 'physical', target: 'allEnemies', unlockLevel: 15, baseCooldown: 14, baseCost: 22, basePower: 1.3 }),
      makeUltimate({ id: 'warrior_ultimate', name: 'Golpe do Titã', description: 'Concentra toda sua força em um golpe devastador.', kind: 'physical', target: 'enemy', unlockLevel: 20, baseCooldown: 25, baseCost: 40, basePower: 4.0 }),
    ],
  },
  {
    id: 'mage',
    name: 'Mago',
    description: 'Domina magias ofensivas poderosas, mas é frágil fisicamente.',
    color: 0x3a5fb3,
    accentColor: 0xf2c14e,
    baseStats: { maxHp: 20, maxMp: 24, attack: 3, magicAttack: 10, defense: 3, magicDefense: 6, speed: 6, luck: 5 },
    growth: { maxHp: 3, maxMp: 5, attack: 0, magicAttack: 3, defense: 1, magicDefense: 2, speed: 1, luck: 1 },
    basicAttack: makeBasicAttack('magical'),
    skills: [
      makeSkill({ id: 'mage_fireball', name: 'Bola de Fogo', description: 'Lança uma bola de fogo que causa dano mágico.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 5, baseCost: 10, basePower: 1.8 }),
      makeSkill({ id: 'mage_ice_lance', name: 'Lança de Gelo', description: 'Uma lâmina de gelo perfurante.', kind: 'magical', target: 'enemy', unlockLevel: 5, baseCooldown: 7, baseCost: 14, basePower: 2.0 }),
      makeSkill({ id: 'mage_blizzard', name: 'Nevasca', description: 'Congela todos os inimigos com dano mágico em área.', kind: 'magical', target: 'allEnemies', unlockLevel: 10, baseCooldown: 12, baseCost: 20, basePower: 1.3 }),
      makeSkill({ id: 'mage_arcane_shield', name: 'Escudo Arcano', description: 'Envolve-se em energia que reduz o dano recebido.', kind: 'buff', target: 'self', unlockLevel: 15, baseCooldown: 18, baseCost: 16, basePower: 1.5, buffStat: 'defense' }),
      makeUltimate({ id: 'mage_ultimate', name: 'Meteoro Arcano', description: 'Invoca um meteoro que arrasa todos os inimigos.', kind: 'magical', target: 'allEnemies', unlockLevel: 20, baseCooldown: 28, baseCost: 45, basePower: 2.6 }),
    ],
  },
  {
    id: 'archer',
    name: 'Arqueiro',
    description: 'Rápido e preciso, equilibra dano físico e velocidade.',
    color: 0x3fae5b,
    accentColor: 0x6b4423,
    baseStats: { maxHp: 26, maxMp: 10, attack: 8, magicAttack: 3, defense: 4, magicDefense: 4, speed: 9, luck: 7 },
    growth: { maxHp: 4, maxMp: 2, attack: 2, magicAttack: 0, defense: 1, magicDefense: 1, speed: 2, luck: 2 },
    basicAttack: makeBasicAttack('physical'),
    skills: [
      makeSkill({ id: 'archer_precise_shot', name: 'Tiro Certeiro', description: 'Uma flecha certeira com alta chance de acerto crítico.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 4, baseCost: 8, basePower: 1.7 }),
      makeSkill({ id: 'archer_piercing_shot', name: 'Tiro Perfurante', description: 'Atravessa a armadura do alvo.', kind: 'physical', target: 'enemy', unlockLevel: 5, baseCooldown: 7, baseCost: 12, basePower: 2.0 }),
      makeSkill({ id: 'archer_arrow_rain', name: 'Chuva de Flechas', description: 'Dispara flechas contra todos os inimigos.', kind: 'physical', target: 'allEnemies', unlockLevel: 10, baseCooldown: 11, baseCost: 18, basePower: 1.2 }),
      makeSkill({ id: 'archer_agile_step', name: 'Passo Ágil', description: 'Aumenta sua velocidade e precisão por um tempo.', kind: 'buff', target: 'self', unlockLevel: 15, baseCooldown: 15, baseCost: 14, basePower: 1.4, buffStat: 'speed' }),
      makeUltimate({ id: 'archer_ultimate', name: 'Tempestade de Flechas', description: 'Um dilúvio de flechas cobre todo o campo de batalha.', kind: 'physical', target: 'allEnemies', unlockLevel: 20, baseCooldown: 24, baseCost: 38, basePower: 2.4 }),
    ],
  },
  {
    id: 'cleric',
    name: 'Clérigo',
    description: 'Suporte devoto, capaz de curar ferimentos e punir inimigos.',
    color: 0xe0c34a,
    accentColor: 0xf2ede1,
    baseStats: { maxHp: 24, maxMp: 20, attack: 4, magicAttack: 7, defense: 5, magicDefense: 7, speed: 5, luck: 6 },
    growth: { maxHp: 4, maxMp: 4, attack: 1, magicAttack: 2, defense: 1, magicDefense: 2, speed: 1, luck: 1 },
    basicAttack: makeBasicAttack('magical'),
    skills: [
      makeSkill({ id: 'cleric_heal', name: 'Cura', description: 'Restaura uma boa quantidade de pontos de vida.', kind: 'heal', target: 'self', unlockLevel: 1, baseCooldown: 6, baseCost: 10, basePower: 2.2 }),
      makeSkill({ id: 'cleric_smite', name: 'Julgamento', description: 'Invoca energia sagrada contra um inimigo.', kind: 'magical', target: 'enemy', unlockLevel: 5, baseCooldown: 7, baseCost: 12, basePower: 1.7 }),
      makeSkill({ id: 'cleric_blessing', name: 'Bênção', description: 'Reduz o dano mágico recebido por um tempo.', kind: 'buff', target: 'self', unlockLevel: 10, baseCooldown: 14, baseCost: 16, basePower: 1.5, buffStat: 'magicDefense' }),
      makeSkill({ id: 'cleric_light', name: 'Luz Purificadora', description: 'Uma cura poderosa que remove aflições.', kind: 'heal', target: 'self', unlockLevel: 15, baseCooldown: 16, baseCost: 22, basePower: 3.0 }),
      makeUltimate({ id: 'cleric_ultimate', name: 'Renascimento Divino', description: 'Energia divina restaura quase toda a sua vitalidade.', kind: 'heal', target: 'self', unlockLevel: 20, baseCooldown: 30, baseCost: 40, basePower: 5.0 }),
    ],
  },
  {
    id: 'paladin',
    name: 'Paladino',
    description: 'Guerreiro sagrado, resistente e capaz de se curar em combate.',
    color: 0xcfd6dc,
    accentColor: 0xf2c14e,
    baseStats: { maxHp: 34, maxMp: 16, attack: 7, magicAttack: 5, defense: 8, magicDefense: 6, speed: 4, luck: 4 },
    growth: { maxHp: 6, maxMp: 3, attack: 1, magicAttack: 1, defense: 2, magicDefense: 2, speed: 1, luck: 1 },
    basicAttack: makeBasicAttack('physical'),
    skills: [
      makeSkill({ id: 'paladin_holy_strike', name: 'Golpe Sagrado', description: 'Um golpe abençoado contra um inimigo.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 5, baseCost: 10, basePower: 1.6 }),
      makeSkill({ id: 'paladin_divine_shield', name: 'Escudo Divino', description: 'Uma barreira sagrada reduz o dano recebido.', kind: 'buff', target: 'self', unlockLevel: 5, baseCooldown: 10, baseCost: 14, basePower: 1.6, buffStat: 'defense' }),
      makeSkill({ id: 'paladin_judgement_hammer', name: 'Martelo da Justiça', description: 'Um golpe pesado com energia sagrada.', kind: 'physical', target: 'enemy', unlockLevel: 10, baseCooldown: 9, baseCost: 16, basePower: 2.1 }),
      makeSkill({ id: 'paladin_aura', name: 'Aura de Proteção', description: 'Uma aura sagrada restaura parte da sua vida.', kind: 'heal', target: 'self', unlockLevel: 15, baseCooldown: 16, baseCost: 18, basePower: 2.0 }),
      makeUltimate({ id: 'paladin_ultimate', name: 'Julgamento Celestial', description: 'Convoca a fúria dos céus sobre todos os inimigos.', kind: 'physical', target: 'allEnemies', unlockLevel: 20, baseCooldown: 26, baseCost: 42, basePower: 2.8 }),
    ],
  },
  {
    id: 'assassin',
    name: 'Assassino',
    description: 'Ataca das sombras com velocidade e precisão mortais.',
    color: 0x2a2a35,
    accentColor: 0x8a2be2,
    baseStats: { maxHp: 22, maxMp: 12, attack: 10, magicAttack: 2, defense: 3, magicDefense: 3, speed: 11, luck: 9 },
    growth: { maxHp: 3, maxMp: 2, attack: 3, magicAttack: 0, defense: 1, magicDefense: 1, speed: 2, luck: 2 },
    basicAttack: makeBasicAttack('physical'),
    skills: [
      makeSkill({ id: 'assassin_quick_stab', name: 'Facada Rápida', description: 'Um golpe rápido e certeiro.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 3.5, baseCost: 8, basePower: 1.5 }),
      makeSkill({ id: 'assassin_backstab', name: 'Golpe Traiçoeiro', description: 'Ataca um ponto vulnerável do inimigo.', kind: 'physical', target: 'enemy', unlockLevel: 5, baseCooldown: 6, baseCost: 12, basePower: 2.1 }),
      makeSkill({ id: 'assassin_shadow_step', name: 'Passos das Sombras', description: 'Move-se pelas sombras, ganhando velocidade.', kind: 'buff', target: 'self', unlockLevel: 10, baseCooldown: 14, baseCost: 14, basePower: 1.6, buffStat: 'speed' }),
      makeSkill({ id: 'assassin_blade_dance', name: 'Dança das Lâminas', description: 'Uma sequência de cortes contra todos os inimigos.', kind: 'physical', target: 'allEnemies', unlockLevel: 15, baseCooldown: 12, baseCost: 20, basePower: 1.3 }),
      makeUltimate({ id: 'assassin_ultimate', name: 'Execução Sombria', description: 'Um golpe fatal contra um único alvo.', kind: 'physical', target: 'enemy', unlockLevel: 20, baseCooldown: 22, baseCost: 36, basePower: 4.5 }),
    ],
  },
  {
    id: 'necromancer',
    name: 'Necromante',
    description: 'Manipula energias sombrias para corromper e drenar seus inimigos.',
    color: 0x2f1f3a,
    accentColor: 0x6bff8e,
    baseStats: { maxHp: 19, maxMp: 26, attack: 2, magicAttack: 11, defense: 3, magicDefense: 5, speed: 5, luck: 6 },
    growth: { maxHp: 3, maxMp: 5, attack: 0, magicAttack: 3, defense: 1, magicDefense: 1, speed: 1, luck: 1 },
    basicAttack: makeBasicAttack('magical'),
    skills: [
      makeSkill({ id: 'necro_dark_touch', name: 'Toque Sombrio', description: 'Corrompe o alvo com energia sombria.', kind: 'magical', target: 'enemy', unlockLevel: 1, baseCooldown: 5, baseCost: 10, basePower: 1.7 }),
      makeSkill({ id: 'necro_drain', name: 'Drenar Vida', description: 'Rouba a força vital do inimigo.', kind: 'magical', target: 'enemy', unlockLevel: 5, baseCooldown: 8, baseCost: 14, basePower: 1.8 }),
      makeSkill({ id: 'necro_curse', name: 'Maldição', description: 'Amaldiçoa todos os inimigos com energia sombria.', kind: 'magical', target: 'allEnemies', unlockLevel: 10, baseCooldown: 12, baseCost: 18, basePower: 1.3 }),
      makeSkill({ id: 'necro_bone_armor', name: 'Armadura Óssea', description: 'Invoca ossos para se proteger.', kind: 'buff', target: 'self', unlockLevel: 15, baseCooldown: 16, baseCost: 16, basePower: 1.5, buffStat: 'defense' }),
      makeUltimate({ id: 'necro_ultimate', name: 'Exército dos Mortos', description: 'Invoca legiões sombrias contra todos os inimigos.', kind: 'magical', target: 'allEnemies', unlockLevel: 20, baseCooldown: 27, baseCost: 44, basePower: 2.5 }),
    ],
  },
  {
    id: 'monk',
    name: 'Monge',
    description: 'Luta com punhos e disciplina, encadeando golpes marciais.',
    color: 0xd97a2e,
    accentColor: 0xf2ede1,
    baseStats: { maxHp: 28, maxMp: 14, attack: 8, magicAttack: 4, defense: 5, magicDefense: 5, speed: 8, luck: 6 },
    growth: { maxHp: 4, maxMp: 2, attack: 2, magicAttack: 1, defense: 1, magicDefense: 1, speed: 2, luck: 1 },
    basicAttack: makeBasicAttack('physical'),
    skills: [
      makeSkill({ id: 'monk_fist_strike', name: 'Golpe do Punho', description: 'Um soco rápido e preciso.', kind: 'physical', target: 'enemy', unlockLevel: 1, baseCooldown: 3, baseCost: 8, basePower: 1.5 }),
      makeSkill({ id: 'monk_rising_kick', name: 'Chute Ascendente', description: 'Um chute poderoso que desequilibra o inimigo.', kind: 'physical', target: 'enemy', unlockLevel: 5, baseCooldown: 6, baseCost: 12, basePower: 1.9 }),
      makeSkill({ id: 'monk_focus', name: 'Concentração Interior', description: 'Concentra o chi, aumentando o poder dos golpes.', kind: 'buff', target: 'self', unlockLevel: 10, baseCooldown: 14, baseCost: 14, basePower: 1.5, buffStat: 'attack' }),
      makeSkill({ id: 'monk_thousand_strikes', name: 'Sequência de Mil Golpes', description: 'Uma rajada de golpes contra um único alvo.', kind: 'physical', target: 'enemy', unlockLevel: 15, baseCooldown: 10, baseCost: 18, basePower: 2.3 }),
      makeUltimate({ id: 'monk_ultimate', name: 'Fúria do Dragão Interior', description: 'Libera todo o seu chi em uma explosão marcial.', kind: 'physical', target: 'allEnemies', unlockLevel: 20, baseCooldown: 24, baseCost: 38, basePower: 2.7 }),
    ],
  },
];

export function getClassById(id: string): CharacterClassDefinition {
  const found = CLASS_DEFINITIONS.find((c) => c.id === id);
  if (!found) {
    throw new Error(`Classe desconhecida: ${id}`);
  }
  return found;
}
