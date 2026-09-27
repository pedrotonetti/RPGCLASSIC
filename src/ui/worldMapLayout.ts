import { getClassById } from '../config/classes';
import { CLASS_ZONE_THEMES } from '../data/classZones';
import { getDungeonByZoneId } from '../data/dungeons';
import { MAIN_CITY_ID, ZONE_DEFINITIONS } from '../data/zones';

/**
 * Pure (DOM-free, unit-testable) layout for the "Mapa Mundi" world-map
 * overlay (see ui/worldMap.ts): which settlements it shows, where each one
 * sits, and which ones are joined by a road.
 *
 * The world's real topology is a hub-and-spokes: Pedravale (the shared main
 * city) in the middle, one road out to every class's secondary village, and
 * from each of those one more road out to that same class's starting
 * village. The ROADS here are read straight off the actual `ZoneExit`s in
 * data/zones.ts (never re-typed by hand), so the map can't drift out of sync
 * with where the exits really lead.
 *
 * Positions are fractions (0..1) of the map area, computed twice — once for
 * a portrait-shaped area (class territories as columns above/below
 * Pedravale) and once for a landscape-shaped one (territories as rows to its
 * left/right) — and the stylesheet picks between them with an orientation
 * media query. A true radial ring can't fit 16 readable village labels at
 * phone width, but a spoked two-sided layout keeps Pedravale in the center
 * with every class's territory still radiating out from it.
 */

export type WorldMapNodeKind = 'capital' | 'secondary' | 'start';

export interface WorldMapPoint {
  x: number;
  y: number;
}

export interface WorldMapRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface WorldMapNode {
  zoneId: string;
  name: string;
  kind: WorldMapNodeKind;
  /** Owning class — null only for Pedravale, which belongs to every class. */
  classId: string | null;
  portrait: WorldMapPoint;
  landscape: WorldMapPoint;
}

export interface WorldMapTerritory {
  classId: string;
  className: string;
  /** The class's own in-world `accentColor` as a CSS hex string, lightened (hue kept) only if it's too dark to read on the dark UI panels — see readableAccent. */
  displayHex: string;
  displayRgb: [number, number, number];
  /** Which half of the map this territory sits in: 'a' = above (portrait) / left (landscape) of Pedravale, 'b' = below / right. Its caption sits at the outer end. */
  side: 'a' | 'b';
  portrait: WorldMapRect;
  landscape: WorldMapRect;
}

export interface WorldMapLink {
  from: string;
  to: string;
  /** 'main' = a road into Pedravale itself; 'local' = a road inside one class's own territory. */
  kind: 'main' | 'local';
  /** Owning class of a 'local' road, null for a 'main' one. */
  classId: string | null;
}

export interface WorldMapLayout {
  nodes: WorldMapNode[];
  territories: WorldMapTerritory[];
  links: WorldMapLink[];
}

const CENTER: WorldMapPoint = { x: 0.5, y: 0.5 };

/**
 * Radial distance (fraction of the map area) from the map's outer edge for
 * each ring, per orientation. Landscape's start ring sits further in than
 * portrait's because there the class caption shares the SAME axis as the
 * cards (it's at the row's outer end, left of the start card) — style.css
 * caps that caption to the first ~0.1 of the width (.wm-territory-caption's
 * landscape max-width), and the start card begins just past it.
 */
const PORTRAIT_RINGS = { start: 0.13, secondary: 0.31, territoryInner: 0.405, edge: 0.005, gap: 0.008 };
const LANDSCAPE_RINGS = { start: 0.167, secondary: 0.31, territoryInner: 0.395, edge: 0.004, gap: 0.014 };

