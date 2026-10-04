import { describe, expect, it } from 'vitest';
import { TileType } from '../config/tiles';
import { Player } from '../entities/Player';
import { buildWalkabilityGrid, isWalkableAt } from '../systems/Pathfinding';
import { CHEST_DEFINITIONS } from './chests';
import { getLoreFragmentById, isLoreFragmentAvailable, LORE_FRAGMENTS, loreFragmentsInZone } from './loreFragments';
import { NPC_DEFINITIONS } from './npcs';
import { getZoneById } from './zones';

describe('LORE_FRAGMENTS data', () => {
  it('has a healthy number of fragments with unique ids', () => {
    expect(LORE_FRAGMENTS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(LORE_FRAGMENTS.map((f) => f.id)).size).toBe(LORE_FRAGMENTS.length);
  });

  it('spreads across several zones, never inside a dungeon instance', () => {
    const zones = new Set(LORE_FRAGMENTS.map((f) => f.zoneId));
    expect(zones.size).toBeGreaterThanOrEqual(8);
    for (const zoneId of zones) expect(getZoneById(zoneId).dungeonId).toBeUndefined();
  });

  it('has at least two night-only fragments (a secret by time of day)', () => {
    expect(LORE_FRAGMENTS.filter((f) => f.nightOnly).length).toBeGreaterThanOrEqual(2);
  });

  it('every fragment has a title and at least two non-empty dialogue lines', () => {
    for (const f of LORE_FRAGMENTS) {
      expect(f.title.trim().length).toBeGreaterThan(0);
      expect(f.lines.length).toBeGreaterThanOrEqual(2);
      for (const line of f.lines) expect(line.trim().length).toBeGreaterThan(20);
    }
  });

  it('lookups work', () => {
    const first = LORE_FRAGMENTS[0];
    expect(getLoreFragmentById(first.id)).toBe(first);
    expect(() => getLoreFragmentById('nao_existe')).toThrow();
    expect(loreFragmentsInZone(first.zoneId)).toContain(first);
  });
});

describe('lore fragment placement', () => {
  for (const zoneId of [...new Set(LORE_FRAGMENTS.map((f) => f.zoneId))]) {
    it(`${zoneId}: every fragment sits on an open, walkable grass tile inside the map`, () => {
      const map = getZoneById(zoneId).generate();
      const grid = buildWalkabilityGrid(
        map.tiles,
        map.buildings.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
      );
      for (const f of loreFragmentsInZone(zoneId)) {
        const { x, y } = f.atTile;
        expect(y, `${f.id} y`).toBeGreaterThanOrEqual(0);
        expect(y, `${f.id} y`).toBeLessThan(map.tiles.length);
        expect(x, `${f.id} x`).toBeGreaterThanOrEqual(0);
        expect(x, `${f.id} x`).toBeLessThan(map.tiles[0].length);
        expect(map.tiles[y][x], `${f.id} must be a Grass tile`).toBe(TileType.Grass);
        expect(isWalkableAt(grid, f.atTile), `${f.id} must be reachable on foot (no tree/building on it)`).toBe(true);
      }
    });
  }

  it('keeps clear of exits, NPCs, chests and each other so no interact prompt is ever shadowed', () => {
    for (const f of LORE_FRAGMENTS) {
      const zone = getZoneById(f.zoneId);
      for (const exit of zone.exits) expect(Math.hypot(exit.atTile.x - f.atTile.x, exit.atTile.y - f.atTile.y), `${f.id} vs exit`).toBeGreaterThan(4);
      for (const npc of NPC_DEFINITIONS.filter((n) => n.zoneId === f.zoneId)) {
        expect(Math.hypot(npc.mapX - f.atTile.x, npc.mapY - f.atTile.y), `${f.id} vs ${npc.id}`).toBeGreaterThan(3);
      }
      for (const chest of CHEST_DEFINITIONS.filter((c) => c.zoneId === f.zoneId)) {
        expect(Math.hypot(chest.atTile.x - f.atTile.x, chest.atTile.y - f.atTile.y), `${f.id} vs ${chest.id}`).toBeGreaterThan(3);
      }
      for (const other of LORE_FRAGMENTS.filter((o) => o.id !== f.id && o.zoneId === f.zoneId)) {
        expect(Math.hypot(other.atTile.x - f.atTile.x, other.atTile.y - f.atTile.y), `${f.id} vs ${other.id}`).toBeGreaterThan(3);
      }
    }
  });
});

describe('isLoreFragmentAvailable', () => {
  it('shows a daytime fragment at any hour and a night-only one only at night', () => {
    const day = LORE_FRAGMENTS.find((f) => !f.nightOnly)!;
    const night = LORE_FRAGMENTS.find((f) => f.nightOnly)!;
    expect(isLoreFragmentAvailable(day, false)).toBe(true);
    expect(isLoreFragmentAvailable(day, true)).toBe(true);
    expect(isLoreFragmentAvailable(night, false)).toBe(false);
    expect(isLoreFragmentAvailable(night, true)).toBe(true);
  });
});

describe('Player.discoveredLoreIds persistence', () => {
  it('starts empty and survives a save round-trip', () => {
    const player = Player.createNew('Testador', 'archer');
    expect(player.discoveredLoreIds).toEqual([]);
    player.discoveredLoreIds.push('frag_cantiga_das_criancas');
    const reloaded = Player.fromSaveData(JSON.parse(JSON.stringify(player.toSaveData())));
    expect(reloaded.discoveredLoreIds).toEqual(['frag_cantiga_das_criancas']);
  });

  it('defaults to empty for a save from before this field existed', () => {
    const data = Player.createNew('Antigo', 'monk').toSaveData() as unknown as Record<string, unknown>;
    delete data.discoveredLoreIds;
    expect(Player.fromSaveData(data as never).discoveredLoreIds).toEqual([]);
  });
});
