/**
 * Golden path (g): dungeon flow.
 *
 * Two scenarios, matching the task's own must-have/nice-to-have split for
 * this golden path:
 *
 *  1. MUST-HAVE — walking up to Root Hollow's fixed portal in the main city
 *     and entering it: confirms the zone actually switches and the
 *     encounter-progress HUD appears.
 *  2. NICE-TO-HAVE — reaching the boss and clearing it: fighting through
 *     all 3 fixed encounter pods for real (6 monsters, several needing
 *     target-selection clicks — see combat.spec.ts) before even reaching
 *     the boss was, in practice while building this suite, too slow for a
 *     fast, reliable regression run (multiple real-time fights back to
 *     back). Instead this seeds the player directly in the boss arena —
 *     legitimate ground truth: nothing in `OverworldCombat`/`DungeonSystem`
 *     actually gates reaching the boss tile on having cleared the earlier
 *     pods first, a fast/reckless real player could rush straight past them
 *     the same way — at a boosted level so the fight itself resolves in a
 *     handful of hits, and confirms the boss banner, victory, the
 *     dungeon-complete overlay, and "return to town" all work.
 */
import { test, expect } from '@playwright/test';
import {
  buildSave,
  continueFromSlot,
  MAIN_CITY_ID,
  pauseSnapshot,
  ROOT_HOLLOW_LAYOUT,
  ROOT_HOLLOW_PORTAL_TILE,
  ROOT_HOLLOW_ZONE_ID,
  seedSave,
  tileCenter,
  waitForOverworld,
} from './helpers';

test('walking up to the Root Hollow portal and entering it switches zones and shows the encounter HUD', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const near = tileCenter(ROOT_HOLLOW_PORTAL_TILE.x - 2, ROOT_HOLLOW_PORTAL_TILE.y);
  await seedSave(page, 0, buildSave({ classId: 'warrior', level: 6, zoneId: MAIN_CITY_ID, mapX: near.x, mapY: near.y }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  // 'a' increases mapX at the fresh-mount facing (yaw 0) — see
  // movement.spec.ts — which is the direction from 2 tiles west of the
  // portal toward it.
  await page.keyboard.down('a');
  await page.waitForTimeout(900);
  await page.keyboard.up('a');

  await page.locator('.interact-prompt', { hasText: 'Toca das Raízes' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('e');

  await waitForOverworld(page);
  const afterEnter = await pauseSnapshot(page, 0);
  expect(afterEnter.zoneId).toBe(ROOT_HOLLOW_ZONE_ID);

  await expect(page.locator('.dungeon-progress')).toContainText('Emboscadas: 0/3');

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('reaching the boss shows the boss banner; defeating it completes the run and returns to town', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const start = tileCenter(ROOT_HOLLOW_LAYOUT.bossTile.x, ROOT_HOLLOW_LAYOUT.bossTile.y + 3);
  await seedSave(
    page,
    0,
    buildSave({
      classId: 'warrior',
      // Boosted well past the recommended level (6) purely so this specific
      // fight resolves in a handful of hits — see the file doc comment on
      // why this test skips straight to the boss arena instead of clearing
      // the 3 earlier pods for real.
      level: 20,
      zoneId: ROOT_HOLLOW_ZONE_ID,
      mapX: start.x,
      mapY: start.y,
      equipment: { arma: { uid: 'seed_weapon', templateId: 'espada_curta', rarity: 'verde', itemLevel: 1 } },
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  // 's' decreases mapY at the fresh-mount facing (yaw 0) — toward the boss.
  await page.keyboard.down('s');
  await page.waitForTimeout(2200);
  await page.keyboard.up('s');

  const bossBanner = page.locator('.boss-banner');
  await bossBanner.waitFor({ state: 'visible', timeout: 15_000 });
  await expect(bossBanner).toContainText('Matriarca-Geleia');

  const hotbar = page.locator('.hotbar');
  await hotbar.waitFor({ state: 'visible' });

  const completeOverlay = page.locator('.dungeon-complete-overlay');
  for (let i = 0; i < 20 && (await hotbar.isVisible()); i++) {
    await page.keyboard.press('1');
    await page.waitForTimeout(1300);
    if (await completeOverlay.isVisible()) break;
  }

  await expect(completeOverlay).toBeVisible({ timeout: 10_000 });
  await expect(completeOverlay).toContainText('Chefe derrotado!');

  await completeOverlay.getByText('Retornar a').click();
  await waitForOverworld(page);

  const afterReturn = await pauseSnapshot(page, 0);
  expect(afterReturn.zoneId).toBe(MAIN_CITY_ID);

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});
