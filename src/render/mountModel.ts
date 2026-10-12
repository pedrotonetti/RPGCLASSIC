import * as THREE from 'three';
import { GltfActor, loadSkinnedInstance } from './gltfModel';

/**
 * Real rigged glTF mount creatures.
 *
 * Ground mounts come from Quaternius' CC0 "Ultimate Animated Animal Pack"
 * (white horse, wolf, stag — see `public/models/CREDITS.md`), each with its
 * own named clips (`Idle`, `Walk`, `Gallop`, `Attack…`, `Idle_HitReact1`).
 * Two mounts have no CC0 model of their own and are built from one at load
 * time instead:
 *  - the unicorn is the white horse plus a pearl spiral horn pinned to its
 *    `Head` bone and a pearly mane;
 *  - the leopard is the wolf re-coated gold with procedural rosette spots
 *    (a small `onBeforeCompile` patch on its own cloned material).
 * The flying mount is still Gobkit's CC0 pterodactyl.
 *
 * Materials are always cloned per instance (SkeletonUtils.clone shares them
 * with the cached parse), so tinting one mount never leaks into another and
 * `disposeGroup` on dismount only frees this instance's copies.
 */

/** Which of the model's own clips plays for each mount action. Missing = that action just doesn't play a clip. */
interface MountClips {
  idle: string;
  walk: string;
  run?: string;
  attack?: string;
  hit?: string;
}

interface MountVisualConfig {
  file: string;
  /** Uniform scale so the creature reads as believably rideable next to the ~1.65-unit-tall rider. */
  scale: number;
  /** Rider root position inside the mount's group (relative to the mount's feet). */
  seatOffset: THREE.Vector3;
  /** 0 for a ground mount, positive for a flying one hovering over the terrain. */
  hoverHeight: number;
  clips: MountClips;
  /** Optional per-material colour overrides, by the glTF material name. */
  tint?: Record<string, number>;
  /** Extra decoration built once the model is loaded. */
  decorate?: 'unicorn' | 'leopard';
}

