import * as THREE from 'three';
import { TILE_SIZE } from '../config/gameConfig';
import type { BuildingKind, BuildingPlacement, Signage } from '../systems/MapGenerator';

/**
 * Low-poly geometry for the hand-placed city layer — named storefronts and
 * street props (see MapGenerator's `BuildingKind` doc comment) — in the same
 * flat-shaded primitive style as `worldBuilder.ts`'s houses and trees.
 *
 * Repeated props (lamps, banners, crates, ...) are instanced per part exactly
 * like the houses are; each storefront is unique (its own sign, awning color
 * and trade props), so those are ordinary meshes — there are only a handful.
 *
 * Everything faces NORTH (-z): the follow-camera's yaw is fixed looking
 * south (OverworldScreen's CAMERA_YAW), so a storefront's sign/counter or a
 * notice board's papers only read on screen from that side.
 */

/** Kinds this module renders — `worldBuilder.ts` routes these here and renders the rest itself. */
export const CITY_PROP_KINDS: ReadonlySet<BuildingKind> = new Set<BuildingKind>([
  'shop',
  'fountain',
  'lamp',
  'banner',
  'crates',
  'well',
  'shrine',
  'noticeboard',
  'campfire',
]);

/**
 * How much (world units) each small prop's collider is trimmed in from its
 * 1-tile (or 3-tile) footprint on every side — a lamp post shouldn't block a
 * whole 2x2m square — and none of these push the follow-camera around (see
 * `BuildingCollider.blocksCamera`): they're all well below its height, and a
 * plaza full of them would otherwise keep shoving it about. A storefront is
 * a full building, so it isn't listed: full footprint, blocks the camera.
 */
export const PROP_COLLIDER_INSET: Partial<Record<BuildingKind, number>> = {
  fountain: 0.3,
  lamp: 0.75,
  banner: 0.8,
  crates: 0.25,
  well: 0.3,
  shrine: 0.4,
  noticeboard: 0.25,
  campfire: 0.45,
};

interface SignageStyle {
  label: string;
  awning: number;
}

const SIGNAGE_STYLE: Record<Signage, SignageStyle> = {
  ferreiro: { label: 'FORJA', awning: 0x8a2f1f },
  tecelao: { label: 'TECELAGEM', awning: 0x2f5fa8 },
  boticario: { label: 'BOTICA', awning: 0x3f8a4a },
  joalheiro: { label: 'JOALHERIA', awning: 0x7a4fb3 },
  artesao: { label: 'ARTESANATO', awning: 0xc7862f },
  estalagem: { label: 'ESTALAGEM', awning: 0x9a6a3a },
  armazem: { label: 'ARMAZÉM', awning: 0x5f646b },
};

function std(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
}

function glow(color: number, intensity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.6 });
}

function worldCenter(b: BuildingPlacement): { x: number; z: number } {
  return { x: (b.x + b.w / 2) * TILE_SIZE, z: (b.y + b.h / 2) * TILE_SIZE };
}

// --- instanced props -------------------------------------------------------

interface PropPart {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  /** Local offset from the placement's world center. */
  pos: [number, number, number];
  rot?: [number, number, number];
  scale?: [number, number, number];
  shadow?: boolean;
}

function addInstancedParts(group: THREE.Group, placements: BuildingPlacement[], parts: PropPart[]): void {
  if (placements.length === 0) return;
  const m = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  for (const part of parts) {
    const inst = new THREE.InstancedMesh(part.geo, part.mat, placements.length);
    inst.castShadow = part.shadow ?? true;
    inst.receiveShadow = true;
    q.setFromEuler(e.set(...(part.rot ?? [0, 0, 0])));
    local.compose(new THREE.Vector3(...part.pos), q, new THREE.Vector3(...(part.scale ?? [1, 1, 1])));
    placements.forEach((b, i) => {
      const { x, z } = worldCenter(b);
      m.makeTranslation(x, 0, z).multiply(local);
      inst.setMatrixAt(i, m);
    });
    group.add(inst);
  }
}

