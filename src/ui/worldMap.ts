import { audio } from '../systems/AudioSystem';
import { el } from './dom';
import { buildWorldMapLayout, worldMapFocusZone, type WorldMapNode, type WorldMapNodeKind, type WorldMapPoint, type WorldMapRect } from './worldMapLayout';

/**
 * "Mapa Mundi" — a read-only, bird's-eye diagram of the whole world's
 * settlement layout (Pedravale in the middle, every class's secondary and
 * starting village radiating out from it, plus the classless regional
 * settlements beside and beyond it), as opposed to the per-zone
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

/** A small hut above two lines of water — a riverside hamlet just outside Pedravale (the 'satellite' regional settlement). */
function fordHutIcon(className = 'wm-node-icon'): SVGSVGElement {
  const wave = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.2, 'stroke-linecap': 'round' };
  return iconSvg('0 0 16 16', className, [
    svg('path', { d: 'M3 7.4 L8 2.6 L13 7.4 Z', fill: 'currentColor' }),
    svg('rect', { x: 4.4, y: 7.4, width: 7.2, height: 4.2, fill: 'currentColor' }),
    svg('rect', { x: 7, y: 8.9, width: 2, height: 2.7, fill: DOOR }),
    svg('path', { d: 'M1.2 13.4 Q3 12.3 4.8 13.4 T8.4 13.4 T12 13.4 T15.2 13.2', ...wave }),
    svg('path', { d: 'M2.8 15.3 Q4.6 14.2 6.4 15.3 T10 15.3 T13.4 15.2', ...wave, 'stroke-opacity': 0.6 }),
  ]);
}

/** A pointed-stake palisade with a gate and a dawn-colored pennant — a frontier outpost (the 'hub' regional settlement). */
function palisadeIcon(className = 'wm-node-icon'): SVGSVGElement {
  const stakes: SVGElement[] = [];
  for (const x of [0.8, 3.8, 9.8, 12.8]) {
    stakes.push(svg('path', { d: `M${x} 15 V8.4 L${x + 1.2} 6.6 L${x + 2.4} 8.4 V15 Z`, fill: 'currentColor' }));
  }
  return iconSvg('0 0 16 16', className, [
    ...stakes,
    // The gatehouse between the stakes, taller, carrying the pennant.
    svg('path', { d: 'M6.6 15 V6.8 H9.4 V15 Z', fill: 'currentColor' }),
    svg('path', { d: 'M8 6.8 V0.8', stroke: 'currentColor', 'stroke-width': 0.8 }),
    svg('path', { d: 'M8.2 0.8 L12.2 2 L8.2 3.2 Z', fill: '#f2a65a' }),
    svg('path', { d: 'M7.1 15 V12.2 A0.9 0.9 0 0 1 8.9 12.2 V15 Z', fill: DOOR }),
  ]);
}

// --- illustrated terrain backdrop -----------------------------------------
// A single painted-style SVG "underlay" sitting behind the territories/
// roads/nodes (which are unchanged) — the schematic diagram now reads as a
// real map of Ipêra instead of a flowchart. Proportional (unlike the roads
// SVG, which deliberately distorts with preserveAspectRatio="none" since
// straight lines survive stretching): mountains/rivers would look wrong
// stretched, so this uses "slice" (cover-style crop) on a landscape-shaped
// viewBox — the vertical story (mountains north, sea south) survives in
// both phone orientations; only the very left/right fringe crops differently.
// One-time paint, no per-frame cost — same "no per-frame work" budget the
// rest of this file already keeps to.

const TERRAIN_VIEWBOX = '0 0 160 100';

/** Cream parchment-grain speckle over the landmass — a `<filter>` computed once, not per frame. */
function grainFilter(): SVGElement {
  const filter = svg('filter', { id: 'wm-grain', x: '-20%', y: '-20%', width: '140%', height: '140%' });
  const turb = svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9', numOctaves: '2', seed: '7', result: 'noise' });
  const matrix = svg('feColorMatrix', { in: 'noise', type: 'matrix', values: '0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0 0.12  0 0 0 0.05 0' });
  filter.append(turb, matrix);
  return filter;
}

