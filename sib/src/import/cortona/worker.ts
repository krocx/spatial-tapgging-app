// worker.ts - runs one Cortona import off the request thread.
//
// Started per job by import/jobs.ts with `workerData = { buffer, opts }`. The
// buffer arrives transferred (zero copy); the GLB goes back the same way.
// Everything else in the result is plain data. If this worker dies for
// memory the main process stays up and the job is reported as failed - the
// whole point of running it here.

import { parentPort, workerData } from 'node:worker_threads';
import { importCortonaBundle, type CortonaImportOptions } from './importer.js';

interface WorkerInput { buffer: ArrayBuffer; opts: CortonaImportOptions }

const { buffer, opts } = workerData as WorkerInput;

try {
  const result = importCortonaBundle(Buffer.from(buffer), opts);
  const glb = new Uint8Array(result.glb).slice().buffer as ArrayBuffer;   // own, transferable copy
  parentPort!.postMessage({
    ok: true,
    imported: result.imported,
    log: result.log,
    initialNodes: result.initialNodes,
    bounds: result.bounds,
    glb,
  }, [glb]);
} catch (err) {
  parentPort!.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
