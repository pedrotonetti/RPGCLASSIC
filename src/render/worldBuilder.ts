import * as THREE from 'three';
import { TILE_SIZE } from '../config/gameConfig';
import { TileType } from '../config/tiles';
import type { BuildingPlacement } from '../systems/MapGenerator';
import { buildCityPropMeshes, CITY_PROP_KINDS, PROP_COLLIDER_INSET } from './cityProps';

export interface TreeCollider {
  x: number;
  z: number;
  /** Ground-plane radius covering the tree's full canopy footprint (its three offset lobes), for simple circle-vs-path camera occlusion checks. */
  radius: number;
}

/** Axis-aligned world-space footprint a building occupies — checked by both OverworldScreen.canOccupy (player movement) and its camera avoidance, the same two things TreeCollider feeds. */
export interface BuildingCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** False for small street props (lamps, banners, a fountain...) that block walking but sit well below the follow-camera — its avoidance skips them. Absent (true) for every real building. */
  blocksCamera?: boolean;
}

export interface WorldMeshes {
  group: THREE.Group;
  widthWorld: number;
  depthWorld: number;
  /** Shared material driving all water tiles — pass it to `animateWaterMaterial` each frame for its ripple/foam motion. */
  waterMaterial: THREE.MeshStandardMaterial | null;
  /** Ground-plane circles the camera should steer clear of instead of clipping through — see OverworldScreen.desiredCameraPosition. */
  treeColliders: TreeCollider[];
  /** Building footprints the player can't walk through and the camera shouldn't clip into — see OverworldScreen.canOccupy/desiredCameraPosition. */
  buildingColliders: BuildingCollider[];
}

export function tileCenterWorld(tx: number, ty: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(tx * TILE_SIZE + TILE_SIZE / 2, 0, ty * TILE_SIZE + TILE_SIZE / 2);
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** A small tileable canvas noise texture — cheap per-pixel color jitter so flat ground/paths read as organic material instead of a single flat color. */
export function makeGrainTexture(baseColor: number, variance: number, size = 48): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const [r, g, b] = hexToRgb(baseColor);
  const imageData = ctx.createImageData(size, size);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 2 * variance;
    imageData.data[i] = clampByte(r + n);
    imageData.data[i + 1] = clampByte(g + n * 0.85);
    imageData.data[i + 2] = clampByte(b + n * 0.65);
    imageData.data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Ground-cover texture with real macro variation: soft large blotches (clumps
 * of slightly lighter/darker turf, like uneven real grass) with fine
 * per-pixel grain layered on top. A single grain-only pass (`makeGrainTexture`)
 * reads as flat and washed out once it repeats densely across a huge plane
 * and gets blurred by minification at a grazing camera angle — the blotches
 * survive that blur because they're much larger than one texel.
 */
export function makeGrassTexture(baseColor: number, size = 128): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const [r, g, b] = hexToRgb(baseColor);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, size, size);

  const patchCount = 18;
  for (let i = 0; i < patchCount; i++) {
    const px = pseudoRandom(i * 7.13) * size;
    const py = pseudoRandom(i * 3.71 + 50) * size;
    const radius = size * (0.12 + pseudoRandom(i * 5.31) * 0.18);
    const shade = (pseudoRandom(i * 9.17) - 0.5) * 34;
    const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
    grad.addColorStop(
      0,
      `rgba(${clampByte(r + shade)}, ${clampByte(g + shade * 0.85)}, ${clampByte(b + shade * 0.6)}, 0.55)`,
    );
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const imageData = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < imageData.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 2 * 22;
    imageData.data[i] = clampByte(imageData.data[i] + n);
    imageData.data[i + 1] = clampByte(imageData.data[i + 1] + n * 0.85);
    imageData.data[i + 2] = clampByte(imageData.data[i + 2] + n * 0.6);
  }
  ctx.putImageData(imageData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Grazing camera angles are the norm for this game's follow-cam — without
  // anisotropic filtering the GPU's default mip selection blurs the texture
  // into a flat wash exactly at those angles. WebGLRenderer clamps this to
  // whatever the GPU actually supports, so it's safe to just ask for a lot.
  texture.anisotropy = 8;
  return texture;
}

