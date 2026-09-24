import * as THREE from 'three';
import type { Player } from '../entities/Player';
import { RARITY_COLOR, rarityTier } from '../config/rarity';
import { getGemById } from '../data/gems';
import { GltfActor, loadSkinnedInstance } from './gltfModel';

/**
 * The player's real, rigged avatar — replaces the primitive-shape mannequin
 * `characterModel.ts` still builds for enemies/NPCs (out of scope; left
 * untouched) with one of the 4 vendored KayKit "Adventurers" characters
 * (`public/models/characters/*.glb`, see `public/models/CREDITS.md`).
 *
 * Each character file already ships its own matching set of held
 * weapon/shield mesh variants, rigidly parented to its `handslot.l`/
 * `handslot.r` hand-bone nodes (found by dumping the GLB's JSON chunk with a
 * throwaway Node script — see the final report for the full bone/mesh
 * list). ALL variants are visible by default; picking a class's loadout is
 * just hiding the ones it doesn't use and leaving its pick visible. That's
 * more reliable than attaching a standalone prop from `public/models/
 * weapons/` with a guessed local transform — those meshes are already
 * correctly scaled, positioned and skin-matched by the pack's own artist.
 */

export type WeaponKind = 'sword' | 'axe' | 'dagger' | 'staff' | 'wand' | 'crossbow' | 'fists';

/** Which of the 4 character files each class renders as. */
const CLASS_MODEL_FILE: Record<string, string> = {
  warrior: 'Barbarian',
  paladin: 'Knight',
  mage: 'Mage',
  necromancer: 'Mage',
  cleric: 'Mage',
  archer: 'Rogue',
  assassin: 'Rogue',
  monk: 'Rogue',
};

/** Drives which baked attack/cast clip `GltfCharacterAnimator` picks for a class — see that file. */
const WEAPON_KIND: Record<string, WeaponKind> = {
  warrior: 'axe',
  paladin: 'sword',
  mage: 'staff',
  necromancer: 'wand',
  cleric: 'staff',
  archer: 'crossbow',
  assassin: 'dagger',
  monk: 'fists',
};

export interface HeldMeshConfig {
  /** Mesh node name(s) left visible (already the default — listed for readability/traceability, not applied). */
  show: string[];
  /** Sibling mesh node names under the same character's handslot.l/handslot.r hidden so only `show`'s pick renders. */
  hide: string[];
  /** The single mesh node a socketed weapon gem's glow gets pinned to (null if the class goes unarmed). */
  gemAnchor: string | null;
}

/**
 * Exported (alongside `MODEL_SCALE_CORRECTION`, `MESH_SCALE_FIXUP`,
 * `applyMeshScaleFixups` and `hideAlternateMeshes` below, and `DEFAULT_CLASS`)
 * so `npcAvatar.ts` can reuse the exact same held-item/scale tables for NPCs
 * instead of duplicating them — every NPC picks a class-analog id from this
 * same set (see `NpcDefinition.classAnalogId` in `data/npcs.ts`).
 */
export const HELD_MESHES: Record<string, HeldMeshConfig> = {
  // Barbarian.glb: right hand {1H_Axe, 2H_Axe, Mug}, left hand {1H_Axe_Offhand, Barbarian_Round_Shield}.
  // Barbarian_Hat and Barbarian_Cape are also hidden (unlike Knight_Helmet/
  // Knight_Cape and Mage_Hat/Mage_Cape, which read fine left visible): this
  // particular hat is an oversized fur hood that, combined with the cape,
  // swallows the whole head/torso into one dark round mass from behind —
  // found by dumping the model's actual mesh tree in-game and comparing
  // screenshots with/without them, since the resulting silhouette (dark,
  // round-eared) was easy to mistake for some unrelated creature entirely.
  warrior: {
    show: ['2H_Axe'],
    hide: ['1H_Axe', 'Mug', '1H_Axe_Offhand', 'Barbarian_Round_Shield', 'Barbarian_Hat', 'Barbarian_Cape'],
    gemAnchor: '2H_Axe',
  },
  // Knight.glb: right hand {1H_Sword, 2H_Sword}, left hand {1H_Sword_Offhand, Badge/Rectangle/Round/Spike_Shield}.
  paladin: {
    show: ['1H_Sword', 'Round_Shield'],
    hide: ['2H_Sword', '1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Spike_Shield'],
    gemAnchor: '1H_Sword',
  },
  // Mage.glb: right hand {1H_Wand, 2H_Staff}, left hand {Spellbook, Spellbook_open}.
  mage: { show: ['2H_Staff', 'Spellbook_open'], hide: ['1H_Wand', 'Spellbook'], gemAnchor: '2H_Staff' },
  necromancer: { show: ['1H_Wand', 'Spellbook'], hide: ['2H_Staff', 'Spellbook_open'], gemAnchor: '1H_Wand' },
  cleric: { show: ['2H_Staff', 'Spellbook'], hide: ['1H_Wand', 'Spellbook_open'], gemAnchor: '2H_Staff' },
  // Rogue.glb: right hand {1H_Crossbow, 2H_Crossbow, Knife, Throwable}, left hand {Knife_Offhand}.
  archer: { show: ['2H_Crossbow'], hide: ['1H_Crossbow', 'Knife', 'Throwable', 'Knife_Offhand'], gemAnchor: '2H_Crossbow' },
  assassin: { show: ['Knife', 'Knife_Offhand'], hide: ['1H_Crossbow', '2H_Crossbow', 'Throwable'], gemAnchor: 'Knife' },
  monk: { show: [], hide: ['1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable', 'Knife_Offhand'], gemAnchor: null },
};

