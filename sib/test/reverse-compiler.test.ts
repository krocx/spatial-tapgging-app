/**
 * Reverse-compiler tests — guide → procedure map, and the ROUND-TRIP fidelity
 * contract from the UX review: reverse-compile a guide, forward-compile the
 * result, and the steps must come back in the same order with the same
 * branches, content and provenance-matched ids.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Guide, GuideStep, Mindmap } from '@spatial/shared';
import { guideToProcedureMap, toMindmapRecord } from '../src/procedure/reverse-compiler.js';
import { compileProcedure } from '../src/procedure/compiler.js';
import { provenanceOf, boundGuideId } from '../src/procedure/export.js';

const GUIDE: Guide = {
  id: 'g1', anchorId: 'a1', name: 'Pump teardown', description: '',
  published: false, createdBy: 'test',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z',
};

const step = (id: string, seq: number, over: Partial<GuideStep> = {}): GuideStep => ({
  id, guideId: 'g1', anchorId: 'a1', sequenceNumber: seq,
  title: `T${seq}`, text: `Do thing ${seq}`,
  completionRequired: true, isPlaced: true,
  posX: seq, posY: 0, posZ: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

test('linear guide → chain of next edges, full provenance, content mapped', () => {
  const steps = [
    step('s1', 1, { ttsText: 'speak one', linkUrl: 'https://sop.example/1' }),
    step('s2', 2, { completionRequired: false, modelId: 'm9', modelScale: 2 }),
    step('s3', 3),
  ];
  const r = guideToProcedureMap(GUIDE, steps);

  assert.equal(r.name, '[Guide] Pump teardown');
  assert.equal(r.kind, 'procedure');
  assert.equal(r.anchorId, 'a1');
  assert.equal(r.nodes.length, 3);
  assert.equal(r.edges.length, 2);
  assert.ok(r.edges.every(e => e.role === 'next' && e.type === 'directed'));

  // Provenance on every node, pointing at the right step.
  const provs = r.nodes.map(n => (n.metadata.guide as { guideId: string; stepId: string }));
  assert.deepEqual(provs.map(p => p.guideId), ['g1', 'g1', 'g1']);
  assert.deepEqual(new Set(provs.map(p => p.stepId)), new Set(['s1', 's2', 's3']));

  // Content: title → node.text, body → notes, meta into metadata.step.
  const n1 = r.nodes[0];
  assert.equal(n1.text, 'T1');
  assert.equal(n1.notes, 'Do thing 1');
  const m1 = n1.metadata.step as Record<string, unknown>;
  assert.equal(m1.ttsText, 'speak one');
  assert.equal(m1.linkUrl, 'https://sop.example/1');
  const m2 = r.nodes[1].metadata.step as Record<string, unknown>;
  assert.equal(m2.optional, true);           // completionRequired:false inverts
  assert.equal(m2.modelId, 'm9');
  assert.equal(m2.modelScale, 2);
});

test('branches: failure edge, requires drawn prerequisite → gated step, lanes split', () => {
  const steps = [
    step('s1', 1, { nextOnSuccess: 's3', nextOnFailure: 's2' }),
    step('s2', 2, { nextOnSuccess: 's3' }),         // recovery step
    step('s3', 3, { precondition: 's1' }),
  ];
  const r = guideToProcedureMap(GUIDE, steps);
  const nodeByStep = new Map(r.nodes.map(n =>
    [(n.metadata.guide as { stepId: string }).stepId, n]));

  const roleEdges = (role: string) => r.edges.filter(e => e.role === role);
  assert.equal(roleEdges('failure').length, 1);
  assert.equal(roleEdges('failure')[0].from, nodeByStep.get('s1')!.id);
  assert.equal(roleEdges('failure')[0].to,   nodeByStep.get('s2')!.id);
  // requires: FROM prerequisite INTO gated step — forward compiler's direction.
  assert.equal(roleEdges('requires').length, 1);
  assert.equal(roleEdges('requires')[0].from, nodeByStep.get('s1')!.id);
  assert.equal(roleEdges('requires')[0].to,   nodeByStep.get('s3')!.id);
  // s2 is only reachable via failure → its own lane (different y).
  assert.notEqual(nodeByStep.get('s2')!.y, nodeByStep.get('s1')!.y);
  assert.equal(nodeByStep.get('s3')!.y, nodeByStep.get('s1')!.y);
});

test('dangling branch target is dropped, not fabricated', () => {
  const steps = [step('s1', 1, { nextOnFailure: 'ghost-step' }), step('s2', 2)];
  const r = guideToProcedureMap(GUIDE, steps);
  assert.equal(r.edges.filter(e => e.role === 'failure').length, 0);
});

test('ROUND-TRIP: reverse → forward compile reproduces order, branches, content', () => {
  const steps = [
    step('s1', 1, { nextOnFailure: 's4', ttsText: 'careful now' }),
    step('s2', 2, { completionRequired: false }),
    step('s3', 3),
    step('s4', 4, { nextOnSuccess: 's2' }),         // recovery rejoins at s2
  ];
  const r = guideToProcedureMap(GUIDE, steps);
  const map: Mindmap = toMindmapRecord(r, GUIDE);

  assert.equal(boundGuideId(map), 'g1');
  assert.ok(map.guideSync && map.guideSync.guideId === 'g1' && map.guideSync.syncedAt > 0);

  const compiled = compileProcedure(map);
  assert.ok(compiled.ok, JSON.stringify(compiled.issues));
  assert.ok(compiled.guide && compiled.order);

  // Same walk order: spine s1→s2→s3, then the failure lane s4.
  const seqByStep = new Map<string, number>();
  for (const node of map.nodes) {
    const seq = compiled.order![node.id];
    if (seq !== undefined) seqByStep.set(provenanceOf(node)!.stepId, seq);
  }
  assert.deepEqual(
    [...seqByStep.entries()].sort((a, b) => a[1] - b[1]).map(x => x[0]),
    ['s1', 's2', 's3', 's4'],
  );

  // Content survives: titles, tts, optionality.
  const bySeq = new Map(compiled.guide!.steps.map(s => [s.sequenceNumber, s]));
  assert.equal(bySeq.get(seqByStep.get('s1')!)!.ttsText, 'careful now');
  assert.equal(bySeq.get(seqByStep.get('s2')!)!.completionRequired, false);
  assert.equal(bySeq.get(seqByStep.get('s3')!)!.title, 'T3');
});

test('empty guide → empty but valid map skeleton', () => {
  const r = guideToProcedureMap(GUIDE, []);
  assert.equal(r.nodes.length, 0);
  assert.equal(r.edges.length, 0);
  assert.equal(r.kind, 'procedure');
});

test('U5: reverse-compiler surfaces every model slot (assignment only) and lifts legacy into slot-1', () => {
  const steps = [
    step('s1', 1, { models: [
      { slotId: 'lock', modelId: 'm-lock', modelScale: 0.5, modelOffsetX: 0.3, modelRotationY: 1 },
      { slotId: 'tag',  modelId: 'm-tag',  modelOpacity: 0.7 },
    ], modelId: 'm-lock', modelScale: 0.5, modelOffsetX: 0.3 }),
    step('s2', 2, { modelId: 'm9', modelScale: 2 }),
  ];
  const r = guideToProcedureMap(GUIDE, steps);
  const m1 = r.nodes[0].metadata.step as Record<string, unknown>;
  assert.deepEqual(m1.models, [
    { slotId: 'lock', modelId: 'm-lock', modelScale: 0.5 },   // no offsets on the canvas
    { slotId: 'tag',  modelId: 'm-tag',  modelOpacity: 0.7 },
  ]);
  assert.equal(m1.modelId, 'm-lock');
  const m2 = r.nodes[1].metadata.step as Record<string, unknown>;
  assert.deepEqual(m2.models, [{ slotId: 'slot-1', modelId: 'm9', modelScale: 2 }]);
});
