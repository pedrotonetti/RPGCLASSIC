import type { ColorblindMode } from '../systems/GameSettings';

/**
 * "Modo para daltonismo" — a daltonization (color-correction) filter, not a
 * simulation: it estimates what a viewer with the given deficiency loses
 * (the difference between the real color and its simulated appearance) and
 * shifts that lost information into channels they DO see, so red/green (or
 * blue/yellow) pairs the HUD leans on — HP vs. MP, rarity colors, enemy vs.
 * friendly markers — stay distinguishable. Applied as one SVG feColorMatrix
 * over the whole HUD/menu layer (see ui/settings.css), so every UI
 * color is covered without hunting down each palette.
 *
 * Math: out = (I + E·(I − S))·rgb, with S the Viénot/Brettel-style RGB
 * simulation matrix for the deficiency and E the error-redistribution
 * matrix (Fidaner et al.'s daltonize). Rows of S sum to 1, so greys map to
 * themselves and the overall picture doesn't tint.
 */

type Mat3 = [number, number, number, number, number, number, number, number, number];

const SIMULATION: Record<Exclude<ColorblindMode, 'nenhum'>, Mat3> = {
  protanopia: [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
  deuteranopia: [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
  tritanopia: [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
};

/** Where the lost signal goes: red-green deficiencies push it into green/blue, the blue-yellow one into red/green. */
const ERROR_SHIFT: Record<Exclude<ColorblindMode, 'nenhum'>, Mat3> = {
  protanopia: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  deuteranopia: [0, 0, 0, 0.7, 1, 0, 0.7, 0, 1],
  tritanopia: [1, 0, 0.7, 0, 1, 0.7, 0, 0, 0],
};

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function mul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
}

/** The 3×3 correction matrix (row-major) for a mode; identity for 'nenhum'. */
export function daltonizeMatrix(mode: ColorblindMode): Mat3 {
  if (mode === 'nenhum') return [...IDENTITY];
  const s = SIMULATION[mode];
  const iMinusS = IDENTITY.map((v, i) => v - s[i]) as Mat3;
  const e = mul(ERROR_SHIFT[mode], iMinusS);
  return IDENTITY.map((v, i) => Math.round((v + e[i]) * 10000) / 10000) as Mat3;
}

/** The 20 numbers of an SVG <feColorMatrix type="matrix"> (alpha untouched). */
export function feColorMatrixValues(mode: ColorblindMode): string {
  const m = daltonizeMatrix(mode);
  return [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0].join(' ');
}
