/**
 * Feature Catalogue — pure core.
 *
 * Parses the canonical catalogue source (docs/catalog/*.md — YAML frontmatter
 * + short prose bodies) and the roadmap glossary into the JSON graph served at
 * GET /catalog/data. No I/O in this file: routes read the files, this module
 * turns text into data. That keeps every rule unit-testable without a server.
 *
 * Deliberately dependency-free: the frontmatter contract (docs/catalog/README.md)
 * is a small, fixed subset of YAML — scalars, inline arrays, and `|` block
 * literals — so a full YAML parser would be surface area without benefit.
 */

export interface CatalogFeature {
  id: string;
  name: string;
  area: string;
  status: 'shipped' | 'beta' | 'planned';
  version: string;
  depends: string[];
  terms: string[];
  spec: string;
  wireframe?: string;
  /** User-facing journey (mermaid). */
  flow?: string;
  /** System architecture (mermaid) — real routes, modules and stores. */
  arch?: string;
  /**
   * Endpoints this feature exposes/consumes — one line each, authored as an
   * `api: |` block: "METHOD /path — purpose (callers · auth tier)".
   * HTTP lines are validated against the real Express routes by the drift
   * checker; omitted entirely for UX-only features (no filler).
   */
  api?: string[];
  body: string;
}

export interface CatalogArea {
  id: string;
  name: string;
  color: string;
  order: number;
  wireframe?: string;
  flow: string;
  body: string;
}

export interface CatalogTrail {
  id: string;
  name: string;
  blurb: string;
  steps: string[];
}

export interface GlossaryTerm { term: string; definition: string; section: string; }
export interface GlossaryAcronym { acronym: string; expansion: string; }

export interface CatalogData {
  platformVersion: string;
  generatedAt: string;
  areas: CatalogArea[];
  features: CatalogFeature[];
  /** Derived from `depends` — edge from prerequisite to dependant. */
  edges: { from: string; to: string }[];
  trails: CatalogTrail[];
  glossary: GlossaryTerm[];
  acronyms: GlossaryAcronym[];
}

export const CATALOG_AREAS = ['tags', 'gemba', 'guides', 'designer', 'iloto', 'portal', 'platform'] as const;
export const CATALOG_STATUSES = ['shipped', 'beta', 'planned'] as const;

// ── Frontmatter ──────────────────────────────────────────────────────────────

export interface ParsedDoc {
  fm: Record<string, string | string[]>;
  body: string;
}

/** Parse the fixed frontmatter subset: scalars, [inline, arrays], `|` blocks. */
export function parseFrontmatter(src: string): ParsedDoc | null {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const fm: Record<string, string | string[]> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^(\w+):\s*(.*)$/);
    if (!kv) continue; // indented continuation lines are consumed by their key
    const [, key, raw] = kv;
    if (raw === '|') {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s\s/.test(lines[i + 1]) || lines[i + 1] === '')) {
        block.push(lines[++i].replace(/^  /, ''));
      }
      fm[key] = block.join('\n').trimEnd();
    } else if (raw.startsWith('[') && raw.endsWith(']')) {
      fm[key] = raw.slice(1, -1).split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
    } else {
      fm[key] = raw.replace(/^"|"$/g, '');
    }
  }
  return { fm, body: m[2].trim() };
}

const str = (v: string | string[] | undefined): string => (typeof v === 'string' ? v : '');
const arr = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : []);

// ── Trails ───────────────────────────────────────────────────────────────────

/** trails.md uses one nested structure; parsed with a dedicated block scanner. */
export function parseTrails(src: string): CatalogTrail[] {
  const fmMatch = src.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return [];
  const trails: CatalogTrail[] = [];
  const blocks = fmMatch[1].split(/\n\s+- id:/).slice(1);
  for (const block of blocks) {
    const id = block.match(/^\s*([\w-]+)/)?.[1] ?? '';
    const name = block.match(/name:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? '';
    const blurb = block.match(/blurb:\s*"?([^"\n]+)"?/)?.[1]?.trim() ?? '';
    const stepsRaw = block.match(/steps:\s*\[([^\]]*)\]/)?.[1] ?? '';
    const steps = stepsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (id && steps.length) trails.push({ id, name, blurb, steps });
  }
  return trails;
}

// ── Glossary ─────────────────────────────────────────────────────────────────

/**
 * roadmap-glossary.md → term list. Terms are `- **Name** … — definition` bullets
 * grouped under `## Section` headings; acronyms live in the final table.
 */
export function parseGlossary(src: string): { terms: GlossaryTerm[]; acronyms: GlossaryAcronym[] } {
  const terms: GlossaryTerm[] = [];
  const acronyms: GlossaryAcronym[] = [];
  let section = '';
  for (const line of src.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) { section = h[1].trim(); continue; }
    const t = line.match(/^-\s+\*\*([^*]+)\*\*\s*(.*)$/);
    if (t) {
      // Strip status markers/emphasis from the leading part of the definition.
      const definition = t[2].replace(/^[✅🔄▢\s]*(\*[^*]+\*)?\s*[—–-]\s*/u, '').trim();
      terms.push({ term: t[1].trim(), definition, section });
      continue;
    }
    const a = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (a && a[1] !== 'Acronym' && !/^-+$/.test(a[1])) {
      acronyms.push({ acronym: a[1], expansion: a[2] });
    }
  }
  return { terms, acronyms };
}

