/**
 * Tap-and-hold for touch — the touchscreen stand-in for a desktop hover
 * tooltip. Fires `onHold` after `ms` of a finger resting on `target`
 * without sliding (so a scroll gesture through a list never triggers it),
 * and swallows the click that the same finger's release would otherwise
 * deliver (so holding on a card's "Equipar" button shows details instead of
 * also equipping). Mouse input is ignored here — right-click
 * (`contextmenu`) is routed to the same callback instead, which also covers
 * Android's own long-press → contextmenu.
 */
export function onLongPress(target: HTMLElement, onHold: () => void, ms = 450): () => void {
  const MOVE_TOLERANCE = 10;
  let timer = 0;
  let startX = 0;
  let startY = 0;
  let fired = false;

  const cancel = () => {
    window.clearTimeout(timer);
    timer = 0;
  };
  const down = (ev: PointerEvent) => {
    if (ev.pointerType === 'mouse') return;
    fired = false;
    startX = ev.clientX;
    startY = ev.clientY;
    cancel();
    timer = window.setTimeout(() => {
      timer = 0;
      fired = true;
      navigator.vibrate?.(12);
      onHold();
    }, ms);
  };
  const move = (ev: PointerEvent) => {
    if (timer && Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_TOLERANCE) cancel();
  };
  const click = (ev: MouseEvent) => {
    if (!fired) return;
    fired = false;
    ev.stopPropagation();
    ev.preventDefault();
  };
  const contextMenu = (ev: MouseEvent) => {
    ev.preventDefault();
    if (fired) return; // touch hold already handled it
    cancel();
    onHold();
  };

  target.addEventListener('pointerdown', down);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', cancel);
  target.addEventListener('pointercancel', cancel);
  target.addEventListener('pointerleave', cancel);
  target.addEventListener('click', click, true);
  target.addEventListener('contextmenu', contextMenu);
  return () => {
    cancel();
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', cancel);
    target.removeEventListener('pointercancel', cancel);
    target.removeEventListener('pointerleave', cancel);
    target.removeEventListener('click', click, true);
    target.removeEventListener('contextmenu', contextMenu);
  };
}
