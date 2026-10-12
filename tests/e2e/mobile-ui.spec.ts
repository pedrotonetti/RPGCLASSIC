/**
 * Mobile/touch UI (Fase 7): phone-sized viewports, touch emulation.
 *
 * Drives the game the way a phone player does — taps on the on-screen
 * ☰ button instead of Escape, tap-and-hold on a bag card instead of hover —
 * and asserts the layout itself: the HUD and the inventory render inside
 * the viewport with no horizontal overflow, the main touch controls are at
 * least 44px, the quest tracker collapses on tap (and remembers it), and
 * the low-HP vignette shows for a badly hurt hero. Portrait and landscape
 * each get one run, since they hit different breakpoints in style.css.
 */
import { test, expect as baseExpect, type Page } from '@playwright/test';
import { buildSave, continueFromSlot, seedSave, waitForOverworld } from './helpers';

/**
 * Touch input (unlike synthetic mouse clicks) waits for the renderer to
 * acknowledge each event, and on this environment's software-WebGL
 * Chromium a busy overworld frame can take seconds — so taps/assertions
 * here get far more slack than the desktop specs' defaults.
 */
const expect = baseExpect.configure({ timeout: 45_000 });

/** Every visible element under `rootSelector` whose box pokes past the left/right viewport edge (1px tolerance for subpixel rounding). */
async function horizontalOverflow(page: Page, rootSelector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const vw = window.innerWidth;
    const offenders: string[] = [];
    const roots = Array.from(document.querySelectorAll<HTMLElement>(sel));
    for (const root of roots) {
      for (const node of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        // Inside a scroll container, content is clipped by it — the container's own box is what counts.
        const clip = node.parentElement?.closest<HTMLElement>('.inventory-panel, .bag-grid');
        if (clip && clip !== root && getComputedStyle(clip).overflowX !== 'visible' && node !== clip) continue;
        const r = node.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.left < -1 || r.right > vw + 1) offenders.push(`${node.tagName.toLowerCase()}.${node.className} [${Math.round(r.left)}, ${Math.round(r.right)}]`);
      }
    }
    return offenders;
  }, rootSelector);
}

/**
 * The page's own horizontal scroll extent, plus whether it can actually be
 * scrolled sideways. (World-anchored labels — NPC names off to the side of
 * the camera — may legitimately sit outside the viewport inside the
 * overflow-hidden body; that is not page overflow.)
 */
async function documentOverflow(page: Page): Promise<{ scrollWidth: number; innerWidth: number; scrollX: number }> {
  return page.evaluate(() => {
    window.scrollTo(400, 0);
    document.documentElement.scrollLeft = 400;
    const result = {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      scrollX: window.scrollX + document.documentElement.scrollLeft + document.body.scrollLeft,
    };
    window.scrollTo(0, 0);
    return result;
  });
}

const HUD_SELECTORS = '.hud-panel, .quest-tracker, .menu-btn, .camera-angle-btn, .joystick, .minimap-canvas, .xp-bar, .hud-hint';

function seededSave() {
  return buildSave({
    classId: 'warrior',
    level: 6,
    // Badly hurt: the low-HP vignette must be up on arrival.
    currentHp: 4,
    equipment: {
      arma: { uid: 'eq_sword', templateId: 'espada_curta', rarity: 'verde', itemLevel: 2 },
    },
    bag: [
      {
        uid: 'bag_axe',
        templateId: 'machado_guerra',
        rarity: 'amarelo',
        itemLevel: 6,
        affixes: [
          { id: 'brutalidade', value: 4 },
          { id: 'sangue', value: 0.03 },
        ],
      },
      { uid: 'bag_armor', templateId: 'couraca_das_brasas', rarity: 'amarelo', itemLevel: 6 },
    ],
  });
}

