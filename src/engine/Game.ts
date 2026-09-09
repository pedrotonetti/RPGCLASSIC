import * as THREE from 'three';
import type { Screen } from './Screen';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly uiRoot: HTMLElement;
  private current: Screen | null = null;
  private clock = new THREE.Clock();
  private rafHandle = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.uiRoot = uiRoot;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.resize();

    window.addEventListener('resize', () => this.resize());
    this.loop();
  }

  goTo(screen: Screen): void {
    this.current?.unmount();
    this.uiRoot.replaceChildren();
    this.current = screen;
    screen.mount();
    this.resize();
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.current?.onResize?.(width, height);
  }

  private loop = (): void => {
    this.rafHandle = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.current) {
      this.current.update(dt);
      this.renderer.render(this.current.scene, this.current.camera);
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.rafHandle);
    this.current?.unmount();
  }
}
