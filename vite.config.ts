import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Three.js core rarely changes between our own deploys — splitting it
        // into its own chunk means a deploy that only touches game code
        // doesn't invalidate the browser's cached vendor chunk. The
        // examples/jsm submodules are deliberately left out of this bucket:
        // grouping them in here would drag GLTFLoader (only needed once the
        // overworld loads) into the eagerly-loaded vendor chunk instead of
        // its own lazy one.
        manualChunks(id) {
          if (id.includes('node_modules/three/') && !id.includes('node_modules/three/examples/')) return 'vendor-three';
        },
      },
    },
  },
  test: {
    // Vitest's default exclude doesn't know about .claude/worktrees/ (used
    // for isolated parallel-agent checkouts) — without this, a worktree
    // sitting inside the repo tree gets its own copy of every *.test.ts
    // picked up too, double-counting (or worse, stale-counting) results.
    //
    // tests/e2e/**: the Playwright browser regression suite (see
    // playwright.config.ts) — its files are also named *.spec.ts (vitest's
    // own default include pattern), but they import `test`/`expect` from
    // `@playwright/test`, not vitest, and need a live browser + dev server.
    // Without this exclusion vitest would try (and fail) to run them itself.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.claude/**', 'tests/e2e/**'],
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Sede',
        short_name: 'Sede',
        description: 'Um RPG 3D de Ipêra, jogável no navegador e instalável como app.',
        start_url: '.',
        display: 'fullscreen',
        orientation: 'landscape',
        background_color: '#1a1423',
        theme_color: '#1a1423',
        icons: [
          {
            src: 'icons/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // glb models are intentionally NOT precached: fox.glb was small
        // enough not to matter, but the vendored character models
        // (public/models/characters/*.glb) are ~3.5MB each — several would
        // already blow past Workbox's 2MiB single-file precache limit
        // (a hard build error), and precaching all of them eagerly would
        // undo the whole point of loading them lazily per class. They're
        // still fetched fine at runtime (just not proactively cached at
        // install time); the browser's own HTTP cache covers repeat visits.
        globPatterns: ['**/*.{js,css,html,svg}'],
      },
    }),
  ],
});
