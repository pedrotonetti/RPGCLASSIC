import * as THREE from 'three';
import { getDungeonModifier } from '../data/dungeonModifiers';
import { getRoomEvent, ROOM_KIND_LABEL, type RoomEventDefinition } from '../data/dungeonRooms';
import type { DungeonDefinition } from '../data/dungeons';
import type { Player } from '../entities/Player';
import { animateDungeonRoomMarker, buildDungeonRoomMarker, setDungeonRoomMarkerResolved, type DungeonRoomMarkerMesh } from '../render/dungeonRoomMarker';
import { tileCenterWorld } from '../render/worldBuilder';
import { formatRewardBonus } from '../systems/DungeonModifierSystem';
import { formatClearTime } from '../systems/DungeonRecordSystem';
import { applyRoomOutcome, rollRoomOutcome, type RoomOutcomeResult } from '../systems/DungeonRoomSystem';
import { runRewardBonus, type DungeonRunState } from '../systems/DungeonSystem';
import { findNearestWalkable, type WalkabilityGrid } from '../systems/Pathfinding';
import { el } from '../ui/dom';

/** Distância (unidades de mundo) em que uma armadilha dispara sozinha. */
const TRAP_TRIGGER_RANGE = 2.2;
const SHRINE_COLOR = 0x7fe3d0;
const TRAP_COLOR = 0xe0433d;

interface RoomSlot {
  index: number;
  event: RoomEventDefinition;
  mesh: DungeonRoomMarkerMesh;
  labelEl: HTMLElement;
  resolved: boolean;
}

export interface DungeonRunLayerOptions {
  scene: THREE.Scene;
  uiRoot: HTMLElement;
  dungeon: DungeonDefinition;
  player: Player;
  grid: WalkabilityGrid;
  /** The screen's live run state (it stays the owner — see OverworldScreen.dungeonRunState). */
  getState: () => DungeonRunState | null;
  /** Fired once per shrine/trap room after the player's choice was applied to `player`. */
  onRoomResolved: (index: number, result: RoomOutcomeResult) => void;
}

/**
 * Dungeons 2.0 — everything a run shows on top of the old corridor: the
 * shrine/trap room markers and their choice overlay, the Distorções + timer
 * HUD. Kept out of OverworldScreen (same idea as LoreFragmentLayer) so that
 * file only wires a handful of calls; all rules live in systems/Dungeon*.
 */
export class DungeonRunLayer {
  private slots: RoomSlot[] = [];
  private scratch = new THREE.Vector3();
  private hudEl: HTMLElement;
  private chipsEl: HTMLElement;
  private timerEl: HTMLElement;
  private overlayEl: HTMLElement | null = null;
  private elapsed = 0;
  private lastTimerText = '';

  constructor(private opts: DungeonRunLayerOptions) {
    const state = opts.getState();
    state?.rooms.forEach((room, index) => {
      if ((room.kind !== 'shrine' && room.kind !== 'trap') || !room.eventId) return;
      const event = getRoomEvent(room.eventId);
      const encounter = opts.dungeon.encounters[index];
      if (!event || !encounter) return;
      const snapped = findNearestWalkable(opts.grid, encounter.atTile) ?? encounter.atTile;
      const mesh = buildDungeonRoomMarker(room.kind === 'shrine' ? SHRINE_COLOR : TRAP_COLOR);
      mesh.group.position.copy(tileCenterWorld(snapped.x, snapped.y));
      opts.scene.add(mesh.group);
      const labelEl = el('div', { className: `dungeon-room-label ${room.kind}`, text: `${ROOM_KIND_LABEL[room.kind]}: ${event.name}` });
      labelEl.hidden = true;
      opts.uiRoot.append(labelEl);
      this.slots.push({ index, event, mesh, labelEl, resolved: false });
    });

    this.chipsEl = el('div', { className: 'dungeon-run-chips' });
    this.timerEl = el('div', { className: 'dungeon-run-timer', text: '0:00' });
    this.hudEl = el('div', { className: 'dungeon-run-hud' }, [this.timerEl, this.chipsEl]);
    opts.uiRoot.append(this.hudEl);
    this.refreshHud();
  }

  get isChoiceOpen(): boolean {
    return this.overlayEl !== null;
  }

  /** Game-time seconds since the run started, paused whenever the screen is (see OverworldScreen.update). */
  get elapsedSeconds(): number {
    return this.elapsed;
  }

  /** Advances the run timer — call only from the screen's un-paused branch, and only until the boss falls. */
  tick(dt: number): void {
    const state = this.opts.getState();
    if (!state || state.bossDefeated) return;
    this.elapsed += dt;
    const text = formatClearTime(this.elapsed);
    if (text !== this.lastTimerText) {
      this.lastTimerText = text;
      this.timerEl.textContent = text;
    }
  }

