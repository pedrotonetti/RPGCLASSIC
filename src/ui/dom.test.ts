import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Game } from '../engine/Game';
import { goToLazy } from './dom';

// goToLazy has no DOM dependency beyond a handful of Element methods, so a
// few hand-rolled stubs stand in for the browser here rather than pulling in
// a full DOM environment just for this file.
function fakeElement() {
  const el = {
    className: '',
    textContent: '',
    children: [] as unknown[],
    append(child: unknown) {
      this.children.push(child);
    },
    remove() {
      this.removed = true;
    },
    removed: false,
    matches(sel: string) {
      return sel === `.${this.className}`;
    },
  };
  return el as unknown as HTMLElement & { matches: (sel: string) => boolean };
}

function fakeGame() {
  const appended: ReturnType<typeof fakeElement>[] = [];
  return {
    uiRoot: {
      append: (...nodes: ReturnType<typeof fakeElement>[]) => appended.push(...nodes),
      querySelector: (sel: string) => appended.find((n) => n.matches(sel)) ?? null,
    },
    appended,
    goTo: () => {
      throw new Error('goTo should not be called when the load rejects');
    },
  } as unknown as Game & { appended: ReturnType<typeof fakeElement>[] };
}

describe('goToLazy', () => {
  let reloadCalls = 0;
  const sessionStore = new Map<string, string>();
  let originalDocument: unknown;
  let originalWindow: unknown;
  let originalSessionStorage: unknown;

  beforeEach(() => {
    reloadCalls = 0;
    sessionStore.clear();
    originalDocument = (globalThis as any).document;
    originalWindow = (globalThis as any).window;
    originalSessionStorage = (globalThis as any).sessionStorage;
    (globalThis as any).document = { createElement: () => fakeElement() };
    (globalThis as any).sessionStorage = {
      getItem: (k: string) => (sessionStore.has(k) ? sessionStore.get(k)! : null),
      setItem: (k: string, v: string) => sessionStore.set(k, v),
      removeItem: (k: string) => sessionStore.delete(k),
    };
    (globalThis as any).window = {
      setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
      clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
      location: {
        reload: () => {
          reloadCalls++;
        },
      },
    };
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
    (globalThis as any).window = originalWindow;
    (globalThis as any).sessionStorage = originalSessionStorage;
  });

  // A new deploy replaces every hashed chunk filename, so a tab left open
  // from before it (or a stale service-worker cache) can get a hard 404
  // fetching a lazy screen's chunk. Before this test's fix, that rejection
  // was never caught: the promise just died silently behind the
  // "Carregando…" text forever, which from the outside looked exactly like
  // the game refusing to start on any menu click.
  it('does not hang or throw when the lazy load rejects, and reloads once', async () => {
    const game = fakeGame();

    // No try/catch needed around this call: goToLazy must swallow the
    // rejection itself (that's the fix) rather than letting it propagate.
    goToLazy(game, () => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    await new Promise((r) => setTimeout(r, 20));

    expect(reloadCalls).toBe(1);
    expect(sessionStorage.getItem('rpg-reload-once')).toBe('1');
  });

  it('does not reload a second time in a row, showing a fallback message instead', async () => {
    const game = fakeGame();
    sessionStorage.setItem('rpg-reload-once', '1');

    goToLazy(game, () => Promise.reject(new Error('still broken')));
    await new Promise((r) => setTimeout(r, 20));

    expect(reloadCalls).toBe(0);
    const shownText = game.appended.map((n) => n.textContent).join(' | ');
    expect(shownText).toMatch(/conexão|recarregue/);
  });

  it('clears the reload-once flag after a successful load', async () => {
    const game = fakeGame();
    sessionStorage.setItem('rpg-reload-once', '1');
    game.goTo = () => {};

    goToLazy(game, () => Promise.resolve({ mount() {}, unmount() {} } as any));
    await new Promise((r) => setTimeout(r, 20));

    expect(sessionStorage.getItem('rpg-reload-once')).toBeNull();
  });
});
