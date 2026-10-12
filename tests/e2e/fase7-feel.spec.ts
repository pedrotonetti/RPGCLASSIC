/**
 * Fase 7 — ambientação e sensação de combate: a light smoke check.
 *
 *  - The three new accessibility rows (plus "Volume do Ambiente") show up on
 *    the settings screen and persist to localStorage.
 *  - A dungeon fight still plays out with the new hit-stop/shake/hit-flash/
 *    knockback/typed damage numbers wired in: popups carry a
 *    `floating-text--*` variant class, and nothing throws or logs an error.
 *
 * Same seeded dungeon chamber as combat.spec.ts, for the same determinism
 * reasons (see its own doc comment).
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, holdKey, ROOT_HOLLOW_LAYOUT, ROOT_HOLLOW_ZONE_ID, seedSave, tileCenter, waitForOverworld } from './helpers';

test('settings screen exposes and persists the Fase 7 options', async ({ page }) => {
  await page.goto('/');
  await page.locator('.settings-toggle').click();
  await expect(page.locator('.settings-screen')).toBeVisible();

  // Configurações is tabbed: each option lives under its own tab.
  const tab = (name: string) => page.locator('.settings-tab').filter({ hasText: name });
  for (const [tabName, label] of [
    ['Áudio', 'Volume do Ambiente'],
    ['Câmera', 'Tremor de tela'],
    ['Interface', 'Números de dano'],
    ['Acessibilidade', 'Reduzir movimento'],
  ]) {
    await tab(tabName).click();
    await expect(page.locator('.settings-row').filter({ hasText: label })).toBeVisible();
  }

  await tab('Câmera').click();
  await page.locator('.settings-row-shake').getByText('Suave').click();
  await tab('Interface').click();
  await page.locator('.settings-row-damage-numbers').getByText('Desativado').click();
  await tab('Acessibilidade').click();
  await page.locator('.settings-row-reduce-motion').getByText('Ativado', { exact: true }).click();

  const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('rpgclassic:settings:v1') ?? '{}'));
  expect(stored).toMatchObject({ screenShake: 0.5, damageNumbers: false, reduceMotion: true });
  await tab('Câmera').click();
  await expect(page.locator('.settings-row-shake .settings-segment.active')).toHaveText('Suave');
});

test('a dungeon fight with the Fase 7 feel wiring shows typed damage numbers and raises no errors', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const start = tileCenter(ROOT_HOLLOW_LAYOUT.encounterTiles[0].x, ROOT_HOLLOW_LAYOUT.encounterTiles[0].y + 3);
  await seedSave(
    page,
    0,
    buildSave({
      classId: 'warrior',
      level: 3,
      zoneId: ROOT_HOLLOW_ZONE_ID,
      mapX: start.x,
      mapY: start.y,
      equipment: { arma: { uid: 'seed_weapon', templateId: 'espada_curta', rarity: 'verde', itemLevel: 1 } },
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  // Record every floating number's classes as it appears (they only live ~750ms).
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __popupClasses: string[] }).__popupClasses = seen;
    new MutationObserver((records) => {
      for (const r of records)
        r.addedNodes.forEach((n) => {
          if (n instanceof HTMLElement && n.classList.contains('floating-text')) seen.push(n.className);
        });
    }).observe(document.getElementById('ui-root')!, { childList: true });
  });

  await holdKey(page, 's', 3500);
  const hotbar = page.locator('.hotbar');
  await hotbar.waitFor({ state: 'visible', timeout: 15_000 });

  for (let i = 0; i < 25 && (await hotbar.isVisible()); i++) {
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    const prompt = await page.locator('.battle-message-bar').textContent().catch(() => null);
    if (prompt?.includes('Escolha o alvo')) await page.locator('.enemy-label.world:visible').first().click({ force: true });
    await page.waitForTimeout(1000);
    const seen = await page.evaluate(() => (window as unknown as { __popupClasses: string[] }).__popupClasses.length);
    if (seen >= 2) break;
  }

  const classes = await page.evaluate(() => (window as unknown as { __popupClasses: string[] }).__popupClasses);
  expect(classes.length, 'at least one floating number should have appeared').toBeGreaterThan(0);
  for (const c of classes) expect(c).toMatch(/floating-text--(normal|crit|weak|resist|heal|miss|elemental|player)/);

  expect(errors, `unexpected errors: ${errors.join('; ')}`).toEqual([]);
});
