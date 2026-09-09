import * as THREE from 'three';

export type ClassAccessory = 'sword' | 'staff' | 'bow' | 'cross';

const SKIN = 0xe8b98c;
const TROUSERS = 0x2a2a35;

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, ...opts });
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, castShadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

/** A humanoid built from primitives: legs, capsule torso/arms, head, eyes. */
export function buildHumanoid(color: number, accessory: ClassAccessory | 'none' = 'none', skinColor = SKIN): THREE.Group {
  const group = new THREE.Group();

  const legMat = mat(TROUSERS);
  const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.5, 8);
  const legL = mesh(legGeo, legMat);
  const legR = mesh(legGeo, legMat);
  legL.position.set(-0.11, 0.25, 0);
  legR.position.set(0.11, 0.25, 0);
  group.add(legL, legR);

  const bodyMat = mat(color);
  const torso = mesh(new THREE.CapsuleGeometry(0.22, 0.32, 4, 8), bodyMat);
  torso.position.set(0, 0.82, 0);
  group.add(torso);

  const armGeo = new THREE.CapsuleGeometry(0.075, 0.34, 4, 8);
  const armL = mesh(armGeo, bodyMat);
  const armR = mesh(armGeo, bodyMat);
  armL.position.set(-0.31, 0.78, 0);
  armR.position.set(0.31, 0.78, 0);
  group.add(armL, armR);

  const headY = 1.23;
  const head = mesh(new THREE.SphereGeometry(0.2, 14, 10), mat(skinColor));
  head.position.set(0, headY, 0);
  group.add(head);

  const eyeMat = mat(0x1a1423, { roughness: 0.4 });
  const eyeGeo = new THREE.SphereGeometry(0.022, 6, 6);
  const eyeL = mesh(eyeGeo, eyeMat, false);
  const eyeR = mesh(eyeGeo, eyeMat, false);
  eyeL.position.set(-0.07, headY + 0.01, 0.18);
  eyeR.position.set(0.07, headY + 0.01, 0.18);
  group.add(eyeL, eyeR);

  if (accessory !== 'none') addClassAccessory(group, accessory, color, headY);

  group.userData.legs = [legL, legR];
  group.userData.arms = [armL, armR];
  return group;
}

function addClassAccessory(group: THREE.Group, accessory: ClassAccessory, color: number, headY: number): void {
  switch (accessory) {
    case 'sword': {
      const blade = mesh(new THREE.BoxGeometry(0.06, 0.62, 0.06), mat(0xcfd6dc, { metalness: 0.6, roughness: 0.3 }));
      blade.position.set(0.42, 0.55, 0.02);
      blade.rotation.z = 0.12;
      const guard = mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), mat(0x8a8a8a, { metalness: 0.5 }));
      guard.position.set(0.4, 0.26, 0.02);
      const hilt = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8), mat(0x6b4423));
      hilt.position.set(0.39, 0.16, 0.02);
      group.add(blade, guard, hilt);
      break;
    }
    case 'staff': {
      const pole = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), mat(0x6b4423));
      pole.position.set(0.4, 0.55, 0.05);
      const orb = mesh(
        new THREE.SphereGeometry(0.09, 10, 8),
        mat(0x8ec9ff, { emissive: 0x2f6fae, emissiveIntensity: 0.8, roughness: 0.2 }),
      );
      orb.position.set(0.4, 1.14, 0.05);
      const hat = mesh(new THREE.ConeGeometry(0.24, 0.4, 12), mat(color));
      hat.position.set(0, headY + 0.28, 0);
      group.add(pole, orb, hat);
      break;
    }
    case 'bow': {
      const bow = mesh(
        new THREE.TorusGeometry(0.32, 0.02, 6, 16, Math.PI * 1.15),
        mat(0x6b4423),
      );
      bow.position.set(0.42, 0.75, 0.1);
      bow.rotation.y = Math.PI / 2;
      bow.rotation.z = Math.PI * 0.075;
      const quiver = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 8), mat(0x5a4430));
      quiver.position.set(-0.18, 0.9, -0.18);
      quiver.rotation.z = 0.3;
      group.add(bow, quiver);
      break;
    }
    case 'cross': {
      const vertical = mesh(new THREE.BoxGeometry(0.06, 0.24, 0.04), mat(0xf2ede1));
      const horizontal = mesh(new THREE.BoxGeometry(0.18, 0.06, 0.04), mat(0xf2ede1));
      vertical.position.set(0, 0.86, 0.25);
      horizontal.position.set(0, 0.92, 0.25);
      const halo = mesh(new THREE.TorusGeometry(0.16, 0.015, 6, 20), mat(0xf2c14e, { emissive: 0xf2c14e, emissiveIntensity: 0.4 }));
      halo.position.set(0, headY + 0.24, 0);
      halo.rotation.x = Math.PI / 2;
      group.add(vertical, horizontal, halo);
      break;
    }
  }
}

