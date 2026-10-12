import { describe, expect, it } from 'vitest';
import { captionFor } from './soundCaptions';

describe('captionFor', () => {
  it('captions meaningful cues in Portuguese', () => {
    expect(captionFor('levelUp')).toBe('[Fanfarra: subiu de nível!]');
    expect(captionFor('telegraphWarning')).toMatch(/Alerta/);
    expect(captionFor('block', [true])).toBe('[Bloqueio perfeito]');
    expect(captionFor('block', [false])).toBe('[Bloqueio]');
  });

  it('skips constant chatter: ordinary hits and unknown cues', () => {
    expect(captionFor('hitImpact', [false])).toBeNull();
    expect(captionFor('hitImpact', [true])).toBe('[Golpe crítico]');
    expect(captionFor('uiClick')).toBeNull();
  });
});
