// signals.test.ts — C2: deviations from the learned baseline become hints;
// no baseline (or a thin one) means the dwell/attention signals stay quiet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuideStep, OmsUsageStepEntry, StepBaseline, StepObservationSummary } from '@spatial/shared';
import { detectSignals, templateHint, phraseHint } from '../src/oms/signals.js';

const step = (extra: Partial<GuideStep> = {}): GuideStep => ({
  id: 's1', guideId: 'g', anchorId: 'a', sequenceNumber: 1, title: 'Install the stem', text: 'Apply grease to the stem and insert it.',
  createdAt: '', updatedAt: '', ...extra,
} as GuideStep);
const obs = (extra: Partial<StepObservationSummary> = {}): StepObservationSummary => ({
  samples: 30, attention: { target: 20, away: 10 }, onTargetRatio: 0.67, wrongPartTaps: 0, partTaps: 1, replays: 0,
  validateAttempts: 0, realigns: 0, stalls: 0, movingSec: 2, ...extra,
});
const visit = (o?: StepObservationSummary, extra: Partial<OmsUsageStepEntry> = {}): OmsUsageStepEntry =>
  ({ stepId: 's1', enteredAt: '2026-09-21T00:00:00Z', outcome: 'open', ...(o && { observations: o }), ...extra });
const baseline: StepBaseline = { stepId: 's1', sessions: 12, dwellSec: { p50: 50, p90: 90 }, onTargetRatio: { p50: 0.7, p10: 0.35 }, wrongPartTaps: { p50: 0, p90: 1 }, replays: { p50: 1 }, validationFailRate: 0.25 };

test('dwell fires past the p90 of a trusted baseline, once', () => {
  const none = detectSignals({ visit: visit(obs()), elapsedSec: 60, baseline, step: step(), alreadyFired: new Set() });
  assert.deepEqual(none.map(s => s.kind), []);
  const late = detectSignals({ visit: visit(obs()), elapsedSec: 120, baseline, step: step(), alreadyFired: new Set() });
  assert.deepEqual(late.map(s => s.kind), ['dwell']);
  assert.match(late[0].evidence, /90 % of 12 visits finished within 90 s/);
  const again = detectSignals({ visit: visit(obs()), elapsedSec: 200, baseline, step: step(), alreadyFired: new Set(['dwell']) });
  assert.deepEqual(again.map(s => s.kind), []);
});

test('floors: a thin or absent baseline still coaches — 3 wrong taps, attention under 20 %', () => {
  const thin: StepBaseline = { ...baseline, sessions: 2 };
  const r = detectSignals({ visit: visit(obs({ onTargetRatio: 0.1, wrongPartTaps: 3 })), elapsedSec: 500, baseline: thin, step: step(), alreadyFired: new Set() });
  assert.deepEqual(r.map(s => s.kind).sort(), ['attention-off', 'wrong-part']);
  const noBase = detectSignals({ visit: visit(obs({ wrongPartTaps: 2 })), elapsedSec: 500, step: step(), alreadyFired: new Set() });
  assert.deepEqual(noBase, []);                          // 2 taps is under the floor of 3
  const dwellQuiet = detectSignals({ visit: visit(obs()), elapsedSec: 500, baseline: thin, step: step(), alreadyFired: new Set() });
  assert.deepEqual(dwellQuiet, []);                      // dwell has no floor — it needs a trusted baseline
});

test('baselines only tighten: a noisy p90 never raises the wrong-part bar above the floor; a clean one lowers it to 2', () => {
  const noisy: StepBaseline = { ...baseline, wrongPartTaps: { p50: 3, p90: 6 } };
  const r = detectSignals({ visit: visit(obs({ wrongPartTaps: 3 })), elapsedSec: 10, baseline: noisy, step: step(), alreadyFired: new Set() });
  assert.deepEqual(r.map(s => s.kind), ['wrong-part']);
  const clean: StepBaseline = { ...baseline, wrongPartTaps: { p50: 0, p90: 0 } };
  const two = detectSignals({ visit: visit(obs({ wrongPartTaps: 2 })), elapsedSec: 10, baseline: clean, step: step(), alreadyFired: new Set() });
  assert.deepEqual(two.map(s => s.kind), ['wrong-part']);
  const one = detectSignals({ visit: visit(obs({ wrongPartTaps: 1 })), elapsedSec: 10, baseline: clean, step: step(), alreadyFired: new Set() });
  assert.deepEqual(one, []);                             // never below 2
});

