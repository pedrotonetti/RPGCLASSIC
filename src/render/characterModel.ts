import * as THREE from 'three';
import { getClassById } from '../config/classes';
import { defaultAppearance, type CharacterAppearance } from '../config/customization';
import type { Player } from '../entities/Player';
import { ENEMY_DEFINITIONS } from '../data/enemies';

export type ClassAccessory = 'sword' | 'staff' | 'bow' | 'cross' | 'shield' | 'dagger' | 'grimoire' | 'fists' | 'none';

const CLASS_ACCESSORY: Record<string, ClassAccessory> = {
  warrior: 'sword',
  mage: 'staff',
  archer: 'bow',
  cleric: 'cross',
  paladin: 'shield',
  assassin: 'dagger',
  necromancer: 'grimoire',
  monk: 'fists',
};

function mat(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...opts });
}

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, castShadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  return m;
}

const BODY_SCALE: Record<CharacterAppearance['bodyType'], { torso: number; limb: number; shoulder: number }> = {
  magro: { torso: 0.86, limb: 0.85, shoulder: 0.92 },
  atletico: { torso: 1.0, limb: 1.0, shoulder: 1.05 },
  robusto: { torso: 1.22, limb: 1.15, shoulder: 1.18 },
};

/**
 * Named joints exposed on every built character, so an `AnimationController`
 * can pose the figure without knowing anything about how it was built.
 * Everything here is a `THREE.Group` pivoted at the joint itself (shoulder,
 * hip, neck), so rotating it swings the limb naturally from that point.
 */
export interface CharacterRig {
  root: THREE.Group;
  upperBody: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
}

export function getRig(character: THREE.Group): CharacterRig {
  return character.userData.rig as CharacterRig;
}

/**
 * Builds a proportioned human figure — torso, jointed limbs, neck, a head
 * with face features, hair, and optional facial hair/accessories/markings —
 * all from primitives, driven entirely by a `CharacterAppearance`. This is
 * the single builder used for the player everywhere (creation preview,
 * overworld, battle); enemies use their own, more creature-specific shapes
 * further down this file.
 *
 * The whole figure is built as a small joint hierarchy (`CharacterRig`,
 * stored at `root.userData.rig`) rather than one flat bag of meshes, so it
 * can be posed procedurally by `render/animation.ts` — no bone skinning,
 * just nested pivots, in the spirit of simple/legible low-poly rigs (the
 * same trick classic blocky avatars and early 3D indie games use instead of
 * full skeletal animation).
 */
