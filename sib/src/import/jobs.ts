// jobs.ts - heavy jobs: one worker at a time, results kept for polling.
//
// POST /guides/import/cortona answers 202 with a job id; the portal polls
// GET /guides/import/jobs/:id. POST /models/:id/variants uses the same
// queue. A queue of one keeps the memory peak to a single job (the Bee
// drone import alone reaches ~490 MB). Each job gets its own worker so the
// heap is handed back when it ends, and a worker that dies (out of memory,
// a crash in the parser) fails that job only - the API, sessions and every
// other user carry on.

import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { CortonaImportOptions } from './cortona/importer.js';
import type { LadderResult } from '../models/variants.js';
import { workerHeapMb } from '../memory.js';

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';
export type JobKind   = 'cortona' | 'variants';

export interface ImportJob {
  id:         string;
  kind:       JobKind;
  status:     JobStatus;
  createdAt:  string;
  startedAt?: string;
  endedAt?:   string;
  /** Position while queued (1 = next). */
  position?:  number;
  /** Set when done: what the synchronous route used to answer with. */
  result?:    unknown;
  error?:     string;
}

export interface CortonaWorkerResult {
  imported:     unknown;
  log:          unknown;
  initialNodes: unknown[];
  bounds?:      unknown;
  assembledPose?: 'published' | 'final';
  ladder:       LadderResult;
  glb:          Buffer;
}

export interface VariantsWorkerResult { ladder: LadderResult }

type WorkerInput =
  | { kind: 'cortona'; buffer: ArrayBuffer; opts: CortonaImportOptions; modelId: string; modelsDir: string }
  | { kind: 'variants'; modelId: string; modelsDir: string };

interface Pending {
  job:      ImportJob;
  input:    WorkerInput;
  /** Main-thread continuation: register the model, persist the guide, build the response. */
  finish:   (r: unknown) => Promise<unknown>;
}

const RETENTION_MS = 60 * 60 * 1000;   // a finished job is pollable for an hour
const jobs   = new Map<string, ImportJob>();
const queue: Pending[] = [];
let running: Pending | null = null;

function enqueue(input: WorkerInput, finish: Pending['finish'], limitBytes: number): ImportJob {
  const job: ImportJob = { id: randomUUID(), kind: input.kind, status: 'queued', createdAt: new Date().toISOString() };
  jobs.set(job.id, job);
  queue.push({ job, input, finish });
  renumber();
  setTimeout(() => jobs.delete(job.id), RETENTION_MS + 10 * 60 * 1000).unref();
  void pump(limitBytes);
  return job;
}

export function enqueueCortonaImport(buffer: ArrayBuffer, opts: CortonaImportOptions, modelId: string, modelsDir: string,
                                     finish: (r: CortonaWorkerResult) => Promise<unknown>, limitBytes: number): ImportJob {
  return enqueue({ kind: 'cortona', buffer, opts, modelId, modelsDir }, finish as Pending['finish'], limitBytes);
}

export function enqueueVariants(modelId: string, modelsDir: string,
                                finish: (r: VariantsWorkerResult) => Promise<unknown>, limitBytes: number): ImportJob {
  return enqueue({ kind: 'variants', modelId, modelsDir }, finish as Pending['finish'], limitBytes);
}

export function getImportJob(id: string): ImportJob | undefined {
  const j = jobs.get(id);
  if (!j) return undefined;
  if ((j.status === 'done' || j.status === 'failed') && j.endedAt &&
      Date.now() - Date.parse(j.endedAt) > RETENTION_MS) { jobs.delete(id); return undefined; }
  return j;
}

export function importQueueDepth(): number { return queue.length + (running ? 1 : 0); }

function renumber(): void { queue.forEach((p, i) => { p.job.position = i + 1; }); }

async function pump(limitBytes: number): Promise<void> {
  if (running || queue.length === 0) return;
  const p = queue.shift()!;
  renumber();
  running = p;
  p.job.status = 'processing'; p.job.startedAt = new Date().toISOString(); delete p.job.position;
  const t0 = Date.now();
  try {
    const r = await runWorker(p.input, workerHeapMb(limitBytes));
    p.job.result = await p.finish(r);
    p.job.status = 'done';
    console.log(`[SIB] ${p.job.kind} job ${p.job.id} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (err) {
    p.job.status = 'failed';
    p.job.error  = err instanceof Error ? err.message : String(err);
    console.error(`[SIB] ${p.job.kind} job ${p.job.id} failed: ${p.job.error}`);
  } finally {
    p.job.endedAt = new Date().toISOString();
    running = null;
    void pump(limitBytes);
  }
}

function runWorker(input: WorkerInput, heapMb: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: input,
      transferList: input.kind === 'cortona' ? [input.buffer] : [],
      resourceLimits: { maxOldGenerationSizeMb: heapMb },
    });
    let settled = false;
    worker.once('message', (m: { ok: boolean; error?: string; glb?: ArrayBuffer; imported?: unknown; log?: unknown; initialNodes?: unknown[]; bounds?: unknown; assembledPose?: 'published' | 'final'; ladder?: LadderResult }) => {
      settled = true;
      if (!m.ok) { reject(new Error(m.error ?? `${input.kind} failed`)); return; }
      const empty: LadderResult = { variants: [], triangles: 0, skipped: [] };
      if (input.kind === 'cortona') {
        const r: CortonaWorkerResult = { imported: m.imported, log: m.log, initialNodes: m.initialNodes ?? [], bounds: m.bounds, assembledPose: m.assembledPose,
          ladder: m.ladder ?? empty, glb: Buffer.from(m.glb ?? new ArrayBuffer(0)) };
        resolve(r);
      } else {
        const r: VariantsWorkerResult = { ladder: m.ladder ?? empty };
        resolve(r);
      }
    });
    worker.once('error', (e) => {
      settled = true;
      const msg = /heap|memory|ERR_WORKER_OUT_OF_MEMORY/i.test(String(e?.message))
        ? 'The job ran out of memory on this server. Run it on the company server, or raise this instance\'s memory.'
        : (e?.message ?? String(e));
      reject(new Error(msg));
    });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(code === 0 ? 'worker ended without a result'
        : `The worker stopped (code ${code}) - most likely out of memory on this server.`));
    });
  });
}
