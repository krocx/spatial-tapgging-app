// models/glb-geometry.ts - read a GLB's mesh geometry and write it back
// with the geometry replaced, everything else verbatim.
//
// Phase B of model optimisation (docs/ar-ojt/MODEL-VARIANTS.md,
// prerequisite 3): server-side variants are built from the stored GLB, not
// only at Cortona import, so models imported earlier and direct uploads get
// them too. The reader gives each mesh primitive as positions (float32) +
// triangle indices (uint32); the writer takes the same shape back and emits
// a new BIN chunk. Nodes, names, extras, materials, transforms, scenes,
// asset: copied through untouched - steps address parts by node name, so a
// variant must never rename or merge anything.
//
// Own code, no library. Handles the accessor shapes real exporters produce
// (uint8/16/32 indices, byteStride, unindexed primitives, sparse is not
// supported and is reported). Only POSITION and indices are carried over;
// NORMAL / TEXCOORD are dropped in the output because the device computes
// normals at build time and our CAD models are untextured (as the importer's
// own GLBs already are).
//
// Proprietary & Confidential · Applied Materials.

import { readGlbJson } from './glb-nodes.js';

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN  = 0x004e4942;

/** One triangle-list primitive. */
export interface GlbPrimitiveGeometry {
  positions: Float32Array;   // xyz per vertex
  indices:   Uint32Array;    // 3 per triangle
  material?: number;
}

export interface GlbMeshGeometry {
  meshIndex:  number;
  primitives: GlbPrimitiveGeometry[];
}

export interface GlbDocument {
  json: Record<string, unknown>;
  bin:  Buffer;
}

export interface GlbGeometryStats {
  meshes:        number;
  primitives:    number;
  vertices:      number;
  triangles:     number;
  /** Bytes of positions + indices as float32 / uint32 - what a reduction holds in memory. */
  geometryBytes: number;
  unsupported:   string[];
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function readGlb(buf: Buffer): GlbDocument {
  const json = readGlbJson(buf);
  const jsonLen = buf.readUInt32LE(12);
  let off = 20 + jsonLen;
  let bin: Buffer = Buffer.alloc(0);
  if (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    if (type === CHUNK_BIN) {
      if (off + 8 + len > buf.length) throw new Error('GLB BIN chunk truncated');
      bin = buf.subarray(off + 8, off + 8 + len);
    }
  }
  const buffers = Array.isArray(json.buffers) ? json.buffers as Array<{ uri?: string }> : [];
  if (buffers.some(b => typeof b.uri === 'string')) throw new Error('GLB with external buffers is not supported');
  return { json, bin };
}

type Accessor = { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown; normalized?: boolean };
type BufferView = { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number };

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

function readAccessor(doc: GlbDocument, index: number): Float64Array {
  const accs = (doc.json.accessors as Accessor[] | undefined) ?? [];
  const views = (doc.json.bufferViews as BufferView[] | undefined) ?? [];
  const a = accs[index];
  if (!a) throw new Error(`accessor ${index} missing`);
  if (a.sparse) throw new Error(`accessor ${index} is sparse (unsupported)`);
  const n = COMPONENTS[a.type]; const bytes = BYTES[a.componentType];
  if (!n || !bytes) throw new Error(`accessor ${index}: unsupported type ${a.type}/${a.componentType}`);
  const out = new Float64Array(a.count * n);
  if (a.bufferView === undefined) return out;              // all zeros per spec
  const v = views[a.bufferView];
  if (!v) throw new Error(`bufferView ${a.bufferView} missing`);
  const stride = v.byteStride ?? n * bytes;
  const base = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (base + (a.count - 1) * stride + n * bytes > doc.bin.length) throw new Error(`accessor ${index} overruns BIN`);
  const dv = new DataView(doc.bin.buffer, doc.bin.byteOffset, doc.bin.byteLength);
  for (let i = 0; i < a.count; i++) {
    const o = base + i * stride;
    for (let k = 0; k < n; k++) {
      const p = o + k * bytes;
      let x: number;
      switch (a.componentType) {
        case 5120: x = dv.getInt8(p); break;
        case 5121: x = dv.getUint8(p); break;
        case 5122: x = dv.getInt16(p, true); break;
        case 5123: x = dv.getUint16(p, true); break;
        case 5125: x = dv.getUint32(p, true); break;
        default:   x = dv.getFloat32(p, true);
      }
      out[i * n + k] = x;
    }
  }
  return out;
}

/** Geometry of every mesh, in mesh order. Non-triangle primitives are skipped
 *  and listed in `unsupported`. */
export function readGeometry(doc: GlbDocument): { meshes: GlbMeshGeometry[]; stats: GlbGeometryStats } {
  const meshesJ = (doc.json.meshes as Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; material?: number; mode?: number }> }> | undefined) ?? [];
  const stats: GlbGeometryStats = { meshes: meshesJ.length, primitives: 0, vertices: 0, triangles: 0, geometryBytes: 0, unsupported: [] };
  const meshes: GlbMeshGeometry[] = [];
  meshesJ.forEach((m, mi) => {
    const prims: GlbPrimitiveGeometry[] = [];
    (m.primitives ?? []).forEach((p, pi) => {
      const mode = p.mode ?? 4;
      if (mode !== 4) { stats.unsupported.push(`mesh ${mi} primitive ${pi}: mode ${mode}`); return; }
      if (p.attributes?.POSITION === undefined) { stats.unsupported.push(`mesh ${mi} primitive ${pi}: no POSITION`); return; }
      try {
        const pos64 = readAccessor(doc, p.attributes.POSITION);
        const positions = Float32Array.from(pos64);
        let indices: Uint32Array;
        if (p.indices !== undefined) indices = Uint32Array.from(readAccessor(doc, p.indices));
        else { indices = new Uint32Array(positions.length / 3); for (let i = 0; i < indices.length; i++) indices[i] = i; }
        const tri = Math.floor(indices.length / 3);
        prims.push({ positions, indices: indices.subarray(0, tri * 3), ...(p.material !== undefined ? { material: p.material } : {}) });
        stats.primitives++; stats.vertices += positions.length / 3; stats.triangles += tri;
        stats.geometryBytes += positions.byteLength + tri * 12;
      } catch (e) {
        stats.unsupported.push(`mesh ${mi} primitive ${pi}: ${(e as Error).message}`);
      }
    });
    meshes.push({ meshIndex: mi, primitives: prims });
  });
  return { meshes, stats };
}

