/**
 * Runtime copy of the "Jogabilidade" and "Câmera" options (see
 * systems/GameSettings.ts for the persisted, sanitized source of truth),
 * plus the small pure rules each option drives. Kept free of DOM/Three
 * imports so plain systems (CombatSystem) can read it without dragging the
 * renderer into their unit tests — same single-instance shape as
 * combatFeel. systems/applySettings.ts pushes fresh values in at startup
 * and on every settings change.
 */

import {
  DEFAULT_CAMERA_OPTIONS,
  DEFAULT_GAMEPLAY_OPTIONS,
  type AutosaveMinutes,
  type CameraOptions,
  type GameplayOptions,
  type TextSpeed,
} from './GameSettings';

let gameplay: GameplayOptions = { ...DEFAULT_GAMEPLAY_OPTIONS };
let camera: CameraOptions = { ...DEFAULT_CAMERA_OPTIONS };

export function setGameplayOptions(next: GameplayOptions): void {
  gameplay = { ...next };
}

export function gameplayOptions(): Readonly<GameplayOptions> {
  return gameplay;
}

export function setCameraOptions(next: CameraOptions): void {
  camera = { ...next };
}

export function cameraOptions(): Readonly<CameraOptions> {
  return camera;
}

// --- Saque automático -----------------------------------------------------

/** The bits of an item the auto-salvage rule looks at. */
export interface LootLike {
  rarity: string;
  upgradeLevel?: number;
  enchantCount?: number;
  socketedGemId?: string | null;
}

/** "Desmontar comuns": a plain Comum (verde) drop — never one that was worked on or carries a gem — goes straight to materials. */
export function shouldAutoSalvage(item: LootLike, opts: Pick<GameplayOptions, 'lootPickup'> = gameplay): boolean {
  if (opts.lootPickup !== 'desmontar-comuns') return false;
  return item.rarity === 'verde' && !(item.upgradeLevel ?? 0) && !(item.enchantCount ?? 0) && !item.socketedGemId;
}

// --- Alvo automático ------------------------------------------------------

/** Index of the candidate closest to `from` (XZ plane), or -1 for an empty list. */
export function nearestIndex(from: { x: number; z: number }, candidates: ReadonlyArray<{ x: number; z: number }>): number {
  let best = -1;
  let bestD = Infinity;
  candidates.forEach((c, i) => {
    const d = (c.x - from.x) ** 2 + (c.z - from.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// --- Salvamento automático ------------------------------------------------

/** Seconds between periodic saves, or 0 for "only the usual event saves". */
export function autosaveIntervalSeconds(minutes: AutosaveMinutes): number {
  return minutes * 60;
}

// --- Velocidade do texto --------------------------------------------------

/** Characters per second the dialogue typewriter reveals; Infinity = the whole line at once. */
export function textCharsPerSecond(speed: TextSpeed): number {
  switch (speed) {
    case 'rapido':
      return 90;
    case 'normal':
      return 45;
    case 'lento':
      return 22;
    default:
      return Infinity;
  }
}

/** How many characters of a `length`-long line are visible `elapsed` seconds after it started typing. */
export function visibleChars(length: number, elapsed: number, speed: TextSpeed): number {
  const cps = textCharsPerSecond(speed);
  if (!Number.isFinite(cps) || elapsed < 0) return elapsed < 0 ? 0 : length;
  return Math.min(length, Math.floor(elapsed * cps));
}
