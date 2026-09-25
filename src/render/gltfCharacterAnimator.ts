import type { ActionName, CharacterAnimatorLike, PlayOptions } from './animation';
import type { GltfActor } from './gltfModel';
import type { WeaponKind } from './playerAvatar';

/**
 * Drives the player's real GLTF avatar (`playerAvatar.ts`) by playing its
 * baked-in animation clips through a `GltfActor`, instead of
 * `CharacterAnimator`'s manual pivot posing (which only ever worked on the
 * procedural rig's named joints). Implements the same `CharacterAnimatorLike`
 * surface, so `OverworldScreen`/`OverworldCombat` call it exactly the same
 * way (`setMoving`, `setMounted`, `play(action, onDone, opts)`,
 * `currentAction`, `update`) without knowing which animator they actually got.
 *
 * All 4 KayKit rigs (`public/models/characters/*.glb`) share the exact same
 * 76-clip animation library (confirmed by dumping each file's own JSON
 * chunk) — differentiation across classes/skills below is entirely about
 * picking a DIFFERENT existing clip per class/skill-kind, never a fabricated
 * one. `ATTACK_CLIP` already varied by held weapon before this system; this
 * file additionally varies the "cast" clip by class flavor (`CAST_STYLE`)
 * and gives select classes a more dramatic clip specifically for their
 * ultimate (`ULTIMATE_ATTACK_CLIP`/`ULTIMATE_CAST_CLIP`) — see each table's
 * own comment for what's a genuine distinct clip vs. an honest fallback to
 * the class's regular one where the library has nothing better suited.
 */

const IDLE_CLIP = 'Idle';
const WALK_CLIP = 'Walking_A';
/** No literal "riding" clip exists in the library; a seated pose is the closest stand-in for straddling a mount's back. */
const MOUNTED_CLIP = 'Sit_Chair_Idle';
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

/**
 * A distinct, more dramatic melee clip for a class's own ultimate skill —
 * only where one exists in the library that doesn't clash with what the
 * class is actually holding. Archer (ranged) and paladin are deliberately
 * left out: the library's only "bigger" melee options are two-handed spin
 * attacks, which would visibly mismatch a one-handed sword or a crossbow —
 * so those two classes' ultimates honestly fall back to the regular
 * `ATTACK_CLIP` for their weapon kind instead of a fabricated animation.
 */
const ULTIMATE_ATTACK_CLIP: Partial<Record<WeaponKind, string>> = {
  axe: '2H_Melee_Attack_Spin', // warrior — "concentrates all its force" reads well as a full spin instead of a single chop
  dagger: 'Dualwield_Melee_Attack_Slice', // assassin — a wider finishing slice instead of the regular quick stab
  fists: 'Unarmed_Melee_Attack_Kick', // monk — a bigger kick instead of a punch
};

/** Which "invocation" clip reads as this class's own casting flavor — see `CAST_CLIP_BY_STYLE`. Only classes with at least one magical/heal skill need an entry; the rest never trigger the 'cast' action at all. */
type CastStyle = 'bolt' | 'raise' | 'channel';
const CAST_STYLE: Partial<Record<string, CastStyle>> = {
  mage: 'bolt', // a direct offensive bolt (fireball/ice lance) — thrust the arm forward and fire
  cleric: 'raise', // holy invocation — raise both hands to call down/channel light
  paladin: 'raise', // same holy-invocation read, for its own heal/buff skills
  necromancer: 'channel', // a slower, more deliberate dark ritual, matching "corrupt and drain"
};
const CAST_CLIP_BY_STYLE: Record<CastStyle, string> = {
  bolt: 'Spellcast_Shoot',
  raise: 'Spellcast_Raise',
  channel: 'Spellcast_Long',
};
/** A bigger, distinct cast clip for the 3 classes whose ultimate is itself cast (mage/cleric/necromancer) — paladin's ultimate is physical and goes through `ULTIMATE_ATTACK_CLIP` instead. */
const ULTIMATE_CAST_CLIP: Partial<Record<string, string>> = {
  mage: 'Spellcast_Long', // a bigger, slower channel for the meteor instead of the quick bolt
  cleric: 'Spellcasting', // a fuller channeled invocation for the class's own biggest heal
  necromancer: 'Spellcasting', // the same fuller channel, for raising a whole legion instead of one drain
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
    private classId: string,
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
  play(action: ActionName, onDone?: () => void, opts?: PlayOptions): void {
    const clipName = this.clipForAction(action, opts);
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

  private clipForAction(action: ActionName, opts?: PlayOptions): string {
    switch (action) {
      case 'attack':
        if (opts?.isUltimate) {
          const ultimateClip = ULTIMATE_ATTACK_CLIP[this.weaponKind];
          if (ultimateClip) return ultimateClip;
        }
        return ATTACK_CLIP[this.weaponKind];
      case 'cast': {
        if (opts?.isUltimate) {
          const ultimateClip = ULTIMATE_CAST_CLIP[this.classId];
          if (ultimateClip) return ultimateClip;
        }
        const style = CAST_STYLE[this.classId] ?? 'bolt';
        return CAST_CLIP_BY_STYLE[style];
      }
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
