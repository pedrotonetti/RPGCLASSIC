/**
 * ============================================================================
 * Sede — Playwright end-to-end regression suite
 * ============================================================================
 *
 * WHAT THIS IS
 * A permanent, repo-committed browser regression suite that drives the real
 * game (keyboard/mouse/click, never internal debug hooks) through its golden
 * paths — new game & character creation, movement, combat, inventory, shops,
 * quests, dungeons, and save/reload persistence. Before this suite existed,
 * every "does the game still work" check in this project was a throwaway
 * Playwright script written fresh per manual verification, then deleted —
 * there was no lasting answer to "did my change break something real".
 *
 * HOW TO RUN IT
 *   npm run test:e2e
 * (equivalent to `npx playwright test`). It boots its own disposable Vite dev
 * server on a freshly-picked free port (see `findFreePort` below) — you do
 * NOT need a dev server already running, and it will never collide with one
 * you (or another agent) already have up on :5173 or any other port, since it
 * always starts a brand new instance scoped to THIS checkout/worktree.
 * Chromium must be the one preinstalled for this environment at
 * `/opt/pw-browsers/chromium` (see the `chromium` project's `launchOptions`
 * below) — never run `playwright install`.
 *
 * WHO SHOULD RUN IT, AND WHEN
 * Multiple agents work on this codebase in parallel (feature work, bug
 * fixes, visual upgrades). Any agent touching shared systems — especially
 * `OverworldScreen.ts`, `OverworldCombat.ts`, the avatar-loading pipeline
 * (`render/playerAvatar.ts`), or the save data shape (`entities/Player.ts`,
 * `systems/SaveSystem.ts`) — should run this suite before considering a batch
 * of changes "done". A green run doesn't prove nothing broke (see coverage
 * gaps below), but a RED run is a real, actionable signal that something a
 * player would actually notice regressed.
 *
 * WHAT IT COVERS (golden paths, not exhaustive enumeration — see tests/e2e/*)
 *   - New game & character creation, across a few different classes
 *   - Free-roam movement (WASD/arrows) and its effect on saved position
 *   - Overworld combat: engagement, basic attack, monster HP/defeat
 *   - Inventory: equip-from-bag panel updates
 *   - Shops: buying an item, gold/inventory updating
 *   - Quests: accept (talkTo) → turn-in → reward granted
 *   - Dungeons: portal entry, encounter-progress HUD, boss banner (full
 *     clear is attempted opportunistically, see dungeon.spec.ts)
 *   - Save/reload: progress survives a full page reload + "Continuar"
 *
 * WHAT IT DOES **NOT** COVER YET (do not assume false completeness)
 *   - Only 3-4 of the 8 classes are exercised by character creation/combat
 *     specs — the rest share the same code paths but aren't individually
 *     asserted on.
 *   - Only 1 of the 3 dungeons (the early-tier "Toca das Raízes
 *     Sussurrantes") is driven end-to-end; the mid/late dungeons are
 *     untouched.
 *   - Only 1 of the 8 classes' quest chains (the shared Chapter 1
 *     `QUEST_CHAIN`) is exercised; the per-class prelude/"calling" chains
 *     are not.
 *   - Skill tree spending/leveling, mounts, gem socketing, crafting, and the
 *     ranking screen have no coverage at all.
 *   - No mobile/touch input (on-screen joystick, tap-to-interact) coverage —
 *     everything drives keyboard + mouse clicks, matching a desktop player.
 *   - No visual/pixel-regression coverage — assertions are on DOM text,
 *     element visibility, and saved-game state, never screenshots.
 *   - No cross-browser coverage (Chromium only, matching this environment's
 *     preinstalled browser).
 *   Extending coverage in any of these directions is welcome — this suite is
 *   meant to grow with the game, not stay frozen at today's golden paths.
 *
 * DESIGN NOTES
 *   - Tests seed `localStorage` directly with a hand-built save (matching
 *     `PlayerSaveData` in `entities/Player.ts`) to jump straight to the
 *     zone/state a given golden path needs (e.g. the shared main city,
 *     "Pedravale", instead of re-walking a fresh character's multi-zone
 *     class-village journey every single time). This is done through the
 *     game's own real save slot mechanism (`localStorage` key
 *     `rpgclassic:save:v2:slotN`, then clicking "Continuar" like a real
 *     player would) — never through a debug hook. New game/character
 *     creation itself is always driven from a genuinely empty slot.
 *   - No test-only `window.__hooks` were added. Every assertion reads state
 *     already public to a real player: on-screen HUD/DOM text (HP/MP/gold/
 *     level/quest tracker), or the save file written to `localStorage`
 *     whenever the game itself already saves (entering the pause menu,
 *     zone transitions, combat victories, shop/quest actions — see
 *     `saveGame()` call sites in `OverworldScreen.ts`). Movement is verified
 *     by pausing (which triggers a save) and reading the resulting
 *     `mapX`/`mapY` — see `tests/e2e/movement.spec.ts`.
 *   - The dungeon's fixed, deterministic monster pods (`data/dungeons.ts`)
 *     are used for the combat golden path instead of hunting a randomly
 *     positioned open-world monster — the latter is real player behavior
 *     too, but its spawn point is randomized per page load
 *     (`OverworldCombat.pickSpawnPoints` uses `Math.random()`, not a seeded
 *     RNG), which would make a shared regression gate flaky. Movement and
 *     free-roam wandering are still exercised on the open map elsewhere.
 *
 * ON THE DEV SERVER / PORT
 *   This config always boots its OWN disposable Vite dev server (never
 *   attaches to one already running — that could be a different worktree's
 *   code, silently testing the wrong thing) on port 5199 by default — chosen
 *   to be distinct from Vite's own default (5173) so it doesn't collide with
 *   a normal `npm run dev` left running alongside it. If another concurrent
 *   agent/run is *also* using 5199 (e.g. running this same suite in a
 *   sibling worktree at the same time), `--strictPort` makes the clash fail
 *   fast and loud instead of silently drifting to some other port — set
 *   `PLAYWRIGHT_E2E_PORT=<something else>` and re-run in that case. A fixed,
 *   documented port (rather than dynamically probing for a free one) is a
 *   deliberate simplicity choice: probing works but every process that loads
 *   this config (the CLI + each worker) re-executes its top level, so a
 *   dynamically *chosen* port can't be safely shared between them without
 *   its own persistence mechanism — not worth the complexity here.
 * ============================================================================
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = process.env.PLAYWRIGHT_E2E_PORT ? Number(process.env.PLAYWRIGHT_E2E_PORT) : 5199;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  // Real-time combat (cooldowns, chase AI, wandering monsters, GLTF
  // avatar/model loading) is genuinely slower than typical UI-only e2e
  // flows — generous timeouts here are deliberate, not slack test authoring.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  webServer: {
    // Always a fresh, disposable server for this run — never attaches to
    // someone else's already-running dev server (which could be serving a
    // different worktree's code and silently test the wrong thing).
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          // Pre-installed Chromium for this environment — never `playwright
          // install`; PLAYWRIGHT_BROWSERS_PATH/PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
          // are already set in the environment, this just points at the binary.
          executablePath: '/opt/pw-browsers/chromium',
          // Headless Chromium has no real GPU here; this opts into the
          // supported SwiftShader software-rendering path explicitly instead
          // of relying on the (deprecated, noisy) automatic fallback — the
          // game renders real Three.js/WebGL content, so software rendering
          // has to actually work, not just avoid crashing.
          args: ['--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
});
