import type { ItemModifiers } from '../data/affixes';
import { SHRINE_EVENTS, TRAP_EVENTS, type DungeonRoomKind, type RoomEventDefinition, type RoomOutcomeDefinition } from '../data/dungeonRooms';
import { dungeonTierRewardMultiplier } from './DungeonTierSystem';

/**
 * Lógica pura das salas variadas de uma run (ver `data/dungeonRooms.ts`): qual
 * sala do corredor vira elite/santuário/armadilha, e o que cada escolha de
 * santuário/armadilha faz. Sem DOM/three.js — `DungeonRunLayer` mostra as
 * salas e chama `applyRoomOutcome` quando o jogador escolhe.
 */

/** Atributos de um monstro de sala de elite, em cima do tier e das distorções. */
export const ELITE_STAT_MULT = 1.4;
/** Bônus de recompensa da run por sala de elite vencida. */
export const ELITE_REWARD_BONUS = 0.05;

export interface DungeonRoomPlan {
  kind: DungeonRoomKind;
  /** Só para santuário/armadilha — qual evento de `data/dungeonRooms.ts`. */
  eventId?: string;
}

const ROOM_WEIGHTS: Array<[DungeonRoomKind, number]> = [
  ['combat', 50],
  ['elite', 20],
  ['shrine', 15],
  ['trap', 15],
];

function pick<T>(list: readonly T[], rng: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
}

function rollKind(rng: () => number, allowed: Set<DungeonRoomKind>): DungeonRoomKind {
  const options = ROOM_WEIGHTS.filter(([kind]) => allowed.has(kind));
  const total = options.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [kind, weight] of options) {
    roll -= weight;
    if (roll < 0) return kind;
  }
  return 'combat';
}

/**
 * Sorteia o tipo de cada uma das `encounterCount` salas, na ordem do corredor.
 * Regras: a primeira sala é sempre uma emboscada comum (a run começa lutando);
 * no máximo um santuário, uma armadilha e uma elite "natural" por run; com 3+
 * salas, pelo menos uma é especial. `extraElites` (Sentinela Desperta) depois
 * converte emboscadas comuns em elite, de trás para frente (perto do chefe).
 */
export function rollDungeonRooms(encounterCount: number, rng: () => number, extraElites = 0): DungeonRoomPlan[] {
  const rooms: DungeonRoomPlan[] = [];
  const allowed = new Set<DungeonRoomKind>(['combat', 'elite', 'shrine', 'trap']);
  for (let i = 0; i < encounterCount; i++) {
    if (i === 0) {
      rooms.push({ kind: 'combat' });
      continue;
    }
    const kind = rollKind(rng, allowed);
    if (kind !== 'combat') allowed.delete(kind);
    rooms.push({ kind });
  }
  if (encounterCount >= 3 && rooms.every((r) => r.kind === 'combat')) {
    rooms[1 + Math.floor(rng() * (encounterCount - 1))].kind = 'shrine';
  }
  for (let left = extraElites, i = rooms.length - 1; left > 0 && i >= 1; i--) {
    if (rooms[i].kind === 'combat') {
      rooms[i].kind = 'elite';
      left--;
    }
  }
  for (const room of rooms) {
    if (room.kind === 'shrine') room.eventId = pick(SHRINE_EVENTS, rng).id;
    if (room.kind === 'trap') room.eventId = pick(TRAP_EVENTS, rng).id;
  }
  return rooms;
}

/** Salas que têm monstros (emboscada ou elite) — as outras são resolvidas por escolha. */
export function isCombatRoom(kind: DungeonRoomKind): boolean {
  return kind === 'combat' || kind === 'elite';
}

/** Ouro de uma "unidade de sala": cresce com o nível recomendado da masmorra e com o tier (mesma curva do ouro bônus). */
export function roomGoldAmount(units: number, recommendedLevel: number, tier: number): number {
  return Math.max(1, Math.round(units * (15 + recommendedLevel * 5) * dungeonTierRewardMultiplier(tier)));
}

/** Rola qual resultado uma escolha produz (as chances de cada resultado somam 1). Lança se a escolha não existe. */
export function rollRoomOutcome(event: RoomEventDefinition, choiceId: string, rng: () => number): RoomOutcomeDefinition {
  const choice = event.choices.find((c) => c.id === choiceId);
  if (!choice) throw new Error(`Escolha desconhecida "${choiceId}" em ${event.id}`);
  let roll = rng();
  for (const outcome of choice.outcomes) {
    roll -= outcome.chance;
    if (roll < 0) return outcome;
  }
  return choice.outcomes[choice.outcomes.length - 1];
}

/** O mínimo de `Player` que uma sala mexe — estrutural, para testar sem montar um Player inteiro. */
export interface RoomPlayerLike {
  currentHp: number;
  currentMp: number;
  gold: number;
  stats: { maxHp: number; maxMp: number };
}

export interface RoomOutcomeResult {
  message: string;
  hpLost: number;
  mpSpent: number;
  gold: number;
  restored: boolean;
  blessing: Partial<ItemModifiers> | null;
}

/**
 * Aplica um resultado ao jogador (muta vida/mana/ouro). Dano de sala nunca
 * mata — deixa no mínimo 1 de vida, já que fora de combate não há tela de
 * derrota para tratar a morte. A bênção é devolvida para quem chama somar ao
 * estado da run (ver DungeonSystem.addRunBlessing).
 */
export function applyRoomOutcome(
  player: RoomPlayerLike,
  outcome: RoomOutcomeDefinition,
  ctx: { recommendedLevel: number; tier: number; fallbackHpLossPct?: number },
): RoomOutcomeResult {
  const { maxHp, maxMp } = player.stats;
  let hpLossPct = outcome.hpLossPct ?? 0;
  let mpSpent = 0;
  let message = outcome.message;
  if (outcome.mpCostPct) {
    const cost = Math.round(maxMp * outcome.mpCostPct);
    if (player.currentMp >= cost) {
      player.currentMp -= cost;
      mpSpent = cost;
    } else {
      hpLossPct += ctx.fallbackHpLossPct ?? 0;
      message = `Sem mana suficiente — você força a passagem e se fere (-${Math.round((ctx.fallbackHpLossPct ?? 0) * 100)}% de vida).`;
    }
  }
  const hpBefore = player.currentHp;
  if (hpLossPct > 0) player.currentHp = Math.max(1, player.currentHp - Math.round(maxHp * hpLossPct));
  const gold = outcome.goldUnits ? roomGoldAmount(outcome.goldUnits, ctx.recommendedLevel, ctx.tier) : 0;
  player.gold += gold;
  if (outcome.fullRestore) {
    player.currentHp = maxHp;
    player.currentMp = maxMp;
  }
  if (gold > 0) message = `${message} +${gold} ouro.`;
  return {
    message,
    hpLost: Math.max(0, hpBefore - player.currentHp),
    mpSpent,
    gold,
    restored: !!outcome.fullRestore,
    blessing: outcome.blessing ? { ...outcome.blessing } : null,
  };
}
