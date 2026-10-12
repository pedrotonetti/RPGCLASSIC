import { uiScaleFactor, type UiScale } from '../systems/GameSettings';

/**
 * "Tamanho da interface" — publishes the chosen scale as `--ui-scale` (and
 * `data-ui-scale`) on <html>. style.css's "Fase 7" section applies it with
 * CSS `zoom` to the HUD widgets and to the CONTENTS of the full-screen
 * menus (never to a box sized in vw, where zoom would also scale the vw and
 * overflow a phone screen), and leaves world-anchored labels (NPC names,
 * enemy bars, quest arrow — positioned in JS from screen-space pixels)
 * untouched so they stay glued to what they label.
 */
export function applyUiScale(scale: UiScale): void {
  const root = document.documentElement;
  root.style.setProperty('--ui-scale', String(uiScaleFactor(scale)));
  root.dataset.uiScale = scale;
}

/**
 * Guards against the browser treating game input as page gestures. The
 * viewport meta already says user-scalable=no, but iOS Safari ignores that
 * for pinch — its proprietary `gesture*` events are the only hook to stop
 * a two-finger joystick+skill press from zooming the page. Double-tap zoom
 * is handled in CSS (`touch-action: manipulation`, see style.css).
 */
export function installTouchGuards(): void {
  const block = (ev: Event) => ev.preventDefault();
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(type, block, { passive: false });
  }
  // Two-finger pinch on browsers that do honor touch events but not the meta tag.
  document.addEventListener(
    'touchmove',
    (ev) => {
      if (ev.touches.length > 1 && !(ev.target instanceof HTMLElement && ev.target.closest('input[type="range"]'))) ev.preventDefault();
    },
    { passive: false },
  );
}
