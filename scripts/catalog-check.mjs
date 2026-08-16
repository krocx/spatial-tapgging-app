#!/usr/bin/env node
/**
 * Feature Catalogue drift checker — `npm run catalog:check`
 *
 * Validates docs/catalog/ against the SAME rules the /catalog/data endpoint
 * enforces, by importing the compiled catalog core (sib/dist) — the rules live
 * in exactly one place. On top of buildCatalog()'s structural checks
 * (duplicate ids, dangling depends, invalid status/area, unknown trail steps)
 * this adds the filesystem checks the endpoint defers:
 *
 *   · every `terms` entry resolves against docs/roadmap-glossary.md
 *   · every `spec` file exists
 *   · every `wireframe` key is a real App Wireframe flow tab
 *   · bodies aren't empty stubs
 *
 * Exit code 1 on any finding — wire into CI or run before pushing a feature.
 * Requires a build first (`npm run build --workspace=@spatial/sib`).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const corePath = path.join(repo, 'sib/dist/catalog/catalog-core.js');
if (!fs.existsSync(corePath)) {
  console.error('sib/dist not found — run `npm run build --workspace=@spatial/sib` first.');
  process.exit(1);
}
const { buildCatalog, resolveTerm, CatalogParseError } =
  await import(pathToUrl(corePath));

function pathToUrl(p) { return new URL('file://' + p.replace(/\\/g, '/')).href; }

const docsDir = path.join(repo, 'docs');
const catalogDir = path.join(docsDir, 'catalog');
const WIREFRAME_FLOWS = new Set(['author', 'operator', 'arguides', 'gemba', 'iloto', 'procdes', 'portal']);
const errs = [];

// ── Structural rules (shared with the endpoint) ──────────────────────────────
let data;
try {
  const files = fs.readdirSync(catalogDir)
    .filter(f => f.endsWith('.md'))
    .map(name => ({ name, content: fs.readFileSync(path.join(catalogDir, name), 'utf8') }));
  const glossarySrc = fs.readFileSync(path.join(docsDir, 'roadmap-glossary.md'), 'utf8');
  data = buildCatalog(files, glossarySrc, 'check');
} catch (err) {
  if (err instanceof CatalogParseError) { console.error('✗ ' + err.message); process.exit(1); }
  throw err;
}

// ── Filesystem + glossary rules ──────────────────────────────────────────────
for (const f of data.features) {
  for (const t of f.terms) {
    if (!resolveTerm(t, data.glossary, data.acronyms)) {
      errs.push(`${f.id}: term "${t}" not found in docs/roadmap-glossary.md`);
    }
  }
  if (!f.spec) errs.push(`${f.id}: missing spec`);
  else if (!fs.existsSync(path.resolve(docsDir, f.spec))) {
    errs.push(`${f.id}: spec file not found — ${f.spec}`);
  }
  if (f.wireframe && !WIREFRAME_FLOWS.has(f.wireframe)) {
    errs.push(`${f.id}: unknown wireframe flow "${f.wireframe}"`);
  }
  if (f.body.length < 80) errs.push(`${f.id}: body is a stub (${f.body.length} chars) — say what it does`);
}
for (const a of data.areas) {
  if (!/flowchart/.test(a.flow)) errs.push(`area ${a.id}: flow is not a mermaid flowchart`);
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log(`catalogue: ${data.features.length} features · ${data.areas.length} areas · ` +
  `${data.edges.length} edges · ${data.trails.length} trails · ${data.glossary.length} glossary terms`);
if (errs.length) {
  console.error(`\n✗ ${errs.length} finding(s):`);
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}
console.log('✓ no drift — catalogue is internally consistent');
