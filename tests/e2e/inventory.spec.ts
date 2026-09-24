/**
 * Golden path (d): inventory.
 *
 * Opens the pause menu, goes to Inventário, confirms the equipped-item
 * panel and bag render without errors, equips a bag item via its real
 * "Equipar" button, and confirms the equipped panel updates.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, openInventoryFromPause, seedSave, waitForOverworld } from './helpers';

test('equipping an item from the bag updates the equipped panel', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await seedSave(
    page,
    0,
    buildSave({
      classId: 'warrior',
      // Starts with nothing equipped, and one weapon sitting in the bag —
      // exercises both the "empty slot" and "equip from bag" rendering paths.
      equipment: {},
      bag: [{ uid: 'seed_axe', templateId: 'machado_guerra', rarity: 'azul', itemLevel: 5 }],
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await openInventoryFromPause(page);

  // Equipped panel: weapon slot starts empty.
  const weaponSlot = page.locator('.equip-slots .equip-slot').first();
  await expect(weaponSlot).toContainText('(vazio)');

  // Bag renders the seeded item, grouped into its own "Arma" grid section,
  // without error.
  await expect(page.locator('.bag-slot-header').filter({ hasText: 'Arma' })).toBeVisible();
  const bagItem = page.locator('.bag-grid .bag-card').filter({ hasText: 'Machado de Guerra' });
  await expect(bagItem).toBeVisible();
  await expect(bagItem).toContainText('Raro'); // RARITY_LABEL['azul']
  await expect(bagItem).toContainText('ganho garantido'); // comparisonBadge: nothing equipped yet in that slot
  await expect(bagItem.locator('.item-icon svg')).toBeVisible(); // per-template icon swatch

  await bagItem.getByText('Equipar', { exact: true }).click();

  // Equipped panel now shows the weapon instead of "(vazio)".
  await expect(weaponSlot).toContainText('Machado de Guerra');
  await expect(weaponSlot).not.toContainText('(vazio)');
  await expect(weaponSlot.locator('.item-icon svg')).toBeVisible();

  // The bag no longer offers to equip that same weapon slot's item a second
  // time in place — it's moved out of "Mochila" and into "Equipado".
  await expect(page.locator('.bag-grid .bag-card').filter({ hasText: 'Machado de Guerra' })).toHaveCount(0);

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});
