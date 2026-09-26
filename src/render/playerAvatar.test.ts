import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CLASS_DEFINITIONS } from '../config/classes';
import { defaultAppearance } from '../config/customization';
import { applyCosmeticVisual, classModelFile, cosmeticSlotsForClass } from './playerAvatar';

describe('classModelFile', () => {
  it('resolves every playable class to one of the 4 vendored character models', () => {
    const validModels = new Set(['Barbarian', 'Knight', 'Mage', 'Rogue']);
    for (const classDef of CLASS_DEFINITIONS) {
      const file = classModelFile(classDef.id);
      expect(file, `no model mapped for class "${classDef.id}"`).toBeDefined();
      expect(validModels.has(file!), `"${classDef.id}" maps to unknown model "${file}"`).toBe(true);
    }
  });
});

describe('cosmeticSlotsForClass', () => {
  it('every playable class resolves to a defined (even if all-false) slot map', () => {
    for (const classDef of CLASS_DEFINITIONS) {
      expect(() => cosmeticSlotsForClass(classDef.id)).not.toThrow();
    }
  });

  it('warrior (Barbarian.glb) has neither slot — its hat/cape stay permanently hidden for silhouette reasons', () => {
    expect(cosmeticSlotsForClass('warrior')).toEqual({ headwear: false, cape: false });
  });

  it('paladin/mage-family classes (Knight.glb/Mage.glb) have both a headwear and a cape slot', () => {
    for (const classId of ['paladin', 'mage', 'necromancer', 'cleric']) {
      expect(cosmeticSlotsForClass(classId)).toEqual({ headwear: true, cape: true });
    }
  });

  it('rogue-family classes (Rogue.glb) have a cape slot but no headwear mesh at all', () => {
    for (const classId of ['archer', 'assassin', 'monk']) {
      expect(cosmeticSlotsForClass(classId)).toEqual({ headwear: false, cape: true });
    }
  });
});

/** Builds a bare-bones stand-in for a class scene's relevant named nodes, without touching the real (heavy, async-loaded) GLTF files — exactly what `applyCosmeticVisual` itself needs: `getObjectByName` to resolve `head`/a headwear mesh/a cape mesh. */
function fakeSceneWithNodes(names: string[]): THREE.Group {
  const scene = new THREE.Group();
  for (const name of names) {
    const node = name === 'head' ? new THREE.Group() : new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    node.name = name;
    scene.add(node);
  }
  return scene;
}

describe('applyCosmeticVisual', () => {
  it('toggles the headwear mesh visible/hidden per headAccessory, and gives it its own (never-shared) tinted material when worn', () => {
    const scene = fakeSceneWithNodes(['Knight_Helmet', 'Knight_Cape', 'head']);
    const sharedMat = (scene.getObjectByName('Knight_Helmet') as THREE.Mesh).material;
    const appearance = { ...defaultAppearance(0, 0), headAccessory: 'elmo' as const, primaryColor: 0xff0000 };

    applyCosmeticVisual({ scene, classId: 'paladin' }, appearance);
    const helmet = scene.getObjectByName('Knight_Helmet') as THREE.Mesh;
    expect(helmet.visible).toBe(true);
    expect(helmet.material).not.toBe(sharedMat); // replaced, not mutated — never touches the shared atlas material
    expect((helmet.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff0000);

    applyCosmeticVisual({ scene, classId: 'paladin' }, { ...appearance, headAccessory: 'nenhum' });
    expect(helmet.visible).toBe(false);
  });

  it('never mutates a shared material in place — an untouched sibling mesh on the same material keeps its original color', () => {
    const scene = fakeSceneWithNodes(['Knight_Helmet', 'Knight_Cape', 'head']);
    const sharedMaterial = new THREE.MeshStandardMaterial({ color: 0x123456 });
    (scene.getObjectByName('Knight_Helmet') as THREE.Mesh).material = sharedMaterial;
    const otherBodyMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), sharedMaterial);
    scene.add(otherBodyMesh);

    applyCosmeticVisual(
      { scene, classId: 'paladin' },
      { ...defaultAppearance(0, 0), headAccessory: 'elmo', primaryColor: 0x00ff00 },
    );

    expect(otherBodyMesh.material).toBe(sharedMaterial);
    expect((otherBodyMesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x123456);
  });

  it('recolors the cape mesh to secondaryColor', () => {
    const scene = fakeSceneWithNodes(['Knight_Helmet', 'Knight_Cape', 'head']);
    applyCosmeticVisual({ scene, classId: 'paladin' }, { ...defaultAppearance(0, 0), secondaryColor: 0x0000ff });
    const cape = scene.getObjectByName('Knight_Cape') as THREE.Mesh;
    expect((cape.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0x0000ff);
  });

  it('adds a tinted hair accent under the head bone only for long-hair styles, and clears it again for a short style', () => {
    const scene = fakeSceneWithNodes(['Knight_Helmet', 'Knight_Cape', 'head']);
    const head = scene.getObjectByName('head')!;

    applyCosmeticVisual({ scene, classId: 'paladin' }, { ...defaultAppearance(0, 0), hairStyle: 'curto' });
    expect(head.children.filter((c) => c.userData.isHairAccent)).toHaveLength(0);

    applyCosmeticVisual({ scene, classId: 'paladin' }, { ...defaultAppearance(0, 0), hairStyle: 'rabocavalo', hairColor: 0xabcdef });
    const accents = head.children.filter((c) => c.userData.isHairAccent);
    expect(accents).toHaveLength(1);
    expect(((accents[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xabcdef);

    applyCosmeticVisual({ scene, classId: 'paladin' }, { ...defaultAppearance(0, 0), hairStyle: 'curto' });
    expect(head.children.filter((c) => c.userData.isHairAccent)).toHaveLength(0);
  });

  it('gives twin-pigtail hairstyles two accent meshes instead of one', () => {
    const scene = fakeSceneWithNodes(['Knight_Helmet', 'Knight_Cape', 'head']);
    applyCosmeticVisual({ scene, classId: 'paladin' }, { ...defaultAppearance(0, 0), hairStyle: 'chiquinhas' });
    const head = scene.getObjectByName('head')!;
    expect(head.children.filter((c) => c.userData.isHairAccent)).toHaveLength(2);
  });

  it('is a no-op (never throws) for a class/scene with no headwear or cape node at all', () => {
    const scene = fakeSceneWithNodes(['head']);
    expect(() => applyCosmeticVisual({ scene, classId: 'archer' }, { ...defaultAppearance(0, 0), headAccessory: 'elmo' })).not.toThrow();
  });
});