export function buildHumanCharacter(appearance: CharacterAppearance, accessory: ClassAccessory): THREE.Group {
  const root = new THREE.Group();
  const upperBody = new THREE.Group();
  root.add(upperBody);

  const body = BODY_SCALE[appearance.bodyType];
  const isFem = appearance.gender === 'feminino';

  const skinMat = mat(appearance.skinTone, { roughness: 0.55 });
  const clothMat = mat(appearance.primaryColor, { roughness: 0.8 });
  const trimMat = mat(appearance.secondaryColor, { roughness: 0.55, metalness: 0.25 });
  const shoeMat = mat(0x2a2016, { roughness: 0.9 });

  // Legs: each is a group pivoted at the hip joint, leg + foot hanging below it.
  const legRadius = 0.1 * body.limb;
  const legHeight = 0.78;
  const legGeo = new THREE.CapsuleGeometry(legRadius, legHeight, 6, 12);
  const footGeo = new THREE.BoxGeometry(0.13, 0.09, 0.26);
  const hipWidth = isFem ? 0.16 : 0.13;
  const hipY = legHeight + 0.06;

  const legGroups: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const legGroup = new THREE.Group();
    legGroup.position.set(hipWidth * side, hipY, 0);

    const leg = mesh(legGeo, clothMat);
    leg.position.set(0, -legHeight / 2, 0);
    legGroup.add(leg);

    const foot = mesh(footGeo, shoeMat);
    foot.position.set(0, 0.045 - hipY, 0.05);
    legGroup.add(foot);

    root.add(legGroup);
    legGroups.push(legGroup);
  }
  const [legL, legR] = legGroups;

  // Hips + torso (added to upperBody, which sits at the world origin — the
  // whole upper body can be nudged/leaned as one unit for animation).
  const waistWidth = (isFem ? 0.19 : 0.21) * body.torso;
  const hips = mesh(new THREE.CapsuleGeometry(waistWidth, 0.06, 6, 12), clothMat);
  hips.position.set(0, hipY, 0);
  hips.scale.set(1, 0.7, 0.85);
  upperBody.add(hips);

  const torsoHeight = 0.5;
  const shoulderWidth = (isFem ? 0.24 : 0.28) * body.shoulder;
  const torsoRadius = (isFem ? 0.2 : 0.24) * body.torso;
  const torso = mesh(new THREE.CapsuleGeometry(torsoRadius, torsoHeight, 6, 14), clothMat);
  const torsoY = hipY + 0.12 + torsoHeight / 2;
  torso.position.set(0, torsoY, 0);
  // Taper: broader at the shoulders, narrower at the waist (a believable torso silhouette).
  torso.scale.set(shoulderWidth / torsoRadius, 1, 0.8);
  upperBody.add(torso);

  const belt = mesh(new THREE.CylinderGeometry(waistWidth * 1.05, waistWidth * 1.05, 0.07, 16), trimMat);
  belt.position.set(0, hipY + 0.1, 0);
  upperBody.add(belt);

  // Arms (upper arm + forearm + hand), each a group pivoted at the shoulder.
  const shoulderY = torsoY + torsoHeight / 2 - 0.03;
  const armRadius = 0.07 * body.limb;
  const upperArmGeo = new THREE.CapsuleGeometry(armRadius, 0.26, 6, 10);
  const forearmGeo = new THREE.CapsuleGeometry(armRadius * 0.9, 0.24, 6, 10);
  const handGeo = new THREE.SphereGeometry(armRadius * 1.05, 10, 8);

  const armGroups: THREE.Group[] = [];
  for (const side of [-1, 1] as const) {
    const armGroup = new THREE.Group();
    const shoulderX = shoulderWidth * 1.05 * side;
    armGroup.position.set(shoulderX, shoulderY, 0);
    armGroup.rotation.z = -0.12 * side;

    const upperArm = mesh(upperArmGeo, clothMat);
    upperArm.position.set(0, -0.14, 0);
    armGroup.add(upperArm);

    const forearm = mesh(forearmGeo, skinMat);
    forearm.position.set(0, -0.36, 0.02);
    forearm.rotation.x = 0.15;
    armGroup.add(forearm);

    const hand = mesh(handGeo, skinMat);
    hand.position.set(0, -0.5, 0.05);
    armGroup.add(hand);

    upperBody.add(armGroup);
    armGroups.push(armGroup);
  }
  const [armL, armR] = armGroups;

  // Neck + head.
  const neckY = torsoY + torsoHeight / 2 + 0.04;
  const neck = mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.1, 10), skinMat);
  neck.position.set(0, neckY, 0);
  upperBody.add(neck);

  const headY = neckY + 0.15;
  const headRadius = 0.155;
  const headGroup = new THREE.Group();
  headGroup.position.set(0, headY, 0);
  upperBody.add(headGroup);

  const headGeo = shapedHeadGeometry(appearance.faceShape, headRadius);
  const head = mesh(headGeo, skinMat);
  headGroup.add(head);

  addFace(headGroup, appearance, 0, headRadius);
  addHair(headGroup, appearance, 0, headRadius);
  addFacialHair(headGroup, appearance, 0, headRadius);
  addHeadAccessory(headGroup, appearance, 0, headRadius, clothMat, trimMat);
  addMarkings(headGroup, appearance, 0, headRadius, armR);
  addClassAccessory(upperBody, accessory, appearance.primaryColor, appearance.secondaryColor, headY, shoulderWidth, armL, armR, shoulderY);

  root.scale.setScalar(appearance.heightScale);

  const rig: CharacterRig = { root, upperBody, head: headGroup, armL, armR, legL, legR };
  root.userData.rig = rig;
  return root;
}

function shapedHeadGeometry(shape: CharacterAppearance['faceShape'], r: number): THREE.BufferGeometry {
  switch (shape) {
    case 'quadrado': {
      const geo = new THREE.SphereGeometry(r, 14, 10);
      geo.scale(1.08, 0.92, 1.0);
      return geo;
    }
    case 'redondo': {
      const geo = new THREE.SphereGeometry(r, 16, 12);
      geo.scale(1.05, 1.0, 1.05);
      return geo;
    }
    case 'anguloso': {
      const geo = new THREE.IcosahedronGeometry(r * 1.05, 1);
      geo.scale(1, 1.05, 0.95);
      return geo;
    }
    case 'oval':
    default: {
      const geo = new THREE.SphereGeometry(r, 14, 12);
      geo.scale(0.95, 1.12, 0.98);
      return geo;
    }
  }
}