const WOOD = 0x6b4a2e;
const DARK_WOOD = 0x3e2a1a;
const STONE = 0x9a948a;
const IRON = 0x2e2e33;

function fountainParts(): PropPart[] {
  const stone = std(0xb3ab9c);
  const water = new THREE.MeshStandardMaterial({ color: 0x4a8ac2, emissive: 0x1c4f7a, emissiveIntensity: 0.35, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 });
  return [
    { geo: new THREE.CylinderGeometry(2.45, 2.65, 0.55, 24), mat: stone, pos: [0, 0.275, 0] },
    { geo: new THREE.TorusGeometry(2.45, 0.16, 6, 28), mat: stone, pos: [0, 0.56, 0], rot: [Math.PI / 2, 0, 0] },
    { geo: new THREE.CylinderGeometry(2.3, 2.3, 0.05, 24), mat: water, pos: [0, 0.5, 0], shadow: false },
    { geo: new THREE.CylinderGeometry(0.32, 0.48, 1.5, 10), mat: stone, pos: [0, 1.0, 0] },
    { geo: new THREE.CylinderGeometry(0.85, 0.35, 0.3, 14), mat: stone, pos: [0, 1.85, 0] },
    { geo: new THREE.CylinderGeometry(0.74, 0.74, 0.04, 14), mat: water, pos: [0, 1.99, 0], shadow: false },
    // An Ipê blossom carved in gold-painted stone crowning the fountain — the
    // town's own emblem, since Pedravale is named for its founding grove.
    { geo: new THREE.IcosahedronGeometry(0.3, 0), mat: std(0xe8c13a, { flatShading: true, emissive: 0x4a3a08, emissiveIntensity: 0.4 }), pos: [0, 2.35, 0] },
  ];
}

function lampParts(): PropPart[] {
  const iron = std(IRON, { roughness: 0.6, metalness: 0.3 });
  return [
    { geo: new THREE.CylinderGeometry(0.16, 0.2, 0.2, 8), mat: iron, pos: [0, 0.1, 0] },
    { geo: new THREE.CylinderGeometry(0.055, 0.08, 2.4, 6), mat: iron, pos: [0, 1.3, 0] },
    { geo: new THREE.BoxGeometry(0.3, 0.38, 0.3), mat: glow(0xffc766, 1.1), pos: [0, 2.68, 0], shadow: false },
    { geo: new THREE.ConeGeometry(0.27, 0.24, 4), mat: iron, pos: [0, 3.0, 0], rot: [0, Math.PI / 4, 0] },
  ];
}

function bannerParts(): PropPart[] {
  const wood = std(DARK_WOOD);
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2f6b3f, roughness: 0.9, side: THREE.DoubleSide });
  const emblem = new THREE.MeshStandardMaterial({ color: 0xe0b23a, roughness: 0.7, side: THREE.DoubleSide });
  return [
    { geo: new THREE.CylinderGeometry(0.05, 0.06, 3.4, 6), mat: wood, pos: [0, 1.7, 0] },
    { geo: new THREE.BoxGeometry(0.95, 0.05, 0.05), mat: wood, pos: [0, 3.2, 0] },
    { geo: new THREE.IcosahedronGeometry(0.09, 0), mat: emblem, pos: [0, 3.46, 0] },
    { geo: new THREE.PlaneGeometry(0.85, 1.6), mat: cloth, pos: [0, 2.37, -0.04], rot: [0, Math.PI, 0] },
    // Gold diamond on the north (camera-facing) side of the cloth.
    { geo: new THREE.PlaneGeometry(0.34, 0.34), mat: emblem, pos: [0, 2.5, -0.06], rot: [0, Math.PI, Math.PI / 4], shadow: false },
  ];
}

