import * as THREE from 'three';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { Player } from '../entities/Player';
import { estimatePlayerRank, getTopRivals, rankPercentile, TOTAL_SIMULATED_PLAYERS } from '../data/leaderboard';
import { computePowerScore } from '../systems/PowerScore';
import { el } from '../ui/dom';
import { OverworldScreen } from './OverworldScreen';

export class RankingScreen implements Screen {
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

  private buildUi(): void {
    const powerScore = computePowerScore(this.player);
    const rank = estimatePlayerRank(powerScore);
    const percentile = rankPercentile(rank);

    const rivals = getTopRivals();

    const rows = rivals.map((rival, i) =>
      el('div', { className: 'rank-row' }, [
        el('div', { className: 'rank-pos', text: `#${i + 1}` }),
        el('div', { className: 'rank-name', text: rival.name }),
        el('div', { className: 'rank-class', text: `${rival.className} Nv.${rival.level}` }),
        el('div', { className: 'rank-score', text: rival.powerScore.toLocaleString('pt-BR') }),
      ]),
    );

    const playerRow = el('div', { className: 'rank-row me' }, [
      el('div', { className: 'rank-pos', text: `#${rank.toLocaleString('pt-BR')}` }),
      el('div', { className: 'rank-name', text: `${this.player.name} (você)` }),
      el('div', { className: 'rank-class', text: `${this.player.classDef.name} Nv.${this.player.level}` }),
      el('div', { className: 'rank-score', text: powerScore.toLocaleString('pt-BR') }),
    ]);

    const backBtn = el('div', {
      className: 'btn primary',
      text: '< Voltar à Aventura',
      onClick: () => this.game.goTo(new OverworldScreen(this.game, this.player)),
    });

    const screen = el('div', { className: 'ranking-screen screen' }, [
      el('div', { className: 'top-bar' }, [
        el('h1', { text: 'Ranking Global' }),
        el('div', {
          className: 'subtitle',
          text: `Você está no top ${percentile}% entre ${TOTAL_SIMULATED_PLAYERS.toLocaleString('pt-BR')} heróis simulados.`,
        }),
      ]),
      el('div', { className: 'ranking-panel panel' }, [
        playerRow,
        el('div', { className: 'rank-divider' }),
        ...rows,
      ]),
      el('div', { className: 'bottom-bar' }, [backBtn]),
    ]);
    this.game.uiRoot.append(screen);
  }
}