  /** Rebuilds the Distorções/blessings chips — call after anything changes the run state. */
  refreshHud(): void {
    const state = this.opts.getState();
    this.chipsEl.replaceChildren();
    if (!state) return;
    for (const id of state.modifierIds) {
      const def = getDungeonModifier(id);
      if (!def) continue;
      const featured = id === state.featuredModifierId;
      this.chipsEl.append(
        el('div', { className: `dungeon-mod-chip${featured ? ' featured' : ''}`, text: featured ? `${def.name} (do dia)` : def.name, attrs: { title: def.description } }),
      );
    }
    if (Object.keys(state.blessings).length > 0) {
      this.chipsEl.append(el('div', { className: 'dungeon-mod-chip blessing', text: 'Abençoado', attrs: { title: 'Bênção de santuário ativa até o fim da incursão.' } }));
    }
    if (state.modifierIds.length > 0 || state.elitesCleared > 0) {
      this.chipsEl.append(el('div', { className: 'dungeon-mod-chip reward', text: `Recompensa ${formatRewardBonus(runRewardBonus(state))}` }));
    }
  }

  update(time: number, avatarPos: THREE.Vector3, camera: THREE.Camera, labelRange: number): void {
    for (const s of this.slots) {
      if (!s.resolved) animateDungeonRoomMarker(s.mesh, time, s.index);

      this.scratch.copy(s.mesh.group.position);
      this.scratch.y += 1.5;
      const distance = this.scratch.distanceTo(avatarPos);
      const proj = this.scratch.project(camera);
      if (proj.z > 1 || distance > labelRange) {
        s.labelEl.hidden = true;
      } else {
        s.labelEl.hidden = false;
        s.labelEl.style.left = `${(proj.x * 0.5 + 0.5) * window.innerWidth}px`;
        s.labelEl.style.top = `${(-proj.y * 0.5 + 0.5) * window.innerHeight}px`;
      }

      if (!s.resolved && !this.overlayEl && s.event.kind === 'trap' && s.mesh.group.position.distanceTo(avatarPos) <= TRAP_TRIGGER_RANGE) {
        this.openRoom(s.index);
      }
    }
  }

  /** The closest unresolved shrine within `range` — shrines wait for [E]/tap, traps spring on their own. */
  nearestShrine(avatarPos: THREE.Vector3, range: number): { index: number; name: string } | null {
    let best: RoomSlot | null = null;
    let bestDist = range;
    for (const s of this.slots) {
      if (s.resolved || s.event.kind !== 'shrine') continue;
      const d = s.mesh.group.position.distanceTo(avatarPos);
      if (d <= bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best ? { index: best.index, name: best.event.name } : null;
  }

  openRoom(index: number): void {
    const slot = this.slots.find((s) => s.index === index);
    if (!slot || slot.resolved || this.overlayEl) return;
    const buttons = slot.event.choices.map((choice) =>
      el('div', { className: 'btn dungeon-room-choice', onClick: () => this.choose(slot, choice.id) }, [
        el('div', { className: 'choice-label', text: choice.label }),
        el('div', { className: 'choice-hint', text: choice.hint }),
      ]),
    );
    this.overlayEl = el('div', { className: `panel dungeon-room-overlay ${slot.event.kind}` }, [
      el('h2', { text: slot.event.name }),
      el('p', { text: slot.event.description }),
      el('div', { className: 'stack' }, buttons),
    ]);
    this.opts.uiRoot.append(this.overlayEl);
  }

  private choose(slot: RoomSlot, choiceId: string): void {
    if (slot.resolved) return;
    const state = this.opts.getState();
    const choice = slot.event.choices.find((c) => c.id === choiceId);
    if (!state || !choice) return;
    const outcome = rollRoomOutcome(slot.event, choiceId, Math.random);
    const result = applyRoomOutcome(this.opts.player, outcome, {
      recommendedLevel: this.opts.dungeon.recommendedLevel,
      tier: state.tier,
      fallbackHpLossPct: choice.fallbackHpLossPct,
    });
    slot.resolved = true;
    setDungeonRoomMarkerResolved(slot.mesh);
    this.closeOverlay();
    this.opts.onRoomResolved(slot.index, result);
    this.refreshHud();
  }

  private closeOverlay(): void {
    this.overlayEl?.remove();
    this.overlayEl = null;
  }

  dispose(): void {
    this.closeOverlay();
    for (const s of this.slots) {
      this.opts.scene.remove(s.mesh.group);
      s.mesh.group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.geometry.dispose();
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      });
      s.labelEl.remove();
    }
    this.slots = [];
    this.hudEl.remove();
  }
}
