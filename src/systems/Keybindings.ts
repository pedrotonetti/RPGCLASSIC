/**
 * Desktop key remapping ("Controles" tab of screens/SettingsScreen.ts).
 *
 * Every place that used to compare `KeyboardEvent.key` against a hard-coded
 * letter (OverworldScreen.onKeyDown/computeLocalInputAxis, the pause menu's
 * I/K/J shortcuts, OverworldCombat.handleKeyDown's 1-9/Space/Shift/R, the
 * menu screens' "same key closes it" back binding) asks this module instead.
 * Pure data + pure functions for the remap logic (tested in
 * Keybindings.test.ts), plus one small module-level "active bindings" table
 * the settings screen and main.ts keep in sync with the saved settings —
 * same single-instance shape as combatFeel/audio.
 *
 * Keys are stored NORMALIZED (see normalizeKey): single characters
 * lower-cased ('w', '1', ' '), named keys as the browser reports them
 * ('Escape', 'Shift', 'F2'). Only the actions the player actually changed
 * are persisted (GameSettings.keybindings), so a future default change still
 * reaches everyone who never touched that action.
 *
 * Two keys stay hard-wired on purpose, whatever the bindings say: Escape
 * always pauses/closes (so a bad remap can never lock the player out of
 * the menus — the "Pausar" action adds a key, it can't take Escape away),
 * and the arrow keys always move.
 */

export type KeyAction =
  | 'moveUp'
  | 'moveDown'
  | 'moveLeft'
  | 'moveRight'
  | 'interact'
  | 'mount'
  | 'inventory'
  | 'skills'
  | 'quests'
  | 'pause'
  | 'block'
  | 'dodge'
  | 'classAbility'
  | 'cameraLeft'
  | 'cameraRight'
  | 'cameraReset'
  | 'skill1'
  | 'skill2'
  | 'skill3'
  | 'skill4'
  | 'skill5'
  | 'skill6'
  | 'skill7'
  | 'skill8'
  | 'skill9';

export interface KeyActionDef {
  id: KeyAction;
  label: string;
  group: 'Movimento' | 'Ações' | 'Menus' | 'Combate' | 'Câmera' | 'Habilidades';
  defaultKey: string;
}

export const KEY_ACTIONS: readonly KeyActionDef[] = [
  { id: 'moveUp', label: 'Andar para frente', group: 'Movimento', defaultKey: 'w' },
  { id: 'moveDown', label: 'Andar para trás', group: 'Movimento', defaultKey: 's' },
  { id: 'moveLeft', label: 'Andar para a esquerda', group: 'Movimento', defaultKey: 'a' },
  { id: 'moveRight', label: 'Andar para a direita', group: 'Movimento', defaultKey: 'd' },
  { id: 'interact', label: 'Interagir / conversar', group: 'Ações', defaultKey: 'e' },
  { id: 'mount', label: 'Montaria', group: 'Ações', defaultKey: 'm' },
  { id: 'inventory', label: 'Inventário', group: 'Menus', defaultKey: 'i' },
  { id: 'skills', label: 'Árvore de habilidades', group: 'Menus', defaultKey: 'k' },
  { id: 'quests', label: 'Missões', group: 'Menus', defaultKey: 'j' },
  { id: 'pause', label: 'Pausar / menu', group: 'Menus', defaultKey: 'Escape' },
  { id: 'block', label: 'Bloquear', group: 'Combate', defaultKey: ' ' },
  { id: 'dodge', label: 'Esquivar', group: 'Combate', defaultKey: 'Shift' },
  { id: 'classAbility', label: 'Habilidade de classe', group: 'Combate', defaultKey: 'r' },
  { id: 'cameraLeft', label: 'Girar câmera (esquerda)', group: 'Câmera', defaultKey: 'z' },
  { id: 'cameraRight', label: 'Girar câmera (direita)', group: 'Câmera', defaultKey: 'x' },
  { id: 'cameraReset', label: 'Recentralizar câmera', group: 'Câmera', defaultKey: 'c' },
  ...([1, 2, 3, 4, 5, 6, 7, 8, 9] as const).map((n) => ({
    id: `skill${n}` as KeyAction,
    label: `Habilidade ${n}`,
    group: 'Habilidades' as const,
    defaultKey: String(n),
  })),
];

export const SKILL_SLOT_ACTIONS: readonly KeyAction[] = ['skill1', 'skill2', 'skill3', 'skill4', 'skill5', 'skill6', 'skill7', 'skill8', 'skill9'];

const ACTION_IDS = new Set<string>(KEY_ACTIONS.map((a) => a.id));