/** Blends `accent` into `base` at weight `t` (0 = pure base, 1 = pure accent) — the shared helper behind every zone-tinted material below. */
function blendColor(base: number, accent: number, t: number): number {
  const b = hexToRgb(base);
  const a = hexToRgb(accent);
  const r = clampByte(b[0] + (a[0] - b[0]) * t);
  const g = clampByte(b[1] + (a[1] - b[1]) * t);
  const bl = clampByte(b[2] + (a[2] - b[2]) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Blends `accent` into the base grass green at low weight — enough that each zone's territory reads as visually distinct without stopping looking like grass. */
function tintedGrassColor(accentColor: number): number {
  return blendColor(0x4c8a3f, accentColor, 0.22);
}

/**
 * Builds every procedural structure for this zone: 2-4 low-poly house
 * archetypes (a box body plus a pyramid/cone roof, following the exact same
 * flat-shaded primitive style as the trees below), each instanced per
 * kind+part exactly like the tree canopy lobes are — a city can easily have
 * 30+ buildings, so this stays as cheap as the tree instancing already is.
 *
 * Also derives the world-space AABB each building occupies. Buildings stay
 * TileType.Grass/Path underneath (MapGenerator stamps their footprint to
 * Path so spawns/trees steer clear of it) rather than getting their own
 * non-walkable tile type, so this collider list is what actually stops the
 * player walking through a wall and keeps the camera from clipping into
 * one — see OverworldScreen.canOccupy and desiredCameraPosition, which
 * consume it the same way they already do TreeCollider.
 */
function buildBuildingMeshes(buildings: BuildingPlacement[], accentColor: number): { group: THREE.Group; colliders: BuildingCollider[] } {
  const group = new THREE.Group();
  const colliders: BuildingCollider[] = [];
  for (const b of buildings) {
    const inset = PROP_COLLIDER_INSET[b.kind];
    const collider: BuildingCollider = {
      minX: b.x * TILE_SIZE + (inset ?? 0),
      maxX: (b.x + b.w) * TILE_SIZE - (inset ?? 0),
      minZ: b.y * TILE_SIZE + (inset ?? 0),
      maxZ: (b.y + b.h) * TILE_SIZE - (inset ?? 0),
    };
    if (inset !== undefined) collider.blocksCamera = false;
    colliders.push(collider);
  }

  // Storefronts and street props (the hand-placed city layer) have their
  // own builder; everything else is one of the four procedural archetypes.
  group.add(buildCityPropMeshes(buildings.filter((b) => CITY_PROP_KINDS.has(b.kind)), accentColor));

  const byKind: Record<'hut' | 'house' | 'stall' | 'tower', BuildingPlacement[]> = { hut: [], house: [], stall: [], tower: [] };
  for (const b of buildings) {
    if (b.kind === 'hut' || b.kind === 'house' || b.kind === 'stall' || b.kind === 'tower') byKind[b.kind].push(b);
  }

  const m = new THREE.Matrix4();
  const roof4Rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
  const unitScale = new THREE.Vector3(1, 1, 1);
  const worldCenter = (b: BuildingPlacement): { x: number; z: number } => ({
    x: (b.x + b.w / 2) * TILE_SIZE,
    z: (b.y + b.h / 2) * TILE_SIZE,
  });

  const wallMat = new THREE.MeshStandardMaterial({ color: blendColor(0xd8c9a3, accentColor, 0.16), roughness: 0.9 });
  const roofMat = new THREE.MeshStandardMaterial({ color: blendColor(0x8a5236, accentColor, 0.4), roughness: 0.8, flatShading: true });

  // --- hut: a small single-room home, 2x2 tile footprint ----------------
  if (byKind.hut.length > 0) {
    const bodyGeo = new THREE.BoxGeometry(3.0, 1.5, 3.0);
    const roofGeo = new THREE.ConeGeometry(2.83, 1.3, 4); // 4 radial segments + the 45° rotation below = a square pyramid roof
    const bodyInst = new THREE.InstancedMesh(bodyGeo, wallMat, byKind.hut.length);
    const roofInst = new THREE.InstancedMesh(roofGeo, roofMat, byKind.hut.length);
    bodyInst.castShadow = true;
    bodyInst.receiveShadow = true;
    roofInst.castShadow = true;
    byKind.hut.forEach((b, i) => {
      const { x, z } = worldCenter(b);
      m.makeTranslation(x, 0.75, z);
      bodyInst.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 1.5 + 0.65, z), roof4Rot, unitScale);
      roofInst.setMatrixAt(i, m);
    });
    group.add(bodyInst, roofInst);
  }

  // --- house: a bigger home with a chimney, 3x3 tile footprint ----------
  if (byKind.house.length > 0) {
    const bodyGeo = new THREE.BoxGeometry(4.6, 2.0, 4.6);
    const roofGeo = new THREE.ConeGeometry(4.24, 1.8, 4);
    const chimneyGeo = new THREE.BoxGeometry(0.35, 0.9, 0.35);
    const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x746a5e, roughness: 0.9 });
    const bodyInst = new THREE.InstancedMesh(bodyGeo, wallMat, byKind.house.length);
    const roofInst = new THREE.InstancedMesh(roofGeo, roofMat, byKind.house.length);
    const chimneyInst = new THREE.InstancedMesh(chimneyGeo, chimneyMat, byKind.house.length);
    bodyInst.castShadow = true;
    bodyInst.receiveShadow = true;
    roofInst.castShadow = true;
    chimneyInst.castShadow = true;
    byKind.house.forEach((b, i) => {
      const { x, z } = worldCenter(b);
      m.makeTranslation(x, 1.0, z);
      bodyInst.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, 2.0 + 0.9, z), roof4Rot, unitScale);
      roofInst.setMatrixAt(i, m);
      // Offset toward one corner (never enough to clear the footprint), so
      // it reads as a chimney rather than a mast sticking out of the ridge.
      m.makeTranslation(x + 1.5, 2.0 + 0.45, z + 1.5);
      chimneyInst.setMatrixAt(i, m);
    });
    group.add(bodyInst, roofInst, chimneyInst);
  }

  // --- stall: an open-air market stand, 1x1 tile footprint --------------
  if (byKind.stall.length > 0) {
    const bodyGeo = new THREE.BoxGeometry(1.5, 0.8, 1.5);
    const awningGeo = new THREE.BoxGeometry(1.8, 0.12, 1.5);
    const stallBodyMat = new THREE.MeshStandardMaterial({ color: blendColor(0x8a6a45, accentColor, 0.15), roughness: 0.9 });
    // White base color so each instance's own color (below) shows through unmodified.
    const stallAwningMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, flatShading: true });
    const bodyInst = new THREE.InstancedMesh(bodyGeo, stallBodyMat, byKind.stall.length);
    const awningInst = new THREE.InstancedMesh(awningGeo, stallAwningMat, byKind.stall.length);
    bodyInst.castShadow = true;
    bodyInst.receiveShadow = true;
    awningInst.castShadow = true;
    // A market reads as a market when its stalls aren't all one color: each
    // awning takes a color from a small market palette (keyed off its own
    // tile, so it's stable across reloads), still tinted toward the zone's
    // accent as before so a village's stalls keep its identity.
    const STALL_AWNING_PALETTE = [0xffffff, 0xd8453a, 0xe0b23a, 0x3a7ad8, 0x3fae5b, 0x9a5ab8];
    const awningColor = new THREE.Color();
    byKind.stall.forEach((b, i) => {
      const { x, z } = worldCenter(b);
      m.makeTranslation(x, 0.4, z);
      bodyInst.setMatrixAt(i, m);
      m.makeTranslation(x, 0.86, z);
      awningInst.setMatrixAt(i, m);
      const paletteColor = STALL_AWNING_PALETTE[Math.abs(b.x * 7 + b.y * 13) % STALL_AWNING_PALETTE.length];
      awningInst.setColorAt(i, awningColor.setHex(blendColor(paletteColor, accentColor, 0.25)));
    });
    group.add(bodyInst, awningInst);
  }

  // --- tower: a round landmark structure, 2x2 tile footprint ------------
  // Deliberately a different silhouette (round + tall, not boxy) from the
  // huts/houses above — this is the one every secondary village gets as its
  // single landmark (e.g. the mage village's "Torre dos Arcanos"), and the
  // main city gets a few scattered along its streets too.
  if (byKind.tower.length > 0) {
    const bodyGeo = new THREE.CylinderGeometry(1.15, 1.35, 3.6, 10);
    const roofGeo = new THREE.ConeGeometry(1.7, 2.2, 10);
    const towerWallMat = new THREE.MeshStandardMaterial({ color: blendColor(0xb9b3a6, accentColor, 0.22), roughness: 0.85 });
    const towerRoofMat = new THREE.MeshStandardMaterial({ color: blendColor(0x5a3320, accentColor, 0.55), roughness: 0.75, flatShading: true });
    const bodyInst = new THREE.InstancedMesh(bodyGeo, towerWallMat, byKind.tower.length);
    const roofInst = new THREE.InstancedMesh(roofGeo, towerRoofMat, byKind.tower.length);
    bodyInst.castShadow = true;
    bodyInst.receiveShadow = true;
    roofInst.castShadow = true;
    byKind.tower.forEach((b, i) => {
      const { x, z } = worldCenter(b);
      m.makeTranslation(x, 1.8, z);
      bodyInst.setMatrixAt(i, m);
      m.makeTranslation(x, 3.6 + 1.1, z);
      roofInst.setMatrixAt(i, m);
    });
    group.add(bodyInst, roofInst);
  }

  return { group, colliders };
}

