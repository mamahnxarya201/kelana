import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
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
  build: { target: 'es2022', rollupOptions: { output: { manualChunks: { pdf: ['pdfjs-dist'] } } } },
});