/** A handful of jagged, snow-capped peaks — "Serras de Ipêra", hugging the landmass's northern edge. */
function mountainRange(cx: number, baseY: number): SVGElement {
  const group = svg('g', { class: 'wm-mountains' });
  const peaks = [
    { x: cx - 26, h: 13, w: 15 },
    { x: cx - 13, h: 19, w: 17 },
    { x: cx, h: 24, w: 19 },
    { x: cx + 14, h: 18, w: 17 },
    { x: cx + 27, h: 12, w: 14 },
  ];
  for (const p of peaks) {
    const top = baseY - p.h;
    group.append(
      svg('path', { class: 'wm-peak', d: `M${p.x - p.w / 2} ${baseY} L${p.x} ${top} L${p.x + p.w / 2} ${baseY} Z` }),
      svg('path', { class: 'wm-snowcap', d: `M${p.x - p.w * 0.22} ${top + p.h * 0.32} L${p.x} ${top} L${p.x + p.w * 0.22} ${top + p.h * 0.32} L${p.x + p.w * 0.1} ${top + p.h * 0.38} L${p.x} ${top + p.h * 0.22} L${p.x - p.w * 0.1} ${top + p.h * 0.38} Z` }),
    );
  }
  return group;
}

/** A small tuft of 3 rounded treetops — one unit of the forest texture scattered across the landmass. */
function treeTuft(x: number, y: number, scale: number): SVGElement {
  const g = svg('g', { class: 'wm-tree', transform: `translate(${x} ${y}) scale(${scale})` });
  g.append(
    svg('circle', { cx: -1.1, cy: 0, r: 1.5 }),
    svg('circle', { cx: 1.1, cy: 0, r: 1.5 }),
    svg('circle', { cx: 0, cy: -1.1, r: 1.6 }),
  );
  return g;
}

/** An 8-point compass rose with tick labels — pure flavor, tucked in a map corner. */
function compassRose(cx: number, cy: number, r: number): SVGElement {
  const g = svg('g', { class: 'wm-compass' });
  const points: string[] = [];
  for (let i = 0; i < 16; i++) {
    const angle = (Math.PI / 8) * i - Math.PI / 2;
    const long = i % 4 === 0;
    const rr = long ? r : r * 0.55;
    points.push(`${cx + Math.cos(angle) * rr},${cy + Math.sin(angle) * rr}`);
  }
  g.append(
    svg('circle', { class: 'wm-compass-ring', cx, cy, r: r * 1.22 }),
    svg('polygon', { class: 'wm-compass-star', points: points.join(' ') }),
    svg('circle', { class: 'wm-compass-hub', cx, cy, r: r * 0.14 }),
  );
  const labels: Array<[string, number, number]> = [
    ['N', cx, cy - r * 1.55],
    ['S', cx, cy + r * 1.55 + 3],
    ['L', cx + r * 1.55 + 1.5, cy + 1.2],
    ['O', cx - r * 1.55 - 1.5, cy + 1.2],
  ];
  for (const [t, x, y] of labels) {
    const label = svg('text', { class: 'wm-compass-label', x, y, 'text-anchor': 'middle' });
    label.textContent = t;
    g.append(label);
  }
  return g;
}

/**
 * The illustrated map itself: ocean base, an organic landmass, the northern
 * range, a river running from it through Pedravale's own position down to
 * the southern coast, scattered forest texture, and a corner compass rose —
 * built once, inserted as `.worldmap-area`'s first (so, bottommost) child.
 * `capital`/`across` are the real Pedravale node position (worldMapLayout's
 * CENTER, i.e. 0.5/0.5 today) so the river actually threads through its
 * card instead of an unrelated hand-picked point, even if that constant
 * ever moves.
 */
