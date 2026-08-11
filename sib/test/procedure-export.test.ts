// procedure-export.test.ts — end-to-end tests for the Procedure Designer routes.
//
// Boots the real Express app against a temp data dir and exercises
// POST /mindmap/:id/procedure/validate and /export over HTTP, so route wiring,
// error mapping and provenance persistence are all covered — not just the
// compiler and ingestion units beneath them.
//
// The two cases that matter most:
//   • 're-export preserves placement' — the invariant that makes re-syncing a
//     procedure safe.
//   • 're-export to a published guide is refused' — a published guide may be
//     running on the floor; mutating it silently is not recoverable.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs   from 'fs';
import os   from 'os';
import path from 'path';
import type { Server } from 'http';
import type { Mindmap, MindmapNode, MindmapEdge, MindmapEdgeRole } from '@spatial/shared';

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-procedure-e2e-'));
process.env.SIB_DATA_DIR = TMP_DATA;   // MUST be set before importing stores
delete process.env.SIB_API_KEY;        // keep the routes unauthenticated here

const { createApp }   = await import('../src/app.js');
const { mindmapStore } = await import('../src/models/mindmap.model.js');
const { guideStore, guideStepStore } = await import('../src/guides/store.js');

let server: Server;
let baseUrl: string;

before(async () => {
  server = createApp().listen(0);
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => { server?.close(); });

async function post(p: string, body?: unknown) {
  const r = await fetch(`${baseUrl}${p}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body ?? {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) as any };
}

const N = (id: string, x: number, y: number, text: string, notes: string): MindmapNode =>
  ({ id, x, y, text, notes, type: 'generic', metadata: {}, updatedAt: 1 });

const E = (from: string, to: string, role: MindmapEdgeRole): MindmapEdge =>
  ({ id: `${from}-${to}-${role}`, from, to, role, type: 'directed', updatedAt: 1 });

/** Check oil → inspect hoses → warm up, with a top-up-oil recovery branch. */
function seedMap(id: string, kind: 'procedure' | 'roadmap' = 'procedure'): Mindmap {
  const map: Mindmap = {
    id, name: 'Press startup', createdAt: 1, updatedAt: 1, kind, anchorId: 'anchor-1',
    nodes: [
      N('a', 0,   0,   'Check oil',     'Look at the sight glass'),
      N('b', 200, 0,   'Inspect hoses', 'Walk the unit'),
      N('c', 100, 140, 'Top up oil',    'Add ISO VG 46'),
      N('d', 400, 0,   'Warm up',       'Five dry cycles'),
    ],
    edges: [E('a','b','next'), E('a','c','failure'), E('c','b','next'), E('b','d','next')],
  };
  mindmapStore.save(map);
  return map;
}

const provOf = (map: Mindmap, nodeId: string) =>
  map.nodes.find(n => n.id === nodeId)!.metadata.guide as { guideId: string; stepId: string };

// ── validate ────────────────────────────────────────────────────────────────

test('validate returns the census and derived order without writing anything', async () => {
  seedMap('m1');
  const before = guideStore.findAll().length;
  const r = await post('/mindmap/m1/procedure/validate');

  assert.equal(r.status, 200);
  assert.equal(r.json.data.ok, true);
  assert.equal(r.json.data.census.steps, 4);
  assert.equal(r.json.data.census.lanes, 2, 'the recovery branch gets its own lane');
  assert.equal(Object.keys(r.json.data.order).length, 4);
  assert.equal(guideStore.findAll().length, before, 'validate must never create a guide');
});

test('validate refuses a roadmap map', async () => {
  seedMap('m-road', 'roadmap');
  const r = await post('/mindmap/m-road/procedure/validate');
  assert.equal(r.status, 400);
  assert.match(r.json.error, /roadmap map/i);
});

// ── export ──────────────────────────────────────────────────────────────────

test('export creates a draft guide with every step unplaced', async () => {
  seedMap('m2');
  const r = await post('/mindmap/m2/procedure/export', { createdBy: 'Karthik' });

  assert.equal(r.status, 201);
  assert.equal(r.json.data.stepsCreated, 4);
  assert.equal(r.json.data.stepsUnplaced, 4);

  const guide = guideStore.findById(r.json.data.guideId)!;
  assert.equal(guide.published, false, 'the canvas never publishes');

  const steps = guideStepStore.findAll().filter(s => s.guideId === guide.id);
  assert.equal(steps.length, 4);
  assert.ok(steps.every(s => s.isPlaced === false), 'placement only happens on device');
});

test('export stamps provenance onto every node and resolves branch links', async () => {
  const map = mindmapStore.findById('m2')!;
  const stamped = map.nodes.filter(n => (n.metadata?.guide as any)?.stepId);
  assert.equal(stamped.length, 4);

  const guideIds = new Set(stamped.map(n => (n.metadata.guide as any).guideId));
  assert.equal(guideIds.size, 1, 'all nodes bind to a single guide');

  const stepIdOf = (nodeId: string) => provOf(map, nodeId).stepId;
  const step = (id: string) => guideStepStore.findById(id)!;
  assert.equal(step(stepIdOf('a')).nextOnSuccess, stepIdOf('b'));
  assert.equal(step(stepIdOf('a')).nextOnFailure, stepIdOf('c'));
  assert.equal(step(stepIdOf('c')).nextOnSuccess, stepIdOf('b'));
});

test('re-export updates in place and preserves placement', async () => {
  const map     = mindmapStore.findById('m2')!;
  const guideId = provOf(map, 'a').guideId;

  // Simulate an Author placing all four steps in AR.
  for (const n of map.nodes) {
    const s = guideStepStore.findById(provOf(map, n.id).stepId)!;
    guideStepStore.save({ ...s, isPlaced: true, posX: 1, posY: 2, posZ: 3, positionSource: 'tap' });
  }

  mindmapStore.save({
    ...map,
    nodes: map.nodes.map(n => n.id === 'a' ? { ...n, notes: 'EDITED TEXT' } : n),
  });

  const r = await post('/mindmap/m2/procedure/export', { createdBy: 'Karthik' });
  assert.equal(r.status, 201);
  assert.equal(r.json.data.guideId, guideId, 're-export targets the bound guide');
  assert.equal(r.json.data.stepsCreated, 0);
  assert.equal(r.json.data.stepsUpdated, 4);
  assert.equal(r.json.data.stepsUnplaced, 0);

  const aStep = guideStepStore.findById(provOf(map, 'a').stepId)!;
  assert.equal(aStep.text, 'EDITED TEXT', 'structural edits apply');
  assert.equal(aStep.isPlaced, true, 'placement must survive a canvas write');
  assert.equal(aStep.posX, 1);
});

test('re-export to a published guide is refused', async () => {
  const map     = mindmapStore.findById('m2')!;
  const guideId = provOf(map, 'a').guideId;
  guideStore.save({ ...guideStore.findById(guideId)!, published: true });

  const r = await post('/mindmap/m2/procedure/export', { createdBy: 'Karthik' });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /published/i);
  assert.equal(guideStore.findById(guideId)!.published, true, 'left untouched after refusal');
});

test('confirmUnpublish proceeds and drops the guide back to draft', async () => {
  const map     = mindmapStore.findById('m2')!;
  const guideId = provOf(map, 'a').guideId;

  const r = await post('/mindmap/m2/procedure/export', { createdBy: 'Karthik', confirmUnpublish: true });
  assert.equal(r.status, 201);
  assert.equal(guideStore.findById(guideId)!.published, false);
});

test('an invalid graph returns 422 with issues pointing at the offending node', async () => {
  mindmapStore.save({
    id: 'm3', name: 'Broken', createdAt: 1, updatedAt: 1, kind: 'procedure', anchorId: 'anchor-1',
    nodes: [N('a', 0, 0, 'S1', 'x'), N('z', 400, 0, 'Orphan', 'x')],
    edges: [],
  });

  const r = await post('/mindmap/m3/procedure/export', { createdBy: 'Karthik' });
  assert.equal(r.status, 422);
  assert.ok(Array.isArray(r.json.issues), 'the issue list must reach the client');
  assert.ok(r.json.issues.some((i: any) => i.code === 'unreachable'));
  assert.ok(r.json.issues.some((i: any) => i.nodeId === 'z'), 'so the UI can select the node');
});

test('export without createdBy is rejected', async () => {
  seedMap('m4');
  const r = await post('/mindmap/m4/procedure/export', {});
  assert.equal(r.status, 400);
});
