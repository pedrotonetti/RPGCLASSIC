import * as THREE from 'three';

export interface LoreFragmentMesh {
  group: THREE.Group;
  orb: THREE.Mesh;
  glowMaterial: THREE.MeshStandardMaterial;
}

const UNREAD_COLOR = 0x7fe3d0;
const READ_COLOR = 0x9aa8a4;
const UNREAD_INTENSITY = 1.0;
const READ_INTENSITY = 0.28;
const ORB_REST_HEIGHT = 0.8;

/** A squat root-stump with a pale gem hovering over it, in the same low-poly style as the chest and portal. */
export function buildLoreFragmentMesh(): LoreFragmentMesh {
  const group = new THREE.Group();

  const rootMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.9, flatShading: true });
  const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.38, 0.28, 6), rootMat);
  stump.position.y = 0.14;
  stump.castShadow = true;
  stump.receiveShadow = true;
  group.add(stump);

  const knotGeo = new THREE.IcosahedronGeometry(0.12, 0);
  for (const [dx, dz, s] of [
    [0.3, 0.1, 1],
    [-0.28, -0.14, 0.8],
  ] as const) {
    const knot = new THREE.Mesh(knotGeo, rootMat);
    knot.position.set(dx, 0.08, dz);
    knot.scale.setScalar(s);
    knot.castShadow = true;
    group.add(knot);
  }

  const glowMaterial = new THREE.MeshStandardMaterial({
    color: UNREAD_COLOR,
    emissive: UNREAD_COLOR,
    emissiveIntensity: UNREAD_INTENSITY,
    roughness: 0.3,
    flatShading: true,
    transparent: true,
    opacity: 0.92,
  });
  const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), glowMaterial);
  orb.position.y = ORB_REST_HEIGHT;
  group.add(orb);

  return { group, orb, glowMaterial };
}

export function animateLoreFragment(mesh: LoreFragmentMesh, time: number, phase: number, discovered: boolean): void {
  mesh.orb.position.y = ORB_REST_HEIGHT + Math.sin(time * 1.8 + phase) * 0.08;
  mesh.orb.rotation.y = time * 0.9 + phase;
  const base = discovered ? READ_INTENSITY : UNREAD_INTENSITY;
  mesh.glowMaterial.emissiveIntensity = base * (0.7 + Math.sin(time * 2.4 + phase) * 0.3);
}

export function setLoreFragmentDiscovered(mesh: LoreFragmentMesh, discovered: boolean): void {
  const color = discovered ? READ_COLOR : UNREAD_COLOR;
  mesh.glowMaterial.color.setHex(color);
  mesh.glowMaterial.emissive.setHex(color);
  mesh.glowMaterial.emissiveIntensity = discovered ? READ_INTENSITY : UNREAD_INTENSITY;
}
