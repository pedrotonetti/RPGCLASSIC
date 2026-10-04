import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import type { Player } from '../entities/Player';
import { RARITY_ORDER, rarityToHex } from '../config/rarity';
import { ACHIEVEMENT_CATEGORY_LABEL, ACHIEVEMENT_CATEGORY_ORDER, ACHIEVEMENT_DEFINITIONS, type AchievementDefinition } from '../data/achievements';
import { achievementProgress, checkAchievements, describeReward, earnedTitles, isUnlocked } from '../systems/AchievementSystem';
import { codexCompletion, codexCounts, codexEntryViews, loreCounts, loreEntryViews, UNDISCOVERED_NAME, type CodexEntryView, type CodexSection } from '../systems/CodexSystem';
import { saveGame } from '../systems/SaveSystem';
import { el } from '../ui/dom';

type TabId = 'achievements' | 'enemies' | 'bosses' | 'npcs' | 'items' | 'lore';

interface TabDefinition {
  id: TabId;
  label: string;
  /** Códex sections this tab lists, in order — empty for the achievements tab. */
  sections: Array<{ section: CodexSection; heading: string }>;
}

const TABS: TabDefinition[] = [
  { id: 'achievements', label: 'Conquistas', sections: [] },
  { id: 'enemies', label: 'Inimigos', sections: [{ section: 'enemies', heading: 'Bestiário' }] },
  { id: 'bosses', label: 'Chefes', sections: [{ section: 'bosses', heading: 'Chefes' }] },
  { id: 'npcs', label: 'NPCs', sections: [{ section: 'npcs', heading: 'Habitantes de Ipêra' }] },
  {
    id: 'items',
    label: 'Itens & Materiais',
    sections: [
      { section: 'materials', heading: 'Materiais' },
      { section: 'equipment', heading: 'Equipamentos' },
    ],
  },
  { id: 'lore', label: 'Lore', sections: [] },
];

function tabCountLabel(player: Player, tab: TabDefinition): string {
  if (tab.id === 'achievements') return `${player.achievements.unlocked.length}/${ACHIEVEMENT_DEFINITIONS.length}`;
  if (tab.id === 'lore') {
    const counts = loreCounts(player.discoveredLoreIds);
    return `${counts.discovered}/${counts.total}`;
  }
  let discovered = 0;
  let total = 0;
  for (const { section } of tab.sections) {
    const counts = codexCounts(player.codex, section);
    discovered += counts.discovered;
    total += counts.total;
  }
  return `${discovered}/${total}`;
}

/**
 * "Conquistas e Códex" — reachable from the overworld's pause menu. Takes a
 * plain `onBack` closure (same shape as SettingsScreen) so the overworld can
 * rebuild itself on the way back without this screen knowing how.
 */