/**
 * Shared water surface material. Before this, water was a flat navy
 * MeshStandardMaterial whose only motion was a uniform whole-pond opacity
 * pulse, and players read it as blue floor tiles they mysteriously couldn't
 * walk on. A small `onBeforeCompile` patch (no extra textures, render
 * targets or passes — a few ALU ops on water fragments only) adds the cues
 * that say "water" at a glance:
 *  - lighter, shallower colour toward the bank and a thin, gently breathing
 *    foam line where the water meets land (from the per-instance
 *    `shoreEdges`/`shoreCorners` flags `buildOverworldMeshes` fills in);
 *  - three crossing ripple waves in world space that drift over time,
 *    darkening troughs and adding small emissive glint streaks on the crests.
 * Driven by `animateWaterMaterial`.
 */
function makeWaterMaterial(): THREE.MeshStandardMaterial {
  const uTime = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a78ad,
    roughness: 0.25,
    metalness: 0.05,
    emissive: 0x0e3552,
    emissiveIntensity: 0.35,
  });
  mat.userData.uTime = uTime;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.uniforms.uShallow = { value: new THREE.Color(0x5cc0d8) };
    shader.uniforms.uFoam = { value: new THREE.Color(0xeaf8f6) };
    shader.uniforms.uGlint = { value: new THREE.Color(0x9fd8ef) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 shoreEdges;
        attribute vec4 shoreCorners;
        varying vec4 vShoreEdges;
        varying vec4 vShoreCorners;
        varying vec2 vWaterXZ;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vShoreEdges = shoreEdges;
        vShoreCorners = shoreCorners;
        vec4 waterWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          waterWorld = instanceMatrix * waterWorld;
        #endif
        vWaterXZ = (modelMatrix * waterWorld).xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        uniform vec3 uShallow;
        uniform vec3 uFoam;
        uniform vec3 uGlint;
        varying vec4 vShoreEdges;
        varying vec4 vShoreCorners;
        varying vec2 vWaterXZ;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Distance (in tiles, capped at 1) to the nearest land among the 8
        // neighbours: edges (W,E,N,S) and corner points (NW,NE,SW,SE).
        vec2 wp = fract(vWaterXZ / ${TILE_SIZE.toFixed(1)});
        float shoreDist = 1.0;
        shoreDist = min(shoreDist, mix(1.0, wp.x, vShoreEdges.x));
        shoreDist = min(shoreDist, mix(1.0, 1.0 - wp.x, vShoreEdges.y));
        shoreDist = min(shoreDist, mix(1.0, wp.y, vShoreEdges.z));
        shoreDist = min(shoreDist, mix(1.0, 1.0 - wp.y, vShoreEdges.w));
        shoreDist = min(shoreDist, mix(1.0, length(wp), vShoreCorners.x));
        shoreDist = min(shoreDist, mix(1.0, length(wp - vec2(1.0, 0.0)), vShoreCorners.y));
        shoreDist = min(shoreDist, mix(1.0, length(wp - vec2(0.0, 1.0)), vShoreCorners.z));
        shoreDist = min(shoreDist, mix(1.0, length(wp - vec2(1.0)), vShoreCorners.w));
        // Three non-aligned travelling waves. Glints sit on the crest band of
        // the main wave, broken into drifting streaks by the other two, so
        // they read as light catching ripple crests rather than a dot grid.
        float waveA = sin(dot(vWaterXZ, vec2(0.8, 0.55)) * 2.2 + uTime * 1.3);
        float waveB = sin(dot(vWaterXZ, vec2(-0.45, 0.9)) * 3.1 - uTime * 1.05);
        float waveC = sin(dot(vWaterXZ, vec2(0.95, -0.3)) * 4.3 + uTime * 1.7);
        float glint = smoothstep(0.82, 1.0, waveA) * smoothstep(0.0, 0.9, 0.6 * waveB + 0.4 * waveC);
        diffuseColor.rgb = mix(uShallow, diffuseColor.rgb, smoothstep(0.0, 0.7, shoreDist));
        diffuseColor.rgb *= 0.92 + 0.08 * (0.5 * waveA + 0.3 * waveB + 0.2 * waveC);
        float foamWidth = 0.13 + 0.035 * sin(uTime * 1.6 + vWaterXZ.x * 1.3 + vWaterXZ.y * 0.9);
        float foam = 1.0 - smoothstep(foamWidth * 0.45, foamWidth, shoreDist);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, foam * 0.9);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uGlint * 0.35 * glint * (1.0 - foam);
        totalEmissiveRadiance += uFoam * 0.2 * foam;`,
      );
  };
  mat.customProgramCacheKey = () => 'overworld-water';
  return mat;
}

/** Advances the water surface's ripple/foam animation — see `makeWaterMaterial`. */
export function animateWaterMaterial(mat: THREE.MeshStandardMaterial, time: number): void {
  const uTime = mat.userData.uTime as { value: number } | undefined;
  if (uTime) uTime.value = time;
}

export function buildOverworldMeshes(tiles: TileType[][], accentColor = 0x4c8a3f, buildings: BuildingPlacement[] = []): WorldMeshes {
  const mapHeight = tiles.length;
  const mapWidth = tiles[0].length;
  const widthWorld = mapWidth * TILE_SIZE;
  const depthWorld = mapHeight * TILE_SIZE;

  const group = new THREE.Group();

  const grassTex = makeGrassTexture(tintedGrassColor(accentColor));
  grassTex.repeat.set(mapWidth * 1.2, mapHeight * 1.2);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(widthWorld, depthWorld),
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: grassTex, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(widthWorld / 2, 0, depthWorld / 2);
  ground.receiveShadow = true;
  group.add(ground);

  const pathPositions: THREE.Vector3[] = [];
  const waterPositions: THREE.Vector3[] = [];
  const treePositions: THREE.Vector3[] = [];
  const treeColliders: TreeCollider[] = [];

  for (let y = 0; y < mapHeight; y++) {
    for (let x = 0; x < mapWidth; x++) {
      const t = tiles[y][x];
      if (t === TileType.Path) pathPositions.push(tileCenterWorld(x, y));
      else if (t === TileType.Water) waterPositions.push(tileCenterWorld(x, y));
      else if (t === TileType.Tree) treePositions.push(tileCenterWorld(x, y));
    }
  }

  const m = new THREE.Matrix4();

  if (pathPositions.length > 0) {
    const geo = new THREE.BoxGeometry(TILE_SIZE * 0.98, 0.06, TILE_SIZE * 0.98);
    const pathTex = makeGrainTexture(0xc2a267, 20);
    pathTex.repeat.set(3, 3);
    const matPath = new THREE.MeshStandardMaterial({ color: 0xffffff, map: pathTex, roughness: 0.92 });
    const inst = new THREE.InstancedMesh(geo, matPath, pathPositions.length);
    inst.receiveShadow = true;
    pathPositions.forEach((p, i) => {
      m.makeTranslation(p.x, 0.03, p.z);
      inst.setMatrixAt(i, m);
    });
    group.add(inst);
  }

  let waterMaterial: THREE.MeshStandardMaterial | null = null;
  if (waterPositions.length > 0) {
    // Full-tile flat quads (no 0.98 inset) so a pond reads as one continuous
    // surface — the old per-tile boxes left a grass seam around every tile,
    // which is exactly what made water look like a grid of blue paving slabs.
    const geo = new THREE.PlaneGeometry(TILE_SIZE, TILE_SIZE);
    geo.rotateX(-Math.PI / 2);
    waterMaterial = makeWaterMaterial();
    const inst = new THREE.InstancedMesh(geo, waterMaterial, waterPositions.length);
    inst.receiveShadow = true;
    // Per-instance flags for which of the tile's 8 neighbours are land —
    // edges (W,E,N,S) and diagonal corners (NW,NE,SW,SE) — so the shader's
    // shallow tint/foam line follows the real shoreline (see makeWaterMaterial).
    const land = (x: number, y: number) => (tiles[y]?.[x] === TileType.Water ? 0 : 1);
    const edges = new Float32Array(waterPositions.length * 4);
    const corners = new Float32Array(waterPositions.length * 4);
    waterPositions.forEach((p, i) => {
      m.makeTranslation(p.x, 0.05, p.z);
      inst.setMatrixAt(i, m);
      const tx = Math.floor(p.x / TILE_SIZE);
      const ty = Math.floor(p.z / TILE_SIZE);
      edges.set([land(tx - 1, ty), land(tx + 1, ty), land(tx, ty - 1), land(tx, ty + 1)], i * 4);
      corners.set([land(tx - 1, ty - 1), land(tx + 1, ty - 1), land(tx - 1, ty + 1), land(tx + 1, ty + 1)], i * 4);
    });
    geo.setAttribute('shoreEdges', new THREE.InstancedBufferAttribute(edges, 4));
    geo.setAttribute('shoreCorners', new THREE.InstancedBufferAttribute(corners, 4));
    group.add(inst);
  }

  if (treePositions.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.17, 0.7, 8);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 });
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);
    trunkInst.castShadow = true;

    // Three lobes per tree (main crown + two smaller offset puffs), offset
    // far enough apart to read as distinct clustered canopies — like a real
    // tree's separate leaf clumps — rather than concentric spheres that
    // blend into one blob (the offsets used to be much smaller than the
    // lobes' own radii, so the side puffs sat almost entirely inside the
    // main one).
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2f, roughness: 0.85, flatShading: true });
    const canopyGeoMain = new THREE.IcosahedronGeometry(0.5, 1);
    const canopyGeoSide = new THREE.IcosahedronGeometry(0.42, 1);
    const CANOPY_SEP_A = 0.56;
    const CANOPY_SEP_B = 0.5;
    const canopyMain = new THREE.InstancedMesh(canopyGeoMain, canopyMat, treePositions.length);
    const canopySideA = new THREE.InstancedMesh(canopyGeoSide, canopyMat, treePositions.length);
    const canopySideB = new THREE.InstancedMesh(canopyGeoSide, canopyMat, treePositions.length);
    for (const inst of [canopyMain, canopySideA, canopySideB]) {
      inst.castShadow = true;
      inst.receiveShadow = true;
    }

    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const axisY = new THREE.Vector3(0, 1, 0);
    treePositions.forEach((p, i) => {
      const rand = pseudoRandom(i);
      const rand2 = pseudoRandom(i + 91.7);
      const scale = 0.85 + rand * 0.4;
      const angle = rand * Math.PI * 2;
      q.setFromAxisAngle(axisY, angle);
      // Covers the main canopy (radius 0.5) plus how far the two side lobes
      // get offset from center (CANOPY_SEP_A/B * scale) plus their own
      // radius — the full combined foliage footprint, not just the trunk.
      treeColliders.push({ x: p.x, z: p.z, radius: 1.6 * scale });

      m.compose(new THREE.Vector3(p.x, 0.35 * scale, p.z), q, s.setScalar(scale));
      trunkInst.setMatrixAt(i, m);

      m.compose(new THREE.Vector3(p.x, 1.0 * scale, p.z), q, s.setScalar(scale));
      canopyMain.setMatrixAt(i, m);

      const sideAngle = angle + Math.PI * 0.6;
      const sideScale = scale * (0.75 + rand2 * 0.15);
      m.compose(
        new THREE.Vector3(
          p.x + Math.cos(sideAngle) * CANOPY_SEP_A * scale,
          0.88 * scale,
          p.z + Math.sin(sideAngle) * CANOPY_SEP_A * scale,
        ),
        q,
        s.setScalar(sideScale),
      );
      canopySideA.setMatrixAt(i, m);

      const sideAngle2 = angle - Math.PI * 0.7;
      m.compose(
        new THREE.Vector3(
          p.x + Math.cos(sideAngle2) * CANOPY_SEP_B * scale,
          0.78 * scale,
          p.z + Math.sin(sideAngle2) * CANOPY_SEP_B * scale,
        ),
        q,
        s.setScalar(sideScale * 0.9),
      );
      canopySideB.setMatrixAt(i, m);
    });
    group.add(trunkInst, canopyMain, canopySideA, canopySideB);
  }

  const { group: buildingsGroup, colliders: buildingColliders } = buildBuildingMeshes(buildings, accentColor);
  group.add(buildingsGroup);

  return { group, widthWorld, depthWorld, waterMaterial, treeColliders, buildingColliders };
}
