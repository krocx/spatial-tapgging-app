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
const { buildCatalog, resolveTerm, extractSection, CatalogParseError } =
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

// ── Real route inventory (for api: line validation) ──────────────────────────
// Extracted from the Express source itself so a listed endpoint that doesn't
// exist — or gets renamed — fails here instead of misleading a developer.
// Normalisation: params become ":*" so ":id" vs ":anchorId" both match.
const normalizeRoute = (p) => ('/' + p).replace(/\/{2,}/g, '/').replace(/\/$/, '')
  .replace(/:[A-Za-z0-9_]+/g, ':*') || '/';
function extractRoutes() {
  const srcDir = path.join(repo, 'sib/src');
  const appSrc = fs.readFileSync(path.join(srcDir, 'app.ts'), 'utf8');
  const routes = new Set();
  // Direct app-level routes (app.get('/stats') …)
  for (const m of appSrc.matchAll(/app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
    routes.add(m[1].toUpperCase() + ' ' + normalizeRoute(m[2]));
  }
  // Mounted routers: default import name → file, then router.<method>(path)
  const importFile = {};
  for (const m of appSrc.matchAll(/import\s+(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+['"]\.\/(routes\/[\w.-]+)\.js['"]/g)) {
    importFile[m[1]] = m[2];
  }
  for (const m of appSrc.matchAll(/app\.use\(\s*['"]([^'"]+)['"]\s*,\s*(\w+)\s*\)/g)) {
    const [, prefix, ident] = m;
    const rel = importFile[ident];
    if (!rel) continue;   // static middleware etc.
    const src = fs.readFileSync(path.join(srcDir, rel + '.ts'), 'utf8');
    for (const r of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) {
      routes.add(r[1].toUpperCase() + ' ' + normalizeRoute(prefix + '/' + r[2]));
    }
  }
  return routes;
}
const ROUTES = extractRoutes();
if (ROUTES.size < 30) errs.push(`route extractor found only ${ROUTES.size} routes — extraction regex likely broken`);

// ── Filesystem + glossary rules ──────────────────────────────────────────────
for (const f of data.features) {
  for (const t of f.terms) {
    if (!resolveTerm(t, data.glossary, data.acronyms)) {
      errs.push(`${f.id}: term "${t}" not found in docs/roadmap-glossary.md`);
    }
  }
  if (!f.spec) errs.push(`${f.id}: missing spec`);
  else {
    // spec may carry a #anchor selecting one heading's section of the file
    // ("../README.md#3d-model-library"). Validate both parts: the file must
    // exist AND the anchor must resolve to a real heading — a renamed README
    // heading silently degrades the card to full-file at runtime, so it must
    // fail loudly here instead.
    const [specPath, anchor] = f.spec.split('#');
    const resolved = path.resolve(docsDir, specPath);
    if (!fs.existsSync(resolved)) {
      errs.push(`${f.id}: spec file not found — ${specPath}`);
    } else if (anchor && extractSection(fs.readFileSync(resolved, 'utf8'), anchor) === null) {
      errs.push(`${f.id}: spec anchor "#${anchor}" matches no heading in ${specPath}`);
    }
  }
  if (f.wireframe && !WIREFRAME_FLOWS.has(f.wireframe)) {
    errs.push(`${f.id}: unknown wireframe flow "${f.wireframe}"`);
  }
  // api: lines — "METHOD /path — purpose (caller · auth tier)". HTTP lines are
  // checked against the extracted Express routes; WS lines are format-only.
  for (const line of f.api ?? []) {
    const m = /^(GET|POST|PUT|PATCH|DELETE|WS)\s+(\S+)\s+(?:—|-)\s+.*\(.+·.+\)$/.exec(line);
    if (!m) {
      errs.push(`${f.id}: api line malformed — "${line}" (want "METHOD /path — purpose (caller · auth)")`);
      continue;
    }
    if (m[1] === 'WS') continue;
    const wanted = m[1] + ' ' + normalizeRoute(m[2].split('?')[0]);
    if (!ROUTES.has(wanted)) {
      errs.push(`${f.id}: api endpoint not found in sib/src — "${m[1]} ${m[2]}"`);
    }
  }
  if (f.body.length < 80) errs.push(`${f.id}: body is a stub (${f.body.length} chars) — say what it does`);
  if (f.arch && !/^(sequenceDiagram|flowchart)/m.test(f.arch)) {
    errs.push(`${f.id}: arch is not a mermaid sequenceDiagram/flowchart`);
  }
  // Mermaid treats ';' as a statement separator — an unquoted semicolon in any
  // diagram line is a guaranteed "Syntax error in text" at render time.
  // (Real incident: "ARKit relocalizes; fresh map only as last resort".)
  for (const [kind, code] of [['flow', f.flow], ['arch', f.arch]]) {
    if (!code) continue;
    for (const line of code.split('\n')) {
      if (line.replace(/"[^"]*"/g, '').includes(';')) {
        errs.push(`${f.id}: unquoted ';' breaks mermaid in ${kind}: "${line.trim()}"`);
      }
    }
  }
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
