import * as THREE from 'three';
import { TILE_SIZE } from '../config/gameConfig';
import type { TileType } from '../config/tiles';
import type { NpcDefinition } from '../data/npcs';
import { createItinerantMerchantNpc, getWorldEventById, type WorldEventDefinition } from '../data/worldEvents';
import { monsterFreeAreas, type ZoneDefinition } from '../data/zones';
import type { Game } from '../engine/Game';
import type { Player } from '../entities/Player';
import { animateCorruptedTree, buildCorruptedTreeMesh, disposeCorruptedTree, setTreePurified, type CorruptedTreeMesh } from '../render/corruptedTree';
import { buildWorldEventHud, drawEventMinimapMarker, pointArrowAt, type WorldEventHud } from '../render/worldEventHud';
import { tileCenterWorld } from '../render/worldBuilder';
import { eventChanceMultiplier } from '../systems/AdaptiveDifficulty';
import { audio } from '../systems/AudioSystem';
import { pickEncounterEnemyIds } from '../systems/EncounterSystem';
import {
  applyEventConsequence,
  completeActiveEvent,
  eventIntensity,
  formatEventTimeLeft,
  onZoneEnter,
  pickEventTile,
  tickEvents,
  type ActiveWorldEvent,
  type EventEndTransition,
  type EventTransition,
} from '../systems/EventSystem';
import { isNight } from '../systems/GameClock';
import type { OverworldCombat } from '../systems/OverworldCombat';
import { saveGame } from '../systems/SaveSystem';

export interface OverworldEventsHost {
  game: Game;
  player: Player;
  scene: THREE.Scene;
  camera: THREE.Camera;
  combat: OverworldCombat;
  zone: ZoneDefinition;
  tiles: TileType[][];
  cameraYaw: number;
  avatarPosition: () => THREE.Vector3;
  /** True for a tile covered by a building (tiles under one still read as plain path/grass). */
  isBlockedTile: (x: number, y: number) => boolean;
  /** Puts an NPC in this zone and returns a function that takes them out again. */
  addNpc: (def: NpcDefinition) => () => void;
}

export interface EventInteractable {
  keyPrompt: string;
  touchPrompt: string;
  activate: () => void;
}

const MIST_COLOR = new THREE.Color(0xb7bfc6);
const FOG_DENSE_NEAR = 3;
const FOG_DENSE_FAR = 17;

/**
 * Brings systems/EventSystem.ts's active event to life in the overworld: the
 * stage dressing per kind (a monster band, a merchant NPC, a corrupted tree,
 * denser fog), the HUD banner/toasts, the minimap/arrow pointers and the
 * reward/consequence hand-off. OverworldScreen only forwards its frame ticks,
 * the interact key and the minimap draw to this.
 */
export class OverworldEvents {
  private hud: WorldEventHud;
  private time = 0;
  private realized: ActiveWorldEvent | null = null;
  private bandGroupId: string | null = null;
  private bandTotal = 0;
  private removeMerchant: (() => void) | null = null;
  private tree: CorruptedTreeMesh | null = null;
  private treePurified = false;
  /** Purified trees stay behind for the rest of this visit as the player's mark on the zone. */
  private keptTrees: CorruptedTreeMesh[] = [];
  private readonly fog: THREE.Fog | null;
  private readonly baseFogNear: number;
  private readonly baseFogFar: number;
  private readonly baseFogColor = new THREE.Color();
  private readonly baseBackground = new THREE.Color();
  private fogLevel = 0;

  constructor(private host: OverworldEventsHost) {
    this.hud = buildWorldEventHud(host.game.uiRoot);
    this.fog = host.scene.fog instanceof THREE.Fog ? host.scene.fog : null;
    this.baseFogNear = this.fog?.near ?? 0;
    this.baseFogFar = this.fog?.far ?? 0;
    if (this.fog) this.baseFogColor.copy(this.fog.color);
    if (host.scene.background instanceof THREE.Color) this.baseBackground.copy(host.scene.background);
  }

  private get state() {
    return this.host.player.worldEvents;
  }

  private get isDungeon(): boolean {
    return !!this.host.zone.dungeonId;
  }

  /** Call once after the zone is built: settles an event left over from another zone and re-stages one that was running here when the game was saved. */
  mount(): void {
    if (this.isDungeon) return;
    for (const t of onZoneEnter(this.state, this.host.zone.id, true)) this.handleEnded(t);
    const active = this.state.active;
    if (active && active.zoneId === this.host.zone.id) this.realize(active);
  }