export const DEFAULT_CLASS = 'paladin';

/**
 * Per-mesh visual corrections for individual accessory meshes that read as
 * disproportionate at the otherwise-correct `MODEL_SCALE_CORRECTION` —
 * found by screenshotting each class next to an NPC of known height.
 * `Mage_Hat` is the one offender: a witch hat authored large enough to
 * visually dwarf the character wearing it (and any NPC standing nearby),
 * unlike the other 3 models' headwear.
 */
export const MESH_SCALE_FIXUP: Record<string, number> = {
  Mage_Hat: 0.6,
};

export function applyMeshScaleFixups(scene: THREE.Group): void {
  for (const [name, scale] of Object.entries(MESH_SCALE_FIXUP)) {
    const node = scene.getObjectByName(name);
    if (node) node.scale.setScalar(scale);
  }
}

/**
 * The 4 KayKit rigs stand ~2.2-2.4 world units tall at their authored scale
 * (measured with a precise, skinning-aware `THREE.Box3` — a naive
 * `Box3.setFromObject` on a `SkinnedMesh` reads the UNPOSED bind shape and
 * badly understates how the actual animated pose fills space) — noticeably
 * taller/bulkier than the ~1.6-1.8-unit-tall procedural rig this replaces,
 * and than `TILE_SIZE` (2) and every other distance tuned around it (camera
 * rig, NPC/monster placement, mount seat offset). Applied as a flat
 * multiplier under `heightScale` so the class-creation height slider still
 * scales relative to a correctly-sized baseline instead of an oversized one.
 */
export const MODEL_SCALE_CORRECTION = 0.72;

export interface PlayerAvatar {
  scene: THREE.Group;
  actor: GltfActor;
  weaponKind: WeaponKind;
  classId: string;
}

export function hideAlternateMeshes(scene: THREE.Group, classId: string): void {
  const config = HELD_MESHES[classId] ?? HELD_MESHES[DEFAULT_CLASS];
  for (const name of config.hide) {
    const node = scene.getObjectByName(name);
    if (node) node.visible = false;
  }
}

/**
 * Loads (and lazily caches, per `loadSkinnedInstance`) the one class-matched
 * character file a player actually needs — never all 4 up front, each is
 * ~3.5MB. Call this BEFORE mounting a screen that shows the player (see
 * `goToLazy` call sites in `OverworldScreen`/`CharacterCreationScreen`/etc.)
 * so the model is a plain, already-resolved object by the time a
 * screen's synchronous `mount()` runs — no mid-mount await, no T-pose frame.
 *
 * `heightScale` is the only piece of character-creation customization that
 * still carries over onto the real model — the rest (skin tone, face, hair,
 * markings, garment colors...) has no home on a single pre-baked texture
 * atlas, so `CharacterCreationScreen` no longer even offers UI for those.
 */
export async function loadPreviewAvatar(classId: string, heightScale = 1): Promise<PlayerAvatar> {
  const modelFile = CLASS_MODEL_FILE[classId] ?? CLASS_MODEL_FILE[DEFAULT_CLASS];
  const loaded = await loadSkinnedInstance(`characters/${modelFile}.glb`);
  hideAlternateMeshes(loaded.scene, classId);
  applyMeshScaleFixups(loaded.scene);
  loaded.scene.scale.setScalar(heightScale * MODEL_SCALE_CORRECTION);

  const actor = new GltfActor(loaded);
  actor.play('Idle');
  return { scene: loaded.scene, actor, weaponKind: WEAPON_KIND[classId] ?? WEAPON_KIND[DEFAULT_CLASS], classId };
}

