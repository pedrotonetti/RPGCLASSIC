import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { audio } from '../systems/AudioSystem';
import { el } from '../ui/dom';
import { CharacterSelectScreen } from './CharacterSelectScreen';

/**
 * The Chapter 1 hook, condensed from LORE.md into a handful of lines a new
 * player can read in under a minute — world + threat + "something is about
 * to happen to you," nothing from the Act 2/3 twist (that's earned through
 * play, not spoiled at the title screen).
 */
const LINES: string[] = [
  'Há gerações, a terra de Ipêra vive sob a sombra das Ipê-árvores — e em paz.',
  'Diz-se que os mortos não desaparecem: descem pelas raízes e se tornam Raízes, memórias vivas guardadas na terra.',
  'Uma vez por geração, toda Ipê-árvore do continente floresce ao mesmo tempo — a Florescência — e por alguns dias o véu entre vivos e ancestrais fica fino o bastante para se conversar através dele.',
  'Mas as Raízes não descansam mais. Estão inquietas... famintas... apodrecendo.',
  'Um mal sem nome, a que chamam apenas de a Sede, se espalha pelo subsolo. Onde ela passa, ancestrais que deveriam repousar em paz voltam distorcidos.',
  'Em Pedravale, um vilarejo à beira do Verdegal, ninguém imagina o que esta noite está prestes a mudar.',
  'Uma nova voz está prestes a despertar — capaz de ouvir as Raízes como ninguém há gerações.',
];

const MOTE_CEILING = 6.2;

function makeGlowSprite(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 235, 180, 1)');
  gradient.addColorStop(0.4, 'rgba(242, 193, 78, 0.6)');
  gradient.addColorStop(1, 'rgba(242, 193, 78, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/** Narrative intro shown once per new game, between the main menu and character creation. */
export class IntroScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private time = 0;
  private motes!: THREE.Points;
  private moteBaseY: number[] = [];
  private moteSpeed: number[] = [];
  private lineIndex = 0;
  private started = false;
  private fadeTimeout = 0;

  private lineEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private ctaBtn!: HTMLElement;

  constructor(private game: Game) {
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 60);
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x0d0a12);
    this.scene.fog = new THREE.FogExp2(0x1a1423, 0.05);

    const ambient = new THREE.AmbientLight(0x4a3f5e, 0.6);
    const moon = new THREE.DirectionalLight(0x9fb3d9, 0.35);
    moon.position.set(-3, 6, -2);
    const glow = new THREE.PointLight(0xf2c14e, 1.6, 14, 2);
    glow.position.set(0, 3.4, -2.2);
    this.scene.add(ambient, moon, glow);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(9, 24),
      new THREE.MeshStandardMaterial({ color: 0x140f1c, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.buildTree();
    this.buildMotes();

    this.camera.position.set(0, 2.4, 7.5);
    this.camera.lookAt(0, 2.6, -2.2);

    this.buildUi();
    window.addEventListener('keydown', this.onKeyDown);
  }

  unmount(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.clearTimeout(this.fadeTimeout);
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    this.camera.position.x = Math.sin(this.time * 0.06) * 7.5;
    this.camera.position.z = Math.cos(this.time * 0.06) * 7.5 - 1;
    this.camera.position.y = 2.4 + Math.sin(this.time * 0.15) * 0.15;
    this.camera.lookAt(0, 2.6, -2.2);
    this.updateMotes();
  }

  private buildTree(): void {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.9 });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.55, 3.6, 10), trunkMat);
    trunk.position.set(0, 1.8, -2.5);
    trunk.castShadow = true;
    this.scene.add(trunk);

    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x352a49, roughness: 0.85, flatShading: true });
    const blossomMat = new THREE.MeshStandardMaterial({
      color: 0xe08fae,
      roughness: 0.6,
      flatShading: true,
      emissive: 0x5a2f3f,
      emissiveIntensity: 0.35,
    });

    // Five overlapping lobes read as one full, irregular canopy in
    // silhouette; small blossom puffs on each evoke the Florescência
    // without needing a real flower asset.
    const lobes: Array<[number, number, number, number]> = [
      [0, 3.6, -2.5, 1.5],
      [-1.1, 3.3, -2.0, 1.05],
      [1.2, 3.4, -3.0, 1.1],
      [0.2, 4.3, -2.7, 1.0],
      [-0.8, 4.0, -1.7, 0.8],
    ];
    for (const [x, y, z, s] of lobes) {
      const canopy = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), canopyMat);
      canopy.position.set(x, y, z);
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      this.scene.add(canopy);

      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + x;
        const blossom = new THREE.Mesh(new THREE.IcosahedronGeometry(s * 0.22, 0), blossomMat);
        blossom.position.set(x + Math.cos(a) * s * 0.9, y + Math.sin(a * 1.7) * s * 0.5, z + Math.sin(a) * s * 0.9);
        this.scene.add(blossom);
      }
    }
  }

  private buildMotes(): void {
    const count = 140;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 1.5 + Math.random() * 6;
      const y = Math.random() * MOTE_CEILING;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = Math.sin(angle) * radius - 2;
      this.moteBaseY.push(y);
      this.moteSpeed.push(0.25 + Math.random() * 0.35);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.16,
      map: makeGlowSprite(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: 0xf2c14e,
      sizeAttenuation: true,
    });
    this.motes = new THREE.Points(geo, mat);
    this.scene.add(this.motes);
  }

  private updateMotes(): void {
    const pos = this.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = (this.moteBaseY[i] + this.time * this.moteSpeed[i]) % MOTE_CEILING;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    // Slow global rotation gives the whole field of motes a lazy drifting
    // orbit for free, without accumulating per-particle drift error.
    this.motes.rotation.y = this.time * 0.04;
  }

  private buildUi(): void {
    this.lineEl = el('div', { className: 'intro-line', text: LINES[0] });
    this.hintEl = el('div', { className: 'dialogue-hint', text: '(clique, E ou Enter para continuar)' });
    this.ctaBtn = el('div', {
      className: 'btn primary intro-cta',
      text: 'Começar Aventura >',
      onClick: () => this.proceed(),
    });
    this.ctaBtn.hidden = true;

    const panel = el('div', { className: 'panel intro-panel', onClick: () => this.advance() }, [
      this.lineEl,
      this.hintEl,
      this.ctaBtn,
    ]);

    const skip = el('div', {
      className: 'intro-skip',
      text: 'Pular introdução >',
      onClick: () => this.proceed(),
    });

    const root = el('div', { className: 'intro-screen screen' }, [skip, panel]);
    this.game.uiRoot.append(root);
  }

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') {
      this.proceed();
      return;
    }
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'e' || ev.key === 'E') {
      ev.preventDefault();
      this.advance();
    }
  };

  private advance(): void {
    if (this.lineIndex < LINES.length - 1) {
      this.lineIndex += 1;
      audio.npcTalk();
      this.setLine(LINES[this.lineIndex]);
      if (this.lineIndex === LINES.length - 1) {
        this.hintEl.hidden = true;
        this.ctaBtn.hidden = false;
      }
    } else {
      this.proceed();
    }
  }

  private setLine(text: string): void {
    this.lineEl.style.opacity = '0';
    window.clearTimeout(this.fadeTimeout);
    this.fadeTimeout = window.setTimeout(() => {
      this.lineEl.textContent = text;
      this.lineEl.style.opacity = '1';
    }, 220);
  }

  private proceed(): void {
    if (this.started) return;
    this.started = true;
    this.game.goTo(new CharacterSelectScreen(this.game));
  }
}
