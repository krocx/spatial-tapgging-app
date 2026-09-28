// reduce-clustering.test.ts - the server-side reducer against the device
// (MODEL-VARIANTS.md, prerequisite 4).
//
// The Bee drone is the reference: the iPhone log reads
//   [GLBLoader] parts=719 meshes=183 tris=389641 (source 2131258, budget 700000, indexed)
// The real publication is not in the repo (45 MB, the 3D OMS team's file).
// Put it at test/fixtures/bee.htm (git-ignored) or point SIB_BEE_HTM at it
// and the parity test runs; otherwise it is skipped, not failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHtm } from './cortona-fixture.js';

const BEE = process.env.SIB_BEE_HTM ?? path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'bee.htm');

test('decimate: keeps a box intact under budget, reduces a dense grid to about the target', async () => {
  const { decimate } = await import('../src/models/reduce-clustering.js');
  // A 12-triangle box is never reduced (target floor is 12).
  const box = new Float32Array([0,0,0, 1,0,0, 1,1,0, 0,1,0, 0,0,1, 1,0,1, 1,1,1, 0,1,1]);
  const boxIdx = new Uint32Array([0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1, 3,2,6, 3,6,7, 1,5,6, 1,6,2, 0,3,7, 0,7,4]);
  const b = decimate(box, boxIdx, 0.1);
  assert.equal(b.indices.length, 36);
  // A 100x100 grid (19,602 triangles) reduced to 10 %: within the 1.25x tolerance, positions inside the original bounds.
  const n = 100; const pos = new Float32Array(n * n * 3); const idx: number[] = [];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = y * n + x; pos[i*3] = x / 10; pos[i*3+1] = Math.sin(x / 5) * 0.2; pos[i*3+2] = y / 10; }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) { const i = y * n + x; idx.push(i, i+1, i+n, i+1, i+n+1, i+n); }
  const g = decimate(pos, Uint32Array.from(idx), 0.1);
  const tris = g.indices.length / 3;
  assert.ok(tris > 0 && tris <= Math.trunc(idx.length / 3 * 0.1 * 1.25), `got ${tris}`);
  for (let i = 0; i < g.positions.length; i += 3) assert.ok(g.positions[i] >= 0 && g.positions[i] <= 9.9 && g.positions[i+2] >= 0 && g.positions[i+2] <= 9.9);
  for (const k of g.indices) assert.ok(k < g.positions.length / 3);
});

test('ladder on the synthetic import: nodes, extras and materials untouched', async () => {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  const { buildLadder } = await import('../src/models/variants.js');
  const { clusteringReducer } = await import('../src/models/reduce-clustering.js');
  const { readGlbJson } = await import('../src/models/glb-nodes.js');
  const glb = importCortonaBundle(buildHtm({ parts: 3 })).glb;   // 12 unique triangles, several instances
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-red-'));
  const r = buildLadder(glb, dir, 's', clusteringReducer, { ladder: [24] });
  assert.equal(r.variants.length, 1);
  assert.equal(r.variants[0].algorithm, 'vertex-clustering/1');
  const a = readGlbJson(glb), b = readGlbJson(fs.readFileSync(path.join(dir, 's.24.glb')));
  assert.deepEqual(b.nodes, a.nodes); assert.deepEqual(b.materials, a.materials);
});

// Reference numbers: the iPhone built the pre-hose GLB as parts=719 meshes=183
// tris=389641 from a census of 2,131,258. With the 47 hose sweeps rebuilt as
// geometry (hose.ts) the same algorithm gives 389,090 / 231 primitives from
// 2,160,884 - the device, loading the same file, reproduces these exactly.
test('Bee drone parity with the device: 700 k budget → 389,090 unique triangles, 231 primitives', { skip: !fs.existsSync(BEE) && `no Bee publication at ${BEE}` }, async () => {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  const { buildLadder, meshReferences } = await import('../src/models/variants.js');
  const { clusteringReducer } = await import('../src/models/reduce-clustering.js');
  const { readGlb, readGeometry, geometrySummary } = await import('../src/models/glb-geometry.js');
  const glb = importCortonaBundle(fs.readFileSync(BEE), {}).glb;
  const doc = readGlb(glb);
  assert.equal(geometrySummary(doc, meshReferences(doc.json)).triangles, 2_160_884, 'census = the device census');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-bee-'));
  const r = buildLadder(glb, dir, 'bee', clusteringReducer, { ladder: [700_000] });
  const v = readGeometry(readGlb(fs.readFileSync(path.join(dir, 'bee.700000.glb'))));
  assert.equal(v.stats.triangles, 389_090);
  assert.equal(v.meshes.reduce((n, m) => n + m.primitives.length, 0), 231);
  assert.equal(readGlb(fs.readFileSync(path.join(dir, 'bee.700000.glb'))).json.nodes && (readGlb(fs.readFileSync(path.join(dir, 'bee.700000.glb'))).json.nodes as unknown[]).length, 719);
  assert.ok(r.variants[0].bytes < glb.length / 3, 'a third of the download');
});
