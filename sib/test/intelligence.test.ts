// intelligence.test.ts — C3: hint scoring, retirement rules, heat + notes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuideStep, OmsUsageSession, OmsUsageStepEntry, StepObservationSummary } from '@spatial/shared';
import { scoreVisit, computeIntelligence, LOW_EFFECTIVENESS, MIN_SHOWN_FOR_RETIRE } from '../src/oms/intelligence.js';
import type { RawSample } from '../src/oms/intelligence.js';

const T0 = Date.parse('2026-09-21T10:00:00.000Z');
const iso = (offsetSec: number) => new Date(T0 + offsetSec * 1000).toISOString();

const step = (id: string, i: number, view = false): GuideStep => ({
  id, guideId: 'g1', sequenceNumber: i, title: `Step ${i}`, text: 'do it', createdAt: iso(0), updatedAt: iso(0),
  ...(view && { view: { position: [0, 0, 1] } }),
} as unknown as GuideStep);

const obs = (p: Partial<StepObservationSummary> = {}): StepObservationSummary => ({
  samples: 30, attention: { target: 20, away: 10 }, onTargetRatio: 0.67, wrongPartTaps: 0, partTaps: 1, replays: 0,
  validateAttempts: 0, realigns: 0, stalls: 0, movingSec: 5, ...p,
});

function visit(stepId: string, start: number, dur: number, extra: Partial<OmsUsageStepEntry> = {}): OmsUsageStepEntry {
  return { stepId, enteredAt: iso(start), exitedAt: iso(start + dur), durationSeconds: dur, outcome: 'completed', ...extra };
}
function session(id: string, steps: OmsUsageStepEntry[]): OmsUsageSession {
  return { id, guideId: 'g1', guideName: 'G', anchorId: 'a', anchorName: 'A', operatorName: 'op', startedAt: iso(0), completed: true, steps };
}

test('scoreVisit — wrong-part helped when no wrong tap after the hint', () => {
  const v = visit('s1', 0, 60, { hints: [{ id: 'h', signal: 'wrong-part', ts: iso(20), via: 'template', delivery: 'shown' }] });
  const before: RawSample[] = [{ step: 's1', t: 5, interaction: 'tap-wrong-part' }, { step: 's1', t: 10, interaction: 'tap-wrong-part' }];
  const afterGood: RawSample[] = [{ step: 's1', t: 25, attention: 'target' }, { step: 's1', t: 30, interaction: 'tap-part' }];
  const afterBad: RawSample[]  = [{ step: 's1', t: 25, interaction: 'tap-wrong-part' }];
  assert.equal(scoreVisit(v, [...before, ...afterGood])[0].helped, true);
  assert.equal(scoreVisit(v, [...before, ...afterBad])[0].helped, false);
  assert.equal(scoreVisit(v, before)[0].helped, false);           // nothing observed after → not credited
});

test('scoreVisit — dwell helped only when completed within the window; muted never helps', () => {
  const b = { stepId: 's1', sessions: 5, dwellSec: { p50: 40, p90: 90 } };
  const quick = visit('s1', 0, 70, { hints: [{ id: 'h', signal: 'dwell', ts: iso(50), via: 'llm', delivery: 'shown' }] });
  const slow  = visit('s1', 0, 200, { hints: [{ id: 'h', signal: 'dwell', ts: iso(50), via: 'llm', delivery: 'shown' }] });
  const muted = visit('s1', 0, 70, { hints: [{ id: 'h', signal: 'dwell', ts: iso(50), via: 'llm', delivery: 'muted', muteScope: 'step' }] });
  assert.equal(scoreVisit(quick, [], b)[0].helped, true);        // 20 s after hint ≤ max(30, 40)
  assert.equal(scoreVisit(slow, [], b)[0].helped, false);
  assert.deepEqual(scoreVisit(muted, [], b)[0], { signal: 'dwell', via: 'llm', delivery: 'muted', helped: false });
});

test('scoreVisit — attention-off, look-away, validate-retry', () => {
  const att = visit('s1', 0, 60, { hints: [{ id: 'h', signal: 'attention-off', ts: iso(20), via: 'template', delivery: 'shown' }] });
  const rows: RawSample[] = [
    { step: 's1', t: 5, attention: 'away' }, { step: 's1', t: 10, attention: 'away' },
    { step: 's1', t: 25, attention: 'target' }, { step: 's1', t: 30, attention: 'away' },
  ];
  assert.equal(scoreVisit(att, rows)[0].helped, true);
  const look = visit('s1', 0, 60, { hints: [{ id: 'h', signal: 'look-away', ts: iso(20), via: 'template', delivery: 'shown' }] });
  assert.equal(scoreVisit(look, [{ step: 's1', t: 30, viewAligned: true }])[0].helped, true);
  assert.equal(scoreVisit(look, [{ step: 's1', t: 10, viewAligned: true }])[0].helped, false);
  const val = visit('s1', 0, 60, { validation: { mode: 'system', result: 'pass' }, hints: [{ id: 'h', signal: 'validate-retry', ts: iso(20), via: 'template', delivery: 'shown' }] });
  assert.equal(scoreVisit(val, [])[0].helped, true);
});

