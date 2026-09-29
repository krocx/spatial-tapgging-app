// assembled-pose.test.ts - switching an imported assembly between "as
// published" and "after the last step" in place, and back, without the
// source publication (models/assembled-pose.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtm } from './cortona-fixture.js';

const distReady = fs.existsSync(new URL('../dist/models/assembled-pose.js', import.meta.url));
const skip = !distReady && 'run npm run build first';

function translationOf(glb: Buffer, name: string): number[] {
  const len = glb.readUInt32LE(12); const json = JSON.parse(glb.subarray(20, 20 + len).toString());
  const n = json.nodes.find((x: { name?: string }) => x.name === name);
  return (n.translation ?? [n.matrix[12], n.matrix[13], n.matrix[14]]).map((v: number) => +v.toFixed(3));
}

test('published → final → published round-trips the GLB and the initial state', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const { switchAssembledPose } = await import('../dist/models/assembled-pose.js');
  // A publication saved exploded, imported "as published" (the wrong choice).
  const r = importCortonaBundle(buildHtm({ parts: 3, publishedExploded: true }), { restPose: 'published' });
  assert.equal(r.assembledPose, 'published');
  assert.deepEqual(translationOf(r.glb, 'cmp:PN_0190-10001_1'), [0.1, 0.6, 0]);
  const steps = r.imported.steps.map(s => s.nodes ?? []);
  const initial0 = r.initialNodes;
  // Fix it in place.
  const a = switchAssembledPose(r.glb, initial0, steps, 'final');
  assert.equal(a.changed, 3);
  assert.deepEqual(translationOf(a.glb, 'cmp:PN_0190-10001_1'), [0.1, 0.06, 0]);
  const mine = a.initialNodes.filter(n => n.sourceKey === 'rest-pose');
  assert.equal(mine.length, 3);
  for (const n of mine) assert.equal(n.to![1], 0.6);
  // Idempotent.
  const again = switchAssembledPose(a.glb, a.initialNodes, steps, 'final');
  assert.equal(again.changed, 0);
  // And back.
  const b = switchAssembledPose(a.glb, a.initialNodes, steps, 'published');
  assert.equal(b.changed, 3);
  assert.deepEqual(translationOf(b.glb, 'cmp:PN_0190-10001_1'), [0.1, 0.6, 0]);
  assert.equal(b.initialNodes.filter(n => n.sourceKey === 'rest-pose').length, 0);
  assert.equal(b.initialNodes.length, initial0.length);
  // BIN chunk untouched: geometry byte length identical.
  const binLen = (g: Buffer) => g.readUInt32LE(20 + g.readUInt32LE(12));
  assert.equal(binLen(b.glb), binLen(r.glb));
});

test('an import rebased at import switches back to published with the same rule', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const { switchAssembledPose } = await import('../dist/models/assembled-pose.js');
  const r = importCortonaBundle(buildHtm({ parts: 2, publishedExploded: true }));   // auto → final
  assert.equal(r.assembledPose, 'final');
  assert.equal(r.initialNodes.filter(n => n.sourceKey === 'rest-pose').length, 2);
  const b = switchAssembledPose(r.glb, r.initialNodes, r.imported.steps.map(s => s.nodes ?? []), 'published');
  assert.equal(b.changed, 2);
  assert.deepEqual(translationOf(b.glb, 'cmp:PN_0190-10002_1'), [0.2, 0.6, 0]);
});
