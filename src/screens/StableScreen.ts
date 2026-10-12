import * as THREE from 'three';
import { getMountById, MOUNT_DEFINITIONS, mountAtStage, type MountKind } from '../data/mounts';
import type { Game } from '../engine/Game';
import type { Screen } from '../engine/Screen';
import type { Player } from '../entities/Player';
import { loadMountVisual, MountAnimator } from '../render/mountModel';
import {
  equipMount,
  FEED_XP,
  feedCost,
  feedMount,
  mountDisplayName,
  mountProfile,
  mountStage,
  nextEvolution,
  setMountNickname,
  syncMountUnlocks,
} from '../systems/MountSystem';
import { keyFor, keyLabelFor } from '../systems/Keybindings';
import { saveGame } from '../systems/SaveSystem';
import { el, goToLazy } from '../ui/dom';
import { addHotkeyHint, bindBackKey } from '../ui/menuKeys';

/**
 * Estábulo — the mount window. Classic RPG mount journal: a live 3D preview
 * of the selected mount slowly turning on a pedestal (drag to spin it),
 * every mount listed by kind with lock hints, evolution forms you can
 * preview, and the usual stable actions — equip, ride now, nickname, feed.
 *
 * Mount logic lives in systems/MountSystem.ts; this screen only reads it and
 * calls its actions, then re-renders.
 */
export class StableScreen implements Screen {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;

  private pedestal = new THREE.Group();
  /** Turntable: the preview creature sits inside it so auto-spin and drag never fight the model's own transform. */
  private turntable = new THREE.Group();
  private preview: THREE.Group | null = null;
  private animator: MountAnimator | null = null;
  private loadToken = 0;
  private spin = 0;
  private spinVelocity = 0.45;
  private dragging = false;
  private lastPointerX = 0;
  private cameraTarget = new THREE.Vector3(0, 1, 0);
  private cameraDistance = 6;

  private tab: MountKind = 'terrestre';
  private selectedId: string;
  /** Which evolution form is being previewed (defaults to the mount's current stage). */
  private previewStage = 0;
  private notice = '';

  private listEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private tabsEl!: HTMLElement;
  private goldEl!: HTMLElement;
  private canvasHit!: HTMLElement;
  private unbindBackKey: (() => void) | null = null;
  private removePointer: (() => void) | null = null;

