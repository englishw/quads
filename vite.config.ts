import { defineConfig } from 'vitest/config';

// A relative base keeps the built app working from any GitHub Pages path,
// e.g. https://<user>.github.io/quads/ as well as from file:// or a subfolder.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
