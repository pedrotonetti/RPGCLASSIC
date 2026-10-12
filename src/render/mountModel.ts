import * as THREE from 'three';
import { GltfActor, loadSkinnedInstance } from './gltfModel';

/**
 * Real rigged glTF mount creatures.
 *
 * Ground mounts come from Quaternius' CC0 "Ultimate Animated Animal Pack"
 * (brown horse, white horse, wolf, stag — see `public/models/CREDITS.md`),
 * each with its own named clips (`Idle`, `Walk`, `Gallop`, `Attack…`,
 * `Idle_HitReact1`). A few looks have no CC0 model of their own and are
 * built from one at load time instead:
 *  - unicorn / Alicórnio: the white horse plus a pearl spiral horn pinned to
 *    its `Head` bone;
 *  - leopard / grifo: the wolf re-coated (procedural rosettes for the
 *    leopard, a plain tawny lion coat for the griffin);
 *  - every winged mount except the dragon and the pterodactyl: procedural
 *    feather / leather / light wings pinned to the spine (`Torso3` bone),
 *    flapped every frame by `MountAnimator`.
 * The dragon is Quaternius' CC0 "Ultimate Monsters" dragon (its evolved
 * model for the last stage); the pterodactyl is Gobkit's CC0 one.
 *
 * Flying mounts evolve (data/mounts.ts `stages`): each stage can change the
 * scale, coat tint, wings, horn — or the whole model.
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

type WingStyle = 'feather' | 'membrane' | 'light';

interface WingLook {
  style: WingStyle;
  color: number;
  /** Feather tips / membrane veins / glow. */
  accent: number;
  /** Span of ONE wing, in the model's own (unscaled) units. */
  span: number;
  emissive?: number;
}

/** Where wings attach on a given model, in its own (unscaled) units. */
interface WingMount {
  bone: string;
  /** Shoulder position of the RIGHT wing (the left one is mirrored on x). */
  shoulder: THREE.Vector3;
}

interface StageLook {
  file?: string;
  scale: number;
  /** Per-material colour overrides, by glTF material name. */
  tint?: Record<string, number>;
  /** Per-material emissive glow, by glTF material name. */
  glow?: Record<string, number>;
  wings?: WingLook;
  horn?: boolean;
  /** A pair of swept-back horns on the head (the drake). */
  horns?: { color: number; size: number; emissive?: number };
  coat?: 'leopard' | 'scales';
}

interface MountVisualDef {
  file: string;
  /** Rider root position inside the mount, in the model's own units (scaled with the stage). */
  seat: THREE.Vector3;
  /** 0 for a ground mount, positive for a flying one hovering over the terrain. */
  hoverHeight: number;
  clips: MountClips;
  wingMount?: WingMount;
  /** One look per evolution stage (index = stage); a non-evolving mount has one. */
  looks: StageLook[];
}

/** What a loaded mount needs at runtime (OverworldScreen seats the rider at `seatOffset`). */
interface MountVisualConfig {
  seatOffset: THREE.Vector3;
  hoverHeight: number;
  clips: MountClips;
}

