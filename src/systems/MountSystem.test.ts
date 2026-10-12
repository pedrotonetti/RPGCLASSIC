import { describe, expect, it } from 'vitest';
import { Player } from '../entities/Player';
import { addMountXp, equipMount, mountProfile, nextMountInCycle, sideQuestsCompleted, syncMountUnlocks } from './MountSystem';

describe('MountSystem', () => {
  it('starts every new character with only the brown horse, equipped', () => {
    const p = Player.createNew('T', 'warrior');
    expect(p.unlockedMounts).toEqual(['cavalo_marrom']);
    expect(p.equippedMounts).toEqual({ terrestre: 'cavalo_marrom' });
  });

  it('unlocks ground mounts by completed side quests', () => {
    const p = Player.createNew('T', 'warrior');
    p.completedQuestIds.push('vau_r1_teias');
    expect(sideQuestsCompleted(p)).toBe(1);
    const msgs = syncMountUnlocks(p);
    expect(p.unlockedMounts).toContain('lobo');
    expect(p.unlockedMounts).not.toContain('cervo');
    expect(msgs.join(' ')).toContain('Lobo Cinzento');
  });

  it('unlocks flying mounts by milestones and auto-equips the first one', () => {
    const p = Player.createNew('T', 'warrior');
    p.level = 12;
    syncMountUnlocks(p);
    expect(p.unlockedMounts).toEqual(expect.arrayContaining(['condor', 'pegaso']));
    expect(p.equippedMounts.voadora).toBe('condor');
  });

  it('evolves a flying mount with XP and scales its perk', () => {
    const p = Player.createNew('T', 'warrior');
    p.unlockedMounts.push('dragao');
    const base = mountProfile(p, 'dragao');
    expect(addMountXp(p, 'dragao', 299)).toBeNull();
    expect(addMountXp(p, 'dragao', 1)).toContain('Dragão Jovem');
    const evolved = mountProfile(p, 'dragao');
    expect(evolved.stage).toBe(1);
    expect(evolved.speedMultiplier).toBeGreaterThan(base.speedMultiplier);
    expect(evolved.combat!.mods.burnChance!).toBeCloseTo(base.combat!.mods.burnChance! * 1.5);
  });

  it('M cycles foot → ground → flying → foot', () => {
    const p = Player.createNew('T', 'warrior');
    p.unlockedMounts.push('pegaso');
    equipMount(p, 'pegaso');
    expect(nextMountInCycle(p)).toBe('cavalo_marrom');
    p.activeMountId = 'cavalo_marrom';
    expect(nextMountInCycle(p)).toBe('pegaso');
    p.activeMountId = 'pegaso';
    expect(nextMountInCycle(p)).toBeNull();
  });

  it('old saves (no equippedMounts) lose the free unlocks and keep only what progress earns', () => {
    const old = Player.createNew('T', 'warrior').toSaveData();
    const legacy = { ...old, unlockedMounts: ['llama', 'condor'], activeMountId: 'condor' } as typeof old;
    delete (legacy as Partial<typeof old>).equippedMounts;
    const p = Player.fromSaveData(legacy);
    expect(p.unlockedMounts).toEqual(['cavalo_marrom']);
    expect(p.activeMountId).toBeNull();
  });

  it('round-trips equipped mounts and mount XP through the save', () => {
    const p = Player.createNew('T', 'warrior');
    p.unlockedMounts.push('grifo');
    equipMount(p, 'grifo');
    addMountXp(p, 'grifo', 120);
    const back = Player.fromSaveData(p.toSaveData());
    expect(back.equippedMounts.voadora).toBe('grifo');
    expect(back.mountXp.grifo).toBe(120);
  });
});
