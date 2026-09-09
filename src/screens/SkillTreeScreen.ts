import * as THREE from 'three';
import type { SkillDefinition } from '../config/types';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import { buildPlayerCharacter } from '../render/characterModel';
import { Player } from '../entities/Player';
import { computeSkillLevelStats, ultimateLevelForCharacter, ULTIMATE_MAX_LEVEL } from '../systems/skillMath';
import { saveGame } from '../systems/SaveSystem';
import { el } from '../ui/dom';
import { OverworldScreen } from './OverworldScreen';

export class SkillTreeScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  private showcase!: THREE.Group;
  private time = 0;
  private listEl!: HTMLElement;
  private pointsEl!: HTMLElement;

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
    this.camera.position.set(0, 1.0, 3.8);
    this.camera.lookAt(0, 0.85, 0);

    this.showcase = buildPlayerCharacter(this.player);
    this.showcase.position.x = -0.6;
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
    this.pointsEl = el('div', { className: 'skill-points', text: '' });
    this.listEl = el('div', { className: 'skill-list' });

    const backBtn = el('div', {
      className: 'btn primary',
      text: '< Voltar à Aventura',
      onClick: () => {
        saveGame(this.player);
        this.game.goTo(new OverworldScreen(this.game, this.player));
      },
    });

    const screen = el('div', { className: 'skilltree-screen screen' }, [
      el('div', { className: 'top-bar' }, [
        el('h1', { text: `Árvore de Habilidades — ${this.player.classDef.name}` }),
        this.pointsEl,
      ]),
      el('div', { className: 'skilltree-panel panel' }, [this.listEl]),
      el('div', { className: 'bottom-bar' }, [backBtn]),
    ]);
    this.game.uiRoot.append(screen);
    this.renderList();
  }

  private renderList(): void {
    this.pointsEl.textContent = `Pontos de habilidade disponíveis: ${this.player.skillPoints}`;

    const rows = [
      this.renderBasicRow(),
      ...this.player.classDef.skills.map((skill) => (skill.isUltimate ? this.renderUltimateRow(skill) : this.renderSkillRow(skill))),
    ];
    this.listEl.replaceChildren(...rows);
  }

  private renderBasicRow(): HTMLElement {
    const skill = this.player.classDef.basicAttack;
    const stats = computeSkillLevelStats(skill, 1);
    return el('div', { className: 'skill-row' }, [
      el('div', { className: 'skill-row-header' }, [
        el('div', { className: 'skill-row-name', text: skill.name }),
        el('div', { className: 'skill-row-level', text: 'Sempre disponível' }),
      ]),
      el('div', { className: 'skill-row-desc', text: skill.description }),
      el('div', { className: 'skill-row-stats', text: `Poder x${stats.power}  •  Recarga ${stats.cooldown}s  •  Sem custo` }),
    ]);
  }

  private renderSkillRow(skill: SkillDefinition): HTMLElement {
    const level = this.player.skillLevel(skill.id);
    const unlocked = this.player.level >= skill.unlockLevel;
    const stats = computeSkillLevelStats(skill, Math.max(1, level));

    const canUpgrade = unlocked && this.player.skillPoints > 0 && level < skill.maxLevel;
    const upgradeBtn = el('div', {
      className: `btn small ${canUpgrade ? '' : 'disabled'}`,
      text: level >= skill.maxLevel ? 'Nível máximo' : `Evoluir (1 ponto)`,
      onClick: () => {
        if (!canUpgrade) return;
        this.player.upgradeSkill(skill.id);
        saveGame(this.player);
        this.renderList();
      },
    });

    return el('div', { className: `skill-row ${unlocked ? '' : 'locked'}` }, [
      el('div', { className: 'skill-row-header' }, [
        el('div', { className: 'skill-row-name', text: skill.name }),
        el('div', { className: 'skill-row-level', text: unlocked ? `Nível ${level}/${skill.maxLevel}` : `Desbloqueia no Nv.${skill.unlockLevel}` }),
      ]),
      el('div', { className: 'skill-row-desc', text: skill.description }),
      unlocked
        ? el('div', { className: 'skill-row-stats', text: `Poder x${stats.power}  •  Custo ${stats.cost} MP  •  Recarga ${stats.cooldown}s` })
        : el('div', { className: 'skill-row-stats' }),
      upgradeBtn,
    ]);
  }

  private renderUltimateRow(skill: SkillDefinition): HTMLElement {
    const unlocked = this.player.level >= skill.unlockLevel;
    const level = ultimateLevelForCharacter(this.player.level);
    const stats = computeSkillLevelStats(skill, Math.max(1, level));

    return el('div', { className: `skill-row ultimate ${unlocked ? '' : 'locked'}` }, [
      el('div', { className: 'skill-row-header' }, [
        el('div', { className: 'skill-row-name', text: `${skill.name} (Ultimate)` }),
        el('div', {
          className: 'skill-row-level',
          text: unlocked ? `Nível ${level}/${ULTIMATE_MAX_LEVEL} (automático)` : `Desbloqueia no Nv.${skill.unlockLevel}`,
        }),
      ]),
      el('div', { className: 'skill-row-desc', text: `${skill.description} Evolui automaticamente com o seu nível de personagem, até o nível ${ULTIMATE_MAX_LEVEL}.` }),
      unlocked
        ? el('div', { className: 'skill-row-stats', text: `Poder x${stats.power}  •  Custo ${stats.cost} MP  •  Recarga ${stats.cooldown}s` })
        : el('div', { className: 'skill-row-stats' }),
    ]);
  }
}
