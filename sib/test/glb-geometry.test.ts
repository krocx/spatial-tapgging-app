// glb-geometry.test.ts - server-side GLB reader/writer (MODEL-VARIANTS.md,
// prerequisite 3) and the ladder builder's memory rule (prerequisite 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHtm } from './cortona-fixture.js';

async function sampleGlb(): Promise<Buffer> {
  const { importCortonaBundle } = await import('../src/import/cortona/importer.js');
  return importCortonaBundle(buildHtm({ parts: 3 })).glb;
}

test('reader: geometry of the importer GLB, stats match the import log', async () => {
  const { readGlb, readGeometry, geometrySummary } = await import('../src/models/glb-geometry.js');
  const doc = readGlb(await sampleGlb());
  const { meshes, stats } = readGeometry(doc);
  assert.equal(stats.unsupported.length, 0);
  assert.equal(stats.meshes, 1);            // identical geometry shared
  assert.equal(stats.triangles, 12);        // one box
  assert.equal(meshes[0].primitives[0].positions.length / 3, stats.vertices);
  assert.equal(geometrySummary(doc).triangles, 12);
  assert.equal(geometrySummary(doc).geometryBytes, stats.geometryBytes);
});

test('writer: round trip keeps nodes, names, extras, materials; geometry identical', async () => {
  const { readGlb, readGeometry, writeGlbWithGeometry } = await import('../src/models/glb-geometry.js');
  const { readGlbJson } = await import('../src/models/glb-nodes.js');
  const src = await sampleGlb();
  const doc = readGlb(src);
  const { meshes } = readGeometry(doc);
  const out = writeGlbWithGeometry(doc, meshes);
  assert.equal(out.readUInt32LE(0), 0x46546C67);
  assert.equal(out.readUInt32LE(8), out.length);
  const a = readGlbJson(src), b = readGlbJson(out);
  assert.deepEqual(b.nodes, a.nodes);
  assert.deepEqual(b.materials, a.materials);
  assert.deepEqual(b.scenes, a.scenes);
  assert.equal((b.asset as { generator: string }).generator, 'SIB model-variants');
  const again = readGeometry(readGlb(out));
  assert.deepEqual(Array.from(again.meshes[0].primitives[0].indices), Array.from(meshes[0].primitives[0].indices));
  assert.deepEqual(Array.from(again.meshes[0].primitives[0].positions), Array.from(meshes[0].primitives[0].positions));
});

test('reader: uint16 indices, byteStride and unindexed primitives', async () => {
  const { readGlb, readGeometry, writeGlbWithGeometry } = await import('../src/models/glb-geometry.js');
  // Hand-built GLB: one triangle with interleaved xyz+pad (stride 16) and uint16 indices, plus one unindexed triangle.
  const pos = Buffer.alloc(3 * 16); const f = (i: number, x: number, y: number, z: number) => { pos.writeFloatLE(x, i * 16); pos.writeFloatLE(y, i * 16 + 4); pos.writeFloatLE(z, i * 16 + 8); };
  f(0, 0, 0, 0); f(1, 1, 0, 0); f(2, 0, 1, 0);
  const idx = Buffer.alloc(8); idx.writeUInt16LE(0, 0); idx.writeUInt16LE(1, 2); idx.writeUInt16LE(2, 4);
  const pos2 = Buffer.alloc(36); [0, 0, 1, 1, 0, 1, 0, 1, 1].forEach((v, i) => pos2.writeFloatLE(v, i * 4));
  const bin = Buffer.concat([pos, idx, pos2]);
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0, 1] }],
    nodes: [{ name: 'cmp:A', mesh: 0, extras: { partNumber: '1' } }, { name: 'cmp:B', mesh: 1 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }, { primitives: [{ attributes: { POSITION: 2 } }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 3, type: 'VEC3' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48, byteStride: 16 },
      { buffer: 0, byteOffset: 48, byteLength: 6 },
      { buffer: 0, byteOffset: 56, byteLength: 36 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  let jb = Buffer.from(JSON.stringify(json)); const jp = (4 - jb.length % 4) % 4; if (jp) jb = Buffer.concat([jb, Buffer.alloc(jp, 0x20)]);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + jb.length + 8 + bin.length, 8);
  const jc = Buffer.alloc(8); jc.writeUInt32LE(jb.length, 0); jc.writeUInt32LE(0x4E4F534A, 4);
  const bc = Buffer.alloc(8); bc.writeUInt32LE(bin.length, 0); bc.writeUInt32LE(0x004E4942, 4);
  const glb = Buffer.concat([h, jc, jb, bc, bin]);
  const doc = readGlb(glb);
  const { meshes, stats } = readGeometry(doc);
  assert.equal(stats.triangles, 2);
  assert.deepEqual(Array.from(meshes[0].primitives[0].positions), [0, 0, 0, 1, 0, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(meshes[0].primitives[0].indices), [0, 1, 2]);
  assert.deepEqual(Array.from(meshes[1].primitives[0].indices), [0, 1, 2]);
  const out = readGeometry(readGlb(writeGlbWithGeometry(doc, meshes)));
  assert.equal(out.stats.triangles, 2);
  assert.equal(out.stats.unsupported.length, 0);
});

test('ladder: builds only steps below the source, one file each, skipped with reason when memory is short', async () => {
  const { buildLadder, identityReducer, pickVariant, deleteVariants } = await import('../src/models/variants.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-variants-'));
  const glb = await sampleGlb();                       // 12 unique triangles, drawn by several instances
  const r = buildLadder(glb, dir, 'm1', identityReducer, { ladder: [8, 4, 10_000] });
  assert.ok(r.triangles > 12, 'census counts instances, as the device does');
  assert.deepEqual(r.variants.map(v => v.budget), [8, 4]);
  assert.ok(fs.existsSync(path.join(dir, 'm1.8.glb')) && fs.existsSync(path.join(dir, 'm1.4.glb')));
  assert.ok(!fs.existsSync(path.join(dir, 'm1.10000.glb')), 'no variant at or above the source');
  assert.equal(r.variants[0].algorithm, 'identity/1');
  assert.equal(pickVariant(r.variants, 6)?.budget, 8);
  assert.equal(pickVariant(r.variants, 3)?.budget, 4);
  assert.equal(pickVariant(r.variants, 100), null);   // full model
  // Memory short: every step skipped with the user-facing sentence, nothing written.
  const s = buildLadder(glb, dir, 'm2', identityReducer, { ladder: [8], limitBytes: 100 * 1048576 });
  assert.equal(s.variants.length, 0);
  assert.match(s.skipped[0].reason, /needs about/);
  deleteVariants(dir, 'm1', [8, 4]);
  assert.ok(!fs.existsSync(path.join(dir, 'm1.8.glb')));
});
