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

export function buildOverworldMeshes(tiles: TileType[][]): WorldMeshes {
  const mapHeight = tiles.length;
  const mapWidth = tiles[0].length;
  const widthWorld = mapWidth * TILE_SIZE;
  const depthWorld = mapHeight * TILE_SIZE;

  const group = new THREE.Group();

  const grassTex = makeGrainTexture(0x4c8a3f, 26);
  grassTex.repeat.set(mapWidth * 1.5, mapHeight * 1.5);
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

    // Three overlapping lobes per tree (main crown + two smaller offset puffs)
    // read as a fuller, rounder canopy than a single sphere.
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2f, roughness: 0.85, flatShading: true });
    const canopyGeoMain = new THREE.IcosahedronGeometry(0.55, 1);
    const canopyGeoSide = new THREE.IcosahedronGeometry(0.4, 1);
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
        new THREE.Vector3(p.x + Math.cos(sideAngle) * 0.28 * scale, 0.92 * scale, p.z + Math.sin(sideAngle) * 0.28 * scale),
        q,
        s.setScalar(sideScale),
      );
      canopySideA.setMatrixAt(i, m);

      const sideAngle2 = angle - Math.PI * 0.7;
      m.compose(
        new THREE.Vector3(p.x + Math.cos(sideAngle2) * 0.26 * scale, 0.82 * scale, p.z + Math.sin(sideAngle2) * 0.26 * scale),
        q,
        s.setScalar(sideScale * 0.9),
      );
      canopySideB.setMatrixAt(i, m);
    });
    group.add(trunkInst, canopyMain, canopySideA, canopySideB);
  }

  return { group, widthWorld, depthWorld, waterMaterial };
}
