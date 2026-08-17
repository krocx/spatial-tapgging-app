/**
 * Ask SIB core tests — retrieval ranking, glossary attachment, context budget,
 * prompt assembly. Pure fixtures; the live catalogue + LLM path are covered by
 * the stub-server e2e.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, retrieve, buildAskContext, buildMessages } from '../src/ask/ask-core.js';
import type { CatalogData, CatalogFeature } from '../src/catalog/catalog-core.js';

const feat = (id: string, name: string, body: string, over: Partial<CatalogFeature> = {}): CatalogFeature => ({
  id, name, area: 'tags', status: 'shipped', version: 'baseline',
  depends: [], terms: [], spec: 'x.md', body, ...over,
});

const CAT: CatalogData = {
  platformVersion: 'v', generatedAt: 'now',
  areas: [
    { id: 'tags', name: 'Spatial Inspection', color: '#000', order: 1, flow: 'flowchart LR\nA-->B', body: '' },
    { id: 'iloto', name: 'iLOTO — Lockout/Tagout', color: '#f00', order: 2, flow: 'flowchart LR\nA-->B', body: '' },
  ],
  features: [
    feat('loto-event-log', 'Append-only LOTO audit log',
      'Apply and remove are events appended to a log the server referees with checklists and try test.',
      { area: 'iloto', terms: ['LOTO', 'Try Test'], arch: 'sequenceDiagram\n  W->>R: POST /loto/events' }),
    feat('batch-validation', 'Batch validation',
      'One scan validates every tag on the anchor in a single capture.',
      { terms: ['Batch Validation'] }),
    feat('voice-scripts', 'Voice scripts (TTS)',
      'Optional per-step spoken instruction read aloud on step entry.'),
  ],
  edges: [], trails: [],
  glossary: [
    { term: 'LOTO — Lockout/Tagout', definition: 'OSHA procedure for hazardous energy.', section: 'iLOTO' },
    { term: 'Try Test', definition: 'Attempt to start after locking — must not respond.', section: 'iLOTO' },
    { term: 'Batch Validation', definition: 'One scan, every answer.', section: 'Pillar 2' },
  ],
  acronyms: [],
};

test('tokenize: lowercases, dedupes, strips stopwords', () => {
  assert.deepEqual(tokenize('How does the LOTO audit log work?'), ['loto', 'audit', 'log']);
});

test('retrieve: ranks the right feature first and attaches its glossary', () => {
  const r = retrieve(CAT, 'how does the LOTO audit log work?');
  assert.equal(r.sources[0].id, 'loto-event-log');
  assert.ok(r.glossary.some(g => g.term.startsWith('LOTO')));
  assert.ok(r.glossary.some(g => g.term === 'Try Test'));
});

test('retrieve: unrelated features score zero and are excluded', () => {
  const r = retrieve(CAT, 'batch validation scan');
  assert.equal(r.sources[0].id, 'batch-validation');
  assert.ok(!r.sources.some(s => s.id === 'voice-scripts'));
});

test('retrieve: empty/stopword-only question returns nothing', () => {
  assert.deepEqual(retrieve(CAT, 'how does it work?').sources, []);
});

test('buildAskContext: includes arch, respects budget', () => {
  const r = retrieve(CAT, 'LOTO audit log');
  const full = buildAskContext(CAT, r);
  assert.match(full, /\[loto-event-log\]/);
  assert.match(full, /POST \/loto\/events/);
  const tiny = buildAskContext(CAT, r, 40);
  assert.ok(tiny.length <= 48); // nothing fits → at most first truncation guard
});

test('buildMessages: system pins grounding, user carries context + question', () => {
  const msgs = buildMessages('CTX', 'Q?');
  assert.equal(msgs.length, 2);
  assert.match(msgs[0].content, /ONLY from the CONTEXT/);
  assert.match(msgs[1].content, /CTX/);
  assert.match(msgs[1].content, /QUESTION: Q\?/);
});
