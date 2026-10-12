import type { AccessibilityOptions, InterfaceOptions, TouchOptions } from '../systems/GameSettings';
import { feColorMatrixValues } from './colorblind';

/**
 * The CSS side of the "Interface", "Controles (toque)" and "Acessibilidade"
 * options: everything is published as classes / custom properties on <html>
 * and style.css's "Configurações" section does the rest, so the HUD code
 * that builds those elements (OverworldScreen, OverworldCombat...) never
 * has to know these options exist, and a change applies live to whatever
 * is on screen — same approach as ui/mobile.ts's applyUiScale.
 */

const HIDE_CLASSES: Array<[keyof InterfaceOptions, string]> = [
  ['minimap', 'opt-hide-minimap'],
  ['questTracker', 'opt-hide-quest-tracker'],
  ['nameplates', 'opt-hide-nameplates'],
  ['enemyHealthBars', 'opt-hide-enemy-bars'],
  ['keyHints', 'opt-hide-key-hints'],
  ['clock', 'opt-hide-clock'],
];

export function applyInterfaceOptions(opts: InterfaceOptions): void {
  const root = document.documentElement;
  for (const [key, cls] of HIDE_CLASSES) root.classList.toggle(cls, !opts[key]);
  root.style.setProperty('--hud-opacity', String(opts.hudOpacity));
  root.classList.toggle('opt-hud-faded', opts.hudOpacity < 1);
}

export function applyTouchOptions(opts: TouchOptions): void {
  const root = document.documentElement;
  root.style.setProperty('--joystick-scale', String(opts.joystickSize));
  root.style.setProperty('--joystick-opacity', String(opts.joystickOpacity));
  root.classList.toggle('opt-joystick-custom', opts.joystickSize !== 1 || opts.joystickOpacity !== 1);
  root.classList.toggle('opt-joystick-right', opts.joystickSide === 'direita');
}

const FILTER_SVG_ID = 'opt-colorblind-svg';
const FILTER_ID = 'opt-colorblind-filter';

/** One hidden inline <svg> holding the daltonization filter the CSS points at (`filter: url(#opt-colorblind-filter)`). */
function ensureColorblindFilter(values: string): void {
  let matrix = document.querySelector<SVGFEColorMatrixElement>(`#${FILTER_SVG_ID} feColorMatrix`);
  if (!matrix) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.id = FILTER_SVG_ID;
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    const filter = document.createElementNS(ns, 'filter');
    filter.id = FILTER_ID;
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    matrix = document.createElementNS(ns, 'feColorMatrix') as SVGFEColorMatrixElement;
    matrix.setAttribute('type', 'matrix');
    filter.append(matrix);
    svg.append(filter);
    document.body.append(svg);
  }
  matrix.setAttribute('values', values);
}

export function applyAccessibilityOptions(opts: AccessibilityOptions): void {
  const root = document.documentElement;
  const colorblind = opts.colorblind !== 'nenhum';
  if (colorblind) ensureColorblindFilter(feColorMatrixValues(opts.colorblind));
  root.classList.toggle('opt-colorblind', colorblind);
  root.dataset.colorblind = opts.colorblind;
  root.classList.toggle('opt-high-contrast', opts.highContrast);
}
