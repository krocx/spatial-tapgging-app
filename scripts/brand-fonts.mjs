#!/usr/bin/env node
// brand-fonts.mjs — vendor Open Sans (the company's standard web font) into
// sib/portal/brand/fonts/ so every SIB surface renders it with no internet —
// the LAN server never fetches a font. Source: the fontsource build of
// Google's Open Sans (OFL-1.1), latin subset, four weights. Run once on a
// machine with internet, commit the files:
//
//   npm run brand:fonts
//
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR  = join(ROOT, 'sib/portal/brand/fonts');
const BASE = 'https://cdn.jsdelivr.net/npm/@fontsource/open-sans@5.0.28/files/';
const FILES = [
  'open-sans-latin-400-normal.woff2',
  'open-sans-latin-500-normal.woff2',
  'open-sans-latin-600-normal.woff2',
  'open-sans-latin-700-normal.woff2',
  'open-sans-latin-400-italic.woff2',
];

mkdirSync(DIR, { recursive: true });
let ok = 0;
for (const f of FILES) {
  const dest = join(DIR, f);
  if (existsSync(dest)) { console.log(`  = ${f} (present)`); ok++; continue; }
  try {
    const r = await fetch(BASE + f);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    console.log(`  + ${f}`); ok++;
  } catch (e) { console.error(`  ✗ ${f}: ${e.message}`); }
}
console.log(ok === FILES.length ? '✓ Open Sans vendored — commit sib/portal/brand/fonts/' : `✗ ${FILES.length - ok} file(s) missing`);
process.exit(ok === FILES.length ? 0 : 1);
