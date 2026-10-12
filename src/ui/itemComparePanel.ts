import { RARITY_LABEL, rarityToHex } from '../config/rarity';
import type { EquipmentInstance } from '../config/types';
import { itemDisplayName } from '../data/equipment';
import { formatDelta, type ItemComparison } from '../systems/ItemComparison';
import { el } from './dom';
import { onLongPress } from './longPress';
import { addHotkeyHint, pushKeyLayer } from './menuKeys';

/**
 * DOM for the inventory's "compare with what I'm wearing" view — the
 * numbers all come from systems/ItemComparison.ts; this only lays them out.
 * Two presentations of the same body:
 *  - a floating tooltip beside the hovered bag card (mouse/trackpad);
 *  - a modal sheet (tap-and-hold on touch, right-click, or a click on the
 *    card's comparison badge) with its own Equipar/Fechar buttons, closed
 *    by Escape, the backdrop, or Fechar.
 */

function itemHeader(instance: EquipmentInstance | null, caption: string): HTMLElement {
  if (!instance) {
    return el('div', { className: 'cmp-item' }, [
      el('div', { className: 'cmp-caption', text: caption }),
      el('div', { className: 'cmp-name dim', text: '(vazio)' }),
    ]);
  }
  return el('div', { className: 'cmp-item' }, [
    el('div', { className: 'cmp-caption', text: caption }),
    el('div', { className: 'cmp-name', text: itemDisplayName(instance), style: { color: rarityToHex(instance.rarity) } }),
    el('div', { className: 'cmp-meta', text: `${RARITY_LABEL[instance.rarity]} · Nv.${instance.itemLevel}` }),
  ]);
}

function lineList(title: string, lines: string[], cls: 'gain' | 'loss', bullet: string): HTMLElement | null {
  if (lines.length === 0) return null;
  return el('div', { className: 'cmp-section' }, [
    el('div', { className: 'cmp-section-title', text: title }),
    ...lines.map((line) => el('div', { className: `cmp-line ${cls}`, text: `${bullet} ${line}` })),
  ]);
}

const VERDICT_TEXT: Record<ItemComparison['verdict'], { cls: string; text: string }> = {
  empty: { cls: 'gain', text: '▲ Espaço vazio — equipar é ganho garantido' },
  upgrade: { cls: 'gain', text: '▲ Melhoria' },
  downgrade: { cls: 'loss', text: '▼ Mais fraco' },
  sidegrade: { cls: 'neutral', text: '≈ Poder equivalente' },
};

/** The comparison body shared by tooltip and sheet. */
export function buildComparisonBody(cmp: ItemComparison): HTMLElement {
  const verdict = VERDICT_TEXT[cmp.verdict];
  const powerText = cmp.verdict === 'empty' ? '' : ` (Poder ${formatDelta(cmp.powerDelta)})`;

  const statRows = cmp.stats.map((row) => {
    const cls = row.delta > 0 ? 'gain' : row.delta < 0 ? 'loss' : 'same';
    return el('div', { className: `cmp-stat ${cls}` }, [
      el('span', { className: 'cmp-stat-label', text: row.label }),
      el('span', { className: 'cmp-stat-values', text: `${formatDelta(row.current).replace('+', '')} → ${formatDelta(row.next).replace('+', '')}` }),
      el('span', { className: 'cmp-stat-delta', text: row.delta === 0 ? '=' : formatDelta(row.delta) }),
    ]);
  });

  const passiveRows: HTMLElement[] = [];
  if (cmp.passiveGained) {
    passiveRows.push(
      el('div', { className: 'cmp-line gain' }, [
        el('div', { text: `★ ${cmp.passiveGained.name}` }),
        el('div', { className: 'cmp-passive-desc', text: cmp.passiveGained.description }),
      ]),
    );
  }
  if (cmp.passiveLost) {
    passiveRows.push(
      el('div', { className: 'cmp-line loss' }, [
        el('div', { text: `✕ ${cmp.passiveLost.name}` }),
        el('div', { className: 'cmp-passive-desc', text: cmp.passiveLost.description }),
      ]),
    );
  }

  return el('div', { className: 'cmp-body' }, [
    el('div', { className: 'cmp-items' }, [itemHeader(cmp.equipped, 'Equipado'), el('div', { className: 'cmp-arrow', text: '→' }), itemHeader(cmp.candidate, 'Este item')]),
    el('div', { className: `cmp-verdict ${verdict.cls}`, text: `${verdict.text}${powerText}` }),
    statRows.length > 0 ? el('div', { className: 'cmp-stats' }, statRows) : null,
    lineList('Afixos ganhos', cmp.affixesGained, 'gain', '+'),
    lineList('Afixos perdidos', cmp.affixesLost, 'loss', '−'),
    passiveRows.length > 0 ? el('div', { className: 'cmp-section' }, [el('div', { className: 'cmp-section-title', text: 'Poder único' }), ...passiveRows]) : null,
    lineList('Bônus de conjunto ativados', cmp.setBonusesGained, 'gain', '◆'),
    lineList('Bônus de conjunto perdidos', cmp.setBonusesLost, 'loss', '◇'),
  ]);
}