function addFace(group: THREE.Group, appearance: CharacterAppearance, headY: number, r: number): void {
  // Layered eyes (sclera + iris + pupil) read as far more human than a single flat-colored sphere.
  const scleraMat = mat(0xf5ede0, { roughness: 0.25 });
  const irisMat = mat(appearance.eyeColor, { roughness: 0.25 });
  const pupilMat = mat(0x14100c, { roughness: 0.3 });
  const scleraGeo = new THREE.SphereGeometry(r * 0.135, 10, 10);
  const irisGeo = new THREE.SphereGeometry(r * 0.078, 8, 8);
  const pupilGeo = new THREE.SphereGeometry(r * 0.034, 6, 6);
  for (const side of [-1, 1] as const) {
    const eyeX = r * 0.42 * side;
    const eyeY = headY + r * 0.05;
    const sclera = mesh(scleraGeo, scleraMat, false);
    sclera.position.set(eyeX, eyeY, r * 0.86);
    group.add(sclera);
    const iris = mesh(irisGeo, irisMat, false);
    iris.position.set(eyeX, eyeY, r * 0.93);
    group.add(iris);
    const pupil = mesh(pupilGeo, pupilMat, false);
    pupil.position.set(eyeX, eyeY, r * 0.965);
    group.add(pupil);
  }

  // Ears — small flattened lobes on each side of the head.
  const earGeo = new THREE.SphereGeometry(r * 0.16, 8, 8);
  const earMat = mat(appearance.skinTone, { roughness: 0.55 });
  for (const side of [-1, 1] as const) {
    const ear = mesh(earGeo, earMat, false);
    ear.position.set(r * 0.98 * side, headY - r * 0.02, 0);
    ear.scale.set(0.55, 1, 0.7);
    group.add(ear);
  }

  const browMat = mat(appearance.hairColor, { roughness: 0.9 });
  const browThickness = appearance.eyebrowStyle === 'grossa' ? 0.05 : 0.03;
  const browGeo = new THREE.BoxGeometry(r * 0.5, r * browThickness, r * 0.12);
  const browL = mesh(browGeo, browMat, false);
  const browR = mesh(browGeo, browMat, false);
  const browTilt = appearance.eyebrowStyle === 'arqueada' ? 0.35 : appearance.eyebrowStyle === 'reta' ? 0 : 0.15;
  browL.position.set(-r * 0.42, headY + r * 0.32, r * 0.92);
  browR.position.set(r * 0.42, headY + r * 0.32, r * 0.92);
  browL.rotation.z = browTilt;
  browR.rotation.z = -browTilt;
  group.add(browL, browR);

  const nose = mesh(new THREE.ConeGeometry(r * 0.1, r * 0.2, 8), mat(appearance.skinTone), false);
  nose.position.set(0, headY - r * 0.05, r * 0.98);
  nose.rotation.x = Math.PI / 2;
  group.add(nose);

  const mouth = mesh(new THREE.CapsuleGeometry(r * 0.025, r * 0.26, 4, 8), mat(0x7a4040, { roughness: 0.5 }), false);
  mouth.rotation.z = Math.PI / 2;
  mouth.position.set(0, headY - r * 0.42, r * 0.94);
  group.add(mouth);
}

function addHair(group: THREE.Group, appearance: CharacterAppearance, headY: number, r: number): void {
  if (appearance.hairStyle === 'careca') return;
  const hairMat = mat(appearance.hairColor, { roughness: 0.45 });

  switch (appearance.hairStyle) {
    case 'curto': {
      const cap = mesh(new THREE.SphereGeometry(r * 1.04, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.38), hairMat);
      cap.position.set(0, headY + r * 0.15, 0);
      group.add(cap);
      break;
    }
    case 'medio': {
      const cap = mesh(new THREE.SphereGeometry(r * 1.08, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat);
      cap.position.set(0, headY + r * 0.12, -r * 0.05);
      group.add(cap);
      const back = mesh(new THREE.SphereGeometry(r * 0.9, 10, 8), hairMat);
      back.position.set(0, headY - r * 0.1, -r * 0.65);
      back.scale.set(0.9, 1.1, 0.6);
      group.add(back);
      break;
    }
    case 'longo': {
      const cap = mesh(new THREE.SphereGeometry(r * 1.08, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), hairMat);
      cap.position.set(0, headY + r * 0.12, -r * 0.05);
      group.add(cap);
      const drape = mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.35, r * 2.2, 10), hairMat);
      drape.position.set(0, headY - r * 1.0, -r * 0.55);
      group.add(drape);
      break;
    }
    case 'moicano': {
      const ridge = mesh(new THREE.BoxGeometry(r * 0.28, r * 0.9, r * 1.3), hairMat);
      ridge.position.set(0, headY + r * 0.6, 0);
      group.add(ridge);
      break;
    }
    case 'afro': {
      const puff = mesh(new THREE.SphereGeometry(r * 1.35, 12, 10), hairMat);
      puff.position.set(0, headY + r * 0.15, -r * 0.05);
      group.add(puff);
      break;
    }
    case 'coque': {
      const cap = mesh(new THREE.SphereGeometry(r * 1.02, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.38), hairMat);
      cap.position.set(0, headY + r * 0.15, 0);
      group.add(cap);
      const bun = mesh(new THREE.SphereGeometry(r * 0.42, 10, 8), hairMat);
      bun.position.set(0, headY + r * 0.75, -r * 0.5);
      group.add(bun);
      break;
    }
    case 'trancado': {
      const cap = mesh(new THREE.SphereGeometry(r * 1.04, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.38), hairMat);
      cap.position.set(0, headY + r * 0.15, 0);
      group.add(cap);
      const braid = mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.1, r * 2.0, 8), hairMat);
      braid.position.set(0, headY - r * 0.9, -r * 0.75);
      group.add(braid);
      break;
    }
  }
}

