/**
 * Golden path (c): overworld combat.
 *
 * Walks into melee range of a monster, confirms the engagement HUD
 * (hotbar) appears, lands basic attacks via the real keyboard shortcut, and
 * confirms both the monster's HP bar drops and it is eventually defeated
 * with an XP/gold ("Vitória! +X XP...") event.
 *
 * WHY THE DUNGEON, NOT A RANDOM OPEN-WORLD MONSTER: `OverworldCombat`'s
 * `pickSpawnPoints` scatters regular open-world monsters with `Math.random()`
 * (not a seeded RNG), so their position is different every page load — real
 * player behavior, but not something a shared, must-stay-green regression
 * gate can hunt for reliably. Root Hollow's dungeon pods
 * (`data/dungeons.ts`), by contrast, spawn at fixed, hand-derived tile
 * coordinates every single time (see `ROOT_HOLLOW_LAYOUT` in helpers.ts) —
 * so this test seeds the player just inside the first encounter chamber and
 * walks a short, deterministic distance to it. The dungeon golden path
 * (dungeon.spec.ts) separately covers walking to the portal from the open
 * world and the boss fight.
 */
import { test, expect } from '@playwright/test';
import { buildSave, continueFromSlot, holdKey, ROOT_HOLLOW_LAYOUT, ROOT_HOLLOW_ZONE_ID, seedSave, tileCenter, waitForOverworld } from './helpers';

test('walking up to a dungeon monster engages combat; basic attacks drop its HP and defeat it', async ({ page }) => {
  // The first encounter pod is 2 monsters, each needing a few basic-attack
  // hits (with their own 1.1s cooldown) — comfortably under the global
  // timeout in practice, but this mounts a full zone first too.
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  // Just south of the first encounter chamber's monster cluster (see
  // ROOT_HOLLOW_LAYOUT) — a few tiles' walk, well inside the chamber so
  // there's no corridor bottleneck to navigate.
  const start = tileCenter(ROOT_HOLLOW_LAYOUT.encounterTiles[0].x, ROOT_HOLLOW_LAYOUT.encounterTiles[0].y + 3);
  await seedSave(
    page,
    0,
    buildSave({
      classId: 'warrior',
      level: 3,
      gold: 30,
      zoneId: ROOT_HOLLOW_ZONE_ID,
      mapX: start.x,
      mapY: start.y,
      equipment: { arma: { uid: 'seed_weapon', templateId: 'espada_curta', rarity: 'verde', itemLevel: 1 } },
    }),
  );
  await continueFromSlot(page, 0);
  await waitForOverworld(page);

  // Dungeon-specific HUD is up.
  await expect(page.locator('.dungeon-progress')).toBeVisible();

  // 's' decreases mapY at the fresh-mount facing (yaw 0) — see
  // movement.spec.ts's doc comment on this game's screen-relative movement
  // — which is the direction from our seeded spot toward the encounter's
  // monsters (lower y).
  await holdKey(page, 's', 3500);

  // The monster's own AI closes the rest of the distance and engages
  // automatically once in range — engagement isn't gated on player input.
  const hotbar = page.locator('.hotbar');
  await hotbar.waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.locator('.enemy-label.world:visible').first()).toBeVisible();

  const hpFill = page.locator('.enemy-hpbar-fg').first();

  // Land basic attacks (hotbar slot 1 / key '1') respecting its 1.1s
  // cooldown, until the monster dies or we've clearly tried enough — a
  // level-3 warrior vs. a first-chamber slime/bat should take only a
  // couple of hits.
  let sawDamage = false;
  let victoryText: string | null = null;
  for (let i = 0; i < 30 && (await hotbar.isVisible()); i++) {
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    // The first encounter pod is 2 monsters (see ROOT_HOLLOW_LAYOUT /
    // data/dungeons.ts encounterEnemyIds[0]) — with more than one enemy
    // engaged, the basic attack needs an explicit target click instead of
    // firing immediately (see OverworldCombat.onHotbarClicked).
    const prompt = await page.locator('.battle-message-bar').textContent().catch(() => null);
    if (prompt?.includes('Escolha o alvo')) {
      // `:visible` matters here: a defeated monster's label stays in the DOM
      // (just `hidden`, see OverworldCombat.killMonster) — without this, once
      // one of the two is dead, a plain `.first()` can lock onto its hidden
      // label and hang forever waiting for it to become visible.
      await page.locator('.enemy-label.world:visible').first().click();
    }
    await page.waitForTimeout(1200);

    if (!sawDamage) {
      const width = await hpFill.evaluate((el) => (el as HTMLElement).style.width).catch(() => '');
      if (width && width !== '100%') sawDamage = true;
    }

    const message = await page.locator('.battle-message-bar').textContent().catch(() => null);
    if (message?.includes('Vitória!')) {
      victoryText = message;
      break;
    }
  }

  expect(sawDamage, 'the engaged monster\'s HP bar should have dropped below full at some point').toBe(true);
  expect(victoryText, 'combat should end in victory with an XP/gold message').not.toBeNull();
  expect(victoryText).toMatch(/Vitória!.*XP/);

  // Combat HUD tears down once the fight ends.
  await expect(hotbar).toBeHidden();

  expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
});
