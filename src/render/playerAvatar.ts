import * as THREE from 'three';
import type { Player } from '../entities/Player';
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

interface HeldMeshConfig {
  /** Mesh node name(s) left visible (already the default — listed for readability/traceability, not applied). */
  show: string[];
  /** Sibling mesh node names under the same character's handslot.l/handslot.r hidden so only `show`'s pick renders. */
  hide: string[];
  /** The single mesh node a socketed weapon gem's glow gets pinned to (null if the class goes unarmed). */
  gemAnchor: string | null;
}

const HELD_MESHES: Record<string, HeldMeshConfig> = {
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

const DEFAULT_CLASS = 'paladin';

/**
 * Per-mesh visual corrections for individual accessory meshes that read as
 * disproportionate at the otherwise-correct `MODEL_SCALE_CORRECTION` —
 * found by screenshotting each class next to an NPC of known height.
 * `Mage_Hat` is the one offender: a witch hat authored large enough to
 * visually dwarf the character wearing it (and any NPC standing nearby),
 * unlike the other 3 models' headwear.
 */
const MESH_SCALE_FIXUP: Record<string, number> = {
  Mage_Hat: 0.6,
};

function applyMeshScaleFixups(scene: THREE.Group): void {
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
const MODEL_SCALE_CORRECTION = 0.72;

export interface PlayerAvatar {
  scene: THREE.Group;
  actor: GltfActor;
  weaponKind: WeaponKind;
  classId: string;
}

function hideAlternateMeshes(scene: THREE.Group, classId: string): void {
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
 */
export async function loadPlayerAvatar(player: Player): Promise<PlayerAvatar> {
  const classId = player.classId;
  const modelFile = CLASS_MODEL_FILE[classId] ?? CLASS_MODEL_FILE[DEFAULT_CLASS];
  const loaded = await loadSkinnedInstance(`characters/${modelFile}.glb`);
  hideAlternateMeshes(loaded.scene, classId);
  applyMeshScaleFixups(loaded.scene);

  // The only piece of character-creation customization that still carries
  // over onto the real model (see CharacterCreationScreen's comment) — the
  // rest (skin tone, face, hair, markings, garment colors...) has no home on
  // a single pre-baked texture atlas, so the creation screen's preview is
  // now cosmetic-only for those.
  loaded.scene.scale.setScalar(player.appearance.heightScale * MODEL_SCALE_CORRECTION);

  const actor = new GltfActor(loaded);
  actor.play('Idle');
  const avatar: PlayerAvatar = { scene: loaded.scene, actor, weaponKind: WEAPON_KIND[classId] ?? WEAPON_KIND[DEFAULT_CLASS], classId };
  applyWeaponGem(avatar, player);
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