function buildTerrainBackdrop(capitalFrac: WorldMapPoint): SVGSVGElement {
  const [vbW, vbH] = [160, 100];
  const cx = capitalFrac.x * vbW;
  const cy = capitalFrac.y * vbH;
  const root = svg('svg', {
    class: 'worldmap-terrain',
    viewBox: TERRAIN_VIEWBOX,
    preserveAspectRatio: 'xMidYMid slice',
    'aria-hidden': 'true',
  }) as SVGSVGElement;

  const defs = svg('defs', {});
  const landGradient = svg('linearGradient', { id: 'wm-land-grad', x1: '0', y1: '0', x2: '0', y2: '1' });
  landGradient.append(
    svg('stop', { offset: '0%', 'stop-color': '#6b7a4f' }),
    svg('stop', { offset: '45%', 'stop-color': '#7c8a52' }),
    svg('stop', { offset: '78%', 'stop-color': '#8f8a5a' }),
    svg('stop', { offset: '100%', 'stop-color': '#c9b489' }),
  );
  defs.append(grainFilter(), landGradient);
  root.append(defs);

  root.append(svg('rect', { class: 'wm-ocean', x: 0, y: 0, width: vbW, height: vbH }));

  // A soft, organic coastline — one continuous landmass wide enough to hold
  // every class column (see worldMapLayout's PORTRAIT/LANDSCAPE_RINGS) plus
  // the regional settlements out near its western/eastern shores.
  const land = svg('path', {
    class: 'wm-landmass',
    d: `M14 34
        C 10 22, 22 8, 42 9
        C 58 3, 72 6, 80 12
        C 90 4, 108 5, 118 12
        C 138 8, 152 20, 150 36
        C 156 48, 152 62, 144 70
        C 148 80, 138 92, 122 90
        C 112 98, 96 96, 88 88
        C 74 97, 58 95, 50 86
        C 34 94, 16 88, 12 74
        C 4 64, 6 46, 14 34 Z`,
  });
  root.append(land);

  const grain = svg('rect', { class: 'wm-grain', x: 0, y: 0, width: vbW, height: vbH, filter: 'url(#wm-grain)' });
  root.append(grain);

  root.append(mountainRange(cx, 14));

  // The river: mountains -> Pedravale -> the southern coast, a gentle
  // double-bend so it doesn't read as a ruler-straight line.
  root.append(
    svg('path', {
      class: 'wm-river',
      d: `M${cx - 3} 16 C ${cx + 4} 28, ${cx - 6} 36, ${cx} ${cy} S ${cx + 8} 76, ${cx - 2} 95`,
      fill: 'none',
    }),
  );

  const forest = svg('g', { class: 'wm-forest' });
  const tufts: Array<[number, number, number]> = [
    [30, 26, 1], [24, 44, 0.8], [34, 58, 0.9], [26, 70, 0.7],
    [130, 28, 1], [138, 46, 0.85], [128, 62, 0.95], [136, 76, 0.75],
    [58, 22, 0.7], [102, 24, 0.7], [70, 78, 0.8], [96, 80, 0.8],
    [44, 40, 0.6], [116, 40, 0.6],
  ];
  for (const [x, y, s] of tufts) forest.append(treeTuft(x, y, s));
  root.append(forest);

  // Bottom-left corner: clear open water in every layout this backdrop is
  // actually cropped to (see this function's own doc comment on "slice") —
  // every other corner ends up under a settlement card in at least one.
  root.append(compassRose(11, vbH - 10, 5));

  return root;
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
  satellite: fordHutIcon,
  hub: palisadeIcon,
};

const KIND_LABEL: Record<WorldMapNodeKind, string> = {
  capital: 'cidade principal',
  secondary: 'vila secundária',
  start: 'vila inicial',
  satellite: 'povoado',
  hub: 'posto de fronteira',
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
    const hasLevel = n.recommendedLevel !== undefined;
    const levelText = hasLevel ? `Nv. ${n.recommendedLevel}+` : null;
    const describe = `${n.name} — ${KIND_LABEL[n.kind]}${territory ? ` (${territory.className})` : ''}${hasLevel ? ` · nível recomendado ${n.recommendedLevel}` : ''}`;
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
          // A soft level guide, like a dungeon portal's "Nv. recomendado" — never a gate.
          levelText ? el('div', { className: 'wm-node-sub wm-node-level', text: levelText }) : null,
        ]),
        current ? el('span', { className: 'wm-pin', attrs: { 'aria-label': 'Você está aqui' } }) : null,
      ],
    );
    setPointVars(node, n.portrait, n.landscape);
    // The class's real in-world accent wherever it's bright enough to read
    // on the dark panel — only the near-black ones get lifted (see readableAccent).
    // A classless regional settlement carries its own, computed the same way.
    const color = territory?.displayHex ?? n.displayHex;
    if (color) node.style.setProperty('--wm-color', color);
    return node;
  };

  // Terrain first (bottommost), then territories, then roads, then
  // settlements on top — roads visibly run into (and under) each village's
  // card instead of across its label.
  const capitalNode = nodeById.get('main_city');
  const area = el('div', { className: 'worldmap-area' }, [
    buildTerrainBackdrop(capitalNode?.portrait ?? { x: 0.5, y: 0.5 }),
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
    legendItem(fordHutIcon('wm-legend-icon'), 'Povoado'),
    legendItem(palisadeIcon('wm-legend-icon'), 'Fronteira'),
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
      el('div', { className: 'worldmap-heading' }, [
        el('div', { className: 'worldmap-wordmark', text: 'IPÊRA' }),
        el('h2', { text: 'Mapa Mundi' }),
        subtitle,
      ]),
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
