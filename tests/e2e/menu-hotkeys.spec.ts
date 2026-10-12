/**
 * Desktop quality-of-life (Fase 7): menu hotkeys, Escape closing the
 * topmost layer, hover comparison tooltip, and the "Tamanho da interface"
 * setting. Keyboard + mouse only, like the rest of the desktop suite.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, seedSave, waitForOverworld } from './helpers';

test('I/J abrem menus, Esc fecha a camada do topo, e o tooltip compara itens', async ({ page }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await seedSave(
    page,
    0,
    buildSave({
      classId: 'warrior',
      equipment: { arma: { uid: 'eq_sword', templateId: 'espada_curta', rarity: 'verde', itemLevel: 1 } },
      bag: [{ uid: 'bag_axe', templateId: 'machado_guerra', rarity: 'azul', itemLevel: 5 }],
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  // The pause menu shows its hotkeys.
  await page.keyboard.press('Escape');
  const pause = page.locator('.pause-overlay');
  await expect(pause).toBeVisible();
  await expect(pause.locator('.btn').filter({ hasText: 'Inventário' }).locator('.hotkey-hint')).toHaveText('I');
  await page.keyboard.press('Escape');
  await expect(pause).toBeHidden();

  // I opens the inventory straight from the world.
  await page.keyboard.press('i');
  await page.locator('.inventory-screen').waitFor({ state: 'visible' });
  await expect(page.locator('.inventory-screen .bottom-bar .hotkey-hint')).toContainText('Esc');

  // Hovering a bag card shows the comparison tooltip with stat deltas.
  const axeCard = page.locator('.bag-grid .bag-card').filter({ hasText: 'Machado de Guerra' });
  await axeCard.hover();
  const tooltip = page.locator('.item-compare-tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Espada Curta');
  await expect(tooltip.locator('.cmp-stat').first()).toBeVisible();

  // Opening the sheet, Esc closes only the sheet — the inventory stays.
  await axeCard.locator('.item-compare').click();
  const sheet = page.locator('.item-compare-sheet');
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.locator('.inventory-screen')).toBeVisible();

  // Next Esc leaves the inventory, back to the world.
  await page.keyboard.press('Escape');
  await waitForOverworld(page);
  await expect(page.locator('.inventory-screen')).toHaveCount(0);

  // J opens the quest log; Esc returns.
  await page.keyboard.press('j');
  await page.locator('.questlog-screen').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await waitForOverworld(page);

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('"Tamanho da interface" aplica e persiste a escala', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();

  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-screen')).toBeVisible();
  await page.locator('.settings-tab').filter({ hasText: 'Acessibilidade' }).click();
  const row = page.locator('.settings-row').filter({ hasText: 'Tamanho da interface' });
  await expect(row.locator('.settings-segment.active')).toHaveText('Médio');

  const titleBefore = (await page.locator('.settings-screen h1').boundingBox())!;
  await row.getByText('Grande').click();
  await expect(row.locator('.settings-segment.active')).toHaveText('Grande');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim())).toBe('1.15');
  const titleAfter = (await page.locator('.settings-screen h1').boundingBox())!;
  expect(titleAfter.height).toBeGreaterThan(titleBefore.height);

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rpgclassic:settings:v1') ?? '{}'));
  expect(stored.uiScale).toBe('grande');

  // Survives a reload (applied at boot by main.ts), and Esc leaves the screen.
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.uiScale)).toBe('grande');
  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-screen')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.main-menu')).toBeVisible();
});
