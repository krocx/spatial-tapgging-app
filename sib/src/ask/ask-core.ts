/**
 * Ask SIB — pure core.
 *
 * Docs-grounded Q&A over the Feature Catalogue. Two tiers:
 *   1. RETRIEVAL (always available): keyword scoring over features + glossary —
 *      the functions in this file. No model, no network, works on every deploy.
 *   2. GENERATION (when configured): the route feeds buildAskContext() to an
 *      OpenAI-compatible /v1/chat/completions endpoint. That protocol is the
 *      contract — llama.cpp's llama-server and Ollama both speak it, so the
 *      runtime is an env-var decision (ASK_LLM_URL), never a code change.
 *
 * Grounding doctrine: answers come from docs/catalog + the glossary ONLY.
 * No site data (sessions, findings, locks) flows through here — that keeps
 * /ask safely public, like /catalog itself.
 */

import type { CatalogData, CatalogFeature, GlossaryTerm } from '../catalog/catalog-core.js';

export interface AskSource {
  id: string;
  name: string;
  area: string;
  status: string;
  score: number;
  excerpt: string;
}

export interface AskRetrieval {
  sources: AskSource[];
  glossary: { term: string; definition: string }[];
}

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did',
  'how', 'what', 'when', 'where', 'why', 'which', 'who', 'can', 'could', 'should',
  'would', 'will', 'i', 'we', 'you', 'it', 'in', 'on', 'of', 'to', 'for', 'with',
  'and', 'or', 'if', 'my', 'our', 'this', 'that', 'there', 'about', 'work', 'works',
  'use', 'used', 'using', 'get', 'sib',
]);

export function tokenize(q: string): string[] {
  return [...new Set(
    q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOPWORDS.has(t)),
  )];
}

/** Occurrences of token as a whole-ish word in text (already lowercased). */
function hits(text: string, token: string): number {
  let n = 0, i = 0;
  while ((i = text.indexOf(token, i)) !== -1) { n++; i += token.length; }
  return n;
}

/**
 * Score a feature against question tokens. Field weights favour identity over
 * prose: a token matching the NAME says far more than one buried in the body.
 */
export function scoreFeature(f: CatalogFeature, tokens: string[], areaName: string): number {
  const name = f.name.toLowerCase();
  const id = f.id.toLowerCase();
  const terms = f.terms.join(' ').toLowerCase();
  const body = f.body.toLowerCase();
  const diagrams = ((f.arch ?? '') + ' ' + (f.flow ?? '')).toLowerCase();
  const area = areaName.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    score += 4 * hits(name, t) + 4 * hits(id, t) + 3 * hits(terms, t)
           + 2 * hits(area, t) + Math.min(3, hits(body, t)) + Math.min(2, hits(diagrams, t));
  }
  return score;
}

/** Top-N features + the glossary terms they (or the question) touch. */
export function retrieve(cat: CatalogData, question: string, topN = 5): AskRetrieval {
  const tokens = tokenize(question);
  if (!tokens.length) return { sources: [], glossary: [] };
  const areaName = new Map(cat.areas.map(a => [a.id, a.name]));

  const scored = cat.features
    .map(f => ({ f, score: scoreFeature(f, tokens, areaName.get(f.area) ?? '') }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  const sources: AskSource[] = scored.map(({ f, score }) => ({
    id: f.id, name: f.name, area: f.area, status: f.status, score,
    excerpt: f.body.length > 280 ? f.body.slice(0, 277) + '…' : f.body,
  }));

  // Glossary: terms named by the top features, plus terms literally asked
  // about. Word-start matching only — a substring test let "log" match
  // "Ontology", which is worse than no definition at all.
  // Ranked: a term the QUESTION names outranks one merely related via a top
  // feature — otherwise glossary-file order decides and "Anchor" beats "LOTO"
  // on a LOTO question. Top-feature terms get a boost so the #1 source's
  // vocabulary wins over the #5 source's.
  const wordStart = (name: string, t: string) =>
    name.startsWith(t) || name.includes(' ' + t) || name.includes('(' + t) || name.includes('/' + t);
  const topTerms = new Set((scored[0]?.f.terms ?? []).map(t => t.toLowerCase()));
  const wanted = new Set(scored.flatMap(({ f }) => f.terms.map(t => t.toLowerCase())));
  const seen = new Set<string>();
  const glossary = cat.glossary
    .map((g: GlossaryTerm) => {
      const name = g.term.toLowerCase();
      let rank = 0;
      if (tokens.some(t => t.length > 3 && wordStart(name, t))) rank += 4;
      if ([...topTerms].some(w => wordStart(name, w))) rank += 2;
      else if ([...wanted].some(w => wordStart(name, w))) rank += 1;
      return { g, rank };
    })
    .filter(x => {
      if (x.rank === 0 || seen.has(x.g.term.toLowerCase())) return false;
      seen.add(x.g.term.toLowerCase());
      return true;
    })
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 4)
    .map(x => ({ term: x.g.term, definition: x.g.definition }));

  return { sources, glossary };
}

/** Context block for the generation tier — bounded, citable, nothing else. */
export function buildAskContext(cat: CatalogData, retrieval: AskRetrieval, budget = 7000): string {
  const parts: string[] = [];
  for (const s of retrieval.sources) {
    const f = cat.features.find(x => x.id === s.id);
    if (!f) continue;
    let block = `[${f.id}] ${f.name} (area: ${f.area}, status: ${f.status})\n${f.body}`;
    if (f.arch) block += `\nArchitecture (mermaid):\n${f.arch}`;
    parts.push(block);
  }
  for (const g of retrieval.glossary) parts.push(`[glossary] ${g.term}: ${g.definition}`);
  let out = '';
  for (const p of parts) {
    if (out.length + p.length + 8 > budget) break;
    out += (out ? '\n\n---\n\n' : '') + p;
  }
  return out;
}

export function buildMessages(context: string, question: string) {
  return [
    {
      role: 'system',
      content:
        'You are Ask SIB, the documentation assistant for an AR operations platform ' +
        '(spatial inspection, AR work instructions, Gemba walks, iLOTO lockout/tagout). ' +
        'Answer ONLY from the CONTEXT blocks. Cite the feature ids you used in square ' +
        'brackets, e.g. [loto-event-log]. If the context does not contain the answer, ' +
        'say so plainly and suggest the closest documented feature. Be concise and concrete.',
    },
    { role: 'user', content: `CONTEXT:\n\n${context}\n\nQUESTION: ${question}` },
  ];
}
