import * as THREE from 'three';
import { TILE_SIZE } from '../config/gameConfig';
import { TileType } from '../config/tiles';

export interface WorldMeshes {
  group: THREE.Group;
  widthWorld: number;
  depthWorld: number;
  /** Shared material driving all water tiles — animate it for a shimmering surface. */
  waterMaterial: THREE.MeshStandardMaterial | null;
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

export function buildOverworldMeshes(tiles: TileType[][]): WorldMeshes {
  const mapHeight = tiles.length;
  const mapWidth = tiles[0].length;
  const widthWorld = mapWidth * TILE_SIZE;
  const depthWorld = mapHeight * TILE_SIZE;

  const group = new THREE.Group();

  const grassTex = makeGrassTexture(0x4c8a3f);
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
    const geo = new THREE.BoxGeometry(TILE_SIZE * 0.98, 0.08, TILE_SIZE * 0.98, 6, 1, 6);
    waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a6ea5,
      roughness: 0.15,
      metalness: 0.15,
      transparent: true,
      opacity: 0.88,
      emissive: 0x1c3f63,
      emissiveIntensity: 0.15,
    });
    const inst = new THREE.InstancedMesh(geo, waterMaterial, waterPositions.length);
    waterPositions.forEach((p, i) => {
      m.makeTranslation(p.x, 0.02, p.z);
      inst.setMatrixAt(i, m);
    });
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

  return { group, widthWorld, depthWorld, waterMaterial };
}
