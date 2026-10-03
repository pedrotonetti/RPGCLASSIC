import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WildlifeLayout } from '../systems/wildlifePlacement';
import { GltfActor, loadSkinnedInstance } from './gltfModel';
import { tileCenterWorld } from './worldBuilder';

/**
 * fox.glb (the Khronos sample Fox) is authored in centimetre-scale units:
 * its bind pose stands ~79 units tall at the ear tips and ~155 long
 * nose-to-tail (the mesh's own POSITION accessor bounds). The old
 * hand-picked FOX_SCALE of 0.42 assumed a roughly unit-sized model, which
 * actually rendered every fox ~33 world units tall — ~18x the ~1.8-unit
 * player/NPC avatars. Scale is derived from the native height instead, so
 * each fox stands a believable ~0.55 units (knee/hip height next to an
 * avatar) before its own ±15% size jitter.
 */
const FOX_NATIVE_HEIGHT = 79;
const FOX_TARGET_HEIGHT = 0.55;
const FOX_SCALE = FOX_TARGET_HEIGHT / FOX_NATIVE_HEIGHT;

/**
 * Beyond this distance (world units) from the player a creature is hidden
 * and not simulated at all — the scene fog (OverworldScreen: far 46) has
 * already faded anything past it to sky colour, so this costs nothing
 * visible and keeps a big zone's couple hundred creatures down to the
 * handful nearby.
 */
const ACTIVE_RADIUS = 44;

type GroundSpecies = 'fox' | 'rabbit' | 'deer';
type FlyingSpecies = 'butterfly' | 'bird';

/** Ground wanderers: how far they roam from home, how fast, and how skittish they are around the player. */
const GROUND_PROFILE: Record<GroundSpecies, { wander: number; speed: number; fleeRadius: number; fleeSpeedMult: number; fleeDist: number; waitMin: number; waitRange: number; hop: number }> = {
  fox: { wander: 1.6, speed: 0.6, fleeRadius: 2.6, fleeSpeedMult: 2.6, fleeDist: 3.0, waitMin: 1.5, waitRange: 3.5, hop: 0 },
  rabbit: { wander: 1.4, speed: 0.9, fleeRadius: 3.2, fleeSpeedMult: 2.4, fleeDist: 2.8, waitMin: 0.8, waitRange: 2.5, hop: 0.16 },
  deer: { wander: 2.6, speed: 0.55, fleeRadius: 4.5, fleeSpeedMult: 3.2, fleeDist: 4.5, waitMin: 2.5, waitRange: 4, hop: 0 },
};

interface GroundCreature {
  kind: 'ground';
  species: GroundSpecies;
  root: THREE.Object3D;
  actor: GltfActor | null;
  home: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  moveT: number;
  moveDuration: number;
  hops: number;
  waitTimer: number;
  speedScale: number;
  fleeing: boolean;
}

interface FlyingCreature {
  kind: 'flying';
  species: FlyingSpecies;
  root: THREE.Object3D;
  wingL: THREE.Object3D;
  wingR: THREE.Object3D;
  home: THREE.Vector3;
  phase: number;
  radius: number;
  height: number;
  speed: number;
  flap: number;
  prevX: number;
  prevZ: number;
}

type Creature = GroundCreature | FlyingCreature;

// --- shared procedural assets ---------------------------------------------
//
// Built once and reused by every creature in every zone: each species' static
// body is ONE merged, vertex-coloured mesh (one draw call per creature), and
// only the parts that actually animate (wings) are separate. Shared across
// zone mounts on purpose, so — like the cached glTF rigs NPCs/foxes share —
// these are never disposed on unmount (see OverworldScreen.disposeGroup's own
// doc comment); they're a few KB of geometry total.

interface SharedAssets {
  bodyMat: THREE.MeshStandardMaterial;
  rabbitBodies: THREE.BufferGeometry[];
  deerBodies: THREE.BufferGeometry[];
  butterflyBody: THREE.BufferGeometry;
  butterflyWing: THREE.BufferGeometry;
  butterflyWingMats: THREE.MeshStandardMaterial[];
  birdBodies: THREE.BufferGeometry[];
  birdWing: THREE.BufferGeometry;
  birdWingMats: THREE.MeshStandardMaterial[];
  flowerStem: THREE.BufferGeometry;
  flowerHead: THREE.BufferGeometry;
  flowerStemMat: THREE.MeshStandardMaterial;
  flowerHeadMat: THREE.MeshStandardMaterial;
}

let shared: SharedAssets | null = null;

