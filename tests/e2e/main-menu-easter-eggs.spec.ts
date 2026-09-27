/**
 * Title screen easter eggs (MainMenuScreen.ts).
 *
 * These are deliberately undiscoverable in the UI (no visible affordance),
 * but they're real shipped mechanics now, not just decoration — so they get
 * the same golden-path regression coverage as everything else, same as the
 * project's other screens/features.
 */
import { test, expect } from '@playwright/test';
import { clearAllSaves } from './helpers';

test('clicking the logo 8 times fast reveals the hidden toast', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await clearAllSaves(page);
  const logo = page.locator('.title-logo');
  await expect(logo).toHaveText('SEDE');

  const toast = page.locator('.menu-secret-toast');
  await expect(toast).not.toHaveClass(/visible/);

  for (let i = 0; i < 8; i++) await logo.click();

  await expect(toast).toHaveClass(/visible/);
  await expect(toast).toContainText('Escolhido Verde');

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('the Konami code reveals the same hidden toast, with its own message', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await clearAllSaves(page);
  await expect(page.locator('.title-logo')).toHaveText('SEDE');

  const sequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  for (const key of sequence) await page.keyboard.press(key);

  const toast = page.locator('.menu-secret-toast');
  await expect(toast).toHaveClass(/visible/);
  await expect(toast).toContainText('Raízes reconhecem');

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('a wrong sequence never triggers the toast', async ({ page }) => {
  await clearAllSaves(page);
  await expect(page.locator('.title-logo')).toHaveText('SEDE');

  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowUp', 'ArrowDown']) await page.keyboard.press(key);

  await expect(page.locator('.menu-secret-toast')).not.toHaveClass(/visible/);
});
