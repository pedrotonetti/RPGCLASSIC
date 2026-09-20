import type { ActionName, CharacterAnimatorLike } from './animation';
import type { GltfActor } from './gltfModel';
import type { WeaponKind } from './playerAvatar';

/**
 * Drives the player's real GLTF avatar (`playerAvatar.ts`) by playing its
 * baked-in animation clips through a `GltfActor`, instead of
 * `CharacterAnimator`'s manual pivot posing (which only ever worked on the
 * procedural rig's named joints). Implements the same `CharacterAnimatorLike`
 * surface, so `OverworldScreen`/`OverworldCombat` call it exactly the same
 * way (`setMoving`, `setMounted`, `play(action, onDone)`, `currentAction`,
 * `update`) without knowing which animator they actually got.
 */

const IDLE_CLIP = 'Idle';
const WALK_CLIP = 'Walking_A';
/** No literal "riding" clip exists in the library; a seated pose is the closest stand-in for straddling a mount's back. */
const MOUNTED_CLIP = 'Sit_Chair_Idle';
const CAST_CLIP = 'Spellcast_Shoot';
const DEFEND_CLIP = 'Block';
const HIT_CLIP = 'Hit_A';
const VICTORY_CLIP = 'Cheer';
const EAT_CLIP = 'Use_Item';
const MOUNT_CLIP = 'Sit_Chair_Down';
const DISMOUNT_CLIP = 'Sit_Chair_StandUp';
const DODGE_CLIP = 'Dodge_Backward';
/** Used if a clip is somehow missing from a model's library (shouldn't happen — all 4 share the same 76-clip set). */
const FALLBACK_ACTION_DURATION = 0.5;

const ATTACK_CLIP: Record<WeaponKind, string> = {
  sword: '1H_Melee_Attack_Slice_Diagonal',
  axe: '2H_Melee_Attack_Chop',
  dagger: 'Dualwield_Melee_Attack_Stab',
  staff: '2H_Melee_Attack_Stab',
  wand: '1H_Melee_Attack_Stab',
  crossbow: '2H_Ranged_Shoot',
  fists: 'Unarmed_Melee_Attack_Punch_A',
};

export class GltfCharacterAnimator implements CharacterAnimatorLike {
  private moving = false;
  private mounted = false;
  private action: ActionName | null = null;
  private actionTimer = 0;
  private actionDuration = 0;
  private onActionDone: (() => void) | null = null;

  constructor(
    private actor: GltfActor,
    private weaponKind: WeaponKind,
  ) {
    this.actor.play(IDLE_CLIP);
  }

  setMoving(moving: boolean): void {
    this.moving = moving;
  }

  setMounted(mounted: boolean): void {
    this.mounted = mounted;
  }

  /** Starts a one-shot action clip; locomotion resumes automatically once it finishes — same contract as `CharacterAnimator.play`. */
  play(action: ActionName, onDone?: () => void): void {
    const clipName = this.clipForAction(action);
    this.action = action;
    this.actionTimer = 0;
    this.actionDuration = this.actor.duration(clipName) || FALLBACK_ACTION_DURATION;
    this.onActionDone = onDone ?? null;
    this.actor.play(clipName, { loop: false, fade: 0.15 });
  }

  get currentAction(): ActionName | null {
    return this.action;
  }

  update(dt: number): void {
    if (this.action) {
      this.actionTimer += dt;
      if (this.actionTimer >= this.actionDuration) {
        this.action = null;
        const cb = this.onActionDone;
        this.onActionDone = null;
        cb?.();
      }
    } else if (this.mounted) {
      this.actor.play(MOUNTED_CLIP);
    } else if (this.moving) {
      this.actor.play(WALK_CLIP);
    } else {
      this.actor.play(IDLE_CLIP);
    }
    this.actor.update(dt);
  }

  private clipForAction(action: ActionName): string {
    switch (action) {
      case 'attack':
        return ATTACK_CLIP[this.weaponKind];
      case 'cast':
        return CAST_CLIP;
      case 'defend':
        return DEFEND_CLIP;
      case 'eat':
        return EAT_CLIP;
      case 'hit':
        return HIT_CLIP;
      case 'victory':
        return VICTORY_CLIP;
      case 'mount':
        return MOUNT_CLIP;
      case 'dismount':
        return DISMOUNT_CLIP;
      case 'dodge':
        return DODGE_CLIP;
    }
  }
}