function addFacialHair(group: THREE.Group, appearance: CharacterAppearance, headY: number, r: number): void {
  if (appearance.facialHair === 'nenhuma') return;
  const beardMat = mat(appearance.hairColor, { roughness: 0.9 });

  switch (appearance.facialHair) {
    case 'bigode': {
      const stache = mesh(new THREE.BoxGeometry(r * 0.4, r * 0.08, r * 0.08), beardMat, false);
      stache.position.set(0, headY - r * 0.32, r * 0.95);
      group.add(stache);
      break;
    }
    case 'cavanhaque': {
      const patch = mesh(new THREE.ConeGeometry(r * 0.18, r * 0.3, 8), beardMat, false);
      patch.position.set(0, headY - r * 0.68, r * 0.65);
      patch.rotation.x = Math.PI;
      group.add(patch);
      break;
    }
    case 'completa': {
      const jaw = mesh(new THREE.SphereGeometry(r * 1.02, 12, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), beardMat);
      jaw.position.set(0, headY - r * 0.1, 0);
      group.add(jaw);
      break;
    }
    case 'longa': {
      const jaw = mesh(new THREE.SphereGeometry(r * 1.0, 12, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), beardMat);
      jaw.position.set(0, headY - r * 0.1, 0);
      group.add(jaw);
      const drape = mesh(new THREE.ConeGeometry(r * 0.5, r * 1.2, 10), beardMat);
      drape.position.set(0, headY - r * 1.1, r * 0.25);
      group.add(drape);
      break;
    }
  }
}

function addHeadAccessory(
  group: THREE.Group,
  appearance: CharacterAppearance,
  headY: number,
  r: number,
  clothMat: THREE.Material,
  trimMat: THREE.Material,
): void {
  if (appearance.headAccessory === 'nenhum') return;

  switch (appearance.headAccessory) {
    case 'elmo': {
      const dome = mesh(new THREE.SphereGeometry(r * 1.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), trimMat);
      dome.position.set(0, headY + r * 0.1, 0);
      const visor = mesh(new THREE.BoxGeometry(r * 1.6, r * 0.14, r * 0.1), mat(0x1a1a1a, { metalness: 0.6 }), false);
      visor.position.set(0, headY + r * 0.15, r * 1.0);
      group.add(dome, visor);
      break;
    }
    case 'chapeu': {
      const brim = mesh(new THREE.CylinderGeometry(r * 1.5, r * 1.5, r * 0.08, 16), clothMat);
      brim.position.set(0, headY + r * 0.55, 0);
      const cone = mesh(new THREE.ConeGeometry(r * 0.9, r * 1.2, 12), clothMat);
      cone.position.set(0, headY + r * 1.15, 0);
      group.add(brim, cone);
      break;
    }
    case 'coroa': {
      const band = mesh(new THREE.TorusGeometry(r * 0.95, r * 0.09, 8, 16), mat(0xf2c14e, { metalness: 0.7, roughness: 0.25 }));
      band.position.set(0, headY + r * 0.75, 0);
      band.rotation.x = Math.PI / 2;
      group.add(band);
      break;
    }
    case 'capuz': {
      const hood = mesh(new THREE.SphereGeometry(r * 1.3, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.75), clothMat);
      hood.position.set(0, headY + r * 0.05, -r * 0.15);
      group.add(hood);
      break;
    }
  }
}

function addMarkings(
  group: THREE.Group,
  appearance: CharacterAppearance,
  headY: number,
  r: number,
  armR: THREE.Group,
): void {
  if (appearance.scarStyle !== 'nenhuma') {
    const scarMat = mat(0x6b3a3a, { roughness: 0.6 });
    const scar = mesh(new THREE.BoxGeometry(r * 0.06, r * 0.34, r * 0.04), scarMat, false);
    const positions: Record<string, [number, number, number]> = {
      olho: [r * 0.5, headY + r * 0.1, r * 0.9],
      bochecha: [r * 0.45, headY - r * 0.2, r * 0.88],
      queixo: [0, headY - r * 0.55, r * 0.85],
    };
    const pos = positions[appearance.scarStyle];
    if (pos) {
      scar.position.set(...pos);
      group.add(scar);
    }
  }

  if (appearance.tattooStyle !== 'nenhuma') {
    const inkMat = mat(0x2a4a6b, { roughness: 0.5 });
    if (appearance.tattooStyle === 'braco') {
      const ring = mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 16), inkMat, false);
      ring.position.set(0, -0.28, 0.02);
      ring.rotation.x = Math.PI / 2;
      armR.add(ring);
    } else {
      const mark = mesh(new THREE.BoxGeometry(r * 0.18, r * 0.18, r * 0.02), inkMat, false);
      mark.position.set(-r * 0.55, headY - r * 0.1, r * 0.75);
      group.add(mark);
    }
  }
}

