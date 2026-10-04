import * as THREE from 'three';

export interface CorruptedTreeMesh {
  group: THREE.Group;
  /** Pulsed every frame while corrupted (see animateCorruptedTree). */
  glowMaterial: THREE.MeshStandardMaterial;
  canopyMaterial: THREE.MeshStandardMaterial;
  trunkMaterial: THREE.MeshStandardMaterial;
}

const CORRUPTED_CANOPY = 0x3a2a4e;
const CORRUPTED_TRUNK = 0x2a2030;
const PURIFIED_CANOPY = 0xe9a8d4;
const PURIFIED_TRUNK = 0x6b4a2c;
const GLOW_COLOR = 0xa44bff;

/**
 * A rotting Ipê-árvore — same primitive, flat-shaded style as the world's own
 * trees/chests, with a violet glow at its roots so it reads from across the
 * field. `setTreePurified` flips it to a blooming pink-ipê look (no glow).
 */
export function buildCorruptedTreeMesh(): CorruptedTreeMesh {
  const group = new THREE.Group();
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: CORRUPTED_TRUNK, roughness: 0.95, flatShading: true });
  const canopyMaterial = new THREE.MeshStandardMaterial({ color: CORRUPTED_CANOPY, roughness: 0.9, flatShading: true });
  const glowMaterial = new THREE.MeshStandardMaterial({ color: GLOW_COLOR, emissive: GLOW_COLOR, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 });

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.42, 2.2, 6), trunkMaterial);
  trunk.position.y = 1.1;
  trunk.castShadow = true;
  group.add(trunk);

  const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 0), canopyMaterial);
  canopy.position.y = 2.7;
  canopy.scale.set(1, 0.8, 1);
  canopy.castShadow = true;
  group.add(canopy);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.07, 6, 20), glowMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  group.add(ring);

  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), glowMaterial);
  crystal.position.y = 1.0;
  crystal.position.x = 0.55;
  group.add(crystal);

  return { group, glowMaterial, canopyMaterial, trunkMaterial };
}

export function animateCorruptedTree(tree: CorruptedTreeMesh, time: number): void {
  tree.glowMaterial.emissiveIntensity = 0.7 + 0.5 * Math.sin(time * 3);
}

export function setTreePurified(tree: CorruptedTreeMesh, purified: boolean): void {
  tree.canopyMaterial.color.setHex(purified ? PURIFIED_CANOPY : CORRUPTED_CANOPY);
  tree.trunkMaterial.color.setHex(purified ? PURIFIED_TRUNK : CORRUPTED_TRUNK);
  tree.glowMaterial.emissiveIntensity = 0;
  tree.glowMaterial.opacity = purified ? 0 : 0.85;
}

export function disposeCorruptedTree(tree: CorruptedTreeMesh): void {
  tree.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();
  });
  tree.glowMaterial.dispose();
  tree.canopyMaterial.dispose();
  tree.trunkMaterial.dispose();
}
