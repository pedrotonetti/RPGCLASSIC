import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { Player } from '../entities/Player';
import { getBossById } from '../data/bosses';
import { getEnemyById } from '../data/enemies';
import { getNpcById } from '../data/npcs';
import { getQuestById, type QuestDefinition } from '../data/quests';
import { getZoneById } from '../data/zones';
import { currentQuest } from '../systems/QuestSystem';
import { saveGame } from '../systems/SaveSystem';
import { el, goToLazy } from '../ui/dom';

/** Name of a `defeat` objective's enemy (regular or boss id — see Enemy.def's own fallback), or a generic label when the objective accepts any enemy. */
function enemyLabel(targetId: string | undefined): string {
  if (!targetId) return 'inimigos';
  const def = getBossById(targetId) ?? getEnemyById(targetId);
  return def.name;
}

/** Full, reader-facing objective line for the quest log — deliberately fuller than the HUD tracker's own terse questTrackerText, but built from the exact same QuestObjective data. */
function objectiveLine(player: Player, quest: QuestDefinition): string {
  const obj = quest.objective;
  if (obj.kind === 'talkTo') {
    const npc = getNpcById(obj.targetId!);
    const zoneName = getZoneById(npc.zoneId).name;
    return npc.zoneId === player.zoneId ? `Fale com ${npc.name}, em ${zoneName}.` : `Vá até ${zoneName} e fale com ${npc.name}.`;
  }
  if (obj.kind === 'reachLevel') {
    return `Alcance o nível ${obj.amount} (nível atual: ${player.level}).`;
  }
  const have = player.questProgress[quest.id] ?? 0;
  return `Derrote ${enemyLabel(obj.targetId)} (${Math.min(have, obj.amount)}/${obj.amount}).`;
}

function rewardLine(quest: QuestDefinition): string {
  const parts = [`+${quest.rewardXp} XP`, `+${quest.rewardGold} ouro`];
  if (quest.rewardItem) parts.push('1 item');
  return `Recompensa: ${parts.join(', ')}.`;
}

export class QuestLogScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  constructor(
    private game: Game,
    private player: Player,
  ) {
    this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 50);
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x0d0a12);
    this.camera.position.set(0, 0, 5);
    this.buildUi();
  }

  unmount(): void {}

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  update(): void {}

  private buildActiveQuestSection(): HTMLElement {
    const quest = currentQuest(this.player);
    if (!quest) {
      return el('div', { className: 'questlog-active' }, [
        el('div', {
          className: 'item-name',
          text: this.player.completedQuestIds.length > 0 ? 'Nenhuma missão ativa no momento.' : 'Nenhuma missão ativa.',
        }),
      ]);
    }
    return el('div', { className: 'questlog-active' }, [
      el('div', { className: 'questlog-title', text: quest.title }),
      el('div', { className: 'questlog-desc', text: quest.description }),
      el('div', { className: 'questlog-objective', text: objectiveLine(this.player, quest) }),
      el('div', { className: 'questlog-reward', text: rewardLine(quest) }),
    ]);
  }

  private buildHistorySection(): HTMLElement {
    // Most recently completed first — completedQuestIds is appended to in
    // completion order (see QuestSystem.completeQuest), so the log reads
    // newest-on-top like most quest-history UIs.
    const rows = [...this.player.completedQuestIds]
      .reverse()
      .map((id) => getQuestById(id))
      .filter((q): q is QuestDefinition => q !== undefined)
      .map((quest) =>
        el('div', { className: 'questlog-history-row' }, [
          el('div', { className: 'item-name', text: quest.title }),
          el('div', { className: 'questlog-reward', text: rewardLine(quest) }),
        ]),
      );
    if (rows.length === 0) {
      return el('div', { className: 'bag-list' }, [
        el('div', { className: 'item-name', text: '(nenhuma missão concluída ainda)' }),
      ]);
    }
    return el('div', { className: 'bag-list' }, rows);
  }

  private buildUi(): void {
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

    const screen = el('div', { className: 'questlog-screen screen' }, [
      el('div', { className: 'top-bar' }, [
        el('h1', { text: 'Diário de Missões' }),
        el('div', { className: 'subtitle', text: `${this.player.completedQuestIds.length} missões concluídas` }),
      ]),
      el('div', { className: 'questlog-panel panel' }, [
        el('h3', { text: 'Missão Atual' }),
        this.buildActiveQuestSection(),
        el('h3', { text: 'Missões Concluídas' }),
        this.buildHistorySection(),
      ]),
      el('div', { className: 'bottom-bar' }, [backBtn]),
    ]);
    this.game.uiRoot.append(screen);
  }
}
