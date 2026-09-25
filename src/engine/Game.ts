import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Screen } from './Screen';
import { isTouchDevice } from '../ui/device';

/**
 * Aspect-ratio-corrected vignette — three.js's own stock VignetteShader
 * computes `dot(uv, uv)` straight off `vUv` (0..1 on both axes regardless
 * of the screen's actual pixel aspect ratio), so its "circular" darkening
 * is only actually circular on a square viewport. On a tall phone screen
 * (portrait, height >> width) that turns into a lopsided ellipse: each
 * axis reaches the same darkness at the same UV distance, but a UV unit
 * covers far fewer physical pixels on the narrow axis than the long one,
 * so the short (horizontal) edges darken sharply within a small band while
 * the long (vertical) edges stay clear until much closer to the very top/
 * bottom — an uneven, harder-edged shape rather than the intended soft,
 * even corner darkening. Multiplying uv.x by the aspect ratio (width/
 * height) before the dot product restores a true circle in physical
 * screen space on any viewport.
 */
const AspectCorrectedVignetteShader = {
  name: 'AspectCorrectedVignetteShader',
  uniforms: {
    tDiffuse: { value: null },
    offset: { value: 1.0 },
    darkness: { value: 1.0 },
    aspect: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    uniform float offset;
    uniform float darkness;
    uniform float aspect;
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D( tDiffuse, vUv );
      vec2 uv = ( vUv - vec2( 0.5 ) ) * vec2( offset );
      uv.x *= aspect;
      gl_FragColor = vec4( mix( texel.rgb, vec3( 1.0 - darkness ), dot( uv, uv ) ), texel.a );
    }`,
};

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly uiRoot: HTMLElement;
  private current: Screen | null = null;
  private clock = new THREE.Clock();
  private rafHandle = 0;

  private composer: EffectComposer;
  private renderPass: RenderPass;
  private vignettePass: ShaderPass;

  /**
   * Phones/tablets get a cheaper render-quality tier: a 2048px soft shadow
   * map that re-centers on the avatar every frame (see OverworldScreen's
   * dirLight setup) means a full-resolution shadow depth pass every single
   * frame, on top of bloom + MSAA — a PC-tier cost that reads as "the game
   * is heavy" specifically on the weaker GPUs phones/tablets carry. Desktop
   * (mouse/trackpad) keeps the original full-quality settings unchanged.
   */
  readonly lowPowerTier = isTouchDevice();

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.uiRoot = uiRoot;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.lowPowerTier });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowPowerTier ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = this.lowPowerTier ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    // Filmic tone mapping alone is one of the cheapest, highest-impact moves
    // away from a flat/cartoon look — it rolls off highlights and deepens
    // contrast the way a real camera/game-engine tonemapper does.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Placeholder scene/camera until the first screen mounts via goTo().
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    // UnrealBloomPass's internal render targets are sized off this
    // resolution — halving it on the low-power tier cuts the bloom pass's
    // own GPU cost roughly 4x, on top of the shadow/AA/pixel-ratio savings above.
    const bloomResolution = this.lowPowerTier
      ? new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2)
      : new THREE.Vector2(window.innerWidth, window.innerHeight);
    const bloomPass = new UnrealBloomPass(bloomResolution, 0.4, 0.55, 0.86);
    // Subtle vignette: darkens the far corners a little to draw the eye
    // toward the center, another cheap trick real engines lean on to avoid
    // a flat, uniformly-lit "cartoon" frame. Kept light — this isn't meant
    // to be noticed, just felt.
    this.vignettePass = new ShaderPass(AspectCorrectedVignetteShader);
    this.vignettePass.uniforms.offset.value = 0.9;
    this.vignettePass.uniforms.darkness.value = 1.15;
    const outputPass = new OutputPass();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(bloomPass);
    this.composer.addPass(this.vignettePass);
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
    this.vignettePass.uniforms.aspect.value = width / height;
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

  /**
   * Lets a screen modulate the ambient vignette's darkness around its tuned
   * default (1.15) — currently driven by OverworldScreen's own worldMood
   * hook (see WorldStateSystem.worldMoodFactor), so Ipêra visibly feels a
   * little less oppressive as the player pushes hope over corruption. The
   * vignette pass is shared across every screen (this.composer never
   * rebuilds it), so a value set here persists until something sets it
   * again — intentionally subtle enough (see its own construction comment)
   * that this doesn't look out of place on a screen that never calls this.
   */
  setVignetteDarkness(darkness: number): void {
    this.vignettePass.uniforms.darkness.value = darkness;
  }

  dispose(): void {
    cancelAnimationFrame(this.rafHandle);
    this.current?.unmount();
  }
}
