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

// ── Roadmap fields: status / milestone / notes / edge labels / lanes ───────

test('node status, milestone, notes survive sanitization; junk is dropped', () => {
  let map: Mindmap = saveMindmap({ name: 'Fields', nodes: [], edges: [] });
  map = applyGraphEvent(map, event('node:add', map.id, node('n1', {
    status: 'in-progress', milestone: true, notes: 'ship with SIB v0.3',
  })))!;
  assert.equal(map.nodes[0].status, 'in-progress');
  assert.equal(map.nodes[0].milestone, true);
  assert.equal(map.nodes[0].notes, 'ship with SIB v0.3');

  // Invalid status → dropped, not rejected
  const junk = applyGraphEvent(map, event('node:update', map.id,
    node('n1', { status: 'wat' as never, updatedAt: Date.now() + 50 })))!;
  assert.equal(junk.nodes[0].status, undefined);
});

test('edge labels persist and render in SVG', () => {
  const map = saveMindmap({
    name: 'Labeled',
    nodes: [node('a'), node('b', { x: 300 })],
    edges: [{ id: 'e1', from: 'a', to: 'b', type: 'directed', updatedAt: Date.now(), label: 'depends on' }],
  });
  assert.equal(map.edges[0].label, 'depends on');
  assert.ok(renderMindmapSvg(map).includes('depends on'));
});

test('map:lanes event replaces lanes (LWW-free full replace) and rejects junk', () => {
  let map: Mindmap = saveMindmap({ name: 'Lanes', nodes: [], edges: [] });
  const lanes = [
    { id: 'l1', name: 'Now', x: 0, width: 400 },
    { id: 'l2', name: 'Next', x: 400, width: 400 },
  ];
  map = applyGraphEvent(map, event('map:lanes', map.id, { lanes }))!;
  assert.equal(map.lanes?.length, 2);
  assert.equal(map.lanes?.[1].name, 'Next');

  // Malformed lane entry → event rejected entirely
  assert.equal(applyGraphEvent(map, event('map:lanes', map.id, { lanes: [{ nope: 1 }] })), null);
  // Empty array is valid (lanes cleared)
  assert.equal(applyGraphEvent(map, event('map:lanes', map.id, { lanes: [] }))!.lanes?.length, 0);
});

test('saveMindmap preserves lanes when request omits them', () => {
  const created = saveMindmap({
    name: 'KeepLanes', nodes: [], edges: [],
    lanes: [{ id: 'l1', name: 'Now', x: 0, width: 300 }],
  });
  assert.equal(created.lanes?.length, 1);
  const resaved = saveMindmap({ id: created.id, name: 'KeepLanes', nodes: [], edges: [] });
  assert.equal(resaved.lanes?.length, 1, 'lanes lost on lane-less save');
});

// ── Comments + review ──────────────────────────────────────────────────────

test('comment:add appends, dedupes, and comment:delete removes', () => {
  let map: Mindmap = saveMindmap({ name: 'Comments', nodes: [node('n1')], edges: [] });
  const comment = { id: 'c1', author: 'Karthik', text: 'Looks right', createdAt: Date.now() };

  map = applyGraphEvent(map, event('comment:add', map.id, { nodeId: 'n1', comment }))!;
  assert.equal(map.nodes[0].comments?.length, 1);
  assert.equal(map.nodes[0].comments?.[0].author, 'Karthik');

  // Duplicate id → dropped
  assert.equal(applyGraphEvent(map, event('comment:add', map.id, { nodeId: 'n1', comment })), null);
  // Unknown node → dropped
  assert.equal(applyGraphEvent(map, event('comment:add', map.id, { nodeId: 'ghost', comment: { ...comment, id: 'c2' } })), null);

  map = applyGraphEvent(map, event('comment:delete', map.id, { nodeId: 'n1', commentId: 'c1' }))!;
  assert.equal(map.nodes[0].comments, undefined);
});

