// models/variants.ts - the variant ladder for an assembly model.
//
// docs/ar-ojt/MODEL-VARIANTS.md. A model keeps its full GLB; this builds the
// reduced copies a device asks for by triangle budget, one at a time, each
// written to disk before the next starts so the memory peak is source + one
// variant (prerequisite 2). The reducer itself is a plug-in behind
// `Reducer`; the algorithm name + version is stamped on every variant so a
// change re-derives them and a record says what geometry an operator saw.
//
// Prerequisite 4 (the vertex-clustering port with the Bee fixture) provides
// the first reducer; until then `buildLadder` runs with `identityReducer`
// only in tests.
//
// Proprietary & Confidential · Applied Materials.

import fs from 'node:fs';
import path from 'node:path';
import { readGlb, readGeometry, geometrySummary, writeGlbWithGeometry, type GlbMeshGeometry } from './glb-geometry.js';
import { checkWorkerMemory, variantNeedBytes } from '../memory.js';

/** Approved ladder (2026-09-28): the device tiers the app already uses. */
export const VARIANT_LADDER: readonly number[] = [2_500_000, 1_200_000, 700_000, 350_000];

export interface ModelVariant {
  budget:    number;   // triangles asked for
  triangles: number;   // triangles delivered
  bytes:     number;
  algorithm: string;   // e.g. "vertex-clustering/1"
  builtAt:   string;
}

/** A reducer takes the full geometry and a budget and returns geometry with
 *  the same mesh/primitive layout and at most `budget` triangles in total. */
export interface Reducer {
  readonly name: string;
  reduce(meshes: GlbMeshGeometry[], budget: number, context: ReduceContext): GlbMeshGeometry[];
}

export interface ReduceContext {
  /** Mesh indices used by parts a step touches - never reduced below their floor. */
  protectedMeshes: Set<number>;
}

/** Copies geometry through unchanged - for tests and for a model already under budget. */
export const identityReducer: Reducer = {
  name: 'identity/1',
  reduce: (meshes) => meshes,
};

export function variantPath(modelsDir: string, modelId: string, budget: number): string {
  return path.join(modelsDir, `${modelId}.${budget}.glb`);
}

/** Which variant serves a request for `budget` triangles: the smallest
 *  variant whose budget is at or above it, else the full model (`null`). */
export function pickVariant(variants: ModelVariant[], budget: number): ModelVariant | null {
  const fit = variants.filter(v => v.budget >= budget).sort((a, b) => a.budget - b.budget);
  return fit[0] ?? null;
}

export interface LadderResult {
  variants: ModelVariant[];
  /** Source triangle count. */
  triangles: number;
  skipped:  { budget: number; reason: string }[];
}

/** Build every ladder step the source is larger than, writing each to disk
 *  before the next starts. Throws only for an unreadable source; a step that
 *  cannot fit in memory is skipped with a reason. */
export function buildLadder(
  glb: Buffer, modelsDir: string, modelId: string, reducer: Reducer,
  opts: { ladder?: readonly number[]; protectedMeshes?: Set<number>; limitBytes?: number } = {},
): LadderResult {
  const ladder = opts.ladder ?? VARIANT_LADDER;
  const doc = readGlb(glb);
  const summary = geometrySummary(doc);
  const result: LadderResult = { variants: [], triangles: summary.triangles, skipped: [] };
  const steps = ladder.filter(b => b < summary.triangles);
  if (!steps.length) return result;

  const mem = checkWorkerMemory(variantNeedBytes(summary.geometryBytes), 'Reducing this model', opts.limitBytes);
  if (!mem.ok) { for (const b of steps) result.skipped.push({ budget: b, reason: mem.message! }); return result; }

  const { meshes, stats } = readGeometry(doc);
  if (stats.unsupported.length) console.warn(`[SIB/variants] ${modelId}: ${stats.unsupported.length} primitive(s) skipped: ${stats.unsupported.slice(0, 3).join('; ')}`);
  const ctx: ReduceContext = { protectedMeshes: opts.protectedMeshes ?? new Set() };

  for (const budget of steps) {
    const reduced = reducer.reduce(meshes, budget, ctx);
    const triangles = reduced.reduce((n, m) => n + m.primitives.reduce((k, p) => k + p.indices.length / 3, 0), 0);
    const out = writeGlbWithGeometry(doc, reduced);
    const file = variantPath(modelsDir, modelId, budget);
    fs.writeFileSync(file + '.tmp', out);
    fs.renameSync(file + '.tmp', file);
    result.variants.push({ budget, triangles, bytes: out.length, algorithm: reducer.name, builtAt: new Date().toISOString() });
    // `out` and `reduced` go out of scope here - the next step starts from `meshes` again.
  }
  return result;
}

export function deleteVariants(modelsDir: string, modelId: string, ladder: readonly number[] = VARIANT_LADDER): void {
  for (const b of ladder) { try { fs.unlinkSync(variantPath(modelsDir, modelId, b)); } catch { /* absent */ } }
}
