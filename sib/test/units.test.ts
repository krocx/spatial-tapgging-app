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

test('a publication 1,000x too small is left as published with a units warning (the file carries no unit)', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const r = importCortonaBundle(buildHtm({ parts: 3, unitScale: 0.001 }));
  assert.equal(r.log.units.factor, 1);
  assert.ok(r.log.units.publishedExtentM < 0.001);
  assert.ok(r.log.warnings.some(w => w.startsWith('check the units')), r.log.warnings.join(' | '));
});

test('Units = millimetres brings a millimetre publication back to metres: root scale, deltas untouched, cameras scaled', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const ref = importCortonaBundle(buildHtm({ parts: 3 }));
  const r = importCortonaBundle(buildHtm({ parts: 3, unitScale: 1000 }), { units: 'mm' });   // the same model written in millimetres
  assert.equal(r.log.units.factor, 0.001);
  assert.ok(Math.abs(diag(r.bounds!) - diag(ref.bounds!)) < 1e-4, 'bounds back to the reference size');
  const len = r.glb.readUInt32LE(12); const json = JSON.parse(r.glb.subarray(20, 20 + len).toString());
  const root = json.nodes[json.scenes[0].nodes[0]];
  assert.ok(root.matrix && Math.abs(root.matrix[0] - 0.001) < 1e-9, 'root carries the factor');
  const mv = r.imported.steps.flatMap(s => s.nodes ?? []).find(n => n.to);
  assert.ok(mv && Math.abs(mv.to![1] - 60) < 1e-6, 'delta untouched (60 mm, the publication\'s own number)');
  const rv = ref.imported.steps.find(s => s.view)!.view!, sv = r.imported.steps.find(s => s.view)!.view!;
  assert.ok(Math.abs(sv.position![2] - rv.position![2]) < 1e-4, 'view position back in metres');
  assert.ok(r.log.warnings.some(w => w.includes('scaled by 0.001')));
});

test('units option forces a factor', { skip }, async () => {
  const { importCortonaBundle } = await import('../dist/import/cortona/importer.js');
  const r = importCortonaBundle(buildHtm({ parts: 2, unitScale: 0.001 }), { units: 'm' });
  assert.equal(r.log.units.factor, 1);
  const r2 = importCortonaBundle(buildHtm({ parts: 2 }), { units: 'cm' });
  assert.equal(r2.log.units.factor, 0.01);
});
