import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import pkg from './package.json';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  define: { __KELANA_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Kelana',
        short_name: 'Kelana',
        description: 'A local thinking space',
        theme_color: '#F6F5F2',
        background_color: '#F7F6F3',
        display: 'standalone',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,woff2,wasm,bin,bcmap,pfb,ttf,otf}'],
        maximumFileSizeToCacheInBytes: 8000000,
      },
    }),
  ],
  // The container worker lazily imports the sqlite wasm, so it must build as
  // ES (Vite's worker default is iife, which cannot code-split). The package
  // stays out of dep optimization in dev so its `new URL('sqlite3.wasm',
  // import.meta.url)` still resolves inside node_modules instead of the
  // pre-bundle, where the binary does not exist.
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  build: { target: 'es2022', rollupOptions: { output: { manualChunks: { pdf: ['pdfjs-dist'] } } } },
});