/**
 * Attaches class weapon/prop meshes. Anything actually held in a hand is
 * parented to that hand's arm-pivot group (in local, hand-relative
 * coordinates) so it swings naturally with attack/block/idle animations;
 * back/chest-mounted props (quiver, halo, wizard hat) stay on `upperBody`.
 */
function addClassAccessory(
  upperBody: THREE.Group,
  accessory: ClassAccessory,
  primary: number,
  secondary: number,
  headY: number,
  shoulderWidth: number,
  armL: THREE.Group,
  armR: THREE.Group,
  shoulderY: number,
): void {
  switch (accessory) {
    case 'sword': {
      const hilt = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 8), mat(0x6b4423));
      hilt.position.set(0, -0.55, 0.05);
      const guard = mesh(new THREE.BoxGeometry(0.2, 0.05, 0.05), mat(0x8a8a8a, { metalness: 0.5 }));
      guard.position.set(0, -0.63, 0.05);
      const blade = mesh(new THREE.BoxGeometry(0.06, 0.62, 0.06), mat(0xcfd6dc, { metalness: 0.6, roughness: 0.3 }));
      blade.position.set(0, -0.96, 0.05);
      armR.add(hilt, guard, blade);
      break;
    }
    case 'staff': {
      const pole = mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), mat(0x6b4423));
      pole.position.set(0, -0.85, 0.05);
      const orb = mesh(new THREE.SphereGeometry(0.09, 10, 8), mat(secondary, { emissive: secondary, emissiveIntensity: 0.7, roughness: 0.2 }));
      orb.position.set(0, -1.4, 0.05);
      armR.add(pole, orb);
      const hat = mesh(new THREE.ConeGeometry(0.24, 0.4, 12), mat(primary));
      hat.position.set(0, headY + 0.28, 0);
      upperBody.add(hat);
      break;
    }
    case 'bow': {
      const x = shoulderWidth + 0.18;
      const bow = mesh(new THREE.TorusGeometry(0.32, 0.02, 6, 16, Math.PI * 1.15), mat(0x6b4423));
      bow.position.set(x, shoulderY - 0.1, 0.1);
      bow.rotation.y = Math.PI / 2;
      bow.rotation.z = Math.PI * 0.075;
      const quiver = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.4, 8), mat(0x5a4430));
      quiver.position.set(-shoulderWidth - 0.05, shoulderY + 0.15, -0.15);
      quiver.rotation.z = 0.3;
      upperBody.add(bow, quiver);
      break;
    }
    case 'cross': {
      const vertical = mesh(new THREE.BoxGeometry(0.06, 0.24, 0.04), mat(0xf2ede1));
      const horizontal = mesh(new THREE.BoxGeometry(0.18, 0.06, 0.04), mat(0xf2ede1));
      vertical.position.set(0, 1.0, 0.24);
      horizontal.position.set(0, 1.06, 0.24);
      const halo = mesh(new THREE.TorusGeometry(0.16, 0.015, 6, 20), mat(0xf2c14e, { emissive: 0xf2c14e, emissiveIntensity: 0.4 }));
      halo.position.set(0, headY + 0.24, 0);
      halo.rotation.x = Math.PI / 2;
      upperBody.add(vertical, horizontal, halo);
      break;
    }
    case 'shield': {
      const shield = mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 12), mat(secondary, { metalness: 0.4 }));
      shield.position.set(0, -0.45, 0.1);
      shield.rotation.z = Math.PI / 2;
      armL.add(shield);

      const hammerHandle = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), mat(0x6b4423));
      hammerHandle.position.set(0, -0.75, 0.05);
      const hammerHead = mesh(new THREE.BoxGeometry(0.2, 0.14, 0.14), mat(0x8a8a8a, { metalness: 0.5 }));
      hammerHead.position.set(0, -1.05, 0.05);
      armR.add(hammerHandle, hammerHead);
      break;
    }
    case 'dagger': {
      const hilt = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.1, 8), mat(0x2a2a2a));
      hilt.position.set(0, -0.55, 0.08);
      const blade = mesh(new THREE.BoxGeometry(0.04, 0.32, 0.04), mat(0xcfd6dc, { metalness: 0.6 }));
      blade.position.set(0, -0.75, 0.08);
      armR.add(hilt, blade);
      break;
    }
    case 'grimoire': {
      const book = mesh(new THREE.BoxGeometry(0.2, 0.26, 0.05), mat(secondary));
      book.position.set(0, -0.35, 0.15);
      book.rotation.x = -0.5;
      const glow = mesh(new THREE.SphereGeometry(0.05, 8, 8), mat(0x6bff8e, { emissive: 0x2fae4e, emissiveIntensity: 0.8 }), false);
      glow.position.set(0, -0.3, 0.2);
      armL.add(book, glow);
      break;
    }
    case 'fists': {
      const wrapL = mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12), mat(secondary));
      wrapL.position.set(0, -0.5, 0.05);
      armL.add(wrapL);
      const wrapR = mesh(new THREE.TorusGeometry(0.09, 0.025, 6, 12), mat(secondary));
      wrapR.position.set(0, -0.5, 0.05);
      armR.add(wrapR);
      break;
    }
    case 'none':
      break;
  }
}