/** Cheap look at a GLB without decoding vertices: triangle count from the
 *  index accessors, geometry bytes from accessor sizes. */
export function geometrySummary(doc: GlbDocument, meshRefs?: Map<number, number>): { triangles: number; geometryBytes: number } {
  const accs = (doc.json.accessors as Accessor[] | undefined) ?? [];
  const meshesJ = (doc.json.meshes as Array<{ primitives: Array<{ attributes: Record<string, number>; indices?: number; mode?: number }> }> | undefined) ?? [];
  let triangles = 0, bytes = 0;
  const seen = new Set<number>();
  meshesJ.forEach((m, mi) => { for (const p of m.primitives ?? []) {
    if ((p.mode ?? 4) !== 4) continue;
    const pa = accs[p.attributes?.POSITION ?? -1];
    if (!pa) continue;
    const w = meshRefs ? (meshRefs.get(mi) ?? 0) : 1;     // instances draw once per reference
    if (p.indices !== undefined) { const ia = accs[p.indices]; if (ia) { triangles += Math.floor(ia.count / 3) * w; if (!seen.has(p.indices)) { seen.add(p.indices); bytes += ia.count * 4; } } }
    else triangles += Math.floor(pa.count / 3) * w;
    if (!seen.has(p.attributes.POSITION)) { seen.add(p.attributes.POSITION); bytes += pa.count * 12; }
  } });
  return { triangles, geometryBytes: bytes };
}

// ── Write ────────────────────────────────────────────────────────────────────

/** The document with its mesh geometry replaced. `meshes` must cover the same
 *  mesh indices with the same primitive count and order (materials keep
 *  their slots); anything else in the JSON is copied through. */
