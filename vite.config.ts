import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Relative base so the build works on any static host or sub-path (e.g. GitHub Pages).
  base: './',
  plugins: [preact()],
  resolve: {
    // @doist/todoist-sdk lazy-loads undici only under Node; keep it out of the browser bundle.
    alias: { undici: fileURLToPath(new URL('./src/stubs/undici.ts', import.meta.url)) },
  },
});
