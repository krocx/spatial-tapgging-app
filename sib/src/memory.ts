// memory.ts - what this process may use, and what the heavy jobs need.
//
// One place for the memory arithmetic the import worker and the model
// variant builder rely on (docs/ar-ojt/MODEL-VARIANTS.md, prerequisite 2).
// The numbers are measured, not guessed: a Cortona import peaks at ~9x the
// file (43 MB → ~400 MB after the streaming tokenizer); a variant needs the
// source geometry plus one variant plus the cell map, never the whole
// ladder, because each variant is written to disk before the next starts.

import fs from 'node:fs';
import os from 'node:os';

/** The cgroup limit in a container (Render, Docker), else the machine's RAM. */
export function memoryLimitBytes(): number {
  for (const p of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const v = fs.readFileSync(p, 'utf8').trim();
      if (v && v !== 'max') { const n = Number(v); if (Number.isFinite(n) && n > 0 && n < 1e15) return n; }
    } catch { /* not a container */ }
  }
  return os.totalmem();
}

const MB = 1048576;

/** Headroom the main process keeps for the API, sessions and stores. */
export const MAIN_PROCESS_RESERVE_BYTES = 160 * MB;

/** Cortona import: ~16x the file plus a fixed floor. Measured as the
 *  process's peak resident size (what a container limit counts, garbage
 *  included) on the Bee drone publication: 43 MB → ~700 MB with the parse
 *  in a worker, hose sweeps and the variant ladder. The older 9x figure was
 *  heap-in-use, which a cgroup does not care about. */
export function importNeedBytes(fileBytes: number): number { return fileBytes * 16 + 60 * MB; }

/** One variant of a model whose geometry (positions f32 + indices u32)
 *  occupies `geometryBytes`: the source stays resident, one output the same
 *  size at most, the clustering map (~2x the vertex count in ints) and the
 *  GLB copy being written. Rounded up; the ladder is built one at a time. */
export function variantNeedBytes(geometryBytes: number): number { return geometryBytes * 4 + 40 * MB; }

export interface MemoryCheck { ok: boolean; needMB: number; haveMB: number; message?: string }

/** `need` against what the worker may use (the limit minus the main
 *  process's reserve). Message is user-facing. */
export function checkWorkerMemory(needBytes: number, what: string, limitBytes = memoryLimitBytes()): MemoryCheck {
  const have = Math.max(0, limitBytes - MAIN_PROCESS_RESERVE_BYTES);
  const needMB = Math.round(needBytes / MB), haveMB = Math.round(have / MB);
  if (needBytes <= have) return { ok: true, needMB, haveMB };
  const totalMB = Math.round(limitBytes / MB);
  return { ok: false, needMB, haveMB,
    message: `${what} needs about ${needMB} MB of memory. This server has ${totalMB} MB in total and keeps ` +
             `${Math.round(MAIN_PROCESS_RESERVE_BYTES / MB)} MB for the API, so a job may use ${haveMB} MB. ` +
             `Run it on the company server, or move this instance to at least ${Math.ceil((needBytes + MAIN_PROCESS_RESERVE_BYTES) / (256 * MB)) * 256} MB.` };
}

/** Heap cap for a worker: everything the limit allows minus the reserve, never below 256 MB. */
export function workerHeapMb(limitBytes = memoryLimitBytes()): number {
  return Math.max(256, Math.floor((limitBytes - MAIN_PROCESS_RESERVE_BYTES) / MB));
}
