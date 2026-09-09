import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Loader for real rigged/animated glTF assets (as opposed to the procedural
 * primitive rigs in `characterModel.ts`). This is the entry point for
 * bringing in properly-modeled, properly-licensed free 3D assets — see
 * `public/models/CREDITS.md` for what's vendored and its license.
 */

const MODELS_BASE = `${import.meta.env.BASE_URL}models/`;

interface LoadedGltf {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const loader = new GLTFLoader();
const gltfCache = new Map<string, Promise<LoadedGltf>>();

function loadGltf(fileName: string): Promise<LoadedGltf> {
  let promise = gltfCache.get(fileName);
  if (!promise) {
    promise = loader.loadAsync(MODELS_BASE + fileName).then((gltf) => ({
      scene: gltf.scene,
      animations: gltf.animations,
    }));
    gltfCache.set(fileName, promise);
  }
  return promise;
}

/** Loads (once, cached) a glTF and returns an independently-posable clone — safe to call many times for many instances animating differently off one shared parse. */
export async function loadSkinnedInstance(fileName: string): Promise<LoadedGltf> {
  const base = await loadGltf(fileName);
  const scene = cloneSkinned(base.scene) as THREE.Group;
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
  return { scene, animations: base.animations };
}

/** Drives one glTF instance's baked-in animation clips (Mixamo/Khronos-style named clips) via THREE.AnimationMixer, with crossfaded transitions between them. */
export class GltfActor {
  readonly root: THREE.Group;
  private mixer: THREE.AnimationMixer;
  private clips = new Map<string, THREE.AnimationClip>();
  private current: THREE.AnimationAction | null = null;
  private currentName: string | null = null;

  constructor(model: LoadedGltf) {
    this.root = model.scene;
    this.mixer = new THREE.AnimationMixer(this.root);
    for (const clip of model.animations) this.clips.set(clip.name, clip);
  }

  get clipNames(): string[] {
    return [...this.clips.keys()];
  }

  get playing(): string | null {
    return this.currentName;
  }

  play(name: string, opts: { loop?: boolean; fade?: number } = {}): void {
    if (this.currentName === name) return;
    const clip = this.clips.get(name);
    if (!clip) return;
    const { loop = true, fade = 0.3 } = opts;

    const next = this.mixer.clipAction(clip);
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    if (this.current) next.crossFadeFrom(this.current, fade, true);
    next.play();
    this.current = next;
    this.currentName = name;
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }
}
