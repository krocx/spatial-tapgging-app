// worker.ts - the heavy jobs, off the request thread.
//
// Started per job by import/jobs.ts. Two kinds:
//   cortona  - parse a published RapidManual, write the GLB, then build the
//              variant ladder for it (MODEL-VARIANTS.md) in the same worker.
//   variants - (re)build the ladder for a model already on disk.
// The buffer arrives transferred (zero copy); the GLB goes back the same
// way. If this worker dies for memory the main process stays up and the
// job is reported as failed - the whole point of running it here.

import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { importCortonaBundle, type CortonaImportOptions } from './cortona/importer.js';
import { buildLadder, type LadderResult } from '../models/variants.js';
import { clusteringReducer } from '../models/reduce-clustering.js';

type Input =
  | { kind: 'cortona'; buffer: ArrayBuffer; opts: CortonaImportOptions; modelId: string; modelsDir: string }
  | { kind: 'variants'; modelId: string; modelsDir: string };

const input = workerData as Input;

function ladderFor(glb: Buffer, modelId: string, modelsDir: string): LadderResult {
  const t0 = Date.now();
  const r = buildLadder(glb, modelsDir, modelId, clusteringReducer, {});
  console.log(`[SIB/variants] ${modelId}: ${r.variants.map(v => `${v.budget}→${v.triangles}`).join(', ') || 'none needed'} ` +
              `(${r.triangles} drawn) in ${((Date.now() - t0) / 1000).toFixed(1)} s` + (r.skipped.length ? `; ${r.skipped.length} skipped` : ''));
  return r;
}

try {
  if (input.kind === 'cortona') {
    const result = importCortonaBundle(Buffer.from(input.buffer), input.opts);
    const ladder = ladderFor(result.glb, input.modelId, input.modelsDir);
    const glb = new Uint8Array(result.glb).slice().buffer as ArrayBuffer;   // own, transferable copy
    parentPort!.postMessage({
      ok: true,
      imported: result.imported,
      log: result.log,
      initialNodes: result.initialNodes,
      bounds: result.bounds,
      ladder,
      glb,
    }, [glb]);
  } else {
    const glb = fs.readFileSync(path.join(input.modelsDir, `${input.modelId}.glb`));
    const ladder = ladderFor(glb, input.modelId, input.modelsDir);
    parentPort!.postMessage({ ok: true, ladder });
  }
} catch (err) {
  parentPort!.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
