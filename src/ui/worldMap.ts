import { audio } from '../systems/AudioSystem';
import { el } from './dom';
import { buildWorldMapLayout, worldMapFocusZone, type WorldMapNode, type WorldMapNodeKind, type WorldMapPoint, type WorldMapRect } from './worldMapLayout';

/**
 * "Mapa Mundi" — a read-only, bird's-eye diagram of the whole world's
 * settlement layout (Pedravale in the middle, every class's secondary and
 * starting village radiating out from it), as opposed to the per-zone
 * minimap's local terrain. Plain DOM + one tiny inline SVG per orientation
 * for the roads: no canvas, no images, no per-frame work — it's built once
 * (lazily, the first time it's opened) and only shown/hidden after that.
 *
 * Every position comes from worldMapLayout.ts as a pair of fractions (one
 * portrait layout, one landscape one), written onto each element as CSS
 * custom properties; style.css's orientation media query picks which pair
 * is live, so rotating the phone re-lays the map out with no JS at all.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function iconSvg(viewBox: string, className: string, parts: SVGElement[]): SVGSVGElement {
  const root = svg('svg', { viewBox, class: className, 'aria-hidden': 'true' }) as SVGSVGElement;
  root.append(...parts);
  return root;
}

const DOOR = '#1a1423';

/** Small hut — a class's starting village. */
function hutIcon(className = 'wm-node-icon'): SVGSVGElement {
  return iconSvg('0 0 16 16', className, [
    svg('path', { d: 'M1.5 8.2 L8 2.2 L14.5 8.2 Z', fill: 'currentColor' }),
    svg('rect', { x: 3.4, y: 8.2, width: 9.2, height: 6.3, fill: 'currentColor' }),
    svg('rect', { x: 6.9, y: 10.4, width: 2.2, height: 4.1, fill: DOOR }),
  ]);
}

/** Crenellated tower — a class's more developed secondary town. */
function towerIcon(className = 'wm-node-icon'): SVGSVGElement {
  return iconSvg('0 0 16 16', className, [
    svg('path', { d: 'M4 15 V6.2 H3 V1.8 H5.2 V3.4 H6.9 V1.8 H9.1 V3.4 H10.8 V1.8 H13 V6.2 H12 V15 Z', fill: 'currentColor' }),
    svg('path', { d: 'M6.8 15 V11.6 A1.2 1.2 0 0 1 9.2 11.6 V15 Z', fill: DOOR }),
  ]);
}

/** Walled castle with a banner — Pedravale, the shared main city. */
function castleIcon(className = 'wm-node-icon'): SVGSVGElement {
  const crenels: SVGElement[] = [];
  for (const x of [1, 3.25, 5.5, 17, 19.25, 21.5]) crenels.push(svg('rect', { x, y: 5, width: 1.5, height: 2.2, fill: 'currentColor' }));
  return iconSvg('0 0 24 20', className, [
    svg('rect', { x: 1, y: 7, width: 6, height: 12, fill: 'currentColor' }),
    svg('rect', { x: 17, y: 7, width: 6, height: 12, fill: 'currentColor' }),
    svg('rect', { x: 6, y: 11, width: 12, height: 8, fill: 'currentColor' }),
    svg('rect', { x: 9, y: 4.2, width: 6, height: 14.8, fill: 'currentColor' }),
    ...crenels,
    svg('path', { d: 'M12 4.2 V0.6', stroke: 'currentColor', 'stroke-width': 0.9 }),
    svg('path', { d: 'M12.2 0.6 L16 1.8 L12.2 3 Z', fill: '#e06b6b' }),
    svg('path', { d: 'M10.5 19 V15.3 A1.5 1.5 0 0 1 13.5 15.3 V19 Z', fill: DOOR }),
  ]);
}

/** Globe — the HUD badge that opens this map (see OverworldScreen.buildMinimap). */
export function buildGlobeIconSvg(): SVGSVGElement {
  const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4 };
  return iconSvg('0 0 16 16', 'worldmap-globe-icon', [
    svg('circle', { cx: 8, cy: 8, r: 6.4, ...stroke }),
    svg('ellipse', { cx: 8, cy: 8, rx: 2.8, ry: 6.4, ...stroke }),
    svg('path', { d: 'M1.8 8 H14.2 M2.9 4.8 H13.1 M2.9 11.2 H13.1', ...stroke, 'stroke-width': 1.1 }),
  ]);
}

const ICON_FOR_KIND: Record<WorldMapNodeKind, (className?: string) => SVGSVGElement> = {
  capital: castleIcon,
  secondary: towerIcon,
  start: hutIcon,
};

const KIND_LABEL: Record<WorldMapNodeKind, string> = {
  capital: 'cidade principal',
  secondary: 'vila secundária',
  start: 'vila inicial',
};

const pct = (f: number) => `${(f * 100).toFixed(2)}%`;

function setPointVars(node: HTMLElement, portrait: WorldMapPoint, landscape: WorldMapPoint): void {
  node.style.setProperty('--px', pct(portrait.x));
  node.style.setProperty('--py', pct(portrait.y));
  node.style.setProperty('--lx', pct(landscape.x));
  node.style.setProperty('--ly', pct(landscape.y));
}

function setRectVars(node: HTMLElement, portrait: WorldMapRect, landscape: WorldMapRect): void {
  node.style.setProperty('--px0', pct(portrait.x0));
  node.style.setProperty('--py0', pct(portrait.y0));
  node.style.setProperty('--pw', pct(portrait.x1 - portrait.x0));
  node.style.setProperty('--ph', pct(portrait.y1 - portrait.y0));
  node.style.setProperty('--lx0', pct(landscape.x0));
  node.style.setProperty('--ly0', pct(landscape.y0));
  node.style.setProperty('--lw', pct(landscape.x1 - landscape.x0));
  node.style.setProperty('--lh', pct(landscape.y1 - landscape.y0));
}

