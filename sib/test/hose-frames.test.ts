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

// A hose owner's show/hide is carried onto the tube standing in for it (the
// current frame, else the rest tube); a hide covers every frame. Runs on the
// Bee publication when it is available (SIB_BEE_HTM or test/fixtures/bee.htm).
import fs from 'node:fs';
import path from 'node:path';
const BEE = process.env.SIB_BEE_HTM ?? path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'bee.htm');
test('owner show/hide reaches the hose tubes (Bee seal_O-ring_anim_7)', { skip: !fs.existsSync(BEE) && `no Bee publication at ${BEE}` }, async () => {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  const r = importCortonaBundle(fs.readFileSync(BEE), {});
  assert.ok((r.log.scene.hoseFrames?.carried ?? 0) > 0, 'some deltas carried');
  const s1 = r.imported.steps[0].nodes ?? [];
  const ownerHide = s1.find(n => n.node === 'cmp:seal_O-ring_anim_7' && n.show === 'hidden' && n.delaySec === 4);
  assert.ok(ownerHide, 'the owner is hidden at 4 s');
  const frameHides = s1.filter(n => /^cmp:seal_O-ring_anim_7#s\d+f\d+$/.test(n.node) && n.show === 'hidden' && n.delaySec === 4);
  assert.equal(new Set(frameHides.map(n => n.node)).size, 8, 'every frame is hidden with it');
  assert.ok(s1.some(n => n.node === 'cmp:seal_O-ring_anim_7#rest' && n.show === 'hidden' && n.delaySec === 4), 'and the rest tube');
  // Nothing of the hose is visible after step 1.
  const st = new Map<string, string>();
  for (const n of [...(r.initialNodes), ...s1]) if (n.show) st.set(n.node, n.show);
  for (const [k, v] of st) if (k.startsWith('cmp:seal_O-ring_anim_7')) assert.equal(v, 'hidden', k);
});
