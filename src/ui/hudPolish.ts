import { loadSettings, saveSettings } from '../systems/GameSettings';
import { el } from './dom';
import { formatCooldown, lowHpLevel } from './hudMath';

/**
 * Overworld HUD readability pieces that sit on top of the existing HUD
 * without reshaping it (OverworldScreen/OverworldCombat only call into
 * here):
 *  - a red edge vignette that fades in at low HP and pulses at critical HP;
 *  - the quest tracker collapsing to one line on small screens (tap it to
 *    toggle — the collapse itself is CSS, scoped to phone breakpoints, so a
 *    desktop window never hides it), remembered in GameSettings;
 *  - a numeric countdown + "ready" flash on hotbar cooldowns (paintCooldown).
 */
export class HudPolish {
  private vignetteEl: HTMLElement;
  private lastLevel: 0 | 1 | 2 = 0;

  constructor(
    root: HTMLElement,
    private questTrackerEl: HTMLElement,
  ) {
    this.vignetteEl = el('div', { className: 'low-hp-vignette', attrs: { 'aria-hidden': 'true' } });
    // First child: under every HUD widget and overlay, over the 3D canvas.
    root.prepend(this.vignetteEl);

    questTrackerEl.classList.add('collapsible');
    questTrackerEl.setAttribute('title', 'Toque para recolher/expandir');
    questTrackerEl.classList.toggle('collapsed', loadSettings().questTrackerCollapsed === true);
    questTrackerEl.addEventListener('click', () => this.toggleQuestTracker());
  }

  private toggleQuestTracker(): void {
    const collapsed = !this.questTrackerEl.classList.contains('collapsed');
    this.questTrackerEl.classList.toggle('collapsed', collapsed);
    const settings = loadSettings();
    settings.questTrackerCollapsed = collapsed;
    saveSettings(settings);
  }

  /** Per frame; only touches the DOM when the warning level actually changes. */
  update(currentHp: number, maxHp: number): void {
    const level = lowHpLevel(currentHp, maxHp);
    if (level === this.lastLevel) return;
    this.lastLevel = level;
    this.vignetteEl.classList.toggle('low', level >= 1);
    this.vignetteEl.classList.toggle('critical', level === 2);
  }
}

/**
 * Hotbar slot cooldown readout: a big centered countdown over the existing
 * darkening `.cd-fill`, an `on-cd` class while cooling, and a short
 * `cd-ready` flash the moment it comes back. Lazily adds its own text node
 * to the slot, so callers only pass the slot element and seconds left.
 */
export function paintCooldown(slotEl: HTMLElement, remaining: number): void {
  const text = formatCooldown(remaining);
  let textEl = slotEl.querySelector<HTMLElement>(':scope > .cd-text');
  if (!textEl) {
    if (!text) return;
    textEl = el('div', { className: 'cd-text', attrs: { 'aria-hidden': 'true' } });
    slotEl.append(textEl);
  }
  if (textEl.textContent !== text) textEl.textContent = text;
  const wasCooling = slotEl.classList.contains('on-cd');
  const cooling = text !== '';
  if (wasCooling === cooling) return;
  slotEl.classList.toggle('on-cd', cooling);
  if (!cooling) {
    slotEl.classList.remove('cd-ready');
    // Restart the flash animation even if it ran moments ago.
    void slotEl.offsetWidth;
    slotEl.classList.add('cd-ready');
  }
}