const QUATERNIUS_CLIPS: MountClips = { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack_Headbutt', hit: 'Idle_HitReact1' };
const WOLF_CLIPS: MountClips = { idle: 'Idle', walk: 'Walk', run: 'Gallop', attack: 'Attack', hit: 'Idle_HitReact1' };

const HORSE_SEAT = new THREE.Vector3(0, 2.77, -0.26);
const HORSE_WINGS: WingMount = { bone: 'Torso3', shoulder: new THREE.Vector3(0.42, 2.95, 0.72) };
const WOLF_SEAT = new THREE.Vector3(0, 1.9, 0);
const WOLF_WINGS: WingMount = { bone: 'Torso3', shoulder: new THREE.Vector3(0.36, 2.0, 0.5) };
const STAG_SEAT = new THREE.Vector3(0, 2.42, -0.19);
const STAG_WINGS: WingMount = { bone: 'Torso3', shoulder: new THREE.Vector3(0.48, 2.55, 0.6) };
const FLY_HEIGHT = 1.8;

const HORSE_WHITE_COAT = { Main: 0xf3f1ec, Main_Light: 0xffffff, Hair: 0xe6e2da };
const BLACK_HORSE_COAT = { Main: 0x2a2228, Main_Dark: 0x151015, Main_Light: 0x3a3036, Hair: 0x0d0b0d, Muzzle: 0x1d171b };
const GRIFFIN_COAT = { Main: 0xc79a4a, Main_Light: 0xf2e6c8, Nose: 0x3a2a1a };

const MOUNT_VISUALS: Record<string, MountVisualDef> = {
  // --- terrestres ---------------------------------------------------------
  cavalo_marrom: { file: 'mounts/horse_brown.glb', seat: HORSE_SEAT, hoverHeight: 0, clips: QUATERNIUS_CLIPS, looks: [{ scale: 0.47 }] },
  cavalo_branco: { file: 'mounts/horse_white.glb', seat: HORSE_SEAT, hoverHeight: 0, clips: QUATERNIUS_CLIPS, looks: [{ scale: 0.47, tint: HORSE_WHITE_COAT }] },
  unicornio: {
    file: 'mounts/horse_white.glb',
    seat: HORSE_SEAT,
    hoverHeight: 0,
    clips: QUATERNIUS_CLIPS,
    looks: [{ scale: 0.47, tint: { Main: 0xfbf8ff, Main_Light: 0xffffff, Hair: 0xd9c8ff, Hooves: 0xe9d6a0 }, horn: true }],
  },
  lobo: { file: 'mounts/wolf.glb', seat: WOLF_SEAT, hoverHeight: 0, clips: WOLF_CLIPS, looks: [{ scale: 0.58 }] },
  leopardo: {
    file: 'mounts/wolf.glb',
    seat: WOLF_SEAT,
    hoverHeight: 0,
    clips: WOLF_CLIPS,
    looks: [{ scale: 0.56, tint: { Main: 0xd9a441, Main_Light: 0xf5e6c2, Nose: 0x2a1d14 }, coat: 'leopard' }],
  },
  cervo: { file: 'mounts/stag.glb', seat: STAG_SEAT, hoverHeight: 0, clips: QUATERNIUS_CLIPS, looks: [{ scale: 0.52 }] },

  // --- voadoras -----------------------------------------------------------
  condor: {
    file: 'mounts/pterodactylus.glb',
    seat: new THREE.Vector3(0, 1.47, -0.18),
    hoverHeight: 1.6,
    clips: { idle: 'idle', walk: 'walk', attack: 'attack' },
    looks: [{ scale: 0.85 }],
  },
  pegaso: {
    file: 'mounts/horse_white.glb',
    seat: HORSE_SEAT,
    hoverHeight: FLY_HEIGHT,
    clips: QUATERNIUS_CLIPS,
    wingMount: HORSE_WINGS,
    looks: [
      { scale: 0.45, tint: HORSE_WHITE_COAT, wings: { style: 'feather', color: 0xf7f7f2, accent: 0xc9dcef, span: 3.2 } },
      { scale: 0.5, tint: { ...HORSE_WHITE_COAT, Hooves: 0xe2c071 }, wings: { style: 'feather', color: 0xffffff, accent: 0xf0d27a, span: 3.8 } },
      {
        scale: 0.55,
        tint: { Main: 0xfdfbff, Main_Light: 0xffffff, Hair: 0xe3d2ff, Hooves: 0xf0d27a },
        glow: { Hair: 0x3a2a66 },
        wings: { style: 'feather', color: 0xfffaf0, accent: 0xffc94a, span: 4.4, emissive: 0x4a3a10 },
        horn: true,
      },
    ],
  },
  dragao: {
    file: 'mounts/wolf.glb',
    seat: WOLF_SEAT,
    hoverHeight: FLY_HEIGHT,
    clips: WOLF_CLIPS,
    wingMount: WOLF_WINGS,
    looks: [
      {
        scale: 0.56,
        tint: { Main: 0xa8402a, Main_Light: 0xe0a060, Nose: 0x2a1410 },
        coat: 'scales',
        horns: { color: 0xe8dcc0, size: 0.8 },
        wings: { style: 'membrane', color: 0x7a2418, accent: 0xd8843a, span: 2.9 },
      },
      {
        scale: 0.63,
        tint: { Main: 0xb8261c, Main_Light: 0xf0b04a, Nose: 0x2a1410 },
        coat: 'scales',
        horns: { color: 0xf3e6c4, size: 1.05 },
        wings: { style: 'membrane', color: 0x8a1a12, accent: 0xff8a2a, span: 3.5, emissive: 0x3a0a02 },
      },
      {
        scale: 0.7,
        tint: { Main: 0x2a1418, Main_Light: 0xd8a03a, Nose: 0x120808 },
        glow: { Main_Light: 0x3a2004 },
        coat: 'scales',
        horns: { color: 0xffd36b, size: 1.3, emissive: 0x5a3a08 },
        wings: { style: 'membrane', color: 0x1e0c10, accent: 0xffb02a, span: 4.1, emissive: 0x5a2004 },
      },
    ],
  },
  grifo: {
    file: 'mounts/wolf.glb',
    seat: WOLF_SEAT,
    hoverHeight: FLY_HEIGHT,
    clips: WOLF_CLIPS,
    wingMount: WOLF_WINGS,
    looks: [
      { scale: 0.58, tint: GRIFFIN_COAT, wings: { style: 'feather', color: 0x7a5230, accent: 0xe8d9b5, span: 2.9 } },
      { scale: 0.64, tint: { ...GRIFFIN_COAT, Main: 0xd8a945 }, wings: { style: 'feather', color: 0xd6a640, accent: 0xfff2c0, span: 3.4 } },
      {
        scale: 0.7,
        tint: { Main: 0xe8c068, Main_Light: 0xffffff, Nose: 0x3a2a1a },
        wings: { style: 'feather', color: 0xf5edd8, accent: 0xffc23a, span: 3.9, emissive: 0x3a2a08 },
      },
    ],
  },
  cervo_estelar: {
    file: 'mounts/stag.glb',
    seat: STAG_SEAT,
    hoverHeight: FLY_HEIGHT,
    clips: QUATERNIUS_CLIPS,
    wingMount: STAG_WINGS,
    looks: [
      { scale: 0.5, tint: { Material: 0xb98a5e }, wings: { style: 'light', color: 0xbdefff, accent: 0xffffff, span: 3.0, emissive: 0x2a6d88 } },
      {
        scale: 0.55,
        tint: { Material: 0xd8eefc, 'Material.003': 0xffffff },
        glow: { 'Material.010': 0x1d6a8a },
        wings: { style: 'light', color: 0x9fe9ff, accent: 0xffffff, span: 3.6, emissive: 0x3aa0c8 },
      },
      {
        scale: 0.6,
        tint: { Material: 0xf2f8ff, 'Material.003': 0xffffff, 'Material.010': 0xfff2c0 },
        glow: { 'Material.010': 0xc89a2a, Material: 0x10202c },
        wings: { style: 'light', color: 0xfff1c4, accent: 0xffffff, span: 4.2, emissive: 0xc8962a },
      },
    ],
  },
  corcel_sombrio: {
    file: 'mounts/horse_brown.glb',
    seat: HORSE_SEAT,
    hoverHeight: FLY_HEIGHT,
    clips: QUATERNIUS_CLIPS,
    wingMount: HORSE_WINGS,
    looks: [
      { scale: 0.46, tint: BLACK_HORSE_COAT, wings: { style: 'membrane', color: 0x2e1a22, accent: 0x6a1f22, span: 3.3 } },
      {
        scale: 0.51,
        tint: BLACK_HORSE_COAT,
        glow: { Hair: 0x5a1a08 },
        wings: { style: 'membrane', color: 0x24141a, accent: 0xff6a2a, span: 3.9, emissive: 0x5a1a08 },
      },
      {
        scale: 0.56,
        tint: { ...BLACK_HORSE_COAT, Main: 0x1c1626, Hair: 0x2b1840 },
        glow: { Hair: 0x4a2a8a },
        wings: { style: 'membrane', color: 0x1a1024, accent: 0xb070ff, span: 4.5, emissive: 0x3a1a6a },
      },
    ],
  },
};

/** Loaded wing pivots, flapped by `MountAnimator` (right wing rotates +z to rise, left −z). */
export interface MountWings {
  right: THREE.Object3D;
  left: THREE.Object3D;
}

export interface MountVisual {
  scene: THREE.Group;
  actor: GltfActor;
  config: MountVisualConfig;
  wings: MountWings | null;
}

/** Loads the creature standing in for `mountId` at evolution stage `stage`, ready to add to the scene and drive via `MountAnimator`. */
export async function loadMountVisual(mountId: string, stage = 0): Promise<MountVisual> {
  const def = MOUNT_VISUALS[mountId] ?? MOUNT_VISUALS.cavalo_marrom;
  const look = def.looks[Math.min(stage, def.looks.length - 1)];
  const loaded = await loadSkinnedInstance(look.file ?? def.file);
  cloneMaterials(loaded.scene, look.tint, look.glow);
  loaded.scene.scale.setScalar(look.scale);
  if (look.horn) addUnicornHorn(loaded.scene);
  if (look.coat) applyPatternCoat(loaded.scene, look.coat);
  if (look.horns) addDrakeHorns(loaded.scene, look.horns);
  const wings = look.wings && def.wingMount ? addWings(loaded.scene, def.wingMount, look.wings) : null;
  const actor = new GltfActor(loaded);
  actor.play(def.clips.idle);
  const config: MountVisualConfig = {
    seatOffset: def.seat.clone().multiplyScalar(look.scale),
    hoverHeight: def.hoverHeight,
    clips: def.clips,
  };
  return { scene: loaded.scene, actor, config, wings };
}

/** Every model file the mounts use — lets the caller pre-warm them before the player first presses the mount key. */
export function allMountModelFiles(): string[] {
  const files = new Set<string>();
  for (const def of Object.values(MOUNT_VISUALS)) {
    files.add(def.file);
    for (const look of def.looks) if (look.file) files.add(look.file);
  }
  return [...files];
}

/**
 * Plays the right clip for the mount's state: gallop while moving, a one-
 * shot attack/flinch when the rider fights, idle otherwise. One-shots hold
 * until their clip ends, then the loop resumes. Also beats the procedural
 * wings: slow gliding strokes at rest, full strokes while flying forward.
 */
export class MountAnimator {
  private oneShotLeft = 0;
  private wingTime = 0;

  constructor(
    private actor: GltfActor,
    private clips: MountClips,
    private wings: MountWings | null = null,
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

    if (this.wings) {
      this.wingTime += dt * (moving ? 7.5 : 3);
      const angle = 0.25 + Math.sin(this.wingTime) * (moving ? 0.55 : 0.22);
      this.wings.right.rotation.z = angle;
      this.wings.left.rotation.z = -angle;
    }
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

function cloneMaterials(root: THREE.Object3D, tint?: Record<string, number>, glow?: Record<string, number>): void {
  root.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const swap = (m: THREE.Material): THREE.Material => {
      const copy = m.clone();
      const color = tint?.[m.name];
      if (color !== undefined && 'color' in copy) (copy as THREE.MeshStandardMaterial).color.setHex(color);
      const emissive = glow?.[m.name];
      if (emissive !== undefined && 'emissive' in copy) (copy as THREE.MeshStandardMaterial).emissive.setHex(emissive);
      return copy;
    };
    obj.material = Array.isArray(obj.material) ? obj.material.map(swap) : swap(obj.material);
  });
}

/** Re-expresses a model-space pose in `bone`'s own local frame, so an object added to the bone sits there now and follows the bone afterwards. */
function attachAtModelPose(root: THREE.Object3D, bone: THREE.Object3D, child: THREE.Object3D, position: THREE.Vector3, quaternion: THREE.Quaternion): void {
  root.updateMatrixWorld(true);
  const rootInverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const boneInModel = new THREE.Matrix4().multiplyMatrices(rootInverse, bone.matrixWorld);
  const desired = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1));
  const local = new THREE.Matrix4().multiplyMatrices(boneInModel.invert(), desired);
  local.decompose(child.position, child.quaternion, child.scale);
  bone.add(child);
}

