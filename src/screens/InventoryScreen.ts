import * as THREE from 'three';
import type { EquipmentInstance, EquipmentSlot } from '../config/types';
import { RARITY_LABEL, rarityToHex } from '../config/rarity';
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
      .map(([stat, val]) => `${statAbbrev(stat)} +${val}`)
      .join('  ');
    return el('div', { className: 'item-stats', text: `${statText}  •  ${template.description}` });
  }

  private render(): void {
    this.powerScoreEl.textContent = `Power Score: ${computePowerScore(this.player).toLocaleString('pt-BR')}`;

    const slots: EquipmentSlot[] = ['arma', 'armadura', 'acessorio'];
    this.slotsEl.replaceChildren(
      ...slots.map((slot) => {
        const instance = this.player.equipment[slot];
        if (!instance) {
          return el('div', { className: 'equip-slot empty' }, [
            el('div', { className: 'slot-label', text: SLOT_LABELS[slot] }),
            el('div', { className: 'item-name', text: '(vazio)' }),
          ]);
        }
        const template = getEquipmentTemplate(instance.templateId);
        return el(
          'div',
          { className: 'equip-slot' },
          [
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
                this.render();
              },
            }),
          ],
        );
      }),
    );

    this.renderSupplies();

    if (this.player.bag.length === 0) {
      this.bagEl.replaceChildren(el('div', { className: 'item-name', text: '(mochila vazia — derrote inimigos para encontrar itens)' }));
      return;
    }

    const sorted = [...this.player.bag].sort((a, b) => b.itemLevel - a.itemLevel);
    this.bagEl.replaceChildren(
      ...sorted.map((instance) => {
        const template = getEquipmentTemplate(instance.templateId);
        return el(
          'div',
          { className: 'bag-item' },
          [
            el('div', { className: 'bag-item-info' }, [
              el('div', {
                className: 'item-name',
                text: `${template.name} (Nv.${instance.itemLevel})`,
                style: { color: rarityToHex(instance.rarity) },
              }),
              el('div', { className: 'item-rarity', text: `${RARITY_LABEL[instance.rarity]} • ${SLOT_LABELS[template.slot]}` }),
              this.itemLine(instance),
            ]),
            el('div', {
              className: 'btn small',
              text: 'Equipar',
              onClick: () => {
                this.player.equipFromBag(instance.uid);
                saveGame(this.player);
                this.rebuildShowcase();
                this.render();
              },
            }),
          ],
        );
      }),
    );
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