  /** Advances the scheduler — call only on frames the game clock also advances. Timers pause mid-fight so a band can't vanish around a live engagement. */
  tick(dt: number): void {
    const { player, zone, combat } = this.host;
    if (combat.isEngaged()) return;
    this.pollResolution();
    const ctx = {
      zoneId: zone.id,
      worldState: player.worldState,
      playerLevel: player.level,
      night: isNight(player.gameClock),
      canStart: !this.isDungeon,
      chanceMultiplier: eventChanceMultiplier(player.adaptive),
      pickTile: (def: WorldEventDefinition) => this.pickTile(def),
    };
    for (const t of tickEvents(this.state, dt, ctx)) {
      if (t.type === 'started') this.handleStarted(t);
      else this.handleEnded(t);
    }
  }

  /** Visual-only upkeep (toast, banner, fog, tree glow, arrow) — runs every frame, paused or not. */
  update(dt: number): void {
    this.time += dt;
    this.hud.tick(dt);
    const active = this.currentEvent();
    const def = active ? getWorldEventById(active.defId) : undefined;
    this.updateFog(dt, active, def);
    if (this.tree && !this.treePurified) animateCorruptedTree(this.tree, this.time);

    if (!active || !def) {
      this.hud.setBanner(null);
      this.hud.arrowEl.hidden = true;
      return;
    }
    this.hud.setBanner({ title: def.name, detail: `${this.detailText(def)} · ${formatEventTimeLeft(active.remaining)}`, kind: def.kind });
    const target = this.focusPoint();
    const avatar = this.host.avatarPosition();
    if (!target || Math.hypot(target.x - avatar.x, target.z - avatar.z) < 2) this.hud.arrowEl.hidden = true;
    else pointArrowAt(this.hud.arrowEl, target, avatar, this.host.camera, this.host.cameraYaw);
  }

  /** Draws the active event's marker; `toMinimap` is updateMinimap's own world→pixel helper. */
  drawMinimapMarker(ctx: CanvasRenderingContext2D, toMinimap: (x: number, z: number) => { x: number; y: number }): void {
    const active = this.currentEvent();
    const def = active ? getWorldEventById(active.defId) : undefined;
    const focus = def ? this.focusPoint() : null;
    if (!def || !focus) return;
    const m = toMinimap(focus.x, focus.z);
    drawEventMinimapMarker(ctx, m.x, m.y, def.kind, this.time);
  }

  /** The prompt + action for whatever event spot is within `range` of the avatar (today: the corrupted tree), or null. */
  interactableNear(avatar: THREE.Vector3, range: number): EventInteractable | null {
    if (!this.tree || this.treePurified || !this.realized) return null;
    if (this.tree.group.position.distanceTo(avatar) > range) return null;
    return {
      keyPrompt: '[E] Purificar a Árvore Corrompida',
      touchPrompt: 'Toque para purificar a Árvore Corrompida',
      activate: () => this.purifyTree(),
    };
  }

  dispose(): void {
    this.hud.dispose();
    for (const t of this.keptTrees) disposeCorruptedTree(t);
    if (this.tree) disposeCorruptedTree(this.tree);
  }

  // --- lifecycle -----------------------------------------------------------

  private currentEvent(): ActiveWorldEvent | null {
    const active = this.state.active;
    return active && active.zoneId === this.host.zone.id && active === this.realized ? active : null;
  }

  private handleStarted(t: Extract<EventTransition, { type: 'started' }>): void {
    this.realize(t.event);
    this.hud.showToast(t.def.startMessage, 6);
    if (t.def.kind === 'invasao') audio.encounterStart();
    else audio.secretFound();
    saveGame(this.host.player);
  }

  private handleEnded(t: EventEndTransition): void {
    this.unrealize();
    applyEventConsequence(this.host.player, t.def);
    this.hud.showToast(t.def.endMessage, 6);
    saveGame(this.host.player);
  }

  /** Resolution by action: a beaten invasion band completes its event. */
  private pollResolution(): void {
    const active = this.currentEvent();
    if (!active || !this.bandGroupId) return;
    if (this.host.combat.eventBandPositions(this.bandGroupId).length === 0) this.complete();
  }

  private purifyTree(): void {
    if (!this.tree || this.treePurified) return;
    this.treePurified = true;
    setTreePurified(this.tree, true);
    this.complete();
  }

  private complete(): void {
    const done = completeActiveEvent(this.state, this.host.player);
    this.unrealize();
    if (!done) return;
    const parts = [`+${done.xp} XP`];
    if (done.gold > 0) parts.push(`+${done.gold} ouro`);
    const levelUp = done.levelsGained > 0 ? ' Você subiu de nível!' : '';
    this.hud.showToast(`${done.def.successMessage ?? done.def.name}: ${parts.join(', ')}.${levelUp}`, 6);
    if (done.levelsGained > 0) audio.levelUp();
    else audio.questComplete();
    saveGame(this.host.player);
  }

