import type { ItemModifiers } from '../data/affixes';
import { DUNGEON_MODIFIERS, getDungeonModifier, type DungeonModifierDefinition } from '../data/dungeonModifiers';
import { DUNGEON_TIER_CAP } from './DungeonTierSystem';

/**
 * Lógica pura das Distorções de masmorra (ver `data/dungeonModifiers.ts`):
 * RNG com semente, a "Distorção do dia" derivada só da data (sem servidor),
 * o sorteio das distorções de uma run e a soma dos efeitos delas. Nada de
 * DOM/three.js aqui — `OverworldScreen` sorteia o plano no portal e entrega
 * os efeitos combinados a `OverworldCombat`/`Player`.
 */

/** Gerador determinístico (mulberry32) — mesma semente, mesma sequência. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mistura vários inteiros numa semente de 32 bits (FNV-1a sobre as palavras). */
export function mixSeed(...parts: number[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    let v = Math.floor(part) >>> 0;
    for (let i = 0; i < 4; i++) {
      hash ^= v & 0xff;
      hash = Math.imul(hash, 0x01000193);
      v >>>= 8;
    }
  }
  return hash >>> 0;
}

/** Índice do dia LOCAL do jogador (dias desde 1970-01-01) — muda à meia-noite local, igual para todo mundo no mesmo dia. */
export function dayIndex(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

const FEATURED_SALT = 0x5e_de_d1;

/** Bônus de recompensa extra por enfrentar a Distorção do dia. */
export const FEATURED_REWARD_BONUS = 0.1;

/** A "Distorção do dia": mesma para todas as masmorras e todos os jogadores naquele dia. */
export function featuredModifierForDay(day: number, table: DungeonModifierDefinition[] = DUNGEON_MODIFIERS): DungeonModifierDefinition {
  const rng = seededRng(mixSeed(FEATURED_SALT, day));
  return table[Math.floor(rng() * table.length) % table.length];
}

/** Quantas distorções uma run desse tier rola: 1 no tier 1, até 3 nos tiers mais altos. */
export function modifierCountForTier(tier: number): number {
  const t = Math.max(1, Math.min(DUNGEON_TIER_CAP, Math.round(tier)));
  return [1, 2, 2, 3, 3][t - 1] ?? 3;
}

/** O que uma incursão vai enfrentar — sorteado no portal (para mostrar antes de entrar) e entregue à tela da masmorra. */
export interface DungeonRunPlan {
  dungeonId: string;
  tier: number;
  modifierIds: string[];
  featuredId: string;
  /** Semente da run — também sorteia o tipo de cada sala (ver DungeonRoomSystem). */
  seed: number;
}

/**
 * Sorteia o plano de uma run. Determinístico por (masmorra, tier, dia): reabrir
 * o portal no mesmo dia mostra exatamente as mesmas distorções, então não dá
 * para "rerolar" fechando e abrindo o painel. A Distorção do dia sempre entra.
 */
export function planDungeonRun(dungeon: { id: string; seed: number }, tier: number, day: number): DungeonRunPlan {
  const t = Math.max(1, Math.min(DUNGEON_TIER_CAP, Math.round(tier)));
  const seed = mixSeed(dungeon.seed, t, day);
  const rng = seededRng(seed);
  const featured = featuredModifierForDay(day);
  const pool = DUNGEON_MODIFIERS.filter((m) => m.id !== featured.id).map((m) => m.id);
  const ids = [featured.id];
  const count = Math.min(modifierCountForTier(t), DUNGEON_MODIFIERS.length);
  while (ids.length < count && pool.length > 0) {
    const index = Math.floor(rng() * pool.length) % pool.length;
    ids.push(pool.splice(index, 1)[0]);
  }
  return { dungeonId: dungeon.id, tier: t, modifierIds: ids, featuredId: featured.id, seed };
}

/** Efeitos de todas as distorções ativas, já somados/multiplicados. */
export interface CombinedDungeonModifiers {
  playerMods: Partial<ItemModifiers>;
  healingMult: number;
  enemyStatMult: number;
  enemyActionIntervalMult: number;
  enemyChaseSpeedMult: number;
  deathBurst: { maxHpPct: number; burn: boolean } | null;
  extraElites: number;
  /** Soma dos bônus de recompensa (+ o bônus da Distorção do dia, se ela estiver entre as ativas). */
  rewardBonus: number;
}

export function combineDungeonModifiers(ids: readonly string[], featuredId?: string): CombinedDungeonModifiers {
  const combined: CombinedDungeonModifiers = {
    playerMods: {},
    healingMult: 1,
    enemyStatMult: 1,
    enemyActionIntervalMult: 1,
    enemyChaseSpeedMult: 1,
    deathBurst: null,
    extraElites: 0,
    rewardBonus: 0,
  };
  for (const id of ids) {
    const def = getDungeonModifier(id);
    if (!def) continue;
    const fx = def.effects;
    for (const [key, value] of Object.entries(fx.playerMods ?? {}) as Array<[keyof ItemModifiers, number]>) {
      combined.playerMods[key] = (combined.playerMods[key] ?? 0) + value;
    }
    combined.healingMult *= fx.healingMult ?? 1;
    combined.enemyStatMult *= fx.enemyStatMult ?? 1;
    combined.enemyActionIntervalMult *= fx.enemyActionIntervalMult ?? 1;
    combined.enemyChaseSpeedMult *= fx.enemyChaseSpeedMult ?? 1;
    if (fx.deathBurst) {
      combined.deathBurst = {
        maxHpPct: Math.max(combined.deathBurst?.maxHpPct ?? 0, fx.deathBurst.maxHpPct),
        burn: (combined.deathBurst?.burn ?? false) || fx.deathBurst.burn,
      };
    }
    combined.extraElites += fx.extraElites ?? 0;
    combined.rewardBonus += def.rewardBonus;
    if (featuredId && id === featuredId) combined.rewardBonus += FEATURED_REWARD_BONUS;
  }
  combined.rewardBonus = Math.round(combined.rewardBonus * 1000) / 1000;
  return combined;
}

/** "+33%" — para mostrar o bônus de recompensa no portal e no HUD. */
export function formatRewardBonus(bonus: number): string {
  return `+${Math.round(bonus * 100)}%`;
}
