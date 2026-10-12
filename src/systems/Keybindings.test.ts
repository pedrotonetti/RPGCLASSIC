import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultKeyBindings,
  findKeyConflicts,
  isActionKey,
  isBindableKey,
  keyBindingOverrides,
  keyFor,
  keyLabel,
  normalizeKey,
  rebindKey,
  resolveKeyBindings,
  setKeyBindings,
  skillSlotForKey,
} from './Keybindings';

afterEach(() => setKeyBindings({}));

describe('defaults', () => {
  it('match the keys the game always used', () => {
    const d = defaultKeyBindings();
    expect([d.moveUp, d.moveLeft, d.moveDown, d.moveRight]).toEqual(['w', 'a', 's', 'd']);
    expect([d.interact, d.mount, d.inventory, d.skills, d.quests, d.pause]).toEqual(['e', 'm', 'i', 'k', 'j', 'Escape']);
    expect([d.block, d.dodge, d.classAbility]).toEqual([' ', 'Shift', 'r']);
    expect(d.skill1).toBe('1');
    expect(d.skill9).toBe('9');
  });

  it('have no conflicts', () => {
    expect(findKeyConflicts(defaultKeyBindings())).toEqual([]);
  });
});

describe('normalizeKey / keyLabel', () => {
  it('lower-cases single characters (Shift+W still reads as W) and keeps named keys', () => {
    expect(normalizeKey('W')).toBe('w');
    expect(normalizeKey('Escape')).toBe('Escape');
    expect(normalizeKey(' ')).toBe(' ');
  });

  it('shows friendly names', () => {
    expect(keyLabel(' ')).toBe('Espaço');
    expect(keyLabel('Escape')).toBe('Esc');
    expect(keyLabel('q')).toBe('Q');
    expect(keyLabel('F2')).toBe('F2');
  });
});

describe('isBindableKey', () => {
  it('refuses browser/modifier keys and the always-on arrows', () => {
    for (const k of ['Tab', 'Control', 'Alt', 'Meta', 'F5', 'ArrowUp']) expect(isBindableKey(k, 'interact')).toBe(false);
  });

  it('reserves Escape for the pause action', () => {
    expect(isBindableKey('Escape', 'interact')).toBe(false);
    expect(isBindableKey('Escape', 'pause')).toBe(true);
  });

  it('accepts letters, digits, space and function keys', () => {
    for (const k of ['q', '0', ' ', 'F2', 'Enter', 'Shift']) expect(isBindableKey(k, 'interact')).toBe(true);
  });
});

describe('resolveKeyBindings (sanitizing stored overrides)', () => {
  it('ignores junk and falls back to the default per action', () => {
    const b = resolveKeyBindings({ interact: 'F', mount: 42, nonsense: 'q', inventory: 'Tab', pause: 'p', quests: 'Escape' });
    expect(b.interact).toBe('f');
    expect(b.mount).toBe('m');
    expect(b.inventory).toBe('i');
    expect(b.pause).toBe('p');
    expect(b.quests).toBe('j');
    expect((b as Record<string, string>).nonsense).toBeUndefined();
  });

  it('treats non-objects as "no overrides"', () => {
    expect(resolveKeyBindings('wasd')).toEqual(defaultKeyBindings());
    expect(resolveKeyBindings(null)).toEqual(defaultKeyBindings());
    expect(resolveKeyBindings(['q'])).toEqual(defaultKeyBindings());
  });

  it('round-trips through keyBindingOverrides, saving only what changed', () => {
    const b = { ...defaultKeyBindings(), interact: 'f' };
    expect(keyBindingOverrides(b)).toEqual({ interact: 'f' });
    expect(resolveKeyBindings(keyBindingOverrides(b))).toEqual(b);
  });
});

describe('rebindKey (conflict handling)', () => {
  it('binds a free key', () => {
    const r = rebindKey(defaultKeyBindings(), 'interact', 'F');
    expect(r.ok).toBe(true);
    expect(r.bindings.interact).toBe('f');
    expect(r.swappedWith).toBeNull();
  });

  it('swaps with the action already using that key, leaving no conflict', () => {
    const r = rebindKey(defaultKeyBindings(), 'interact', 'm');
    expect(r.ok).toBe(true);
    expect(r.swappedWith).toBe('mount');
    expect(r.bindings.interact).toBe('m');
    expect(r.bindings.mount).toBe('e');
    expect(findKeyConflicts(r.bindings)).toEqual([]);
  });

  it('refuses an unbindable key without changing anything', () => {
    const before = defaultKeyBindings();
    const r = rebindKey(before, 'interact', 'Escape');
    expect(r.ok).toBe(false);
    expect(r.bindings).toBe(before);
    expect(r.reason).toBeTruthy();
  });

  it('refuses a swap that would hand Escape to a non-pause action', () => {
    const r = rebindKey(defaultKeyBindings(), 'pause', 'i');
    expect(r.ok).toBe(false);
  });

  it('detects conflicts in a hand-edited table', () => {
    const b = resolveKeyBindings({ interact: 'm' });
    expect(findKeyConflicts(b)).toEqual([{ key: 'm', actions: ['interact', 'mount'] }]);
  });
});

describe('active bindings', () => {
  it('drive isActionKey / keyFor / skillSlotForKey', () => {
    expect(isActionKey('interact', 'E')).toBe(true);
    expect(skillSlotForKey('3')).toBe(3);
    setKeyBindings({ interact: 'f', skill3: 'q' });
    expect(keyFor('interact')).toBe('f');
    expect(isActionKey('interact', 'e')).toBe(false);
    expect(isActionKey('interact', 'F')).toBe(true);
    expect(skillSlotForKey('q')).toBe(3);
    expect(skillSlotForKey('3')).toBe(0);
  });

  it('always lets Escape pause, even with pause rebound', () => {
    setKeyBindings({ pause: 'p' });
    expect(isActionKey('pause', 'Escape')).toBe(true);
    expect(isActionKey('pause', 'P')).toBe(true);
  });
});
