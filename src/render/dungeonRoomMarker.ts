import * as THREE from 'three';

export interface DungeonRoomMarkerMesh {
  group: THREE.Group;
  crystal: THREE.Mesh;
  glowMaterial: THREE.MeshStandardMaterial;
}

/**
 * Marcador de uma sala especial de masmorra (santuário ou armadilha — ver
 * screens/DungeonRunLayer.ts): um círculo rúnico no chão com um cristal
 * flutuando acima. Mesmo estilo low-poly flat-shaded do portal
 * (render/dungeonPortal.ts) e dos baús, para parecer parte do mundo.
 */
export function buildDungeonRoomMarker(color: number): DungeonRoomMarkerMesh {
  const group = new THREE.Group();
  const glowMaterial = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.9,
    roughness: 0.4,
    transparent: true,
    opacity: 0.85,
    flatShading: true,
  });

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 18), glowMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x3a3442, roughness: 0.9, flatShading: true });
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.5, 6), stoneMat);
  plinth.position.y = 0.25;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  group.add(plinth);

  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), glowMaterial);
  crystal.position.y = 1.0;
  crystal.castShadow = true;
  group.add(crystal);

  return { group, crystal, glowMaterial };
}

/** Faz o cristal girar e pulsar — chamar todo frame enquanto a sala não foi resolvida. */
export function animateDungeonRoomMarker(mesh: DungeonRoomMarkerMesh, time: number, phase = 0): void {
  mesh.crystal.rotation.y = time * 1.2 + phase;
  mesh.crystal.position.y = 1.0 + Math.sin(time * 2 + phase) * 0.08;
  mesh.glowMaterial.emissiveIntensity = 0.7 + Math.sin(time * 1.8 + phase) * 0.25;
}

/** Visual de "sala resolvida": brilho apagado, cristal parado no pedestal. */
export function setDungeonRoomMarkerResolved(mesh: DungeonRoomMarkerMesh): void {
  mesh.glowMaterial.emissiveIntensity = 0.08;
  mesh.glowMaterial.opacity = 0.4;
  mesh.crystal.position.y = 0.62;
}
