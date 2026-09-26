import * as THREE from 'three';
import { GltfActor, loadSkinnedInstance } from './gltfModel';

/**
 * Real rigged glTF mount creatures — replaces the low-poly primitive-geometry
 * llama/condor `characterModel.ts` used to build (see that file's own
 * comment) after players called the old procedural mount "horrível" (ugly).
 * Sourced from Gobkit's free CC0 animal/dinosaur packs — see
 * `public/models/CREDITS.md` for the exact license and URLs.
 *
 * Each pack model ships its own already-sliced `idle`/`walk`/`attack`/`dead`
 * clips (confirmed with `@gltf-transform/cli inspect` on the downloaded
 * files — NOT one merged timeline needing manual sub-clip slicing), so this
 * reuses the same `GltfActor`/`loadSkinnedInstance` pipeline as the player
 * avatar and the ambient fox (`playerAvatar.ts`, `OverworldScreen.spawnFoxAt`)
 * instead of a bespoke loader — `idle` while standing, `walk` while moving,
 * driving the mount's own mixer instead of the old hand-coded wing-flap sine
 * wave.
 */

/** Which glTF file (under `public/models/mounts/`) visually stands in for each `MountDefinition.id` (see `data/mounts.ts`). Both are reskins — see that file's own comment on why the display name changed to match the new creature while the id (save-compatible) didn't. */
const MOUNT_MODEL_FILE: Record<string, string> = {
  llama: 'mounts/goat.glb',
  condor: 'mounts/pterodactylus.glb',
};

/**
 * Per-mount visual tuning, measured in-engine (screenshotted at several
 * candidate values and iterated — see the final report) rather than derived
 * from the glTF's own bind-pose bounding box, which (like the KayKit rigs —
 * see `playerAvatar.ts`'s `MODEL_SCALE_CORRECTION` comment) reads a
 * T/A-posed rest shape that badly misrepresents the actual standing/walking
 * silhouette for a skinned mesh.
 */
interface MountVisualConfig {
  /** Uniform scale applied to the loaded model so it reads as a believably rideable size next to the ~1.6-1.7-unit-tall player avatar. */
  scale: number;
  /** Local offset (inside the mount's own group, i.e. relative to its feet/ground origin) that the RIDER's root is placed at — see `OverworldScreen`'s own `MOUNT_SEAT_OFFSET` comment for why this is the character's root, not literally the saddle. */
  seatOffset: THREE.Vector3;
  /** How high off the ground this mount's own root sits while active — 0 for a ground mount whose feet stay on the terrain, positive for a flying mount hovering clear of it. */
  hoverHeight: number;
}

const MOUNT_VISUAL: Record<string, MountVisualConfig> = {
  // goat.glb's raw bind pose measures ~4.6x4.6x5.0 units (confirmed with a
  // temporary THREE.Box3 dump) — nearly 3x the player avatar's own ~1.6-1.7
  // unit height. At the previous scale (1.05) the goat filled the entire
  // frame and the rider's seat sat at just 0.62 units up, well inside the
  // goat's own leg/body volume instead of on its back. Scaled down to a
  // believably rideable size; seatOffset raised to match its new (much
  // shorter) back height.
  llama: {
    scale: 0.55,
    seatOffset: new THREE.Vector3(0, 1.15, -0.05),
    hoverHeight: 0,
  },
  condor: {
    scale: 0.85,
    seatOffset: new THREE.Vector3(0, 1.25, -0.15),
    hoverHeight: 1.6,
  },
};

const DEFAULT_VISUAL: MountVisualConfig = { scale: 1, seatOffset: new THREE.Vector3(0, 0.6, 0), hoverHeight: 0 };

export interface MountVisual {
  scene: THREE.Group;
  actor: GltfActor;
  config: MountVisualConfig;
}

/** Loads (and, via `loadSkinnedInstance`'s own cache, effectively pre-warms) the glTF creature standing in for `mountId`, ready to add to the scene and drive with `idle`/`walk`. */
export async function loadMountVisual(mountId: string): Promise<MountVisual> {
  const file = MOUNT_MODEL_FILE[mountId] ?? MOUNT_MODEL_FILE.llama;
  const config = MOUNT_VISUAL[mountId] ?? DEFAULT_VISUAL;
  const loaded = await loadSkinnedInstance(file);
  loaded.scene.scale.setScalar(config.scale);
  const actor = new GltfActor(loaded);
  actor.play('idle');
  return { scene: loaded.scene, actor, config };
}

/** Every mount id this loader knows a model for — lets a caller pre-warm both files' network fetch/parse (see `loadSkinnedInstance`'s cache) before the player ever presses the mount key, so the first actual mount doesn't stall on it. */
export function allMountModelFiles(): string[] {
  return Object.values(MOUNT_MODEL_FILE);
}
