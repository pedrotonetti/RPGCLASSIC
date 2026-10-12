import { audio } from '../systems/AudioSystem';

/**
 * "Legendas de efeitos sonoros" — short bracketed captions for the game's
 * meaningful sound cues, for players who play muted or can't hear them.
 * Installed once at startup (main.ts) by wrapping the cue methods on the
 * shared `audio` instance, so no call site anywhere has to change; the
 * captions only show while the option is on. Constant chatter (UI clicks,
 * every sword swing, ordinary hits) is deliberately left uncaptioned —
 * only cues that tell the player something.
 */

type CueName =
  | 'hitImpact'
  | 'block'
  | 'dodge'
  | 'stagger'
  | 'heal'
  | 'itemUse'
  | 'enemyDefeated'
  | 'levelUp'
  | 'victory'
  | 'defeat'
  | 'flee'
  | 'telegraphWarning'
  | 'bossPhaseChange'
  | 'encounterStart'
  | 'mountToggle'
  | 'questComplete'
  | 'chestOpen'
  | 'secretFound';

/** The caption for one cue call, or null when that particular call isn't worth one (e.g. a non-critical hit). */
export function captionFor(cue: string, args: unknown[] = []): string | null {
  switch (cue) {
    case 'hitImpact':
      return args[0] ? '[Golpe crítico]' : null;
    case 'block':
      return args[0] ? '[Bloqueio perfeito]' : '[Bloqueio]';
    case 'dodge':
      return '[Esquiva]';
    case 'stagger':
      return '[Atordoado]';
    case 'heal':
      return '[Cura]';
    case 'itemUse':
      return '[Item usado]';
    case 'enemyDefeated':
      return '[Inimigo derrotado]';
    case 'levelUp':
      return '[Fanfarra: subiu de nível!]';
    case 'victory':
      return '[Música de vitória]';
    case 'defeat':
      return '[Derrota]';
    case 'flee':
      return '[Fuga]';
    case 'telegraphWarning':
      return '[Alerta: ataque forte a caminho]';
    case 'bossPhaseChange':
      return '[Rugido: o chefe mudou de fase]';
    case 'encounterStart':
      return '[Combate iniciado]';
    case 'mountToggle':
      return '[Montaria]';
    case 'questComplete':
      return '[Missão concluída]';
    case 'chestOpen':
      return '[Baú aberto]';
    case 'secretFound':
      return '[Segredo encontrado]';
    default:
      return null;
  }
}

const CUES: CueName[] = [
  'hitImpact',
  'block',
  'dodge',
  'stagger',
  'heal',
  'itemUse',
  'enemyDefeated',
  'levelUp',
  'victory',
  'defeat',
  'flee',
  'telegraphWarning',
  'bossPhaseChange',
  'encounterStart',
  'mountToggle',
  'questComplete',
  'chestOpen',
  'secretFound',
];

const CAPTION_LIFETIME_MS = 2200;
const MAX_LINES = 4;

let enabled = false;
let installed = false;
let containerEl: HTMLElement | null = null;
const lastShown = new Map<string, number>();

export function setSoundCaptionsEnabled(on: boolean): void {
  enabled = on;
  if (!on && containerEl) containerEl.replaceChildren();
}

function show(text: string): void {
  const now = performance.now();
  // The same caption fired in a burst (a multi-hit combo, a few enemies dying together) shows once.
  if (now - (lastShown.get(text) ?? -Infinity) < 600) return;
  lastShown.set(text, now);
  if (!containerEl || !containerEl.isConnected) {
    containerEl = document.createElement('div');
    containerEl.className = 'sound-captions';
    containerEl.setAttribute('aria-live', 'polite');
    document.body.append(containerEl);
  }
  const line = document.createElement('div');
  line.className = 'sound-caption';
  line.textContent = text;
  containerEl.append(line);
  while (containerEl.childElementCount > MAX_LINES) containerEl.firstElementChild?.remove();
  window.setTimeout(() => line.remove(), CAPTION_LIFETIME_MS);
}

/** Wraps the cue methods once; safe to call more than once. */
export function installSoundCaptions(): void {
  if (installed) return;
  installed = true;
  const target = audio as unknown as Record<string, (...args: unknown[]) => void>;
  for (const cue of CUES) {
    const original = target[cue];
    if (typeof original !== 'function') continue;
    target[cue] = function (this: unknown, ...args: unknown[]) {
      original.apply(audio, args);
      if (!enabled) return;
      const text = captionFor(cue, args);
      if (text) show(text);
    };
  }
}
