import { audio } from '../systems/AudioSystem';
import { el } from './dom';
import { buildWorldMapLayout, worldMapFocusZone, type WorldMapPin } from './worldMapLayout';

/**
 * "Mapa Mundi" — the user's own painted reference map of Ipêra
 * (public/images/world-map-ipera.jpg, 1536x1024) shown as-is, with one small
 * dot per real settlement positioned by a hand-placed fraction of that
 * image (see worldMapLayout.ts) and only the player's own dot picked out
 * (bigger, glowing, labeled) — every other dot is a quiet placeholder for a
 * future fast-travel unlock, not a working teleport yet.
 *
 * This game already has real overworld movement between every one of these
 * settlements; this overlay is purely a "where am I, and where else is
 * there" reference, not a navigable/animated map — so it's built once
 * (lazily, the first time it's opened) and only shown/hidden after that.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Globe — the HUD badge that opens this map (see OverworldScreen.buildMinimap). */
export function buildGlobeIconSvg(): SVGSVGElement {
  const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 };
  const root = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  root.setAttribute('viewBox', '0 0 16 16');
  root.setAttribute('class', 'worldmap-globe-icon');
  root.setAttribute('aria-hidden', 'true');
  root.append(
    svg('circle', { cx: 8, cy: 8, r: 6.4, ...stroke }),
    svg('ellipse', { cx: 8, cy: 8, rx: 2.8, ry: 6.4, ...stroke }),
    svg('path', { d: 'M1.8 8 H14.2 M2.9 4.8 H13.1 M2.9 11.2 H13.1', ...stroke, 'stroke-width': 1.1 }),
  );
  return root;
}

/** The map image's own real aspect ratio (1536x1024, whatever pixel size the served asset is actually resized to) — everything below fits the image to its box by this ratio, never the box's own. */
const MAP_IMAGE_RATIO = 1536 / 1024;
// Relative to the app's own base (see gltfModel.ts's MODELS_BASE) rather than
// a hardcoded '/images/...' — the site is deployed under a subpath, and a
// leading-slash URL resolves to the domain root instead, 404ing silently and
// leaving the map blank behind its pins.
const MAP_IMAGE_URL = `${import.meta.env.BASE_URL}images/world-map-ipera.jpg`;

/**
 * Sizes/positions `stage` (an absolutely-positioned child of `wrap`) to
 * exactly the rectangle the map image itself renders at inside `wrap` —
 * the same box `object-fit: contain` would pick, computed by hand so every
 * pin (placed as a 0-100% position INSIDE stage) lands on the same spot on
 * the image regardless of `wrap`'s own aspect ratio (letterboxed left/right
 * on a wide window, top/bottom on a tall phone screen).
 */
function layoutStage(wrap: HTMLElement, stage: HTMLElement): void {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w <= 0 || h <= 0) return;
  const boxRatio = w / h;
  let stageW: number;
  let stageH: number;
  if (MAP_IMAGE_RATIO > boxRatio) {
    stageW = w;
    stageH = w / MAP_IMAGE_RATIO;
  } else {
    stageH = h;
    stageW = h * MAP_IMAGE_RATIO;
  }
  stage.style.left = `${(w - stageW) / 2}px`;
  stage.style.top = `${(h - stageH) / 2}px`;
  stage.style.width = `${stageW}px`;
  stage.style.height = `${stageH}px`;
}

export interface WorldMapOverlayOptions {
  /** `player.zoneId` — a dungeon instance's zone is marked at its host settlement (see worldMapFocusZone). */
  currentZoneId: string;
  /** The player's own class — its two villages' dots get a small "sua classe" ring. */
  playerClassId: string;
  onClose: () => void;
}

export interface WorldMapOverlayHandle {
  root: HTMLElement;
  /** Moves the glowing "você está aqui" pin to `zoneId` (a dungeon zone resolves to its host settlement — see worldMapFocusZone) and refreshes the "Você está em: …" subtitle. Called on every open, so both follow the player as they travel between opens — this overlay is built once and reused, never rebuilt. */
  refreshLocation: (zoneId: string, text: string) => void;
}