test('node:update merges comments instead of clobbering (append-safe)', () => {
  let map: Mindmap = saveMindmap({ name: 'Merge', nodes: [node('n1')], edges: [] });
  const c1 = { id: 'c1', author: 'A', text: 'first', createdAt: 1000 };
  map = applyGraphEvent(map, event('comment:add', map.id, { nodeId: 'n1', comment: c1 }))!;

  // A stale-ish client sends node:update WITHOUT c1 but with its own c2.
  const c2 = { id: 'c2', author: 'B', text: 'second', createdAt: 2000 };
  const incoming = { ...map.nodes[0], comments: [c2], updatedAt: Date.now() + 10 };
  map = applyGraphEvent(map, event('node:update', map.id, incoming))!;

  const ids = (map.nodes[0].comments ?? []).map(c => c.id);
  assert.deepEqual(ids, ['c1', 'c2'], 'union by id, sorted by createdAt');
});

test('review state round-trips; junk review dropped', () => {
  let map: Mindmap = saveMindmap({ name: 'Review', nodes: [], edges: [] });
  map = applyGraphEvent(map, event('node:add', map.id, node('n1', { review: 'needs-validation' })))!;
  assert.equal(map.nodes[0].review, 'needs-validation');
  const junk = applyGraphEvent(map, event('node:update', map.id,
    node('n1', { review: 'maybe' as never, updatedAt: Date.now() + 50 })))!;
  assert.equal(junk.nodes[0].review, undefined);
  assert.ok(renderMindmapSvg(map).includes('?'));   // review glyph in SVG
});

test('row lanes sanitize and render horizontally', () => {
  let map: Mindmap = saveMindmap({ name: 'Rows', nodes: [node('a')], edges: [] });
  map = applyGraphEvent(map, event('map:lanes', map.id, {
    lanes: [
      { id: 'r1', name: 'Why', x: 0, width: 220, orientation: 'row' },
      { id: 'c1', name: 'Now', x: 0, width: 400 },
    ],
  }))!;
  assert.equal(map.lanes?.[0].orientation, 'row');
  assert.equal(map.lanes?.[1].orientation, undefined);   // columns stay default
  const svg = renderMindmapSvg(map);
  assert.ok(svg.includes('>Why<'));
  assert.ok(svg.includes('>Now<'));
});

// ── Rich node fields: collapsed / icon / shape / link ──────────────────────

test('collapsed, icon, shape, link sanitize correctly; unsafe links dropped', () => {
  let map: Mindmap = saveMindmap({ name: 'Rich', nodes: [], edges: [] });
  map = applyGraphEvent(map, event('node:add', map.id, node('n1', {
    collapsed: true, icon: 'gear', shape: 'hexagon', link: 'https://sib.internal/docs',
  })))!;
  assert.equal(map.nodes[0].collapsed, true);
  assert.equal(map.nodes[0].icon, 'gear');
  assert.equal(map.nodes[0].shape, 'hexagon');
  assert.equal(map.nodes[0].link, 'https://sib.internal/docs');

  // javascript: link and bogus shape are silently dropped
  const dirty = applyGraphEvent(map, event('node:update', map.id, node('n1', {
    link: 'javascript:alert(1)', shape: 'blob' as never, updatedAt: Date.now() + 50,
  })))!;
  assert.equal(dirty.nodes[0].link, undefined);
  assert.equal(dirty.nodes[0].shape, undefined);

  // 'rounded' is the default — not persisted
  const rounded = applyGraphEvent(dirty, event('node:update', map.id, node('n1', {
    shape: 'rounded', updatedAt: Date.now() + 100,
  })))!;
  assert.equal(rounded.nodes[0].shape, undefined);
});

test('REST save sanitizes: unsafe links stripped, dangling edges dropped', () => {
  const map = saveMindmap({
    name: 'RestSanitize',
    nodes: [
      node('a', { link: 'javascript:alert(1)' as never, shape: 'blob' as never }),
      node('b', { link: 'https://ok.example' }),
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', type: 'directed', updatedAt: 1 },
      { id: 'e2', from: 'a', to: 'ghost', type: 'directed', updatedAt: 1 },   // dangling
      { id: 'e3', from: 'b', to: 'b', type: 'directed', updatedAt: 1 },       // self-loop
    ],
  });
  assert.equal(map.nodes.find(n => n.id === 'a')?.link, undefined);
  assert.equal(map.nodes.find(n => n.id === 'a')?.shape, undefined);
  assert.equal(map.nodes.find(n => n.id === 'b')?.link, 'https://ok.example');
  assert.deepEqual(map.edges.map(e => e.id), ['e1']);
});

// ── Groups ─────────────────────────────────────────────────────────────────

