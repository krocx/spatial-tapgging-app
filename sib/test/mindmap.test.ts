// mindmap.test.ts — unit tests for the Roadmap Mind-Mapper backend.
// Run: npm test --workspace=sib   (uses node:test via tsx; SIB_DATA_DIR is
// pointed at a temp dir so tests never touch real .sib-data).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-mindmap-test-'));
process.env.SIB_DATA_DIR = TMP_DATA;   // MUST be set before importing stores

const {
  mindmapStore,
  applyGraphEvent,
  snapshotVersion,
  listVersions,
  renderMindmapSvg,
  MAX_VERSIONS_PER_MAP,
} = await import('../src/models/mindmap.model.js');

const {
  saveMindmap,
  loadMindmap,
  listMindmaps,
  deleteMindmap,
  restoreVersion,
  exportMindmap,
  MindmapError,
} = await import('../src/controllers/mindmap.controller.js');

import type { Mindmap, MindmapNode, MindmapWsEvent } from '@spatial/shared';

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

function node(id: string, overrides: Partial<MindmapNode> = {}): MindmapNode {
  return { id, x: 0, y: 0, text: id, type: 'generic', metadata: {}, updatedAt: Date.now(), ...overrides };
}

function event(type: MindmapWsEvent['type'], mapId: string, payload: unknown, ts = Date.now()): MindmapWsEvent {
  return { type, mapId, ts, payload };
}

// ── Controller: save / load / list / delete ────────────────────────────────

test('saveMindmap creates a map and a version snapshot', () => {
  const map = saveMindmap({ name: 'Roadmap 2027', nodes: [node('a')], edges: [] });
  assert.ok(map.id);
  assert.equal(map.name, 'Roadmap 2027');
  assert.equal(loadMindmap(map.id).nodes.length, 1);
  assert.equal(listVersions(map.id).length, 1);
  assert.equal(listVersions(map.id)[0].label, 'manual save');
});

test('saveMindmap rejects missing name and bad arrays', () => {
  assert.throws(() => saveMindmap({ name: '  ', nodes: [], edges: [] }), MindmapError);
  // @ts-expect-error — intentionally malformed
  assert.throws(() => saveMindmap({ name: 'x', nodes: 'nope', edges: [] }), MindmapError);
});

test('listMindmaps returns summaries sorted by updatedAt desc', () => {
  const summaries = listMindmaps();
  assert.ok(summaries.length >= 1);
  assert.ok('nodeCount' in summaries[0]);
  assert.ok(!('nodes' in summaries[0]));
  for (let i = 1; i < summaries.length; i++) {
    assert.ok(summaries[i - 1].updatedAt >= summaries[i].updatedAt);
  }
});

test('deleteMindmap removes map and its versions', () => {
  const map = saveMindmap({ name: 'Temp', nodes: [], edges: [] });
  deleteMindmap(map.id);
  assert.throws(() => loadMindmap(map.id), MindmapError);
  assert.equal(mindmapStore.findById(map.id), undefined);
  assert.equal(listMindmaps().some(m => m.id === map.id), false);
});

// ── LWW graph events ───────────────────────────────────────────────────────

test('applyGraphEvent adds, updates, deletes nodes with LWW', () => {
  let map: Mindmap = saveMindmap({ name: 'LWW', nodes: [], edges: [] });

  map = applyGraphEvent(map, event('node:add', map.id, node('n1', { text: 'first' })))!;
  assert.equal(map.nodes.length, 1);

  // Newer update wins
  const newer = applyGraphEvent(map, event('node:update', map.id, node('n1', { text: 'newer', updatedAt: Date.now() + 100 })));
  assert.equal(newer!.nodes[0].text, 'newer');

  // Stale update (older clock) is dropped
  const stale = applyGraphEvent(newer!, event('node:update', map.id, node('n1', { text: 'stale', updatedAt: Date.now() - 60_000 })));
  assert.equal(stale, null);

  // Delete cascades edges
  let withEdge = applyGraphEvent(newer!, event('node:add', map.id, node('n2')))!;
  withEdge = applyGraphEvent(withEdge, event('edge:add', map.id, { id: 'e1', from: 'n1', to: 'n2', type: 'directed' }))!;
  assert.equal(withEdge.edges.length, 1);
  const afterDelete = applyGraphEvent(withEdge, event('node:delete', map.id, { id: 'n2' }))!;
  assert.equal(afterDelete.nodes.length, 1);
  assert.equal(afterDelete.edges.length, 0);
});

