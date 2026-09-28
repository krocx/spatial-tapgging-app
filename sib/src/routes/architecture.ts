/**
 * Architecture routes - /architecture, the code architecture beneath the
 * Feature Catalogue (C4 levels 1 to 4).
 *
 * GET /architecture       → the page (sib/portal/architecture.html, brand system)
 * GET /architecture/data  → docs/ARCHITECTURE.md split into sections (title,
 *                           prose markdown, mermaid source) plus the generated
 *                           level-4 graphs from docs/architecture/. Restricted:
 *                           the whole document is IP-sensitive, so it needs the
 *                           IP key (same header / cookie as restricted catalogue
 *                           features). Without it: 403, never a redacted copy.
 *
 * Content gate applies as everywhere else; this adds the IP key on top.
 */
import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { canViewRestricted } from '../middleware/auth.js';
import { PLATFORM_VERSION } from '../version.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveDocsDir(): string | null {
  const candidates = [
    path.join(__dirname, '../../../docs'),
    path.join(process.cwd(), 'docs'),
    path.join(process.cwd(), '../docs'),
  ];
  return candidates.find(p => fs.existsSync(path.join(p, 'ARCHITECTURE.md'))) ?? null;
}

export interface ArchSection { id: string; title: string; md: string; mermaid: string | null }

/** Split the markdown on `## ` headings; the first fenced mermaid block in a
 *  section is its diagram, the rest is prose. Exported for the test. */
export function splitArchitecture(src: string): { intro: string; sections: ArchSection[] } {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const sections: ArchSection[] = [];
  let intro: string[] = [];
  let cur: { title: string; body: string[] } | null = null;
  const flush = () => {
    if (!cur) return;
    const body = cur.body.join('\n');
    const m = body.match(/```mermaid\n([\s\S]*?)```/);
    const md = m ? body.replace(m[0], '').trim() : body.trim();
    const id = cur.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    sections.push({ id, title: cur.title, md, mermaid: m ? m[1].trim() : null });
  };
  for (const line of lines) {
    if (line.startsWith('## ')) { flush(); cur = { title: line.slice(3).trim(), body: [] }; continue; }
    if (line.startsWith('# ')) continue;
    if (cur) cur.body.push(line); else intro.push(line);
  }
  flush();
  return { intro: intro.join('\n').trim(), sections };
}

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../../portal/architecture.html'));
});

router.get('/data', (req: Request, res: Response) => {
  if (!canViewRestricted(req)) return res.status(403).json({ error: 'restricted', hint: 'Architecture needs the IP key' });
  const docsDir = resolveDocsDir();
  if (!docsDir) return res.status(404).json({ error: 'docs/ARCHITECTURE.md is not on this deployment - check the Docker COPY list / the checkout' });
  const src = fs.readFileSync(path.join(docsDir, 'ARCHITECTURE.md'), 'utf8');
  const { intro, sections } = splitArchitecture(src);
  const gen = path.join(docsDir, 'architecture');
  const read = (n: string) => fs.existsSync(path.join(gen, n)) ? fs.readFileSync(path.join(gen, n), 'utf8') : null;
  const depsRaw = read('deps.json');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.json({
    version: PLATFORM_VERSION,
    intro, sections,
    generated: {
      sib: read('deps-sib.mmd'),
      app: read('deps-app.mmd'),
      deps: depsRaw ? JSON.parse(depsRaw) : null,
    },
  });
});

export default router;
