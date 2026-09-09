import type { CharacterRig } from './characterModel';

/**
 * A tiny procedural animation library for the primitive-jointed rigs built
 * by `characterModel.ts` — no skinning, just posing a handful of named
 * pivots (arms, legs, torso, head) over time. Deliberately simple and
 * readable per pose, in the same spirit classic low-poly/blocky character
 * rigs use instead of full mocap: a few clear key poses beat dense,
 * expensive animation data, and the result stays instantly legible.
 *
 * Locomotion (idle/walk) loops continuously and blends with whichever
 * one-shot action (attack/defend/eat/hit/victory) is currently playing.
 */
export type ActionName = 'attack' | 'defend' | 'cast' | 'eat' | 'hit' | 'victory' | 'mount' | 'dismount' | 'dodge';

interface Pose {
  armL: number;
  armR: number;
  legL: number;
  legR: number;
  kneeL: number;
  kneeR: number;
  upperBodyY: number;
  upperBodyRotX: number;
  upperBodyRotZ: number;
  headRotX: number;
}

const REST_POSE: Pose = {
  armL: 0,
  armR: 0,
  legL: 0,
  legR: 0,
  kneeL: 0,
  kneeR: 0,
  upperBodyY: 0,
  upperBodyRotX: 0,
  upperBodyRotZ: 0,
  headRotX: 0,
};

interface Keyframe {
  t: number;
  pose: Partial<Pose>;
}

interface ActionClip {
  duration: number;
  keyframes: Keyframe[];
}

function sample(keyframes: Keyframe[], t: number): Pose {
  const clamped = Math.max(0, Math.min(1, t));
  let a = keyframes[0];
  let b = keyframes[keyframes.length - 1];
  for (let i = 0; i < keyframes.length - 1; i++) {
    if (clamped >= keyframes[i].t && clamped <= keyframes[i + 1].t) {
      a = keyframes[i];
      b = keyframes[i + 1];
      break;
    }
  }
  const span = b.t - a.t || 1;
  const local = (clamped - a.t) / span;
  const pose = { ...REST_POSE };
  for (const key of Object.keys(pose) as Array<keyof Pose>) {
    const av = a.pose[key] ?? 0;
    const bv = b.pose[key] ?? 0;
    pose[key] = av + (bv - av) * local;
  }
  return pose;
}

const ACTION_CLIPS: Record<ActionName, ActionClip> = {
  attack: {
    duration: 0.45,
    keyframes: [
      { t: 0, pose: { armR: -0.35, upperBodyRotX: 0.06 } },
      { t: 0.35, pose: { armR: 1.15, armL: -0.25, upperBodyRotX: -0.18, headRotX: 0.08 } },
      { t: 1, pose: REST_POSE },
    ],
  },
  cast: {
    duration: 0.6,
    keyframes: [
      { t: 0, pose: { armR: -0.5, armL: -0.3 } },
      { t: 0.5, pose: { armR: -1.7, armL: -1.5, upperBodyRotX: -0.08, headRotX: -0.15 } },
      { t: 1, pose: REST_POSE },
    ],
  },
  defend: {
    duration: 0.55,
    keyframes: [
      { t: 0, pose: { armL: 0.2, armR: 0.2 } },
      { t: 0.25, pose: { armL: 1.1, armR: 0.9, upperBodyRotX: 0.1 } },
      { t: 0.75, pose: { armL: 1.1, armR: 0.9, upperBodyRotX: 0.1 } },
      { t: 1, pose: REST_POSE },
    ],
  },
  eat: {
    duration: 0.9,
    keyframes: [
      { t: 0, pose: { armL: -0.2 } },
      { t: 0.25, pose: { armL: -2.1, headRotX: -0.25 } },
      { t: 0.45, pose: { armL: -1.9, headRotX: -0.05 } },
      { t: 0.65, pose: { armL: -2.1, headRotX: -0.25 } },
      { t: 1, pose: REST_POSE },
    ],
  },
  hit: {
    duration: 0.3,
    keyframes: [
      { t: 0, pose: { upperBodyRotX: -0.22, headRotX: -0.15, armL: -0.3, armR: -0.3 } },
      { t: 1, pose: REST_POSE },
    ],
  },
  victory: {
    duration: 1.1,
    keyframes: [
      { t: 0, pose: {} },
      { t: 0.3, pose: { armL: -2.6, armR: -2.6, upperBodyRotX: -0.1 } },
      { t: 0.7, pose: { armL: -2.4, armR: -2.4, upperBodyRotX: -0.1 } },
      { t: 1, pose: { armL: -2.6, armR: -2.6, upperBodyRotX: -0.1 } },
    ],
  },
  mount: {
    duration: 0.5,
    keyframes: [
      { t: 0, pose: {} },
      { t: 0.5, pose: { legL: -1.3, legR: -1.3, kneeL: 1.4, kneeR: 1.4, upperBodyRotX: -0.05 } },
      { t: 1, pose: { legL: -1.3, legR: -1.3, kneeL: 1.4, kneeR: 1.4, upperBodyRotX: -0.05 } },
    ],
  },
  dismount: {
    duration: 0.4,
    keyframes: [
      { t: 0, pose: { legL: -1.3, legR: -1.3, kneeL: 1.4, kneeR: 1.4, upperBodyRotX: -0.05 } },
      { t: 1, pose: REST_POSE },
    ],
  },
  dodge: {
    duration: 0.3,
    keyframes: [
      { t: 0, pose: {} },
      { t: 0.3, pose: { upperBodyRotZ: 0.5, upperBodyY: -0.06, legL: 0.35, legR: -0.35, armR: -0.4 } },
      { t: 0.7, pose: { upperBodyRotZ: 0.5, upperBodyY: -0.06, legL: 0.35, legR: -0.35, armR: -0.4 } },
      { t: 1, pose: REST_POSE },
    ],
  },
};

