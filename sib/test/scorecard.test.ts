// scorecard.test.ts - lens suggestion, the master gate preview and quarters (scorecard/scorecard-core.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, latestByCriterion, suggestLens, masterOutcome, quarterOf, quarterAfter, type Entry } from '../src/scorecard/scorecard-core.js';

const E = (criterionId: string, score: Entry['score'], confidence: Entry['confidence'], at: string, deviceId?: string): Entry =>
  ({ id: criterionId + at, trackId: 'content-pipeline', criterionId, quarter: 'FY27-Q1', score, confidence, comment: '', evidence: [], by: 't', at, ...(deviceId ? { deviceId } : {}) });

test('latest entry per criterion wins; lens = lower of rounded mean and min + 1; confidence = lowest', () => {
  const cp = TRACKS[0];
  const entries = [E('cp-format', 2, 'High', '2026-10-01'), E('cp-format', 4, 'High', '2026-10-02'), E('cp-geometry', 5, 'Medium', '2026-10-02'), E('cp-animation', 2, 'High', '2026-10-02')];
  const latest = latestByCriterion(entries, 'content-pipeline', 'FY27-Q1');
  assert.equal(latest.get('cp-format')!.score, 4);
  const s = suggestLens(cp, 'L1', latest);
  assert.equal(s.scored, 3); assert.equal(s.min, 2); assert.equal(s.suggested, 3, 'mean 3.67 → 4, but min + 1 = 3'); assert.equal(s.confidence, 'Medium');
  assert.equal(suggestLens(cp, 'L2', latest).suggested, null);
});

test('master gate preview applies the vetoes and the CONTINUE band', () => {
  assert.deepEqual(masterOutcome({ L1: 5, L2: 5, L3: 5, L4: 2, L5: 5 }, {}), { weighted: 4.55, auto: 'CLOSE' });
  assert.deepEqual(masterOutcome({ L1: 4, L2: 4, L3: 4, L4: 1, L5: 4 }, {}), { weighted: 3.55, auto: 'CLOSE' });
  assert.deepEqual(masterOutcome({ L1: 5, L2: 5, L3: 2, L4: 5, L5: 5 }, {}).auto, 'CONTINUE', 'a 2 caps at CONTINUE');
  assert.deepEqual(masterOutcome({ L1: 3, L2: 3, L3: 3, L4: 3, L5: 3 }, {}), { weighted: 3, auto: 'CONTINUE' });
  assert.deepEqual(masterOutcome({ L1: 4, L2: 4, L3: 4, L4: 4, L5: 4 }, { L1: 'Low' }), { weighted: 3.7, auto: 'CONTINUE' }, 'Low confidence caps L1 at 3');
  assert.deepEqual(masterOutcome({ L1: 4, L2: 4, L3: 4, L4: 4, L5: 4 }, {}), { weighted: 4, auto: 'ADVANCE' });
  assert.equal(masterOutcome({ L1: 4, L2: null, L3: 4, L4: 4, L5: 4 }, {}).auto, 'incomplete');
});

test('fiscal quarters start in November', () => {
  assert.equal(quarterOf(new Date('2026-10-01T00:00:00Z')), 'FY26-Q4');
  assert.equal(quarterOf(new Date('2026-11-15T00:00:00Z')), 'FY27-Q1');
  assert.equal(quarterOf(new Date('2027-05-01T00:00:00Z')), 'FY27-Q3');
});

test('quarterAfter rolls the fiscal year', () => {
  assert.equal(quarterAfter('FY26-Q4', 1), 'FY27-Q1');
  assert.equal(quarterAfter('FY26-Q4', 4), 'FY27-Q4');
  assert.equal(quarterAfter('FY27-Q2', 3), 'FY28-Q1');
});
