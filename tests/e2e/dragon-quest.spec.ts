/**
 * q6_dragon ("O Guardião Corrompido" — defeat `young_dragon`) had no live
 * monster anywhere in the game to ever point at or complete against:
 * `young_dragon` is deliberately excluded from every zone's random scatter
 * (see data/zones.ts's own comment on Baluarte do Amanhecer), but nothing
 * ever placed a hand-picked instance of it either — so the quest arrow/
 * minimap always came up empty and the objective could never actually
 * complete. Fixed by giving it a real spawnFixedMonster placement in Baluarte
 * do Amanhecer (see OverworldScreen's BALUARTE_DRAGON_TILE) and extending the
 * quest-indicator's cross-zone hint to cover `defeat` objectives with a known
 * home zone (DEFEAT_TARGET_HOME_ZONE), not just `talkTo`.
 *
 * These tests cover the waypoint/spawn fix itself, not a full boss defeat
 * (already a well-tested pattern elsewhere — combat.spec.ts/dungeon.spec.ts
 * — and this specific fight is tuned to take real time, not worth
 * re-proving here).
 */
import { test, expect } from '@playwright/test';
import { BALUARTE_AMANHECER_ID, buildSave, continueFromSlot, MAIN_CITY_ID, seedSave, tileCenter, waitForOverworld } from './helpers';

// Matches OverworldScreen's own BALUARTE_DRAGON_TILE.
const DRAGON_TILE = { x: 44, y: 21 };

test('the quest-follow hint points toward Baluarte do Amanhecer while the player is elsewhere', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await seedSave(
    page,
    0,
    buildSave({
      classId: 'warrior',
      level: 12,
      activeQuestId: 'q6_dragon',
      zoneId: MAIN_CITY_ID,
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  await expect(page.locator('.quest-zone-hint')).toBeVisible();
  await expect(page.locator('.quest-zone-hint')).toContainText('Baluarte do Amanhecer');

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});

test('young_dragon spawns as a real, findable boss encounter in Baluarte do Amanhecer, and the quest arrow tracks it', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const start = tileCenter(DRAGON_TILE.x, DRAGON_TILE.y + 4);
  await seedSave(
    page,
    0,
    buildSave({
      classId: 'warrior',
      level: 20,
      activeQuestId: 'q6_dragon',
      zoneId: BALUARTE_AMANHECER_ID,
      mapX: start.x,
      mapY: start.y,
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  // No cross-zone hint needed once the player is already in the right zone.
  await expect(page.locator('.quest-zone-hint')).toBeHidden();

  // The fixed encounter is alive, tagged as a boss (data/enemies.ts's
  // isBoss), and visible on the minimap as a monster marker.
  await expect(page.locator('.enemy-label.world.boss:visible').first()).toBeVisible({ timeout: 15_000 });

  // The quest-follow arrow has something to point at (it only ever shows
  // once questIndicatorTarget resolves to a real position).
  await expect(page.locator('.quest-arrow')).toBeVisible();

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});
