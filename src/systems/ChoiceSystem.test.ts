import { describe, expect, it } from 'vitest';
import { Player } from '../entities/Player';
import { applyChoiceEffect } from './ChoiceSystem';
import { getFactionReputation, hasCompletedEvent, hasFlag } from './WorldStateSystem';

function freshPlayer(): Player {
  return Player.createNew('Testador', 'warrior');
}

describe('applyChoiceEffect', () => {
  it('does nothing when every field is left unset', () => {
    const player = freshPlayer();
    const before = { ...player.worldState, flags: { ...player.worldState.flags } };
    const goldBefore = player.gold;
    applyChoiceEffect(player, {});
    expect(player.worldState).toEqual(before);
    expect(player.gold).toBe(goldBefore);
  });

  it('sets a flag', () => {
    const player = freshPlayer();
    applyChoiceEffect(player, { setFlag: 'met_hermit' });
    expect(hasFlag(player.worldState, 'met_hermit')).toBe(true);
  });

  it('applies a worldState delta, clamped', () => {
    const player = freshPlayer();
    applyChoiceEffect(player, { worldStateDelta: { hope: 10, corruption: -1000 } });
    expect(player.worldState.hope).toBe(60);
    expect(player.worldState.corruption).toBe(0);
  });

  it('adjusts faction reputation', () => {
    const player = freshPlayer();
    applyChoiceEffect(player, { factionDelta: { factionId: 'pedravale', amount: 15 } });
    expect(getFactionReputation(player.worldState, 'pedravale')).toBe(15);
  });

  it('grants gold', () => {
    const player = freshPlayer();
    const before = player.gold;
    applyChoiceEffect(player, { grantGold: 25 });
    expect(player.gold).toBe(before + 25);
  });

  it('grants an item into the bag', () => {
    const player = freshPlayer();
    const bagBefore = player.bag.length;
    applyChoiceEffect(player, { grantItem: { templateId: 'espada_curta', rarity: 'verde' } });
    expect(player.bag.length).toBe(bagBefore + 1);
  });

  it('marks a world event completed', () => {
    const player = freshPlayer();
    applyChoiceEffect(player, { markEventId: 'caravan_ambush' });
    expect(hasCompletedEvent(player.worldState, 'caravan_ambush')).toBe(true);
  });

  it('applies every field at once when several are set together', () => {
    const player = freshPlayer();
    applyChoiceEffect(player, {
      setFlag: 'helped_village',
      worldStateDelta: { hope: 5 },
      factionDelta: { factionId: 'pedravale', amount: 5 },
      grantGold: 10,
    });
    expect(hasFlag(player.worldState, 'helped_village')).toBe(true);
    expect(player.worldState.hope).toBe(55);
    expect(getFactionReputation(player.worldState, 'pedravale')).toBe(5);
  });
});