/** Same loader as `loadPreviewAvatar`, plus the player-specific bits (their actual height pick, socketed weapon gem, equipped armor's visual accents) a bare class/appearance preview doesn't have. */
export async function loadPlayerAvatar(player: Player): Promise<PlayerAvatar> {
  const avatar = await loadPreviewAvatar(player.classId, player.appearance.heightScale);
  applyWeaponGem(avatar, player);
  applyArmorVisual(avatar, player);
  return avatar;
}

/** Every classId `classes.ts` defines resolves to a model file — asserted by a defensive test alongside this. */
export function classModelFile(classId: string): string | undefined {
  return CLASS_MODEL_FILE[classId];
}

/**
 * Adds (or refreshes) the small glowing stone standing in for a socketed
 * weapon gem — the same trick `characterModel.ts`'s `addGemStone` uses for
 * the procedural rig, reimplemented here since the GLTF weapon meshes it'd
 * anchor to don't exist in that module. Safe to call repeatedly (e.g. right
 * after socketing/removing a gem in the jeweler shop) — it always clears
 * any stone it previously added before deciding whether to add a new one.
 */
export function applyWeaponGem(avatar: PlayerAvatar, player: Player): void {
  const config = HELD_MESHES[avatar.classId] ?? HELD_MESHES[DEFAULT_CLASS];
  if (!config.gemAnchor) return;
  const anchor = avatar.scene.getObjectByName(config.gemAnchor);
  if (!anchor) return;

  const previous = anchor.children.find((c) => c.userData.isGemStone);
  if (previous) anchor.remove(previous);

  const gemId = player.equipment.arma?.socketedGemId;
  if (!gemId) return;
  const color = getGemById(gemId).color;
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.035, 0),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.2, roughness: 0.2 }),
  );
  gem.userData.isGemStone = true;
  gem.position.set(0, 0.12, 0);
  anchor.add(gem);
}

/**
 * Adds (or refreshes) armor-tier visual accents on the real GLTF avatar —
 * the "equipping armor changes the model" counterpart to `applyWeaponGem`
 * above, but for `armadura` instead of a socketed weapon gem, and for the
 * body instead of the held weapon.
 *
 * Unlike a socketed gem's stand-in stone, this can't just recolor the
 * character's own body material: dumping each KayKit GLB's JSON chunk shows
 * every mesh (body, arms, legs, head, cape, helmet) shares ONE baked texture
 * atlas material per file, and `loadSkinnedInstance`'s clone (three's
 * `SkeletonUtils.clone`) reuses that material BY REFERENCE across every
 * clone made from it — mutating its `.color` here would recolor every other
 * NPC and player currently wearing the same class model, not just this one.
 * So instead of a tint, higher rarities pin small NEW meshes (their own
 * dedicated, never-shared material) onto the model's `chest` bone: pauldrons
 * from epic tier up, a chest emblem from legendary, and a glowing cape at
 * mythic — the same escalating accent set `characterModel.ts`'s procedural
 * showcase rig grows (that one CAN safely tint its body material too, since
 * every showcase mannequin gets its own freshly-built materials).
 */
export function applyArmorVisual(avatar: PlayerAvatar, player: Player): void {
  const chest = avatar.scene.getObjectByName('chest');
  if (!chest) return;

  for (const child of [...chest.children]) {
    if (child.userData.isArmorAccent) chest.remove(child);
  }

  const armor = player.equipment.armadura;
  if (!armor) return;
  const tier = rarityTier(armor.rarity);
  if (tier < 2) return;

  const color = RARITY_COLOR[armor.rarity];
  const glow = tier >= 4;

  const pauldronMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.65,
    roughness: 0.22,
    emissive: glow ? color : 0x000000,
    emissiveIntensity: glow ? 0.9 : 0,
  });
  const pauldronGeo = new THREE.BoxGeometry(0.16, 0.1, 0.2);
  for (const side of [-1, 1] as const) {
    const pauldron = new THREE.Mesh(pauldronGeo, pauldronMat);
    pauldron.castShadow = true;
    pauldron.position.set(side * 0.23, 0.12, 0.02);
    pauldron.userData.isArmorAccent = true;
    chest.add(pauldron);
  }

  if (tier >= 3) {
    const emblem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.06, 0),
      new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3, emissive: glow ? color : 0x000000, emissiveIntensity: glow ? 1.0 : 0 }),
    );
    emblem.position.set(0, 0.1, 0.16);
    emblem.userData.isArmorAccent = true;
    chest.add(emblem);
  }

  if (tier >= 4) {
    const cape = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.5, 0.03),
      new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.1, side: THREE.DoubleSide }),
    );
    cape.position.set(0, -0.05, -0.14);
    cape.rotation.x = 0.12;
    cape.userData.isArmorAccent = true;
    chest.add(cape);
  }
}
