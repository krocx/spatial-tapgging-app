// procedure-parts.test.ts — 2026.4.46: parts per step in the Procedure Designer.
//
// The designer stores only "which parts this step installs"; the compiler
// turns that into per-step node deltas + an initial state, and the reverse
// compiler brings an imported (Cortona) guide back without losing motion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Mindmap, MindmapNode, MindmapEdge, Guide, GuideStep } from '@spatial/shared';
import { compileProcedure } from '../src/procedure/compiler.js';
import { guideToProcedureMap } from '../src/procedure/reverse-compiler.js';
import { partTreeOf } from '../src/models/glb-nodes.js';

const N = (id: string, x: number, stepMeta?: Record<string, unknown>): MindmapNode =>
  ({ id, x, y: 0, text: `Step ${id}`, notes: 'do it', type: 'generic', metadata: stepMeta ? { step: stepMeta } : {}, updatedAt: 1 });
const E = (from: string, to: string): MindmapEdge => ({ id: `${from}-${to}`, from, to, role: 'next', type: 'directed', updatedAt: 1 });
const M = (nodes: MindmapNode[], edges: MindmapEdge[], assembly?: Mindmap['settings'] extends infer S ? (S extends { assembly?: infer A } ? A : never) : never): Mindmap =>
  ({ id: 'm', name: 'P', createdAt: 1, updatedAt: 1, kind: 'procedure', nodes, edges, ...(assembly ? { settings: { assembly } } : {}) });

test('build-up: parts become solid deltas, initial state hides every mentioned part', () => {
  const map = M([N('a', 0, { parts: ['cmp:base-ring'] }), N('b', 100, { parts: ['cmp:lid', 'cmp:bolt-1'] })], [E('a', 'b')],
    { modelId: 'mdl-1' });
  const r = compileProcedure(map);
  assert.ok(r.ok, JSON.stringify(r.issues));
  const g = r.guide!;
  assert.equal(g.assembly?.modelId, 'mdl-1');
  assert.equal(g.assembly?.source, 'cad');
  assert.deepEqual(g.steps[0].nodes, [{ node: 'cmp:base-ring', show: 'solid' }]);
  assert.deepEqual(g.steps[1].nodes, [{ node: 'cmp:lid', show: 'solid' }, { node: 'cmp:bolt-1', show: 'solid' }]);
  const initial = Object.fromEntries((g.assembly!.initialNodes ?? []).map(n => [n.node, n.show]));
  assert.deepEqual(initial, { 'cmp:base-ring': 'hidden', 'cmp:lid': 'hidden', 'cmp:bolt-1': 'hidden' });
});

test('take-apart: parts become hidden deltas, initial state shows them', () => {
  const map = M([N('a', 0, { parts: ['cmp:lid'] })], [], { modelId: 'mdl-1', start: 'complete' });
  const r = compileProcedure(map);
  assert.ok(r.ok);
  assert.deepEqual(r.guide!.steps[0].nodes, [{ node: 'cmp:lid', show: 'hidden' }]);
  assert.deepEqual(r.guide!.assembly!.initialNodes, [{ node: 'cmp:lid', show: 'solid' }]);
});

test('warnings: no parts on a step, a part listed twice, parts without an assembly', () => {
  const withAsm = compileProcedure(M([N('a', 0, { parts: ['cmp:x'] }), N('b', 100, {}), N('c', 200, { parts: ['cmp:x'] })],
    [E('a', 'b'), E('b', 'c')], { modelId: 'mdl-1' }));
  const codes = withAsm.issues.map(i => i.code);
  assert.ok(codes.includes('no-parts'), codes.join());
  assert.ok(codes.includes('part-twice'), codes.join());
  assert.ok(withAsm.ok, 'warnings never block sending');

  const noAsm = compileProcedure(M([N('a', 0, { parts: ['cmp:x'] })], []));
  assert.ok(noAsm.issues.some(i => i.code === 'parts-no-assembly'));
  assert.equal(noAsm.guide!.assembly, undefined);
  assert.equal(noAsm.guide!.steps[0].nodes, undefined, 'no assembly → parts are not emitted as deltas');
});

