/**
 * Fase 7 — ambientação sonora. The pure decision half of the overworld's
 * ambient beds: WHICH procedural layers play in a zone, HOW loud each one is
 * at a given hour/weather/event, and how a gain eases from one value to the
 * next. Nothing here touches Web Audio, Three.js or the DOM — AudioSystem's
 * own ambient section (see `audio.setAmbientTargets`) is the only thing that
 * turns these numbers into sound, the same split GameClock/WorldStateSystem
 * keep between "what should happen" and "how it's drawn".
 *
 * Every layer is synthesized at runtime (filtered noise loops, sparse
 * scheduled chirps/drips) — no audio files, matching AudioSystem's own rule.
 */

import type { WorldEventKind } from '../data/worldEvents';

/** Every procedural ambient layer AudioSystem knows how to synthesize. */
export const AMBIENT_LAYERS = ['wind', 'leaves', 'birds', 'insects', 'crickets', 'water', 'murmur', 'drone', 'drips', 'eerie'] as const;
export type AmbientLayerId = (typeof AMBIENT_LAYERS)[number];

/** 0..1 per layer — a relative mix level, scaled by AudioSystem's own per-layer base loudness and the ambient volume setting. */
export type AmbientGains = Record<AmbientLayerId, number>;

/** The broad sound "palette" of a zone — one per kind of place, not per zone id, so a new zone gets a sensible bed for free. */
export type AmbientBiome = 'city' | 'village' | 'riverside' | 'highlands' | 'blight' | 'dungeon';

export interface AmbientZoneInfo {
  id: string;
  dungeonId?: string;
}

/** Zone ids whose bed is deliberately not the plain village one — anything absent falls back by id shape (see ambientBiomeForZone). */
const BIOME_BY_ZONE: Record<string, AmbientBiome> = {
  main_city: 'city',
  ancoradouro_vau: 'riverside',
  baluarte_amanhecer: 'highlands',
};

/**
 * Picks a zone's ambient palette: a dungeon instance is always a cave, the
 * shared hub city and the two regional settlements have their own, a
 * necromancer's territory reads as blighted, and every other class village
 * shares the countryside bed.
 */
export function ambientBiomeForZone(zone: AmbientZoneInfo): AmbientBiome {
  if (zone.dungeonId) return 'dungeon';
  const fixed = BIOME_BY_ZONE[zone.id];
  if (fixed) return fixed;
  if (zone.id.startsWith('necromancer_')) return 'blight';
  return 'village';
}

/** Base mix per biome at full daylight (day) and deepest night (night) — ambientLayerGains blends between the two along the day/night curve. */
interface BiomeMix {
  day: Partial<AmbientGains>;
  night: Partial<AmbientGains>;
}

const BIOME_MIX: Record<AmbientBiome, BiomeMix> = {
  city: {
    day: { wind: 0.25, murmur: 0.7, birds: 0.35, leaves: 0.15, water: 0.2 },
    night: { wind: 0.3, murmur: 0.15, crickets: 0.45, water: 0.2 },
  },
  village: {
    day: { wind: 0.35, leaves: 0.55, birds: 0.8, insects: 0.25, murmur: 0.12 },
    night: { wind: 0.4, leaves: 0.3, crickets: 0.85 },
  },
  riverside: {
    day: { wind: 0.3, water: 0.8, birds: 0.6, leaves: 0.3, insects: 0.2 },
    night: { wind: 0.35, water: 0.8, crickets: 0.7 },
  },
  highlands: {
    day: { wind: 0.8, leaves: 0.3, birds: 0.35, murmur: 0.2 },
    night: { wind: 0.9, crickets: 0.35, eerie: 0.12 },
  },
  blight: {
    day: { wind: 0.5, leaves: 0.2, drone: 0.35, eerie: 0.3, birds: 0.1 },
    night: { wind: 0.55, drone: 0.5, eerie: 0.55, crickets: 0.25 },
  },
  dungeon: {
    // Underground: no sky, so day and night sound the same.
    day: { drone: 0.75, drips: 0.8, wind: 0.2, eerie: 0.25 },
    night: { drone: 0.75, drips: 0.8, wind: 0.2, eerie: 0.25 },
  },
};

export interface AmbientContext {
  /** 0..24 — see GameClock.hourOfDay. */
  hour: number;
  /** The kind of world event currently running in this zone, if any — see data/worldEvents.ts. */
  eventKind?: WorldEventKind | null;
  /** 0 (fully corrupted) .. 1 (fully hopeful) — see WorldStateSystem.worldMoodFactor. Optional; 0.5 = neutral. */
  mood?: number;
  /** True while a fight is on — the bed ducks so combat cues read clearly. */
  inCombat?: boolean;
}

