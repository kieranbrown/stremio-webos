import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

// LG G2 (webOS 22) ships a Chromium 87-based web engine.
export default defineConfig({
  base: './',
  plugins: [solid()],
  build: { target: 'chrome87', outDir: 'dist', assetsInlineLimit: 0 },
});
