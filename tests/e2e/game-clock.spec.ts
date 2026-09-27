/**
 * The in-game clock (systems/GameClock.ts) — Fase 4's prerequisite for NPC
 * schedules and time-gated events. Confirms it's actually wired end to end:
 * the HUD reflects a seeded time of day (deterministic — no waiting on the
 * real 12-real-minute cycle), and it keeps advancing while the player is
 * actively playing.
 *
 * Assertions check the HOUR prefix ("13:", not "13:00") and use
 * greater-than-or-equal rather than exact equality throughout: the clock
 * never actually stops (real seconds keep elapsing during mount/navigation,
 * same as any other continuously-advancing real-time system in this game),
 * so pinning to one exact minute value would be inherently flaky, not a
 * true test of the underlying behavior.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, holdKey, pauseSnapshot, seedSave, tileCenter, waitForOverworld } from './helpers';

test('the HUD clock shows a seeded time of day, with the right sun/moon icon', async ({ page }) => {
  const pos = tileCenter(5, 5);
  await seedSave(page, 0, buildSave({ classId: 'warrior', zoneId: 'main_city', mapX: pos.x, mapY: pos.y, gameClock: { dayProgress: 13 / 24 } }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await expect(page.locator('.hud-clock')).toContainText('13:');
  await expect(page.locator('.hud-clock')).toContainText('☀️');
});

test('the HUD clock shows the moon at night', async ({ page }) => {
  const pos = tileCenter(5, 5);
  await seedSave(page, 0, buildSave({ classId: 'warrior', zoneId: 'main_city', mapX: pos.x, mapY: pos.y, gameClock: { dayProgress: 2 / 24 } }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await expect(page.locator('.hud-clock')).toContainText('02:');
  await expect(page.locator('.hud-clock')).toContainText('🌙');
});

test('the clock keeps advancing during active play, and survives a reload', async ({ page }) => {
  const pos = tileCenter(5, 5);
  await seedSave(page, 0, buildSave({ classId: 'warrior', zoneId: 'main_city', mapX: pos.x, mapY: pos.y, gameClock: { dayProgress: 13 / 24 } }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  const before = await pauseSnapshot(page, 0);
  // Walking (rather than an idle wait) keeps this consistent with every
  // other timed golden path in this suite, which all drive real input
  // instead of a bare waitForTimeout.
  await holdKey(page, 'w', 3000);
  const after = await pauseSnapshot(page, 0);

  expect(after.gameClock.dayProgress, 'the clock should have moved forward from active play').toBeGreaterThan(before.gameClock.dayProgress);

  // Reload from scratch: the advanced time survives — it doesn't reset to
  // the seeded 13:00, and it doesn't reset to the class default of 07:00.
  // It's expected to have moved forward a little more too (mounting after
  // the reload is itself real elapsed time the clock keeps ticking through),
  // so this checks "at least as far forward, and not wildly further" rather
  // than exact equality.
  await page.reload();
  await expect(page.locator('.title-logo')).toHaveText('SEDE');
  await continueFromSlot(page, 0);
  await waitForOverworld(page);
  const afterReload = await pauseSnapshot(page, 0);
  expect(afterReload.gameClock.dayProgress).toBeGreaterThanOrEqual(after.gameClock.dayProgress);
  expect(afterReload.gameClock.dayProgress - after.gameClock.dayProgress).toBeLessThan(0.02);
});
