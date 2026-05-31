import { defineConfig } from 'vite';
import fs from 'fs';

export default defineConfig({
  plugins: [],
  server: {
    host: true,   // expose on LAN so iPhone can reach the dev server
    port: 5173,
    https: {
      key:  fs.readFileSync('./localhost+1-key.pem'),
      cert: fs.readFileSync('./localhost+1.pem'),
    },
    // Proxy SIB routes through Vite so the iPhone only needs one HTTPS
    // connection — avoids mixed-content errors entirely.
    proxy: {
      '/anchors':    'http://localhost:3001',
      '/tags':       'http://localhost:3001',
      '/sessions':   'http://localhost:3001',
      '/perception': 'http://localhost:3001',
      '/health':     'http://localhost:3001',
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
