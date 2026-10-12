/**
 * Bancadas de ofício dentro da loja de cada vendedor: receitas (toda bancada),
 * Encantamento (Joalheiro) e Aprimoramento (Ferreiro). Só DOM — as regras e os
 * custos vivem em systems/CraftingSystem.ts e systems/EnchantSystem.ts.
 * OverworldScreen.renderShop pede `sections(vendor)` e repinta a loja no `onChange`.
 */
import { RARITY_LABEL, rarityToHex } from '../config/rarity';
import type { EquipmentInstance } from '../config/types';
import { describeAffix } from '../data/affixes';
import { getEquipmentTemplate, itemDisplayName } from '../data/equipment';
import { getItemById } from '../data/items';
import { getMaterialById } from '../data/materials';
import type { VendorInfo } from '../data/npcs';
import { recipesForStation, type RecipeDefinition } from '../data/recipes';
import type { Player } from '../entities/Player';
import { recordItemCrafted, recordItemEnchanted, recordItemUpgraded } from '../systems/AchievementSystem';
import { CRAFT_FAILURE_TEXT, craftBlocker, craftRecipe, ownedQty, recipeCost, type Purse, type WorkshopCost } from '../systems/CraftingSystem';
import {
  ENCHANT_FAILURE_TEXT,
  UPGRADE_FAILURE_TEXT,
  enchantAffix,
  enchantBlocker,
  enchantCost,
  enchantableIndices,
  isUniqueItem,
  lockedAffixIndex,
  maxUpgradeLevel,
  upgradeBlocker,
  upgradeCost,
  upgradeItem,
  upgradeLevelOf,
} from '../systems/EnchantSystem';
import { el } from './dom';

/** "2/3 Minério de Ferro · 1/1 Essência Sedenta · 120g" — what you have against what it takes. */
export function formatCost(purse: Purse, cost: WorkshopCost): string {
  const parts = cost.materials.map((m) => `${ownedQty(purse, m.materialId)}/${m.qty} ${getMaterialById(m.materialId).name}`);
  parts.push(`${cost.gold}g`);
  return parts.join(' · ');
}

function itemTitle(instance: EquipmentInstance): HTMLElement {
  return el('div', { className: 'item-name', text: `${itemDisplayName(instance)} (Nv.${instance.itemLevel})`, style: { color: rarityToHex(instance.rarity) } });
}

/** Equipped gear first (what the player is most likely to invest in), then the bag. */
function workableItems(player: Player): Array<{ instance: EquipmentInstance; equipped: boolean }> {
  const equipped = (['arma', 'armadura', 'acessorio'] as const)
    .map((slot) => player.equipment[slot])
    .filter((i): i is EquipmentInstance => i !== undefined)
    .map((instance) => ({ instance, equipped: true }));
  const bag = [...player.bag].sort((a, b) => b.itemLevel - a.itemLevel).map((instance) => ({ instance, equipped: false }));
  return [...equipped, ...bag];
}

export class WorkshopPanel {
  private notice: string | null = null;

  constructor(
    private player: Player,
    /** Persist and repaint the shop. */
    private onChange: () => void,
  ) {}

  /** Clears the last result line — call when the shop opens for a new vendor. */
  reset(): void {
    this.notice = null;
  }

  sections(vendor: VendorInfo): HTMLElement[] {
    if (vendor.noCrafting) return [];
    const out: HTMLElement[] = [];
    if (this.notice) out.push(el('div', { className: 'workshop-notice', text: this.notice }));
    const recipes = this.recipeSection(vendor);
    if (recipes) out.push(recipes);
    if (vendor.kind === 'joalheiro') out.push(this.enchantSection());
    if (vendor.kind === 'ferreiro') out.push(this.upgradeSection());
    return out;
  }

  private done(notice: string): void {
    this.notice = notice;
    this.onChange();
  }

  // --- receitas -------------------------------------------------------------

  private recipeSection(vendor: VendorInfo): HTMLElement | null {
    const recipes = recipesForStation(vendor.kind);
    if (recipes.length === 0) return null;
    return el('div', { className: 'shop-section workshop-section' }, [el('h3', { text: 'Oficina — Receitas' }), ...recipes.map((r) => this.recipeRow(r))]);
  }

  private recipeOutputLabel(recipe: RecipeDefinition): string {
    const out = recipe.output;
    if (out.kind === 'item') return `${getItemById(out.itemId).name} x${out.qty}`;
    return `${getEquipmentTemplate(out.templateId).name} (${RARITY_LABEL[out.rarity]}, Nv.${Math.max(1, this.player.level)})`;
  }

  private recipeRow(recipe: RecipeDefinition): HTMLElement {
    const blocker = craftBlocker(recipe, this.player);
    const cost = recipeCost(recipe, this.player.level);
    const label = blocker === 'level' ? `Requer Nv.${recipe.minLevel}` : blocker === 'bag' ? 'Mochila cheia' : 'Criar';
    return el('div', { className: 'shop-row' }, [
      el('div', { className: 'shop-row-info' }, [
        el('div', { className: 'item-name', text: `${recipe.name} → ${this.recipeOutputLabel(recipe)}` }),
        el('div', { className: 'item-rarity', text: recipe.description }),
        el('div', { className: 'workshop-cost', text: formatCost(this.player, cost) }),
      ]),
      el('div', { className: 'row shop-row-actions' }, [
        el('div', {
          className: `btn small ${blocker ? 'disabled' : ''}`,
          text: label,
          onClick: blocker ? undefined : () => this.craft(recipe),
        }),
      ]),
    ]);
  }

