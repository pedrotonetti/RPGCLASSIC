import * as THREE from 'three';

/**
 * One "place" the game can be in (main menu, overworld, battle...). Each
 * screen owns its own Three.js scene and camera; `Game` just asks it to
 * mount/update/unmount and renders whatever `scene`/`camera` it exposes.
 */
export interface Screen {
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Called once when the screen becomes active. Build meshes/DOM UI here. */
  mount(): void;
  /** Called every frame while active, before rendering. */
  update(dt: number): void;
  /** Called once when leaving the screen. Dispose meshes/DOM UI here. */
  unmount(): void;
  onResize?(width: number, height: number): void;
}