function part(geo: THREE.BufferGeometry, color: number, pos: [number, number, number], scale: [number, number, number] = [1, 1, 1], rot: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale),
  );
  geo.applyMatrix4(m);
  const c = new THREE.Color(color);
  const count = geo.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  if (!merged) throw new Error('Falha ao montar geometria de vida selvagem');
  for (const g of parts) g.dispose();
  return merged;
}

/** Forward is +Z for every procedural body, matching rotation.y = atan2(dx, dz). */
function buildRabbit(fur: number): THREE.BufferGeometry {
  return merge([
    part(new THREE.SphereGeometry(0.13, 8, 6), fur, [0, 0.13, 0], [1, 0.85, 1.3]),
    part(new THREE.SphereGeometry(0.085, 8, 6), fur, [0, 0.24, 0.14]),
    part(new THREE.BoxGeometry(0.03, 0.13, 0.05), fur, [0.035, 0.34, 0.11], [1, 1, 1], [-0.25, 0, 0.15]),
    part(new THREE.BoxGeometry(0.03, 0.13, 0.05), fur, [-0.035, 0.34, 0.11], [1, 1, 1], [-0.25, 0, -0.15]),
    part(new THREE.SphereGeometry(0.045, 6, 4), 0xf4f1e6, [0, 0.15, -0.17]),
    part(new THREE.SphereGeometry(0.014, 4, 3), 0x1a1410, [0.045, 0.26, 0.2]),
    part(new THREE.SphereGeometry(0.014, 4, 3), 0x1a1410, [-0.045, 0.26, 0.2]),
  ]);
}

function buildDeer(coat: number, antlers: boolean): THREE.BufferGeometry {
  const leg = 0x6b4a2a;
  const parts = [
    part(new THREE.CapsuleGeometry(0.16, 0.42, 3, 8), coat, [0, 0.62, 0], [1, 1, 1], [Math.PI / 2, 0, 0]),
    part(new THREE.CylinderGeometry(0.06, 0.08, 0.36, 6), coat, [0, 0.84, 0.3], [1, 1, 1], [0.55, 0, 0]),
    part(new THREE.BoxGeometry(0.12, 0.12, 0.25), coat, [0, 1.0, 0.44]),
    part(new THREE.BoxGeometry(0.05, 0.08, 0.03), coat, [0.07, 1.08, 0.36], [1, 1, 1], [0, 0, -0.6]),
    part(new THREE.BoxGeometry(0.05, 0.08, 0.03), coat, [-0.07, 1.08, 0.36], [1, 1, 1], [0, 0, 0.6]),
    part(new THREE.SphereGeometry(0.035, 5, 4), 0x1a1410, [0, 0.99, 0.57]),
    part(new THREE.SphereGeometry(0.06, 6, 4), 0xf4f1e6, [0, 0.72, -0.34]),
  ];
  for (const [x, z] of [[0.1, 0.22], [-0.1, 0.22], [0.1, -0.22], [-0.1, -0.22]]) {
    parts.push(part(new THREE.CylinderGeometry(0.032, 0.024, 0.5, 5), leg, [x, 0.25, z]));
  }
  if (antlers) {
    for (const side of [1, -1]) {
      parts.push(part(new THREE.CylinderGeometry(0.012, 0.018, 0.26, 4), 0xd9c9a3, [0.05 * side, 1.18, 0.4], [1, 1, 1], [-0.2, 0, -0.45 * side]));
      parts.push(part(new THREE.CylinderGeometry(0.01, 0.014, 0.14, 4), 0xd9c9a3, [0.11 * side, 1.25, 0.45], [1, 1, 1], [0.5, 0, -0.2 * side]));
    }
  }
  return merge(parts);
}

function buildBird(back: number, breast: number): THREE.BufferGeometry {
  return merge([
    part(new THREE.SphereGeometry(0.07, 8, 6), back, [0, 0, 0], [0.75, 0.65, 1.4]),
    part(new THREE.SphereGeometry(0.05, 6, 4), breast, [0, -0.02, 0.04], [0.8, 0.6, 1]),
    part(new THREE.SphereGeometry(0.05, 6, 5), back, [0, 0.03, 0.1]),
    part(new THREE.ConeGeometry(0.015, 0.05, 4), 0xe0a030, [0, 0.025, 0.16], [1, 1, 1], [Math.PI / 2, 0, 0]),
    part(new THREE.BoxGeometry(0.06, 0.01, 0.08), back, [0, 0, -0.12]),
  ]);
}

