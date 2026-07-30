// vite.config.ts — Roadmap Mind-Mapper client.
// Build output goes straight to sib/roadmap/, which app.ts serves at /roadmap
// (same static-serving model as sib/portal). `npm run dev` proxies API + WS
// to a locally running SIB on :3001.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/roadmap/',
  build: {
    outDir: '../roadmap',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5174,
    proxy: {
      '/mindmap': { target: 'http://localhost:3001', ws: true },
      '/config': { target: 'http://localhost:3001' },
    },
  },
});
