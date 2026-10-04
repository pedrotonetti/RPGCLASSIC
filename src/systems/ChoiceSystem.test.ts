import { describe, expect, it } from 'vitest';
import { Player } from '../entities/Player';
import { applyChoiceEffect } from './ChoiceSystem';
import { getFactionReputation, getZoneState, hasCompletedEvent, hasFlag } from './WorldStateSystem';

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

  it('labels a zone state', () => {
    const player = freshPlayer();
    applyChoiceEffect(player, { zoneState: { zoneId: 'baluarte_amanhecer', state: 'reerguido' } });
    expect(getZoneState(player.worldState, 'baluarte_amanhecer')).toBe('reerguido');
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

describe('applyChoiceEffect — costs and multi-faction moves', () => {
  it('treats a negative grantGold as a payment, never leaving the player below zero', () => {
    const player = freshPlayer();
    player.gold = 100;
    applyChoiceEffect(player, { grantGold: -60 });
    expect(player.gold).toBe(40);
    applyChoiceEffect(player, { grantGold: -500 });
    expect(player.gold).toBe(0);
  });

  it('applies several faction deltas at once, on top of the single factionDelta', () => {
    const player = freshPlayer();
    applyChoiceEffect(player, {
      factionDelta: { factionId: 'pedravale', amount: 4 },
      factionDeltas: [
        { factionId: 'pedravale', amount: 6 },
        { factionId: 'ancoradouro_vau', amount: -9 },
      ],
    });
    expect(getFactionReputation(player.worldState, 'pedravale')).toBe(10);
    expect(getFactionReputation(player.worldState, 'ancoradouro_vau')).toBe(-9);
  });
});
