import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Production-only: the dev server needs an inline React-refresh preamble that this policy would block.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const productionCsp = (): Plugin => ({
  name: 'notbot-production-csp',
  apply: 'build',
  transformIndexHtml: () => [
    { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: csp }, injectTo: 'head-prepend' },
  ],
});

export default defineConfig({
  main: {},
  preload: {},
  renderer: { root: 'src/renderer', plugins: [react(), productionCsp()] },
});