test('imported motion survives an edit: parts wins for show, node fields are kept', () => {
  const imported = [{ node: 'cmp:lid', show: 'ghost', animate: 'insert', from: [0, 0.1, 0], to: [0, 0, 0] }];
  const map = M([N('a', 0, { nodes: imported, parts: ['cmp:lid', 'cmp:new'] })], [], { modelId: 'mdl-1', initialNodes: [{ node: 'cmp:lid', show: 'hidden' }] });
  const r = compileProcedure(map);
  assert.ok(r.ok);
  const [lid, extra] = r.guide!.steps[0].nodes!;
  assert.equal(lid.node, 'cmp:lid'); assert.equal(lid.show, 'solid'); assert.equal(lid.animate, 'insert');
  assert.deepEqual(lid.to, [0, 0, 0]);
  assert.deepEqual(extra, { node: 'cmp:new', show: 'solid' });
  // Imported initial state kept verbatim; the new part gets the derived one.
  assert.deepEqual(r.guide!.assembly!.initialNodes, [{ node: 'cmp:lid', show: 'hidden' }, { node: 'cmp:new', show: 'hidden' }]);
});

test('untouched imported step passes nodes / view / cadPosition through verbatim', () => {
  const nodes = [{ node: 'cmp:a', show: 'ghost', animate: 'insert' }, { node: 'cmp:b', show: 'hidden' }];
  const map = M([N('a', 0, { nodes, view: { position: [0, 1, 2], target: [0, 0, 0] }, cadPosition: [1, 2, 3] })], [], { modelId: 'mdl-1' });
  const r = compileProcedure(map);
  assert.ok(r.ok);
  assert.deepEqual(r.guide!.steps[0].nodes, nodes);
  assert.deepEqual(r.guide!.steps[0].cadPosition, [1, 2, 3]);
  assert.ok(r.guide!.steps[0].view);
});

test('reverse compiler: assembly binding + parts derived from non-hidden nodes', () => {
  const guide = { id: 'g1', anchorId: 'an', name: 'Bike', description: '', published: false, createdBy: 'x', createdAt: 't', updatedAt: 't',
    assembly: { modelId: 'mdl-9', initialNodes: [{ node: 'cmp:a', show: 'hidden' }], source: 'cortona' } } as unknown as Guide;
  const steps = [{ id: 's1', guideId: 'g1', anchorId: 'an', sequenceNumber: 1, text: 'fit', completionRequired: true, isPlaced: false,
    createdAt: 't', updatedAt: 't', nodes: [{ node: 'cmp:a', show: 'solid', animate: 'insert' }, { node: 'cmp:b', show: 'hidden' }] }] as unknown as GuideStep[];
  const r = guideToProcedureMap(guide, steps);
  assert.equal(r.settings?.assembly?.modelId, 'mdl-9');
  assert.deepEqual(r.settings?.assembly?.initialNodes, [{ node: 'cmp:a', show: 'hidden' }]);
  const meta = r.nodes[0].metadata?.step as Record<string, unknown>;
  assert.deepEqual(meta.parts, ['cmp:a']);
  assert.equal((meta.nodes as unknown[]).length, 2);
  // …and compiling it straight back yields the same deltas.
  const back = compileProcedure({ id: 'm', name: r.name, createdAt: 1, updatedAt: 1, kind: 'procedure', nodes: r.nodes, edges: r.edges, settings: r.settings });
  assert.ok(back.ok);
  assert.equal(back.guide!.steps[0].nodes![0].animate, 'insert');
  assert.equal(back.guide!.steps[0].nodes![0].show, 'solid');
});

test('GLB part tree: names, hierarchy, mesh flags, orphans, cycles', () => {
  const gltf = {
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'root', children: [1, 2] },
      { name: 'cmp:a', mesh: 0 },
      { name: 'grp', children: [3, 1] },        // 1 again → ignored (seen)
      { mesh: 1 },                               // unnamed → node3
      { name: 'orphan', mesh: 2 },               // not in any scene → still listed
    ],
  };
  const t = partTreeOf(gltf);
  assert.deepEqual(t.names, ['root', 'cmp:a', 'grp', 'node3', 'orphan']);
  assert.equal(t.meshCount, 3);
  assert.equal(t.roots.length, 2);
  assert.equal(t.roots[0].children[1].children[0].name, 'node3');
  assert.equal(t.roots[0].children[1].children.length, 1, 'cycle/duplicate reference dropped');
});
