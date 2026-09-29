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
  assert.equal(r.variants[0].algorithm, 'vertex-clustering/3');
  const a = readGlbJson(glb), b = readGlbJson(fs.readFileSync(path.join(dir, 's.24.glb')));
  assert.deepEqual(b.nodes, a.nodes); assert.deepEqual(b.materials, a.materials);
});

// Reference numbers (vertex-clustering/3, 2026-09-29). Census counts each
// hose's flipbook frames once (they draw one at a time): 2,190,510 drawn.
// The floor is a minimum shared by a part's instances, and a cell is never
// coarser than half a part's thinnest extent, so the 8,172-triangle seal
// keeps 5,618 with its full 1.1 mm thickness instead of collapsing to 28.
// The 700 k variant therefore lands a little over its label (715,485 drawn):
// the label is the request, the floors are the promise. The device applies
// the same three rules (GLBLoader.swift) and reproduces these.
test('Bee drone parity with the device: 700 k budget → 857,112 unique triangles, 869 primitives, seal kept whole', { skip: !fs.existsSync(BEE) && `no Bee publication at ${BEE}` }, async () => {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  const { buildLadder, meshReferences } = await import('../src/models/variants.js');
  const { clusteringReducer } = await import('../src/models/reduce-clustering.js');
  const { readGlb, readGeometry, geometrySummary } = await import('../src/models/glb-geometry.js');
  const glb = importCortonaBundle(fs.readFileSync(BEE), {}).glb;
  const doc = readGlb(glb);
  assert.equal(geometrySummary(doc, meshReferences(doc.json)).triangles, 2_190_510, 'census = the device census (frames once per hose)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-bee-'));
  const r = buildLadder(glb, dir, 'bee', clusteringReducer, { ladder: [700_000] });
  const vd = readGlb(fs.readFileSync(path.join(dir, 'bee.700000.glb')));
  const v = readGeometry(vd);
  assert.equal(v.stats.triangles, 857_112);
  assert.equal(v.meshes.reduce((n, m) => n + m.primitives.length, 0), 869);
  assert.equal(r.variants[0].triangles, 715_485, 'drawn: the floors put it just over the label');
  const seal = (vd.json.nodes as Array<{ name?: string; mesh?: number }>).find(n => n.name === 'cmp:seal_cutted_5')!;
  const sealPrim = v.meshes[seal.mesh!].primitives[0];
  assert.equal(sealPrim.indices.length / 3, 5_618, 'the seal keeps its floor');
  let lo = Infinity, hi = -Infinity; for (let i = 2; i < sealPrim.positions.length; i += 3) { lo = Math.min(lo, sealPrim.positions[i]); hi = Math.max(hi, sealPrim.positions[i]); }
  assert.ok(hi - lo > 0.001, 'and its 1.1 mm thickness');
  assert.equal((vd.json.nodes as unknown[]).length, 719 + 47 + 632, 'parts + #rest + frames');
  assert.ok(r.variants[0].bytes < glb.length * 0.55, 'about half the download (the 632 hose frames are never reduced and dominate the file)');
});
