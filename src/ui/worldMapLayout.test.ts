import { describe, expect, it } from 'vitest';
import { CLASS_ZONE_THEMES } from '../data/classZones';
import { DUNGEON_DEFINITIONS } from '../data/dungeons';
import { ANCORADOURO_VAU_ID, BALUARTE_AMANHECER_ID, MAIN_CITY_ID, REGIONAL_SETTLEMENTS } from '../data/zones';
import {
  buildWorldMapLayout,
  hexString,
  MIN_ACCENT_LUMINANCE,
  readableAccent,
  relativeLuminance,
  worldMapFocusZone,
  type WorldMapPoint,
} from './worldMapLayout';

const layout = buildWorldMapLayout();
const nodeById = new Map(layout.nodes.map((n) => [n.zoneId, n]));
const linkKeys = new Set(layout.links.map((l) => [l.from, l.to].sort().join('|')));
const linked = (a: string, b: string) => linkKeys.has([a, b].sort().join('|'));
const dist = (a: WorldMapPoint, b: WorldMapPoint) => Math.hypot(a.x - b.x, a.y - b.y);

describe('world map layout', () => {
  it('shows Pedravale plus every class’s secondary and starting village, and each regional settlement, once each', () => {
    expect(layout.nodes).toHaveLength(1 + CLASS_ZONE_THEMES.length * 2 + REGIONAL_SETTLEMENTS.length);
    expect(new Set(layout.nodes.map((n) => n.zoneId)).size).toBe(layout.nodes.length);
    expect(nodeById.get(MAIN_CITY_ID)?.name).toBe('Pedravale');
    for (const theme of CLASS_ZONE_THEMES) {
      expect(nodeById.get(theme.secondaryVillageId)).toMatchObject({ kind: 'secondary', classId: theme.classId, name: theme.secondaryVillageName });
      expect(nodeById.get(theme.startVillageId)).toMatchObject({ kind: 'start', classId: theme.classId, name: theme.startVillageName });
    }
  });

  it('centers Pedravale in both orientations', () => {
    const capital = nodeById.get(MAIN_CITY_ID)!;
    expect(capital.portrait).toEqual({ x: 0.5, y: 0.5 });
    expect(capital.landscape).toEqual({ x: 0.5, y: 0.5 });
  });

  it('draws exactly the roads the real zone exits create: Pedravale to each secondary village, each secondary to its own start village, Pedravale to each regional settlement', () => {
    expect(layout.links).toHaveLength(CLASS_ZONE_THEMES.length * 2 + REGIONAL_SETTLEMENTS.length);
    for (const settlement of REGIONAL_SETTLEMENTS) {
      expect(linked(MAIN_CITY_ID, settlement.zoneId), settlement.zoneId).toBe(true);
    }
    for (const theme of CLASS_ZONE_THEMES) {
      expect(linked(MAIN_CITY_ID, theme.secondaryVillageId)).toBe(true);
      expect(linked(theme.secondaryVillageId, theme.startVillageId)).toBe(true);
      expect(linked(MAIN_CITY_ID, theme.startVillageId)).toBe(false);
    }
    for (const link of layout.links) {
      const touchesCapital = link.from === MAIN_CITY_ID || link.to === MAIN_CITY_ID;
      expect(link.kind).toBe(touchesCapital ? 'main' : 'local');
    }
  });

  it('places each start village further out than its secondary village, which sits inside its own class territory', () => {
    const capital = nodeById.get(MAIN_CITY_ID)!;
    for (const theme of CLASS_ZONE_THEMES) {
      const secondary = nodeById.get(theme.secondaryVillageId)!;
      const start = nodeById.get(theme.startVillageId)!;
      const territory = layout.territories.find((t) => t.classId === theme.classId)!;
      for (const o of ['portrait', 'landscape'] as const) {
        expect(dist(start[o], capital[o])).toBeGreaterThan(dist(secondary[o], capital[o]));
        for (const n of [secondary, start]) {
          expect(n[o].x).toBeGreaterThan(territory[o].x0);
          expect(n[o].x).toBeLessThan(territory[o].x1);
          expect(n[o].y).toBeGreaterThan(territory[o].y0);
          expect(n[o].y).toBeLessThan(territory[o].y1);
        }
      }
    }
  });

  it('keeps every territory inside the map area, clear of Pedravale and of every other territory', () => {
    for (const o of ['portrait', 'landscape'] as const) {
      const rects = layout.territories.map((t) => t[o]);
      for (const r of rects) {
        expect(r.x0).toBeGreaterThanOrEqual(0);
        expect(r.y0).toBeGreaterThanOrEqual(0);
        expect(r.x1).toBeLessThanOrEqual(1);
        expect(r.y1).toBeLessThanOrEqual(1);
        const containsCenter = r.x0 < 0.5 && r.x1 > 0.5 && r.y0 < 0.5 && r.y1 > 0.5;
        expect(containsCenter).toBe(false);
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it('shows both regional settlements as their own classless node kinds, with their soft level guide and a readable tint', () => {
    expect(nodeById.get(ANCORADOURO_VAU_ID)).toMatchObject({ kind: 'satellite', classId: null, name: 'Ancoradouro do Vau', recommendedLevel: 8 });
    expect(nodeById.get(BALUARTE_AMANHECER_ID)).toMatchObject({ kind: 'hub', classId: null, name: 'Baluarte do Amanhecer', recommendedLevel: 20 });
    for (const settlement of REGIONAL_SETTLEMENTS) {
      const node = nodeById.get(settlement.zoneId)!;
      const hex = parseInt(node.displayHex!.slice(1), 16);
      expect(relativeLuminance([(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff])).toBeGreaterThanOrEqual(MIN_ACCENT_LUMINANCE);
    }
  });

  it('places the satellite hamlet right beside Pedravale and the frontier hub further out, both in the strip no class territory uses', () => {
    const capital = nodeById.get(MAIN_CITY_ID)!;
    const satellite = nodeById.get(ANCORADOURO_VAU_ID)!;
    const hub = nodeById.get(BALUARTE_AMANHECER_ID)!;
    for (const o of ['portrait', 'landscape'] as const) {
      expect(dist(satellite[o], capital[o]), o).toBeLessThan(dist(hub[o], capital[o]));
      for (const n of [satellite, hub]) {
        expect(n[o].x).toBeGreaterThan(0);
        expect(n[o].x).toBeLessThan(1);
        expect(n[o].y).toBeGreaterThan(0);
        expect(n[o].y).toBeLessThan(1);
        for (const t of layout.territories) {
          const r = t[o];
          const inside = n[o].x > r.x0 && n[o].x < r.x1 && n[o].y > r.y0 && n[o].y < r.y1;
          expect(inside, `${n.zoneId} inside ${t.classId}'s territory (${o})`).toBe(false);
        }
      }
    }
  });

  it('never stacks two settlements on the same spot', () => {
    for (const o of ['portrait', 'landscape'] as const) {
      for (let i = 0; i < layout.nodes.length; i++) {
        for (let j = i + 1; j < layout.nodes.length; j++) {
          const a = layout.nodes[i];
          const b = layout.nodes[j];
          expect(dist(a[o], b[o]), `${a.zoneId} vs ${b.zoneId} (${o})`).toBeGreaterThan(0.1);
        }
      }
    }
  });

  it('labels each territory with its class name and a tint that stays readable on the dark UI', () => {
    for (const theme of CLASS_ZONE_THEMES) {
      const territory = layout.territories.find((t) => t.classId === theme.classId)!;
      expect(territory.className.length).toBeGreaterThan(0);
      expect(relativeLuminance(territory.displayRgb)).toBeGreaterThanOrEqual(MIN_ACCENT_LUMINANCE);
    }
  });
});

describe('readableAccent', () => {
  it('leaves an already-bright class color untouched', () => {
    const archer = CLASS_ZONE_THEMES.find((t) => t.classId === 'archer')!;
    const [r, g, b] = readableAccent(archer.accentColor);
    expect(hexString((r << 16) | (g << 8) | b)).toBe(hexString(archer.accentColor));
  });

  it('lifts a near-black color without collapsing it to grey (keeps its dominant channel)', () => {
    const necro = CLASS_ZONE_THEMES.find((t) => t.classId === 'necromancer')!; // 0x2f1f3a — blue/purple-dominant
    const [r, g, b] = readableAccent(necro.accentColor);
    expect(relativeLuminance([r, g, b])).toBeGreaterThanOrEqual(MIN_ACCENT_LUMINANCE);
    expect(b).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(g);
  });
});

describe('worldMapFocusZone', () => {
  it('marks an open-world zone at itself', () => {
    expect(worldMapFocusZone(MAIN_CITY_ID)).toBe(MAIN_CITY_ID);
    expect(worldMapFocusZone('warrior_start')).toBe('warrior_start');
  });

  it('marks a dungeon instance at the settlement its portal stands in', () => {
    for (const dungeon of DUNGEON_DEFINITIONS) {
      expect(worldMapFocusZone(dungeon.zoneId)).toBe(dungeon.portal.hostZoneId);
    }
  });
});
