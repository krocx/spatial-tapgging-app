// anchor-accuracy.test.ts — Anchor Lab samples (2026.4.46).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAccuracySample, summariseAccuracy } from '../src/oms/anchor-accuracy.js';
import type { AnchorAccuracySample } from '@spatial/shared';

test('sanitize: requires tagId, finite errorMm, known originSource; trims and bounds strings', () => {
  assert.equal(typeof sanitizeAccuracySample('a1', {}), 'string');
  assert.equal(typeof sanitizeAccuracySample('a1', { tagId: 't', errorMm: -1, originSource: 'sealed' }), 'string');
  assert.equal(typeof sanitizeAccuracySample('a1', { tagId: 't', errorMm: 3, originSource: 'magic' }), 'string');
  const s = sanitizeAccuracySample('a1', {
    tagId: ' t1 ', errorMm: 12.345, originSource: 'sealed', device: 'iPhone17,3', run: 'door · evening',
    relocalizeS: 2.5, lightLux: 'bright', at: 'not-a-date', dxMm: 1, dyMm: -2, dzMm: 3, runType: 'map',
  });
  assert.notEqual(typeof s, 'string');
  const ok = s as AnchorAccuracySample;
  assert.equal(ok.anchorId, 'a1');
  assert.equal(ok.tagId, 't1');
  assert.equal(ok.errorMm, 12.3);
  assert.equal(ok.device, 'iPhone17,3');
  assert.equal(ok.relocalizeS, 2.5);
  assert.equal(ok.lightLux, undefined, 'non-numeric optional fields are dropped');
  assert.ok(ok.id && ok.at && !Number.isNaN(Date.parse(ok.at)), 'id + server timestamp when at is unusable');
  assert.deepEqual([ok.dxMm, ok.dyMm, ok.dzMm], [1, -2, 3]);
  assert.equal(ok.runType, 'map');
  const bad = sanitizeAccuracySample('a1', { tagId: 't', errorMm: 1, originSource: 'qr', runType: 'walk' }) as AnchorAccuracySample;
  assert.equal(bad.runType, undefined, 'unknown run types are dropped, not rejected');
});

test('summary: median / p90 / max overall and per device, origin, run', () => {
  const mk = (errorMm: number, device: string, originSource: AnchorAccuracySample['originSource'], run?: string, at?: string): AnchorAccuracySample =>
    ({ tagId: 't', errorMm, device, originSource, ...(run && { run }), ...(at && { at }) });
  const samples = [
    mk(4, 'iPhone', 'sealed', 'door', '2026-09-20T10:00:00Z'),
    mk(6, 'iPhone', 'sealed', 'door', '2026-09-21T10:00:00Z'),
    mk(30, 'iPad', 'approximate', 'side'),
    mk(10, 'iPad', 'qr'),
  ];
  const s = summariseAccuracy(samples);
  assert.equal(s.n, 4);
  assert.equal(s.medianMm, 8);
  assert.equal(s.maxMm, 30);
  assert.equal(s.p90Mm, 24);
  assert.equal(s.lastAt, '2026-09-21T10:00:00Z');
  const iphone = s.byDevice.find(b => b.key === 'iPhone')!;
  assert.deepEqual([iphone.n, iphone.medianMm, iphone.maxMm], [2, 5, 6]);
  assert.deepEqual(s.byOrigin.map(b => b.key).sort(), ['approximate', 'qr', 'sealed']);
  assert.deepEqual(s.byRun.map(b => b.key), ['door', 'side'], 'runs without a label are not bucketed');
  const empty = summariseAccuracy([]);
  assert.deepEqual([empty.n, empty.medianMm, empty.p90Mm, empty.maxMm], [0, 0, 0, 0]);
});

test('runs: sanitizeLabRun requires runId + marks, keeps the summary fields, drops junk', async () => {
  const { sanitizeLabRun } = await import('../src/oms/anchor-accuracy.js');
  assert.equal(typeof sanitizeLabRun('a1', {}), 'string');
  assert.equal(typeof sanitizeLabRun('a1', { runId: 'r', marks: -1 }), 'string');
  const r = sanitizeLabRun('a1', {
    runId: 'r1', marks: 6.4, run: 'door · day', runType: 'map', device: 'iPad16,3', medianMm: 9.5, p90Mm: 14,
    originSource: 'sealed', relocalizeS: 2.1, convergeS: 1.6, corrections: 1, interrupted: false, mapGrew: true,
    mapKB: 2200, ghostUsed: 'yes', endedAt: 'nope', startedAt: '2026-09-24T04:00:00Z',
  });
  assert.notEqual(typeof r, 'string');
  const ok = r as Exclude<typeof r, string>;
  assert.equal(ok.anchorId, 'a1');
  assert.equal(ok.marks, 6);
  assert.equal(ok.mapGrew, true);
  assert.equal(ok.ghostUsed, undefined, 'non-boolean flags are dropped');
  assert.equal(ok.originSource, 'sealed');
  assert.ok(ok.id && ok.endedAt && !Number.isNaN(Date.parse(ok.endedAt)), 'server stamps endedAt when unusable');
  assert.equal(ok.startedAt, '2026-09-24T04:00:00Z');
});