/** A pearl-gold twisted horn on the forehead, parented to the `Head` bone so it follows every head bob. */
function addUnicornHorn(root: THREE.Group): void {
  const head = root.getObjectByName('Head');
  if (!head) return;

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
  const material = new THREE.MeshStandardMaterial({ color: 0xf7ecc8, emissive: 0x6b5a2a, emissiveIntensity: 0.55, roughness: 0.25, metalness: 0.35 });
  const horn = new THREE.Mesh(geometry, material);
  horn.castShadow = true;
  // Model space: forehead above/in front of the Head bone, pointing forward-up like a lance.
  const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0.62, 0.78).normalize());
  attachAtModelPose(root, head, horn, new THREE.Vector3(0, 4.55, 2.85), tilt);
}

/**
 * Outline of ONE right wing in its own plane: x = span (0 at the shoulder,
 * 1 at the tip), y = chord (+ = leading edge/forward, − = trailing edge).
 */
function wingOutline(style: WingStyle): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.05);
  if (style === 'membrane') {
    // Bat-like: a bony leading edge ending in finger tips, the membrane scalloped between them.
    shape.bezierCurveTo(0.3, 0.2, 0.65, 0.22, 1.0, 0.06);
    const tips: Array<[number, number]> = [
      [0.86, -0.42],
      [0.6, -0.62],
      [0.32, -0.56],
      [0.06, -0.36],
    ];
    let prev: [number, number] = [1.0, 0.06];
    for (const tip of tips) {
      const midX = (prev[0] + tip[0]) / 2;
      const midY = (prev[1] + tip[1]) / 2;
      shape.quadraticCurveTo(midX - 0.06, midY + 0.12, tip[0], tip[1]);
      prev = tip;
    }
    shape.quadraticCurveTo(0.0, -0.2, 0, 0.05);
    return shape;
  }
  // Feathered (also used, glowing and translucent, for the light wings): a
  // rounded leading edge, then a row of long primary feathers along the back.
  shape.bezierCurveTo(0.25, 0.22, 0.6, 0.24, 1.0, 0.02);
  const feathers = 9;
  for (let i = 0; i < feathers; i++) {
    const t0 = 1 - i / feathers;
    const t1 = 1 - (i + 1) / feathers;
    const depth = (t: number) => -0.18 - 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.15)) - 0.1 * (1 - t);
    const tipX = t0 - 0.02;
    shape.lineTo(tipX - 0.03, depth(t0) - 0.04);
    shape.quadraticCurveTo((t0 + t1) / 2, depth((t0 + t1) / 2) + 0.12, t1 + 0.01, depth(t1) - 0.02);
  }
  shape.lineTo(0, -0.22);
  shape.lineTo(0, 0.05);
  return shape;
}

