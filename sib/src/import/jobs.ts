// jobs.ts - import jobs: one worker at a time, results kept for polling.
//
// POST /guides/import/cortona answers 202 with a job id; the portal polls
// GET /guides/import/jobs/:id. A queue of one keeps the memory peak to a
// single import (the Bee drone alone reaches ~490 MB). Each job gets its own
// worker so the heap is handed back when it ends, and a worker that dies
// (out of memory, a crash in the parser) fails that job only - the API,
// sessions and every other user carry on.
//
// Phase B (MODEL-VARIANTS.md) adds the variant ladder to the same worker.

import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import type { CortonaImportOptions } from './cortona/importer.js';
import { workerHeapMb } from '../memory.js';

export type JobStatus = 'queued' | 'processing' | 'done' | 'failed';

export interface ImportJob {
  id:         string;
  kind:       'cortona';
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
  glb:          Buffer;
}

interface Pending {
  job:      ImportJob;
  buffer:   ArrayBuffer;
  opts:     CortonaImportOptions;
  /** Main-thread continuation: register the model, persist the guide, build the response. */
  finish:   (r: CortonaWorkerResult) => Promise<unknown>;
}

const RETENTION_MS = 60 * 60 * 1000;   // a finished job is pollable for an hour
const jobs   = new Map<string, ImportJob>();
const queue: Pending[] = [];
let running: Pending | null = null;


export function enqueueCortonaImport(buffer: ArrayBuffer, opts: CortonaImportOptions,
                                     finish: Pending['finish'], limitBytes: number): ImportJob {
  const job: ImportJob = { id: randomUUID(), kind: 'cortona', status: 'queued', createdAt: new Date().toISOString() };
  jobs.set(job.id, job);
  queue.push({ job, buffer, opts, finish });
  renumber();
  setTimeout(() => jobs.delete(job.id), RETENTION_MS + 10 * 60 * 1000).unref();
  void pump(limitBytes);
  return job;
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
    const r = await runWorker(p.buffer, p.opts, workerHeapMb(limitBytes));
    p.job.result = await p.finish(r);
    p.job.status = 'done';
    console.log(`[SIB] import job ${p.job.id} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  } catch (err) {
    p.job.status = 'failed';
    p.job.error  = err instanceof Error ? err.message : String(err);
    console.error(`[SIB] import job ${p.job.id} failed: ${p.job.error}`);
  } finally {
    p.job.endedAt = new Date().toISOString();
    running = null;
    void pump(limitBytes);
  }
}

function runWorker(buffer: ArrayBuffer, opts: CortonaImportOptions, heapMb: number): Promise<CortonaWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./cortona/worker.js', import.meta.url), {
      workerData: { buffer, opts },
      transferList: [buffer],
      resourceLimits: { maxOldGenerationSizeMb: heapMb },
    });
    let settled = false;
    worker.once('message', (m: { ok: boolean; error?: string; glb?: ArrayBuffer; imported?: unknown; log?: unknown; initialNodes?: unknown[]; bounds?: unknown }) => {
      settled = true;
      if (!m.ok) { reject(new Error(m.error ?? 'import failed')); return; }
      resolve({ imported: m.imported, log: m.log, initialNodes: m.initialNodes ?? [], bounds: m.bounds, glb: Buffer.from(m.glb ?? new ArrayBuffer(0)) });
    });
    worker.once('error', (e) => {
      settled = true;
      const msg = /heap|memory|ERR_WORKER_OUT_OF_MEMORY/i.test(String(e?.message))
        ? 'The import ran out of memory on this server. Import it on the company server, or raise this instance\'s memory.'
        : (e?.message ?? String(e));
      reject(new Error(msg));
    });
    worker.once('exit', (code) => {
      if (!settled) reject(new Error(code === 0 ? 'import worker ended without a result'
        : `The import worker stopped (code ${code}) - most likely out of memory on this server.`));
    });
  });
}
