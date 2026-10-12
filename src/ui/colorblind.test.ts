import { describe, expect, it } from 'vitest';
import { daltonizeMatrix, feColorMatrixValues } from './colorblind';

function apply(m: number[], rgb: [number, number, number]): number[] {
  return [0, 1, 2].map((r) => m[r * 3] * rgb[0] + m[r * 3 + 1] * rgb[1] + m[r * 3 + 2] * rgb[2]);
}

describe('daltonizeMatrix', () => {
  it('is the identity with no mode', () => {
    expect(daltonizeMatrix('nenhum')).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it.each(['protanopia', 'deuteranopia', 'tritanopia'] as const)('%s keeps greys grey (no overall tint)', (mode) => {
    const out = apply(daltonizeMatrix(mode), [0.5, 0.5, 0.5]);
    for (const v of out) expect(v).toBeCloseTo(0.5, 3);
  });

  it.each(['protanopia', 'deuteranopia'] as const)('%s pushes pure red and pure green further apart in the blue channel', (mode) => {
    const m = daltonizeMatrix(mode);
    const red = apply(m, [1, 0, 0]);
    const green = apply(m, [0, 1, 0]);
    expect(Math.abs(red[2] - green[2])).toBeGreaterThan(0.2);
  });

  it('produces a 20-value feColorMatrix with alpha untouched', () => {
    const values = feColorMatrixValues('tritanopia').split(' ').map(Number);
    expect(values).toHaveLength(20);
    expect(values.slice(15)).toEqual([0, 0, 0, 1, 0]);
  });
});
