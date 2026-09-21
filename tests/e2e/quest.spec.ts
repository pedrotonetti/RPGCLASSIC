/**
 * Golden path (f): quest pickup + turn-in.
 *
 * Uses `warrior_q2_pedravale` ("Rumo a Pedravale": talkTo Guarda Bram,
 * reward 35 XP/20 gold, chains into `q1_awaken`) — the cheapest possible
 * objective (`talkTo`, see data/quests.ts) completes the instant dialogue
 * opens, so "accept -> complete objective -> turn in -> reward granted" is
 * one real interaction: this game auto-advances `activeQuestId` to
 * `nextQuestId` on completion (there's no separate "accept" dialogue choice
 * to click through — the assignment IS the accept), so this single talkTo
 * exercises both the turn-in of one quest AND the automatic hand-off/accept
 * of the next one in the same stroke.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, seedSave, tileCenter, waitForOverworld } from './helpers';

const BRAM_TILE = { x: 8, y: 3 };

test('talking to a quest NPC completes the objective, grants the reward, and hands off the next quest', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const start = tileCenter(BRAM_TILE.x, BRAM_TILE.y + 2);
  await seedSave(
    page,
    0,
    buildSave({
      classId: 'warrior',
      level: 1,
      gold: 0,
      xp: 0,
      activeQuestId: 'warrior_q2_pedravale',
      mapX: start.x,
      mapY: start.y,
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await expect(page.locator('.quest-tracker')).toContainText('Guarda Bram');

  // 's' decreases mapY at the fresh-mount facing (yaw 0) — see
  // movement.spec.ts — which is the direction from 2 tiles south of Bram
  // toward him.
  await page.keyboard.down('s');
  await page.waitForTimeout(900);
  await page.keyboard.up('s');

  await page.locator('.interact-prompt', { hasText: 'Bram' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('e');

  await expect(page.locator('.dialogue-box')).toBeVisible();
  // The quest banner fires the instant dialogue opens (see
  // OverworldScreen.openDialogue -> notifyTalkedTo).
  await expect(page.locator('.battle-message-bar')).toContainText('Missão concluída: Rumo a Pedravale!');
  await expect(page.locator('.battle-message-bar')).toContainText('+35 XP');
  await expect(page.locator('.battle-message-bar')).toContainText('+20 ouro');

  await page.keyboard.press('Escape'); // closes the dialogue

  // Reward actually landed...
  await expect(page.locator('.hud-panel')).toContainText('Ouro: 20');
  // ...and the NEXT quest in the chain was auto-accepted.
  await expect(page.locator('.quest-tracker')).toContainText('Ancião Tobias');

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});