/** A rounded blob for slimes, gently squashed, with two dot eyes. */
export function buildSlime(color: number): THREE.Group {
  const group = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.32, 14, 10), mat(color, { roughness: 0.35, metalness: 0.1 }));
  body.scale.set(1.15, 0.65, 1.15);
  body.position.y = 0.21;
  group.add(body);

  const eyeMat = mat(0x1a1423, { roughness: 0.4 });
  const eyeGeo = new THREE.SphereGeometry(0.03, 6, 6);
  const eyeL = mesh(eyeGeo, eyeMat, false);
  const eyeR = mesh(eyeGeo, eyeMat, false);
  eyeL.position.set(-0.1, 0.26, 0.27);
  eyeR.position.set(0.1, 0.26, 0.27);
  group.add(eyeL, eyeR);
  return group;
}

/** A small flying body with two flat wings. Hovers, so callers should lift it off the ground. */
export function buildBat(color: number): THREE.Group {
  const group = new THREE.Group();
  const body = mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(color));
  group.add(body);

  const wingGeo = new THREE.BoxGeometry(0.32, 0.05, 0.16);
  const wingMat = mat(color, { roughness: 0.6 });
  const wingL = mesh(wingGeo, wingMat);
  const wingR = mesh(wingGeo, wingMat);
  wingL.position.set(-0.28, 0, 0);
  wingR.position.set(0.28, 0, 0);
  wingL.rotation.z = 0.35;
  wingR.rotation.z = -0.35;
  group.add(wingL, wingR);
  group.userData.wings = [wingL, wingR];

  const eyeMat = mat(0xff5555, { emissive: 0xff2222, emissiveIntensity: 0.5 });
  const eyeGeo = new THREE.SphereGeometry(0.025, 6, 6);
  const eyeL = mesh(eyeGeo, eyeMat, false);
  const eyeR = mesh(eyeGeo, eyeMat, false);
  eyeL.position.set(-0.05, 0.02, 0.14);
  eyeR.position.set(0.05, 0.02, 0.14);
  group.add(eyeL, eyeR);
  return group;
}

/** A shrunken, green-skinned humanoid for small enemies. */
export function buildGoblin(color: number): THREE.Group {
  const group = buildHumanoid(color, 'none', 0x8faa5a);
  group.scale.setScalar(0.78);
  return group;
}

/** A four-legged body for wolves and similar beasts. */
export function buildQuadruped(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = mat(color);

  const body = mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 8), bodyMat);
  body.rotation.z = Math.PI / 2;
  body.position.set(0, 0.34, 0);
  group.add(body);

  const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 6);
  const legPositions: Array<[number, number]> = [
    [-0.28, 0.15],
    [0.28, 0.15],
    [-0.28, -0.15],
    [0.28, -0.15],
  ];
  for (const [x, z] of legPositions) {
    const leg = mesh(legGeo, bodyMat);
    leg.position.set(x, 0.15, z);
    group.add(leg);
  }

  const head = mesh(new THREE.BoxGeometry(0.22, 0.2, 0.24), bodyMat);
  head.position.set(0.34, 0.42, 0);
  group.add(head);

  const earGeo = new THREE.ConeGeometry(0.05, 0.12, 6);
  const earMat = mat(color);
  const earL = mesh(earGeo, earMat);
  const earR = mesh(earGeo, earMat);
  earL.position.set(0.34, 0.56, 0.08);
  earR.position.set(0.34, 0.56, -0.08);
  group.add(earL, earR);

  const eyeMat = mat(0xffe08a, { emissive: 0xffb800, emissiveIntensity: 0.4 });
  const eyeGeo = new THREE.SphereGeometry(0.02, 6, 6);
  const eye = mesh(eyeGeo, eyeMat, false);
  eye.position.set(0.44, 0.44, 0.1);
  group.add(eye);

  const tail = mesh(new THREE.ConeGeometry(0.06, 0.35, 6), bodyMat);
  tail.position.set(-0.42, 0.4, 0);
  tail.rotation.z = -Math.PI / 2.4;
  group.add(tail);

  return group;
}

const CLASS_ACCESSORY: Record<string, ClassAccessory> = {
  warrior: 'sword',
  mage: 'staff',
  archer: 'bow',
  cleric: 'cross',
};

export function buildClassModel(classId: string, color: number): THREE.Group {
  return buildHumanoid(color, CLASS_ACCESSORY[classId] ?? 'none');
}

export function buildEnemyModel(enemyId: string, color: number): THREE.Group {
  switch (enemyId) {
    case 'slime':
      return buildSlime(color);
    case 'bat':
      return buildBat(color);
    case 'goblin':
      return buildGoblin(color);
    case 'dark_wolf':
      return buildQuadruped(color);
    default:
      return buildSlime(color);
  }
}
