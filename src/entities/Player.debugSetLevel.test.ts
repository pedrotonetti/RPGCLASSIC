import { describe, expect, it } from 'vitest';
import { Player } from './Player';

describe('Player.debugSetLevel', () => {
  it('sets the level, resets xp, and heals to the new max HP/MP', () => {
    const player = Player.createNew('Herói', 'warrior');
    player.currentHp = 1;
    player.currentMp = 0;
    player.xp = 999;

    player.debugSetLevel(9);

    expect(player.level).toBe(9);
    expect(player.xp).toBe(0);
    expect(player.currentHp).toBe(player.stats.maxHp);
    expect(player.currentMp).toBe(player.stats.maxMp);
  });

  it('does not grant skillPoints, unlike a natural level-up', () => {
    const player = Player.createNew('Herói', 'warrior');
    const before = player.skillPoints;
    player.debugSetLevel(20);
    expect(player.skillPoints).toBe(before);
  });

  it('clamps below 1 up to 1', () => {
    const player = Player.createNew('Herói', 'warrior');
    player.debugSetLevel(-5);
    expect(player.level).toBe(1);
  });

  it('clamps above 100 down to 100', () => {
    const player = Player.createNew('Herói', 'warrior');
    player.debugSetLevel(500);
    expect(player.level).toBe(100);
  });

  it('rounds a fractional level', () => {
    const player = Player.createNew('Herói', 'warrior');
    player.debugSetLevel(9.6);
    expect(player.level).toBe(10);
  });
});