export function writeGlbWithGeometry(doc: GlbDocument, meshes: GlbMeshGeometry[], generator = 'SIB model-variants'): Buffer {
  const json = JSON.parse(JSON.stringify(doc.json)) as Record<string, unknown>;
  const meshesJ = (json.meshes as Array<{ primitives: Array<Record<string, unknown>> }> | undefined) ?? [];
  const bin: Buffer[] = []; let binLen = 0;
  const bufferViews: unknown[] = []; const accessors: unknown[] = [];
  const pushView = (data: Buffer, target: number): number => {
    const pad = (4 - (binLen % 4)) % 4;
    if (pad) { bin.push(Buffer.alloc(pad)); binLen += pad; }
    const idx = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: binLen, byteLength: data.length, target });
    bin.push(data); binLen += data.length;
    return idx;
  };
  const byMesh = new Map(meshes.map(m => [m.meshIndex, m]));
  meshesJ.forEach((m, mi) => {
    const g = byMesh.get(mi);
    const prims = m.primitives ?? [];
    if (!g) throw new Error(`no geometry for mesh ${mi}`);
    const triPrims = prims.filter(p => ((p.mode as number | undefined) ?? 4) === 4 && (p.attributes as Record<string, number> | undefined)?.POSITION !== undefined);
    if (triPrims.length !== g.primitives.length) throw new Error(`mesh ${mi}: ${g.primitives.length} geometries for ${triPrims.length} triangle primitives`);
    let k = 0;
    m.primitives = prims.map(p => {
      const isTri = ((p.mode as number | undefined) ?? 4) === 4 && (p.attributes as Record<string, number> | undefined)?.POSITION !== undefined;
      if (!isTri) return p;   // left as-is but its accessors are gone: drop it
      const pg = g.primitives[k++];
      if (pg.indices.length < 3 || pg.positions.length < 9) return { mode: -1 };   // emptied by reduction: dropped below
      const pos = Buffer.from(pg.positions.buffer, pg.positions.byteOffset, pg.positions.byteLength);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pg.positions.length; i += 3) for (let a = 0; a < 3; a++) {
        const v = pg.positions[i + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v;
      }
      const posAcc = accessors.length;
      accessors.push({ bufferView: pushView(pos, 34962), componentType: 5126, count: pg.positions.length / 3, type: 'VEC3', min, max });
      const idx = Buffer.from(pg.indices.buffer, pg.indices.byteOffset, pg.indices.byteLength);
      const idxAcc = accessors.length;
      accessors.push({ bufferView: pushView(idx, 34963), componentType: 5125, count: pg.indices.length, type: 'SCALAR' });
      const out: Record<string, unknown> = { attributes: { POSITION: posAcc }, indices: idxAcc, mode: 4 };
      if (p.material !== undefined) out.material = p.material;
      return out;
    }).filter(p => ((p.mode as number | undefined) ?? 4) === 4 && (p.attributes as Record<string, number> | undefined)?.POSITION !== undefined);
  });
  json.accessors = accessors; json.bufferViews = bufferViews;
  json.buffers = [{ byteLength: binLen + ((4 - (binLen % 4)) % 4) }];
  const asset = (json.asset as Record<string, unknown> | undefined) ?? { version: '2.0' };
  json.asset = { ...asset, version: '2.0', generator };
  delete json.images; delete json.textures; delete json.samplers;   // no texture data survives geometry-only output
  for (const mat of (json.materials as Array<Record<string, unknown>> | undefined) ?? []) {
    const pbr = mat.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) { delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture; }
    delete mat.normalTexture; delete mat.occlusionTexture; delete mat.emissiveTexture;
  }

  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  const jpad = (4 - (jsonBuf.length % 4)) % 4; if (jpad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  let binBuf = Buffer.concat(bin);
  const bpad = (4 - (binBuf.length % 4)) % 4; if (bpad) binBuf = Buffer.concat([binBuf, Buffer.alloc(bpad)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(MAGIC, 0); header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jc = Buffer.alloc(8); jc.writeUInt32LE(jsonBuf.length, 0); jc.writeUInt32LE(CHUNK_JSON, 4);
  const bc = Buffer.alloc(8); bc.writeUInt32LE(binBuf.length, 0); bc.writeUInt32LE(CHUNK_BIN, 4);
  return Buffer.concat([header, jc, jsonBuf, bc, binBuf]);
}