const QUATERNIUS_CLIPS: MountClips = { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack_Headbutt', hit: 'Idle_HitReact1' };

// Scales/seats come from measuring each model's posed bind skeleton (back
// surface ≈ spine `Torso2` bone height + a little) so the rider sits ON the
// back rather than inside it: horse back ≈ 1.35, wolf ≈ 1.15, stag ≈ 1.3.
const MOUNT_VISUAL: Record<string, MountVisualConfig> = {
  cavalo_branco: {
    file: 'mounts/horse_white.glb',
    scale: 0.47,
    seatOffset: new THREE.Vector3(0, 1.3, -0.12),
    hoverHeight: 0,
    clips: QUATERNIUS_CLIPS,
    tint: { Main: 0xf3f1ec, Main_Light: 0xffffff, Hair: 0xe6e2da },
  },
  unicornio: {
    file: 'mounts/horse_white.glb',
    scale: 0.47,
    seatOffset: new THREE.Vector3(0, 1.3, -0.12),
    hoverHeight: 0,
    clips: QUATERNIUS_CLIPS,
    tint: { Main: 0xfbf8ff, Main_Light: 0xffffff, Hair: 0xd9c8ff, Hooves: 0xe9d6a0 },
    decorate: 'unicorn',
  },
  lobo: {
    file: 'mounts/wolf.glb',
    scale: 0.58,
    seatOffset: new THREE.Vector3(0, 1.1, 0.0),
    hoverHeight: 0,
    clips: { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack', hit: 'Idle_HitReact1' },
  },
  leopardo: {
    file: 'mounts/wolf.glb',
    scale: 0.56,
    seatOffset: new THREE.Vector3(0, 1.06, 0.0),
    hoverHeight: 0,
    clips: { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack', hit: 'Idle_HitReact1' },
    tint: { Main: 0xd9a441, Main_Light: 0xf5e6c2, Nose: 0x2a1d14 },
    decorate: 'leopard',
  },
  cervo: {
    file: 'mounts/stag.glb',
    scale: 0.52,
    seatOffset: new THREE.Vector3(0, 1.26, -0.1),
    hoverHeight: 0,
    clips: QUATERNIUS_CLIPS,
  },
  condor: {
    file: 'mounts/pterodactylus.glb',
    scale: 0.85,
    seatOffset: new THREE.Vector3(0, 1.25, -0.15),
    hoverHeight: 1.6,
    clips: { idle: 'idle', walk: 'walk', attack: 'attack' },
  },
};

export interface MountVisual {
  scene: THREE.Group;
  actor: GltfActor;
  config: MountVisualConfig;
}

/** Loads the creature standing in for `mountId`, ready to add to the scene and drive via `MountAnimator`. */
export async function loadMountVisual(mountId: string): Promise<MountVisual> {
  const config = MOUNT_VISUAL[mountId] ?? MOUNT_VISUAL.cavalo_branco;
  const loaded = await loadSkinnedInstance(config.file);
  cloneMaterials(loaded.scene, config.tint);
  loaded.scene.scale.setScalar(config.scale);
  if (config.decorate === 'unicorn') addUnicornHorn(loaded.scene);
  if (config.decorate === 'leopard') applyLeopardCoat(loaded.scene);
  const actor = new GltfActor(loaded);
  actor.play(config.clips.idle);
  return { scene: loaded.scene, actor, config };
}

/** Every model file the mounts use — lets the caller pre-warm them before the player first presses the mount key. */
export function allMountModelFiles(): string[] {
  return [...new Set(Object.values(MOUNT_VISUAL).map((v) => v.file))];
}

/**
 * Plays the right clip for the mount's state: gallop while moving, a one-
 * shot attack/flinch when the rider fights, idle otherwise. One-shots hold
 * until their clip ends, then the loop resumes.
 */
export class MountAnimator {
  private oneShotLeft = 0;

  constructor(
    private actor: GltfActor,
    private clips: MountClips,
  ) {}

  /** The rider swung or cast — the mount strikes too. */
  attack(): void {
    this.oneShot(this.clips.attack);
  }

  /** The rider got hit — the mount flinches (never interrupts an attack). */
  hit(): void {
    if (this.oneShotLeft > 0) return;
    this.oneShot(this.clips.hit);
  }

  update(dt: number, moving: boolean): void {
    if (this.oneShotLeft > 0) {
      this.oneShotLeft -= dt;
    } else {
      this.actor.play(moving ? (this.clips.run ?? this.clips.walk) : this.clips.idle, { fade: 0.2 });
    }
    this.actor.update(dt);
  }

  private oneShot(clip: string | undefined): void {
    if (!clip) return;
    const duration = this.actor.duration(clip);
    if (duration <= 0) return;
    // Force a restart even if this clip is already the current one.
    this.actor.play(this.clips.idle, { fade: 0 });
    this.actor.play(clip, { loop: false, fade: 0.08 });
    this.oneShotLeft = Math.min(duration, 1.2);
  }
}

function cloneMaterials(root: THREE.Object3D, tint?: Record<string, number>): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const swap = (m: THREE.Material): THREE.Material => {
      const copy = m.clone();
      const color = tint?.[m.name];
      if (color !== undefined && 'color' in copy) (copy as THREE.MeshStandardMaterial).color.setHex(color);
      return copy;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(swap) : swap(obj.material);
  });
}

/** A pearl-gold twisted horn on the forehead, parented to the `Head` bone so it follows every head bob. */
function addUnicornHorn(root: THREE.Group): void {
  const head = root.getObjectByName('Head');
  if (!head) return;

  // Model-space (unscaled glTF units): the forehead sits above/in front of
  // the Head bone; the horn points forward-up like a lance.
  const length = 1.15;
  const geometry = new THREE.ConeGeometry(0.13, length, 14, 12, false);
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const t = (v.y + length / 2) / length; // 0 at base, 1 at tip
    const twist = t * Math.PI * 5;
    const ridge = 1 + 0.18 * Math.sin(Math.atan2(v.z, v.x) * 3 + twist);
    const cos = Math.cos(twist);
    const sin = Math.sin(twist);
    const x = v.x * ridge;
    const z = v.z * ridge;
    pos.setXYZ(i, x * cos - z * sin, v.y + length / 2, x * sin + z * cos);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xf7ecc8,
    emissive: 0x6b5a2a,
    emissiveIntensity: 0.55,
    roughness: 0.25,
    metalness: 0.35,
  });
  const horn = new THREE.Mesh(geometry, material);
  horn.castShadow = true;

  // Place it in model space first, then re-express that pose in the Head
  // bone's own local frame so it rides along with the bone.
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const headInModel = new THREE.Matrix4().multiplyMatrices(rootInverse, head.matrixWorld);
  const desired = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 4.55, 2.85),
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.62, 0.78).normalize()),
    new THREE.Vector3(1, 1, 1),
  );
  const local = new THREE.Matrix4().multiplyMatrices(headInModel.invert(), desired);
  local.decompose(horn.position, horn.quaternion, horn.scale);
  head.add(horn);
}

/** Gold coat with dark rosettes, drawn procedurally in the fragment shader from each vertex's bind-pose position (so the spots stay glued to the body as it animates). */
function applyLeopardCoat(root: THREE.Group): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (m.name !== 'Main' && m.name !== 'Main_Light') continue;
      m.onBeforeCompile = (shader: Parameters<THREE.Material['onBeforeCompile']>[0]) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vSpotPos;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpotPos = position;');
        shader.fragmentShader = shader.fragmentShader
          .replace(
            '#include <common>',
            `#include <common>
varying vec3 vSpotPos;
vec3 spotHash(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}
float rosette(vec3 p) {
  vec3 cell = floor(p);
  vec3 f = fract(p);
  float best = 8.0;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r = o + spotHash(cell + o) * 0.8 - f;
    best = min(best, dot(r, r));
  }
  float d = sqrt(best);
  // A dark ring with a slightly darker-gold centre: the leopard rosette.
  float ring = smoothstep(0.20, 0.27, d) * (1.0 - smoothstep(0.34, 0.42, d));
  float core = 1.0 - smoothstep(0.0, 0.2, d);
  return clamp(ring + core * 0.25, 0.0, 1.0);
}`,
          )
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
float spots = rosette(vSpotPos * 3.2);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.08, 0.04), spots * 0.85);`,
          );
      };
      m.customProgramCacheKey = () => 'leopard-coat';
      m.needsUpdate = true;
    }
  });
}
