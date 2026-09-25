import * as THREE from 'three';
import type { StatusEffectType } from '../config/types';

/**
 * A small, reusable combat-VFX library — Three.js particles/simple geometry
 * only (no external textures beyond one generated soft-dot sprite), matching
 * this game's existing low-poly flat-shaded look (emissive `MeshStandard`
 * accents + the scene's own bloom pass, the same trick `playerAvatar.ts`'s
 * gem glow and `characterModel.ts`'s armor-tier accents already use — see
 * their own doc comments).
 *
 * Deliberately NOT one bespoke effect per skill (~40 of those would be a lot
 * of hand-authored one-offs for the value): three things live here instead —
 *
 *  1. `StatusEffectOverlay` — ONE persistent look per status-effect TYPE
 *     (bleed/burn/slow), applied to whichever target currently carries it.
 *  2. A small shared hit/impact burst library, keyed by skill KIND
 *     (physical/magical/heal/buff) — every non-ultimate skill reuses one of
 *     these 4 looks instead of getting its own.
 *  3. `ULTIMATE_BUILDERS` — one bespoke burst per CLASS, played only when
 *     that class's own signature ultimate connects (8 total, a bounded,
 *     deliberately hand-authored set — see the task's own scoping).
 */

// ---------------------------------------------------------------------------
// Shared soft-dot sprite — generated once, reused by every particle system
// below (no external texture asset to ship/license).
// ---------------------------------------------------------------------------
let sharedDot: THREE.Texture | null = null;
function dotTexture(): THREE.Texture {
  if (sharedDot) return sharedDot;
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  sharedDot = new THREE.CanvasTexture(canvas);
  return sharedDot;
}

const STATUS_COLOR: Record<StatusEffectType, number> = {
  bleed: 0xc41730,
  burn: 0xff8a2e,
  slow: 0x5fd0ff,
};

const HIT_COLOR: Record<'physical' | 'magical' | 'heal' | 'buff', number> = {
  physical: 0xf2f2f2,
  magical: 0x9b7bff,
  heal: 0x6bff8e,
  buff: 0xf2c14e,
};

// ---------------------------------------------------------------------------
// 1. Persistent per-target status overlay — one distinct look per TYPE.
// ---------------------------------------------------------------------------
interface StatusVisual {
  points: THREE.Points;
  material: THREE.PointsMaterial;
  basePositions: Float32Array;
  phase: number;
}

/**
 * Parented to a target's own model (or a floating anchor for the player —
 * see `OverworldCombat`), this shows/hides/animates one little particle
 * system per active status type, driven every frame by `sync`+`update`:
 *  - `bleed`: dripping red particles that fall from the target's midsection.
 *  - `burn`: flickering orange embers rising off the target.
 *  - `slow`: a slow blue-white frost mist swirling around the target.
 */
export class StatusEffectOverlay {
  private group = new THREE.Group();
  private visuals = new Map<StatusEffectType, StatusVisual>();

  constructor(host: THREE.Object3D, private radius = 0.32, private height = 0.95) {
    this.group.name = 'statusEffectOverlay';
    host.add(this.group);
  }

  /** Adds/removes visuals so the overlay's active set exactly matches `activeTypes` — call once per combat tick with the target's current status types. */
  sync(activeTypes: StatusEffectType[]): void {
    for (const type of activeTypes) {
      if (!this.visuals.has(type)) this.spawn(type);
    }
    for (const type of [...this.visuals.keys()]) {
      if (!activeTypes.includes(type)) this.remove(type);
    }
  }

  private spawn(type: StatusEffectType): void {
    const count = 9;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const r = this.radius * (0.55 + Math.random() * 0.5);
      positions[i * 3] = Math.cos(a) * r;
      positions[i * 3 + 1] = Math.random() * this.height;
      positions[i * 3 + 2] = Math.sin(a) * r;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: STATUS_COLOR[type],
      size: type === 'burn' ? 0.1 : 0.075,
      map: dotTexture(),
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.name = `status-${type}`;
    points.frustumCulled = false;
    this.group.add(points);
    this.visuals.set(type, { points, material, basePositions: positions.slice(), phase: Math.random() * Math.PI * 2 });
  }

  private remove(type: StatusEffectType): void {
    const visual = this.visuals.get(type);
    if (!visual) return;
    this.group.remove(visual.points);
    visual.points.geometry.dispose();
    visual.material.dispose();
    this.visuals.delete(type);
  }

