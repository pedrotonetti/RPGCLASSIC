/**
 * Fase 7 — sensação de combate ("game feel"). The pure numbers behind
 * hit-stop, camera shake, combat zoom and floating damage-number styling,
 * plus one small stateful `CombatFeel` holder the overworld shares (the same
 * single-instance shape as AudioSystem's `audio`). Nothing here knows about
 * Three.js or the DOM: OverworldCombat feeds it combat events,
 * OverworldScreen reads back a dt scale and a camera offset each frame.
 *
 * Accessibility settings (see systems/GameSettings.ts) gate everything:
 * `reduceMotion` turns off shake, hit-stop and the combat zoom outright;
 * `screenShake` scales shake intensity (0 = off).
 */

import type { CombatEvent } from './CombatSystem';

export interface CombatFeelSettings {
  /** 0 = off, 1 = full — see GameSettings.screenShake. */
  screenShake: number;
  /** Floating damage/heal numbers over enemies — see GameSettings.damageNumbers. */
  damageNumbers: boolean;
  /** Disables shake, hit-stop and the combat zoom — see GameSettings.reduceMotion. */
  reduceMotion: boolean;
}

export function defaultCombatFeelSettings(): CombatFeelSettings {
  return { screenShake: 1, damageNumbers: true, reduceMotion: false };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Longest single freeze — anything longer reads as lag, not impact. */
export const MAX_HIT_STOP = 0.14;
/** World units at trauma 1 — kept small: this is a top-down-ish follow camera, a big shake would be nauseating. */
export const MAX_SHAKE_OFFSET = 0.32;
/** Trauma lost per second — a full-strength shake settles in well under a second. */
export const TRAUMA_DECAY_PER_SECOND = 1.6;

export interface HitInfo {
  amount: number;
  /** The hit target's max HP — shake/hit-stop scale with the share of it the hit took, not raw damage (late-game numbers are huge). */
  targetMaxHp: number;
  crit?: boolean;
  /** The hit killed its target. */
  killed?: boolean;
  /** The player took the hit (shake a little more: it's "you" being hit). */
  targetIsPlayer?: boolean;
  /** The hit was blocked/dodged — no shake for a dodge, a light one for a block. */
  mitigation?: 'block' | 'perfectBlock' | 'dodge';
}

/** 0..1 — the fraction of the target's max HP this hit removed. */
export function hitSeverity(amount: number, targetMaxHp: number): number {
  if (!(targetMaxHp > 0) || !(amount > 0)) return 0;
  return clamp01(amount / targetMaxHp);
}

/**
 * Trauma (0..1) a hit adds to the camera shake. Ordinary chip damage adds
 * almost nothing; a hit taking a quarter of the target's bar, a crit or a
 * kill is clearly felt. Dodges add none.
 */
export function shakeTraumaForHit(hit: HitInfo): number {
  if (hit.mitigation === 'dodge') return 0;
  const sev = hitSeverity(hit.amount, hit.targetMaxHp);
  let trauma = Math.min(0.45, sev * 1.6);
  if (hit.crit) trauma += 0.18;
  if (hit.killed) trauma += 0.12;
  if (hit.targetIsPlayer) trauma *= 1.25;
  if (hit.mitigation === 'block' || hit.mitigation === 'perfectBlock') trauma *= 0.4;
  return clamp01(trauma);
}

/**
 * Seconds of hit-stop (freeze frame) for a hit. Only "heavy" moments get
 * one: crits, kills, and hits taking >= 20% of the bar — a freeze on every
 * swing would make combat feel sticky.
 */
export function hitStopForHit(hit: HitInfo): number {
  if (hit.mitigation === 'dodge') return 0;
  const sev = hitSeverity(hit.amount, hit.targetMaxHp);
  let stop = 0;
  if (sev >= 0.2) stop = 0.04 + Math.min(0.05, (sev - 0.2) * 0.1);
  if (hit.crit) stop = Math.max(stop, 0.06);
  if (hit.killed) stop = Math.max(stop, 0.07);
  if (hit.mitigation === 'perfectBlock') stop = Math.max(stop, 0.05);
  return Math.min(MAX_HIT_STOP, stop);
}

/** The stronger cue for a boss crossing into a new phase (see BossPhaseSystem). */
export const BOSS_PHASE_TRAUMA = 0.7;
export const BOSS_PHASE_HIT_STOP = MAX_HIT_STOP;

/**
 * Multiplier on the camera's follow distance/height while fighting: a
 * little wider with more enemies engaged so the whole band stays on screen.
 * 1 outside combat; capped at +18%.
 */
export function combatZoomFactor(inCombat: boolean, engagedCount: number): number {
  if (!inCombat || engagedCount <= 0) return 1;
  return 1 + Math.min(0.18, 0.06 + (engagedCount - 1) * 0.04);
}

export type DamagePopupVariant = 'normal' | 'crit' | 'weak' | 'resist' | 'heal' | 'miss' | 'elemental' | 'player';

export interface DamagePopupStyle {
  text: string;
  variant: DamagePopupVariant;
  /** Extra modifier for an elemental hit (fire/ice/holy/dark) — a CSS class suffix, never shown as text. */
  element?: string;
  color: string;
}

const ELEMENT_COLOR: Record<string, string> = {
  fire: '#ff8a3d',
  ice: '#8fd8ff',
  holy: '#fff3a1',
  dark: '#c18cff',
};

/**
 * What a combat event's floating number says and how it's styled — or null
 * for an event that shows none. Kept identical in wording to the original
 * popups (`-N`, ` Fraco!`, ` Resistiu`, `+N`, `Errou!`) so nothing a player
 * already learned to read changes; only the styling gets richer.
 */
export function damagePopupStyle(event: Pick<CombatEvent, 'kind' | 'amount' | 'crit' | 'affinity' | 'skillKind' | 'targetIsPlayer'> & { element?: string }): DamagePopupStyle | null {
  if (event.kind === 'miss') return { text: 'Errou!', variant: 'miss', color: '#cccccc' };
  if (event.kind === 'heal' && event.amount) return { text: `+${event.amount}`, variant: 'heal', color: '#6bff8e' };
  if (event.kind !== 'damage' || !event.amount) return null;
  if (event.targetIsPlayer) return { text: `-${event.amount}`, variant: 'player', color: '#ff5a5a' };
  const text = `-${event.amount}`;
  if (event.affinity === 'weak') return { text: `${text} Fraco!`, variant: 'weak', color: '#ff7a3d', element: event.element };
  if (event.affinity === 'resist') return { text: `${text} Resistiu`, variant: 'resist', color: '#9aa7b5', element: event.element };
  if (event.crit) return { text, variant: 'crit', color: '#ffcf4e', element: event.element };
  if (event.element && ELEMENT_COLOR[event.element]) return { text, variant: 'elemental', color: ELEMENT_COLOR[event.element], element: event.element };
  return { text, variant: 'normal', color: '#ffffff' };
}

/** Tiny deterministic value-noise-ish wobble — smooth, cheap, no allocation, so shake doesn't look like white-noise jitter. */
function wobble(t: number, seed: number): number {
  return Math.sin(t * 37.1 + seed) * 0.6 + Math.sin(t * 59.3 + seed * 2.3) * 0.4;
}

/**
 * Shared feel state: accumulated shake trauma and pending hit-stop time.
 * Writes into caller-owned objects (`shakeOffset`) instead of returning new
 * ones so the per-frame path never allocates.
 */
export class CombatFeel {
  settings: CombatFeelSettings = defaultCombatFeelSettings();
  private trauma = 0;
  private hitStopLeft = 0;
  private time = 0;

  configure(settings: Partial<CombatFeelSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.settings.screenShake = clamp01(this.settings.screenShake);
    if (!this.shakeEnabled()) this.trauma = 0;
    if (this.settings.reduceMotion) this.hitStopLeft = 0;
  }

  shakeEnabled(): boolean {
    return !this.settings.reduceMotion && this.settings.screenShake > 0;
  }

  zoomEnabled(): boolean {
    return !this.settings.reduceMotion;
  }

  addTrauma(amount: number): void {
    if (!this.shakeEnabled() || !(amount > 0)) return;
    this.trauma = clamp01(this.trauma + amount);
  }

  requestHitStop(seconds: number): void {
    if (this.settings.reduceMotion || !(seconds > 0)) return;
    // Max, not sum — a multi-target hit freezes once, not N times.
    this.hitStopLeft = Math.min(MAX_HIT_STOP, Math.max(this.hitStopLeft, seconds));
  }

  /** Convenience: both cues for one hit. */
  onHit(hit: HitInfo): void {
    this.addTrauma(shakeTraumaForHit(hit));
    this.requestHitStop(hitStopForHit(hit));
  }

  onBossPhase(): void {
    this.addTrauma(BOSS_PHASE_TRAUMA);
    this.requestHitStop(BOSS_PHASE_HIT_STOP);
  }

  /**
   * Advances real time and returns the dt the SIMULATION (combat engine,
   * monster AI, attack animation) should use this frame: ~0 while a
   * hit-stop is running, the full `dt` otherwise. Shake keeps decaying in
   * real time either way.
   */
  tick(dt: number): number {
    this.time += dt;
    if (this.trauma > 0) this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY_PER_SECOND * dt);
    if (this.hitStopLeft > 0) {
      const frozen = Math.min(this.hitStopLeft, dt);
      this.hitStopLeft -= frozen;
      // A hit-stop shorter than the frame only eats part of it.
      return dt - frozen;
    }
    return dt;
  }

  isHitStopped(): boolean {
    return this.hitStopLeft > 0;
  }

  currentTrauma(): number {
    return this.trauma;
  }

  /** Writes this frame's camera offset (world units) into `out`; zeroes it when there's no shake. */
  shakeOffset(out: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    if (this.trauma <= 0 || !this.shakeEnabled()) {
      out.x = 0;
      out.y = 0;
      out.z = 0;
      return out;
    }
    const mag = this.trauma * this.trauma * MAX_SHAKE_OFFSET * this.settings.screenShake;
    out.x = wobble(this.time, 1.7) * mag;
    out.y = wobble(this.time, 4.1) * mag * 0.6;
    out.z = wobble(this.time, 7.9) * mag;
    return out;
  }

  /** Drops any in-flight shake/hit-stop — called when a zone is torn down so a freeze can't carry into the next one. */
  reset(): void {
    this.trauma = 0;
    this.hitStopLeft = 0;
  }
}

/** Single shared instance — configured from GameSettings at startup (main.ts) and live from the settings screen. */
export const combatFeel = new CombatFeel();
