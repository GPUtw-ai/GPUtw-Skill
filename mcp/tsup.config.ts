import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { stdio: 'src/stdio.ts' },
  format: ['esm'],
  outExtension: () => ({ js: '.mjs' }),
  target: 'node18',
  clean: true,
  // Bundle every dependency into one file so the published plugin runs with plain `node`
  // from a git clone - no npm install, no node_modules beside it.
  noExternal: [/.*/],
  minify: false,
  banner: { js: '#!/usr/bin/env node' },
});
