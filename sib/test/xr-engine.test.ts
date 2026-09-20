// xr-engine.test.ts — B3: the WebXR kit's pure engine (sib/portal/xr-engine.js)
// follows the timeline contract in docs/ar-ojt/UNITY-RUNTIME.md §4 — the same
// one the iOS AssemblyState / AssemblyNode implement.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const enginePath = [path.join(here, '../portal/xr-engine.js'), path.join(here, '../../sib/portal/xr-engine.js'), '/tmp/portal/xr-engine.js']
  .find(p => fs.existsSync(p))!;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const E: any = await import(enginePath);

const initial = [
  { node: 'cmp:A', show: 'hidden' },
  { node: 'cmp:B', show: 'ghost', opacity: 0.2 },
];
const steps = [
  { nodes: [{ node: 'cmp:A', animate: 'insert', from: [0, 1, 0], to: [0, 0, 0], delaySec: 0, durationSec: 2 }] },
  { nodes: [{ node: 'cmp:B', show: 'solid', delaySec: 1 }, { node: 'cmp:A', effect: 'flash', delaySec: 0.5 }] },
  { nodes: [{ node: 'cmp:A', animate: 'remove', to: [0, 1, 0], show: 'hidden', delaySec: 0, durationSec: 1 }] },
];

test('stateBefore folds initial nodes then steps cumulatively (last write wins)', () => {
  const s0 = E.stateBefore(initial, steps, 0);
  assert.equal(s0.get('cmp:A').show, 'hidden');
  assert.equal(s0.get('cmp:B').show, 'ghost');
  assert.equal(s0.get('cmp:B').opacity, 0.2);

  const s1 = E.stateBefore(initial, steps, 1);          // after step 0: A inserted at [0,0,0]
  assert.equal(s1.get('cmp:A').show, 'solid');
  assert.deepEqual(s1.get('cmp:A').position, [0, 0, 0]);

  const s2 = E.stateBefore(initial, steps, 2);          // after step 1: B solid; flash changed nothing on A
  assert.equal(s2.get('cmp:B').show, 'solid');
  assert.deepEqual(s2.get('cmp:A').position, [0, 0, 0]);

  const s3 = E.stateAfter(initial, steps, 2);           // after step 2: A hidden, parked at [0,1,0]
  assert.equal(s3.get('cmp:A').show, 'hidden');
  assert.deepEqual(s3.get('cmp:A').position, [0, 1, 0]);
});

test('a motion on a hidden part reveals it (solid) even without animate', () => {
  const s = E.stateBefore([{ node: 'cmp:X', show: 'hidden' }], [{ nodes: [{ node: 'cmp:X', to: [1, 0, 0] }] }], 1);
  assert.equal(s.get('cmp:X').show, 'solid');
});

test('scheduleStep applies speed, floors, and orders by time then depth', () => {
  const depth = (n: string) => (n === 'cmp:group' ? 0 : 1);
  const sched = E.scheduleStep([
    { node: 'cmp:child', show: 'solid', delaySec: 1, durationSec: 0.1 },
    { node: 'cmp:group', show: 'ghost', delaySec: 1, durationSec: 0.1 },
    { node: 'cmp:m', to: [0, 0, 1], delaySec: 0, durationSec: 0.1 },
  ], 0.5, depth);
  assert.deepEqual(sched.map((e: any) => e.delta.node), ['cmp:m', 'cmp:group', 'cmp:child']);
  assert.equal(sched[0].startSec, 0);
  assert.equal(sched[0].durationSec, 0.8);      // motion floor
  assert.equal(sched[1].startSec, 2);           // 1 s / 0.5
  assert.equal(sched[1].durationSec, 0.25);     // visibility floor
  assert.equal(E.scheduleLength(sched), 2.25);
});

test('hideAfterMotion + flash flags', () => {
  const sched = E.scheduleStep(steps[2].nodes, 1);
  assert.equal(sched[0].hideAfterMotion, true);
  const f = E.scheduleStep(steps[1].nodes, 1).find((e: any) => e.delta.node === 'cmp:A');
  assert.equal(f.flash, true);
  assert.equal(f.motion, false);
});

test('stepParts ignores flash-only deltas', () => {
  assert.deepEqual(E.stepParts(steps[1]), ['cmp:B']);
  assert.deepEqual(E.stepParts(steps[0]), ['cmp:A']);
});

test('originForSurface puts the bounds bottom-centre on the hit point', () => {
  const bounds = { min: [-1, 0.5, -1], max: [1, 2.5, 3] };
  const o = E.originForSurface([10, 0, 10], bounds, 1);
  assert.deepEqual(o, [10, -0.5, 9]);          // centre x=0, bottom y=0.5, centre z=1
  const o2 = E.originForSurface([10, 0, 10], bounds, 2);
  assert.deepEqual(o2, [10, -1, 8]);
  assert.deepEqual(E.originForSurface([1, 2, 3], undefined), [1, 2, 3]);
});

test('attentionFor buckets like the iOS sampler', () => {
  assert.equal(E.attentionFor({ placed: false }), 'none');
  assert.equal(E.attentionFor({ placed: true, panelOpen: true, hitsTarget: true }), 'panel');
  assert.equal(E.attentionFor({ placed: true, hitsTarget: true, hitsAssembly: true }), 'target');
  assert.equal(E.attentionFor({ placed: true, hitsAssembly: true }), 'assembly');
  assert.equal(E.attentionFor({ placed: true }), 'away');
});