/** Keys that can never be bound: browser/OS chrome, modifiers that only make sense held with something else, and the always-on arrow movement. */
const FORBIDDEN_KEYS = new Set([
  'Tab',
  'Meta',
  'OS',
  'Alt',
  'AltGraph',
  'Control',
  'ContextMenu',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Dead',
  'Unidentified',
  'Process',
  'F5',
  'F11',
  'F12',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

/** One canonical spelling per physical key the way the game compares them — single characters lower-cased (so Shift+W still reads as W), named keys untouched. */
export function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

/** Whether `key` (normalized) may be bound to `action`. Escape is reserved for "Pausar" (it always pauses anyway — see the module comment). */
export function isBindableKey(key: string, action: KeyAction): boolean {
  if (!key || FORBIDDEN_KEYS.has(key)) return false;
  if (key === 'Escape') return action === 'pause';
  if (key.length === 1) return key.trim() !== '' || key === ' ';
  return /^[A-Za-z][A-Za-z0-9]*$/.test(key);
}

export type KeyBindings = Record<KeyAction, string>;

export function defaultKeyBindings(): KeyBindings {
  const out = {} as KeyBindings;
  for (const a of KEY_ACTIONS) out[a.id] = a.defaultKey;
  return out;
}

/** Stored overrides → a full table. Unknown actions, non-string values and unbindable keys are ignored (that action keeps its default). */
export function resolveKeyBindings(overrides: unknown): KeyBindings {
  const out = defaultKeyBindings();
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return out;
  for (const [action, key] of Object.entries(overrides as Record<string, unknown>)) {
    if (!ACTION_IDS.has(action) || typeof key !== 'string') continue;
    const normalized = normalizeKey(key);
    if (isBindableKey(normalized, action as KeyAction)) out[action as KeyAction] = normalized;
  }
  return out;
}

/** A full table → just the entries that differ from the defaults (what gets saved). */
export function keyBindingOverrides(bindings: KeyBindings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of KEY_ACTIONS) if (bindings[a.id] !== a.defaultKey) out[a.id] = bindings[a.id];
  return out;
}

/** Every key bound to more than one action, with those actions — empty when the table is clean. */
export function findKeyConflicts(bindings: KeyBindings): Array<{ key: string; actions: KeyAction[] }> {
  const byKey = new Map<string, KeyAction[]>();
  for (const a of KEY_ACTIONS) {
    const list = byKey.get(bindings[a.id]) ?? [];
    list.push(a.id);
    byKey.set(bindings[a.id], list);
  }
  return [...byKey.entries()].filter(([, actions]) => actions.length > 1).map(([key, actions]) => ({ key, actions }));
}

export interface RebindResult {
  ok: boolean;
  bindings: KeyBindings;
  /** The action that already used the new key and received `action`'s previous key in exchange (a swap — so a rebind never leaves a conflict behind). */
  swappedWith: KeyAction | null;
  /** Why it was refused, when !ok. */
  reason?: string;
}

/** Binds `key` to `action`. When another action already uses it, the two trade keys — unless the old key can't legally go to that action, in which case it's refused. */
export function rebindKey(bindings: KeyBindings, action: KeyAction, rawKey: string): RebindResult {
  const key = normalizeKey(rawKey);
  if (!isBindableKey(key, action)) return { ok: false, bindings, swappedWith: null, reason: `A tecla ${keyLabel(key)} não pode ser usada para isso.` };
  const previous = bindings[action];
  if (previous === key) return { ok: true, bindings, swappedWith: null };
  const holder = KEY_ACTIONS.find((a) => a.id !== action && bindings[a.id] === key)?.id ?? null;
  if (holder && !isBindableKey(previous, holder)) {
    return { ok: false, bindings, swappedWith: null, reason: `${keyLabel(key)} já é usada por "${actionLabel(holder)}".` };
  }
  const next = { ...bindings, [action]: key };
  if (holder) next[holder] = previous;
  return { ok: true, bindings: next, swappedWith: holder };
}

const NAMED_LABELS: Record<string, string> = {
  ' ': 'Espaço',
  Escape: 'Esc',
  Shift: 'Shift',
  Enter: 'Enter',
  Backspace: '⌫',
  Delete: 'Del',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
};

/** How a key is shown to the player (keycap badges, HUD hint line, the remap table). */
export function keyLabel(key: string): string {
  if (NAMED_LABELS[key]) return NAMED_LABELS[key];
  return key.length === 1 ? key.toUpperCase() : key;
}

export function actionLabel(action: KeyAction): string {
  return KEY_ACTIONS.find((a) => a.id === action)?.label ?? action;
}

// --- active table (runtime) -------------------------------------------------

let active: KeyBindings = defaultKeyBindings();

/** Installs the saved overrides — called at startup (main.ts) and on every change in the settings screen. */
export function setKeyBindings(overrides: unknown): void {
  active = resolveKeyBindings(overrides);
}

export function activeKeyBindings(): KeyBindings {
  return active;
}

/** The key currently bound to `action` (normalized). */
export function keyFor(action: KeyAction): string {
  return active[action];
}

/** Display label of the key currently bound to `action`. */
export function keyLabelFor(action: KeyAction): string {
  return keyLabel(active[action]);
}

/** Whether a raw `KeyboardEvent.key` triggers `action` under the active bindings (Escape always counts as "pause"). */
export function isActionKey(action: KeyAction, eventKey: string): boolean {
  const key = normalizeKey(eventKey);
  if (action === 'pause' && key === 'Escape') return true;
  return active[action] === key;
}

/** 1-based skill slot a raw key fires (skill1..skill9), or 0. */
export function skillSlotForKey(eventKey: string): number {
  const key = normalizeKey(eventKey);
  const index = SKILL_SLOT_ACTIONS.findIndex((a) => active[a] === key);
  return index + 1;
}
