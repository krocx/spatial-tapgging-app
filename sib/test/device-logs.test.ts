// device-logs.test.ts — QA logging: validation, redaction, append/query, retention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

test('validateLogBatch bounds, defaults and redacts', async () => {
  const { validateLogBatch, MAX_BATCH } = await import('../src/logging/device-logs.js');
  assert.equal(validateLogBatch({}).ok, false);
  assert.equal(validateLogBatch({ device: { id: 'd1' }, entries: [] }).ok, false);
  const tooMany = { device: { id: 'd1' }, entries: Array.from({ length: MAX_BATCH + 1 }, () => ({ msg: 'x' })) };
  assert.equal(validateLogBatch(tooMany).ok, false);
  const v = validateLogBatch({
    device: { id: 'iPhone/17 Pro', model: 'iPhone17,2', employeeId: 'E123', qaMode: true },
    entries: [
      { ts: 'not-a-date', level: 'nonsense', module: 'Model', msg: 'loaded api_key=sk-abcdefghijklmnop ok', ctx: { n: 3, s: 'Bearer abc.def', junk: { a: 1 } } },
      { msg: '   ' },
      'garbage',
    ],
  });
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.value.device.id, 'iPhone_17_Pro');
    assert.equal(v.value.entries.length, 1);
    const e = v.value.entries[0];
    assert.equal(e.level, 'info'); assert.equal(e.module, 'model');
    assert.ok(!e.msg.includes('sk-abcdefghijklmnop'), e.msg);
    assert.ok(e.msg.includes('[redacted]'));
    assert.equal(e.ctx?.n, 3);
    assert.ok(String(e.ctx?.s).startsWith('Bearer [redacted]'));
    assert.equal(e.ctx?.junk, undefined);
    assert.ok(!Number.isNaN(Date.parse(e.ts)));
  }
});

test('redact catches base64 blobs and long tokens but leaves UUIDs', async () => {
  const { redact } = await import('../src/logging/device-logs.js');
  const b64 = 'A'.repeat(120);
  assert.ok(redact(`img=${b64}`).includes('[redacted:b64:120]'));
  assert.ok(redact('ipkey: gfmZ1rCEKCWzOZnfP0cATVMPdlyOVzUfS5wMyNM5').includes('[redacted]'));
  const uuid = '8b7ef641-8201-48d0-b529-aeecd836e670';
  assert.equal(redact(`anchor ${uuid}`), `anchor ${uuid}`);
});

test('appendLogs writes JSONL per device/day, queryLogs filters, pruneLogs removes old days', async () => {
  const { appendLogs, queryLogs, listLogDevices, pruneLogs, _logsDir } = await import('../src/logging/device-logs.js');
  const dir = _logsDir();
  fs.rmSync(dir, { recursive: true, force: true });
  const now = new Date('2026-09-14T10:00:00Z');
  appendLogs({ device: { id: 'dev-a', employeeId: 'E1', app: '2026.4.46' }, entries: [
    { ts: '2026-09-14T09:59:00Z', level: 'debug', module: 'model', msg: 'materials=3' },
    { ts: '2026-09-14T09:59:30Z', level: 'error', module: 'net',   msg: 'POST failed', ctx: { status: 500 } },
  ] }, now);
  appendLogs({ device: { id: 'dev-b' }, entries: [{ ts: '2026-09-14T09:58:00Z', level: 'info', module: 'cone', msg: 'spawned' }] }, now);
  assert.ok(fs.existsSync(path.join(dir, '2026-09-14', 'dev-a.jsonl')));
  assert.ok(fs.existsSync(path.join(dir, '2026-09-14', 'dev-b.jsonl')));

  const all = queryLogs({ since: '2026-09-14T00:00:00Z', until: '2026-09-14T23:59:59Z' });
  assert.equal(all.length, 3);
  assert.equal(all[0].device, 'dev-b');                         // oldest first
  const errs = queryLogs({ since: '2026-09-14T00:00:00Z', until: '2026-09-14T23:59:59Z', level: 'warn' });
  assert.equal(errs.length, 1); assert.equal(errs[0].msg, 'POST failed'); assert.equal(errs[0].emp, 'E1');
  const q = queryLogs({ device: 'dev-a', since: '2026-09-14T00:00:00Z', until: '2026-09-14T23:59:59Z', q: 'material' });
  assert.equal(q.length, 1);
  assert.equal(listLogDevices().map(d => d.id).sort().join(','), 'dev-a,dev-b');

  fs.mkdirSync(path.join(dir, '2026-08-01'), { recursive: true });
  const removed = pruneLogs(14, now);
  assert.equal(removed, 1);
  assert.ok(!fs.existsSync(path.join(dir, '2026-08-01')));
  assert.ok(fs.existsSync(path.join(dir, '2026-09-14')));
});
