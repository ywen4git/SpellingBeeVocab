/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/SpellingBeeVocab/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Bee Vocab Builder',
        short_name: 'BeeVocab',
        description: 'Turn NYT Spelling Bee answer screenshots into flashcards.',
        start_url: '/SpellingBeeVocab/',
        scope: '/SpellingBeeVocab/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#faf8f5',
        theme_color: '#f59e0b',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the whole shell INCLUDING the self-hosted tesseract worker/WASM/
        // traineddata so OCR works fully offline after first load. This adds ~54 MB to the
        // precache (tesseract.js-core currently ships every WASM variant, most unused at
        // runtime — pruning this to only the LSTM cores actually loaded is a tracked
        // fast-follow); acceptable for a personal tool in the meantime.
        globPatterns: ['**/*.{js,css,html,png,svg,wasm,gz}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
    globals: true,
  },
});
