// vite.config.ts - SIB on G2 (Even Realities companion).
// Build output goes to sib/portal/g2/, which app.ts serves at /g2 (same
// model as the Designer). `npm run dev --workspace=@spatial/g2-client` runs
// on :5175 for `evenhub qr --url http://<mac-ip>:5175` (docs/ar-ojt/EVEN-G2.md).
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/g2/',
  build: { outDir: '../portal/g2', emptyOutDir: true, sourcemap: false, target: 'es2022' },
  server: { port: 5175, host: true },
});
