/**
 * Golden path (e): shops.
 *
 * Walks up to the blacksmith Elira in Pedravale (the main city), opens her
 * shop, buys one item, and confirms gold decreases and the item shows up —
 * Elira only sells equipment (see data/npcs.ts's `vendor.equipmentTemplateIds`),
 * so "appears in inventory" here means the shop's own "Vender" section
 * (which only lists items in `player.bag`) starts listing it — the same
 * signal a real player would see confirming the purchase actually landed.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, seedSave, tileCenter, waitForOverworld } from './helpers';

// Elira's fixed position in the main city's old-town plaza — data/npcs.ts.
const ELIRA_TILE = { x: 3, y: 6 };

test('buying an item from a shop deducts gold and adds the item', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // Seeded right next to Elira (within interact range) so the "walk up"
  // itself is a short, deterministic hop rather than a full city crossing —
  // the plaza's fixed layout (MapGenerator.generateOverworldMap) guarantees
  // no buildings/obstacles between adjacent old-town tiles.
  const near = tileCenter(ELIRA_TILE.x + 1, ELIRA_TILE.y);
  await seedSave(page, 0, buildSave({ classId: 'warrior', level: 4, gold: 200, mapX: near.x, mapY: near.y }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  // 'd' decreases mapX at the fresh-mount facing (yaw 0) — see
  // movement.spec.ts — which is the direction from our seeded spot (one
  // tile east of Elira) toward her.
  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');

  await page.locator('.interact-prompt', { hasText: 'Elira' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('e');

  // Talking to a vendor opens her dialogue first; the shop only opens once
  // that dialogue closes (see OverworldScreen.closeDialogue -> openShop).
  await expect(page.locator('.dialogue-box')).toBeVisible();
  await page.keyboard.press('Escape');

  const shop = page.locator('.shop-overlay');
  await expect(shop).toBeVisible();
  await expect(shop.locator('h2')).toContainText('Elira');

  const goldBefore = await readShopGold(page);
  expect(goldBefore).toBe(200);

  const firstBuyRow = shop.locator('.shop-section').first().locator('.shop-row').first();
  const itemName = (await firstBuyRow.locator('.item-name').textContent())!.trim();
  await firstBuyRow.getByText(/^Comprar \(\d+g\)$/).click();

  const goldAfter = await readShopGold(page);
  expect(goldAfter).toBeLessThan(goldBefore);

  // The bought item now shows up for sale back — proof it landed in the bag.
  const sellSection = shop.locator('.shop-section').filter({ hasText: 'Vender' });
  await expect(sellSection).toBeVisible();
  await expect(sellSection).toContainText(itemName);

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

async function readShopGold(page: import('@playwright/test').Page): Promise<number> {
  const text = await page.locator('.shop-overlay .subtitle').textContent();
  const match = text?.match(/(\d+)/);
  if (!match) throw new Error(`Could not parse gold from shop header: ${text}`);
  return Number(match[1]);
}
