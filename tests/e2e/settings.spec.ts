/**
 * Settings screen (screens/SettingsScreen.ts) — reachable from both the main
 * menu (no character loaded) and the pause overlay (mid-adventure), the
 * music/sfx volume sliders (systems/GameSettings.ts + AudioSystem's
 * musicGain/sfxGain split), and the hidden developer panel (7 taps on the
 * screen's own title — screens/DevPanel.ts) used to rename a character off
 * a generic name and to jump its level for testing.
 */
import { test, expect, type Locator } from '@playwright/test';
import { buildSave, clearAllSaves, continueFromSlot, pauseGame, readSave, seedSave, waitForOverworld } from './helpers';

/**
 * The dev-panel reveal needs 7 taps inside a 2.5s window (see
 * SettingsScreen.onTitleTap). Playwright's real `.click()` re-runs its full
 * actionability pipeline (visibility/stability polling) on every call, which
 * against a screen with a continuously-rendering WebGL canvas underneath can
 * take well over a second per click — comfortably blowing past the 2.5s
 * combo window through no fault of the game itself. A real player tapping a
 * title 7 times takes nowhere near that long, so this dispatches the same
 * 'click' event the production code listens for (see ui/dom.ts's `el`)
 * directly and rapidly, exercising the exact gesture without fighting
 * Playwright's per-call actionability overhead.
 */
async function tapTitleSevenTimes(title: Locator): Promise<void> {
  await title.evaluate((node) => {
    for (let i = 0; i < 7; i++) node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

test('the settings icon on the main menu opens Configurações, and Voltar returns to the main menu', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await clearAllSaves(page);
  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-screen')).toBeVisible();

  await page.getByText('< Voltar').click();
  await expect(page.locator('.main-menu')).toBeVisible();

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('adjusting the music volume slider persists across a reload', async ({ page }) => {
  await clearAllSaves(page);
  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-screen')).toBeVisible();

  const musicSlider = page
    .locator('.settings-row')
    .filter({ hasText: 'Volume da Música' })
    .locator('input.settings-slider');
  await expect(musicSlider).toHaveValue('100');

  await musicSlider.evaluate((input: HTMLInputElement) => {
    input.value = '35';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(
    page.locator('.settings-row').filter({ hasText: 'Volume da Música' }).locator('.settings-slider-value'),
  ).toHaveText('35%');

  await page.reload();
  await page.locator('.settings-toggle').click();
  const musicSliderAfterReload = page
    .locator('.settings-row')
    .filter({ hasText: 'Volume da Música' })
    .locator('input.settings-slider');
  await expect(musicSliderAfterReload).toHaveValue('35');
});

test('Configurações is reachable from the pause menu and returns to the same adventure', async ({ page }) => {
  await seedSave(page, 0, buildSave({ classId: 'warrior' }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await pauseGame(page);
  await page.locator('.pause-overlay').getByText('Configurações').click();
  await expect(page.locator('.settings-screen')).toBeVisible();

  await page.getByText('< Voltar').click();
  await waitForOverworld(page);
});

test('the developer panel from the main menu (no character loaded) shows a hint instead of edit tools', async ({ page }) => {
  await clearAllSaves(page);
  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-screen')).toBeVisible();

  const title = page.locator('.settings-screen h1');
  await tapTitleSevenTimes(title);

  const devPanel = page.locator('.dev-panel');
  await expect(devPanel).toBeVisible();
  await expect(devPanel).toContainText('Abra este painel de dentro de uma aventura em andamento');
  await expect(devPanel.locator('.dev-input')).toHaveCount(0);
});

test('tapping the settings title 7 times reveals the developer panel, which can rename and set the level of the loaded character', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // Mirrors the real report this was built for: a save stuck with the
  // generic default name, whose owner wants to rename it and jump levels
  // to test builds without grinding.
  await seedSave(page, 0, buildSave({ classId: 'mage', name: 'Herói', level: 9 }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await pauseGame(page);
  await page.locator('.pause-overlay').getByText('Configurações').click();
  await expect(page.locator('.settings-screen')).toBeVisible();

  const title = page.locator('.settings-screen h1');
  const devPanel = page.locator('.dev-panel');
  await expect(devPanel).not.toBeVisible();
  await tapTitleSevenTimes(title);
  await expect(devPanel).toBeVisible();
  await expect(devPanel.locator('.dev-readout')).toContainText('Herói — Mago Nv.9');

  const nameInput = devPanel.locator('.dev-input').first();
  await nameInput.fill('Aldric');
  await devPanel.getByText('Renomear').click();
  await expect(devPanel.locator('.dev-readout')).toContainText('Aldric — Mago Nv.9');
  await expect(devPanel.locator('.dev-status')).toContainText('Renomeado');

  const levelInput = devPanel.locator('.dev-input-narrow');
  await levelInput.fill('15');
  await devPanel.getByText('Definir nível').click();
  await expect(devPanel.locator('.dev-readout')).toContainText('Aldric — Mago Nv.15');
  await expect(devPanel.locator('.dev-status')).toContainText('Nível ajustado');

  const save = await readSave(page, 0);
  expect(save.name).toBe('Aldric');
  expect(save.level).toBe(15);
  expect(save.xp).toBe(0);

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});