function wingMaterial(look: WingLook, layer: 'base' | 'accent'): THREE.MeshStandardMaterial {
  const color = layer === 'base' ? look.color : look.accent;
  const light = look.style === 'light';
  return new THREE.MeshStandardMaterial({
    color,
    // Without its own glow, a soft self-light in the wing's colour keeps the
    // shaded underside from going muddy under the hemisphere ground colour.
    emissive: look.emissive ?? new THREE.Color(color).multiplyScalar(0.22).getHex(),
    emissiveIntensity: light ? 1.2 : look.emissive ? 0.6 : 1,
    roughness: look.style === 'membrane' ? 0.55 : 0.8,
    side: THREE.DoubleSide,
    transparent: light,
    opacity: light ? (layer === 'base' ? 0.78 : 0.6) : 1,
    depthWrite: !light,
  });
}

/**
 * Shape plane (x = span, y = chord) → model plane (x = span, z = chord),
 * lying flat with its normals facing UP; `mirror` flips it onto the left
 * side in the geometry itself (a negative object scale would flip the
 * winding and light that wing from underneath).
 */
function layFlat(geometry: THREE.BufferGeometry, mirror: boolean): THREE.BufferGeometry {
  geometry.rotateX(Math.PI / 2);
  if (mirror) geometry.scale(-1, 1, 1);
  geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;
  if (normals.count > 0 && normals.getY(0) < 0) {
    const index = geometry.index;
    if (index) {
      for (let i = 0; i < index.count; i += 3) {
        const b = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, b);
      }
      index.needsUpdate = true;
    }
    geometry.computeVertexNormals();
  }
  return geometry;
}

