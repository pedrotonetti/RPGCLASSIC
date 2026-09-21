/**
 * Ato 2.5's opening reveal chain ("A Sombra de Amara" — see data/quests.ts
 * AMARA_REVEAL_QUESTS and LORE.md's "A reviravolta (Ato 2/3)"): once a
 * class's own CLASS_CALLING_QUESTS chain is fully behind the player,
 * QuestSystem.ensureAmaraRevealStarted should hand them `amara_r1_evasion`
 * on mount, and talking to Tobias should surface HIS quest-conditioned
 * dialogue (data/npcs.ts questDialogue / dialogueLinesFor) rather than his
 * default greeting, then advance the chain exactly like any other talkTo
 * quest turn-in.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, seedSave, waitForOverworld } from './helpers';

test('completing a class calling chain starts the Amara reveal chain, and Tobias shows his quest-specific dialogue', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await seedSave(
    page,
    0,
    buildSave({
      classId: 'warrior',
      level: 13,
      gold: 0,
      xp: 0,
      // Default spawn (tileCenter(5, 5)) already sits one tile south of
      // Tobias (mapX 5, mapY 4 — see data/npcs.ts), so no override needed.
      completedQuestIds: ['q6_dragon', 'warrior_pc1_convoy', 'warrior_pc2_convoy_defense', 'warrior_pc3_first_line'],
      activeQuestId: null,
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  // ensureAmaraRevealStarted fired on mount: amara_r1_evasion is active.
  await expect(page.locator('.quest-tracker')).toContainText('Ancião Tobias');

  // Walk one tile north into Tobias's interact range (same 's' == toward
  // decreasing mapY at fresh-mount facing used by quest.spec.ts).
  await page.keyboard.down('s');
  await page.waitForTimeout(900);
  await page.keyboard.up('s');

  await page.locator('.interact-prompt', { hasText: 'Tobias' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.keyboard.press('e');

  await expect(page.locator('.dialogue-box')).toBeVisible();
  // Tobias's amara_r1_evasion questDialogue override, not his default greeting.
  await expect(page.locator('.dialogue-line')).toContainText('Zeladores da Raiz?');

  // The talkTo objective completes the instant dialogue opens, same as any
  // other talkTo quest (see OverworldScreen.openDialogue -> notifyTalkedTo).
  await expect(page.locator('.battle-message-bar')).toContainText('Missão concluída: As Perguntas que Tobias Evita!');

  await page.keyboard.press('Escape'); // closes the dialogue

  // Next quest in the chain was auto-accepted, pointing at Aldo.
  await expect(page.locator('.quest-tracker')).toContainText('Escrivão Aldo');

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});
