/**
 * Recordes por masmorra (Dungeons 2.0): run mais rápida, quantas vitórias e o
 * máximo de distorções vencidas numa run. O melhor tier continua morando em
 * `Player.dungeonTiers` (já salvo desde antes) — aqui só fica o que é novo.
 * Persistido em `PlayerSaveData.dungeonRecords`; saves antigos não têm o
 * campo e caem em `{}` via `normalizeDungeonRecords` (sem migração de schema).
 */
export interface DungeonRecord {
  clears: number;
  /** Segundos de jogo da run mais rápida (null = nenhuma run cronometrada ainda). */
  fastestSeconds: number | null;
  /** Tier em que a run mais rápida foi feita. */
  fastestTier: number;
  /** Maior número de distorções ativas numa run concluída. */
  mostModifiers: number;
}

export type DungeonRecords = Record<string, DungeonRecord>;

function cleanInt(value: unknown, min = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? Math.floor(value) : min;
}

/** Valida/limpa o que veio do save — qualquer coisa malformada vira o padrão seguro. */
export function normalizeDungeonRecords(raw: unknown): DungeonRecords {
  const out: DungeonRecords = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    const fastest = typeof v.fastestSeconds === 'number' && Number.isFinite(v.fastestSeconds) && v.fastestSeconds > 0 ? v.fastestSeconds : null;
    out[id] = {
      clears: cleanInt(v.clears),
      fastestSeconds: fastest,
      fastestTier: fastest === null ? 0 : cleanInt(v.fastestTier, 1),
      mostModifiers: cleanInt(v.mostModifiers),
    };
  }
  return out;
}

export function cloneDungeonRecords(records: DungeonRecords): DungeonRecords {
  const out: DungeonRecords = {};
  for (const [id, r] of Object.entries(records)) out[id] = { ...r };
  return out;
}

export interface ClearSummary {
  tier: number;
  /** Duração da run em segundos de jogo; omitido/≤0 = run não cronometrada (não conta para o recorde de tempo). */
  seconds?: number;
  modifierCount: number;
}

/** Registra uma vitória (muta `records`). Devolve se bateu o recorde de tempo. */
export function recordDungeonClear(records: DungeonRecords, dungeonId: string, clear: ClearSummary): { record: DungeonRecord; newFastest: boolean } {
  const record = records[dungeonId] ?? { clears: 0, fastestSeconds: null, fastestTier: 0, mostModifiers: 0 };
  record.clears += 1;
  record.mostModifiers = Math.max(record.mostModifiers, clear.modifierCount);
  let newFastest = false;
  if (clear.seconds !== undefined && clear.seconds > 0 && (record.fastestSeconds === null || clear.seconds < record.fastestSeconds)) {
    record.fastestSeconds = Math.round(clear.seconds * 10) / 10;
    record.fastestTier = clear.tier;
    newFastest = true;
  }
  records[dungeonId] = record;
  return { record, newFastest };
}

/** "4:07" — minutos:segundos, arredondado para baixo. */
export function formatClearTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Linha de recordes para o painel do portal. */
export function describeDungeonRecord(bestTier: number, record: DungeonRecord | undefined): string {
  if (bestTier <= 0 && !record?.clears) return 'Ainda não concluída.';
  const parts = [`Melhor tier: ${Math.max(bestTier, 1)}`];
  if (record?.fastestSeconds) parts.push(`Mais rápida: ${formatClearTime(record.fastestSeconds)} (Tier ${record.fastestTier})`);
  if (record?.clears) parts.push(`Vitórias: ${record.clears}`);
  return parts.join(' · ');
}