test('map:groups replaces groups, filters ghost node ids, rejects junk', () => {
  let map: Mindmap = saveMindmap({ name: 'Groups', nodes: [node('a'), node('b')], edges: [] });
  map = applyGraphEvent(map, event('map:groups', map.id, {
    groups: [{ id: 'g1', name: 'Perception pipeline', nodeIds: ['a', 'b', 'ghost', 'a'] }],
  }))!;
  assert.deepEqual(map.groups?.[0].nodeIds, ['a', 'b']);   // ghost dropped, deduped
  assert.equal(applyGraphEvent(map, event('map:groups', map.id, { groups: [{ bad: true }] })), null);
  assert.equal(applyGraphEvent(map, event('map:groups', map.id, { groups: [] }))!.groups?.length, 0);
});

test('node:delete cascades out of groups', () => {
  let map: Mindmap = saveMindmap({ name: 'GroupCascade', nodes: [node('a'), node('b')], edges: [] });
  map = applyGraphEvent(map, event('map:groups', map.id, {
    groups: [{ id: 'g1', name: 'Team A', nodeIds: ['a', 'b'] }],
  }))!;
  map = applyGraphEvent(map, event('node:delete', map.id, { id: 'a' }))!;
  assert.deepEqual(map.groups?.[0].nodeIds, ['b']);
});

test('saveMindmap preserves groups when request omits them', () => {
  const created = saveMindmap({
    name: 'KeepGroups', nodes: [node('a')], edges: [],
    groups: [{ id: 'g1', name: 'Core', nodeIds: ['a'] }],
  });
  assert.equal(created.groups?.length, 1);
  const resaved = saveMindmap({ id: created.id, name: 'KeepGroups', nodes: [node('a')], edges: [] });
  assert.equal(resaved.groups?.length, 1, 'groups lost on group-less save');
});

// ── SIB bridge ─────────────────────────────────────────────────────────────

test('sib-json export builds draft tags from tag-typed nodes', () => {
  const map = saveMindmap({
    name: 'SIB Draft',
    nodes: [
      node('t1', { type: 'tag', text: 'Check valve torque', notes: 'use torque wrench' }),
      node('g1', { type: 'generic', text: 'not a tag' }),
      node('linked', { type: 'tag', text: 'already linked', metadata: { sib: { kind: 'tag', id: 'abc' } } }),
    ],
    edges: [],
  });
  const out = exportMindmap(map.id, 'sib-json');
  const draft = JSON.parse(out.body);
  assert.equal(draft.draftTags.length, 1);
  assert.equal(draft.draftTags[0].label, 'Check valve torque');
  assert.equal(draft.draftTags[0].metadata.notes, 'use torque wrench');
  assert.equal(draft.linked.length, 1);
  assert.equal(draft.linked[0].sibId, 'abc');
  assert.ok(out.filename.endsWith('.sib-draft.json'));
});

test('importSibGraph merges anchors/tags idempotently', async () => {
  const { anchorStore } = await import('../src/routes/anchors.js');
  const { tagStore } = await import('../src/routes/tags.js');
  const { importSibGraph } = await import('../src/adapters/mindmap-sib-adapter.js');

  const anchor = {
    id: 'a-test-1', assetId: 'PUMP-42', anchorType: 'QR' as const,
    coordinateSystem: 'ASSET_FRAME' as const,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 },
    metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  anchorStore.save(anchor as never);
  tagStore.save({
    id: 't-test-1', anchorId: 'a-test-1', type: 'INSPECTION_POINT', label: 'Valve check',
    expectedOutcome: '', metadata: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as never);

  const map = saveMindmap({ name: 'SIB Import', nodes: [], edges: [] });
  const first = importSibGraph(map, 'a-test-1');
  assert.equal(first.addedNodes, 2);            // anchor node + tag node
  assert.equal(first.addedEdges, 1);            // anchor → tag
  assert.equal(first.nodes.find(n => n.text === 'PUMP-42')?.type, 'generic');
  assert.equal(first.nodes.find(n => n.text === 'Valve check')?.type, 'tag');

  // Second import over the merged result adds nothing.
  const merged = { ...map, nodes: first.nodes, edges: first.edges };
  const second = importSibGraph(merged, 'a-test-1');
  assert.equal(second.addedNodes, 0);
  assert.equal(second.addedEdges, 0);
});
