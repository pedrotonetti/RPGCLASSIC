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
    exclude: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.claude/**'],
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'RPG Classic',
        short_name: 'RPG Classic',
        description: 'Um RPG 2D jogável no navegador e instalável como app.',
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
        globPatterns: ['**/*.{js,css,html,svg,glb}'],
      },
    }),
  ],
});
