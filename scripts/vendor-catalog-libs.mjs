#!/usr/bin/env node
/**
 * Vendor the catalogue's two render libraries — `npm run catalog:vendor`
 *
 * Downloads mermaid + marked (exact pinned versions) into sib/portal/vendor/
 * so /catalog works on networks that block CDNs, and stops depending on
 * cdnjs being alive for the life of this platform. Run once on a machine
 * with open internet, commit the two files, done — catalog.html loads the
 * local copies first and only falls back to the CDN when they're absent.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const LIBS = [
  { name: 'mermaid.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js' },
  { name: 'marked.min.js',  url: 'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js' },
];

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sib/portal/vendor');
fs.mkdirSync(outDir, { recursive: true });

for (const lib of LIBS) {
  const dest = path.join(outDir, lib.name);
  process.stdout.write(`↓ ${lib.url} … `);
  const res = await fetch(lib.url);
  if (!res.ok) { console.error(`FAILED (HTTP ${res.status})`); process.exit(1); }
  const body = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, body);
  console.log(`${(body.length / 1024).toFixed(0)} KB → sib/portal/vendor/${lib.name}`);
}
console.log('✓ vendored — commit sib/portal/vendor/ so every deployment ships them.');