export class AchievementsScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private tab: TabId = 'achievements';
  private tabsEl!: HTMLElement;
  private panelEl!: HTMLElement;

  constructor(
    private game: Game,
    private onBack: () => void,
    private player: Player,
  ) {
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50);
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x0d0a12);
    this.camera.position.set(0, 0, 5);
    // Brings the Códex and the list up to date with whatever the player did since the overworld last polled.
    checkAchievements(this.player);
    this.buildUi();
  }

  unmount(): void {}

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(): void {}

  private selectTab(tab: TabId): void {
    this.tab = tab;
    this.renderTabs();
    this.renderPanel();
  }

  private renderTabs(): void {
    this.tabsEl.replaceChildren(
      ...TABS.map((tab) =>
        el('div', {
          className: `btn achv-tab${tab.id === this.tab ? ' active' : ''}`,
          text: `${tab.label} (${tabCountLabel(this.player, tab)})`,
          onClick: () => this.selectTab(tab.id),
        }),
      ),
    );
  }

  private renderPanel(): void {
    this.panelEl.scrollTop = 0;
    const tab = TABS.find((t) => t.id === this.tab)!;
    const content = tab.id === 'achievements' ? this.achievementsContent() : tab.id === 'lore' ? this.loreContent() : this.codexContent(tab);
    this.panelEl.replaceChildren(...content);
  }

  // --- Conquistas ---------------------------------------------------------

  private achievementsContent(): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    const titles = earnedTitles(this.player.achievements);
    nodes.push(el('div', { className: 'achv-titles', text: titles.length > 0 ? `Títulos conquistados: ${titles.join(' · ')}` : 'Nenhum título conquistado ainda.' }));
    for (const category of ACHIEVEMENT_CATEGORY_ORDER) {
      const defs = ACHIEVEMENT_DEFINITIONS.filter((d) => d.category === category);
      if (defs.length === 0) continue;
      const done = defs.filter((d) => isUnlocked(this.player.achievements, d.id)).length;
      nodes.push(el('h3', { text: `${ACHIEVEMENT_CATEGORY_LABEL[category]} — ${done}/${defs.length}` }));
      nodes.push(el('div', { className: 'achv-list' }, defs.map((def) => this.achievementCard(def))));
    }
    return nodes;
  }

  private achievementCard(def: AchievementDefinition): HTMLElement {
    const unlocked = isUnlocked(this.player.achievements, def.id);
    const secret = def.hidden === true && !unlocked;
    const { current, target } = achievementProgress(def, this.player);
    const showBar = !unlocked && !secret && target > 1;

    const children: Array<HTMLElement | null> = [
      el('div', { className: 'achv-head' }, [
        el('div', { className: 'achv-name', text: secret ? UNDISCOVERED_NAME : def.name }),
        el('div', { className: 'achv-state', text: unlocked ? 'Concluída' : secret ? '' : target > 1 ? `${current}/${target}` : 'Pendente' }),
      ]),
      el('div', { className: 'achv-desc', text: secret ? 'Conquista secreta — continue explorando Ipêra.' : def.description }),
      showBar ? el('div', { className: 'achv-bar' }, [el('div', { className: 'achv-bar-fill', style: { width: `${Math.round((current / target) * 100)}%` } })]) : null,
      def.reward && !secret ? el('div', { className: 'achv-reward', text: `Recompensa: ${describeReward(def.reward)}` }) : null,
    ];
    return el('div', { className: `achv-card ${unlocked ? 'unlocked' : 'locked'}` }, children);
  }

  // --- Códex --------------------------------------------------------------

  private codexContent(tab: TabDefinition): HTMLElement[] {
    const nodes: HTMLElement[] = [];
    for (const { section, heading } of tab.sections) {
      const counts = codexCounts(this.player.codex, section);
      nodes.push(el('h3', { text: `${heading} — ${counts.discovered}/${counts.total} descobertos` }));
      nodes.push(el('div', { className: 'achv-list' }, codexEntryViews(this.player.codex, section).map((view) => this.codexCard(view))));
    }
    return nodes;
  }

  private loreContent(): HTMLElement[] {
    const counts = loreCounts(this.player.discoveredLoreIds);
    return [
      el('h3', { text: `Fragmentos de Memória — ${counts.discovered}/${counts.total} descobertos` }),
      el('div', { className: 'achv-list' }, loreEntryViews(this.player.discoveredLoreIds).map((view) => this.codexCard(view))),
    ];
  }

  private codexCard(view: CodexEntryView): HTMLElement {
    let swatchColor: string | null = null;
    if (view.rarityTierFound !== undefined) swatchColor = rarityToHex(RARITY_ORDER[view.rarityTierFound] ?? RARITY_ORDER[0]);
    else if (view.color !== undefined) swatchColor = `#${view.color.toString(16).padStart(6, '0')}`;

    return el('div', { className: `achv-card codex-entry ${view.discovered ? 'unlocked' : 'locked'}` }, [
      el('div', { className: 'achv-head' }, [
        el('div', { className: 'achv-name' }, [
          view.discovered && swatchColor ? el('span', { className: 'codex-swatch', style: { background: swatchColor } }) : null,
          view.name,
        ]),
      ]),
      el('div', { className: 'achv-desc', text: view.description }),
      ...view.details.map((line) => el('div', { className: 'codex-detail', text: line })),
    ]);
  }

  // --- layout -------------------------------------------------------------

  private buildUi(): void {
    const backBtn = el('div', {
      className: 'btn primary',
      text: '< Voltar à Aventura',
      onClick: () => {
        saveGame(this.player);
        this.onBack();
      },
    });

    this.tabsEl = el('div', { className: 'achv-tabs' });
    this.panelEl = el('div', { className: 'achv-panel panel' });
    this.renderTabs();
    this.renderPanel();

    const unlocked = this.player.achievements.unlocked.length;
    const completion = Math.round(codexCompletion(this.player.codex) * 100);
    const screen = el('div', { className: 'achievements-screen screen' }, [
      el('div', { className: 'top-bar' }, [
        el('h1', { text: 'Conquistas e Códex' }),
        el('div', { className: 'subtitle', text: `${unlocked}/${ACHIEVEMENT_DEFINITIONS.length} conquistas · Códex ${completion}% descoberto` }),
      ]),
      this.tabsEl,
      this.panelEl,
      el('div', { className: 'bottom-bar' }, [backBtn]),
    ]);
    this.game.uiRoot.append(screen);
  }
}
