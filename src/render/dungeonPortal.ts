import * as THREE from 'three';

export interface DungeonPortalMesh {
  group: THREE.Group;
  /** Animate this every frame (see animateDungeonPortal) so the membrane pulses instead of sitting static. */
  glowMaterial: THREE.MeshStandardMaterial;
}

/**
 * A freestanding "corrupted root arch" marking a dungeon's fixed entrance —
 * two gnarled root pillars framing a glowing membrane the player walks up to
 * and interacts with (see OverworldScreen's nearbyDungeon/enterDungeon,
 * which mirrors the existing NPC proximity-prompt pattern). Built from the
 * same primitive-geometry, flat-shaded low-poly style as
 * `render/worldBuilder.ts`'s trees/buildings so it reads as part of the same
 * world rather than a bolted-on VFX prop — kept as its own small module
 * (instead of folded into worldBuilder.ts) so OverworldScreen can drop one in
 * per-zone without touching that file's building/tree pipeline at all.
 */
export function buildDungeonPortalMesh(accentColor: number): DungeonPortalMesh {
  const group = new THREE.Group();

  const rootMat = new THREE.MeshStandardMaterial({ color: 0x2f2a38, roughness: 0.9, flatShading: true });
  const pillarGeo = new THREE.CylinderGeometry(0.22, 0.34, 2.6, 7);
  const knotGeo = new THREE.IcosahedronGeometry(0.26, 0);

  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, rootMat);
    pillar.position.set(side * 0.95, 1.3, 0);
    pillar.rotation.z = side * 0.1;
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    group.add(pillar);

    // A couple of gnarled offshoots per pillar for a twisted-root silhouette
    // rather than a plain smooth column.
    const knotTop = new THREE.Mesh(knotGeo, rootMat);
    knotTop.position.set(side * 1.2, 2.1, 0.12);
    knotTop.castShadow = true;
    group.add(knotTop);

    const knotLow = new THREE.Mesh(knotGeo, rootMat);
    knotLow.scale.setScalar(0.75);
    knotLow.position.set(side * 1.05, 0.55, -0.15);
    knotLow.castShadow = true;
    group.add(knotLow);
  }

  const lintel = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.2, 7), rootMat);
  lintel.rotation.z = Math.PI / 2;
  lintel.position.set(0, 2.55, 0);
  lintel.castShadow = true;
  group.add(lintel);

  const glowMaterial = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: accentColor,
    emissiveIntensity: 0.9,
    roughness: 0.35,
    transparent: true,
    opacity: 0.72,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 2.1), glowMaterial);
  glow.position.set(0, 1.15, 0);
  group.add(glow);

  return { group, glowMaterial };
}

/** Keeps the portal's inner membrane gently pulsing — call every frame with the screen's own running clock. */
export function animateDungeonPortal(mat: THREE.MeshStandardMaterial, time: number, phase = 0): void {
  mat.emissiveIntensity = 0.7 + Math.sin(time * 1.6 + phase) * 0.25;
}
