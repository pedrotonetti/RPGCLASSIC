import * as THREE from 'three';
import type { WorldEventKind } from '../data/worldEvents';
import { el } from '../ui/dom';

export interface WorldEventHud {
  /** Sets the persistent banner (title + detail line), or hides it with null. Cheap to call every frame — it only touches the DOM when the text changes. */
  setBanner(banner: { title: string; detail: string; kind: WorldEventKind } | null): void;
  /** A transient line announcing a start/end — replaces whatever toast is showing. */
  showToast(text: string, seconds?: number): void;
  /** Ages the toast; call every frame. */
  tick(dt: number): void;
  arrowEl: HTMLElement;
  dispose(): void;
}

export function buildWorldEventHud(parent: HTMLElement): WorldEventHud {
  const titleEl = el('div', { className: 'wev-title' });
  const detailEl = el('div', { className: 'wev-detail' });
  const bannerEl = el('div', { className: 'world-event-banner' }, [titleEl, detailEl]);
  bannerEl.hidden = true;
  const toastEl = el('div', { className: 'world-event-toast' });
  toastEl.hidden = true;
  const arrowEl = el('div', { className: 'quest-arrow event-arrow' });
  arrowEl.hidden = true;
  parent.append(bannerEl, toastEl, arrowEl);

  let shown = '';
  let toastLeft = 0;

  return {
    arrowEl,
    setBanner(banner) {
      if (!banner) {
        if (!bannerEl.hidden) bannerEl.hidden = true;
        shown = '';
        return;
      }
      const key = `${banner.kind}|${banner.title}|${banner.detail}`;
      if (key === shown) return;
      shown = key;
      bannerEl.dataset.kind = banner.kind;
      titleEl.textContent = banner.title;
      detailEl.textContent = banner.detail;
      bannerEl.hidden = false;
    },
    showToast(text, seconds = 5) {
      toastEl.textContent = text;
      toastEl.hidden = false;
      toastLeft = seconds;
    },
    tick(dt) {
      if (toastLeft <= 0) return;
      toastLeft -= dt;
      if (toastLeft <= 0) toastEl.hidden = true;
    },
    dispose() {
      bannerEl.remove();
      toastEl.remove();
      arrowEl.remove();
    },
  };
}

const MARKER_COLOR: Record<WorldEventKind, string> = {
  invasao: '#ff6b3d',
  mercador: '#f2c14e',
  arvore_corrompida: '#b45cff',
  nevoa: '#9fb4c4',
};

/** A pulsing ring with a dot — drawn by updateMinimap inside its 180°-rotated block, so it deliberately uses only symmetric shapes (no text/glyphs, which would come out upside down). `x`/`y` are already minimap pixels. */
export function drawEventMinimapMarker(ctx: CanvasRenderingContext2D, x: number, y: number, kind: WorldEventKind, time: number): void {
  const color = MARKER_COLOR[kind];
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, y, 5 + Math.sin(time * 4) * 1.2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 1.6, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Points `arrowEl` (styled like the quest arrow) at a world position: a ring
 * right over it while on screen, otherwise an edge-clamped triangle rotated
 * toward it. Same bearing math as OverworldScreen.updateQuestIndicator,
 * keyed off the same fixed camera yaw.
 */
export function pointArrowAt(arrowEl: HTMLElement, target: { x: number; z: number }, avatar: THREE.Vector3, camera: THREE.Camera, cameraYaw: number): void {
  const dx = target.x - avatar.x;
  const dz = target.z - avatar.z;
  const forward = { x: Math.sin(cameraYaw), z: Math.cos(cameraYaw) };
  const right = { x: -Math.cos(cameraYaw), z: Math.sin(cameraYaw) };
  const screenDX = dx * right.x + dz * right.z;
  const screenDY = -(dx * forward.x + dz * forward.z);
  const len = Math.hypot(screenDX, screenDY) || 1;
  const dirX = screenDX / len;
  const dirY = screenDY / len;
  const angleDeg = (Math.atan2(dirX, -dirY) * 180) / Math.PI;

  arrowEl.hidden = false;
  const proj = new THREE.Vector3(target.x, 1.4, target.z).project(camera);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (proj.z < 1 && proj.x >= -1 && proj.x <= 1 && proj.y >= -1 && proj.y <= 1) {
    arrowEl.classList.add('on-target');
    arrowEl.style.left = `${(proj.x * 0.5 + 0.5) * w}px`;
    arrowEl.style.top = `${(-proj.y * 0.5 + 0.5) * h}px`;
    arrowEl.style.transform = 'translate(-50%, -50%) rotate(0deg)';
    return;
  }
  arrowEl.classList.remove('on-target');
  const margin = 42;
  const scaleX = dirX !== 0 ? (w / 2 - margin) / Math.abs(dirX) : Infinity;
  const scaleY = dirY !== 0 ? (h / 2 - margin) / Math.abs(dirY) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  arrowEl.style.left = `${w / 2 + dirX * scale}px`;
  arrowEl.style.top = `${h / 2 + dirY * scale}px`;
  arrowEl.style.transform = `translate(-50%, -50%) rotate(${angleDeg}deg)`;
}