export function emptyAmbientGains(): AmbientGains {
  const out = {} as AmbientGains;
  for (const id of AMBIENT_LAYERS) out[id] = 0;
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 0 (night) .. 1 (day), a smoothstep on the same cosine curve
 * GameClock.dayNightFactor uses, sharpened so dawn/dusk is a real
 * crossover (~05:00-08:00 and ~18:00-21:00) instead of the whole day being
 * a slow 12-hour fade — birds should actually stop at dusk.
 */
export function daylightWeight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const curve = 0.5 + 0.5 * Math.cos(((h - 13) / 24) * Math.PI * 2);
  const t = clamp01((curve - 0.2) / 0.45);
  return t * t * (3 - 2 * t);
}

/** Dawn chorus / dusk insects: a bump that peaks around 06:30 and 19:30 — 0 elsewhere. */
export function twilightWeight(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  const near = (center: number) => {
    let d = Math.abs(h - center);
    if (d > 12) d = 24 - d;
    return clamp01(1 - d / 1.5);
  };
  return Math.max(near(6.5), near(19.5));
}

/**
 * The target mix for a zone's biome right now. Writes into `out` (and
 * returns it) when given, so a caller polling this every few hundred ms can
 * reuse one object instead of allocating a fresh record each time.
 */
export function ambientLayerGains(biome: AmbientBiome, ctx: AmbientContext, out: AmbientGains = emptyAmbientGains()): AmbientGains {
  const mix = BIOME_MIX[biome];
  const day = daylightWeight(ctx.hour);
  const twilight = biome === 'dungeon' ? 0 : twilightWeight(ctx.hour);
  for (const id of AMBIENT_LAYERS) {
    const d = mix.day[id] ?? 0;
    const n = mix.night[id] ?? 0;
    out[id] = n + (d - n) * day;
  }
  // Dawn chorus: birds swell just as the sun comes up, insects at dusk.
  out.birds += twilight * 0.25 * (mix.day.birds ?? 0);
  out.insects += twilight * 0.2 * ((mix.day.insects ?? 0) + (mix.night.crickets ?? 0) * 0.5);

  // A corrupted world is quieter of life and heavier underneath.
  const mood = ctx.mood ?? 0.5;
  if (mood < 0.5) {
    const gloom = (0.5 - mood) * 2; // 0..1
    out.birds *= 1 - 0.6 * gloom;
    out.eerie += 0.2 * gloom;
  }

  switch (ctx.eventKind) {
    case 'nevoa':
      // Mist muffles everything bright, leaves a hollow wind.
      out.birds *= 0.25;
      out.insects *= 0.4;
      out.murmur *= 0.5;
      out.wind = Math.max(out.wind, 0.6);
      out.eerie += 0.25;
      break;
    case 'invasao':
      out.birds *= 0.2;
      out.murmur *= 0.4;
      out.drone += 0.35;
      out.eerie += 0.2;
      break;
    case 'arvore_corrompida':
      out.birds *= 0.5;
      out.eerie += 0.35;
      out.drone += 0.15;
      break;
    case 'mercador':
      out.murmur += 0.15;
      break;
    default:
      break;
  }

  // Combat ducks the bed so hits/telegraphs stay readable.
  const duck = ctx.inCombat ? 0.55 : 1;
  for (const id of AMBIENT_LAYERS) out[id] = clamp01(out[id] * duck);
  return out;
}

/**
 * Exponential approach from `current` toward `target` — frame-rate
 * independent (the same `1 - exp(-dt/τ)` form OverworldScreen's camera
 * follow uses). `timeConstant` is the seconds to cover ~63% of the gap.
 */
export function crossfadeGain(current: number, target: number, dt: number, timeConstant: number): number {
  if (timeConstant <= 0) return target;
  const k = 1 - Math.exp(-Math.max(0, dt) / timeConstant);
  return current + (target - current) * k;
}

/**
 * Equal-power gains for crossfading OUT of one bed and INTO another at
 * progress `t` (0 = all old, 1 = all new) — keeps perceived loudness steady
 * through the middle of the fade instead of the dip a plain linear fade has.
 */
export function equalPowerCrossfade(t: number): { from: number; to: number } {
  const c = clamp01(t);
  return { from: Math.cos((c * Math.PI) / 2), to: Math.sin((c * Math.PI) / 2) };
}

/** Seconds the bed takes to settle (Web Audio setTargetAtTime's own τ) — a zone change is a deliberate swap, an hour tick is a slow drift. */
export const AMBIENT_ZONE_FADE_TAU = 1.2;
export const AMBIENT_DRIFT_FADE_TAU = 3;

/** True when any layer differs from `prev` by more than `epsilon` — lets the caller skip re-scheduling Web Audio ramps when nothing meaningfully moved. */
export function ambientGainsChanged(prev: AmbientGains, next: AmbientGains, epsilon = 0.01): boolean {
  for (const id of AMBIENT_LAYERS) if (Math.abs(prev[id] - next[id]) > epsilon) return true;
  return false;
}