for (const orientation of [
  { name: 'retrato', viewport: { width: 390, height: 844 } },
  { name: 'paisagem', viewport: { width: 844, height: 390 } },
]) {
  test.describe(`celular em ${orientation.name}`, () => {
    test.use({ viewport: orientation.viewport, hasTouch: true, isMobile: true, actionTimeout: 60_000 });

    test('HUD e inventário cabem na tela, com alvos de toque de 44px', async ({ page }) => {
      test.setTimeout(480_000);
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await seedSave(page, 0, seededSave());
      await continueFromSlot(page, 0);
      await waitForOverworld(page);

      // Touch layout is active: the ☰ button (touch-only) is shown, the
      // keyboard hint is not.
      await expect(page.locator('body')).toHaveClass(/is-touch/);
      const menuBtn = page.locator('.menu-btn');
      await expect(menuBtn).toBeVisible();
      await expect(page.locator('.hud-hint')).toBeHidden();

      // --- HUD: inside the viewport, no horizontal scroll ---------------
      const doc = await documentOverflow(page);
      expect(doc.scrollWidth, 'page must not scroll sideways').toBeLessThanOrEqual(doc.innerWidth);
      expect(doc.scrollX).toBe(0);
      expect(await horizontalOverflow(page, HUD_SELECTORS)).toEqual([]);

      for (const sel of ['.menu-btn', '.camera-angle-btn', '.joystick-base']) {
        const box = await page.locator(sel).boundingBox();
        expect(box, sel).not.toBeNull();
        expect(box!.width, `${sel} width`).toBeGreaterThanOrEqual(44);
        expect(box!.height, `${sel} height`).toBeGreaterThanOrEqual(44);
      }

      // --- Low-HP warning --------------------------------------------------
      await expect(page.locator('.low-hp-vignette')).toHaveClass(/\blow\b/);

      // --- Quest tracker collapses on tap, and remembers it ----------------
      const tracker = page.locator('.quest-tracker');
      await expect(tracker).toBeVisible();
      await expect(tracker).not.toHaveClass(/collapsed/);
      await tracker.tap();
      await expect(tracker).toHaveClass(/collapsed/);
      const collapsedBox = await tracker.boundingBox();
      expect(collapsedBox!.height).toBeGreaterThanOrEqual(44);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rpgclassic:settings:v1') ?? '{}'));
      expect(stored.questTrackerCollapsed).toBe(true);
      await tracker.tap();
      await expect(tracker).not.toHaveClass(/collapsed/);

      // --- Inventory via the ☰ menu ----------------------------------------
      await menuBtn.tap();
      const pause = page.locator('.pause-overlay');
      await expect(pause).toBeVisible();
      // Keyboard hotkey hints are hidden on touch.
      await expect(pause.locator('.hotkey-hint').first()).toBeHidden();
      await pause.getByText('Inventário').tap();
      await page.locator('.inventory-screen').waitFor({ state: 'visible' });

      const axeCard = page.locator('.bag-grid .bag-card').filter({ hasText: 'Machado de Guerra' });
      await expect(axeCard).toBeVisible();
      const invDoc = await documentOverflow(page);
      expect(invDoc.scrollWidth).toBeLessThanOrEqual(invDoc.innerWidth);
      expect(await horizontalOverflow(page, '.inventory-screen')).toEqual([]);

      const equipBox = await axeCard.getByText('Equipar', { exact: true }).boundingBox();
      expect(equipBox!.height).toBeGreaterThanOrEqual(44);

      // --- Tap-and-hold a bag card → comparison sheet ----------------------
      const cardBox = (await axeCard.locator('.item-icon').boundingBox())!;
      const point = { clientX: cardBox.x + cardBox.width / 2, clientY: cardBox.y + cardBox.height / 2 };
      await axeCard.dispatchEvent('pointerdown', { pointerType: 'touch', pointerId: 7, isPrimary: true, ...point });
      await page.waitForTimeout(650);
      await axeCard.dispatchEvent('pointerup', { pointerType: 'touch', pointerId: 7, isPrimary: true, ...point });

      const sheet = page.locator('.item-compare-sheet');
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText('Espada Curta'); // the equipped item it compares against
      await expect(sheet.locator('.cmp-stat.gain').first()).toBeVisible(); // ATQ goes up
      await expect(sheet).toContainText('Afixos ganhos');
      await expect(sheet).toContainText('roubo de vida');
      expect(await horizontalOverflow(page, '.item-compare-backdrop')).toEqual([]);
      // Holding must not have equipped anything behind the sheet.
      await expect(page.locator('.equip-slots .equip-slot').first()).toContainText('Espada Curta');

      await sheet.getByText('Fechar').tap();
      await expect(sheet).toBeHidden();

      // Tapping the comparison badge also opens it; Equipar from the sheet equips.
      await axeCard.locator('.item-compare').tap();
      await expect(sheet).toBeVisible();
      await sheet.locator('.item-compare-actions .btn.primary').tap(); // "Equipar"
      await expect(sheet).toBeHidden();
      await expect(page.locator('.equip-slots .equip-slot').first()).toContainText('Machado de Guerra');

      expect(pageErrors, `unexpected page errors: ${pageErrors.join('; ')}`).toEqual([]);
    });
  });
}