  constructor(
    private game: Game,
    private player: Player,
  ) {
    this.camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 80);
    syncMountUnlocks(player);
    this.selectedId = player.activeMountId ?? player.equippedMounts.terrestre ?? MOUNT_DEFINITIONS[0].id;
    this.tab = getMountById(this.selectedId).kind;
    this.previewStage = mountStage(player, this.selectedId);
  }

  mount(): void {
    this.scene.background = new THREE.Color(0x15111c);
    this.scene.fog = new THREE.Fog(0x15111c, 9, 26);
    const hemi = new THREE.HemisphereLight(0xfff4e0, 0x2a2034, 1.1);
    const key = new THREE.DirectionalLight(0xffe8c8, 1.8);
    key.position.set(3, 6, 4);
    const rim = new THREE.DirectionalLight(0x8fb8ff, 0.9);
    rim.position.set(-4, 3, -5);
    this.scene.add(hemi, key, rim);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 2.9, 0.3, 48),
      new THREE.MeshStandardMaterial({ color: 0x3a2e24, roughness: 0.85 }),
    );
    base.position.y = -0.15;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.62, 0.05, 8, 64),
      new THREE.MeshStandardMaterial({ color: 0xe3b341, emissive: 0x5a3c08, roughness: 0.4 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.01;
    this.pedestal.add(base, ring, this.turntable);
    this.scene.add(this.pedestal);

    this.buildUi();
    this.loadPreview();
  }

  unmount(): void {
    this.unbindBackKey?.();
    this.removePointer?.();
    this.loadToken++;
    this.clearPreview();
  }

  onResize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.placeCamera();
  }

  update(dt: number): void {
    if (!this.dragging) {
      // Ease back to the slow showroom spin after a fling.
      this.spinVelocity += (0.45 - this.spinVelocity) * Math.min(1, dt * 1.5);
      this.spin += this.spinVelocity * dt;
    }
    this.turntable.rotation.y = this.spin;
    this.animator?.update(dt, false);
  }

  // --- 3D preview --------------------------------------------------------

  /** Camera on the left half of the screen on wide layouts, centred above the panel on narrow ones. */
  private placeCamera(): void {
    const wide = window.innerWidth >= 820;
    // Shift the view right so the creature sits in the middle of the free (left) area.
    const offsetX = wide ? this.cameraDistance * 0.24 : 0;
    const t = this.cameraTarget;
    this.camera.position.set(t.x + offsetX, t.y + this.cameraDistance * 0.32, t.z + this.cameraDistance);
    this.camera.lookAt(t.x + offsetX, wide ? t.y : t.y - this.cameraDistance * 0.18, t.z);
  }

  private clearPreview(): void {
    if (!this.preview) return;
    this.turntable.remove(this.preview);
    this.preview.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        // Skinned bodies share geometry with the glTF cache; only the
        // procedural extras (wings, horns) own theirs.
        if (!(obj instanceof THREE.SkinnedMesh)) obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose();
      }
    });
    this.preview = null;
    this.animator = null;
  }

  private async loadPreview(): Promise<void> {
    const token = ++this.loadToken;
    const id = this.selectedId;
    const unlocked = this.player.unlockedMounts.includes(id);
    const reached = mountStage(this.player, id);
    const stage = this.previewStage;
    let visual;
    try {
      visual = await loadMountVisual(id, stage);
    } catch (err) {
      console.error(`Estábulo: falha ao carregar "${id}"`, err);
      return;
    }
    if (token !== this.loadToken) return;
    this.clearPreview();

    // A locked mount, or an evolution not reached yet, shows as a silhouette.
    if (!unlocked || stage > reached) {
      const shadow = new THREE.MeshBasicMaterial({ color: 0x07060a });
      visual.scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (const m of mats) m.dispose();
          obj.material = shadow;
        }
      });
    }

    const holder = new THREE.Group();
    holder.add(visual.scene);
    this.turntable.add(holder);
    this.preview = holder;
    this.animator = new MountAnimator(visual.actor, visual.config.clips, visual.wings);
    this.animator.update(0.01, false);

    // Frame whatever size this creature (and its wings) turned out to be.
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 1.2);
    this.cameraTarget.set(0, Math.max(0.6, size.y * 0.5), 0);
    this.cameraDistance = radius * 2.7 + 2.5;
    this.placeCamera();
  }

  // --- UI ----------------------------------------------------------------

  private buildUi(): void {
    const backBtn = el('div', {
      className: 'btn primary',
      text: '< Voltar à Aventura',
      onClick: () => this.leave(),
    });
    addHotkeyHint(backBtn, `Esc / ${keyLabelFor('stable')}`);
    this.unbindBackKey = bindBackKey(backBtn, [keyFor('stable')]);

    this.goldEl = el('div', { className: 'subtitle' });
    this.tabsEl = el('div', { className: 'stable-tabs' });
    this.listEl = el('div', { className: 'stable-list' });
    this.detailEl = el('div', { className: 'stable-detail' });
    // Transparent layer over the 3D side that turns drags into spin.
    this.canvasHit = el('div', { className: 'stable-drag' });
    this.bindDrag();

    const screen = el('div', { className: 'stable-screen screen' }, [
      el('div', { className: 'top-bar' }, [el('h1', { text: 'Estábulo' }), this.goldEl]),
      this.canvasHit,
      el('div', { className: 'stable-panel panel' }, [this.tabsEl, this.listEl, this.detailEl]),
      el('div', { className: 'bottom-bar' }, [backBtn]),
    ]);
    this.game.uiRoot.append(screen);
    this.render();
  }

  private bindDrag(): void {
    const onDown = (e: PointerEvent) => {
      this.dragging = true;
      this.lastPointerX = e.clientX;
      this.canvasHit.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointerX;
      this.lastPointerX = e.clientX;
      this.spin += dx * 0.012;
      this.spinVelocity = dx * 0.6;
    };
    const onUp = () => {
      this.dragging = false;
    };
    this.canvasHit.addEventListener('pointerdown', onDown);
    this.canvasHit.addEventListener('pointermove', onMove);
    this.canvasHit.addEventListener('pointerup', onUp);
    this.canvasHit.addEventListener('pointercancel', onUp);
    this.removePointer = () => {
      this.canvasHit.removeEventListener('pointerdown', onDown);
      this.canvasHit.removeEventListener('pointermove', onMove);
      this.canvasHit.removeEventListener('pointerup', onUp);
      this.canvasHit.removeEventListener('pointercancel', onUp);
    };
  }

  private leave(): void {
    saveGame(this.player);
    goToLazy(this.game, async () => {
      const [{ OverworldScreen }, { loadPlayerAvatar }] = await Promise.all([import('./OverworldScreen'), import('../render/playerAvatar')]);
      const avatar = await loadPlayerAvatar(this.player);
      return new OverworldScreen(this.game, this.player, avatar);
    });
  }

  private select(id: string): void {
    this.selectedId = id;
    this.previewStage = mountStage(this.player, id);
    this.notice = '';
    this.render();
    void this.loadPreview();
  }

  private render(): void {
    this.goldEl.textContent = `Ouro: ${this.player.gold.toLocaleString('pt-BR')}`;
    const count = (kind: MountKind) => {
      const defs = MOUNT_DEFINITIONS.filter((d) => d.kind === kind);
      return `${defs.filter((d) => this.player.unlockedMounts.includes(d.id)).length}/${defs.length}`;
    };
    this.tabsEl.replaceChildren(
      ...(['terrestre', 'voadora'] as MountKind[]).map((kind) =>
        el('div', {
          className: `stable-tab${this.tab === kind ? ' active' : ''}`,
          text: `${kind === 'terrestre' ? 'Terrestres' : 'Voadoras'} (${count(kind)})`,
          onClick: () => {
            this.tab = kind;
            const first = this.player.equippedMounts[kind] ?? MOUNT_DEFINITIONS.find((d) => d.kind === kind)!.id;
            this.select(first);
          },
        }),
      ),
    );

    this.listEl.replaceChildren(
      ...MOUNT_DEFINITIONS.filter((d) => d.kind === this.tab).map((def) => {
        const unlocked = this.player.unlockedMounts.includes(def.id);
        const equipped = this.player.equippedMounts[def.kind] === def.id;
        const riding = this.player.activeMountId === def.id;
        const classes = ['stable-item', this.selectedId === def.id ? 'selected' : '', unlocked ? '' : 'locked', equipped ? 'equipped' : ''].filter(Boolean);
        return el('div', { className: classes.join(' '), onClick: () => this.select(def.id) }, [
          el('span', { className: 'mount-swatch', style: { background: unlocked ? `#${def.color.toString(16).padStart(6, '0')}` : '#222' } }),
          el('span', { className: 'stable-item-name', text: unlocked ? mountDisplayName(this.player, def.id) : `🔒 ${def.name}` }),
          el('span', { className: 'stable-item-tag', text: riding ? 'montado' : equipped ? 'equipada' : def.stages && unlocked ? `E${mountStage(this.player, def.id) + 1}` : '' }),
        ]);
      }),
    );

    this.renderDetail();
  }

  private renderDetail(): void {
    const id = this.selectedId;
    const def = getMountById(id);
    const unlocked = this.player.unlockedMounts.includes(id);
    const profile = mountProfile(this.player, id);
    const shown = mountAtStage(def, this.previewStage);
    const rows: HTMLElement[] = [];

    rows.push(el('h2', { className: 'stable-name', text: unlocked ? mountDisplayName(this.player, id) : def.name }));
    if (unlocked && this.player.mountNicknames[id]) rows.push(el('div', { className: 'stable-sub', text: profile.name }));
    rows.push(el('div', { className: 'stable-sub', text: `${def.kind === 'voadora' ? 'Voadora' : 'Terrestre'} · ${def.description}` }));

    if (!unlocked) {
      rows.push(el('div', { className: 'stable-lock', text: `🔒 Como liberar: ${def.unlockText}` }));
    }

    // Evolution forms — preview any of them (unreached ones as a silhouette).
    if (def.stages) {
      rows.push(
        el(
          'div',
          { className: 'stable-stages' },
          def.stages.map((stage, i) =>
            el('div', {
              className: `stable-stage${this.previewStage === i ? ' active' : ''}${unlocked && i <= profile.stage ? ' reached' : ''}`,
              text: unlocked && i <= profile.stage ? stage.name : `${i + 1}. ???`,
              onClick: () => {
                this.previewStage = i;
                this.renderDetail();
                void this.loadPreview();
              },
            }),
          ),
        ),
      );
    }

    // Stats of the previewed form.
    const stat = (label: string, value: string, pct: number) =>
      el('div', { className: 'stable-stat' }, [
        el('span', { className: 'stable-stat-label', text: label }),
        el('div', { className: 'stable-bar' }, [el('div', { className: 'stable-bar-fill', style: { width: `${Math.round(Math.min(1, pct) * 100)}%` } })]),
        el('span', { className: 'stable-stat-value', text: value }),
      ]);
    rows.push(stat('Velocidade', `×${shown.speedMultiplier.toFixed(2)}`, (shown.speedMultiplier - 1) / 1.8));
    if (shown.combat) {
      rows.push(stat('Investida', `+${Math.round(shown.combat.chargeBonus * 100)}%`, shown.combat.chargeBonus / 0.9));
      rows.push(
        el('div', { className: 'stable-perk' }, [
          el('b', { text: shown.combat.perkName }),
          el('span', { text: ` — ${describeMods(shown.combat.mods)}` }),
        ]),
      );
    } else {
      rows.push(el('div', { className: 'stable-perk', text: 'Sem bônus de combate — feita para atravessar rios e desfiladeiros.' }));
    }

    if (unlocked && def.stages) {
      const next = nextEvolution(this.player, id);
      if (next) {
        const pct = next.xp / next.needed;
        rows.push(
          el('div', { className: 'stable-sub', text: `Evolução: ${next.xp}/${next.needed} XP → ${next.name}` }),
          el('div', { className: 'mount-xp' }, [el('div', { className: 'mount-xp-fill', style: { width: `${Math.round(pct * 100)}%` } })]),
          el('div', { className: 'stable-hint', text: 'Ganha XP voando e vencendo lutas montada.' }),
        );
      } else {
        rows.push(el('div', { className: 'stable-sub', text: '★ Forma final alcançada' }));
      }
    }

    if (unlocked) {
      const actions: HTMLElement[] = [];
      const equipped = this.player.equippedMounts[def.kind] === id;
      actions.push(
        equipped
          ? el('div', { className: 'btn small disabled', text: '✓ Equipada' })
          : el('div', {
              className: 'btn small primary',
              text: 'Equipar',
              onClick: () => {
                equipMount(this.player, id);
                this.notice = `${mountDisplayName(this.player, id)} equipada.`;
                saveGame(this.player);
                this.render();
              },
            }),
      );
      actions.push(
        el('div', {
          className: 'btn small',
          text: this.player.activeMountId === id ? 'Desmontar' : def.kind === 'voadora' ? 'Voar agora' : 'Montar agora',
          onClick: () => {
            if (this.player.activeMountId === id) {
              this.player.setMount(null);
              this.notice = 'Você desmontou.';
            } else {
              equipMount(this.player, id);
              this.player.setMount(id);
              this.notice = `Montado em ${mountDisplayName(this.player, id)} — volte à aventura!`;
            }
            saveGame(this.player);
            this.render();
          },
        }),
      );
      if (def.stages && nextEvolution(this.player, id)) {
        const cost = feedCost(this.player, id);
        actions.push(
          el('div', {
            className: `btn small${this.player.gold < cost ? ' disabled' : ''}`,
            text: `Alimentar (+${FEED_XP} XP · ${cost} ouro)`,
            onClick: () => {
              const before = mountStage(this.player, id);
              const result = feedMount(this.player, id);
              this.notice = result.message;
              if (result.ok) saveGame(this.player);
              const after = mountStage(this.player, id);
              if (after !== before) {
                this.previewStage = after;
                void this.loadPreview();
              }
              this.render();
            },
          }),
        );
      }
      rows.push(el('div', { className: 'stable-actions' }, actions));

      // Apelido.
      const input = el('input', {
        className: 'dev-input stable-nick',
        attrs: { type: 'text', maxlength: '18', placeholder: 'Apelido', value: this.player.mountNicknames[id] ?? '' },
      }) as HTMLInputElement;
      rows.push(
        el('div', { className: 'stable-actions' }, [
          input,
          el('div', {
            className: 'btn small',
            text: 'Renomear',
            onClick: () => {
              setMountNickname(this.player, id, input.value);
              this.notice = this.player.mountNicknames[id] ? `Agora se chama ${this.player.mountNicknames[id]}.` : 'Apelido removido.';
              saveGame(this.player);
              this.render();
            },
          }),
        ]),
      );
    }

    if (this.notice) rows.push(el('div', { className: 'workshop-notice', text: this.notice }));
    this.detailEl.replaceChildren(...rows);
  }
}

