import * as THREE from 'three';

export interface TreasureChestMesh {
  group: THREE.Group;
  /** Rotate this on open/close — see setChestOpened. Pivoted at the chest's back-top edge so it swings open like a real lid instead of rotating in place through the body. */
  lidPivot: THREE.Group;
  /** Animate this every frame while unopened (see animateChestGlow) so the glint pulses instead of sitting static; stops pulsing once opened (setChestOpened dims it). */
  glowMaterial: THREE.MeshStandardMaterial;
  trimMaterial: THREE.MeshStandardMaterial;
}

const CLOSED_TRIM_COLOR = 0xcaa23a;
const OPENED_TRIM_COLOR = 0x6b6255;
const CLOSED_GLOW_INTENSITY = 0.9;

/**
 * A small low-poly treasure chest marking a hidden map secret — same
 * primitive-geometry, flat-shaded style as `render/worldBuilder.ts`'s
 * trees/buildings and `render/dungeonPortal.ts`'s portal arch, so it reads as
 * part of the same world rather than a bolted-on prop. Built once per chest
 * at zone mount (see OverworldScreen.buildChests); `setChestOpened` flips it
 * to its depleted look once looted (lid open, dull trim, no glow) instead of
 * rebuilding the mesh.
 */
export function buildTreasureChestMesh(): TreasureChestMesh {
  const group = new THREE.Group();

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.85, flatShading: true });
  const trimMaterial = new THREE.MeshStandardMaterial({ color: CLOSED_TRIM_COLOR, roughness: 0.5, metalness: 0.3, flatShading: true });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.6), woodMat);
  body.position.y = 0.25;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const trimBand = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.1, 0.64), trimMaterial);
  trimBand.position.y = 0.25;
  group.add(trimBand);

  // The lid pivots around its own back-top edge (not the box center), so
  // rotating it swings the front edge up and back like a real hinge instead
  // of clipping the lid through the body.
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.5, -0.3);
  group.add(lidPivot);

  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.16, 0.6), woodMat);
  lid.position.set(0, 0.06, 0.3);
  lid.castShadow = true;
  lidPivot.add(lid);

  const lidTrim = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.04, 0.62), trimMaterial);
  lidTrim.position.set(0, 0.14, 0.3);
  lidPivot.add(lidTrim);

  const glowMaterial = new THREE.MeshStandardMaterial({
    color: 0xf2c14e,
    emissive: 0xf2c14e,
    emissiveIntensity: CLOSED_GLOW_INTENSITY,
    roughness: 0.4,
  });
  const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), glowMaterial);
  glow.position.set(0, 0.42, 0.31);
  group.add(glow);

  return { group, lidPivot, glowMaterial, trimMaterial };
}

/** Keeps an unopened chest's glint gently pulsing — call every frame with the screen's own running clock, same idiom as animateDungeonPortal. No-op look-wise once the chest is opened (setChestOpened already zeroed emissiveIntensity), but harmless to keep calling. */
export function animateChestGlow(mat: THREE.MeshStandardMaterial, time: number, phase = 0): void {
  mat.emissiveIntensity = CLOSED_GLOW_INTENSITY * (0.55 + Math.sin(time * 2.2 + phase) * 0.35);
}

/** Flips a chest mesh to its opened (lid swung back, dull trim, no glint) or closed look. Idempotent — safe to call with the same value repeatedly. */
export function setChestOpened(mesh: TreasureChestMesh, opened: boolean): void {
  mesh.lidPivot.rotation.x = opened ? -Math.PI * 0.62 : 0;
  mesh.trimMaterial.color.set(opened ? OPENED_TRIM_COLOR : CLOSED_TRIM_COLOR);
  mesh.glowMaterial.emissiveIntensity = opened ? 0 : CLOSED_GLOW_INTENSITY;
  mesh.glowMaterial.visible = !opened;
}
