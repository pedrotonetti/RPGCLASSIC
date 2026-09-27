import { CLASS_ZONE_THEMES } from '../data/classZones';
import { getDungeonByZoneId } from '../data/dungeons';
import { ANCORADOURO_VAU_ID, BALUARTE_AMANHECER_ID, MAIN_CITY_ID, REGIONAL_SETTLEMENTS, ZONE_DEFINITIONS, type RegionalSettlementKind } from '../data/zones';

/**
 * Pure (DOM-free, unit-testable) layout for the "Mapa Mundi" overlay (see
 * ui/worldMap.ts): which settlements it shows and where each one sits.
 *
 * Positions are fractions (0..1) of `public/images/world-map-ipera.jpg`'s
 * OWN box (1536x1024) — hand-placed to match that hand-painted map's real
 * city positions, not computed from the world's hub-and-spokes topology the
 * way the previous schematic-diagram layout was. The image is drawn at a
 * fixed aspect ratio (ui/worldMap.ts wraps it in an `aspect-ratio` box), so a
 * pin at (x, y) stays glued to its own painted city regardless of how large
 * the box is drawn — one coordinate set covers every screen/orientation,
 * unlike the old portrait/landscape pair.
 */

export type WorldMapPinKind = 'capital' | 'secondary' | 'start' | RegionalSettlementKind;

export interface WorldMapPoint {
  x: number;
  y: number;
}

export interface WorldMapPin {
  zoneId: string;
  name: string;
  kind: WorldMapPinKind;
  /** Owning class — null for Pedravale (which belongs to every class) and for the regional settlements (which belong to none). */
  classId: string | null;
  point: WorldMapPoint;
  /** The zone's own soft level guide (ZoneDefinition.recommendedLevel) — set only where the zone defines one. */
  recommendedLevel?: number;
  /** This pin's dot color, already lifted to MIN_ACCENT_LUMINANCE where needed — worldMap.ts never touches a raw class/theme color itself. */
  color: string;
}

export interface WorldMapLayout {
  pins: WorldMapPin[];
}

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
 * Minimum luminance a class color is lifted to before it's used for a pin
 * dot on the map image: ~4.5:1 contrast against both the image's own dark
 * water and its bright parchment-toned land. Two classes' real territory
 * tints (Assassino's 0x2a2a35, Necromante's 0x2f1f3a) are near-black and
 * would otherwise simply vanish.
 */
export const MIN_ACCENT_LUMINANCE = 0.22;

/**
 * `color` unchanged if it's already bright enough to read, otherwise the
 * same hue/saturation with its HSL lightness raised just far enough to
 * clear MIN_ACCENT_LUMINANCE — so every class keeps its own recognizable
 * tint instead of all the dark ones collapsing to one grey.
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

export function readableAccentHex(color: number): string {
  const [r, g, b] = readableAccent(color);
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

/**
 * Every class's two villages' positions on the painted map image, read by
 * hand off `public/images/world-map-ipera.jpg` — see this module's own doc
 * comment. Keyed by classId (not zoneId): `buildWorldMapLayout` below joins
 * this against `CLASS_ZONE_THEMES` for the real zoneId/name, so a class's
 * name/id can never drift out of sync with the actual game data the way a
 * flat hand-typed zoneId table could.
 */
const CLASS_VILLAGE_POSITIONS: Record<string, { start: WorldMapPoint; secondary: WorldMapPoint }> = {
  warrior: { start: { x: 0.26, y: 0.148 }, secondary: { x: 0.26, y: 0.208 } },
  mage: { start: { x: 0.433, y: 0.205 }, secondary: { x: 0.456, y: 0.244 } },
  archer: { start: { x: 0.294, y: 0.322 }, secondary: { x: 0.304, y: 0.363 } },
  cleric: { start: { x: 0.267, y: 0.479 }, secondary: { x: 0.267, y: 0.518 } },
  paladin: { start: { x: 0.41, y: 0.64 }, secondary: { x: 0.41, y: 0.604 } },
  assassin: { start: { x: 0.735, y: 0.205 }, secondary: { x: 0.722, y: 0.244 } },
  necromancer: { start: { x: 0.684, y: 0.322 }, secondary: { x: 0.658, y: 0.327 } },
  monk: { start: { x: 0.573, y: 0.64 }, secondary: { x: 0.573, y: 0.601 } },
};

/** Pedravale's own position on the painted map — the gold crowned-castle badge near its center. */
const CAPITAL_POSITION: WorldMapPoint = { x: 0.485, y: 0.376 };

/** Gold, matching --accent — Pedravale belongs to every class, so it gets the map's own signature color instead of any one class's tint. */
const CAPITAL_COLOR = '#f2c14e';
/** A neutral parchment tone for the regional settlements, which (unlike a class's two villages) don't belong to any class's tint. */
const REGIONAL_COLOR = '#c9b98a';

/** The two regional settlements' positions — the anchor badge (west coast) and the cliffside bastion (far east coast). */
const REGIONAL_SETTLEMENT_POSITIONS: Record<string, WorldMapPoint> = {
  [ANCORADOURO_VAU_ID]: { x: 0.173, y: 0.654 },
  [BALUARTE_AMANHECER_ID]: { x: 0.911, y: 0.42 },
};

export function buildWorldMapLayout(): WorldMapLayout {
  const pins: WorldMapPin[] = [
    { zoneId: MAIN_CITY_ID, name: ZONE_DEFINITIONS[MAIN_CITY_ID].name, kind: 'capital', classId: null, point: CAPITAL_POSITION, color: CAPITAL_COLOR },
  ];

  for (const theme of CLASS_ZONE_THEMES) {
    const pos = CLASS_VILLAGE_POSITIONS[theme.classId];
    const color = readableAccentHex(theme.accentColor);
    pins.push({ zoneId: theme.secondaryVillageId, name: theme.secondaryVillageName, kind: 'secondary', classId: theme.classId, point: pos.secondary, color });
    pins.push({ zoneId: theme.startVillageId, name: theme.startVillageName, kind: 'start', classId: theme.classId, point: pos.start, color });
  }

  for (const settlement of REGIONAL_SETTLEMENTS) {
    pins.push({
      zoneId: settlement.zoneId,
      name: settlement.name,
      kind: settlement.kind,
      classId: null,
      point: REGIONAL_SETTLEMENT_POSITIONS[settlement.zoneId],
      recommendedLevel: ZONE_DEFINITIONS[settlement.zoneId].recommendedLevel,
      color: REGIONAL_COLOR,
    });
  }

  return { pins };
}
