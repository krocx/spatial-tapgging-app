// units.test.ts - a publication in the wrong units is scaled at import
// (importer.ts: units). Runs against dist/ (`npm run build` first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtm } from './cortona-fixture.js';

const distReady = fs.existsSync(new URL('../dist/import/cortona/importer.js', import.meta.url));
const skip = !distReady && 'run npm run build first';
const diag = (b: { min: number[]; max: number[] }) => Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);

test('a metre-sized publication is left alone', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const r = importCortonaBundle(buildHtm({ parts: 3 }));
  assert.equal(r.log.units.factor, 1);
  assert.equal(r.log.units.chosen, 'auto');
});

test('a publication 1,000x too small is taken as millimetres and scaled up; deltas stay in the part frame', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const ref = importCortonaBundle(buildHtm({ parts: 3 }));
  const r = importCortonaBundle(buildHtm({ parts: 3, unitScale: 0.001 }));
  assert.equal(r.log.units.factor, 1000, r.log.units.reason);
  assert.ok(r.log.units.publishedExtentM < 0.001);
  assert.ok(Math.abs(diag(r.bounds!) - diag(ref.bounds!)) < 1e-4, 'bounds back to the reference size');
  assert.ok(r.log.warnings.some(w => w.includes('scaled by 1000')));
  // The scale sits on the root; parts keep their local frame, so a step's
  // translation delta is still the publication's own number (in mm here).
  const len = r.glb.readUInt32LE(12); const json = JSON.parse(r.glb.subarray(20, 20 + len).toString());
  const root = json.nodes[json.scenes[0].nodes[0]];
  assert.ok(root.matrix && Math.abs(root.matrix[0] - 1000) < 1e-6, 'root carries the factor');
  const mv = r.imported.steps.flatMap(s => s.nodes ?? []).find(n => n.to);
  assert.ok(mv && Math.abs(mv.to![1] - 0.00006) < 1e-9, 'delta untouched (0.06 m as 0.00006 in the published units)');
  // Cameras are world-space and are scaled with the assembly.
  const rv = ref.imported.steps.find(s => s.view)!.view!, sv = r.imported.steps.find(s => s.view)!.view!;
  assert.ok(Math.abs(rv.position![2] - sv.position![2]) < 1e-4, 'view position scaled');
});

test('units option forces a factor', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const r = importCortonaBundle(buildHtm({ parts: 2, unitScale: 0.001 }), { units: 'm' });
  assert.equal(r.log.units.factor, 1);
  const r2 = importCortonaBundle(buildHtm({ parts: 2 }), { units: 'cm' });
  assert.equal(r2.log.units.factor, 0.01);
});