  /** `clock` (seconds, monotonically increasing) drives burn's flicker independent of any one instance's own phase. */
  update(dt: number, clock: number): void {
    for (const [type, visual] of this.visuals) {
      visual.phase += dt;
      const attr = visual.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = visual.basePositions;
      const count = base.length / 3;
      for (let i = 0; i < count; i++) {
        const bx = base[i * 3];
        const bz = base[i * 3 + 2];
        if (type === 'bleed') {
          // A slow downward drip, each particle wrapping back to the top once it reaches the bottom.
          const fall = ((visual.phase * 0.4 + i * 0.17) % 1) * this.height;
          attr.setXYZ(i, bx, this.height - fall, bz);
        } else if (type === 'burn') {
          // Flickering embers rising off the target.
          const rise = ((visual.phase * 0.95 + i * 0.21) % 1) * this.height;
          const flicker = Math.sin(visual.phase * 11 + i * 2) * 0.02;
          attr.setXYZ(i, bx + flicker, rise, bz + flicker);
        } else {
          // A slow swirling frost mist around the target's midsection.
          const angle = visual.phase * 0.5 + i * 0.7;
          const r = Math.hypot(bx, bz) || 0.1;
          const by = base[i * 3 + 1] + Math.sin(visual.phase * 0.8 + i) * 0.04;
          attr.setXYZ(i, Math.cos(angle) * r, by, Math.sin(angle) * r);
        }
      }
      attr.needsUpdate = true;
      visual.material.opacity = type === 'burn' ? 0.65 + Math.sin(clock * 9 + visual.phase) * 0.2 : 0.85;
    }
  }

  dispose(): void {
    for (const type of [...this.visuals.keys()]) this.remove(type);
    this.group.parent?.remove(this.group);
  }
}

// ---------------------------------------------------------------------------
// One-shot effect primitives — building blocks for both the shared
// hit/impact library and the 8 bespoke ultimate bursts below.
// ---------------------------------------------------------------------------
export interface OneShotEffect {
  group: THREE.Group;
  /** Advances by `dt`; returns true once the effect is fully finished (caller then removes/disposes it). */
  update(dt: number): boolean;
  dispose(): void;
}

