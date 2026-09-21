import * as THREE from 'three';
import type { NpcDefinition } from '../data/npcs';
import { GltfActor, loadSkinnedInstance } from './gltfModel';
import {
  applyMeshScaleFixups,
  classModelFile,
  DEFAULT_CLASS,
  hideAlternateMeshes,
  MODEL_SCALE_CORRECTION,
} from './playerAvatar';

/**
 * NPCs' real, rigged avatars — the same 4 vendored KayKit "Adventurers"
 * character files (`public/models/characters/*.glb`) and the same
 * held-mesh/scale tables `playerAvatar.ts` already built for the player, just
 * without any of the player-specific machinery (no combat animator, no gem
 * sockets, no height-slider scaling). Every `NpcDefinition` carries its own
 * `classAnalogId` — the closest class model/loadout for that NPC's role (see
 * `data/npcs.ts`) — so this module never has to guess one itself.
 *
 * Much simpler than `loadPlayerAvatar`: NPCs never fight, so all they need is
 * the right model file, the right held item visible, and an `Idle` clip so
 * they don't stand around in the GLB's raw T-pose.
 */
export interface NpcAvatar {
  scene: THREE.Group;
  actor: GltfActor;
}

export async function loadNpcAvatar(npc: NpcDefinition): Promise<NpcAvatar> {
  const classId = npc.classAnalogId ?? DEFAULT_CLASS;
  const modelFile = classModelFile(classId) ?? classModelFile(DEFAULT_CLASS)!;
  const loaded = await loadSkinnedInstance(`characters/${modelFile}.glb`);
  hideAlternateMeshes(loaded.scene, classId);
  applyMeshScaleFixups(loaded.scene);

  // NPCs don't have a class-creation height slider — appearance.heightScale
  // still applies (npcAppearance() defaults it to 1.0, and a few NPCs vary
  // it), same MODEL_SCALE_CORRECTION baseline the player avatar uses so NPCs
  // and the player read as consistently-sized people standing next to each
  // other.
  loaded.scene.scale.setScalar(npc.appearance.heightScale * MODEL_SCALE_CORRECTION);

  const actor = new GltfActor(loaded);
  actor.play('Idle');
  return { scene: loaded.scene, actor };
}