function cratesParts(): PropPart[] {
  const wood = std(0x8a6a45);
  const dark = std(0x5a4128);
  return [
    { geo: new THREE.BoxGeometry(0.75, 0.75, 0.75), mat: wood, pos: [-0.22, 0.375, 0.1] },
    { geo: new THREE.BoxGeometry(0.55, 0.55, 0.55), mat: wood, pos: [0.36, 0.275, -0.22], rot: [0, 0.45, 0] },
    { geo: new THREE.BoxGeometry(0.5, 0.5, 0.5), mat: dark, pos: [-0.2, 1.0, 0.1], rot: [0, 0.3, 0] },
    { geo: new THREE.CylinderGeometry(0.27, 0.27, 0.72, 10), mat: dark, pos: [0.4, 0.36, 0.38] },
  ];
}

function wellParts(): PropPart[] {
  const stone = std(STONE);
  const wood = std(WOOD);
  return [
    { geo: new THREE.CylinderGeometry(0.72, 0.8, 0.65, 14), mat: stone, pos: [0, 0.325, 0] },
    { geo: new THREE.CylinderGeometry(0.6, 0.6, 0.03, 14), mat: std(0x1c3a55, { roughness: 0.2 }), pos: [0, 0.66, 0], shadow: false },
    { geo: new THREE.BoxGeometry(0.1, 1.5, 0.1), mat: wood, pos: [-0.62, 1.1, 0] },
    { geo: new THREE.BoxGeometry(0.1, 1.5, 0.1), mat: wood, pos: [0.62, 1.1, 0] },
    { geo: new THREE.BoxGeometry(1.4, 0.08, 0.08), mat: wood, pos: [0, 1.78, 0] },
    { geo: new THREE.ConeGeometry(1.0, 0.55, 4), mat: std(0x7a4a2e, { flatShading: true }), pos: [0, 2.12, 0], rot: [0, Math.PI / 4, 0] },
    { geo: new THREE.CylinderGeometry(0.12, 0.1, 0.2, 8), mat: std(0x5a4128), pos: [0, 1.3, 0] },
  ];
}

function shrineParts(): PropPart[] {
  const stone = std(0xb3ab9c);
  // The founding Ipê — mostly dull, dry leaves this year (the Sede; see
  // LORE.md / Elira's and Mira's own dialogue about the Ipês not flowering),
  // with only a handful of stubborn yellow blossoms left on it.
  const leaves = std(0x7c8a42, { flatShading: true });
  const blossom = std(0xf2c81e, { flatShading: true, emissive: 0x5a4200, emissiveIntensity: 0.5 });
  const candle = glow(0xffd98a, 0.9);
  const lobe = new THREE.IcosahedronGeometry(0.42, 1);
  const bud = new THREE.IcosahedronGeometry(0.11, 0);
  const wick = new THREE.CylinderGeometry(0.04, 0.04, 0.14, 6);
  return [
    { geo: new THREE.BoxGeometry(1.15, 0.45, 1.15), mat: stone, pos: [0, 0.225, 0] },
    { geo: new THREE.CylinderGeometry(0.09, 0.15, 1.5, 7), mat: std(0x5a3a22), pos: [0, 1.2, 0] },
    { geo: lobe, mat: leaves, pos: [0, 2.1, 0] },
    { geo: lobe, mat: leaves, pos: [0.36, 1.92, 0.14], scale: [0.8, 0.8, 0.8] },
    { geo: lobe, mat: leaves, pos: [-0.32, 1.9, -0.18], scale: [0.78, 0.78, 0.78] },
    { geo: bud, mat: blossom, pos: [0.12, 2.45, -0.3], shadow: false },
    { geo: bud, mat: blossom, pos: [-0.35, 2.12, -0.35], shadow: false },
    { geo: bud, mat: blossom, pos: [0.55, 1.95, -0.2], shadow: false },
    { geo: bud, mat: blossom, pos: [-0.1, 1.75, -0.42], shadow: false },
    { geo: wick, mat: candle, pos: [-0.42, 0.52, -0.42], shadow: false },
    { geo: wick, mat: candle, pos: [0.42, 0.52, -0.42], shadow: false },
  ];
}

