import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node18',
  outDir: 'build',
  banner: { js: '#!/usr/bin/env node' },
  bundle: true,
  external: ['commander', 'openapi-fetch'],
  clean: true,
  splitting: false,
  sourcemap: false,
  minify: false,
  platform: 'node',
});