// --- convenience wrappers ------------------------------------------------

export function buildClassPreview(classId: string): THREE.Group {
  const def = getClassById(classId);
  const appearance = defaultAppearance(def.color, def.accentColor);
  return buildHumanCharacter(appearance, CLASS_ACCESSORY[classId] ?? 'none');
}

export function buildPlayerCharacter(player: Player): THREE.Group {
  return buildHumanCharacter(player.appearance, CLASS_ACCESSORY[player.classId] ?? 'none');
}

// --- enemy creature builders ----------------------------------------------

function buildSlime(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMesh = mesh(new THREE.SphereGeometry(0.32, 14, 10), mat(color, { roughness: 0.35, metalness: 0.1 }));
  bodyMesh.scale.set(1.15, 0.65, 1.15);
  bodyMesh.position.y = 0.21;
  group.add(bodyMesh);
  addBeadyEyes(group, 0.26, 0.27, 0.1, 0.03);
  return group;
}

function buildBat(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMesh = mesh(new THREE.SphereGeometry(0.16, 10, 8), mat(color));
  group.add(bodyMesh);
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
  addBeadyEyes(group, 0.14, 0.02, 0.05, 0.025, 0xff5555);
  return group;
}

/** A generic small-to-large humanoid monster (goblin, bandit, orc, skeleton, troll). */
function buildHumanoidMonster(color: number, scale: number, skinColor = color): THREE.Group {
  const appearance = defaultAppearance(color, 0x3a3a3a);
  appearance.skinTone = skinColor;
  appearance.hairStyle = 'careca';
  appearance.facialHair = 'nenhuma';
  appearance.headAccessory = 'nenhum';
  appearance.eyeColor = 0xffe08a;
  appearance.bodyType = scale > 1.1 ? 'robusto' : 'atletico';
  const group = buildHumanCharacter(appearance, 'none');
  group.scale.setScalar(scale);
  return group;
}

/** A four-legged body for wolves and similar beasts. */
function buildQuadruped(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = mat(color);

  const bodyMesh = mesh(new THREE.CapsuleGeometry(0.2, 0.5, 4, 8), bodyMat);
  bodyMesh.rotation.z = Math.PI / 2;
  bodyMesh.position.set(0, 0.34, 0);
  group.add(bodyMesh);

  const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8);
  const legPositions: Array<[number, number]> = [
    [-0.28, 0.15], [0.28, 0.15], [-0.28, -0.15], [0.28, -0.15],
  ];
  for (const [x, z] of legPositions) {
    const leg = mesh(legGeo, bodyMat);
    leg.position.set(x, 0.15, z);
    group.add(leg);
  }

  const head = mesh(new THREE.BoxGeometry(0.22, 0.2, 0.24), bodyMat);
  head.position.set(0.34, 0.42, 0);
  group.add(head);

  const earGeo = new THREE.ConeGeometry(0.05, 0.12, 8);
  const earL = mesh(earGeo, bodyMat);
  const earR = mesh(earGeo, bodyMat);
  earL.position.set(0.34, 0.56, 0.08);
  earR.position.set(0.34, 0.56, -0.08);
  group.add(earL, earR);

  const tail = mesh(new THREE.ConeGeometry(0.06, 0.35, 8), bodyMat);
  tail.position.set(-0.42, 0.4, 0);
  tail.rotation.z = -Math.PI / 2.4;
  group.add(tail);

  addBeadyEyes(group, 0.44, 0.44, 0.1, 0.02, 0xffe08a);
  return group;
}

function buildSpider(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = mat(color, { roughness: 0.6 });
  const abdomen = mesh(new THREE.SphereGeometry(0.26, 12, 10), bodyMat);
  abdomen.position.set(-0.1, 0.3, 0);
  const head = mesh(new THREE.SphereGeometry(0.15, 10, 8), bodyMat);
  head.position.set(0.28, 0.3, 0);
  group.add(abdomen, head);

  const legGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.42, 6);
  for (let i = 0; i < 4; i++) {
    const side = i < 2 ? -1 : 1;
    const offset = (i % 2) * 0.18 - 0.05;
    const leg = mesh(legGeo, bodyMat);
    leg.position.set(offset, 0.22, side * 0.32);
    leg.rotation.z = side * 0.9;
    leg.rotation.x = (i % 2 === 0 ? 1 : -1) * 0.3;
    group.add(leg);
  }
  addBeadyEyes(group, 0.14, 0.34, 0.13, 0.02, 0xff3333);
  return group;
}

