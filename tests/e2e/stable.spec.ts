/**
 * Estábulo (StableScreen): opens from the pause menu, lists mounts by kind
 * with lock hints, previews a flying mount, feeds it (gold → mount XP),
 * renames it, rides it, and the choice survives the trip back to the world.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, pauseGame, readSave, seedSave, waitForOverworld } from './helpers';

test('stable: select, feed, rename and ride a flying mount', async ({ page }) => {
  test.setTimeout(240_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await seedSave(
    page,
    0,
    buildSave({
      classId: 'mage',
      level: 12,
      gold: 1000,
      unlockedMounts: ['cavalo_marrom', 'condor', 'pegaso'],
      equippedMounts: { terrestre: 'cavalo_marrom', voadora: 'condor' },
      mountXp: { pegaso: 250 },
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await pauseGame(page);
  await page.locator('.pause-overlay .btn').filter({ hasText: /^Estábulo/ }).click();
  await page.locator('.stable-screen').waitFor({ state: 'visible' });

  // Ground tab: the starter is equipped, the others locked with a hint.
  await expect(page.locator('.stable-item.selected')).toContainText('Cavalo Baio');
  await page.locator('.stable-item').filter({ hasText: 'Lobo Cinzento' }).click();
  await expect(page.locator('.stable-lock')).toContainText('missão secundária');

  // Flying tab → Pégaso: feed once to cross the 300 XP evolution.
  await page.locator('.stable-tab').filter({ hasText: 'Voadoras' }).click();
  await page.locator('.stable-item').filter({ hasText: 'Pégaso' }).click();
  const goldOf = async () => Number((await page.locator('.stable-screen .top-bar .subtitle').textContent())!.replace(/\D/g, ''));
  const goldBefore = await goldOf();
  await page.locator('.stable-actions .btn').filter({ hasText: 'Alimentar' }).click();
  expect(await goldOf()).toBe(goldBefore - 60);
  await expect(page.locator('.workshop-notice')).toContainText('Pégaso Real');

  await page.locator('.stable-nick').fill('Relâmpago');
  await page.locator('.stable-actions .btn').filter({ hasText: 'Renomear' }).click();
  await expect(page.locator('.stable-name')).toHaveText('Relâmpago');

  await page.locator('.stable-actions .btn').filter({ hasText: 'Voar agora' }).click();
  await page.screenshot({ path: test.info().outputPath('stable.png') });

  const saved = await readSave(page, 0);
  expect(saved.activeMountId).toBe('pegaso');
  expect(saved.equippedMounts?.voadora).toBe('pegaso');
  expect(saved.mountNicknames?.pegaso).toBe('Relâmpago');
  expect(saved.gold).toBe(goldBefore - 60);

  await page.getByText('Voltar à Aventura').click();
  await waitForOverworld(page);
  expect(pageErrors).toEqual([]);
});