function noticeboardParts(): PropPart[] {
  const wood = std(WOOD);
  const paper = new THREE.MeshStandardMaterial({ color: 0xefe6cf, roughness: 0.95, side: THREE.DoubleSide });
  const note = new THREE.PlaneGeometry(0.3, 0.38);
  // Papers face north (-z): Plane faces +z by default, so turn it around.
  return [
    { geo: new THREE.BoxGeometry(0.1, 1.9, 0.1), mat: wood, pos: [-0.62, 0.95, 0] },
    { geo: new THREE.BoxGeometry(0.1, 1.9, 0.1), mat: wood, pos: [0.62, 0.95, 0] },
    { geo: new THREE.BoxGeometry(1.4, 0.95, 0.08), mat: std(0x8a6a45), pos: [0, 1.4, 0] },
    { geo: new THREE.BoxGeometry(1.6, 0.08, 0.34), mat: std(DARK_WOOD), pos: [0, 1.95, 0] },
    { geo: note, mat: paper, pos: [-0.34, 1.52, -0.05], rot: [0, Math.PI, 0.08], shadow: false },
    { geo: note, mat: paper, pos: [0.3, 1.5, -0.05], rot: [0, Math.PI, -0.12], shadow: false },
    { geo: note, mat: paper, pos: [-0.05, 1.22, -0.05], rot: [0, Math.PI, 0.03], shadow: false },
  ];
}

function campfireParts(): PropPart[] {
  const stoneGeo = new THREE.DodecahedronGeometry(0.13, 0);
  const stone = std(0x77716a, { flatShading: true });
  const stones: PropPart[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    stones.push({ geo: stoneGeo, mat: stone, pos: [Math.cos(a) * 0.4, 0.08, Math.sin(a) * 0.4], rot: [0, a, 0] });
  }
  const log = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 6);
  const logMat = std(0x4a3020);
  return [
    ...stones,
    { geo: log, mat: logMat, pos: [0, 0.1, 0], rot: [0, Math.PI / 4, Math.PI / 2] },
    { geo: log, mat: logMat, pos: [0, 0.12, 0], rot: [0, -Math.PI / 4, Math.PI / 2] },
    { geo: new THREE.ConeGeometry(0.24, 0.62, 7), mat: glow(0xff6a1a, 1.3), pos: [0, 0.42, 0], shadow: false },
    { geo: new THREE.ConeGeometry(0.13, 0.42, 6), mat: glow(0xffd24a, 1.4), pos: [0, 0.36, 0], shadow: false },
  ];
}

// --- storefronts -------------------------------------------------------------

