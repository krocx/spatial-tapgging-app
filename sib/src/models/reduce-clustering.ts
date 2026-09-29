// models/reduce-clustering.ts - vertex clustering, the same reduction the
// iPad app runs in GLBLoader.decimate, ported line for line so a variant
// built here is the geometry the device would have built itself.
//
// Per primitive: bound the vertices, choose k cells per axis from the
// target (a surface's triangle count grows with k²), snap every vertex to
// its cell, replace each cell by the average of its vertices, rewrite the
// triangles through the cell map and drop any that lost a corner. Coarsen
// (k × 0.7) until the target is met, six passes at most. Silhouettes and
// large faces survive; threads and chamfers go - what a device over budget
// could not show anyway.
//
// Float32 arithmetic where the app uses Float, so cell boundaries fall in
// the same place. Instances count once per reference in the census, as on
// the device.
//
// Proprietary & Confidential · Applied Materials.

import type { GlbMeshGeometry, GlbPrimitiveGeometry } from './glb-geometry.js';
import type { Reducer, ReduceContext } from './variants.js';

const f = Math.fround;

/** GLBLoader.decimate(positions:indices:keep:) */
export function decimate(positions: Float32Array, indices: Uint32Array, keep: number): { positions: Float32Array; indices: Uint32Array } {
  const triCount = Math.floor(indices.length / 3);
  const target = Math.max(12, Math.trunc(triCount * keep));
  const vertCount = positions.length / 3;
  if (!(triCount > target) || !(vertCount > 8)) return { positions, indices };

  let lx = Infinity, ly = Infinity, lz = Infinity, hx = -Infinity, hy = -Infinity, hz = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < lx) lx = x; if (y < ly) ly = y; if (z < lz) lz = z;
    if (x > hx) hx = x; if (y > hy) hy = y; if (z > hz) hz = z;
  }
  const ext = f(Math.max(f(hx - lx), f(hy - ly), f(hz - lz), 1e-6));
  let k = Math.max(4.0, Math.sqrt(target * 0.9));
  // A cell coarser than the part's thinnest dimension flattens it: a 1 mm
  // seal ring clustered at 4 mm cells became a 276-triangle sliver at 61 %
  // keep. Cells never exceed half the smallest non-zero extent (two cells
  // across the thin axis), so thin parts reduce little or not at all rather
  // than collapse. (Same rule on the device.)
  const exts = [f(hx - lx), f(hy - ly), f(hz - lz)].filter(e => e > 1e-6);
  const minExt = exts.length ? Math.min(...exts) : ext;
  k = Math.max(k, f(ext / f(minExt * 0.5)));
  let best = { positions, indices };

  for (let pass = 0; pass < 6; pass++) {
    const cell = f(ext / f(k));
    const cellOf = new Int32Array(vertCount);
    const map = new Map<number, number>();
    let sums: number[] = [];      // xyz per cell (double accumulators; the app sums Float, differences are sub-micron)
    const counts: number[] = [];
    for (let i = 0; i < vertCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      const gx = Math.floor(f(f(x - lx) / cell)), gy = Math.floor(f(f(y - ly) / cell)), gz = Math.floor(f(f(z - lz) / cell));
      const key = (gx * 2097152 + gy) * 2097152 + gz;     // exact below 2^53 for k < 2^21
      let c = map.get(key);
      if (c === undefined) { c = counts.length; map.set(key, c); sums.push(x, y, z); counts.push(1); }
      else { sums[c * 3] += x; sums[c * 3 + 1] += y; sums[c * 3 + 2] += z; counts[c]++; }
      cellOf[i] = c;
    }
    const newPos = new Float32Array(counts.length * 3);
    for (let c = 0; c < counts.length; c++) {
      newPos[c * 3] = sums[c * 3] / counts[c]; newPos[c * 3 + 1] = sums[c * 3 + 1] / counts[c]; newPos[c * 3 + 2] = sums[c * 3 + 2] / counts[c];
    }
    const tmp = new Uint32Array(triCount * 3); let n = 0;
    for (let t = 0; t < triCount; t++) {
      const a = cellOf[indices[t * 3]], b = cellOf[indices[t * 3 + 1]], c = cellOf[indices[t * 3 + 2]];
      if (a !== b && b !== c && a !== c) { tmp[n++] = a; tmp[n++] = b; tmp[n++] = c; }
    }
    best = { positions: newPos, indices: tmp.slice(0, n) };
    sums = [];
    if (n / 3 <= Math.trunc(target * 1.25)) break;
    k *= 0.7;
  }
  return best;
}

/** Drawn triangles: every mesh counted once per node that references it. */
export function instanceWeightedTriangles(meshes: GlbMeshGeometry[], refs: Map<number, number>): number {
  let n = 0;
  for (const m of meshes) {
    const r = refs.get(m.meshIndex) ?? 0;
    for (const p of m.primitives) n += (p.indices.length / 3) * r;
  }
  return n;
}

/** Primitives under this many triangles are copied through unreduced: the
 *  per-part floor from the architecture review. Clustering a 1,600-triangle
 *  1 mm O-ring at the assembly's ratio flattened it to eight triangles; small
 *  parts are cheap to keep and are the ones an operator has to find. Also
 *  the least a reduced part keeps (a big part never falls below it). */
export const SMALL_PART_TRIANGLES = 5_000;
/** The least any reduced part keeps, however many times it is instanced. */
export const MIN_PART_TRIANGLES = 500;

export const clusteringReducer: Reducer = {
  name: 'vertex-clustering/3',
  reduce(meshes: GlbMeshGeometry[], budget: number, ctx: ReduceContext): GlbMeshGeometry[] {
    const source = instanceWeightedTriangles(meshes, ctx.meshRefs);
    // Budget for the big parts = budget minus what the small ones keep.
    let smallDrawn = 0, bigDrawn = 0;
    for (const m of meshes) { const r = ctx.meshRefs.get(m.meshIndex) ?? 0; for (const p of m.primitives) { const t = (p.indices.length / 3) * r; if (p.indices.length / 3 < SMALL_PART_TRIANGLES) smallDrawn += t; else bigDrawn += t; } }
    if (source <= budget) return meshes;
    const ratio = bigDrawn > 0 ? Math.max(0.01, (budget - smallDrawn) / bigDrawn) : 1;
    if (ratio >= 1) return meshes;
    return meshes.map(m => ({
      meshIndex: m.meshIndex,
      primitives: m.primitives.map((p): GlbPrimitiveGeometry => {
        const tris = p.indices.length / 3;
        if (tris < SMALL_PART_TRIANGLES || ctx.protectedMeshes.has(m.meshIndex)) return p;
        // The floor is a minimum, not only a skip: a part just above it keeps
        // at least the floor rather than falling to a sliver (the
        // 8,000-triangle seal became 28 triangles at 700 k). The floor is
        // shared by a part's instances (a screw drawn 20 times keeps 5,000
        // triangles between them, never fewer than MIN_PART_TRIANGLES each).
        const refs = Math.max(1, ctx.meshRefs.get(m.meshIndex) ?? 1);
        const minKeep = Math.min(tris, Math.max(MIN_PART_TRIANGLES, SMALL_PART_TRIANGLES / refs));
        const r = decimate(p.positions, p.indices, Math.max(ratio, minKeep / tris));
        return { positions: r.positions, indices: r.indices, ...(p.material !== undefined ? { material: p.material } : {}) };
      }),   // an emptied primitive stays in place; the writer drops it
    }));
  },
};