function buildFlameBlob(color: number): THREE.Group {
  const group = new THREE.Group();
  const coreMat = mat(color, { emissive: color, emissiveIntensity: 0.6, roughness: 0.4 });
  const core = mesh(new THREE.SphereGeometry(0.28, 12, 10), coreMat);
  core.position.y = 0.32;
  group.add(core);
  const spikeMat = mat(0xffcf4e, { emissive: 0xff8c1a, emissiveIntensity: 0.7 });
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const spike = mesh(new THREE.ConeGeometry(0.08, 0.28, 8), spikeMat, false);
    spike.position.set(Math.cos(angle) * 0.2, 0.5, Math.sin(angle) * 0.2);
    spike.rotation.x = Math.cos(angle) * 0.4;
    spike.rotation.z = -Math.sin(angle) * 0.4;
    group.add(spike);
  }
  addBeadyEyes(group, 0.3, 0.34, 0.1, 0.03, 0xffffff);
  return group;
}

function buildGolem(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = mat(color, { roughness: 0.95 });
  const legGeo = new THREE.BoxGeometry(0.18, 0.4, 0.18);
  const legL = mesh(legGeo, bodyMat);
  const legR = mesh(legGeo, bodyMat);
  legL.position.set(-0.14, 0.2, 0);
  legR.position.set(0.14, 0.2, 0);
  group.add(legL, legR);

  const torso = mesh(new THREE.BoxGeometry(0.56, 0.5, 0.32), bodyMat);
  torso.position.set(0, 0.66, 0);
  group.add(torso);

  const armGeo = new THREE.BoxGeometry(0.16, 0.46, 0.16);
  const armL = mesh(armGeo, bodyMat);
  const armR = mesh(armGeo, bodyMat);
  armL.position.set(-0.36, 0.6, 0);
  armR.position.set(0.36, 0.6, 0);
  group.add(armL, armR);

  const head = mesh(new THREE.BoxGeometry(0.24, 0.22, 0.24), bodyMat);
  head.position.set(0, 1.02, 0);
  group.add(head);
  addBeadyEyes(group, 1.02, 0.12, 0.12, 0.03, 0x8ec9ff);
  return group;
}

function buildDragon(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = mat(color, { roughness: 0.6 });
  const body = mesh(new THREE.CapsuleGeometry(0.34, 0.7, 4, 10), bodyMat);
  body.rotation.z = Math.PI / 2;
  body.position.set(0, 0.55, 0);
  group.add(body);

  const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.4, 8);
  const legPositions: Array<[number, number]> = [
    [-0.4, 0.2], [0.4, 0.2], [-0.4, -0.2], [0.4, -0.2],
  ];
  for (const [x, z] of legPositions) {
    const leg = mesh(legGeo, bodyMat);
    leg.position.set(x, 0.2, z);
    group.add(leg);
  }

  const neck = mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.4, 8), bodyMat);
  neck.position.set(0.5, 0.85, 0);
  neck.rotation.z = -0.6;
  group.add(neck);

  const head = mesh(new THREE.ConeGeometry(0.2, 0.5, 8), bodyMat);
  head.position.set(0.78, 1.1, 0);
  head.rotation.z = -1.6;
  group.add(head);

  const wingMat = mat(color, { roughness: 0.5, transparent: true, opacity: 0.92 });
  const wingGeo = new THREE.ConeGeometry(0.5, 0.8, 3);
  const wingL = mesh(wingGeo, wingMat);
  const wingR = mesh(wingGeo, wingMat);
  wingL.position.set(-0.1, 0.9, 0.35);
  wingR.position.set(-0.1, 0.9, -0.35);
  wingL.rotation.set(Math.PI / 2, 0, 0.3);
  wingR.rotation.set(-Math.PI / 2, 0, -0.3);
  group.add(wingL, wingR);

  const tail = mesh(new THREE.ConeGeometry(0.14, 0.7, 8), bodyMat);
  tail.position.set(-0.75, 0.5, 0);
  tail.rotation.z = Math.PI / 2;
  group.add(tail);

  addBeadyEyes(group, 1.12, 0.9, 0.16, 0.03, 0xffcf4e);
  group.scale.setScalar(1.6);
  return group;
}

function addBeadyEyes(group: THREE.Group, x: number, y: number, z: number, size: number, color = 0x1a1423): void {
  const eyeMat = mat(color, { emissive: color === 0x1a1423 ? 0 : color, emissiveIntensity: color === 0x1a1423 ? 0 : 0.5 });
  const eyeGeo = new THREE.SphereGeometry(size, 6, 6);
  const eyeL = mesh(eyeGeo, eyeMat, false);
  const eyeR = mesh(eyeGeo, eyeMat, false);
  eyeL.position.set(-x * 0.25, y, z);
  eyeR.position.set(x * 0.25, y, z);
  group.add(eyeL, eyeR);
}

// --- mounts ------------------------------------------------------------

