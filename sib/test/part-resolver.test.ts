/**
 * Part resolver (backlog #6): a step reference the model no longer has by
 * name is found again by objectID, part number or display name - only when
 * unambiguous - and rebindParts re-points the guide's node lists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuideStepNode } from '@spatial/shared';
import { buildPartIndex, resolvePart, rebindParts } from '../src/models/part-resolver.js';

const gltf = {
  scenes: [{ nodes: [0] }],
  nodes: [
    { name: 'base', children: [1, 2, 3, 4] },
    { name: 'cmp:Bolt_1', mesh: 0, extras: { objectID: 101, partNumber: 'B-100', displayName: 'Bolt M6' } },
    { name: 'cmp:Bolt_2', mesh: 0, extras: { objectID: 102, partNumber: 'B-100', displayName: 'Bolt M6' } },
    { name: 'cmp:Lid_v2', mesh: 0, extras: { objectID: 7, partNumber: 'L-7', displayName: 'Lid' } },
    { name: 'cmp:Housing', mesh: 0, extras: { objectID: 9 } },
  ],
};

test('name wins; objectID recovers a renamed DEF; shared handles are not a match', () => {
  const idx = buildPartIndex(gltf);
  assert.deepEqual(resolvePart(idx, { node: 'cmp:Housing' }), { name: 'cmp:Housing', by: 'name' });
  assert.deepEqual(resolvePart(idx, { node: 'cmp:Lid', sourceKey: '7' }), { name: 'cmp:Lid_v2', by: 'objectID' });
  assert.deepEqual(resolvePart(idx, { node: 'cmp:Lid' }), { name: 'cmp:Lid_v2', by: 'displayName' });
  // Two bolts share part number and display name: nothing to pick.
  assert.equal(resolvePart(idx, { node: 'cmp:Bolt_old' }, { partNumber: 'B-100' }), null);
  assert.equal(resolvePart(idx, { node: 'cmp:Gone' }), null);
});

test('rebindParts re-points the lists in place and reports once per rename', () => {
  const idx = buildPartIndex(gltf);
  const initial: GuideStepNode[] = [{ node: 'cmp:Lid', show: 'hidden' }];
  const step1: GuideStepNode[] = [{ node: 'cmp:Lid', sourceKey: '7', show: 'solid' }, { node: 'cmp:Housing' }];
  const step2: GuideStepNode[] = [{ node: 'cmp:Gone' }];
  const r = rebindParts(idx, [initial, step1, step2]);
  assert.equal(r.total, 4); assert.equal(r.matched, 3);
  assert.deepEqual(r.renamed, [{ from: 'cmp:Lid', to: 'cmp:Lid_v2', by: 'displayName' }]);
  assert.deepEqual(r.unmatched, ['cmp:Gone']);
  assert.equal(initial[0].node, 'cmp:Lid_v2'); assert.equal(step1[0].node, 'cmp:Lid_v2');
});
