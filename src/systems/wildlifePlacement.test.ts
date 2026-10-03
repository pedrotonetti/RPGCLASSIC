import { describe, expect, it } from 'vitest';
import { TileType } from '../config/tiles';
import { getZoneById, MAIN_CITY_ID, monsterFreeAreas } from '../data/zones';
import { pickWildlifeLayout } from './wildlifePlacement';

/** A grass field with a solid block of forest in the middle — plenty of forest edge around it. */
function fieldWithForest(width = 80, height = 80): TileType[][] {
  const tiles = Array.from({ length: height }, () => Array.from({ length: width }, () => TileType.Grass));
  for (let y = 25; y < 55; y++) for (let x = 25; x < 55; x++) tiles[y][x] = TileType.Tree;
  return tiles;
}

describe('pickWildlifeLayout', () => {
  it('spawns several different species, not just foxes', () => {
    const layout = pickWildlifeLayout(fieldWithForest(), { start: { x: 2, y: 2 } });
    const species = new Set(layout.creatures.map((c) => c.species));
    for (const s of ['fox', 'rabbit', 'deer', 'butterfly', 'bird'] as const) expect(species.has(s)).toBe(true);
  });

  it('gives every flower patch at least one butterfly of its own', () => {
    const layout = pickWildlifeLayout(fieldWithForest(), { start: { x: 2, y: 2 } });
    expect(layout.flowerPatches.length).toBeGreaterThan(0);
    for (const patch of layout.flowerPatches) {
      expect(layout.creatures.some((c) => c.species === 'butterfly' && c.x === patch.x && c.y === patch.y)).toBe(true);
    }
  });

  it('puts flowers at the forest edge, on grass', () => {
    const tiles = fieldWithForest();
    const layout = pickWildlifeLayout(tiles, { start: { x: 2, y: 2 } });
    for (const p of layout.flowerPatches) {
      expect(tiles[p.y][p.x]).toBe(TileType.Grass);
      let nearTree = false;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (tiles[p.y + dy]?.[p.x + dx] === TileType.Tree) nearTree = true;
      expect(nearTree).toBe(true);
    }
  });

  it('keeps ground creatures and flowers out of avoided areas and away from the spawn tile', () => {
    const avoid = [{ x0: 0, y0: 0, x1: 40, y1: 79 }];
    const start = { x: 70, y: 70 };
    const layout = pickWildlifeLayout(fieldWithForest(), { start, avoid });
    const grounded = [...layout.flowerPatches, ...layout.creatures.filter((c) => c.species !== 'bird')];
    for (const p of grounded) {
      expect(p.x >= 0 && p.x <= 40).toBe(false);
      expect(Math.hypot(p.x - start.x, p.y - start.y)).toBeGreaterThanOrEqual(4);
    }
  });

  it('roughly halves the creature count on low-power devices', () => {
    const tiles = fieldWithForest(160, 160);
    let full = 0;
    let low = 0;
    for (let i = 0; i < 5; i++) {
      full += pickWildlifeLayout(tiles, { start: { x: 2, y: 2 } }).creatures.length;
      low += pickWildlifeLayout(tiles, { start: { x: 2, y: 2 }, lowPower: true }).creatures.length;
    }
    expect(low).toBeLessThan(full * 0.75);
  });

  it("fills Pedravale's real map with life while keeping its town districts clear", () => {
    const map = getZoneById(MAIN_CITY_ID).generate();
    const [town] = monsterFreeAreas(MAIN_CITY_ID);
    const layout = pickWildlifeLayout(map.tiles, { start: map.playerStart, avoid: [town] });
    expect(layout.flowerPatches.length).toBeGreaterThanOrEqual(20);
    expect(layout.creatures.length).toBeGreaterThanOrEqual(40);
    for (const p of layout.flowerPatches) {
      expect(p.x >= town.x0 && p.x <= town.x1 && p.y >= town.y0 && p.y <= town.y1).toBe(false);
    }
  });
});
