import * as THREE from 'three';
import type { GraphicsLevels, ShadowQuality, ViewDistance } from './GameSettings';

/**
 * Applier for the "Gráficos" options (see GameSettings' GraphicsOptions and
 * resolveGraphicsLevels). Deliberately self-contained: it only touches the
 * renderer through Game's two tiny settings hooks (setPixelRatio and
 * frameGate) and a mounted scene/camera through `applySceneGraphics`, so it
 * can later be pointed at a shared performance profile without either side
 * having to know about the settings screen.
 *
 * Two halves:
 *  - renderer-wide (render scale, FPS cap, FPS counter) — `configureGraphics`,
 *    live the instant an option changes;
 *  - per-scene (shadows, view distance) — `applySceneGraphics`, run by
 *    OverworldScreen.mount once its lights/fog/camera exist (every return
 *    from the settings screen rebuilds that screen, so it picks up changes).
 * Particle density is read by render/vfx.ts through `particleScale()`.
 */

/** What configureGraphics needs from Game — an interface so this module (and its tests) never import the engine. */
export interface GraphicsHost {
  readonly lowPowerTier: boolean;
  readonly renderer: { getPixelRatio(): number };
  setPixelRatio(ratio: number): void;
  frameGate: ((nowMs: number) => boolean) | null;
}

let levels: GraphicsLevels = { shadows: 'alta', renderScale: 1, fpsCap: 0, viewDistance: 'media', effects: 'alto' };

// --- pure helpers (tested) -----------------------------------------------

/** The pixel ratio the renderer draws at: Game's own device cap (2, or 1.5 on the low-power tier) times the "Escala de renderização". */
export function pixelRatioFor(devicePixelRatio: number, lowPowerTier: boolean, renderScale: number): number {
  const base = Math.min(devicePixelRatio || 1, lowPowerTier ? 1.5 : 2);
  const scale = Math.max(0.5, Math.min(1, renderScale));
  return Math.round(base * scale * 100) / 100;
}

/** Shadow-map resolution per quality; 0 = shadows off. */
export function shadowMapSizeFor(quality: ShadowQuality): number {
  return quality === 'alta' ? 2048 : quality === 'baixa' ? 1024 : 0;
}

/** Fog start/end for a view distance, scaled from the scene's own tuned values. */
export function fogRangeFor(base: { near: number; far: number }, distance: ViewDistance): { near: number; far: number } {
  const k = distance === 'curta' ? 0.7 : distance === 'longa' ? 1.4 : 1;
  return { near: base.near * k, far: base.far * k };
}

/**
 * Camera far plane: with a short view distance everything past the fog's
 * end (which is fully fog-coloured anyway) is culled outright — the actual
 * GPU saving; otherwise the scene's own far plane is kept untouched.
 */
export function cameraFarFor(baseFar: number, fogFar: number, distance: ViewDistance): number {
  return distance === 'curta' ? Math.min(baseFar, fogFar + 4) : baseFar;
}

/** Particle-count multiplier for the effects quality. */
export function particleScaleFor(effects: GraphicsLevels['effects']): number {
  return effects === 'baixo' ? 0.5 : 1;
}

/**
 * The FPS limiter's frame decision. `state.next` is the earliest time the
 * next frame may draw; a frame drawn advances it by one interval (snapping
 * forward after a long stall instead of trying to "catch up" with a burst).
 * A small tolerance keeps a 60 cap on a 60 Hz screen from dropping frames to
 * rAF jitter. cap 0 = every frame.
 */
export function fpsGateAllows(state: { next: number }, nowMs: number, cap: number): boolean {
  if (!(cap > 0)) return true;
  const interval = 1000 / cap;
  if (nowMs + 1.5 < state.next) return false;
  state.next += interval;
  if (state.next < nowMs) state.next = nowMs + interval;
  return true;
}

export function particleScale(): number {
  return particleScaleFor(levels.effects);
}

export function currentGraphicsLevels(): Readonly<GraphicsLevels> {
  return levels;
}

// --- renderer-wide --------------------------------------------------------

const gateState = { next: 0 };
let fpsEl: HTMLElement | null = null;
let fpsFrames = 0;
let fpsWindowStart = 0;
let showFps = false;

function gate(nowMs: number): boolean {
  if (!fpsGateAllows(gateState, nowMs, levels.fpsCap)) return false;
  if (showFps) countFrame(nowMs);
  return true;
}

function countFrame(nowMs: number): void {
  fpsFrames += 1;
  if (fpsWindowStart === 0) fpsWindowStart = nowMs;
  const span = nowMs - fpsWindowStart;
  if (span >= 500) {
    const fps = Math.round((fpsFrames * 1000) / span);
    if (fpsEl) fpsEl.textContent = `${fps} FPS`;
    fpsFrames = 0;
    fpsWindowStart = nowMs;
  }
}

function syncFpsCounter(): void {
  if (showFps && !fpsEl) {
    fpsEl = document.createElement('div');
    fpsEl.className = 'fps-counter';
    fpsEl.setAttribute('aria-hidden', 'true');
    fpsEl.textContent = '-- FPS';
    document.body.append(fpsEl);
    fpsFrames = 0;
    fpsWindowStart = 0;
  } else if (!showFps && fpsEl) {
    fpsEl.remove();
    fpsEl = null;
  }
}

/** Live: render scale, FPS cap, FPS counter (and the stored levels the scene half / vfx read). */
export function configureGraphics(host: GraphicsHost | null, next: GraphicsLevels, fpsCounter: boolean): void {
  levels = { ...next };
  showFps = fpsCounter;
  if (typeof document !== 'undefined') syncFpsCounter();
  if (!host) return;
  const ratio = pixelRatioFor(window.devicePixelRatio, host.lowPowerTier, levels.renderScale);
  if (Math.abs(host.renderer.getPixelRatio() - ratio) > 0.001) host.setPixelRatio(ratio);
  gateState.next = 0;
  host.frameGate = gate;
}

// --- per-scene ------------------------------------------------------------

const baseFog = new WeakMap<THREE.Fog, { near: number; far: number }>();
const baseFar = new WeakMap<THREE.PerspectiveCamera, number>();
const baseShadow = new WeakMap<THREE.Light, boolean>();

/** Shadows + view distance for a freshly mounted scene. Idempotent: the scene's own tuned values are remembered the first time and every later call scales from those. */
export function applySceneGraphics(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
  const size = shadowMapSizeFor(levels.shadows);
  scene.traverse((obj) => {
    const light = obj as THREE.DirectionalLight;
    if (!light.isLight || !light.shadow) return;
    if (!baseShadow.has(light)) baseShadow.set(light, light.castShadow);
    if (!baseShadow.get(light)) return;
    light.castShadow = size > 0;
    if (size > 0 && light.shadow.mapSize.x !== size) {
      light.shadow.mapSize.set(size, size);
      light.shadow.map?.dispose();
      light.shadow.map = null;
    }
  });

  if (scene.fog instanceof THREE.Fog) {
    const fog = scene.fog;
    if (!baseFog.has(fog)) baseFog.set(fog, { near: fog.near, far: fog.far });
    const range = fogRangeFor(baseFog.get(fog)!, levels.viewDistance);
    fog.near = range.near;
    fog.far = range.far;
    if (!baseFar.has(camera)) baseFar.set(camera, camera.far);
    camera.far = cameraFarFor(baseFar.get(camera)!, range.far, levels.viewDistance);
    camera.updateProjectionMatrix();
  }
}
