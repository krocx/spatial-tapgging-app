// observations.test.ts - C1: observation roll-ups and learned baselines are
// pure functions of what the devices reported; nothing is hard-coded.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs   from 'fs';
import os   from 'os';
import path from 'path';
import type { OmsUsageSession, SessionObservation } from '@spatial/shared';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-obs-test-'));
process.env.SIB_DATA_DIR = TMP;

const { summarize, computeBaselines, sanitizeObservation, ingestObservations } = await import('../src/oms/observations.js');
const { omsUsageStore } = await import('../src/oms/usage-log.js');

const obs = (t: number, extra: Partial<SessionObservation> = {}): SessionObservation => ({ t, ...extra });

test('sanitize drops garbage and clamps ranges', () => {
  assert.equal(sanitizeObservation(null), null);
  assert.equal(sanitizeObservation({ t: -1 }), null);
  const o = sanitizeObservation({ t: 3.14159, attention: 'target', targetDistM: 1.234, targetAngleDeg: 400, interaction: 'bogus', node: 'cmp:A', moving: true })!;
  assert.deepEqual(o, { t: 3.1, attention: 'target', targetDistM: 1.23, targetAngleDeg: 180, moving: true, node: 'cmp:A' });
});

test('summarize counts attention seconds, interactions, alignment and running median', () => {
  const s1 = summarize([
    obs(0, { attention: 'target', targetDistM: 1.0, viewAligned: false }),
    obs(1, { attention: 'away', targetDistM: 1.2, viewAligned: false, moving: true }),
    obs(2, { attention: 'target', targetDistM: 0.8, viewAligned: true, interaction: 'tap-wrong-part', node: 'cmp:X' }),
    obs(3, { attention: 'pin', interaction: 'replay' }),
  ]);
  assert.equal(s1.samples, 4);
  assert.deepEqual(s1.attention, { target: 2, away: 1, pin: 1 });
  assert.equal(s1.onTargetRatio, 0.75);
  assert.equal(s1.alignedSec, 1);
  assert.equal(s1.wrongPartTaps, 1);
  assert.equal(s1.replays, 1);
  assert.equal(s1.movingSec, 1);
  assert.equal(s1.medianDistM, 1.0);
  // A second batch continues the same visit.
  const s2 = summarize([obs(4, { attention: 'away' }), obs(5, { attention: 'away', interaction: 'stall' })], s1);
  assert.equal(s2.samples, 6);
  assert.equal(s2.onTargetRatio, 0.5);
  assert.equal(s2.stalls, 1);
  assert.equal(s2.alignedSec, 1);
});

test('baselines come from completed visits only, with percentiles per step', () => {
  const mk = (id: string, dwell: number[], onTarget: number[], fail = false): OmsUsageSession => ({
    id, guideId: 'g', guideName: 'G', anchorId: 'a', anchorName: 'A', operatorName: 'op', startedAt: '2026-09-20T00:00:00Z', completed: true,
    steps: dwell.map((d, i) => ({
      stepId: 's1', enteredAt: '2026-09-20T00:00:00Z', outcome: i === dwell.length - 1 && fail ? 'failed' : 'completed', durationSeconds: d,
      observations: { samples: 10, attention: { target: 7, away: 3 }, onTargetRatio: onTarget[i], wrongPartTaps: i, partTaps: 2, replays: 0, validateAttempts: 1, realigns: 0, stalls: i > 1 ? 1 : 0, movingSec: 1 },
      validation: { mode: 'system', result: fail && i === dwell.length - 1 ? 'fail' : 'pass' },
    })),
  } as OmsUsageSession);
  const sessions = [mk('u1', [30, 40], [0.9, 0.8]), mk('u2', [50, 60, 200], [0.7, 0.6, 0.2], true), { ...mk('u3', [5], [0.5]), guideId: 'other' }];
  const b = computeBaselines('g', sessions, '2026-09-20T01:00:00Z');
  assert.equal(b.sessions, 2);
  assert.equal(b.steps.length, 1);
  const s = b.steps[0];
  assert.equal(s.stepId, 's1');
  assert.equal(s.sessions, 4);                              // the failed 200 s visit is excluded
  assert.deepEqual(s.dwellSec, { p50: 50, p90: 60 });   // nearest-rank on [30,40,50,60]
  assert.deepEqual(s.onTargetRatio, { p50: 0.8, p10: 0.6 });
  assert.deepEqual(s.wrongPartTaps, { p50: 1, p90: 1 });
  assert.equal(s.validationFailRate, 0);                    // only completed visits' verdicts count
  assert.equal(s.stallRate, 0);
});

test('ingest rolls into the newest visit of the step and writes raw JSONL', () => {
  const rec: OmsUsageSession = {
    id: 'live-1', guideId: 'g', guideName: 'G', anchorId: 'a', anchorName: 'A', operatorName: 'op', startedAt: '2026-09-20T00:00:00Z', completed: false,
    steps: [
      { stepId: 's1', enteredAt: '2026-09-20T00:00:00Z', outcome: 'left' },
      { stepId: 's2', enteredAt: '2026-09-20T00:01:00Z', outcome: 'open' },
      { stepId: 's1', enteredAt: '2026-09-20T00:02:00Z', outcome: 'open' },
    ],
  };
  omsUsageStore.save(rec);
  const sum = ingestObservations('live-1', { stepId: 's1', observations: [obs(0, { attention: 'target' }), obs(1, { attention: 'target', interaction: 'tap-part', node: 'cmp:A' })] });
  assert.equal(sum?.samples, 2);
  const after = omsUsageStore.findById('live-1')!;
  assert.equal(after.steps[0].observations, undefined, 'the OLD visit of s1 is untouched');
  assert.equal(after.steps[2].observations?.partTaps, 1);
  assert.equal(ingestObservations('nope', { stepId: 's1', observations: [obs(0)] }), null);
  const raw = fs.readFileSync(path.join(TMP, 'observations', 'live-1.jsonl'), 'utf8').trim().split('\n');
  assert.equal(raw.length, 2);
  assert.equal(JSON.parse(raw[1]).node, 'cmp:A');
});
