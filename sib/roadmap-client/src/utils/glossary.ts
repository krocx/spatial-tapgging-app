// glossary.ts — parses docs/roadmap-glossary.md into structured entries and
// fuzzy-matches roadmap nodes against them. No markdown library: the parser
// handles exactly the shapes the glossary uses (## sections, "- **Term** …"
// entries, the acronym table) and degrades gracefully on anything else.

export interface GlossaryEntry {
  term: string;
  /** Normalized alias strings used for matching (split on "/", parentheses). */
  aliases: string[];
  /** Definition with inline markdown intact (renderer handles ** and *). */
  definition: string;
  section: string;
}

export interface GlossaryData {
  sections: { title: string; entries: GlossaryEntry[] }[];
  entries: GlossaryEntry[];
}

const norm = (s: string) =>
  s.toLowerCase()
    .replace(/[—–]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "AR Work Instructions / AR Guides (AR OMS)" → the individual name variants. */
function aliasesOf(term: string): string[] {
  const out = new Set<string>();
  // Pull parenthesized variants out, then split remaining on "/" and "—".
  const parens = [...term.matchAll(/\(([^)]+)\)/g)].map(m => m[1]);
  const base = term.replace(/\([^)]*\)/g, ' ');
  for (const part of [...base.split(/[/—]/), ...parens]) {
    const n = norm(part);
    if (n) out.add(n);
  }
  // Union alias: the whole term as one token bag, so compound node names
  // like "MES/iOMS Bridge" can match across the split variants.
  const whole = norm(term);
  if (whole) out.add(whole);
  return [...out];
}

export function parseGlossary(markdown: string): GlossaryData {
  const sections: GlossaryData['sections'] = [];
  let current: { title: string; entries: GlossaryEntry[] } | null = null;
  let inAcronymTable = false;

  // Normalize before parsing: strip BOM and carriage returns. Windows git
  // checkouts serve the file with CRLF, and `\r` is a line terminator in JS
  // regex — leaving it in makes every `.+$` pattern fail silently.
  const normalized = markdown.replace(/^﻿/, '').replace(/\r/g, '');

  for (const line of normalized.split('\n')) {
    const heading = /^##\s+(.+)$/.exec(line);
    if (heading) {
      current = { title: heading[1].trim(), entries: [] };
      sections.push(current);
      inAcronymTable = current.title.toLowerCase().includes('acronym');
      continue;
    }
    if (!current) continue;

    // Entry bullets: "- **Term** ✅ *milestone* — definition"
    const entry = /^-\s+\*\*(.+?)\*\*\s*(.*)$/.exec(line);
    if (entry) {
      const term = entry[1].trim();
      // Everything after the em-dash is the definition; before it live the
      // status marker / milestone italics, which the renderer shows as-is.
      const rest = entry[2];
      const dashAt = rest.indexOf('—');
      const definition = (dashAt >= 0 ? rest.slice(dashAt + 1) : rest).trim();
      const prefix = dashAt >= 0 ? rest.slice(0, dashAt).trim() : '';
      current.entries.push({
        term: prefix ? `${term} ${prefix}` : term,
        aliases: aliasesOf(term),
        definition,
        section: current.title,
      });
      continue;
    }

    // Acronym table rows: "| SIB | Spatial Intelligence Backend |"
    if (inAcronymTable) {
      const row = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/.exec(line);
      if (row && row[1] !== 'Acronym' && !/^-+$/.test(row[1].replace(/[\s:]/g, ''))) {
        current.entries.push({
          term: row[1].trim(),
          aliases: aliasesOf(row[1]),
          definition: row[2].trim(),
          section: current.title,
        });
      }
    }
  }

  const entries = sections.flatMap(s => s.entries);
  return { sections: sections.filter(s => s.entries.length > 0), entries };
}

/**
 * Match a node's text to a glossary entry. Scoring: for each alias, the share
 * of the node's tokens that prefix-match an alias token (so "dyn" hits
 * "dynamic", "anchor" hits "anchoring"). Best score ≥ 0.6 wins; ties broken
 * by longer alias (more specific).
 */
export function matchGlossary(nodeText: string, data: GlossaryData): GlossaryEntry | null {
  const tokens = norm(nodeText).split(' ').filter(t => t.length > 1);
  if (tokens.length === 0) return null;

  let best: { entry: GlossaryEntry; score: number; aliasLen: number } | null = null;
  for (const entry of data.entries) {
    for (const alias of entry.aliases) {
      const aliasTokens = alias.split(' ');
      let hits = 0;
      let longestHit = 0;
      for (const t of tokens) {
        if (aliasTokens.some(a => a.startsWith(t) || t.startsWith(a))) {
          hits++;
          longestHit = Math.max(longestHit, t.length);
        }
      }
      const score = hits / tokens.length;
      // Accept a clear majority match, or an even split anchored by a
      // distinctive long token ("Glasses Pilot" → "AR Glasses Exploration").
      const accepted = score >= 0.6 || (score >= 0.5 && longestHit >= 6);
      if (accepted && (!best || score > best.score ||
          (score === best.score && alias.length > best.aliasLen))) {
        best = { entry, score, aliasLen: alias.length };
      }
    }
  }
  return best?.entry ?? null;
}