/** Builds one wing (a pivot at the shoulder whose child geometry extends along +x) — `mirror` makes the left one. */
function buildWing(look: WingLook, mirror: boolean): THREE.Object3D {
  const flap = new THREE.Group();
  const outline = wingOutline(look.style);
  const base = layFlat(new THREE.ShapeGeometry(outline, 16), mirror);
  const main = new THREE.Mesh(base, wingMaterial(look, 'base'));
  main.castShadow = look.style !== 'light';

  // A second, smaller layer: coverts on a feather wing / veins band on a
  // leather one / an inner glow on a light wing — gives the wing depth.
  const inner = layFlat(new THREE.ShapeGeometry(outline, 12), mirror);
  inner.scale(0.62, 1, 0.55);
  inner.translate(0, 0.012, 0.02);
  const accent = new THREE.Mesh(inner, wingMaterial(look, 'accent'));

  const holder = new THREE.Group();
  holder.add(main, accent);
  holder.scale.set(look.span, look.span, look.span * 0.95);
  // Swept slightly back and up, like a resting bird's wing.
  holder.rotation.y = mirror ? 0.18 : -0.18;
  flap.add(holder);
  return flap;
}

function addWings(root: THREE.Group, mount: WingMount, look: WingLook): MountWings | null {
  const bone = root.getObjectByName(mount.bone);
  if (!bone) return null;
  const right = buildWing(look, false);
  const left = buildWing(look, true);
  const identity = new THREE.Quaternion();
  attachAtModelPose(root, bone, right, mount.shoulder.clone(), identity);
  attachAtModelPose(root, bone, left, mount.shoulder.clone().setX(-mount.shoulder.x), identity);
  // Wings flap around their own (model-aligned) z axis — wrap each in an
  // extra pivot so `rotation.z` is relative to that rest pose, not the bone.
  return { right: wrapPivot(right), left: wrapPivot(left) };
}