/** A friendly long-necked pack animal — the ground mount. */
function buildLlama(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = mat(color, { roughness: 0.85 });

  const body = mesh(new THREE.CapsuleGeometry(0.24, 0.5, 4, 8), bodyMat);
  body.rotation.z = Math.PI / 2;
  body.position.set(0, 0.5, 0);
  group.add(body);

  const legGeo = new THREE.CylinderGeometry(0.07, 0.06, 0.42, 8);
  const legPositions: Array<[number, number]> = [
    [-0.28, 0.16], [0.28, 0.16], [-0.28, -0.16], [0.28, -0.16],
  ];
  for (const [x, z] of legPositions) {
    const leg = mesh(legGeo, bodyMat);
    leg.position.set(x, 0.21, z);
    group.add(leg);
  }

  const neck = mesh(new THREE.CylinderGeometry(0.1, 0.15, 0.55, 8), bodyMat);
  neck.position.set(0.32, 0.95, 0);
  neck.rotation.z = -0.5;
  group.add(neck);

  const head = mesh(new THREE.BoxGeometry(0.16, 0.2, 0.22), bodyMat);
  head.position.set(0.52, 1.25, 0);
  group.add(head);

  const earGeo = new THREE.ConeGeometry(0.04, 0.14, 6);
  const earL = mesh(earGeo, bodyMat);
  const earR = mesh(earGeo, bodyMat);
  earL.position.set(0.52, 1.4, 0.06);
  earR.position.set(0.52, 1.4, -0.06);
  group.add(earL, earR);

  addBeadyEyes(group, 1.28, 0.6, 0.12, 0.025, 0x1a1423);

  const tail = mesh(new THREE.ConeGeometry(0.06, 0.2, 6), bodyMat);
  tail.position.set(-0.42, 0.75, 0);
  tail.rotation.z = -Math.PI / 2.6;
  group.add(tail);

  return group;
}

/** A great bird mount, wings spread wide — the flying mount. */
function buildCondor(color: number): THREE.Group {
  const group = new THREE.Group();
  const bodyMat = mat(color, { roughness: 0.7 });

  const body = mesh(new THREE.CapsuleGeometry(0.2, 0.4, 4, 8), bodyMat);
  body.rotation.z = Math.PI / 2;
  body.position.set(0, 0, 0);
  group.add(body);

  const wingGeo = new THREE.BoxGeometry(0.85, 0.04, 0.32);
  const wingMat = mat(color, { roughness: 0.6 });
  const wingL = mesh(wingGeo, wingMat);
  const wingR = mesh(wingGeo, wingMat);
  wingL.position.set(0, 0.05, 0.45);
  wingR.position.set(0, 0.05, -0.45);
  wingL.rotation.x = -0.25;
  wingR.rotation.x = 0.25;
  group.add(wingL, wingR);
  group.userData.wings = [wingL, wingR];

  const neck = mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 8), bodyMat);
  neck.position.set(0.28, 0.14, 0);
  neck.rotation.z = -0.7;
  group.add(neck);

  const head = mesh(new THREE.SphereGeometry(0.12, 10, 8), mat(0xe8e0d0, { roughness: 0.7 }));
  head.position.set(0.44, 0.3, 0);
  group.add(head);

  const beak = mesh(new THREE.ConeGeometry(0.045, 0.16, 8), mat(0xd97a2e));
  beak.position.set(0.58, 0.28, 0);
  beak.rotation.z = -Math.PI / 2;
  group.add(beak);

  addBeadyEyes(group, 0.42, 0.34, 0.09, 0.02, 0xffcf4e);

  const tail = mesh(new THREE.BoxGeometry(0.34, 0.03, 0.18), bodyMat);
  tail.position.set(-0.36, -0.02, 0);
  group.add(tail);

  return group;
}

export function buildMountModel(mountId: string, color: number): THREE.Group {
  switch (mountId) {
    case 'llama':
      return buildLlama(color);
    case 'condor':
      return buildCondor(color);
    default:
      return buildLlama(color);
  }
}

export function buildEnemyModel(enemyId: string, color: number): THREE.Group {
  switch (enemyId) {
    case 'slime':
      return buildSlime(color);
    case 'bat':
      return buildBat(color);
    case 'goblin':
      return buildHumanoidMonster(color, 0.8, 0x8faa5a);
    case 'bandit':
      return buildHumanoidMonster(color, 0.95, 0xd2a679);
    case 'dark_wolf':
      return buildQuadruped(color);
    case 'skeleton':
      return buildHumanoidMonster(color, 0.95, 0xd8d0c0);
    case 'giant_spider':
      return buildSpider(color);
    case 'orc':
      return buildHumanoidMonster(color, 1.15, 0x6a8a4a);
    case 'fire_elemental':
      return buildFlameBlob(color);
    case 'troll':
      return buildHumanoidMonster(color, 1.35, 0x7a8a7a);
    case 'stone_golem':
      return buildGolem(color);
    case 'young_dragon':
      return buildDragon(color);
    default:
      return buildSlime(color);
  }
}

export function allEnemyIds(): string[] {
  return ENEMY_DEFINITIONS.map((e) => e.id);
}
