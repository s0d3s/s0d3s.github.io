import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://s0d3s.github.io',
  base: '/',
  output: 'static',
  trailingSlash: 'always',
  prerenderConflictBehavior: 'error',
  compressHTML: true,
  build: {
    inlineStylesheets: 'always',
  },
});
