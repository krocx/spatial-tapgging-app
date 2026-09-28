// import-jobs.test.ts - the import worker + queue of one (MODEL-VARIANTS.md,
// prerequisite 1). Runs against dist/ because the worker is a compiled file;
// `npm run build` first (the test script does).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildHtm } from './cortona-fixture.js';

const distReady = fs.existsSync(new URL('../dist/import/jobs.js', import.meta.url));

test('import job: worker parses, main thread finishes, result pollable', { skip: !distReady && 'run npm run build first' }, async () => {
  const { enqueueCortonaImport, getImportJob } = await import('../dist/import/jobs.js');
  const htm = buildHtm({ parts: 3 });
  const ab = new Uint8Array(htm).slice().buffer as ArrayBuffer;
  const job = enqueueCortonaImport(ab, {}, async (r) => ({ glbBytes: r.glb.length, steps: (r.imported as { steps: unknown[] }).steps.length }), 2 * 1024 * 1024 * 1024);
  assert.equal(job.status, 'queued');
  const t0 = Date.now();
  while (getImportJob(job.id)?.status !== 'done' && getImportJob(job.id)?.status !== 'failed' && Date.now() - t0 < 30_000) {
    await new Promise(r => setTimeout(r, 50));
  }
  const done = getImportJob(job.id)!;
  assert.equal(done.status, 'done', done.error);
  const res = done.result as { glbBytes: number; steps: number };
  assert.ok(res.glbBytes > 100 && res.steps > 0);
  assert.equal(done.error, undefined);
});

test('import job: a parse error fails that job only', { skip: !distReady && 'run npm run build first' }, async () => {
  const { enqueueCortonaImport, getImportJob } = await import('../dist/import/jobs.js');
  const ab = new TextEncoder().encode('<html>not a publication</html>').buffer as ArrayBuffer;
  const job = enqueueCortonaImport(ab, {}, async () => ({}), 2 * 1024 * 1024 * 1024);
  const t0 = Date.now();
  while (!['done', 'failed'].includes(getImportJob(job.id)?.status ?? '') && Date.now() - t0 < 30_000) await new Promise(r => setTimeout(r, 50));
  const j = getImportJob(job.id)!;
  assert.equal(j.status, 'failed');
  assert.match(j.error ?? '', /cortona/i);
  // the queue is free again
  const ok = enqueueCortonaImport(new Uint8Array(buildHtm({ parts: 1 })).slice().buffer as ArrayBuffer, {}, async () => ({}), 2 * 1024 * 1024 * 1024);
  const t1 = Date.now();
  while (getImportJob(ok.id)?.status !== 'done' && Date.now() - t1 < 30_000) await new Promise(r => setTimeout(r, 50));
  assert.equal(getImportJob(ok.id)?.status, 'done');
});