const WALK_CYCLE_SPEED = 7.5;
const WALK_SWING = 0.55;
const KNEE_BEND = 0.9;
const WALK_BOB = 0.028;
const IDLE_BREATH_SPEED = 1.6;
const IDLE_BREATH_AMOUNT = 0.012;

/** Drives one character's rig every frame: continuous locomotion plus one-shot actions layered on top. */
export class CharacterAnimator {
  private time = 0;
  private moving = false;
  private mounted = false;
  private action: ActionName | null = null;
  private actionTime = 0;
  private onActionDone: (() => void) | null = null;

  constructor(private rig: CharacterRig) {}

  setMoving(moving: boolean): void {
    this.moving = moving;
  }

  setMounted(mounted: boolean): void {
    this.mounted = mounted;
  }

  /** Starts a one-shot action; locomotion resumes automatically once it finishes. */
  play(action: ActionName, onDone?: () => void): void {
    this.action = action;
    this.actionTime = 0;
    this.onActionDone = onDone ?? null;
  }

  get currentAction(): ActionName | null {
    return this.action;
  }

  update(dt: number): void {
    this.time += dt;

    let pose: Pose;
    if (this.action) {
      const clip = ACTION_CLIPS[this.action];
      this.actionTime += dt;
      pose = sample(clip.keyframes, this.actionTime / clip.duration);
      if (this.actionTime >= clip.duration) {
        this.action = null;
        const cb = this.onActionDone;
        this.onActionDone = null;
        cb?.();
      }
    } else if (this.mounted) {
      pose = { ...REST_POSE, legL: -1.3, legR: -1.3, kneeL: 1.4, kneeR: 1.4, upperBodyRotX: -0.05 };
    } else if (this.moving) {
      const phase = this.time * WALK_CYCLE_SPEED;
      pose = {
        ...REST_POSE,
        legL: Math.sin(phase) * WALK_SWING,
        legR: Math.sin(phase + Math.PI) * WALK_SWING,
        kneeL: Math.max(0, Math.sin(phase)) * KNEE_BEND,
        kneeR: Math.max(0, Math.sin(phase + Math.PI)) * KNEE_BEND,
        armL: Math.sin(phase + Math.PI) * WALK_SWING * 0.7,
        armR: Math.sin(phase) * WALK_SWING * 0.7,
        upperBodyY: Math.abs(Math.sin(phase)) * WALK_BOB,
        upperBodyRotX: Math.sin(phase) * 0.03,
      };
    } else {
      pose = { ...REST_POSE, upperBodyY: Math.sin(this.time * IDLE_BREATH_SPEED) * IDLE_BREATH_AMOUNT };
    }

    this.applyPose(pose);
  }

  private applyPose(pose: Pose): void {
    this.rig.armL.rotation.x = pose.armL;
    this.rig.armR.rotation.x = pose.armR;
    this.rig.legL.rotation.x = pose.legL;
    this.rig.legR.rotation.x = pose.legR;
    this.rig.kneeL.rotation.x = pose.kneeL;
    this.rig.kneeR.rotation.x = pose.kneeR;
    this.rig.upperBody.position.y = pose.upperBodyY;
    this.rig.upperBody.rotation.x = pose.upperBodyRotX;
    this.rig.upperBody.rotation.z = pose.upperBodyRotZ;
    this.rig.head.rotation.x = pose.headRotX;
  }
}