/** A radial particle burst — the workhorse primitive behind almost every effect here. */
function makeBurst(opts: { color: number; count: number; speed: number; size: number; life: number; upBias?: number; gravity?: number }): OneShotEffect {
  const { color, count, speed, size, life, upBias = 0.3, gravity = 1.6 } = opts;
  const velocities: THREE.Vector3[] = [];
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const dir = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() + upBias, (Math.random() - 0.5) * 2).normalize();
    velocities.push(dir.multiplyScalar(speed * (0.6 + Math.random() * 0.7)));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color,
    size,
    map: dotTexture(),
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  let t = 0;
  return {
    group,
    update(dt: number): boolean {
      t += dt;
      const attr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < count; i++) {
        const v = velocities[i];
        attr.setXYZ(i, v.x * t, v.y * t - 0.5 * gravity * t * t, v.z * t);
      }
      attr.needsUpdate = true;
      material.opacity = Math.max(0, 1 - t / life);
      return t >= life;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** An expanding, fading flat ring — a shockwave. */
function makeRing(opts: { color: number; maxRadius: number; life: number; thickness?: number }): OneShotEffect {
  const { color, maxRadius, life, thickness = 0.1 } = opts;
  const geometry = new THREE.RingGeometry(1, 1 + thickness, 28);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.scale.setScalar(0.01);
  const group = new THREE.Group();
  group.add(mesh);
  let t = 0;
  return {
    group,
    update(dt: number): boolean {
      t += dt;
      const k = Math.min(1, t / life);
      mesh.scale.setScalar(0.05 + k * maxRadius);
      material.opacity = 0.9 * (1 - k);
      return t >= life;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** A glowing shape that falls from above onto the target, then flashes/expands briefly on impact — the meteor/beam-from-the-sky primitive. */
function makeFallingImpact(opts: { color: number; life: number; fromHeight?: number; size?: number }): OneShotEffect {
  const { color, life, fromHeight = 2.6, size = 0.14 } = opts;
  const geometry = new THREE.SphereGeometry(size, 8, 6);
  const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, roughness: 0.3, transparent: true, opacity: 1 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = fromHeight;
  const group = new THREE.Group();
  group.add(mesh);
  let t = 0;
  const fallDuration = life * 0.55;
  return {
    group,
    update(dt: number): boolean {
      t += dt;
      if (t <= fallDuration) {
        const k = t / fallDuration;
        mesh.position.y = fromHeight * (1 - k * k);
      } else {
        mesh.position.y = 0;
        const k = (t - fallDuration) / (life - fallDuration);
        mesh.scale.setScalar(1 + k * 2.2);
        material.opacity = Math.max(0, 1 - k);
      }
      return t >= life;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** A thin streak that snaps open then fades — a slash/beam. */
function makeSlash(opts: { color: number; life: number; length?: number }): OneShotEffect {
  const { color, life, length = 1.1 } = opts;
  const geometry = new THREE.PlaneGeometry(length, 0.09);
  const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.9;
  mesh.rotation.z = Math.PI / 4;
  mesh.scale.set(0.05, 1, 1);
  const group = new THREE.Group();
  group.add(mesh);
  let t = 0;
  const openDuration = life * 0.3;
  return {
    group,
    update(dt: number): boolean {
      t += dt;
      const k = Math.min(1, t / openDuration);
      mesh.scale.x = 0.05 + k * 0.95;
      material.opacity = Math.max(0, 0.95 * (1 - t / life));
      return t >= life;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** A spike/wisp that rises up out of the ground, holds briefly, then fades. */
function makeRisingSpike(opts: { color: number; life: number; height?: number; radial?: number }): OneShotEffect {
  const { color, life, height = 0.9, radial = 0 } = opts;
  const geometry = new THREE.ConeGeometry(0.11, height, 6);
  const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, transparent: true, opacity: 0.9, roughness: 0.4 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(Math.cos(radial) * 0.2, -height / 2, Math.sin(radial) * 0.2);
  const group = new THREE.Group();
  group.add(mesh);
  let t = 0;
  const riseDuration = life * 0.45;
  return {
    group,
    update(dt: number): boolean {
      t += dt;
      const riseK = Math.min(1, t / riseDuration);
      mesh.position.y = -height / 2 + riseK * height * 0.65;
      const fadeK = Math.max(0, (t - riseDuration) / (life - riseDuration));
      material.opacity = 0.9 * (1 - fadeK);
      return t >= life;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Runs several effects together as one, finishing only once every child has. */
function combineEffects(effects: OneShotEffect[]): OneShotEffect {
  const group = new THREE.Group();
  const done = effects.map(() => false);
  for (const e of effects) group.add(e.group);
  return {
    group,
    update(dt: number): boolean {
      let allDone = true;
      effects.forEach((e, i) => {
        if (done[i]) return;
        if (e.update(dt)) done[i] = true;
        else allDone = false;
      });
      return allDone;
    },
    dispose() {
      for (const e of effects) e.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// 3. One bespoke burst per class — played only on that class's own ultimate.
// ---------------------------------------------------------------------------
const ULTIMATE_BUILDERS: Record<string, () => OneShotEffect> = {
  // Golpe do Titã — a grounded shockwave plus flying debris, all its force in one hit.
  warrior: () =>
    combineEffects([
      makeRing({ color: 0xff5a3a, maxRadius: 1.15, life: 0.5, thickness: 0.12 }),
      makeBurst({ color: 0x9a9a9a, count: 14, speed: 2.4, size: 0.09, life: 0.55 }),
    ]),
  // Meteoro Arcano — a fiery meteor drops onto the target, then bursts into arcane embers.
  mage: () =>
    combineEffects([
      makeFallingImpact({ color: 0xff7a2e, life: 0.65 }),
      makeBurst({ color: 0xb388ff, count: 16, speed: 2.2, size: 0.08, life: 0.6, upBias: 0.6 }),
    ]),
  // Tempestade de Flechas — a tight volley of green-tinted shafts raining down, then scattering.
  archer: () =>
    combineEffects([
      makeFallingImpact({ color: 0x6fdf8a, life: 0.5, size: 0.07, fromHeight: 2.2 }),
      makeBurst({ color: 0x3fae5b, count: 10, speed: 2.0, size: 0.06, life: 0.45 }),
    ]),
  // Renascimento Divino — a rising column of golden sparkles.
  cleric: () =>
    combineEffects([
      makeRing({ color: 0xf2ede1, maxRadius: 0.8, life: 0.6, thickness: 0.08 }),
      makeBurst({ color: 0xf2c14e, count: 16, speed: 1.6, size: 0.08, life: 0.85, upBias: 2.2, gravity: 0.4 }),
    ]),
  // Julgamento Celestial — holy fire dropping from the sky, a bright radial burst on landing.
  paladin: () =>
    combineEffects([
      makeFallingImpact({ color: 0xfff3c4, life: 0.6, fromHeight: 3.0 }),
      makeBurst({ color: 0xffb347, count: 15, speed: 2.3, size: 0.08, life: 0.55 }),
    ]),
  // Execução Sombria — one decisive slash, then the wound bursts with shadow.
  assassin: () =>
    combineEffects([
      makeSlash({ color: 0xd9c7ff, life: 0.35 }),
      makeBurst({ color: 0x2a2a35, count: 10, speed: 1.8, size: 0.07, life: 0.45 }),
    ]),
  // Exército dos Mortos — ghostly spikes rise out of the ground around the target.
  necromancer: () =>
    combineEffects([
      makeRisingSpike({ color: 0x6bff8e, life: 0.7, radial: 0 }),
      makeRisingSpike({ color: 0x8a2be2, life: 0.75, height: 0.7, radial: 2.1 }),
      makeRisingSpike({ color: 0x6bff8e, life: 0.65, height: 0.7, radial: 4.2 }),
    ]),
  // Fúria do Dragão Interior — a wide martial shockwave with radiating chi.
  monk: () =>
    combineEffects([
      makeRing({ color: 0xd97a2e, maxRadius: 1.25, life: 0.55, thickness: 0.14 }),
      makeBurst({ color: 0xffcf7a, count: 12, speed: 2.6, size: 0.08, life: 0.5, upBias: 0.5 }),
    ]),
};

// ---------------------------------------------------------------------------
// Manager — owns every active one-shot effect and every target's persistent
// status overlay in one scene; called once per frame by `OverworldCombat`.
// ---------------------------------------------------------------------------
export class VfxManager {
  private oneShots: OneShotEffect[] = [];
  private overlays = new Map<THREE.Object3D, StatusEffectOverlay>();

  constructor(private scene: THREE.Scene) {}

  private spawnAt(effect: OneShotEffect, position: THREE.Vector3): void {
    effect.group.position.copy(position);
    this.scene.add(effect.group);
    this.oneShots.push(effect);
  }

  /** The shared hit/impact library — one look per skill KIND, reused by every skill that isn't a class's own ultimate. `statusType` (if the hit also inflicted an affliction) tints the burst with that status's own color instead, so the moment an affliction lands still reads distinctly even off the shared library. */
  spawnHitImpact(position: THREE.Vector3, kind: 'physical' | 'magical' | 'heal' | 'buff', statusType?: StatusEffectType): void {
    const color = statusType ? STATUS_COLOR[statusType] : HIT_COLOR[kind];
    const effect =
      kind === 'heal' || kind === 'buff'
        ? makeBurst({ color, count: 10, speed: 1.3, size: 0.08, life: 0.5, upBias: 1.6, gravity: 0.5 })
        : makeBurst({ color, count: kind === 'magical' ? 13 : 9, speed: 1.9, size: 0.07, life: 0.4 });
    this.spawnAt(effect, position.clone().add(new THREE.Vector3(0, 0.75, 0)));
  }

  /** One bespoke burst per class, played once per target when that class's own ultimate connects. No-op for a class id this library doesn't recognize (never expected, but safe). */
  spawnUltimateVfx(classId: string, positions: THREE.Vector3[]): void {
    const builder = ULTIMATE_BUILDERS[classId];
    if (!builder) return;
    for (const position of positions) {
      this.spawnAt(builder(), position.clone().add(new THREE.Vector3(0, 0.05, 0)));
    }
  }

  /** Keeps `host`'s persistent status overlay in sync with its currently-active effect types — cheap no-op while `activeTypes` is empty and no overlay exists yet. */
  syncStatusOverlay(host: THREE.Object3D, activeTypes: StatusEffectType[], opts?: { radius?: number; height?: number }): void {
    let overlay = this.overlays.get(host);
    if (!overlay) {
      if (activeTypes.length === 0) return;
      overlay = new StatusEffectOverlay(host, opts?.radius, opts?.height);
      this.overlays.set(host, overlay);
    }
    overlay.sync(activeTypes);
  }

  /** Advances every active one-shot effect and status overlay by `dt`; `clock` feeds burn's flicker. Call once per frame regardless of whether combat is ongoing (so a burst outlives the fight it was spawned in). */
  update(dt: number, clock: number): void {
    for (let i = this.oneShots.length - 1; i >= 0; i--) {
      const effect = this.oneShots[i];
      if (effect.update(dt)) {
        this.scene.remove(effect.group);
        effect.dispose();
        this.oneShots.splice(i, 1);
      }
    }
    for (const overlay of this.overlays.values()) overlay.update(dt, clock);
  }
}
