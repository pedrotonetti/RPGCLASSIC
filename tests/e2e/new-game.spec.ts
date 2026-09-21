/**
 * Golden path (a): New game & character creation.
 *
 * Title screen (empty slot) → "Novo Jogo" → skip intro → pick a class →
 * "Personalizar Herói" → "Começar Aventura" → overworld actually renders.
 *
 * Run across 3 different classes (spanning 3 of the 4 distinct GLTF model
 * files a class can map to — see CLASS_MODEL_FILE in render/playerAvatar.ts)
 * so the class→model mapping and per-class hotbar aren't only ever exercised
 * with class index 0.
 */
import { test, expect } from '@playwright/test';
import { clearAllSaves, confirmCharacterCreation, selectClass, skipIntro, startNewGameFromSlot, waitForOverworld } from './helpers';

const CLASSES_TO_TRY = [
  { name: 'Guerreiro', hotbarHint: 'Golpe Poderoso' }, // warrior -> Barbarian.glb
  { name: 'Mago', hotbarHint: 'Bola de Fogo' }, // mage -> Mage.glb
  { name: 'Arqueiro', hotbarHint: 'Tiro Certeiro' }, // archer -> Rogue.glb
];

for (const { name } of CLASSES_TO_TRY) {
  test(`new game through character creation reaches the overworld — ${name}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await clearAllSaves(page);
    await expect(page.locator('.title-logo')).toHaveText('SEDE');

    await startNewGameFromSlot(page, 0);
    await expect(page.locator('.intro-screen')).toBeVisible();
    await skipIntro(page);

    await expect(page.locator('.char-select')).toBeVisible();
    await selectClass(page, name);

    await expect(page.locator('.creation-screen')).toBeVisible();
    // Give the hero a name via the creation screen's own text input — part
    // of a real player's flow, and exercises that the name round-trips.
    const nameInput = page.locator('.creation-name-input');
    await nameInput.fill(`Testeira ${name}`);
    await confirmCharacterCreation(page);

    await waitForOverworld(page);

    // Canvas is visible and the HUD reports the class/level a fresh
    // character should have.
    await expect(page.locator('.name-line')).toContainText(name);
    await expect(page.locator('.name-line')).toContainText('Nv.1');
    await expect(page.locator('.hud-hp')).toBeVisible();
    await expect(page.locator('.hud-mp')).toBeVisible();

    expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
  });
}
