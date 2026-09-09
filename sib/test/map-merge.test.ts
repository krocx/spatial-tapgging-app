/**
 * map-merge tests — D (2026.4.46): the guide is the source of truth, the map
 * keeps its presentation. Add / change / delete / layout kept / annotations
 * kept / edge ids reused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Guide, GuideStep, Mindmap, MindmapNode } from '@spatial/shared';
import { guideToProcedureMap, toMindmapRecord } from '../src/procedure/reverse-compiler.js';
import { mergeGuideIntoMap } from '../src/procedure/map-merge.js';

const GUIDE: Guide = {
  id: 'g1', anchorId: 'a1', name: 'Press startup', description: '',
  published: false, createdBy: 'test',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
};
const step = (id: string, seq: number, over: Partial<GuideStep> = {}): GuideStep => ({
  id, guideId: 'g1', anchorId: 'a1', sequenceNumber: seq,
  title: `T${seq}`, text: `Do thing ${seq}`,
  completionRequired: true, isPlaced: true, posX: seq, posY: 0, posZ: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});
const stepIdOf = (n: MindmapNode) => (n.metadata.guide as { stepId: string }).stepId;

function baseMap(steps: GuideStep[]): Mindmap {
  return toMindmapRecord(guideToProcedureMap(GUIDE, steps), GUIDE);
}

test('new step on iOS is added beside its predecessor; layout of the others kept', () => {
  const s = [step('s1', 1), step('s2', 2), step('s3', 3)];
  const map = baseMap(s);
  // Designer moved s2 somewhere personal.
  const n2 = map.nodes.find(n => stepIdOf(n) === 's2')!;
  n2.x = 900; n2.y = 640; n2.shape = 'hex' as never; n2.icon = 'wrench';

  const { map: m, summary } = mergeGuideIntoMap(map, GUIDE, [...s, step('s4', 4)]);
  assert.equal(summary.added, 1); assert.equal(summary.updated, 3); assert.equal(summary.removed, 0);
  assert.deepEqual(summary.addedTitles, ['T4']);
  const k2 = m.nodes.find(n => stepIdOf(n) === 's2')!;
  assert.equal(k2.id, n2.id);                       // same node, same identity
  assert.equal(k2.x, 900); assert.equal(k2.y, 640); // layout kept
  assert.equal(k2.shape, 'hex'); assert.equal(k2.icon, 'wrench');
  const k3 = m.nodes.find(n => stepIdOf(n) === 's3')!;
  const k4 = m.nodes.find(n => stepIdOf(n) === 's4')!;
  assert.equal(k4.x, k3.x + 240); assert.equal(k4.y, k3.y);   // beside predecessor
  // chain: s3 → s4 next edge exists
  assert.ok(m.edges.some(e => e.role === 'next' && e.from === k3.id && e.to === k4.id));
  assert.ok(m.guideSync!.syncedAt >= map.guideSync!.syncedAt);
});

test('content changed on iOS updates the node in place; deleted step removes node + edges', () => {
  const s = [step('s1', 1), step('s2', 2), step('s3', 3)];
  const map = baseMap(s);
  const edgeCountBefore = map.edges.length;
  const changed = [step('s1', 1, { title: 'Renamed', text: 'New body' }), step('s3', 2)];
  const { map: m, summary } = mergeGuideIntoMap(map, GUIDE, changed);
  assert.equal(summary.removed, 1); assert.equal(summary.updated, 2); assert.equal(summary.added, 0);
  const k1 = m.nodes.find(n => stepIdOf(n) === 's1')!;
  assert.equal(k1.text, 'Renamed'); assert.equal(k1.notes, 'New body');
  assert.equal(m.nodes.some(n => stepIdOf(n) === 's2'), false);
  assert.equal(m.edges.some(e => e.from === map.nodes.find(n => stepIdOf(n) === 's2')!.id), false);
  // s1 → s3 is the new chain
  const k3 = m.nodes.find(n => stepIdOf(n) === 's3')!;
  assert.ok(m.edges.some(e => e.role === 'next' && e.from === k1.id && e.to === k3.id));
  assert.ok(m.edges.length < edgeCountBefore);
});

test('annotation nodes and hand-drawn edges survive; matching role edges keep their ids', () => {
  const s = [step('s1', 1), step('s2', 2)];
  const map = baseMap(s);
  const note: MindmapNode = { id: 'note-1', x: 10, y: 10, text: 'Reminder', type: 'generic', metadata: {}, updatedAt: 1 };
  map.nodes.push(note);
  const n1 = map.nodes.find(n => stepIdOf(n) === 's1')!;
  map.edges.push({ id: 'hand-1', from: note.id, to: n1.id, type: 'directed', updatedAt: 1 });
  const nextEdgeId = map.edges.find(e => e.role === 'next')!.id;

  const { map: m } = mergeGuideIntoMap(map, GUIDE, s);
  assert.ok(m.nodes.some(n => n.id === 'note-1'));
  assert.ok(m.edges.some(e => e.id === 'hand-1'));
  assert.ok(m.edges.some(e => e.id === nextEdgeId && e.role === 'next'));
});

test('branch edges follow the guide (failure target added on iOS)', () => {
  const s = [step('s1', 1), step('s2', 2), step('s3', 3)];
  const map = baseMap(s);
  const withBranch = [step('s1', 1, { nextOnFailure: 's3' }), step('s2', 2), step('s3', 3)];
  const { map: m } = mergeGuideIntoMap(map, GUIDE, withBranch);
  const k1 = m.nodes.find(n => stepIdOf(n) === 's1')!;
  const k3 = m.nodes.find(n => stepIdOf(n) === 's3')!;
  assert.ok(m.edges.some(e => e.role === 'failure' && e.from === k1.id && e.to === k3.id));
});
