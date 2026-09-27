import { describe, expect, it } from 'vitest';
import type { ActiveStatusEffect, StatusEffectHolder } from './statusEffects';
import { checkFreezeShatter, checkStatusSynergy } from './statusSynergies';

function holderWith(...types: ActiveStatusEffect['type'][]): StatusEffectHolder {
  return { statusEffects: types.map((type) => ({ type, remaining: 5, tickDamage: 0, tickInterval: Infinity, tickTimer: Infinity, slowMult: 1 })) };
}

describe('checkStatusSynergy', () => {
  it('returns null when nothing combos (no existing effects, or an effect that has no pairing with the incoming one)', () => {
    expect(checkStatusSynergy(holderWith(), 'burn')).toBeNull();
    expect(checkStatusSynergy(holderWith('slow'), 'burn')).toBeNull();
  });

  it('Burn + Bleed = Ferida Aberta, either order', () => {
    const a = checkStatusSynergy(holderWith('bleed'), 'burn');
    expect(a).toMatchObject({ label: 'Ferida Aberta', consumes: 'bleed' });
    const b = checkStatusSynergy(holderWith('burn'), 'bleed');
    expect(b).toMatchObject({ label: 'Ferida Aberta', consumes: 'burn' });
  });

  it('Poison + Burn = Combustão Tóxica, either order', () => {
    expect(checkStatusSynergy(holderWith('burn'), 'poison')).toMatchObject({ label: 'Combustão Tóxica', consumes: 'burn' });
    expect(checkStatusSynergy(holderWith('poison'), 'burn')).toMatchObject({ label: 'Combustão Tóxica', consumes: 'poison' });
  });

  it('Slow + Poison = Paralisia Tóxica, either order, and inflicts a stun', () => {
    const a = checkStatusSynergy(holderWith('slow'), 'poison');
    expect(a).toMatchObject({ label: 'Paralisia Tóxica', consumes: 'slow', inflictsStun: true });
    const b = checkStatusSynergy(holderWith('poison'), 'slow');
    expect(b).toMatchObject({ label: 'Paralisia Tóxica', consumes: 'poison', inflictsStun: true });
  });

  it('never fires for a plain refresh of the same type already active', () => {
    expect(checkStatusSynergy(holderWith('burn'), 'burn')).toBeNull();
    expect(checkStatusSynergy(holderWith('poison'), 'poison')).toBeNull();
  });

  it('only ever consumes the pre-existing effect, never the incoming one, when several are active at once', () => {
    const result = checkStatusSynergy(holderWith('bleed', 'slow'), 'burn');
    expect(result?.consumes).toBe('bleed');
  });
});

describe('checkFreezeShatter', () => {
  it('returns null when the target is not frozen', () => {
    expect(checkFreezeShatter(holderWith())).toBeNull();
    expect(checkFreezeShatter(holderWith('slow', 'burn'))).toBeNull();
  });

  it('fires "Estilhaçamento" and consumes freeze when the target is frozen', () => {
    const result = checkFreezeShatter(holderWith('freeze'));
    expect(result).toMatchObject({ label: 'Estilhaçamento', consumes: 'freeze', inflictsStun: true });
  });

  it('still fires alongside other active effects, only ever consuming freeze', () => {
    const result = checkFreezeShatter(holderWith('freeze', 'poison'));
    expect(result?.consumes).toBe('freeze');
  });
});
