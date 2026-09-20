import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { audio } from '../systems/AudioSystem';

type Child = Node | string | null | undefined | false;

interface ElOptions {
  className?: string;
  text?: string;
  onClick?: (ev: MouseEvent) => void;
  onPointerDown?: (ev: PointerEvent) => void;
  onPointerUp?: (ev: PointerEvent) => void;
  style?: Partial<CSSStyleDeclaration>;
  attrs?: Record<string, string>;
}

/** Tiny hyperscript-style helper: el('div', {className: 'foo'}, [child, child]) */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.onClick) {
    const onClick = options.onClick;
    node.addEventListener('click', (ev) => {
      audio.uiClick();
      onClick(ev as MouseEvent);
    });
  }
  if (options.onPointerDown) node.addEventListener('pointerdown', options.onPointerDown as EventListener);
  if (options.onPointerUp) node.addEventListener('pointerup', options.onPointerUp as EventListener);
  if (options.style) Object.assign(node.style, options.style);
  if (options.attrs) {
    for (const [k, v] of Object.entries(options.attrs)) node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/**
 * Navigates to a screen whose module is lazy-loaded (code-split), so heavy
 * screens (overworld and everything it pulls in) don't have to be in the
 * initial bundle. `load` resolves the screen once its chunk has downloaded;
 * a "Carregando…" indicator only appears if that takes long enough to
 * notice, so a fast/cached import shows nothing in between.
 */
export function goToLazy(game: Game, load: () => Promise<Screen>): void {
  const timer = window.setTimeout(() => {
    game.uiRoot.append(el('div', { className: 'loading-text', text: 'Carregando…' }));
  }, 150);
  load()
    .then((screen) => {
      window.clearTimeout(timer);
      sessionStorage.removeItem('rpg-reload-once');
      game.goTo(screen);
    })
    .catch((err) => {
      window.clearTimeout(timer);
      console.error('Falha ao carregar tela:', err);
      // A new deploy replaces every hashed chunk filename, so a tab left
      // open (or a service-worker cache) from before it can try to fetch a
      // chunk that no longer exists and get a hard 404 here — without this,
      // that rejection was never caught, so the promise just died silently
      // behind the "Carregando…" text forever: from the outside, this looked
      // exactly like the game refusing to start on click. One automatic
      // reload re-fetches the current index.html and its real chunk list,
      // which fixes it; the sessionStorage flag stops a genuine repeated
      // failure (e.g. no connection at all) from reload-looping forever.
      if (!sessionStorage.getItem('rpg-reload-once')) {
        sessionStorage.setItem('rpg-reload-once', '1');
        window.location.reload();
        return;
      }
      game.uiRoot.querySelector('.loading-text')?.remove();
      game.uiRoot.append(
        el('div', {
          className: 'loading-text',
          text: 'Não foi possível carregar. Verifique sua conexão e recarregue a página.',
        }),
      );
    });
}
