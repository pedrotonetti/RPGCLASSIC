/** True when the device's primary input is touch (phone/tablet) rather than a mouse+keyboard — used to swap keyboard-only prompts/hints for tap-friendly ones. `(pointer: coarse)` is the primary-pointer signal; `maxTouchPoints` covers touch-capable laptops that also have a mouse. */
export function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
}