function sharedAssets(): SharedAssets {
  if (shared) return shared;
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });

  // Flat wings, lying horizontally with their inner edge on the body's axis
  // (x = 0) so rotating the pivot around Z flaps them.
  // Sized for the gameplay camera, which sits well above and behind the
  // avatar — true-to-life butterflies/flowers would read as a few stray
  // pixels from there.
  const butterflyWing = new THREE.PlaneGeometry(0.2, 0.17);
  butterflyWing.translate(0.1, 0, 0);
  butterflyWing.rotateX(-Math.PI / 2);
  const birdWing = new THREE.PlaneGeometry(0.34, 0.12);
  birdWing.translate(0.17, 0, 0);
  birdWing.rotateX(-Math.PI / 2);

  const wingMat = (color: number) =>
    new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6, emissive: color, emissiveIntensity: 0.3 });

  // Ipê blossom colours — the tree Ipêra itself is named for (see LORE.md):
  // yellow, pink, purple and white, plus a warm orange for variety.
  const flowerHead = new THREE.IcosahedronGeometry(0.075, 0);
  flowerHead.scale(1, 0.6, 1);
  flowerHead.translate(0, 0.25, 0);
  const flowerStem = new THREE.CylinderGeometry(0.01, 0.014, 0.24, 4);
  flowerStem.translate(0, 0.12, 0);

  shared = {
    bodyMat,
    rabbitBodies: [buildRabbit(0xa8825a), buildRabbit(0x9a9590), buildRabbit(0xe8e2d6)],
    deerBodies: [buildDeer(0x9b6b3e, true), buildDeer(0xa8784a, false)],
    butterflyBody: merge([part(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 4), 0x2a2220, [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0])]),
    butterflyWing,
    butterflyWingMats: [0xf2c14e, 0xe8833a, 0x7ec8e3, 0xf4f1e6, 0xb07cc6].map(wingMat),
    // A dark generic songbird and a sabiá-laranjeira (orange breast).
    birdBodies: [buildBird(0x4a4038, 0x6a5d50), buildBird(0x7a6a55, 0xd9823a)],
    birdWing,
    birdWingMats: [wingMat(0x3f362e), wingMat(0x6e5f4c)],
    flowerStem,
    flowerHead,
    flowerStemMat: new THREE.MeshStandardMaterial({ color: 0x3f7a35, roughness: 0.9 }),
    flowerHeadMat: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, emissive: 0x222222 }),
  };
  return shared;
}

const FLOWER_COLORS = [0xf2c14e, 0xe98bb5, 0x9b6fc4, 0xf4f1e6, 0xec8b3d];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Owns every ambient creature and flower patch in one zone. Nothing here is
 * part of combat — creatures can't be targeted or hurt; the skittish ground
 * species (rabbit, deer, fox) just bolt a few steps away when the player
 * gets close, butterflies flutter around their own flower patch, and birds
 * circle over the woods. Butterflies and birds settle in for the night
 * (hidden while GameClock.isNight), foxes keep roaming.
 */
