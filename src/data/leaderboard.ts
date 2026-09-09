/**
 * There is no real backend yet, so "global ranking" is simulated locally: a
 * fixed roster of rival heroes plus a statistical curve that estimates the
 * player's position among a large simulated player base. Swapping this for
 * a real service later just means replacing `estimatePlayerRank` with an
 * API call — nothing else in the UI needs to change.
 */
export const TOTAL_SIMULATED_PLAYERS = 50_000;

export interface RivalEntry {
  name: string;
  className: string;
  level: number;
  powerScore: number;
}

const RIVAL_NAMES = [
  'SombraEterna', 'DragoSlayer', 'LuzDoAmanhecer', 'FúriaCarmesim', 'GuardiãoNoturno',
  'LâminaSilenciosa', 'TempestadeArcana', 'CoraçãoDeAço', 'CaçadorSolitário', 'RaioVeloz',
  'AlmaGelada', 'FênixRenascida', 'SentinelaDourada', 'VingançaSombria', 'EstrelaCadente',
  'punhoDeFerro', 'ecoDaFloresta', 'reiSemCoroa', 'vulturNegro', 'aurora_boreal',
  'xX_Ceifador_Xx', 'nevoaEterna', 'trovaoSilencioso', 'espinhoDeRosa', 'sombraDupla',
  'brasaViva', 'lobo_solitario99', 'cavaleiroCaido', 'ventoNorte', 'ultimaChama',
];

const CLASS_NAMES = ['Guerreiro', 'Mago', 'Arqueiro', 'Clérigo', 'Paladino', 'Assassino', 'Necromante', 'Monge'];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fixed top-30 roster shown above the player's own row on the ranking screen. */
export function getTopRivals(): RivalEntry[] {
  const rand = mulberry32(42);
  const entries: RivalEntry[] = RIVAL_NAMES.map((name, i) => {
    const level = 95 - Math.floor(i * 1.8) - Math.floor(rand() * 3);
    const powerScore = Math.round(9200 - i * 240 - rand() * 120);
    const className = CLASS_NAMES[Math.floor(rand() * CLASS_NAMES.length)];
    return { name, className, level: Math.max(60, level), powerScore: Math.max(500, powerScore) };
  });
  return entries.sort((a, b) => b.powerScore - a.powerScore);
}

/** Estimates where a given power score would land among the simulated player base. */
export function estimatePlayerRank(powerScore: number): number {
  const rank = Math.round(TOTAL_SIMULATED_PLAYERS * Math.exp(-powerScore / 700));
  return Math.max(1, Math.min(TOTAL_SIMULATED_PLAYERS, rank));
}

export function rankPercentile(rank: number): number {
  return Math.max(0.01, Math.round((1 - rank / TOTAL_SIMULATED_PLAYERS) * 1000) / 10);
}
