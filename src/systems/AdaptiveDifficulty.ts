/**
 * Dificuldade adaptativa leve (roadmap seção 23). Observa as últimas lutas do
 * jogador e devolve ajustes pequenos e limitados em COMPOSIÇÃO e RITMO do
 * mundo — tamanho de grupos, alcance de agressividade, frequência de eventos
 * e uma bonificação de recompensa quando ele está apertado. Nunca toca em HP,
 * dano ou qualquer atributo de inimigo, e quem domina o jogo só ganha um
 * empurrão mínimo: evoluir tem que continuar parecendo evoluir.
 */

/** How many of the most recent fights are remembered. */
export const ADAPTIVE_WINDOW = 8;
/** Below this many recorded fights the score stays neutral. */
export const ADAPTIVE_MIN_SAMPLES = 3;

export const MAX_PACK_SHIFT_EASIER = -0.25;
export const MAX_PACK_SHIFT_HARDER = 0.1;
export const MIN_AGGRO_MULT = 0.85;
export const MAX_AGGRO_MULT = 1.05;
export const MIN_EVENT_CHANCE_MULT = 0.8;
export const MAX_EVENT_CHANCE_MULT = 1.1;
export const MAX_REWARD_BONUS = 0.1;
const REWARD_BONUS_THRESHOLD = 0.25;

export interface FightRecord {
  died: boolean;
  /** Fraction of max HP lost during the fight, 0..1. */
  hpLost: number;
  /** Consumables used during the fight. */
  potions: number;
  seconds: number;
}

export interface AdaptiveState {
  /** Oldest first, never longer than ADAPTIVE_WINDOW. */
  recent: FightRecord[];
}

export interface AdaptiveModifiers {
  /** -1 (dominating) .. +1 (struggling); 0 when there is not enough data. */
  score: number;
  /** Skews pack-size weights: negative favors solos/pairs, positive favors bigger bands. */
  packShift: number;
  aggroRadiusMult: number;
  eventChanceMult: number;
  /** Extra fraction of XP/gold on victory; never negative. */
  rewardBonus: number;
}

export function createInitialAdaptiveState(): AdaptiveState {
  return { recent: [] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sanitizeRecord(raw: unknown): FightRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<FightRecord>;
  return {
    died: r.died === true,
    hpLost: clamp(finiteOr(r.hpLost, 0), 0, 1),
    potions: clamp(Math.floor(finiteOr(r.potions, 0)), 0, 20),
    seconds: clamp(finiteOr(r.seconds, 0), 0, 600),
  };
}

/** Defaults a save from before this feature (or a malformed one) into a safe, bounded state. */
export function normalizeAdaptiveState(raw: unknown): AdaptiveState {
  const list = raw && typeof raw === 'object' ? (raw as Partial<AdaptiveState>).recent : undefined;
  const recent: FightRecord[] = [];
  if (Array.isArray(list)) {
    for (const item of list.slice(-ADAPTIVE_WINDOW)) {
      const rec = sanitizeRecord(item);
      if (rec) recent.push(rec);
    }
  }
  return { recent };
}

export function cloneAdaptiveState(state: AdaptiveState): AdaptiveState {
  return { recent: state.recent.map((r) => ({ ...r })) };
}

export function recordFight(state: AdaptiveState, fight: FightRecord): void {
  const rec = sanitizeRecord(fight);
  if (!rec) return;
  state.recent.push(rec);
  if (state.recent.length > ADAPTIVE_WINDOW) state.recent.splice(0, state.recent.length - ADAPTIVE_WINDOW);
}

/** How hard one fight was on the player, -1 (trivial) .. +1 (a death or a near one). */
export function fightPressure(fight: FightRecord): number {
  if (fight.died) return 1;
  const hpTerm = (clamp(fight.hpLost, 0, 1) - 0.4) / 0.6;
  const potionTerm = Math.min(fight.potions, 3) * 0.2;
  const timeTerm = fight.seconds > 40 ? 0.2 : fight.seconds < 10 ? -0.2 : 0;
  return clamp(hpTerm + potionTerm + timeTerm, -1, 1);
}

/** -1 (dominating) .. +1 (struggling), recency-weighted; recent deaths pull it up regardless of easy wins around them. */
export function struggleScore(state: AdaptiveState): number {
  const fights = state.recent;
  if (fights.length < ADAPTIVE_MIN_SAMPLES) return 0;
  let weighted = 0;
  let totalWeight = 0;
  fights.forEach((fight, i) => {
    const w = 1 + i * 0.25;
    weighted += fightPressure(fight) * w;
    totalWeight += w;
  });
  const average = weighted / totalWeight;
  const recentDeaths = fights.slice(-4).filter((f) => f.died).length;
  return clamp(recentDeaths > 0 ? Math.max(average, Math.min(1, recentDeaths * 0.35)) : average, -1, 1);
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000 + 0;

export function adaptiveModifiers(state: AdaptiveState): AdaptiveModifiers {
  const score = struggleScore(state);
  if (score >= 0) {
    return {
      score,
      packShift: round3(MAX_PACK_SHIFT_EASIER * score),
      aggroRadiusMult: round3(1 - (1 - MIN_AGGRO_MULT) * score),
      eventChanceMult: round3(1 - (1 - MIN_EVENT_CHANCE_MULT) * score),
      rewardBonus: round3(MAX_REWARD_BONUS * clamp((score - REWARD_BONUS_THRESHOLD) / (1 - REWARD_BONUS_THRESHOLD), 0, 1)),
    };
  }
  const t = -score;
  return {
    score,
    packShift: round3(MAX_PACK_SHIFT_HARDER * t),
    aggroRadiusMult: round3(1 + (MAX_AGGRO_MULT - 1) * t),
    eventChanceMult: round3(1 + (MAX_EVENT_CHANCE_MULT - 1) * t),
    rewardBonus: 0,
  };
}

/** Skews band-size weights (index 0 = solo) without ever zeroing one — packs of every size stay possible. */
export function shiftPackWeights(weights: number[], shift: number): number[] {
  const n = weights.length;
  if (n < 2 || shift === 0) return [...weights];
  return weights.map((w, i) => Math.max(0, w) * (1 + shift * ((i / (n - 1)) * 2 - 1)));
}

export function rewardMultiplier(state: AdaptiveState): number {
  return 1 + adaptiveModifiers(state).rewardBonus;
}

export function eventChanceMultiplier(state: AdaptiveState): number {
  return adaptiveModifiers(state).eventChanceMult;
}