test('demo mode: floors only — baselines ignored', () => {
  const clean: StepBaseline = { ...baseline, wrongPartTaps: { p50: 0, p90: 0 } };
  const two = detectSignals({ visit: visit(obs({ wrongPartTaps: 2 })), elapsedSec: 10, baseline: clean, step: step(), alreadyFired: new Set(), mode: 'demo' });
  assert.deepEqual(two, []);
  const three = detectSignals({ visit: visit(obs({ wrongPartTaps: 3 })), elapsedSec: 10, baseline: clean, step: step(), alreadyFired: new Set(), mode: 'demo' });
  assert.deepEqual(three.map(s => s.kind), ['wrong-part']);
  const dwell = detectSignals({ visit: visit(obs()), elapsedSec: 500, baseline, step: step(), alreadyFired: new Set(), mode: 'demo' });
  assert.deepEqual(dwell, []);
});

test('attention-off compares with the p10 of the baseline', () => {
  const r = detectSignals({ visit: visit(obs({ onTargetRatio: 0.2 })), elapsedSec: 10, baseline, step: step(), alreadyFired: new Set() });
  assert.deepEqual(r.map(s => s.kind), ['attention-off']);
  const fine = detectSignals({ visit: visit(obs({ onTargetRatio: 0.5 })), elapsedSec: 10, baseline, step: step(), alreadyFired: new Set() });
  assert.deepEqual(fine, []);
});

test('look-away only on steps with a view, after 20 s (or the typical dwell if shorter), when never aligned', () => {
  const withView = step({ view: { position: [0, 1, 2] } });
  const early = detectSignals({ visit: visit(obs({ alignedSec: 0, samples: 12 })), elapsedSec: 12, baseline, step: withView, alreadyFired: new Set() });
  assert.deepEqual(early, []);
  const late = detectSignals({ visit: visit(obs({ alignedSec: 0 })), elapsedSec: 25, baseline, step: withView, alreadyFired: new Set() });
  assert.deepEqual(late.map(s => s.kind), ['look-away']);
  const aligned = detectSignals({ visit: visit(obs({ alignedSec: 3 })), elapsedSec: 60, baseline, step: withView, alreadyFired: new Set() });
  assert.deepEqual(aligned, []);
  const noView = detectSignals({ visit: visit(obs({ alignedSec: 0 })), elapsedSec: 60, baseline, step: step(), alreadyFired: new Set() });
  assert.deepEqual(noView, []);
});

test('validate-retry after three attempts without a pass', () => {
  const r = detectSignals({ visit: visit(obs({ validateAttempts: 3 })), elapsedSec: 10, baseline, step: step(), alreadyFired: new Set() });
  assert.deepEqual(r.map(s => s.kind), ['validate-retry']);
  assert.equal(r[0].facts.failRatePct, 25);
  const passed = detectSignals({ visit: visit(obs({ validateAttempts: 3 }), { validation: { mode: 'system', result: 'pass' } }), elapsedSec: 10, baseline, step: step(), alreadyFired: new Set() });
  assert.deepEqual(passed, []);
});

test('template phrasing quotes the baseline and part names; phraseHint falls back without an LLM', async () => {
  delete process.env.ASK_LLM_URL;
  const [sig] = detectSignals({ visit: visit(obs()), elapsedSec: 120, baseline, step: step(), alreadyFired: new Set() });
  const t = templateHint(sig, step(), ['STEM', 'BEARING']);
  assert.match(t, /about 50 s/);
  assert.match(t, /STEM and BEARING/);
  const p = await phraseHint(sig, step(), ['STEM']);
  assert.equal(p.via, 'template');
  assert.equal(p.text, templateHint(sig, step(), ['STEM']));
});