export function hexString(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function rgbOf(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [Math.round(hue(p, q, h + 1 / 3) * 255), Math.round(hue(p, q, h) * 255), Math.round(hue(p, q, h - 1 / 3) * 255)];
}

/**
 * Minimum luminance a class color is lifted to before it's used for text or
 * borders on the map: ~4.5:1 contrast against the dark `--panel` background
 * the overlay is drawn on. Two classes' real territory tints (Assassino's
 * 0x2a2a35, Necromante's 0x2f1f3a) are near-black and would otherwise simply
 * vanish against it.
 */
export const MIN_ACCENT_LUMINANCE = 0.22;

/**
 * `color` unchanged if it's already bright enough to read on the dark UI,
 * otherwise the same hue/saturation with its HSL lightness raised just far
 * enough to clear MIN_ACCENT_LUMINANCE — so every class keeps its own
 * recognizable tint instead of all the dark ones collapsing to one grey.
 */
export function readableAccent(color: number): [number, number, number] {
  const rgb = rgbOf(color);
  if (relativeLuminance(rgb) >= MIN_ACCENT_LUMINANCE) return rgb;
  const [h, s, l] = rgbToHsl(rgb);
  for (let lightness = l; lightness <= 1; lightness += 0.01) {
    const candidate = hslToRgb([h, s, lightness]);
    if (relativeLuminance(candidate) >= MIN_ACCENT_LUMINANCE) return candidate;
  }
  return [255, 255, 255];
}

function rgbHex([r, g, b]: [number, number, number]): string {
  return hexString((r << 16) | (g << 8) | b);
}

/**
 * The zone the "você está aqui" marker belongs on: a dungeon instance isn't
 * a settlement of its own on the world map, so it's marked at the zone its
 * entrance portal stands in.
 */
export function worldMapFocusZone(zoneId: string): string {
  return getDungeonByZoneId(zoneId)?.portal.hostZoneId ?? zoneId;
}

export function buildWorldMapLayout(): WorldMapLayout {
  const themes = CLASS_ZONE_THEMES;
  const sideACount = Math.ceil(themes.length / 2);
  const sideBCount = themes.length - sideACount;

  const nodes: WorldMapNode[] = [
    { zoneId: MAIN_CITY_ID, name: ZONE_DEFINITIONS[MAIN_CITY_ID].name, kind: 'capital', classId: null, portrait: CENTER, landscape: CENTER },
  ];
  const territories: WorldMapTerritory[] = [];

  themes.forEach((theme, i) => {
    const side: 'a' | 'b' = i < sideACount ? 'a' : 'b';
    const slot = side === 'a' ? i : i - sideACount;
    const count = side === 'a' ? sideACount : sideBCount;
    // Position ACROSS the spread axis (portrait x / landscape y)…
    const across = (slot + 0.5) / count;
    const acrossLo = slot / count;
    const acrossHi = (slot + 1) / count;
    // …and ALONG the radial axis, measured in from whichever edge this side's territories grow out toward.
    const radial = (d: number) => (side === 'a' ? d : 1 - d);

    const p = PORTRAIT_RINGS;
    const l = LANDSCAPE_RINGS;
    nodes.push({
      zoneId: theme.secondaryVillageId,
      name: theme.secondaryVillageName,
      kind: 'secondary',
      classId: theme.classId,
      portrait: { x: across, y: radial(p.secondary) },
      landscape: { x: radial(l.secondary), y: across },
    });
    nodes.push({
      zoneId: theme.startVillageId,
      name: theme.startVillageName,
      kind: 'start',
      classId: theme.classId,
      portrait: { x: across, y: radial(p.start) },
      landscape: { x: radial(l.start), y: across },
    });

    const displayRgb = readableAccent(theme.accentColor);
    const pOuter = radial(p.edge);
    const pInner = radial(p.territoryInner);
    const lOuter = radial(l.edge);
    const lInner = radial(l.territoryInner);
    territories.push({
      classId: theme.classId,
      className: getClassById(theme.classId).name,
      displayHex: rgbHex(displayRgb),
      displayRgb,
      side,
      portrait: { x0: acrossLo + p.gap, x1: acrossHi - p.gap, y0: Math.min(pOuter, pInner), y1: Math.max(pOuter, pInner) },
      landscape: { x0: Math.min(lOuter, lInner), x1: Math.max(lOuter, lInner), y0: acrossLo + l.gap, y1: acrossHi - l.gap },
    });
  });

  // Roads come from the real zone exits — an undirected link per pair of
  // map settlements that an exit actually joins (each road has an exit at
  // both ends, so dedupe by the sorted pair).
  const nodeById = new Map(nodes.map((n) => [n.zoneId, n]));
  const links: WorldMapLink[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const exit of ZONE_DEFINITIONS[node.zoneId]?.exits ?? []) {
      const other = nodeById.get(exit.toZone);
      if (!other || other.zoneId === node.zoneId) continue;
      const key = [node.zoneId, other.zoneId].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      const touchesCapital = node.kind === 'capital' || other.kind === 'capital';
      links.push({
        from: node.zoneId,
        to: other.zoneId,
        kind: touchesCapital ? 'main' : 'local',
        classId: touchesCapital ? null : node.classId,
      });
    }
  }

  return { nodes, territories, links };
}
