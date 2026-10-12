import { describe, expect, it } from 'vitest';
import { ZONE_DEFINITIONS } from '../data/zones';
import {
  AMBIENT_LAYERS,
  ambientBiomeForZone,
  ambientGainsChanged,
  ambientLayerGains,
  crossfadeGain,
  daylightWeight,
  emptyAmbientGains,
  equalPowerCrossfade,
  twilightWeight,
} from './ambientAudio';

describe('ambientBiomeForZone', () => {
  it('maps the hub city, regional settlements, dungeons and blighted villages to their own beds', () => {
    expect(ambientBiomeForZone({ id: 'main_city' })).toBe('city');
    expect(ambientBiomeForZone({ id: 'ancoradouro_vau' })).toBe('riverside');
    expect(ambientBiomeForZone({ id: 'baluarte_amanhecer' })).toBe('highlands');
    expect(ambientBiomeForZone({ id: 'necromancer_start' })).toBe('blight');
    expect(ambientBiomeForZone({ id: 'warrior_start' })).toBe('village');
    expect(ambientBiomeForZone({ id: 'qualquer', dungeonId: 'root_hollow' })).toBe('dungeon');
  });

  it('gives every real zone a bed with at least one audible layer at noon and at midnight', () => {
    for (const zone of Object.values(ZONE_DEFINITIONS)) {
      const biome = ambientBiomeForZone(zone);
      for (const hour of [0, 12]) {
        const gains = ambientLayerGains(biome, { hour });
        expect(AMBIENT_LAYERS.some((id) => gains[id] > 0.1), `${zone.id} @${hour}h`).toBe(true);
      }
    }
  });
});

describe('day/night weights', () => {
  it('daylight is ~1 at midday, ~0 at midnight, monotonic through the morning', () => {
    expect(daylightWeight(13)).toBeCloseTo(1, 5);
    expect(daylightWeight(1)).toBeCloseTo(0, 5);
    let prev = -1;
    for (let h = 1; h <= 13; h += 0.5) {
      const w = daylightWeight(h);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it('wraps hours outside 0..24', () => {
    expect(daylightWeight(37)).toBeCloseTo(daylightWeight(13), 6);
    expect(daylightWeight(-11)).toBeCloseTo(daylightWeight(13), 6);
  });

  it('twilight peaks at dawn and dusk and is silent at noon/midnight', () => {
    expect(twilightWeight(6.5)).toBe(1);
    expect(twilightWeight(19.5)).toBe(1);
    expect(twilightWeight(12)).toBe(0);
    expect(twilightWeight(0)).toBe(0);
  });
});

describe('ambientLayerGains', () => {
  it('villages have birds by day and crickets by night', () => {
    const noon = ambientLayerGains('village', { hour: 12 });
    const midnight = ambientLayerGains('village', { hour: 0 });
    expect(noon.birds).toBeGreaterThan(0.5);
    expect(noon.crickets).toBeLessThan(0.05);
    expect(midnight.birds).toBeLessThan(0.05);
    expect(midnight.crickets).toBeGreaterThan(0.5);
  });

  it('the city is busier by day than by night', () => {
    expect(ambientLayerGains('city', { hour: 12 }).murmur).toBeGreaterThan(ambientLayerGains('city', { hour: 0 }).murmur);
  });

  it('dungeons sound the same at any hour', () => {
    expect(ambientLayerGains('dungeon', { hour: 3 })).toEqual(ambientLayerGains('dungeon', { hour: 14 }));
    expect(ambientLayerGains('dungeon', { hour: 3 }).drips).toBeGreaterThan(0.5);
  });

  it('mist muffles birds and adds an eerie edge', () => {
    const clear = ambientLayerGains('village', { hour: 12 });
    const misty = ambientLayerGains('village', { hour: 12, eventKind: 'nevoa' });
    expect(misty.birds).toBeLessThan(clear.birds * 0.5);
    expect(misty.eerie).toBeGreaterThan(clear.eerie);
  });

  it('an invasion brings a drone in', () => {
    expect(ambientLayerGains('village', { hour: 12, eventKind: 'invasao' }).drone).toBeGreaterThan(ambientLayerGains('village', { hour: 12 }).drone);
  });

  it('a corrupted world has fewer birds', () => {
    expect(ambientLayerGains('village', { hour: 12, mood: 0 }).birds).toBeLessThan(ambientLayerGains('village', { hour: 12, mood: 0.5 }).birds);
  });

  it('combat ducks every layer', () => {
    const calm = ambientLayerGains('riverside', { hour: 12 });
    const fight = ambientLayerGains('riverside', { hour: 12, inCombat: true });
    for (const id of AMBIENT_LAYERS) expect(fight[id]).toBeLessThanOrEqual(calm[id]);
    expect(fight.water).toBeLessThan(calm.water);
  });

  it('always stays within 0..1 and writes into a reused record', () => {
    const out = emptyAmbientGains();
    for (const biome of ['city', 'village', 'riverside', 'highlands', 'blight', 'dungeon'] as const) {
      for (let h = 0; h < 24; h += 1.5) {
        for (const eventKind of [null, 'invasao', 'nevoa', 'arvore_corrompida', 'mercador'] as const) {
          const res = ambientLayerGains(biome, { hour: h, eventKind, mood: 0 }, out);
          expect(res).toBe(out);
          for (const id of AMBIENT_LAYERS) {
            expect(res[id]).toBeGreaterThanOrEqual(0);
            expect(res[id]).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

describe('crossfades', () => {
  it('crossfadeGain approaches the target without overshooting, frame-rate independently', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = crossfadeGain(a, 1, 1 / 60, 0.5);
    let b = 0;
    for (let i = 0; i < 30; i++) b = crossfadeGain(b, 1, 1 / 30, 0.5);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeCloseTo(1 - Math.exp(-2), 6);
    expect(a).toBeLessThan(1);
  });

  it('a zero time constant snaps straight to the target', () => {
    expect(crossfadeGain(0.2, 0.9, 0.016, 0)).toBe(0.9);
  });

  it('equal-power crossfade keeps total power constant', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const { from, to } = equalPowerCrossfade(t);
      expect(from * from + to * to).toBeCloseTo(1, 6);
    }
    expect(equalPowerCrossfade(0)).toEqual({ from: 1, to: 0 });
    expect(equalPowerCrossfade(2).to).toBeCloseTo(1, 6);
  });

  it('ambientGainsChanged ignores tiny drifts', () => {
    const a = ambientLayerGains('village', { hour: 12 });
    const b = { ...a, wind: a.wind + 0.001 };
    expect(ambientGainsChanged(a, b)).toBe(false);
    expect(ambientGainsChanged(a, { ...a, birds: a.birds + 0.2 })).toBe(true);
  });
});
