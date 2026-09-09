import * as THREE from 'three';
import { TILE_SIZE } from '../config/gameConfig';
import { TileType } from '../config/tiles';

export interface WorldMeshes {
  group: THREE.Group;
  widthWorld: number;
  depthWorld: number;
}

export function tileCenterWorld(tx: number, ty: number, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(tx * TILE_SIZE + TILE_SIZE / 2, 0, ty * TILE_SIZE + TILE_SIZE / 2);
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function buildOverworldMeshes(tiles: TileType[][]): WorldMeshes {
  const mapHeight = tiles.length;
  const mapWidth = tiles[0].length;
  const widthWorld = mapWidth * TILE_SIZE;
  const depthWorld = mapHeight * TILE_SIZE;

  const group = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(widthWorld, depthWorld),
    new THREE.MeshStandardMaterial({ color: 0x4c8a3f, roughness: 0.95 }),
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
    const matPath = new THREE.MeshStandardMaterial({ color: 0xc2a267, roughness: 0.9 });
    const inst = new THREE.InstancedMesh(geo, matPath, pathPositions.length);
    inst.receiveShadow = true;
    pathPositions.forEach((p, i) => {
      m.makeTranslation(p.x, 0.03, p.z);
      inst.setMatrixAt(i, m);
    });
    group.add(inst);
  }

  if (waterPositions.length > 0) {
    const geo = new THREE.BoxGeometry(TILE_SIZE * 0.98, 0.08, TILE_SIZE * 0.98);
    const matWater = new THREE.MeshStandardMaterial({
      color: 0x3a6ea5,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88,
    });
    const inst = new THREE.InstancedMesh(geo, matWater, waterPositions.length);
    waterPositions.forEach((p, i) => {
      m.makeTranslation(p.x, 0.02, p.z);
      inst.setMatrixAt(i, m);
    });
    group.add(inst);
  }

  if (treePositions.length > 0) {
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.7, 6);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.9 });
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treePositions.length);
    trunkInst.castShadow = true;

    const canopyGeo = new THREE.IcosahedronGeometry(0.55, 0);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x2f6b2f, roughness: 0.85, flatShading: true });
    const canopyInst = new THREE.InstancedMesh(canopyGeo, canopyMat, treePositions.length);
    canopyInst.castShadow = true;
    canopyInst.receiveShadow = true;

    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const axisY = new THREE.Vector3(0, 1, 0);
    treePositions.forEach((p, i) => {
      const rand = pseudoRandom(i);
      const scale = 0.85 + rand * 0.4;
      q.setFromAxisAngle(axisY, rand * Math.PI * 2);

      m.compose(new THREE.Vector3(p.x, 0.35 * scale, p.z), q, s.setScalar(scale));
      trunkInst.setMatrixAt(i, m);

      m.compose(new THREE.Vector3(p.x, 1.0 * scale, p.z), q, s.setScalar(scale));
      canopyInst.setMatrixAt(i, m);
    });
    group.add(trunkInst, canopyInst);
  }

  return { group, widthWorld, depthWorld };
}