test('applyGraphEvent rejects invalid edges', () => {
  let map: Mindmap = saveMindmap({ name: 'Edges', nodes: [node('a'), node('b')], edges: [] });

  // Self-loop
  assert.equal(applyGraphEvent(map, event('edge:add', map.id, { id: 'e', from: 'a', to: 'a', type: 'directed' })), null);
  // Missing endpoint
  assert.equal(applyGraphEvent(map, event('edge:add', map.id, { id: 'e', from: 'a', to: 'ghost', type: 'directed' })), null);
  // Duplicate pair
  map = applyGraphEvent(map, event('edge:add', map.id, { id: 'e1', from: 'a', to: 'b', type: 'directed' }))!;
  assert.equal(applyGraphEvent(map, event('edge:add', map.id, { id: 'e2', from: 'a', to: 'b', type: 'directed' })), null);
});

test('applyGraphEvent clamps runaway client clocks', () => {
  const map: Mindmap = saveMindmap({ name: 'Clock', nodes: [], edges: [] });
  const farFuture = Date.now() + 999_999_999;
  const result = applyGraphEvent(map, event('node:add', map.id, node('n1', { updatedAt: farFuture }), farFuture))!;
  assert.ok(result.nodes[0].updatedAt <= Date.now() + 31_000);
});

test('cursor and session events never mutate the graph', () => {
  const map: Mindmap = saveMindmap({ name: 'Cursor', nodes: [node('a')], edges: [] });
  assert.equal(applyGraphEvent(map, event('cursor:move', map.id, { x: 1, y: 2 })), null);
  assert.equal(applyGraphEvent(map, event('session:join', map.id, {})), null);
});

// ── Versioning ─────────────────────────────────────────────────────────────

test('version history is pruned to MAX_VERSIONS_PER_MAP', () => {
  const map = saveMindmap({ name: 'Prune', nodes: [], edges: [] });
  for (let i = 0; i < MAX_VERSIONS_PER_MAP + 10; i++) snapshotVersion(map, `s${i}`);
  assert.equal(listVersions(map.id).length, MAX_VERSIONS_PER_MAP);
  // Newest survive
  assert.equal(listVersions(map.id)[0].label, `s${MAX_VERSIONS_PER_MAP + 9}`);
});

test('restoreVersion restores snapshot content and preserves identity', () => {
  const v1 = saveMindmap({ name: 'Restorable', nodes: [node('a')], edges: [] });
  const versionsAfterV1 = listVersions(v1.id);
  const v2 = saveMindmap({ id: v1.id, name: 'Restorable', nodes: [node('a'), node('b')], edges: [] });
  assert.equal(v2.nodes.length, 2);

  const restored = restoreVersion(v1.id, versionsAfterV1[0].id);
  assert.equal(restored.id, v1.id);
  assert.equal(restored.createdAt, v1.createdAt);
  assert.equal(restored.nodes.length, 1);
  // before-restore + restored snapshots were recorded
  const labels = listVersions(v1.id).map(v => v.label);
  assert.ok(labels.includes('before restore'));
  assert.ok(labels.some(l => l.startsWith('restored:')));
});

// ── Export ─────────────────────────────────────────────────────────────────

test('exportMindmap json and svg; rejects png server-side', () => {
  const map = saveMindmap({
    name: 'Export Me',
    nodes: [node('a', { text: 'Perception <layer>', type: 'perception', x: 10, y: 20 }), node('b', { x: 300, y: 200 })],
    edges: [{ id: 'e1', from: 'a', to: 'b', type: 'directed', updatedAt: Date.now() }],
  });

  const json = exportMindmap(map.id, 'json');
  assert.equal(json.contentType, 'application/json');
  assert.equal(JSON.parse(json.body).id, map.id);
  assert.equal(json.filename, 'Export-Me.json');

  const svg = exportMindmap(map.id, 'svg');
  assert.equal(svg.contentType, 'image/svg+xml');
  assert.ok(svg.body.startsWith('<svg'));
  assert.ok(svg.body.includes('&lt;layer&gt;'));       // XML-escaped
  assert.ok(svg.body.includes('marker-end="url(#arrow)"')); // directed edge

  assert.throws(() => exportMindmap(map.id, 'png'), MindmapError);
});

test('renderMindmapSvg handles an empty map', () => {
  const svg = renderMindmapSvg({ id: 'x', name: 'Empty', createdAt: 0, updatedAt: 0, nodes: [], edges: [] });
  assert.ok(svg.startsWith('<svg'));
});
