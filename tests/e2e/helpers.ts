/**
 * Shared helpers for the Sede E2E suite — see playwright.config.ts for the
 * suite's overall design notes (save-seeding approach, why no debug hooks,
 * why the dungeon's fixed encounters are used for the combat golden path).
 *
 * Every helper here drives the game the same way a real player would
 * (clicks, keyboard, reading on-screen text) or reads/writes the exact same
 * `localStorage` save format the game itself uses — nothing here reaches
 * into the game's internals.
 */
import type { Page } from '@playwright/test';
import type { PlayerSaveData } from '../../src/entities/Player';

/** Mirrors `STORAGE_KEY`/slot-key scheme in src/config/gameConfig.ts + src/systems/SaveSystem.ts — kept as literals (not imported) so this test helper has no runtime dependency on game source, only a `import type` for shape-checking. */
const STORAGE_KEY = 'rpgclassic:save:v2';
export function slotKey(slot: number): string {
  return `${STORAGE_KEY}:slot${slot}`;
}

/** Mirrors TILE_SIZE in src/config/gameConfig.ts. */
const TILE_SIZE = 2;
export function tileCenter(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 };
}

export const MAIN_CITY_ID = 'main_city';
/** The early-tier dungeon this suite drives end-to-end — see data/dungeons.ts. */
export const ROOT_HOLLOW_ZONE_ID = 'dungeon_root_hollow';
/** Root Hollow's fixed layout (3 encounters), computed the same way `MapGenerator.dungeonLayout`/`data/dungeons.ts` do — see playwright.config.ts's design notes on why the dungeon's FIXED encounters (not a random open-world monster) back the combat golden path. Recomputed by hand here (not imported) so a test failure here can't be masked by also breaking the import; if `data/dungeons.ts` ever changes Root Hollow's encounter count this will need updating, same as any other hand-derived fixture. */
export const ROOT_HOLLOW_LAYOUT = {
  playerStart: { x: 6, y: 56 },
  encounterTiles: [
    { x: 6, y: 44 },
    { x: 6, y: 32 },
    { x: 6, y: 20 },
  ],
  bossTile: { x: 6, y: 6 },
};
/** Root Hollow's fixed portal tile in the main city — see data/dungeons.ts DUNGEON_DEFINITIONS[0].portalAtTile. */
export const ROOT_HOLLOW_PORTAL_TILE = { x: 24, y: 6 };

/**
 * Builds a save (matching the game's own `PlayerSaveData`) for seeding
 * `localStorage` directly. Only `classId` is required — every other field
 * left out gets the same default `Player`'s own constructor already applies
 * (see `entities/Player.ts`), so a caller only needs to specify what that
 * particular test actually cares about. This is the exact save format/slot
 * key the real game reads via "Continuar" — not a parallel test-only format.
 */
export function buildSave(overrides: Partial<PlayerSaveData> & { classId: string }): Partial<PlayerSaveData> {
  const spawn = tileCenter(5, 5);
  return {
    name: 'Testeira',
    level: 1,
    xp: 0,
    gold: 30,
    inventory: { potion_hp: 3, potion_mp: 2 },
    mapX: spawn.x,
    mapY: spawn.y,
    zoneId: MAIN_CITY_ID,
    equipment: {},
    bag: [],
    completedQuestIds: [],
    activeQuestId: null,
    questProgress: {},
    // A seeded save simulates a character already in progress, not a
    // brand-new one — real character creation is what exercises the actual
    // first-time state (see OverworldScreen's tutorial overlay, gated on
    // this exact field). Without this, every seeded save would show that
    // overlay on mount and block movement input, which every other helper
    // here (holdKey, etc.) relies on working immediately.
    hasSeenTutorial: true,
    ...overrides,
  };
}

