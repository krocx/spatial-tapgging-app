/**
 * Feature Catalogue routes — the docs-as-data surface.
 *
 * GET /catalog/data      → full JSON graph (areas, features, edges, trails,
 *                          glossary). This is also the AI-grounding endpoint:
 *                          anything that wants to "know the platform" reads
 *                          this, never the markdown directly.
 *                          ?format=json (default). ?format=toon is the reserved
 *                          seam for a token-lean serialization of the same
 *                          derived graph — implemented when a real AI consumer
 *                          exists, so no second format is ever hand-maintained.
 * GET /catalog/doc/:id   → the deep-dive spec markdown for a feature id
 *                          (resolved from its frontmatter `spec` field).
 *
 * No auth: read-only documentation, same access model as /wireframe and
 * /mindmap/glossary. Registered BEFORE apiKeyAuth in app.ts.
 */
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildCatalog, CatalogParseError, extractSection } from '../catalog/catalog-core.js';
import { PLATFORM_VERSION } from '../version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Deployments differ in cwd and layout (repo checkout vs Docker /app vs a
 * service launched from sib/) — same candidate-path pattern as /wireframe
 * and the roadmap glossary, first hit wins.
 */
function resolveDocsDir(): string | null {
  const candidates = [
    path.join(__dirname, '../../../docs'),  // repo: sib/dist/routes → docs/
    path.join(process.cwd(), 'docs'),       // Docker: cwd /app · repo-root launch
    path.join(process.cwd(), '../docs'),    // service launched from sib/
  ];
  return candidates.find(p => fs.existsSync(path.join(p, 'catalog'))) ?? null;
}

export function readCatalog() {
  const docsDir = resolveDocsDir();
  if (!docsDir) return null;
  const catalogDir = path.join(docsDir, 'catalog');
  const files = fs.readdirSync(catalogDir)
    .filter(f => f.endsWith('.md'))
    .map(name => ({ name, content: fs.readFileSync(path.join(catalogDir, name), 'utf8') }));
  const glossarySrc = fs.readFileSync(path.join(docsDir, 'roadmap-glossary.md'), 'utf8');
  return { docsDir, data: buildCatalog(files, glossarySrc, PLATFORM_VERSION) };
}

const router = Router();

// GET /catalog → the visual catalogue surface (single-file page, like /portal).
router.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../../portal/catalog.html'));
});

router.get('/data', (req, res) => {
  const format = String(req.query.format ?? 'json');
  if (format === 'toon') {
    // Reserved: TOON is a generated OUTPUT encoding of this same graph, never a
    // second authored source. Wire it up when the AI consumer that wants it exists.
    return res.status(501).json({
      error: 'format=toon is reserved but not yet implemented — use format=json',
    });
  }
  if (format !== 'json') {
    return res.status(400).json({ error: `Unknown format "${format}" — use json` });
  }
  try {
    const cat = readCatalog();
    if (!cat) return res.status(404).json({ error: 'Catalogue not available on this deployment' });
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.json(cat.data);
  } catch (err) {
    if (err instanceof CatalogParseError) {
      // A broken catalogue fails loudly with the offending file named —
      // half a graph would hide exactly the drift this system exists to catch.
      return res.status(500).json({ error: `Catalogue source invalid — ${err.message}` });
    }
    throw err;
  }
});

router.get('/doc/:id', (req, res) => {
  const cat = readCatalog();
  if (!cat) return res.status(404).json({ error: 'Catalogue not available on this deployment' });
  const feature = cat.data.features.find(f => f.id === req.params.id);
  if (!feature) return res.status(404).json({ error: `Unknown feature id "${req.params.id}"` });

  // spec paths are relative to docs/ ("../README.md" reaches the repo root
  // README and nothing beyond it — resolved paths must stay inside the repo).
  // An optional #anchor selects one heading's section instead of the whole
  // file ("../README.md#3d-model-library") — used by features whose source of
  // truth is a README section rather than a dedicated deep-dive doc.
  const [specPath, anchor] = feature.spec.split('#');
  const repoRoot = path.resolve(cat.docsDir, '..');
  const resolved = path.resolve(cat.docsDir, specPath);
  if (!resolved.startsWith(repoRoot)) {
    return res.status(400).json({ error: 'Spec path escapes the repository' });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: `Spec file not found on this deployment: ${specPath}` });
  }
  const full = fs.readFileSync(resolved, 'utf8');
  // Anchor miss falls back to the full document — a renamed heading should
  // degrade to "too much spec", never to an error (the drift checker catches
  // the rename at CI time anyway).
  const markdown = anchor ? (extractSection(full, anchor) ?? full) : full;
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res.json({
    id: feature.id,
    spec: feature.spec,
    markdown,
  });
});

export default router;
