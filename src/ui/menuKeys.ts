import { el } from './dom';

/**
 * Consistent Escape handling for the full-screen menus (Inventário,
 * Missões, Árvore de Habilidades, Conquistas, Ranking, Configurações) and
 * anything layered on top of them (e.g. the inventory's item-comparison
 * sheet). Before this, Escape only did anything inside OverworldScreen's own
 * key handler — once a menu screen replaced it, Escape was dead and the
 * only way back was the "< Voltar" button.
 *
 * A single window listener walks a LIFO stack: the most recently pushed
 * handler (the topmost layer) gets the key, so "Esc closes the topmost
 * thing" holds no matter how layers were opened. ui/dialogs.ts's modal
 * listens in the capture phase and stops propagation, so a confirm dialog
 * over a menu still eats its own Escape first — this listener sits in the
 * bubble phase and never sees it.
 */

interface KeyLayer {
  keys: string[];
  handler: (key: string) => void;
}

const layers: KeyLayer[] = [];
let installed = false;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

function onKeyDown(ev: KeyboardEvent): void {
  if (layers.length === 0 || ev.repeat) return;
  const top = layers[layers.length - 1];
  const key = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
  if (!top.keys.includes(key)) return;
  // A letter hotkey typed into a text field (e.g. the dev panel's inputs)
  // is just typing; Escape still closes from anywhere.
  if (key !== 'Escape' && isTypingTarget(ev.target)) return;
  ev.preventDefault();
  top.handler(key);
}

/**
 * Pushes a key layer; returns its remover. `keys` are `KeyboardEvent.key`
 * values (single letters lower-case), e.g. ['Escape', 'i'].
 */
export function pushKeyLayer(keys: string[], handler: (key: string) => void): () => void {
  if (!installed) {
    window.addEventListener('keydown', onKeyDown);
    installed = true;
  }
  const layer: KeyLayer = { keys, handler };
  layers.push(layer);
  return () => {
    const i = layers.indexOf(layer);
    if (i !== -1) layers.splice(i, 1);
  };
}

/**
 * A menu screen's "back" binding: Escape (plus any `extraKeys`, e.g. the
 * same I that opened the inventory) clicks `backBtn` exactly once, so it
 * goes through the button's own save-and-navigate logic instead of a
 * second copy of it. Call the returned function from the screen's
 * `unmount()`.
 */
export function bindBackKey(backBtn: HTMLElement, extraKeys: string[] = []): () => void {
  let fired = false;
  const remove = pushKeyLayer(['Escape', ...extraKeys], () => {
    if (fired) return;
    fired = true;
    remove();
    backBtn.click();
  });
  return remove;
}

/** Small keycap badge ("Esc", "I") appended to a button — hidden on touch devices, which have no keyboard (see `.is-touch .hotkey-hint` in style.css). */
export function addHotkeyHint(target: HTMLElement, label: string): HTMLElement {
  target.append(el('kbd', { className: 'hotkey-hint', text: label, attrs: { 'aria-hidden': 'true' } }));
  return target;
}
