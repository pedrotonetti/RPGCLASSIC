import * as THREE from 'three';
import type { EquipmentInstance, EquipmentSlot, ItemRarity } from '../config/types';
import { RARITY_LABEL, RARITY_SCORE_MULTIPLIER, rarityToHex } from '../config/rarity';
import { computeEquipmentBonus, getEquipmentTemplate } from '../data/equipment';
import { getGemById } from '../data/gems';
import { getItemById } from '../data/items';
import { getMaterialById } from '../data/materials';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { Player } from '../entities/Player';
import { buildPlayerCharacter } from '../render/characterModel';
import { computePowerScore } from '../systems/PowerScore';
import { saveGame } from '../systems/SaveSystem';
import { el, goToLazy } from '../ui/dom';

/** Resolves a player.inventory key (potion, gem, or material id) to a display name and optional swatch color. */
function inventoryEntryInfo(id: string): { name: string; color?: number } {
  if (id.startsWith('gem_')) {
    const gem = getGemById(id);
    return { name: gem.name, color: gem.color };
  }
  if (id.startsWith('mat_')) {
    const material = getMaterialById(id);
    return { name: material.name, color: material.color };
  }
  return { name: getItemById(id).name };
}

const SLOT_LABELS: Record<EquipmentSlot, string> = {
  arma: 'Arma',
  armadura: 'Armadura',
  acessorio: 'Acessório',
};

/** Bag items are grouped by slot in this order, matching the "Equipado" section above them. */
const SLOT_ORDER: EquipmentSlot[] = ['arma', 'armadura', 'acessorio'];

/** Formats a stat bonus with an explicit sign — `computeEquipmentBonus` can return negative values (e.g. a weapon's speed penalty), and a bare template-literal `+` prefix used to render those as a broken "+-4.6". */
function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

/**
 * A single rough "how strong is this item" number, reusing the same
 * rarity/level weighting as `computePowerScore`'s own gear contribution, so
 * the comparison below tracks the same notion of strength the Power Score
 * headline already communicates. Used only to compare like-for-like
 * candidates for the same slot — not a substitute for reading the stat line.
 */
function itemPower(instance: EquipmentInstance): number {
  return RARITY_SCORE_MULTIPLIER[instance.rarity] * instance.itemLevel;
}

// --- item icons -----------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

interface IconShape {
  tag: 'rect' | 'circle' | 'ellipse' | 'path' | 'line';
  attrs: Record<string, string>;
}

/**
 * A distinct low-poly-flat silhouette per equipment template — plain SVG
 * primitives (rects/circles/paths), never a bitmap, matching this game's
 * flat-shaded primitive-geometry look elsewhere. Every shape that isn't
 * explicitly given a `fill`/`stroke` uses `currentColor`, so a single CSS
 * `color` (set to the item's rarity color — see `itemIcon`) tints the whole
 * icon consistently with its swatch border/glow.
 */