const HOVER_QUERY = '(hover: hover) and (pointer: fine)';

/**
 * Wires tooltip + sheet onto inventory bag cards. One instance per
 * InventoryScreen; `dispose()` from its unmount.
 */
export class ItemCompareController {
  private tooltipEl: HTMLElement | null = null;
  private sheetEl: HTMLElement | null = null;
  private removeSheetKeys: (() => void) | null = null;
  private cleanups: Array<() => void> = [];

  constructor(
    private root: HTMLElement,
    private compare: (candidate: EquipmentInstance) => ItemComparison,
    private onEquip: (candidate: EquipmentInstance) => void,
  ) {}

  /** Hover tooltip (fine pointer), tap-and-hold / right-click sheet, and a click on the card's existing comparison badge also opens the sheet. */
  attach(card: HTMLElement, candidate: EquipmentInstance): void {
    const enter = () => {
      if (!window.matchMedia(HOVER_QUERY).matches || this.sheetEl) return;
      this.showTooltip(card, candidate);
    };
    const leave = () => this.hideTooltip();
    card.addEventListener('mouseenter', enter);
    card.addEventListener('mouseleave', leave);
    this.cleanups.push(() => {
      card.removeEventListener('mouseenter', enter);
      card.removeEventListener('mouseleave', leave);
    });
    this.cleanups.push(onLongPress(card, () => this.openSheet(candidate)));

    const badge = card.querySelector<HTMLElement>('.item-compare');
    if (badge) {
      badge.classList.add('cmp-badge-clickable');
      badge.setAttribute('role', 'button');
      badge.setAttribute('title', 'Comparar com o item equipado');
      badge.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.openSheet(candidate);
      });
      badge.append(el('span', { className: 'cmp-badge-more', text: ' · comparar' }));
    }
  }

  /** Drops every card binding (cards are rebuilt on each inventory render). Leaves an open sheet alone. */
  detachAll(): void {
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
    this.hideTooltip();
  }

  dispose(): void {
    this.detachAll();
    this.closeSheet();
  }

  get sheetOpen(): boolean {
    return this.sheetEl !== null;
  }

  private showTooltip(card: HTMLElement, candidate: EquipmentInstance): void {
    this.hideTooltip();
    const tip = el('div', { className: 'panel item-compare-tooltip', attrs: { role: 'tooltip' } }, [buildComparisonBody(this.compare(candidate))]);
    this.root.append(tip);
    this.tooltipEl = tip;
    // Beside the card — right if it fits, else left — clamped vertically into the viewport.
    const rect = card.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const gap = 10;
    let left = rect.right + gap;
    if (left + tipRect.width > window.innerWidth - 8) left = rect.left - gap - tipRect.width;
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - tipRect.height - 8));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    this.tooltipEl?.remove();
    this.tooltipEl = null;
  }

  openSheet(candidate: EquipmentInstance): void {
    this.hideTooltip();
    this.closeSheet();
    const equipBtn = addHotkeyHint(
      el('div', {
        className: 'btn primary',
        text: 'Equipar',
        onClick: () => {
          this.closeSheet();
          this.onEquip(candidate);
        },
      }),
      'Enter',
    );
    const closeBtn = addHotkeyHint(el('div', { className: 'btn', text: 'Fechar', onClick: () => this.closeSheet() }), 'Esc');
    const sheet = el('div', { className: 'panel item-compare-sheet', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Comparar item' } }, [
      el('h3', { text: 'Comparar com o equipado' }),
      buildComparisonBody(this.compare(candidate)),
      el('div', { className: 'row item-compare-actions' }, [closeBtn, equipBtn]),
    ]);
    const backdrop = el('div', { className: 'item-compare-backdrop' }, [sheet]);
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) this.closeSheet();
    });
    this.root.append(backdrop);
    this.sheetEl = backdrop;
    // Topmost key layer while open: Escape closes just the sheet (not the
    // whole inventory underneath), Enter equips.
    this.removeSheetKeys = pushKeyLayer(['Escape', 'Enter'], (key) => {
      if (key === 'Enter') equipBtn.click();
      else this.closeSheet();
    });
  }

  closeSheet(): void {
    this.removeSheetKeys?.();
    this.removeSheetKeys = null;
    this.sheetEl?.remove();
    this.sheetEl = null;
  }
}