export class WildlifeManager {
  private creatures: Creature[] = [];
  private flowerMeshes: THREE.InstancedMesh[] = [];
  private disposed = false;
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    /** Whether a ground creature may stand at this world (x,z) — OverworldScreen passes its own tree/building/water collision check. */
    private canStand: (x: number, z: number) => boolean,
  ) {}

  spawn(layout: WildlifeLayout): void {
    this.buildFlowers(layout.flowerPatches);
    for (const site of layout.creatures) {
      const home = tileCenterWorld(site.x, site.y);
      if (site.species === 'fox') void this.spawnFox(home);
      else if (site.species === 'rabbit' || site.species === 'deer') this.spawnGround(site.species, home);
      else this.spawnFlying(site.species, home);
    }
  }

  private buildFlowers(patches: Array<{ x: number; y: number }>): void {
    if (patches.length === 0) return;
    const assets = sharedAssets();
    const positions: Array<{ x: number; z: number; s: number; r: number; color: number }> = [];
    for (const patch of patches) {
      const center = tileCenterWorld(patch.x, patch.y);
      const n = 12 + Math.floor(Math.random() * 7);
      const palette = [pick(FLOWER_COLORS), pick(FLOWER_COLORS)];
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.sqrt(Math.random()) * 0.85;
        positions.push({ x: center.x + Math.cos(a) * d, z: center.z + Math.sin(a) * d, s: 0.8 + Math.random() * 0.5, r: Math.random() * Math.PI * 2, color: pick(palette) });
      }
    }
    const stems = new THREE.InstancedMesh(assets.flowerStem, assets.flowerStemMat, positions.length);
    const heads = new THREE.InstancedMesh(assets.flowerHead, assets.flowerHeadMat, positions.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const axisY = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    positions.forEach((f, i) => {
      m.compose(p.set(f.x, 0, f.z), q.setFromAxisAngle(axisY, f.r), s.setScalar(f.s));
      stems.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      heads.setColorAt(i, color.setHex(f.color));
    });
    this.scene.add(stems, heads);
    this.flowerMeshes.push(stems, heads);
  }

  private async spawnFox(home: THREE.Vector3): Promise<void> {
    let model;
    try {
      model = await loadSkinnedInstance('fox.glb');
    } catch (err) {
      console.error('Falha ao carregar fox.glb', err);
      return;
    }
    if (this.disposed) return;
    const actor = new GltfActor(model);
    model.scene.scale.setScalar(FOX_SCALE * (0.85 + Math.random() * 0.3));
    model.scene.position.copy(home);
    model.scene.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(model.scene);
    actor.play('Survey');
    this.creatures.push(this.groundState('fox', model.scene, home, actor));
  }

  private spawnGround(species: 'rabbit' | 'deer', home: THREE.Vector3): void {
    const assets = sharedAssets();
    const geo = species === 'rabbit' ? pick(assets.rabbitBodies) : pick(assets.deerBodies);
    const mesh = new THREE.Mesh(geo, assets.bodyMat);
    mesh.castShadow = true;
    mesh.scale.setScalar(0.9 + Math.random() * 0.25);
    mesh.position.copy(home);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(mesh);
    this.creatures.push(this.groundState(species, mesh, home, null));
  }

  private groundState(species: GroundSpecies, root: THREE.Object3D, home: THREE.Vector3, actor: GltfActor | null): GroundCreature {
    return {
      kind: 'ground',
      species,
      root,
      actor,
      home: home.clone(),
      from: home.clone(),
      to: home.clone(),
      moveT: 1,
      moveDuration: 1,
      hops: 1,
      waitTimer: 1 + Math.random() * 3,
      speedScale: 0.75 + Math.random() * 0.5,
      fleeing: false,
    };
  }

  private spawnFlying(species: FlyingSpecies, home: THREE.Vector3): void {
    const assets = sharedAssets();
    const isBird = species === 'bird';
    const root = new THREE.Group();
    const body = new THREE.Mesh(isBird ? pick(assets.birdBodies) : assets.butterflyBody, assets.bodyMat);
    const wingMat = isBird ? pick(assets.birdWingMats) : pick(assets.butterflyWingMats);
    const wingGeo = isBird ? assets.birdWing : assets.butterflyWing;
    const wingL = new THREE.Group();
    const wingR = new THREE.Group();
    wingL.add(new THREE.Mesh(wingGeo, wingMat));
    const right = new THREE.Mesh(wingGeo, wingMat);
    right.scale.x = -1;
    wingR.add(right);
    root.add(body, wingL, wingR);
    if (isBird) root.scale.setScalar(1.5);
    root.position.copy(home);
    this.scene.add(root);
    this.creatures.push({
      kind: 'flying',
      species,
      root,
      wingL,
      wingR,
      home: home.clone(),
      phase: Math.random() * Math.PI * 2,
      radius: isBird ? 4 + Math.random() * 3.5 : 0.5 + Math.random() * 0.5,
      height: isBird ? 3.4 + Math.random() * 1.4 : 0.42 + Math.random() * 0.15,
      speed: isBird ? (0.32 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1) : 0.7 + Math.random() * 0.5,
      flap: isBird ? 0.6 : 1,
      prevX: home.x,
      prevZ: home.z,
    });
  }

  update(dt: number, playerPos: THREE.Vector3, night: boolean): void {
    this.time += dt;
    for (const c of this.creatures) {
      const dx = c.root.position.x - playerPos.x;
      const dz = c.root.position.z - playerPos.z;
      const dist = Math.hypot(dx, dz);
      const sleeping = night && c.kind === 'flying';
      const active = dist < ACTIVE_RADIUS && !sleeping;
      c.root.visible = active;
      if (!active) continue;
      if (c.kind === 'ground') this.updateGround(c, dt, playerPos, dist);
      else this.updateFlying(c, dt);
    }
  }

  private updateGround(c: GroundCreature, dt: number, playerPos: THREE.Vector3, playerDist: number): void {
    c.actor?.update(dt);
    const profile = GROUND_PROFILE[c.species];

    if (!c.fleeing && playerDist < profile.fleeRadius) {
      const away = Math.atan2(c.root.position.x - playerPos.x, c.root.position.z - playerPos.z);
      if (this.startMove(c, away, profile.fleeDist, profile.speed * profile.fleeSpeedMult, [0, 0.5, -0.5, 1, -1])) {
        c.fleeing = true;
        c.actor?.play('Run');
      }
    }

    if (c.moveT < 1) {
      c.moveT = Math.min(1, c.moveT + dt / c.moveDuration);
      c.root.position.lerpVectors(c.from, c.to, c.moveT);
      if (profile.hop > 0) c.root.position.y = Math.abs(Math.sin(c.moveT * c.hops * Math.PI)) * profile.hop;
      else if (c.species === 'deer') c.root.position.y = Math.abs(Math.sin(this.time * 9)) * 0.03;
      if (c.moveT >= 1) {
        c.root.position.y = 0;
        c.fleeing = false;
        c.actor?.play('Survey');
        c.waitTimer = profile.waitMin + Math.random() * profile.waitRange;
      }
      return;
    }

    c.waitTimer -= dt;
    if (c.waitTimer > 0) return;
    // Wander back toward home: aim at a random point around it rather than
    // around wherever the last flight left this creature.
    const tx = c.home.x + (Math.random() * 2 - 1) * profile.wander;
    const tz = c.home.z + (Math.random() * 2 - 1) * profile.wander;
    const angle = Math.atan2(tx - c.root.position.x, tz - c.root.position.z);
    const dist = Math.max(0.4, Math.hypot(tx - c.root.position.x, tz - c.root.position.z));
    if (this.startMove(c, angle, dist, profile.speed, [0, 0.6, -0.6])) {
      c.actor?.play('Walk');
    } else {
      c.waitTimer = 1 + Math.random() * 2;
    }
  }

  /** Points `c` at the first clear spot along `angle` (trying each offset in turn) and starts it moving; false if none of them is standable. */
  private startMove(c: GroundCreature, angle: number, dist: number, speed: number, offsets: number[]): boolean {
    for (const off of offsets) {
      const a = angle + off;
      const tx = c.root.position.x + Math.sin(a) * dist;
      const tz = c.root.position.z + Math.cos(a) * dist;
      if (!this.canStand(tx, tz)) continue;
      c.from.set(c.root.position.x, 0, c.root.position.z);
      c.to.set(tx, 0, tz);
      c.moveT = 0;
      c.moveDuration = dist / (speed * c.speedScale);
      c.hops = Math.max(1, Math.round(dist / 0.35));
      c.root.rotation.y = a;
      return true;
    }
    return false;
  }

  private updateFlying(c: FlyingCreature, dt: number): void {
    const t = this.time * c.speed + c.phase;
    let x: number;
    let y: number;
    let z: number;
    if (c.species === 'bird') {
      x = c.home.x + Math.cos(t) * c.radius;
      z = c.home.z + Math.sin(t) * c.radius;
      y = c.height + Math.sin(this.time * 0.7 + c.phase) * 0.3;
      // Alternate flapping with long glides, easing between them.
      const target = Math.sin(this.time * 0.45 + c.phase) > 0.15 ? 0.7 : 0.08;
      c.flap += (target - c.flap) * Math.min(1, dt * 3);
      const angle = Math.sin(this.time * 10 + c.phase) * c.flap;
      c.wingL.rotation.z = angle;
      c.wingR.rotation.z = -angle;
    } else {
      x = c.home.x + Math.cos(t * 1.3) * c.radius + Math.sin(t * 2.7) * 0.22;
      z = c.home.z + Math.sin(t * 0.9) * c.radius + Math.cos(t * 2.1) * 0.22;
      y = c.height + Math.sin(t * 3.1) * 0.12;
      const angle = 0.15 + Math.abs(Math.sin(this.time * 20 + c.phase)) * 1.1;
      c.wingL.rotation.z = angle;
      c.wingR.rotation.z = -angle;
    }
    const mx = x - c.prevX;
    const mz = z - c.prevZ;
    if (mx * mx + mz * mz > 1e-8) c.root.rotation.y = Math.atan2(mx, mz);
    c.prevX = x;
    c.prevZ = z;
    c.root.position.set(x, y, z);
  }

  /** Frees this zone's own per-mount GPU buffers (the flower instance matrices/colours). The shared geometries/materials outlive the zone on purpose — see sharedAssets. */
  dispose(): void {
    this.disposed = true;
    for (const m of this.flowerMeshes) m.dispose();
    this.flowerMeshes = [];
  }
}