/** Moves `obj`'s children under a fresh child pivot and returns it, so rotating the pivot happens in `obj`'s own (rest-pose) frame. */
function wrapPivot(obj: THREE.Object3D): THREE.Object3D {
  const pivot = new THREE.Group();
  for (const child of [...obj.children]) pivot.add(child);
  obj.add(pivot);
  return pivot;
}

/** Two curved horns swept back from the brow, parented to the `Head` bone. Model-space positions are for the wolf rig. */
function addDrakeHorns(root: THREE.Group, look: { color: number; size: number; emissive?: number }): void {
  const head = root.getObjectByName('Head');
  if (!head) return;
  const material = new THREE.MeshStandardMaterial({ color: look.color, emissive: look.emissive ?? 0x000000, emissiveIntensity: 0.6, roughness: 0.45 });
  for (const side of [1, -1]) {
    // A cone bent backwards along its length.
    const length = 0.75 * look.size;
    const geometry = new THREE.ConeGeometry(0.09 * look.size, length, 10, 8);
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + length / 2) / length;
      pos.setY(i, pos.getY(i) + length / 2);
      pos.setZ(i, pos.getZ(i) - t * t * 0.35 * look.size);
    }
    geometry.computeVertexNormals();
    const horn = new THREE.Mesh(geometry, material);
    horn.castShadow = true;
    const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(side * 0.25, 0.75, -0.6).normalize());
    attachAtModelPose(root, head, horn, new THREE.Vector3(side * 0.17, 2.4, 1.95), tilt);
  }
}

/**
 * A procedural coat drawn in the fragment shader from each vertex's
 * bind-pose position (so the pattern stays glued to the body as it
 * animates): dark rosettes for the leopard, overlapping scale rings for the
 * drake.
 */
function applyPatternCoat(root: THREE.Group, coat: 'leopard' | 'scales'): void {
  const freq = coat === 'leopard' ? '3.2' : '7.0';
  const ink = coat === 'leopard' ? 'vec3(0.13, 0.08, 0.04)' : 'diffuseColor.rgb * 0.45';
  const strength = coat === 'leopard' ? '0.85' : '0.6';
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
float spots = rosette(vSpotPos * ${freq});
diffuseColor.rgb = mix(diffuseColor.rgb, ${ink}, spots * ${strength});`,
          );
      };
      m.customProgramCacheKey = () => `coat-${coat}`;
      m.needsUpdate = true;
    }
  });
}
