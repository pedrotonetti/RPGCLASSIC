/**
 * Minimap orientation (OverworldScreen.updateMinimap/handleMinimapClick).
 *
 * This game's camera has a fixed yaw (CAMERA_YAW=0 — see
 * computeInputAxis's own doc comment): "forward" (W) increases world Z,
 * "right" (D) DECREASES world X. Drawing the minimap straight from world
 * coordinates (no rotation) put that backwards on screen — walking
 * forward moved the player's dot DOWN the minimap, walking right moved it
 * LEFT — technically consistent with raw world space, but inverted from
 * what the player sees happening in the 3D view right above it.
 *
 * This reads the minimap canvas's own pixel data to confirm the actual
 * rendered marker, not just the underlying world coordinates (already
 * covered by movement.spec.ts) — the whole bug was in the *rendering*,
 * so that's what needs to be checked directly.
 *
 * Start position: chest_verdegal_pond's tile (62, 27) — already a
 * confirmed-open, obstacle-clear spot in the main city's field (see
 * chest.spec.ts). Deliberately NOT (5, 5) (the spot movement.spec.ts
 * uses): that tile sits close enough to the world origin that, after the
 * fix's 180° rotation, its dot lands inside the minimap's own bottom
 * caption strip (a semi-transparent bar drawn over the dot itself),
 * which would make pixel-color detection unreliable for reasons that
 * have nothing to do with the bug this spec checks.
 */
import { test, expect, type Page } from '@playwright/test';
import { buildSave, continueFromSlot, seedSave, tileCenter, waitForOverworld } from './helpers';

const GOLD = { r: 242, g: 193, b: 78 };
const START = tileCenter(62, 27);

/** Average (x, y) of every minimap pixel close to the player-dot's own gold fill color. */
async function playerDotPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.locator('.minimap-canvas').evaluate((el, gold) => {
    const canvas = el as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    const tolerance = 20;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (Math.abs(data[i] - gold.r) < tolerance && Math.abs(data[i + 1] - gold.g) < tolerance && Math.abs(data[i + 2] - gold.b) < tolerance) {
          sumX += x;
          sumY += y;
          count++;
        }
      }
    }
    if (count === 0) throw new Error('player dot (gold fill) not found on the minimap canvas');
    return { x: sumX / count, y: sumY / count };
  }, GOLD);
}

test('walking forward moves the minimap dot up, not down', async ({ page }) => {
  await seedSave(page, 0, buildSave({ classId: 'warrior', mapX: START.x, mapY: START.y }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  const before = await playerDotPosition(page);
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  const after = await playerDotPosition(page);

  expect(after.y, 'forward should move the dot toward the TOP of the minimap (smaller y)').toBeLessThan(before.y);
});

test('strafing right moves the minimap dot right, not left', async ({ page }) => {
  await seedSave(page, 0, buildSave({ classId: 'warrior', mapX: START.x, mapY: START.y }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  const before = await playerDotPosition(page);
  await page.keyboard.down('d');
  await page.waitForTimeout(900);
  await page.keyboard.up('d');
  const after = await playerDotPosition(page);

  expect(after.x, 'strafing right should move the dot toward the RIGHT of the minimap (larger x)').toBeGreaterThan(before.x);
});

test('clicking the minimap walks toward the visually-clicked spot, not its mirror image', async ({ page }) => {
  await seedSave(page, 0, buildSave({ classId: 'warrior', mapX: START.x, mapY: START.y }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  const before = await playerDotPosition(page);

  const canvas = page.locator('.minimap-canvas');
  const box = (await canvas.boundingBox())!;
  // START's own dot sits at canvas fraction (~0.74, ~0.82) — see
  // playerDotPosition's math. (0.55, 0.65) is a modest, unambiguous step up
  // and to the left of that, without landing anywhere near the map's own
  // outer edge (an extreme corner click risks targeting an unreachable
  // tile outside the walkable field, which would fail to pathfind at all
  // for a reason that has nothing to do with this test).
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.65);
  await page.waitForTimeout(1500);

  const after = await playerDotPosition(page);
  // Before the fix, this same click (without also fixing handleMinimapClick's
  // own inverse mapping) would have pathfound toward the click's MIRROR
  // IMAGE instead — moving the dot the opposite way on at least one axis.
  expect(after.x, 'should have walked toward the clicked (left) side, not away from it').toBeLessThan(before.x);
  expect(after.y, 'should have walked toward the clicked (top) side, not away from it').toBeLessThan(before.y);
});
