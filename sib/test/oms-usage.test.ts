// oms-usage.test.ts — AR OMS Usage Log (K2): event folding + filters.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-oms-usage-test-'));
process.env.SIB_DATA_DIR = TMP_DATA;   // MUST be set before importing stores

const { usageOpen, usageRecordEvent, usageLinkSignOff, listUsage, omsUsageStore } =
  await import('../src/oms/usage-log.js');

import type { LiveGuideSession } from '@spatial/shared';

function live(id: string): LiveGuideSession {
  return {
    id, guideId: 'g1', anchorId: 'a1', guideName: 'Hydraulic Press PM',
    anchorName: 'Press 4', operatorName: 'Tech One',
    startedAt: new Date().toISOString(), currentStepIndex: 0, events: [],
  };
}

test('usage record: open → step timeline → submit', () => {
  usageOpen(live('L1'),
    { guideId: 'g1', anchorId: 'a1', guideName: 'x', anchorName: 'y',
      operatorName: 'Tech One', workContext: 'CH-07', operatorEmployeeId: 'E200' },
    { email: 'tech1@amat.com', employeeId: 'E200' });

  usageRecordEvent('L1', 'step:entered',  { type: 'step:entered', stepId: 's1', stepIndex: 0 });
  usageRecordEvent('L1', 'step:completed', { type: 'step:completed', stepId: 's1', durationSeconds: 42 });
  usageRecordEvent('L1', 'step:entered',  { type: 'step:entered', stepId: 's2', stepIndex: 1 });
  usageRecordEvent('L1', 'step:failed',   { type: 'step:failed', stepId: 's2' });
  usageRecordEvent('L1', 'step:entered',  { type: 'step:entered', stepId: 's9', stepIndex: 8 });
  usageRecordEvent('L1', 'session:submitted', { type: 'session:submitted' });

  const rec = omsUsageStore.findById('L1')!;
  assert.equal(rec.workContext, 'CH-07');
  assert.equal(rec.operatorEmail, 'tech1@amat.com');       // token identity captured
  assert.equal(rec.completed, true);
  assert.ok(rec.endedAt && rec.totalSeconds !== undefined);
  assert.equal(rec.steps.length, 3);
  assert.deepEqual(rec.steps.map(e => e.outcome), ['completed', 'failed', 'left']);
  assert.equal(rec.steps[0].durationSeconds, 42);          // client-measured wins
  assert.ok(rec.steps[1].durationSeconds !== undefined);   // server-derived fallback
});

test('moving on without completing closes the entry as left; sign-off link finalises', () => {
  usageOpen(live('L2'),
    { guideId: 'g1', anchorId: 'a1', guideName: 'x', anchorName: 'y',
      operatorName: 'Tech Two', workContext: 'CH-09' });
  usageRecordEvent('L2', 'step:entered', { type: 'step:entered', stepId: 's1', stepIndex: 0 });
  usageRecordEvent('L2', 'step:entered', { type: 'step:entered', stepId: 's2', stepIndex: 1 });
  // No session:submitted event (offline queue) — sign-off link must finalise.
  usageLinkSignOff('L2', 'signoff-123');

  const rec = omsUsageStore.findById('L2')!;
  assert.equal(rec.steps[0].outcome, 'left');
  assert.equal(rec.signOffSessionId, 'signoff-123');
  assert.equal(rec.completed, true);
  assert.ok(rec.endedAt);
});

test('perception:result attaches a validation verdict to the matching step entry', () => {
  usageOpen(live('L3'),
    { guideId: 'g1', anchorId: 'a1', guideName: 'x', anchorName: 'y',
      operatorName: 'Tech Three', workContext: 'CH-11' });
  usageRecordEvent('L3', 'step:entered', { type: 'step:entered', stepId: 's1', stepIndex: 0 });
  // System verdict arrives, then the completion — both target s1.
  usageRecordEvent('L3', 'perception:result', {
    type: 'perception:result', stepId: 's1',
    payload: { mode: 'system', result: 'pass', score: 0.87 },
  });
  usageRecordEvent('L3', 'step:completed', { type: 'step:completed', stepId: 's1' });
  // Manual verdict on the next step, then failure routing.
  usageRecordEvent('L3', 'step:entered', { type: 'step:entered', stepId: 's2', stepIndex: 1 });
  usageRecordEvent('L3', 'perception:result', {
    type: 'perception:result', stepId: 's2',
    payload: { mode: 'manual', result: 'fail' },
  });
  usageRecordEvent('L3', 'step:failed', { type: 'step:failed', stepId: 's2' });
  // Junk payload must be ignored.
  usageRecordEvent('L3', 'perception:result', {
    type: 'perception:result', stepId: 's2', payload: { mode: 'wat', result: 'maybe' },
  });

  const rec = omsUsageStore.findById('L3')!;
  assert.deepEqual(rec.steps[0].validation, { mode: 'system', result: 'pass', score: 0.87 });
  assert.deepEqual(rec.steps[1].validation, { mode: 'manual', result: 'fail' });
  assert.equal(rec.steps[1].outcome, 'failed');
});

test('listUsage filters by workContext and guideId, newest first; unknown ids ignored', () => {
  usageRecordEvent('NOPE', 'step:entered', { type: 'step:entered', stepId: 's1' });  // no throw
  const ch07 = listUsage({ workContext: 'CH-07' });
  assert.equal(ch07.length, 1);
  assert.equal(ch07[0].id, 'L1');
  assert.equal(listUsage({ guideId: 'g1' }).length, 3);   // L1 + L2 + L3
  assert.equal(listUsage({ guideId: 'other' }).length, 0);
});