  private realize(event: ActiveWorldEvent): void {
    const def = getWorldEventById(event.defId);
    if (!def) return;
    this.realized = event;
    const { zone, player, scene, combat } = this.host;
    if (def.kind === 'invasao' && event.tile) {
      const [min, max] = def.enemyCount ?? [3, 3];
      const count = min + Math.floor(Math.random() * (max - min + 1));
      const pickId = () => (zone.monsterIds ? zone.monsterIds[Math.floor(Math.random() * zone.monsterIds.length)] : pickEncounterEnemyIds(player.level)[0]);
      const lead = pickId();
      const ids = Array.from({ length: count }, (_, i) => (i === count - 1 && count > 2 ? pickId() : lead));
      this.bandGroupId = `evento:${def.id}`;
      this.bandTotal = count;
      combat.spawnEventBand(this.bandGroupId, ids, event.tile);
    } else if (def.kind === 'mercador' && event.tile) {
      this.removeMerchant = this.host.addNpc(createItinerantMerchantNpc(zone.id, event.tile));
    } else if (def.kind === 'arvore_corrompida' && event.tile) {
      const tree = buildCorruptedTreeMesh();
      tileCenterWorld(event.tile.x, event.tile.y, tree.group.position);
      scene.add(tree.group);
      this.tree = tree;
      this.treePurified = false;
    }
  }

  /** Takes the event's stage dressing down. A purified tree is kept (it is the reward); everything else goes. */
  private unrealize(): void {
    this.realized = null;
    if (this.bandGroupId) this.host.combat.despawnEventBand(this.bandGroupId);
    this.bandGroupId = null;
    this.removeMerchant?.();
    this.removeMerchant = null;
    if (this.tree) {
      if (this.treePurified) this.keptTrees.push(this.tree);
      else {
        this.host.scene.remove(this.tree.group);
        disposeCorruptedTree(this.tree);
      }
      this.tree = null;
    }
  }

  // --- placement & pointers -------------------------------------------------

  private pickTile(def: WorldEventDefinition) {
    const { tiles, avatarPosition, zone, isBlockedTile } = this.host;
    const avatar = avatarPosition();
    const [min, max] = def.placementRadius ?? [6, 12];
    const origin = { x: Math.floor(avatar.x / TILE_SIZE), y: Math.floor(avatar.z / TILE_SIZE) };
    return pickEventTile(tiles, origin, min, max, { avoid: monsterFreeAreas(zone.id), isBlocked: isBlockedTile });
  }

  /** World-space spot the HUD arrow and minimap marker point at — null for locationless events (weather) and for an invasion with nobody left standing. */
  private focusPoint(): { x: number; z: number } | null {
    const active = this.currentEvent();
    if (!active) return null;
    const def = getWorldEventById(active.defId);
    if (!def || def.placement === 'none') return null;
    if (this.bandGroupId) {
      const alive = this.host.combat.eventBandPositions(this.bandGroupId);
      if (alive.length === 0) return null;
      return { x: alive.reduce((s, p) => s + p.x, 0) / alive.length, z: alive.reduce((s, p) => s + p.z, 0) / alive.length };
    }
    if (!active.tile) return null;
    const p = tileCenterWorld(active.tile.x, active.tile.y);
    return { x: p.x, z: p.z };
  }

  private detailText(def: WorldEventDefinition): string {
    if (this.bandGroupId) {
      const alive = this.host.combat.eventBandPositions(this.bandGroupId).length;
      return `${def.objective} (${this.bandTotal - alive}/${this.bandTotal})`;
    }
    return def.objective;
  }

  // --- weather ---------------------------------------------------------------

  /** Eases the scene's fog toward (or back from) the dense mist the active 'nevoa' event asks for. */
  private updateFog(dt: number, active: ActiveWorldEvent | null, def: WorldEventDefinition | undefined): void {
    const target = active && def?.kind === 'nevoa' ? eventIntensity(def, active.remaining) : 0;
    if (!this.fog || (this.fogLevel === 0 && target === 0)) return;
    this.fogLevel += (target - this.fogLevel) * Math.min(1, dt * 2);
    if (this.fogLevel < 0.002 && target === 0) this.fogLevel = 0;
    const k = this.fogLevel;
    this.fog.near = THREE.MathUtils.lerp(this.baseFogNear, FOG_DENSE_NEAR, k);
    this.fog.far = THREE.MathUtils.lerp(this.baseFogFar, FOG_DENSE_FAR, k);
    this.fog.color.copy(this.baseFogColor).lerp(MIST_COLOR, k);
    if (this.host.scene.background instanceof THREE.Color) this.host.scene.background.copy(this.baseBackground).lerp(MIST_COLOR, k);
  }
}
