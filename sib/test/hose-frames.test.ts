// hose-frames.test.ts - keyframe sampling for hose flipbooks (import/cortona/hose-frames.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleMotion } from '../src/import/cortona/hose-frames.js';

test('sampleMotion: translation keys interpolate piecewise-linearly, key fractions honoured', () => {
  const m = { def: 'a', field: 'translation' as const, t0: 0, t1: 1, key: [0, 0.25, 1], keyValue: [0, 0, 0, 1, 0, 0, 1, 0, 4] };
  assert.deepEqual(sampleMotion(m, 0), [0, 0, 0]);
  assert.deepEqual(sampleMotion(m, 0.125), [0.5, 0, 0]);
  assert.deepEqual(sampleMotion(m, 0.25), [1, 0, 0]);
  assert.deepEqual(sampleMotion(m, 0.625), [1, 0, 2]);
  assert.deepEqual(sampleMotion(m, 1), [1, 0, 4]);
  // no key list → evenly spaced
  const e = { ...m, key: [] };
  assert.deepEqual(sampleMotion(e, 0.5), [1, 0, 0]);
});

test('sampleMotion: rotation keys slerp about the shared axis', () => {
  const m = { def: 'a', field: 'rotation' as const, t0: 0, t1: 1, key: [], keyValue: [0, 1, 0, 0, 0, 1, 0, Math.PI / 2] };
  const r = sampleMotion(m, 0.5);
  assert.ok(Math.abs(r[3] - Math.PI / 4) < 1e-6, `angle ${r[3]}`);
  assert.ok(Math.abs(r[1] - 1) < 1e-6 && Math.abs(r[0]) < 1e-6 && Math.abs(r[2]) < 1e-6, 'axis stays +Y');
});