export interface WorldMapOverlayOptions {
  /** `player.zoneId` — a dungeon instance's zone is marked at its host settlement (see worldMapFocusZone). */
  currentZoneId: string;
  /** The player's own class, whose territory gets a "sua classe" highlight. */
  playerClassId: string;
  onClose: () => void;
}

export interface WorldMapOverlayHandle {
  root: HTMLElement;
  /** Refreshes the "Você está em: …" subtitle — called on every open, so it follows the player between Pedravale's plazas. */
  setLocationText: (text: string) => void;
}

export function buildWorldMapOverlay(opts: WorldMapOverlayOptions): WorldMapOverlayHandle {
  const layout = buildWorldMapLayout();
  const focusZoneId = worldMapFocusZone(opts.currentZoneId);
  const nodeById = new Map(layout.nodes.map((n) => [n.zoneId, n]));
  const territoryByClass = new Map(layout.territories.map((t) => [t.classId, t]));

  // --- roads: one SVG per orientation (x1/y1/x2/y2 aren't CSS-settable, so
  // the stylesheet just shows whichever one matches) — viewBox 0..100 with
  // preserveAspectRatio="none" makes each coordinate a straight percentage
  // of the map area, the same units every node/territory is positioned in;
  // non-scaling-stroke keeps the line widths/dashes even despite that
  // non-uniform stretch.
  const buildRoads = (orientation: 'portrait' | 'landscape'): SVGSVGElement => {
    const root = svg('svg', {
      class: `worldmap-roads wm-${orientation}`,
      viewBox: '0 0 100 100',
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
    }) as SVGSVGElement;
    for (const link of layout.links) {
      const a = nodeById.get(link.from)![orientation];
      const b = nodeById.get(link.to)![orientation];
      const line = svg('line', {
        x1: a.x * 100,
        y1: a.y * 100,
        x2: b.x * 100,
        y2: b.y * 100,
        class: `wm-road ${link.kind}`,
        'vector-effect': 'non-scaling-stroke',
      });
      if (link.classId) line.setAttribute('stroke', territoryByClass.get(link.classId)?.displayHex ?? '#c9b98a');
      root.append(line);
    }
    return root;
  };

  const territoryEls = layout.territories.map((t) => {
    const own = t.classId === opts.playerClassId;
    const node = el('div', { className: `wm-territory side-${t.side}${own ? ' own' : ''}` }, [
      el('span', { className: 'wm-territory-caption', text: own ? `★ ${t.className}` : t.className }),
    ]);
    setRectVars(node, t.portrait, t.landscape);
    const [r, g, b] = t.displayRgb;
    node.style.setProperty('--wm-color', t.displayHex);
    node.style.setProperty('--wm-tint', `rgba(${r}, ${g}, ${b}, 0.13)`);
    node.style.setProperty('--wm-edge', `rgba(${r}, ${g}, ${b}, 0.45)`);
    return node;
  });

  const nodeEl = (n: WorldMapNode): HTMLElement => {
    const territory = n.classId ? territoryByClass.get(n.classId) : undefined;
    const current = n.zoneId === focusZoneId;
    const describe = territory ? `${n.name} — ${KIND_LABEL[n.kind]} (${territory.className})` : `${n.name} — ${KIND_LABEL[n.kind]}`;
    const node = el(
      'div',
      {
        className: `wm-node ${n.kind}${current ? ' current' : ''}`,
        attrs: { title: current ? `${describe} · você está aqui` : describe, 'data-zone': n.zoneId },
      },
      [
        ICON_FOR_KIND[n.kind](),
        el('div', { className: 'wm-node-text' }, [
          el('div', { className: 'wm-node-name', text: n.name }),
          n.kind === 'capital' ? el('div', { className: 'wm-node-sub', text: 'Cidade principal' }) : null,
        ]),
        current ? el('span', { className: 'wm-pin', attrs: { 'aria-label': 'Você está aqui' } }) : null,
      ],
    );
    setPointVars(node, n.portrait, n.landscape);
    // The class's real in-world accent wherever it's bright enough to read
    // on the dark panel — only the near-black ones get lifted (see readableAccent).
    if (territory) node.style.setProperty('--wm-color', territory.displayHex);
    return node;
  };

  // Territories first, then roads, then settlements on top — roads visibly
  // run into (and under) each village's card instead of across its label.
  const area = el('div', { className: 'worldmap-area' }, [
    ...territoryEls,
    buildRoads('portrait'),
    buildRoads('landscape'),
    ...layout.nodes.map(nodeEl),
  ]);

  const legendItem = (icon: Element, label: string) => {
    const item = el('span', { className: 'wm-legend-item' });
    item.append(icon, label);
    return item;
  };
  const legend = el('div', { className: 'worldmap-legend' }, [
    legendItem(castleIcon('wm-legend-icon capital'), 'Cidade principal'),
    legendItem(towerIcon('wm-legend-icon'), 'Vila secundária'),
    legendItem(hutIcon('wm-legend-icon'), 'Vila inicial'),
    legendItem(el('span', { className: 'wm-pin static' }), 'Você está aqui'),
    legendItem(el('span', { className: 'wm-legend-star', text: '★' }), 'Sua classe'),
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
      el('div', { className: 'worldmap-heading' }, [el('h2', { text: 'Mapa Mundi' }), subtitle]),
      closeBtn,
    ]),
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
    setLocationText: (text: string) => {
      subtitle.textContent = `Você está em: ${text}`;
    },
  };
}
