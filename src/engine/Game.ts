import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Screen } from './Screen';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly uiRoot: HTMLElement;
  private current: Screen | null = null;
  private clock = new THREE.Clock();
  private rafHandle = 0;

  private composer: EffectComposer;
  private renderPass: RenderPass;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.uiRoot = uiRoot;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Filmic tone mapping alone is one of the cheapest, highest-impact moves
    // away from a flat/cartoon look — it rolls off highlights and deepens
    // contrast the way a real camera/game-engine tonemapper does.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Placeholder scene/camera until the first screen mounts via goTo().
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.55, 0.86);
    const outputPass = new OutputPass();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(bloomPass);
    this.composer.addPass(outputPass);

    this.resize();

    window.addEventListener('resize', () => this.resize());
    this.loop();
  }

  goTo(screen: Screen): void {
    this.current?.unmount();
    this.uiRoot.replaceChildren();
    this.current = screen;
    screen.mount();
    this.renderPass.scene = screen.scene;
    this.renderPass.camera = screen.camera;
    this.resize();
  }

  private resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.current?.onResize?.(width, height);
  }

  private loop = (): void => {
    this.rafHandle = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.current) {
      this.current.update(dt);
      this.composer.render();
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.rafHandle);
    this.current?.unmount();
  }
}
