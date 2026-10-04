import * as THREE from 'three';
import { defaultAppearance } from '../config/customization';
import { isLoreFragmentAvailable, loreFragmentsInZone, type LoreFragmentDefinition } from '../data/loreFragments';
import type { NpcDefinition } from '../data/npcs';
import {
  animateLoreFragment,
  buildLoreFragmentMesh,
  setLoreFragmentDiscovered,
  type LoreFragmentMesh,
} from '../render/loreFragment';
import { tileCenterWorld } from '../render/worldBuilder';
import { findNearestWalkable, type WalkabilityGrid } from '../systems/Pathfinding';
import { el } from '../ui/dom';

interface FragmentSlot {
  def: LoreFragmentDefinition;
  mesh: LoreFragmentMesh;
  labelEl: HTMLElement;
  discovered: boolean;
  phase: number;
}

/** Owns the zone's Fragmento de Memória markers (meshes, labels, proximity); a nightOnly one is hidden by day. */
export class LoreFragmentLayer {
  private slots: FragmentSlot[] = [];
  private scratch = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    uiRoot: HTMLElement,
    zoneId: string,
    grid: WalkabilityGrid,
    discoveredIds: readonly string[],
  ) {
    loreFragmentsInZone(zoneId).forEach((def, index) => {
      const snapped = findNearestWalkable(grid, def.atTile) ?? def.atTile;
      const mesh = buildLoreFragmentMesh();
      mesh.group.position.copy(tileCenterWorld(snapped.x, snapped.y));
      scene.add(mesh.group);

      const discovered = discoveredIds.includes(def.id);
      if (discovered) setLoreFragmentDiscovered(mesh, true);

      const labelEl = el('div', { className: 'lore-label', text: def.title });
      labelEl.hidden = true;
      uiRoot.append(labelEl);

      this.slots.push({ def, mesh, labelEl, discovered, phase: index * 1.7 });
    });
  }

  update(time: number, avatarPos: THREE.Vector3, camera: THREE.Camera, night: boolean, labelRange: number): void {
    for (const s of this.slots) {
      const visible = isLoreFragmentAvailable(s.def, night);
      s.mesh.group.visible = visible;
      if (!visible) {
        s.labelEl.hidden = true;
        continue;
      }
      animateLoreFragment(s.mesh, time, s.phase, s.discovered);

      this.scratch.copy(s.mesh.group.position);
      this.scratch.y += 1.3;
      const distance = this.scratch.distanceTo(avatarPos);
      const proj = this.scratch.project(camera);
      if (proj.z > 1 || distance > labelRange) {
        s.labelEl.hidden = true;
        continue;
      }
      s.labelEl.hidden = false;
      s.labelEl.style.left = `${(proj.x * 0.5 + 0.5) * window.innerWidth}px`;
      s.labelEl.style.top = `${(-proj.y * 0.5 + 0.5) * window.innerHeight}px`;
    }
  }

  nearest(avatarPos: THREE.Vector3, range: number, night: boolean): LoreFragmentDefinition | null {
    let best: FragmentSlot | null = null;
    let bestDist = range;
    for (const s of this.slots) {
      if (!isLoreFragmentAvailable(s.def, night)) continue;
      const d = s.mesh.group.position.distanceTo(avatarPos);
      if (d <= bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best?.def ?? null;
  }

  isDiscovered(id: string): boolean {
    return this.slots.find((s) => s.def.id === id)?.discovered ?? false;
  }

  markDiscovered(id: string): void {
    const slot = this.slots.find((s) => s.def.id === id);
    if (!slot || slot.discovered) return;
    slot.discovered = true;
    setLoreFragmentDiscovered(slot.mesh, true);
  }

  dispose(): void {
    for (const s of this.slots) {
      this.scene.remove(s.mesh.group);
      s.mesh.group.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        obj.geometry.dispose();
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
      });
      s.labelEl.remove();
    }
    this.slots = [];
  }
}

/** Stand-in speaker so a fragment reads through the NPC dialogue overlay; never added to NPC_DEFINITIONS. */
export function loreFragmentSpeaker(def: LoreFragmentDefinition): NpcDefinition {
  return {
    id: def.id,
    name: `Fragmento de Memória — ${def.title}`,
    role: 'Memória de uma Raiz',
    zoneId: def.zoneId,
    mapX: def.atTile.x,
    mapY: def.atTile.y,
    dialogue: def.lines,
    appearance: defaultAppearance(0x7fe3d0, 0xf2ede1),
    classAnalogId: 'cleric',
  };
}
