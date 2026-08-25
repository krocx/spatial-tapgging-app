#!/usr/bin/env node
/**
 * Vendor the portal's third-party browser libraries — `npm run catalog:vendor`
 *
 * Downloads exact pinned versions into sib/portal/vendor/ so the pages work
 * on networks that block CDNs and stop depending on cdnjs/unpkg being alive
 * (or uncompromised — the portal holds an API key) for the life of this
 * platform. Run once on a machine with open internet, commit the files,
 * done — catalog.html and the portal's Three.js import map load the local
 * copies first and only fall back to the CDN when they're absent.
 *
 *   mermaid + marked → /catalog renderers
 *   three r169       → portal 3D preview + browser GLB→USDZ converter
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const THREE = 'https://unpkg.com/three@0.169.0';
const LIBS = [
  // Catalogue renderers
  { name: 'mermaid.min.js', url: 'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js' },
  { name: 'marked.min.js',  url: 'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js' },
  // Three.js r169 — the portal's GLB→USDZ converter + 3D preview. Directory
  // structure mirrors the package so the addons' relative imports
  // ('../libs/fflate.module.js', '../utils/BufferGeometryUtils.js') resolve.
  { name: 'three/three.module.js',                  url: `${THREE}/build/three.module.js` },
  { name: 'three/addons/loaders/GLTFLoader.js',     url: `${THREE}/examples/jsm/loaders/GLTFLoader.js` },
  { name: 'three/addons/exporters/USDZExporter.js', url: `${THREE}/examples/jsm/exporters/USDZExporter.js` },
  { name: 'three/addons/controls/OrbitControls.js', url: `${THREE}/examples/jsm/controls/OrbitControls.js` },
  { name: 'three/addons/utils/BufferGeometryUtils.js', url: `${THREE}/examples/jsm/utils/BufferGeometryUtils.js` }, // ← GLTFLoader dep
  { name: 'three/addons/utils/TextureUtils.js',     url: `${THREE}/examples/jsm/utils/TextureUtils.js` },          // ← USDZExporter dep
  { name: 'three/addons/libs/fflate.module.js',     url: `${THREE}/examples/jsm/libs/fflate.module.js` },          // ← USDZExporter dep
];

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sib/portal/vendor');
fs.mkdirSync(outDir, { recursive: true });

for (const lib of LIBS) {
  const dest = path.join(outDir, lib.name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });   // three/ has nested addon dirs
  process.stdout.write(`↓ ${lib.url} … `);
  const res = await fetch(lib.url);
  if (!res.ok) { console.error(`FAILED (HTTP ${res.status})`); process.exit(1); }
  const body = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, body);
  console.log(`${(body.length / 1024).toFixed(0)} KB → sib/portal/vendor/${lib.name}`);
}
console.log('✓ vendored — commit sib/portal/vendor/ so every deployment ships them.');