/** Writes `save` into the given slot's localStorage key, then reloads so MainMenuScreen picks it up. Navigates to `/` first if the page isn't already there (localStorage needs a same-origin document). */
export async function seedSave(page: Page, slot: number, save: Partial<PlayerSaveData>): Promise<void> {
  if (page.url() === 'about:blank') await page.goto('/');
  await page.evaluate(
    ({ key, data }) => window.localStorage.setItem(key, JSON.stringify(data)),
    { key: slotKey(slot), data: save },
  );
  await page.reload();
}

/** Clears every save slot (and the legacy pre-slot key) — the "clear localStorage" step of the new-game golden path. */
export async function clearAllSaves(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => window.localStorage.clear());
  await page.reload();
}

/** Reads a slot's save back out of localStorage, exactly as the game itself would on "Continuar". Throws if the slot is empty. */
export async function readSave(page: Page, slot = 0): Promise<PlayerSaveData> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), slotKey(slot));
  if (!raw) throw new Error(`No save found in slot ${slot} (key ${slotKey(slot)})`);
  return JSON.parse(raw) as PlayerSaveData;
}

// --- title screen / navigation -------------------------------------------

export function slotCard(page: Page, slot: number) {
  return page.locator('.save-slots .save-slot').nth(slot);
}

export async function startNewGameFromSlot(page: Page, slot = 0): Promise<void> {
  await slotCard(page, slot).getByText('Novo Jogo').click();
}

export async function continueFromSlot(page: Page, slot = 0): Promise<void> {
  await slotCard(page, slot).getByText('Continuar').click();
}

export async function skipIntro(page: Page): Promise<void> {
  await page.getByText('Pular introdução').click();
}

/** Picks a class by its display name (e.g. 'Guerreiro', 'Mago', 'Arqueiro' — see config/classes.ts) on CharacterSelectScreen, then proceeds to CharacterCreationScreen. */
export async function selectClass(page: Page, className: string): Promise<void> {
  await page.locator('.class-card').filter({ hasText: className }).click();
  await page.getByText('Personalizar Herói').click();
}

/** Confirms CharacterCreationScreen ("Começar Aventura"), entering the overworld for the very first time. */
export async function confirmCharacterCreation(page: Page): Promise<void> {
  await page.getByText('Começar Aventura').click();
}

/** Waits for OverworldScreen's HUD to be up — the canvas rendering plus the always-on HP/MP/gold panel. Generous timeout: this follows an async GLTF avatar load (see render/playerAvatar.ts). */
export async function waitForOverworld(page: Page): Promise<void> {
  await page.locator('.hud-panel').waitFor({ state: 'visible', timeout: 30_000 });
  await page.locator('#game-canvas').waitFor({ state: 'visible' });
}

// --- pause menu (also the mechanism this suite uses to read live position) -

export async function pauseGame(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.locator('.pause-overlay').waitFor({ state: 'visible' });
}

export async function resumeGame(page: Page): Promise<void> {
  await page.locator('.pause-overlay').getByText('Continuar Jogando').click();
  await page.locator('.pause-overlay').waitFor({ state: 'hidden' });
}

/**
 * Pauses (which the game itself saves on: see `togglePause` in
 * OverworldScreen.ts), reads the resulting save, then resumes — this is how
 * the suite observes live position/level/gold without any debug hook: the
 * pause menu is a real, always-available player action that happens to
 * trigger a save.
 */
export async function pauseSnapshot(page: Page, slot = 0): Promise<PlayerSaveData> {
  await pauseGame(page);
  const data = await readSave(page, slot);
  await resumeGame(page);
  return data;
}

/** Opens the pause menu's Inventário sub-screen. */
export async function openInventoryFromPause(page: Page): Promise<void> {
  await pauseGame(page);
  await page.locator('.pause-overlay').getByText('Inventário').click();
  await page.locator('.inventory-screen').waitFor({ state: 'visible' });
}

export async function backToAdventureFromInventory(page: Page): Promise<void> {
  await page.getByText('Voltar à Aventura').click();
  await waitForOverworld(page);
}

/** Holds a movement key for `ms` milliseconds, then releases it — one continuous input gesture (see OverworldScreen.computeInputAxis). */
export async function holdKey(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
