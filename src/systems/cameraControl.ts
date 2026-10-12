/**
 * Pure math behind the "Câmera" options' orbit/smoothing (see
 * OverworldScreen.updateCamera). The overworld camera keeps its fixed
 * default azimuth (CAMERA_YAW) unless the player explicitly orbits it with
 * the rotate keys or a right-mouse drag — nothing here ever rotates it on
 * its own.
 */

/** Radians per second at sensitivity 1 while a rotate key is held. */
export const ORBIT_KEY_SPEED = 1.8;
/** Radians per pixel at sensitivity 1 for a right-mouse drag. */
export const ORBIT_DRAG_SPEED = 0.006;

/** Yaw change for one frame of held rotate keys (`dir` -1 left, +1 right, 0 none). */
export function orbitKeyDelta(dir: number, dt: number, sensitivity: number, invert: boolean): number {
  if (dir === 0 || !(dt > 0)) return 0;
  return Math.sign(dir) * ORBIT_KEY_SPEED * sensitivity * dt * (invert ? -1 : 1);
}

/** Yaw change for a horizontal mouse drag of `dxPixels`. Dragging right swings the view right. */
export function orbitDragDelta(dxPixels: number, sensitivity: number, invert: boolean): number {
  return -dxPixels * ORBIT_DRAG_SPEED * sensitivity * (invert ? -1 : 1);
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  const twoPi = Math.PI * 2;
  let r = ((a + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  if (r === -Math.PI) r = Math.PI;
  return r;
}

/** Eases `current` toward `target` along the shorter way round; with smoothing off it snaps. */
export function easeAngle(current: number, target: number, dt: number, smoothing: boolean, rate = 8): number {
  if (!smoothing) return target;
  const diff = wrapAngle(target - current);
  return current + diff * (1 - Math.exp(-dt * rate));
}

/** The 0..1 lerp factor a follow/ease uses this frame — 1 (snap) with smoothing off. */
export function easeFactor(dt: number, rate: number, smoothing: boolean): number {
  return smoothing ? 1 - Math.exp(-dt * rate) : 1;
}