export function buildWorldMapOverlay(opts: WorldMapOverlayOptions): WorldMapOverlayHandle {
  const layout = buildWorldMapLayout();
  let currentZoneId = worldMapFocusZone(opts.currentZoneId);

  const toast = el('div', { className: 'worldmap-toast' });
  let toastTimer: number | undefined;
  const showLockedToast = (pin: WorldMapPin) => {
    window.clearTimeout(toastTimer);
    toast.textContent = `🔒 Viagem rápida para ${pin.name} — ainda não desbloqueada.`;
    toast.classList.add('visible');
    toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
  };

  const pinByZone = new Map<string, HTMLElement>();
  const pinNodes = layout.pins.map((pin) => {
    const own = pin.classId === opts.playerClassId;
    const hasLevel = pin.recommendedLevel !== undefined;
    const describe = `${pin.name}${hasLevel ? ` · nível recomendado ${pin.recommendedLevel}` : ''}`;
    const node = el(
      'div',
      {
        className: `wm-pin-wrap${own ? ' own' : ''}`,
        attrs: { title: describe, 'data-zone': pin.zoneId },
        // Checked live (not baked in at build time): this overlay is built once
        // and reused for the whole session, so whichever pin was "current" the
        // first time it opened would otherwise wrongly stay clickable/locked
        // forever as the player travels to other settlements between opens.
        onClick: () => {
          if (pin.zoneId !== currentZoneId) showLockedToast(pin);
        },
      },
      [el('span', { className: 'wm-dot' }), el('span', { className: 'wm-pin-label', text: pin.name })],
    );
    node.classList.toggle('current', pin.zoneId === currentZoneId);
    node.style.setProperty('--wm-color', pin.color);
    node.style.left = `${pin.point.x * 100}%`;
    node.style.top = `${pin.point.y * 100}%`;
    pinByZone.set(pin.zoneId, node);
    return node;
  });

  const mapImage = el('img', {
    className: 'worldmap-image',
    attrs: { src: MAP_IMAGE_URL, alt: 'Mapa de Ipêra', draggable: 'false' },
  });

  const stage = el('div', { className: 'worldmap-stage' }, [mapImage, ...pinNodes]);
  const wrap = el('div', { className: 'worldmap-image-wrap' }, [stage]);
  const area = el('div', { className: 'worldmap-area' }, [wrap]);

  const resizeObserver = new ResizeObserver(() => layoutStage(wrap, stage));
  resizeObserver.observe(wrap);

  const legend = el('div', { className: 'worldmap-legend' }, [
    el('span', { className: 'wm-legend-item' }, [el('span', { className: 'wm-dot legend current' }), 'Você está aqui']),
    el('span', { className: 'wm-legend-item' }, [el('span', { className: 'wm-dot legend' }), 'Outros locais — viagem rápida em breve']),
  ]);

  const subtitle = el('div', { className: 'worldmap-subtitle' });
  const closeBtn = el('div', {
    className: 'worldmap-close-btn',
    text: '✕',
    onClick: () => opts.onClose(),
    attrs: { title: 'Fechar mapa mundi', 'aria-label': 'Fechar mapa mundi' },
  });
  const panel = el('div', { className: 'panel worldmap-panel' }, [
    el('div', { className: 'worldmap-header' }, [
      el('div', { className: 'worldmap-heading' }, [
        el('div', { className: 'worldmap-wordmark', text: 'IPÊRA' }),
        el('h2', { text: 'Mapa Mundi' }),
        subtitle,
      ]),
      closeBtn,
    ]),
    toast,
    area,
    legend,
  ]);

  const root = el('div', { className: 'worldmap-overlay', attrs: { role: 'dialog', 'aria-label': 'Mapa Mundi' } }, [panel]);
  // Tap outside the panel closes, same as the expanded minimap's backdrop —
  // wired by hand (not el's onClick) so a tap INSIDE the panel, which
  // bubbles up here too, doesn't also play the UI click sound.
  root.addEventListener('click', (ev) => {
    if (ev.target !== root) return;
    audio.uiClick();
    opts.onClose();
  });

  return {
    root,
    refreshLocation: (zoneId: string, text: string) => {
      const nextFocus = worldMapFocusZone(zoneId);
      if (nextFocus !== currentZoneId) {
        pinByZone.get(currentZoneId)?.classList.remove('current');
        pinByZone.get(nextFocus)?.classList.add('current');
        currentZoneId = nextFocus;
      }
      subtitle.textContent = `Você está em: ${text}`;
    },
  };
}
