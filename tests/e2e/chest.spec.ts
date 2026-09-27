/**
 * Golden path: hidden treasure chests (data/chests.ts).
 *
 * No spec covered chests at all before this — which is exactly how a real
 * bug (see below) went unnoticed: updateChests' label-visibility check
 * compared a world-space distance against a vector `.project()` had already
 * mutated into screen/NDC space, an always-false "close enough" comparison
 * for any chest not standing right at the world origin. In practice this
 * meant the chest label NEVER appeared during real play — confirmed by
 * seeding a save right on top of chest_verdegal_pond before the fix (label
 * stayed `hidden`) and after (label visible). This spec locks that in via
 * the actual player-facing behavior: label visibility, the [E] prompt,
 * gold/loot on open, and the opened state persisting through a reload.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, pauseSnapshot, seedSave, tileCenter, waitForOverworld } from './helpers';

// chest_verdegal_pond (data/chests.ts) — main_city, 45 gold, well clear of
// every plaza/gate so nothing else spawns close enough to confuse the label.
const CHEST_TILE = { x: 62, y: 27 };
const CHEST_NAME = 'Baú Esquecido do Verdegal';
const CHEST_GOLD = 45;

test('a chest label shows up nearby, opens for its gold+loot via [E], and stays opened after a reload', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const pos = tileCenter(CHEST_TILE.x, CHEST_TILE.y);
  const goldBefore = 10;
  await seedSave(page, 0, buildSave({ classId: 'warrior', level: 3, gold: goldBefore, zoneId: 'main_city', mapX: pos.x, mapY: pos.y }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  const label = page.locator('.chest-label', { hasText: CHEST_NAME });
  await expect(label).toBeVisible();

  await page.locator('.interact-prompt', { hasText: CHEST_NAME }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('e');

  await expect(page.locator('.battle-message-bar')).toContainText(CHEST_NAME);
  await expect(page.locator('.battle-message-bar')).toContainText(`+${CHEST_GOLD} ouro`);

  const afterOpen = await pauseSnapshot(page, 0);
  expect(afterOpen.gold).toBe(goldBefore + CHEST_GOLD);
  expect(afterOpen.openedChestIds).toContain('chest_verdegal_pond');
  // generateLoot always grants exactly one item (see openChest) — bag or
  // equipped, so this only checks gold/openedChestIds directly above; loot
  // placement itself is inventory.spec.ts's own concern, not this spec's.

  // The interact prompt for an already-opened chest never reappears — its
  // own detection excludes opened chests (see updateInteraction).
  await expect(page.locator('.interact-prompt', { hasText: CHEST_NAME })).toBeHidden();

  // Reload from scratch — a real player closing and reopening the tab — and
  // confirm the same slot is still marked opened, with no second gold grant.
  await page.reload();
  await expect(page.locator('.title-logo')).toHaveText('SEDE');
  await continueFromSlot(page, 0);
  await waitForOverworld(page);
  const afterReload = await pauseSnapshot(page, 0);
  expect(afterReload.gold).toBe(goldBefore + CHEST_GOLD);
  expect(afterReload.openedChestIds).toContain('chest_verdegal_pond');

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});
