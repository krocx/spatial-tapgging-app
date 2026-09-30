// import-jobs.test.ts - the import worker + queue of one (MODEL-VARIANTS.md,
// prerequisite 1). Runs against dist/ because the worker is a compiled file;
// `npm run build` first (the test script does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODELS = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-models-'));
import { buildHtm } from './cortona-fixture.js';

const distReady = fs.existsSync(new URL('../dist/import/jobs.js', import.meta.url));

test('import job: worker parses, main thread finishes, result pollable', { skip: !distReady && 'run npm run build first' }, async () => {
  const { enqueueCortonaImport, getImportJob } = await import('../dist/import/jobs.js');
  const htm = buildHtm({ parts: 3 });
  const ab = new Uint8Array(htm).slice().buffer as ArrayBuffer;
  const job = enqueueCortonaImport(ab, {}, 'm-' + Math.random().toString(36).slice(2), MODELS, async (r) => ({ glbBytes: r.glb.length, steps: (r.imported as { steps: unknown[] }).steps.length }), 2 * 1024 * 1024 * 1024);
  assert.ok(job.status === 'queued' || job.status === 'processing', job.status);   // an idle queue starts the job at once
  const t0 = Date.now();
  let done = getImportJob(job.id)!;
  while (done.status !== 'done' && done.status !== 'failed' && Date.now() - t0 < 30_000) {
    await new Promise(r => setTimeout(r, 50)); done = getImportJob(job.id)!;
  }
  assert.equal(done.status, 'done', done.error);
  const res = done.result as { glbBytes: number; steps: number };
  assert.ok(res.glbBytes > 100 && res.steps > 0);
  assert.equal(done.error, undefined);
  // The full result is handed over once; later polls see the status and no payload.
  const again = getImportJob(job.id)!;
  assert.equal(again.status, 'done');
  assert.equal((again.result as { glbBytes?: number } | undefined)?.glbBytes, undefined, 'payload not held after collection');
});

test('import job: a parse error fails that job only', { skip: !distReady && 'run npm run build first' }, async () => {
  const { enqueueCortonaImport, getImportJob } = await import('../dist/import/jobs.js');
  const ab = new TextEncoder().encode('<html>not a publication</html>').buffer as ArrayBuffer;
  const job = enqueueCortonaImport(ab, {}, 'm-' + Math.random().toString(36).slice(2), MODELS, async () => ({}), 2 * 1024 * 1024 * 1024);
  const t0 = Date.now();
  while (!['done', 'failed'].includes(getImportJob(job.id)?.status ?? '') && Date.now() - t0 < 30_000) await new Promise(r => setTimeout(r, 50));
  const j = getImportJob(job.id)!;
  assert.equal(j.status, 'failed');
  assert.match(j.error ?? '', /cortona/i);
  // the queue is free again
  const ok = enqueueCortonaImport(new Uint8Array(buildHtm({ parts: 1 })).slice().buffer as ArrayBuffer, {}, 'm-' + Math.random().toString(36).slice(2), MODELS, async () => ({}), 2 * 1024 * 1024 * 1024);
  const t1 = Date.now();
  while (getImportJob(ok.id)?.status !== 'done' && Date.now() - t1 < 30_000) await new Promise(r => setTimeout(r, 50));
  assert.equal(getImportJob(ok.id)?.status, 'done');
});
