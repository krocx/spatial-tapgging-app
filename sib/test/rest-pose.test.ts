// rest-pose.test.ts - the model's rest pose is the assembled state even when
// the publication holds the exploded start (rest-pose.ts). Runs against
// dist/ (`npm run build` first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtm } from './cortona-fixture.js';

const distReady = fs.existsSync(new URL('../dist/import/cortona/importer.js', import.meta.url));
const skip = !distReady && 'run npm run build first';

function nodeTranslation(glb: Buffer, name: string): number[] {
  const len = glb.readUInt32LE(12); const json = JSON.parse(glb.subarray(20, 20 + len).toString());
  const n = json.nodes.find((x: { name?: string }) => x.name === name);
  assert.ok(n, `node ${name}`);
  return n.translation ?? (n.matrix ? [n.matrix[12], n.matrix[13], n.matrix[14]] : [0, 0, 0]);
}

test('published assembled with a set-up step: rest pose kept as published', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const r = importCortonaBundle(buildHtm({ parts: 3 }));
  assert.equal(r.log.restPose.chosen, 'published');
  assert.equal(r.log.restPose.rebased, 0);
  assert.deepEqual(nodeTranslation(r.glb, 'cmp:PN_0190-10001_1').map(v => +v.toFixed(3)), [0.1, 0.06, 0]);
});

test('published exploded with no set-up step: end state becomes rest, initial state restores the start', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const r = importCortonaBundle(buildHtm({ parts: 3, publishedExploded: true }));
  assert.equal(r.log.procedure.setupSubsteps, 0);
  assert.equal(r.log.restPose.chosen, 'final', JSON.stringify(r.log.restPose));
  assert.equal(r.log.restPose.rebased, 3);
  assert.ok(r.log.restPose.extentM.published > r.log.restPose.extentM.final);
  // GLB holds the assembled pose ...
  for (let i = 1; i <= 3; i++) assert.deepEqual(nodeTranslation(r.glb, `cmp:PN_0190-1000${i}_1`).map(v => +v.toFixed(3)), [+(0.1 * i).toFixed(3), 0.06, 0]);
  // ... the initial state puts each part back at its published start ...
  const start = r.initialNodes.filter(n => n.to);
  assert.equal(start.length, 3);
  for (const n of start) assert.equal(n.to![1], 0.6);
  // ... and the motions now read as inserts (they end at rest).
  const inserts = r.imported.steps.flatMap(s => s.nodes ?? []).filter(n => n.animate === 'insert');
  assert.equal(inserts.length, 3);
  assert.ok(r.log.warnings.some(w => w.includes('rest pose taken from the end state')));
});

test('restPose: published keeps the exploded publication as it is', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const r = importCortonaBundle(buildHtm({ parts: 2, publishedExploded: true }), { restPose: 'published' });
  assert.equal(r.log.restPose.chosen, 'published');
  assert.deepEqual(nodeTranslation(r.glb, 'cmp:PN_0190-10001_1').map(v => +v.toFixed(3)), [0.1, 0.6, 0]);
});
