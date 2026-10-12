import type { ItemModifiers } from './affixes';

/**
 * Distorções de masmorra (Dungeons 2.0): regras extras sorteadas a cada
 * incursão — 1 a 3 por run, mais quanto maior o tier (ver
 * `systems/DungeonModifierSystem.ts`). Cada uma deixa a run mais perigosa (ou
 * mais arriscada) e paga um bônus de recompensa proporcional no fim.
 *
 * Só dados aqui: quem lê cada efeito é `DungeonModifierSystem.combineDungeonModifiers`,
 * e quem aplica é `OverworldCombat` (inimigos) e `Player` (modificadores de
 * run no jogador). Adicionar uma distorção nova = uma entrada nesta tabela.
 */
export interface DungeonModifierEffects {
  /** Somado aos modificadores de item do jogador durante toda a run (ver `Player.itemEffects`). */
  playerMods?: Partial<ItemModifiers>;
  /** Multiplica toda cura que o jogador recebe dentro da masmorra (<1 = cura reduzida). */
  healingMult?: number;
  /** Multiplica os atributos de todo monstro da run, em cima do tier. */
  enemyStatMult?: number;
  /** Multiplica o intervalo entre ações inimigas (<1 = inimigos mais rápidos). */
  enemyActionIntervalMult?: number;
  /** Multiplica a velocidade de perseguição dos monstros no mapa. */
  enemyChaseSpeedMult?: number;
  /** Ao morrer, um monstro comum (não o chefe) explode: dano em fração da vida máxima do jogador e, opcionalmente, queimadura. */
  deathBurst?: { maxHpPct: number; burn: boolean };
  /** Salas comuns extras convertidas em salas de elite. */
  extraElites?: number;
}

export interface DungeonModifierDefinition {
  id: string;
  name: string;
  description: string;
  /** Fração somada ao bônus de recompensa da run (0.15 = +15% de ouro bônus, e pesa na raridade do baú). */
  rewardBonus: number;
  effects: DungeonModifierEffects;
}

export const DUNGEON_MODIFIERS: DungeonModifierDefinition[] = [
  {
    id: 'brasas_vingativas',
    name: 'Brasas Vingativas',
    description: 'Inimigos explodem em brasas ao morrer: 5% da sua vida máxima e queimadura.',
    rewardBonus: 0.15,
    effects: { deathBurst: { maxHpPct: 0.05, burn: true } },
  },
  {
    id: 'seiva_amarga',
    name: 'Seiva Amarga',
    description: 'Toda cura que você recebe é reduzida em 40%.',
    rewardBonus: 0.12,
    effects: { healingMult: 0.6 },
  },
  {
    id: 'sentinela_desperta',
    name: 'Sentinela Desperta',
    description: 'Uma sala comum a mais vira sala de elite.',
    rewardBonus: 0.15,
    effects: { extraElites: 1 },
  },
  {
    id: 'frenesi_das_raizes',
    name: 'Frenesi das Raízes',
    description: 'Inimigos agem 20% mais rápido e perseguem com mais pressa.',
    rewardBonus: 0.15,
    effects: { enemyActionIntervalMult: 0.8, enemyChaseSpeedMult: 1.25 },
  },
  {
    id: 'fio_da_navalha',
    name: 'Fio da Navalha',
    description: '+15% de chance crítica e +30% de dano crítico, mas você recebe 25% a mais de dano.',
    rewardBonus: 0.1,
    effects: { playerMods: { critChance: 0.15, critDamage: 0.3, damageTaken: 0.25 } },
  },
  {
    id: 'casca_endurecida',
    name: 'Casca Endurecida',
    description: 'Inimigos têm 25% a mais de atributos.',
    rewardBonus: 0.18,
    effects: { enemyStatMult: 1.25 },
  },
  {
    id: 'sede_voraz',
    name: 'Sede Voraz',
    description: 'Você causa 15% a mais de dano, mas também recebe 15% a mais.',
    rewardBonus: 0.08,
    effects: { playerMods: { damageDealt: 0.15, damageTaken: 0.15 } },
  },
];

export function getDungeonModifier(id: string): DungeonModifierDefinition | undefined {
  return DUNGEON_MODIFIERS.find((m) => m.id === id);
}