test('computeIntelligence — retires a signal with low effectiveness, keeps a good one, lifts when recent visits improve', () => {
  const steps = [step('s1', 1), step('s2', 2)];
  const sessions: OmsUsageSession[] = [];
  // s1: 12 wrong-part hints shown, only 1 helped → retired (≥ 10 shows).
  for (let i = 0; i < 12; i++) {
    sessions.push(session(`bad${i}`, [visit('s1', i * 100, 60, { observations: obs({ wrongPartTaps: 3 }), hints: [{ id: `h${i}`, signal: 'wrong-part', ts: iso(i * 100 + 20), via: 'template', delivery: 'shown' }] })]));
  }
  // s2: 6 dwell hints, all helped.
  for (let i = 0; i < 6; i++) {
    sessions.push(session(`good${i}`, [visit('s2', i * 100, 40, { observations: obs(), hints: [{ id: `g${i}`, signal: 'dwell', ts: iso(i * 100 + 30), via: 'llm', delivery: 'shown' }] })]));
  }
  const samplesFor = (id: string): RawSample[] => id === 'bad0' ? [{ step: 's1', t: 30, attention: 'target' }] : id.startsWith('bad') ? [{ step: 's1', t: 30, interaction: 'tap-wrong-part' }] : [];
  const gi = computeIntelligence('g1', sessions, steps, samplesFor, iso(1000));
  assert.equal(gi.sessions, 18);
  assert.equal(gi.confidence, 'high');
  const s1 = gi.steps.find(s => s.stepId === 's1')!;
  const wp = s1.hints.find(h => h.signal === 'wrong-part')!;
  assert.equal(wp.shown, 12); assert.equal(wp.helped, 1); assert.equal(wp.retired, true);
  assert.ok(wp.effectiveness! < LOW_EFFECTIVENESS && wp.shown >= MIN_SHOWN_FOR_RETIRE);
  assert.equal(s1.wrongPartRate, 1);
  assert.ok(s1.notes.some(n => n.includes('not in this step')));
  assert.ok(s1.notes.some(n => n.includes('retired')));
  const s2 = gi.steps.find(s => s.stepId === 's2')!;
  assert.equal(s2.hints[0].retired, false); assert.equal(s2.hints[0].effectiveness, 1);
  assert.equal(gi.retiredHints, 1);

  // Add 12 newer helped visits on s1 → 13/24 helped → lifts.
  for (let i = 0; i < 12; i++) {
    sessions.push(session(`fix${i}`, [visit('s1', 2000 + i * 100, 60, { observations: obs(), hints: [{ id: `f${i}`, signal: 'wrong-part', ts: iso(2000 + i * 100 + 20), via: 'template', delivery: 'shown' }] })]));
  }
  const gi2 = computeIntelligence('g1', sessions, steps, (id) => id.startsWith('fix') ? [{ step: 's1', t: 30, attention: 'target' }] : samplesFor(id), iso(5000));
  assert.equal(gi2.steps.find(s => s.stepId === 's1')!.hints.find(h => h.signal === 'wrong-part')!.retired, false);
});

test('computeIntelligence — mute rate retires; heat and confidence scale', () => {
  const steps = [step('s1', 1)];
  const sessions: OmsUsageSession[] = [];
  for (let i = 0; i < 6; i++) {
    sessions.push(session(`m${i}`, [visit('s1', i * 100, 60, { outcome: i < 2 ? 'left' : 'completed', observations: obs({ stalls: 1 }), hints: [{ id: `h${i}`, signal: 'dwell', ts: iso(i * 100 + 20), via: 'template', delivery: i < 4 ? 'muted' : 'shown', ...(i < 4 && { muteScope: 'guide' as const }) }] })]));
  }
  const gi = computeIntelligence('g1', sessions, steps, () => [], iso(1000));
  const s1 = gi.steps[0];
  const d = s1.hints.find(h => h.signal === 'dwell')!;
  assert.equal(d.muted, 4); assert.equal(d.shown, 2); assert.equal(d.retired, true);
  assert.match(d.reason!, /muted 4 of 6/);
  assert.equal(s1.leftRate, 0.33); assert.equal(s1.stallRate, 1);
  assert.ok(s1.heat > 0 && s1.heat <= 100);
  assert.equal(gi.confidence, 'medium');
  assert.equal(computeIntelligence('g1', [], steps, () => [], iso(0)).confidence, 'none');
});