const ITEM_ICON_SHAPES: Record<string, IconShape[]> = {
  // --- weapons -------------------------------------------------------------
  espada_curta: [
    { tag: 'rect', attrs: { x: '14.5', y: '4', width: '3', height: '16', rx: '1' } },
    { tag: 'rect', attrs: { x: '9', y: '19', width: '14', height: '3', rx: '1' } },
    { tag: 'rect', attrs: { x: '14.5', y: '22', width: '3', height: '7', rx: '1' } },
  ],
  machado_guerra: [
    { tag: 'rect', attrs: { x: '14.5', y: '4', width: '3', height: '24', rx: '1' } },
    { tag: 'path', attrs: { d: 'M18 6 L28 9 L28 19 L18 15 Z' } },
  ],
  cajado_arcano: [
    { tag: 'rect', attrs: { x: '14.5', y: '10', width: '3', height: '20', rx: '1' } },
    { tag: 'circle', attrs: { cx: '16', cy: '7', r: '5' } },
  ],
  arco_longo: [
    { tag: 'path', attrs: { d: 'M11 4 Q22 16 11 28', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.4' } },
    { tag: 'line', attrs: { x1: '11', y1: '4', x2: '11', y2: '28', stroke: 'currentColor', 'stroke-width': '1.3' } },
  ],
  adaga_sombria: [
    { tag: 'rect', attrs: { x: '14.5', y: '9', width: '3', height: '10', rx: '1' } },
    { tag: 'rect', attrs: { x: '11', y: '19', width: '10', height: '2.5', rx: '1' } },
    { tag: 'rect', attrs: { x: '14.5', y: '21.5', width: '3', height: '6', rx: '1' } },
  ],
  grimorio_amaldicoado: [
    { tag: 'rect', attrs: { x: '6', y: '7', width: '20', height: '18', rx: '2', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.3' } },
    { tag: 'line', attrs: { x1: '16', y1: '7', x2: '16', y2: '25', stroke: 'currentColor', 'stroke-width': '1.3' } },
  ],
  manoplas_combate: [
    { tag: 'circle', attrs: { cx: '12', cy: '17', r: '6' } },
    { tag: 'circle', attrs: { cx: '21', cy: '15', r: '4.5' } },
  ],
  martelo_sagrado: [
    { tag: 'rect', attrs: { x: '14.5', y: '11', width: '3', height: '19', rx: '1' } },
    { tag: 'rect', attrs: { x: '8', y: '4', width: '16', height: '8', rx: '1.5' } },
  ],
  // --- armor -----------------------------------------------------------------
  armadura_couro: [{ tag: 'path', attrs: { d: 'M11 6 L21 6 L24 26 L8 26 Z' } }],
  armadura_placas: [
    { tag: 'path', attrs: { d: 'M9 6 L23 6 L25 26 L7 26 Z' } },
    { tag: 'line', attrs: { x1: '16', y1: '7', x2: '16', y2: '25', stroke: 'rgba(0,0,0,0.35)', 'stroke-width': '1.3' } },
  ],
  vestes_arcanas: [{ tag: 'path', attrs: { d: 'M13 5 L19 5 L23 27 L9 27 Z' } }],
  manto_sagrado: [
    { tag: 'path', attrs: { d: 'M16 6 C8 8 6 17 8 27 L24 27 C26 17 24 8 16 6 Z' } },
    { tag: 'circle', attrs: { cx: '16', cy: '9', r: '2', fill: 'rgba(0,0,0,0.35)' } },
  ],
  // --- accessories -------------------------------------------------------------
  anel_sorte: [
    { tag: 'circle', attrs: { cx: '16', cy: '19', r: '7', fill: 'none', stroke: 'currentColor', 'stroke-width': '3.4' } },
    { tag: 'circle', attrs: { cx: '16', cy: '8', r: '3' } },
  ],
  amuleto_vitalidade: [
    { tag: 'path', attrs: { d: 'M12 4 L20 4 L16 11 Z' } },
    { tag: 'circle', attrs: { cx: '16', cy: '19', r: '7', fill: 'none', stroke: 'currentColor', 'stroke-width': '3' } },
  ],
  bracelete_arcano: [{ tag: 'ellipse', attrs: { cx: '16', cy: '16', rx: '10', ry: '6', fill: 'none', stroke: 'currentColor', 'stroke-width': '3.4' } }],
  talisma_velocidade: [
    { tag: 'path', attrs: { d: 'M16 4 L24 16 L16 28 L8 16 Z', fill: 'none', stroke: 'currentColor', 'stroke-width': '2.3' } },
    { tag: 'line', attrs: { x1: '16', y1: '10', x2: '16', y2: '22', stroke: 'currentColor', 'stroke-width': '1.3' } },
  ],
};

const FALLBACK_ICON_SHAPE: IconShape[] = [{ tag: 'rect', attrs: { x: '9', y: '9', width: '14', height: '14', rx: '2' } }];

function buildItemIconSvg(templateId: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg') as unknown as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('width', '26');
  svg.setAttribute('height', '26');
  const shapes = ITEM_ICON_SHAPES[templateId] ?? FALLBACK_ICON_SHAPE;
  for (const shape of shapes) {
    const node = document.createElementNS(SVG_NS, shape.tag);
    for (const [k, v] of Object.entries(shape.attrs)) node.setAttribute(k, v);
    if (!node.hasAttribute('fill')) node.setAttribute('fill', 'currentColor');
    svg.append(node);
  }
  return svg;
}

/** Sets the shared `--rarity-color` custom property a card/icon reads for its border/glow (and, on `.item-icon`, its `currentColor` fill) — see the `.rarity-border`/`.rarity-mythic` rules in style.css. Single source of truth stays `config/rarity.ts`'s RARITY_COLOR; nothing here hardcodes a rarity's hex. */
function applyRarityBorder(node: HTMLElement, rarity: ItemRarity): void {
  node.style.setProperty('--rarity-color', rarityToHex(rarity));
  node.classList.add('rarity-border');
  if (rarity === 'laranja') node.classList.add('rarity-mythic');
}

function itemIcon(templateId: string, rarity: ItemRarity): HTMLElement {
  const wrap = el('div', { className: 'item-icon' });
  applyRarityBorder(wrap, rarity);
  wrap.append(buildItemIconSvg(templateId) as unknown as Node);
  return wrap;
}

export class InventoryScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private showcase!: THREE.Group;
  private time = 0;

  private slotsEl!: HTMLElement;
  private bagEl!: HTMLElement;
  private suppliesEl!: HTMLElement;
  private powerScoreEl!: HTMLElement;

  constructor(
    private game: Game,
    private player: Player,
  ) {
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 50);
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x1a1423);
    this.scene.fog = new THREE.Fog(0x1a1423, 6, 15);
    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    const key = new THREE.DirectionalLight(0xf2ede1, 1.0);
    key.position.set(2.5, 4, 3);
    this.scene.add(ambient, key);
    this.camera.position.set(-1.1, 0.95, 3.6);
    this.camera.lookAt(-1.1, 0.8, 0);

    this.showcase = buildPlayerCharacter(this.player);
    this.scene.add(this.showcase);

    this.buildUi();
  }

  unmount(): void {}

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    this.showcase.rotation.y = Math.sin(this.time * 0.4) * 0.4;
  }

  private buildUi(): void {
    this.powerScoreEl = el('div', { className: 'subtitle', text: '' });
    this.slotsEl = el('div', { className: 'equip-slots' });
    this.bagEl = el('div', { className: 'bag-list' });
    this.suppliesEl = el('div', { className: 'bag-list' });

    const backBtn = el('div', {
      className: 'btn primary',
      text: '< Voltar à Aventura',
      onClick: () => {
        saveGame(this.player);
        goToLazy(this.game, async () => {
          const [{ OverworldScreen }, { loadPlayerAvatar }] = await Promise.all([import('./OverworldScreen'), import('../render/playerAvatar')]);
          const avatar = await loadPlayerAvatar(this.player);
          return new OverworldScreen(this.game, this.player, avatar);
        });
      },
    });

    const screen = el('div', { className: 'inventory-screen screen' }, [
      el('div', { className: 'top-bar' }, [el('h1', { text: 'Inventário e Equipamento' }), this.powerScoreEl]),
      el('div', { className: 'inventory-panel panel' }, [
        el('h3', { text: 'Equipado' }),
        this.slotsEl,
        el('h3', { text: 'Mochila' }),
        this.bagEl,
        el('h3', { text: 'Poções, Gemas e Materiais' }),
        this.suppliesEl,
      ]),
      el('div', { className: 'bottom-bar' }, [backBtn]),
    ]);
    this.game.uiRoot.append(screen);
    this.render();
  }

  private itemLine(instance: EquipmentInstance): HTMLElement {
    const template = getEquipmentTemplate(instance.templateId);
    const bonus = computeEquipmentBonus(instance);
    const statText = Object.entries(bonus)
      .map(([stat, val]) => `${statAbbrev(stat)} ${formatSigned(val)}`)
      .join('  ');
    return el('div', { className: 'item-stats', text: `${statText}  •  ${template.description}` });
  }

  /**
   * Tells the player, at a glance, whether a bag item is worth equipping
   * over whatever's already in that slot — the exact call the Power Score
   * header and per-item stat line don't make explicit on their own. Compares
   * the same rarity/level-weighted "power" the Power Score's own gear
   * contribution uses, so "melhoria"/"inferior" here agrees with whether the
   * headline number would actually go up or down.
   */
  private comparisonBadge(candidate: EquipmentInstance): HTMLElement {
    const slot = getEquipmentTemplate(candidate.templateId).slot;
    const equipped = this.player.equipment[slot];
    if (!equipped) {
      return el('div', { className: 'item-compare upgrade', text: `▲ Nada equipado em ${SLOT_LABELS[slot]} — equipar é ganho garantido` });
    }
    const delta = itemPower(candidate) - itemPower(equipped);
    if (Math.abs(delta) < 0.5) {
      return el('div', { className: 'item-compare neutral', text: `≈ Poder equivalente ao ${getEquipmentTemplate(equipped.templateId).name} equipado` });
    }
    const cls = delta > 0 ? 'upgrade' : 'downgrade';
    const arrow = delta > 0 ? '▲' : '▼';
    const verdict = delta > 0 ? 'Melhoria' : 'Mais fraco';
    return el('div', {
      className: `item-compare ${cls}`,
      text: `${arrow} ${verdict} vs. equipado (Poder ${formatSigned(Math.round(delta))})`,
    });
  }

  /** One "Equipado" slot card: an empty placeholder, or the icon + stat readout for what's currently worn there. */
  private equipSlotCard(slot: EquipmentSlot): HTMLElement {
    const instance = this.player.equipment[slot];
    if (!instance) {
      return el('div', { className: 'equip-slot empty' }, [
        el('div', { className: 'slot-label', text: SLOT_LABELS[slot] }),
        el('div', { className: 'item-name', text: '(vazio)' }),
      ]);
    }
    const template = getEquipmentTemplate(instance.templateId);
    const card = el('div', { className: 'equip-slot' }, [
      itemIcon(instance.templateId, instance.rarity),
      el('div', { className: 'equip-slot-body' }, [
        el('div', { className: 'slot-label', text: SLOT_LABELS[slot] }),
        el('div', { className: 'item-name', text: `${template.name} (Nv.${instance.itemLevel})`, style: { color: rarityToHex(instance.rarity) } }),
        el('div', { className: 'item-rarity', text: RARITY_LABEL[instance.rarity] }),
        this.itemLine(instance),
        el('div', {
          className: 'btn small',
          text: 'Desequipar',
          onClick: () => {
            this.player.unequip(slot);
            saveGame(this.player);
            this.rebuildShowcase();
            this.render();
          },
        }),
      ]),
    ]);
    applyRarityBorder(card, instance.rarity);
    return card;
  }

  /** One bag card in a slot's grid: icon, name/rarity/level, stat line, upgrade-or-not verdict, and an Equipar button. */
  private bagCard(instance: EquipmentInstance): HTMLElement {
    const template = getEquipmentTemplate(instance.templateId);
    const card = el('div', { className: 'bag-card' }, [
      el('div', { className: 'bag-card-top' }, [
        itemIcon(instance.templateId, instance.rarity),
        el('div', { className: 'bag-card-info' }, [
          el('div', {
            className: 'item-name',
            text: `${template.name} (Nv.${instance.itemLevel})`,
            style: { color: rarityToHex(instance.rarity) },
          }),
          el('div', { className: 'item-rarity', text: RARITY_LABEL[instance.rarity] }),
          this.itemLine(instance),
          this.comparisonBadge(instance),
        ]),
      ]),
      el('div', {
        className: 'btn small bag-card-equip',
        text: 'Equipar',
        onClick: () => {
          this.player.equipFromBag(instance.uid);
          saveGame(this.player);
          this.rebuildShowcase();
          this.render();
        },
      }),
    ]);
    applyRarityBorder(card, instance.rarity);
    return card;
  }

  private render(): void {
    this.powerScoreEl.textContent = `Power Score: ${computePowerScore(this.player).toLocaleString('pt-BR')}`;

    this.slotsEl.replaceChildren(...SLOT_ORDER.map((slot) => this.equipSlotCard(slot)));

    this.renderSupplies();

    if (this.player.bag.length === 0) {
      this.bagEl.replaceChildren(el('div', { className: 'item-name', text: '(mochila vazia — derrote inimigos para encontrar itens)' }));
      return;
    }

    // A visually separate section per slot (Arma/Armadura/Acessório), each
    // its own grid of icon-first item cards — not one flat scrolling list —
    // so the bag reads as "what weapons do I have" / "what armor do I have"
    // at a glance, matching a real per-item-type inventory instead of a
    // single undifferentiated pile. Within each section, highest item level
    // first (the strongest candidate for that slot leads).
    const sections: HTMLElement[] = [];
    for (const slot of SLOT_ORDER) {
      const items = this.player.bag
        .filter((instance) => getEquipmentTemplate(instance.templateId).slot === slot)
        .sort((a, b) => b.itemLevel - a.itemLevel);
      if (items.length === 0) continue;
      sections.push(
        el('div', { className: 'bag-section' }, [
          el('div', { className: 'bag-slot-header', text: `${SLOT_LABELS[slot]} (${items.length})` }),
          el(
            'div',
            { className: 'bag-grid' },
            items.map((instance) => this.bagCard(instance)),
          ),
        ]),
      );
    }
    this.bagEl.replaceChildren(...sections);
  }

  private renderSupplies(): void {
    const entries = Object.entries(this.player.inventory).filter(([, count]) => count > 0);
    if (entries.length === 0) {
      this.suppliesEl.replaceChildren(el('div', { className: 'item-name', text: '(nada em posse — poções, gemas e materiais aparecem aqui)' }));
      return;
    }
    this.suppliesEl.replaceChildren(
      ...entries.map(([id, count]) => {
        const info = inventoryEntryInfo(id);
        const nameChildren: Array<HTMLElement | string> =
          info.color !== undefined
            ? [el('span', { className: 'swatch gem-swatch', style: { background: `#${info.color.toString(16).padStart(6, '0')}` } }), info.name]
            : [info.name];
        return el('div', { className: 'bag-item' }, [
          el('div', { className: 'bag-item-info' }, [el('div', { className: 'item-name' }, nameChildren)]),
          el('div', { className: 'item-rarity', text: `x${count}` }),
        ]);
      }),
    );
  }

  private rebuildShowcase(): void {
    this.scene.remove(this.showcase);
    this.showcase.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose();
      }
    });
    this.showcase = buildPlayerCharacter(this.player);
    this.scene.add(this.showcase);
  }
}

function statAbbrev(stat: string): string {
  const map: Record<string, string> = {
    maxHp: 'HP',
    maxMp: 'MP',
    attack: 'ATQ',
    magicAttack: 'MAG',
    defense: 'DEF',
    magicDefense: 'RES',
    speed: 'VEL',
    luck: 'SOR',
  };
  return map[stat] ?? stat;
}