  private craft(recipe: RecipeDefinition): void {
    const result = craftRecipe(recipe, this.player);
    if (!result.ok) {
      this.done(CRAFT_FAILURE_TEXT[result.reason]);
      return;
    }
    if (result.output.kind === 'equipment') {
      const instance = result.output.instance;
      recordItemCrafted(this.player, instance.rarity);
      this.done(`Criado: ${itemDisplayName(instance)} (${RARITY_LABEL[instance.rarity]}) — está na mochila.`);
    } else {
      recordItemCrafted(this.player, 'verde');
      this.done(`Criado: ${getItemById(result.output.itemId).name} x${result.output.qty}.`);
    }
  }

  // --- encantamento -----------------------------------------------------------

  private enchantSection(): HTMLElement {
    const items = workableItems(this.player).filter(({ instance }) => (instance.affixes?.length ?? 0) > 0);
    const intro = el('div', {
      className: 'item-rarity',
      text: 'Troque um afixo por um novo sorteio. Depois do primeiro encantamento, só aquele afixo pode ser reencantado — e cada tentativa custa mais. O poder de um item único nunca muda.',
    });
    const rows = items.length > 0 ? items.map(({ instance, equipped }) => this.enchantRow(instance, equipped)) : [el('div', { className: 'item-rarity', text: '(nenhum item com afixos — Raros ou melhores têm)' })];
    return el('div', { className: 'shop-section workshop-section' }, [el('h3', { text: 'Encantamento' }), intro, ...rows]);
  }

  private enchantRow(instance: EquipmentInstance, equipped: boolean): HTMLElement {
    const cost = enchantCost(instance);
    const allowed = enchantableIndices(instance);
    const locked = lockedAffixIndex(instance);
    const affixRows = (instance.affixes ?? []).map((affix, index) => {
      const text = describeAffix(affix) ?? affix.id;
      const blocker = enchantBlocker(this.player, instance, index);
      const isAllowed = allowed.includes(index);
      return el('div', { className: 'workshop-affix-row' }, [
        el('div', { className: `item-affix ${isAllowed ? '' : 'workshop-locked'}`, text: `◆ ${text}${locked === index ? ' (encantado)' : isAllowed ? '' : ' (travado)'}` }),
        isAllowed
          ? el('div', {
              className: `btn small ${blocker ? 'disabled' : ''}`,
              text: 'Reencantar',
              onClick: blocker ? undefined : () => this.enchant(instance, index),
            })
          : null,
      ]);
    });
    const tags = [equipped ? 'Equipado' : 'Mochila', RARITY_LABEL[instance.rarity]];
    if (isUniqueItem(instance)) tags.push('Único — passiva fixa');
    const row = el('div', { className: 'shop-row workshop-item' }, [
      el('div', { className: 'shop-row-info' }, [
        itemTitle(instance),
        el('div', { className: 'item-rarity', text: tags.join(' · ') }),
        ...affixRows,
        el('div', { className: 'workshop-cost', text: `Custo: ${formatCost(this.player, cost)}` }),
      ]),
    ]);
    row.style.setProperty('--rarity-color', rarityToHex(instance.rarity));
    return row;
  }

  private enchant(instance: EquipmentInstance, index: number): void {
    const result = enchantAffix(this.player, instance, index);
    if (!result.ok) {
      this.done(ENCHANT_FAILURE_TEXT[result.reason]);
      return;
    }
    recordItemEnchanted(this.player);
    const before = describeAffix(result.previous) ?? result.previous.id;
    const after = describeAffix(result.next) ?? result.next.id;
    this.done(`${itemDisplayName(instance)}: "${before}" virou "${after}".`);
  }

  // --- aprimoramento --------------------------------------------------------

  private upgradeSection(): HTMLElement {
    const intro = el('div', {
      className: 'item-rarity',
      text: 'Cada aprimoramento sobe o item 1 nível (atributos base mais fortes). Até +5, ou +3 em itens únicos.',
    });
    const rows = workableItems(this.player).map(({ instance, equipped }) => this.upgradeRow(instance, equipped));
    if (rows.length === 0) rows.push(el('div', { className: 'item-rarity', text: '(nenhum equipamento para aprimorar)' }));
    return el('div', { className: 'shop-section workshop-section' }, [el('h3', { text: 'Aprimoramento' }), intro, ...rows]);
  }

  private upgradeRow(instance: EquipmentInstance, equipped: boolean): HTMLElement {
    const cost = upgradeCost(instance);
    const blocker = upgradeBlocker(this.player, instance);
    const steps = `${upgradeLevelOf(instance)}/${maxUpgradeLevel(instance)}`;
    return el('div', { className: 'shop-row' }, [
      el('div', { className: 'shop-row-info' }, [
        itemTitle(instance),
        el('div', { className: 'item-rarity', text: `${equipped ? 'Equipado' : 'Mochila'} · Aprimoramento ${steps}` }),
        el('div', { className: 'workshop-cost', text: cost ? `Custo: ${formatCost(this.player, cost)}` : 'Aprimoramento máximo.' }),
      ]),
      el('div', { className: 'row shop-row-actions' }, [
        el('div', {
          className: `btn small ${blocker ? 'disabled' : ''}`,
          text: cost ? `Aprimorar → Nv.${instance.itemLevel + 1}` : 'Máximo',
          onClick: blocker ? undefined : () => this.upgrade(instance),
        }),
      ]),
    ]);
  }

  private upgrade(instance: EquipmentInstance): void {
    const result = upgradeItem(this.player, instance);
    if (!result.ok) {
      this.done(UPGRADE_FAILURE_TEXT[result.reason]);
      return;
    }
    recordItemUpgraded(this.player);
    this.done(`${itemDisplayName(instance)} agora é Nv.${result.itemLevel}.`);
  }
}
