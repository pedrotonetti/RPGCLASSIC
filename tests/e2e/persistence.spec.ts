/**
 * Golden path (h): save/reload persistence.
 *
 * Makes real progress (gains a level by defeating a dungeon monster, which
 * also changes gold), reloads the page from scratch, clicks "Continuar" on
 * the used slot, and confirms the same level/gold/position come back — the
 * same round trip a player closing and reopening the tab would go through.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, pauseSnapshot, ROOT_HOLLOW_LAYOUT, ROOT_HOLLOW_ZONE_ID, seedSave, slotCard, tileCenter, waitForOverworld } from './helpers';

test('progress survives a full page reload and "Continuar"', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // A near-dead slime (Root Hollow's first pod) so one basic attack ends
  // the fight and grants gold/XP — this test cares about the save round
  // trip, not re-proving combat math (see combat.spec.ts for that).
  const start = tileCenter(ROOT_HOLLOW_LAYOUT.encounterTiles[0].x, ROOT_HOLLOW_LAYOUT.encounterTiles[0].y + 2);
  await seedSave(
    page,
    0,
    buildSave({
      classId: 'warrior',
      level: 3,
      gold: 42,
      zoneId: ROOT_HOLLOW_ZONE_ID,
      mapX: start.x,
      mapY: start.y,
      equipment: { arma: { uid: 'seed_weapon', templateId: 'espada_curta', rarity: 'verde', itemLevel: 1 } },
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await page.keyboard.down('s');
  await page.waitForTimeout(2200);
  await page.keyboard.up('s');

  const hotbar = page.locator('.hotbar');
  await hotbar.waitFor({ state: 'visible', timeout: 15_000 });

  const battleMessage = page.locator('.battle-message-bar');
  let victorious = false;
  for (let i = 0; i < 20 && (await hotbar.isVisible()); i++) {
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    const prompt = await battleMessage.textContent().catch(() => null);
    if (prompt?.includes('Escolha o alvo')) {
      // `:visible` matters here: a defeated monster's label stays in the DOM
      // (just `hidden`) — see combat.spec.ts's identical note. `force: true`:
      // see combat.spec.ts's note on the `.ename` child intercepting the
      // computed click point.
      await page.locator('.enemy-label.world:visible').first().click({ force: true });
    }
    await page.waitForTimeout(1200);
    const msg = await battleMessage.textContent().catch(() => null);
    if (msg?.includes('Vitória!')) {
      victorious = true;
      break;
    }
  }
  expect(victorious, 'expected at least one monster defeated before checking persistence').toBe(true);

  const before = await pauseSnapshot(page, 0);
  expect(before.gold, 'gold should have increased from the kill').toBeGreaterThan(42);

  // Reload from scratch — a real player closing and reopening the tab — and
  // confirm the SAME slot's card reflects the progress before we even
  // click back in.
  await page.reload();
  await expect(page.locator('.title-logo')).toHaveText('SEDE');
  await expect(slotCard(page, 0)).toContainText(`Nv.${before.level}`);

  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  const after = await pauseSnapshot(page, 0);
  expect(after.level).toBe(before.level);
  expect(after.gold).toBe(before.gold);
  expect(after.xp).toBe(before.xp);
  expect(after.mapX).toBeCloseTo(before.mapX, 5);
  expect(after.mapY).toBeCloseTo(before.mapY, 5);
  expect(after.zoneId).toBe(before.zoneId);

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});
