import { describe, expect, it } from 'vitest';
import { CLASS_ZONE_THEMES } from '../data/classZones';
import { DUNGEON_DEFINITIONS } from '../data/dungeons';
import { ANCORADOURO_VAU_ID, BALUARTE_AMANHECER_ID, MAIN_CITY_ID, REGIONAL_SETTLEMENTS } from '../data/zones';
import { buildWorldMapLayout, hexString, MIN_ACCENT_LUMINANCE, readableAccent, relativeLuminance, worldMapFocusZone } from './worldMapLayout';

const layout = buildWorldMapLayout();
const pinByZone = new Map(layout.pins.map((p) => [p.zoneId, p]));

describe('world map layout', () => {
  it('shows Pedravale plus every class’s secondary and starting village, and each regional settlement, once each', () => {
    expect(layout.pins).toHaveLength(1 + CLASS_ZONE_THEMES.length * 2 + REGIONAL_SETTLEMENTS.length);
    expect(new Set(layout.pins.map((p) => p.zoneId)).size).toBe(layout.pins.length);
    expect(pinByZone.get(MAIN_CITY_ID)).toMatchObject({ name: 'Pedravale', kind: 'capital', classId: null });
    for (const theme of CLASS_ZONE_THEMES) {
      expect(pinByZone.get(theme.secondaryVillageId)).toMatchObject({ kind: 'secondary', classId: theme.classId, name: theme.secondaryVillageName });
      expect(pinByZone.get(theme.startVillageId)).toMatchObject({ kind: 'start', classId: theme.classId, name: theme.startVillageName });
    }
  });

  it('places every pin within the map image', () => {
    for (const pin of layout.pins) {
      expect(pin.point.x, pin.zoneId).toBeGreaterThan(0);
      expect(pin.point.x, pin.zoneId).toBeLessThan(1);
      expect(pin.point.y, pin.zoneId).toBeGreaterThan(0);
      expect(pin.point.y, pin.zoneId).toBeLessThan(1);
    }
  });

  it('shows both regional settlements as their own classless pin kinds, with their soft level guide', () => {
    expect(pinByZone.get(ANCORADOURO_VAU_ID)).toMatchObject({ kind: 'satellite', classId: null, name: 'Ancoradouro do Vau', recommendedLevel: 8 });
    expect(pinByZone.get(BALUARTE_AMANHECER_ID)).toMatchObject({ kind: 'hub', classId: null, name: 'Baluarte do Amanhecer', recommendedLevel: 20 });
  });

  it('never stacks two settlements on the same spot', () => {
    for (let i = 0; i < layout.pins.length; i++) {
      for (let j = i + 1; j < layout.pins.length; j++) {
        const a = layout.pins[i];
        const b = layout.pins[j];
        const dist = Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y);
        expect(dist, `${a.zoneId} vs ${b.zoneId}`).toBeGreaterThan(0.01);
      }
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