/**
 * A feature `terms` entry matches a glossary term when the glossary name starts
 * with or contains it ("Tag" → "Tag / Spatial Tagging"), or it is an acronym.
 * Shared by /catalog/data (to attach definitions) and the drift checker.
 */
export function resolveTerm(
  term: string,
  glossary: GlossaryTerm[],
  acronyms: GlossaryAcronym[],
): GlossaryTerm | GlossaryAcronym | undefined {
  return (
    glossary.find(g => g.term === term) ??
    glossary.find(g => g.term.startsWith(term)) ??
    glossary.find(g => g.term.includes(term)) ??
    acronyms.find(a => a.acronym === term || a.acronym.split('/').map(s => s.trim()).includes(term))
  );
}

// ── Spec section extraction ──────────────────────────────────────────────────

/** GitHub-style heading slug: lowercase, punctuation stripped, spaces → "-".
 *  "AR Work Instructions (AR OMS)" → "ar-work-instructions-ar-oms". */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, '')            // markdown formatting chars
    .replace(/[^a-z0-9\s-]/g, '')     // punctuation, parens, slashes
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Extract one section of a markdown document by heading anchor — the heading
 * line whose slug matches, through to (not including) the next heading of the
 * same or higher level. Fenced code blocks are skipped so `# comments` inside
 * them can't match. Returns null when no heading matches, so callers can fall
 * back to the whole document rather than serving nothing.
 *
 * Powers `spec: ../README.md#3d-model-library` — features without a dedicated
 * deep-dive doc link to just their section of the README instead of all of it.
 */
export function extractSection(markdown: string, anchor: string): string | null {
  const lines = markdown.split('\n');
  const want = anchor.toLowerCase();
  let inFence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    if (start === -1) {
      if (slugifyHeading(m[2]) === want) { start = i; level = m[1].length; }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join('\n').trimEnd();
    }
  }
  return start === -1 ? null : lines.slice(start).join('\n').trimEnd();
}

// ── Catalogue graph ──────────────────────────────────────────────────────────

export class CatalogParseError extends Error {
  constructor(public file: string, message: string) {
    super(`${file}: ${message}`);
    this.name = 'CatalogParseError';
  }
}

/**
 * Build the full catalogue graph from raw file contents.
 * Throws CatalogParseError on structural problems — a broken catalogue should
 * fail loudly at the endpoint, not render half a graph.
 */
export function buildCatalog(
  files: { name: string; content: string }[],
  glossarySrc: string,
  platformVersion: string,
): CatalogData {
  const areas: CatalogArea[] = [];
  const features: CatalogFeature[] = [];
  let trails: CatalogTrail[] = [];

  for (const f of files) {
    if (f.name === 'README.md') continue;
    if (f.name === 'trails.md') { trails = parseTrails(f.content); continue; }
    const parsed = parseFrontmatter(f.content);
    if (!parsed) throw new CatalogParseError(f.name, 'missing frontmatter');
    const { fm, body } = parsed;
    if (str(fm.kind) === 'area') {
      areas.push({
        id: str(fm.id), name: str(fm.name), color: str(fm.color),
        order: Number(str(fm.order)) || 0,
        wireframe: str(fm.wireframe) || undefined,
        flow: str(fm.flow), body,
      });
    } else {
      const status = str(fm.status);
      if (!(CATALOG_STATUSES as readonly string[]).includes(status)) {
        throw new CatalogParseError(f.name, `invalid status "${status}"`);
      }
      if (!(CATALOG_AREAS as readonly string[]).includes(str(fm.area))) {
        throw new CatalogParseError(f.name, `invalid area "${str(fm.area)}"`);
      }
      features.push({
        id: str(fm.id), name: str(fm.name), area: str(fm.area),
        status: status as CatalogFeature['status'],
        version: str(fm.version), depends: arr(fm.depends), terms: arr(fm.terms),
        spec: str(fm.spec), wireframe: str(fm.wireframe) || undefined,
        flow: str(fm.flow) || undefined,
        arch: str(fm.arch) || undefined,
        api: str(fm.api)
          ? str(fm.api).split('\n').map(s => s.trim()).filter(Boolean)
          : undefined,
        body,
      });
    }
  }

  // Referential integrity — same rules as the drift checker.
  const ids = new Set(features.map(f => f.id));
  const dupes = features.map(f => f.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupes.length) throw new CatalogParseError(dupes[0], 'duplicate feature id');
  const edges: { from: string; to: string }[] = [];
  for (const f of features) {
    for (const dep of f.depends) {
      if (!ids.has(dep)) throw new CatalogParseError(f.id, `dangling depends → ${dep}`);
      edges.push({ from: dep, to: f.id });
    }
  }
  for (const t of trails) {
    for (const s of t.steps) {
      if (!ids.has(s)) throw new CatalogParseError(`trails.md (${t.id})`, `unknown step → ${s}`);
    }
  }

  const { terms, acronyms } = parseGlossary(glossarySrc);
  areas.sort((a, b) => a.order - b.order);
  features.sort((a, b) => a.id.localeCompare(b.id));

  return {
    platformVersion,
    generatedAt: new Date().toISOString(),
    areas, features, edges, trails,
    glossary: terms, acronyms,
  };
}
