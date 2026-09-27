/**
 * NPC schedules (data/npcs.ts's NpcDefinition.nightHidden, consumed by
 * OverworldScreen.updateNpcSchedules) — Fase 4's first NPC schedule.
 * Elira the blacksmith is the one NPC using it so far: her forge is
 * daylight labor, so she isn't there at all once night falls — no label,
 * no interact prompt, same as any other closed shop.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, seedSave, tileCenter, waitForOverworld } from './helpers';

// Elira's fixed position — same tile shop.spec.ts already walks up to.
const ELIRA_TILE = { x: 16, y: 43 };

test('Elira is there and interactable during the day', async ({ page }) => {
  const near = tileCenter(ELIRA_TILE.x + 1, ELIRA_TILE.y);
  await seedSave(page, 0, buildSave({ classId: 'warrior', mapX: near.x, mapY: near.y, gameClock: { dayProgress: 13 / 24 } }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await expect(page.locator('.npc-label', { hasText: 'Ferreira Elira' })).toBeVisible();

  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  await expect(page.locator('.interact-prompt', { hasText: 'Elira' })).toBeVisible();
});

test('Elira\'s forge is closed at night — no label, no interact prompt, even standing right next to her', async ({ page }) => {
  const near = tileCenter(ELIRA_TILE.x + 1, ELIRA_TILE.y);
  await seedSave(page, 0, buildSave({ classId: 'warrior', mapX: near.x, mapY: near.y, gameClock: { dayProgress: 2 / 24 } }));
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await expect(page.locator('.npc-label', { hasText: 'Ferreira Elira' })).toBeHidden();

  await page.keyboard.down('d');
  await page.waitForTimeout(700);
  await page.keyboard.up('d');
  await expect(page.locator('.interact-prompt', { hasText: 'Elira' })).toBeHidden();
});