const MOD_LABELS: Record<string, (v: number) => string> = {
  damageDealt: (v) => `+${pct(v)} de dano`,
  damageReduction: (v) => `−${pct(v)} de dano recebido`,
  critChance: (v) => `+${pct(v)} de chance de crítico`,
  critDamage: (v) => `+${pct(v)} de dano crítico`,
  lifeSteal: (v) => `${pct(v)} de roubo de vida`,
  thorns: (v) => `${pct(v)} do dano refletido`,
  mpRegenPct: (v) => `+${pct(v)} de mana/s`,
  mpCost: (v) => `−${pct(v)} de custo de mana`,
  bleedChance: (v) => `${pct(v)} de chance de sangramento`,
  burnChance: (v) => `${pct(v)} de chance de queimar`,
  poisonChance: (v) => `${pct(v)} de chance de envenenar`,
  slowChance: (v) => `${pct(v)} de chance de lentidão`,
};

function pct(v: number): string {
  const n = Math.round(v * 1000) / 10;
  return `${String(n).replace('.', ',')}%`;
}

/** The perk's actual numbers at the previewed stage, in pt-BR. */
function describeMods(mods: Record<string, number | undefined>): string {
  const parts = Object.entries(mods)
    .filter(([, v]) => v)
    .map(([k, v]) => MOD_LABELS[k]?.(v as number) ?? `${k} ${v}`);
  return parts.length > 0 ? parts.join(', ') : 'apenas a Investida';
}
