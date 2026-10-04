import * as THREE from 'three';

const RARE_GLOW_COLOR = 0xf2c14e;

/** Golden emissive wash plus a floating gem on a monster model; the returned function undoes it. */
export function applyRareLook(model: THREE.Object3D): () => void {
  const originals: Array<{ mesh: THREE.Mesh; material: THREE.Material | THREE.Material[] }> = [];
  model.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    originals.push({ mesh, material: mesh.material });
    // Cloned because the model builders may share materials across meshes.
    const tint = (m: THREE.Material): THREE.Material => {
      const std = m.clone() as THREE.MeshStandardMaterial;
      if (std.emissive) {
        std.emissive.setHex(RARE_GLOW_COLOR);
        std.emissiveIntensity = 0.32;
      }
      return std;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
  });

  const gemMaterial = new THREE.MeshStandardMaterial({ color: RARE_GLOW_COLOR, emissive: RARE_GLOW_COLOR, emissiveIntensity: 1.1, roughness: 0.3, flatShading: true });
  const gemGeometry = new THREE.OctahedronGeometry(0.16, 0);
  const gem = new THREE.Mesh(gemGeometry, gemMaterial);
  gem.position.set(0, 2.1, 0);
  model.add(gem);

  return () => {
    for (const { mesh, material } of originals) {
      const current = mesh.material;
      (Array.isArray(current) ? current : [current]).forEach((m) => m.dispose());
      mesh.material = material;
    }
    model.remove(gem);
    gemGeometry.dispose();
    gemMaterial.dispose();
  };
}
