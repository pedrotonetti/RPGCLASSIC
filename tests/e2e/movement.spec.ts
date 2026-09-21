/**
 * Golden path (b): free-roam movement.
 *
 * Confirms that holding WASD/arrow keys actually changes the player's saved
 * world position, and that opposite keys move it in opposite directions.
 *
 * HOW POSITION IS READ (no debug hook): opening the pause menu (Escape)
 * triggers a real save (`togglePause` -> `saveGame` in OverworldScreen.ts),
 * so this suite reads mapX/mapY back out of the same localStorage save slot
 * a real "Continuar" would load — see `pauseSnapshot` in helpers.ts.
 *
 * WHY EACH KEY GETS ITS OWN FRESH MOUNT: the avatar visually turns to face
 * whichever direction it just walked (see `computeInputAxis`'s doc comment
 * in OverworldScreen.ts), and each new key gesture snapshots that current
 * facing as its own movement reference frame. Forward/back (W then S in the
 * very same gesture pair) cancel cleanly regardless of facing, because
 * "backward" is always defined as the negation of the CURRENT facing.
 * Strafing (A/D) does not have that property once the avatar has already
 * turned once — so to get an unambiguous, implementation-detail-agnostic
 * signal for every key, each key here is tested from its own fresh mount
 * (facing angle 0, guaranteed at mount time since no rotation is stored in
 * the save), and compared only against that mount's own starting position.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, holdKey, pauseSnapshot, seedSave, tileCenter, waitForOverworld } from './helpers';

const HOLD_MS = 1200;

/** Fresh-mounts a level-1 warrior at a known, obstacle-clear spot in the main city's old-town plaza (see MapGenerator.generateOverworldMap's fixed plaza layout), holds one key, and returns the (dx, dy) world-space displacement from the pre-move position. */
async function measureKeyDisplacement(page: import('@playwright/test').Page, key: string): Promise<{ dx: number; dy: number }> {
  const start = tileCenter(5, 5);
  await seedSave(page, 0, buildSave({ classId: 'warrior', mapX: start.x, mapY: start.y }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  const before = await pauseSnapshot(page, 0);
  await holdKey(page, key, HOLD_MS);
  const after = await pauseSnapshot(page, 0);

  return { dx: after.mapX - before.mapX, dy: after.mapY - before.mapY };
}

test.describe('Movement', () => {
  test('W then S (forward/back) move the player and then reverse that movement', async ({ page }) => {
    const start = tileCenter(5, 5);
    await seedSave(page, 0, buildSave({ classId: 'warrior', mapX: start.x, mapY: start.y }));
    await continueFromSlot(page, 0);
    await waitForOverworld(page);

    const origin = await pauseSnapshot(page, 0);
    await holdKey(page, 'w', HOLD_MS);
    const afterW = await pauseSnapshot(page, 0);
    await holdKey(page, 's', HOLD_MS);
    const afterS = await pauseSnapshot(page, 0);

    const movedDuringW = Math.hypot(afterW.mapX - origin.mapX, afterW.mapY - origin.mapY);
    expect(movedDuringW, 'W should have moved the player').toBeGreaterThan(0.3);

    // S immediately reverses whatever W just did (see file doc comment) —
    // checked as a dot product so it holds regardless of which world axis W
    // happened to move along.
    const wVec = { x: afterW.mapX - origin.mapX, y: afterW.mapY - origin.mapY };
    const sVec = { x: afterS.mapX - afterW.mapX, y: afterS.mapY - afterW.mapY };
    const dot = wVec.x * sVec.x + wVec.y * sVec.y;
    expect(dot, 'S should move the player back the way W came').toBeLessThan(0);
  });

  test('A and D (strafe) move the player in opposite directions, each from a fresh mount', async ({ page }) => {
    // Two full fresh mounts of the main city (each independently slow — see
    // playwright.config.ts) happen sequentially here, well past the global
    // per-test timeout.
    test.setTimeout(240_000);
    const aVec = await measureKeyDisplacement(page, 'a');
    const dVec = await measureKeyDisplacement(page, 'd');

    const aMag = Math.hypot(aVec.dx, aVec.dy);
    const dMag = Math.hypot(dVec.dx, dVec.dy);
    expect(aMag, 'A should have moved the player').toBeGreaterThan(0.3);
    expect(dMag, 'D should have moved the player').toBeGreaterThan(0.3);

    const dot = aVec.dx * dVec.dx + aVec.dy * dVec.dy;
    expect(dot, 'A and D should move the player in opposite directions').toBeLessThan(0);
  });

  test('arrow keys move the player too (not just WASD)', async ({ page }) => {
    const start = tileCenter(5, 5);
    await seedSave(page, 0, buildSave({ classId: 'warrior', mapX: start.x, mapY: start.y }));
    await continueFromSlot(page, 0);
    await waitForOverworld(page);

    const origin = await pauseSnapshot(page, 0);
    await holdKey(page, 'ArrowUp', HOLD_MS);
    const after = await pauseSnapshot(page, 0);

    const moved = Math.hypot(after.mapX - origin.mapX, after.mapY - origin.mapY);
    expect(moved, 'ArrowUp should have moved the player').toBeGreaterThan(0.3);
  });
});