function signTexture(label: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 112;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#3a2716';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#c9a25a';
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
  ctx.fillStyle = '#f3e3b8';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 64;
  ctx.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
  while (ctx.measureText(label).width > canvas.width - 48 && size > 24) {
    size -= 4;
    ctx.font = `bold ${size}px Georgia, 'Times New Roman', serif`;
  }
  ctx.fillText(label, canvas.width / 2, canvas.height / 2 + 4);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Adds a mesh to `parent` at a local position/rotation — keeps the storefront builders below readable. */
function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rot?: [number, number, number], shadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  if (rot) mesh.rotation.set(...rot);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/**
 * The trade props out front of each storefront, under its awning — local
 * frame with the front toward +z (the whole storefront group is turned to
 * face north afterwards), the counter zone spanning z ~1.7..2.7.
 */
function addTradeProps(g: THREE.Group, signage: Signage): void {
  const wood = std(0x8a6a45);
  const dark = std(DARK_WOOD);
  switch (signage) {
    case 'ferreiro': {
      // Forge hearth with glowing coals, and an anvil on its stump.
      put(g, new THREE.BoxGeometry(1.1, 0.8, 0.9), std(0x6f6960, { flatShading: true }), -1.15, 0.4, 2.0);
      put(g, new THREE.BoxGeometry(0.85, 0.06, 0.65), glow(0xff6a1a, 1.4), -1.15, 0.83, 2.0, undefined, false);
      put(g, new THREE.CylinderGeometry(0.24, 0.28, 0.45, 8), dark, 0.9, 0.225, 2.2);
      put(g, new THREE.BoxGeometry(0.72, 0.22, 0.3), std(IRON, { metalness: 0.5, roughness: 0.45 }), 0.9, 0.56, 2.2);
      put(g, new THREE.ConeGeometry(0.1, 0.32, 6), std(IRON, { metalness: 0.5, roughness: 0.45 }), 1.42, 0.58, 2.2, [0, 0, -Math.PI / 2]);
      break;
    }
    case 'tecelao': {
      // A loom with cloth on it, and bolts of dyed cloth.
      put(g, new THREE.BoxGeometry(0.08, 1.5, 0.08), dark, 0.25, 0.75, 2.2);
      put(g, new THREE.BoxGeometry(0.08, 1.5, 0.08), dark, 1.75, 0.75, 2.2);
      put(g, new THREE.BoxGeometry(1.6, 0.08, 0.08), dark, 1.0, 1.48, 2.2);
      put(g, new THREE.PlaneGeometry(1.3, 1.05), new THREE.MeshStandardMaterial({ color: 0xa8323a, roughness: 0.95, side: THREE.DoubleSide }), 1.0, 0.9, 2.24, undefined, false);
      const bolt = new THREE.CylinderGeometry(0.14, 0.14, 0.95, 10);
      put(g, bolt, std(0x2f5fa8), -1.2, 0.14, 2.1, [0, 0, Math.PI / 2]);
      put(g, bolt, std(0xe0b23a), -1.2, 0.14, 2.42, [0, 0, Math.PI / 2]);
      put(g, bolt, std(0x3f8a4a), -1.2, 0.41, 2.26, [0, 0, Math.PI / 2]);
      break;
    }
    case 'boticario': {
      // A bubbling cauldron, and a counter of potion bottles.
      put(g, new THREE.CylinderGeometry(0.42, 0.34, 0.5, 12), std(IRON, { roughness: 0.5 }), 1.0, 0.3, 2.15);
      put(g, new THREE.CylinderGeometry(0.37, 0.37, 0.04, 12), glow(0x5ad86a, 0.9), 1.0, 0.54, 2.15, undefined, false);
      put(g, new THREE.BoxGeometry(1.5, 0.85, 0.55), wood, -1.0, 0.425, 2.1);
      const bottle = new THREE.CylinderGeometry(0.07, 0.08, 0.24, 8);
      [0xd83a3a, 0x3a6ad8, 0x3ad86a, 0xd83aa8].forEach((c, i) => {
        put(g, bottle, glow(c, 0.45), -1.5 + i * 0.33, 0.97, 2.05, undefined, false);
      });
      break;
    }
    case 'joalheiro': {
      // A glass-topped display counter of cut gems, and a small strongbox.
      put(g, new THREE.BoxGeometry(2.2, 0.9, 0.6), dark, 0.3, 0.45, 2.1);
      put(g, new THREE.BoxGeometry(2.1, 0.05, 0.5), new THREE.MeshStandardMaterial({ color: 0xcfe8f5, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.45 }), 0.3, 0.93, 2.1, undefined, false);
      const gem = new THREE.OctahedronGeometry(0.1, 0);
      [0xd8323f, 0x2f6fd8, 0x2fa85a, 0xe0b23a, 0x8a4fd8].forEach((c, i) => {
        put(g, gem, glow(c, 0.7), -0.5 + i * 0.4, 1.06, 2.1, [0, i * 0.5, 0], false);
      });
      put(g, new THREE.BoxGeometry(0.55, 0.4, 0.4), std(0x6b4a2e), -1.6, 0.2, 2.2);
      break;
    }
    case 'artesao': {
      // A workbench of rings and amulets, a strung bow and a carved staff.
      put(g, new THREE.BoxGeometry(1.9, 0.8, 0.7), wood, 0.55, 0.4, 2.1);
      const ring = new THREE.TorusGeometry(0.1, 0.03, 6, 12);
      put(g, ring, std(0xe0b23a, { metalness: 0.6, roughness: 0.35 }), 0.1, 0.83, 2.05, [Math.PI / 2, 0, 0], false);
      put(g, ring, std(0xcfd6dc, { metalness: 0.6, roughness: 0.35 }), 0.45, 0.83, 2.15, [Math.PI / 2, 0, 0], false);
      put(g, new THREE.IcosahedronGeometry(0.08, 0), glow(0x2fa85a, 0.6), 0.9, 0.86, 2.05, undefined, false);
      put(g, new THREE.CylinderGeometry(0.04, 0.05, 1.7, 6), std(0x5a3a22), -1.5, 0.85, 2.45, [0.18, 0, 0.12]);
      // An unstrung bow hung upright on the post: the torus arc, centered on +x.
      put(g, new THREE.TorusGeometry(0.55, 0.035, 6, 16, Math.PI * 0.85), std(0x6b4423), -0.95, 1.05, 2.5, [0, 0, -(Math.PI * 0.85) / 2]);
      break;
    }
    case 'estalagem': {
      // A bench and ale barrels by the door, under a hanging lantern.
      put(g, new THREE.BoxGeometry(1.6, 0.1, 0.42), wood, 0.95, 0.45, 2.3);
      put(g, new THREE.BoxGeometry(0.1, 0.45, 0.35), dark, 0.3, 0.22, 2.3);
      put(g, new THREE.BoxGeometry(0.1, 0.45, 0.35), dark, 1.6, 0.22, 2.3);
      const barrel = new THREE.CylinderGeometry(0.3, 0.3, 0.8, 10);
      put(g, barrel, dark, -1.45, 0.4, 2.15);
      put(g, barrel, dark, -0.8, 0.4, 2.4);
      put(g, new THREE.BoxGeometry(0.22, 0.3, 0.22), glow(0xffc766, 1.1), 0, 1.55, 2.62, undefined, false);
      break;
    }
    case 'armazem': {
      // Stacked crates and grain sacks waiting to go inside.
      const crate = new THREE.BoxGeometry(0.8, 0.8, 0.8);
      put(g, crate, wood, -1.3, 0.4, 2.1);
      put(g, crate, std(0x7a5a38), -1.3, 1.2, 2.1, [0, 0.25, 0]);
      put(g, crate, wood, 1.3, 0.4, 2.2, [0, -0.2, 0]);
      const sack = new THREE.SphereGeometry(0.34, 8, 6);
      put(g, sack, std(0xc9b07a), 0.2, 0.28, 2.3, undefined, true).scale.set(1, 0.8, 1);
      put(g, sack, std(0xb89c66), 0.6, 0.28, 2.05, undefined, true).scale.set(1, 0.8, 1);
      break;
    }
  }
}

/** One named storefront: a walled shop with a gable roof, a lit window, a painted sign, a colored awning on posts, and its trade's props out front. */
function buildStorefront(b: BuildingPlacement, accentColor: number): THREE.Group {
  const signage = b.signage ?? 'armazem';
  const style = SIGNAGE_STYLE[signage];
  const g = new THREE.Group();

  const wallColor = new THREE.Color(0xd8c9a3).lerp(new THREE.Color(accentColor), 0.12);
  const walls = new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.9 });
  const timber = std(DARK_WOOD);
  const awning = std(style.awning, { flatShading: true, roughness: 0.7 });
  const awningEdge = std(new THREE.Color(style.awning).multiplyScalar(0.72).getHex(), { roughness: 0.7 });

  // Body: set back so its front wall sits at z=1.2, leaving the front strip
  // of the 6x6m footprint for the awning and counter.
  const bodyDepth = 3.8;
  const bodyZ = 1.2 - bodyDepth / 2;
  put(g, new THREE.BoxGeometry(4.8, 2.8, bodyDepth), walls, 0, 1.4, bodyZ);
  // Timber corner posts, so it reads as a proper half-timbered shop, not a box.
  const post = new THREE.BoxGeometry(0.18, 2.8, 0.18);
  for (const px of [-2.36, 2.36]) put(g, post, timber, px, 1.4, 1.22);
  put(g, new THREE.BoxGeometry(4.9, 0.16, 0.16), timber, 0, 2.74, 1.22);

  // Gable roof: a 3-sided prism along x, ridge up (thetaStart PI/2), squashed.
  const roofR = 2.48;
  const roofGeo = new THREE.CylinderGeometry(roofR, roofR, 5.3, 3, 1, false, Math.PI / 2);
  roofGeo.rotateZ(Math.PI / 2);
  roofGeo.scale(1, 0.55, 1);
  put(g, roofGeo, std(new THREE.Color(style.awning).lerp(new THREE.Color(0x5a3320), 0.55).getHex(), { flatShading: true, roughness: 0.8 }), 0, 2.8 + roofR * 0.5 * 0.55, bodyZ);
  if (signage === 'ferreiro') {
    put(g, new THREE.BoxGeometry(0.6, 1.8, 0.6), std(0x6f6960, { flatShading: true }), 1.5, 3.9, bodyZ - 0.6);
  }

  // Door (a double door for the warehouse) and a warmly lit window.
  const doorW = signage === 'armazem' ? 1.7 : 0.95;
  put(g, new THREE.BoxGeometry(doorW, 1.55, 0.06), timber, -1.25, 0.78, 1.23);
  put(g, new THREE.BoxGeometry(0.95, 0.6, 0.05), glow(0xffcf7a, 0.55), 1.3, 1.35, 1.23, undefined, false);

  // Painted sign board above the awning.
  const board = put(g, new THREE.BoxGeometry(2.5, 0.56, 0.08), timber, 0, 2.25, 1.26);
  board.castShadow = false;
  const signMat = new THREE.MeshStandardMaterial({ map: signTexture(style.label), roughness: 0.85 });
  put(g, new THREE.PlaneGeometry(2.4, 0.5), signMat, 0, 2.25, 1.305, undefined, false);

  // Awning on two posts, sloping down toward the street, with a valance.
  put(g, new THREE.BoxGeometry(4.7, 0.07, 1.5), awning, 0, 1.86, 1.95, [0.2, 0, 0]);
  put(g, new THREE.BoxGeometry(4.7, 0.22, 0.05), awningEdge, 0, 1.6, 2.68);
  const awningPost = new THREE.CylinderGeometry(0.06, 0.06, 1.7, 6);
  for (const px of [-2.2, 2.2]) put(g, awningPost, timber, px, 0.85, 2.65);

  addTradeProps(g, signage);

  const { x, z } = worldCenter(b);
  g.position.set(x, 0, z);
  // Built facing +z; every storefront faces north (-z) — see this file's header.
  g.rotation.y = Math.PI;
  return g;
}

/**
 * Builds every city-layer placement in `placements` (the caller filters to
 * `CITY_PROP_KINDS`). Colliders are derived by the caller like any other
 * building's (with `PROP_COLLIDER_INSET` applied).
 */
export function buildCityPropMeshes(placements: BuildingPlacement[], accentColor: number): THREE.Group {
  const group = new THREE.Group();
  const byKind = new Map<BuildingKind, BuildingPlacement[]>();
  for (const b of placements) {
    const list = byKind.get(b.kind) ?? [];
    list.push(b);
    byKind.set(b.kind, list);
  }
  const of = (k: BuildingKind) => byKind.get(k) ?? [];

  for (const b of of('shop')) group.add(buildStorefront(b, accentColor));
  addInstancedParts(group, of('fountain'), fountainParts());
  addInstancedParts(group, of('lamp'), lampParts());
  addInstancedParts(group, of('banner'), bannerParts());
  addInstancedParts(group, of('crates'), cratesParts());
  addInstancedParts(group, of('well'), wellParts());
  addInstancedParts(group, of('shrine'), shrineParts());
  addInstancedParts(group, of('noticeboard'), noticeboardParts());
  addInstancedParts(group, of('campfire'), campfireParts());
  return group;
}
