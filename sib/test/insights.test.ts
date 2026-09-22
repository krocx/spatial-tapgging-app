// insights.test.ts — the leadership view is derived from the usage log:
// period windows, previous-period deltas, per-day spine, per-guide heat.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuideStep, OmsUsageSession, OmsUsageStepEntry, StepObservationSummary } from '@spatial/shared';
import { computeInsights } from '../src/oms/insights.js';
import type { RawSample } from '../src/oms/intelligence.js';

const NOW = Date.parse('2026-09-22T12:00:00.000Z');
const at = (daysAgo: number, sec = 0) => new Date(NOW - daysAgo * 86_400_000 + sec * 1000).toISOString();

const steps: GuideStep[] = [1, 2, 3].map(i => ({ id: `s${i}`, guideId: 'g1', sequenceNumber: i, title: `Step ${i}`, text: 'do', createdAt: at(40), updatedAt: at(40) } as unknown as GuideStep));
const obs = (p: Partial<StepObservationSummary> = {}): StepObservationSummary => ({
  samples: 30, attention: { target: 20, away: 10 }, onTargetRatio: 0.67, wrongPartTaps: 0, partTaps: 1, replays: 0,
  validateAttempts: 0, realigns: 0, stalls: 0, movingSec: 5, ...p,
});
function visit(stepId: string, start: string, dur: number, extra: Partial<OmsUsageStepEntry> = {}): OmsUsageStepEntry {
  const t0 = Date.parse(start);
  return { stepId, enteredAt: start, exitedAt: new Date(t0 + dur * 1000).toISOString(), durationSeconds: dur, outcome: 'completed', observations: obs(), ...extra };
}
function run(id: string, daysAgo: number, opts: { completed?: boolean; total?: number; wrong?: number; hint?: boolean; guide?: string; config?: string } = {}): OmsUsageSession {
  const start = at(daysAgo);
  const v1 = visit('s1', start, 30, { observations: obs({ wrongPartTaps: opts.wrong ?? 0 }), ...(opts.hint && { hints: [{ id: `h${id}`, signal: 'wrong-part', ts: at(daysAgo, 10), via: 'template' as const, delivery: 'shown' as const }] }) });
  const v2 = visit('s2', at(daysAgo, 30), 40);
  return { id, guideId: opts.guide ?? 'g1', guideName: 'Guide', anchorId: 'a', anchorName: 'A', operatorName: `op${id}`, startedAt: start,
    totalSeconds: opts.total ?? 120, completed: opts.completed ?? true, configId: opts.config, configCode: opts.config, steps: [v1, v2] };
}
const samplesFor = (id: string): RawSample[] => id.startsWith('helped')
  ? [{ step: 's1', t: 5, interaction: 'tap-wrong-part' }, { step: 's1', t: 15, interaction: 'tap-part' }]
  : [{ step: 's1', t: 5, interaction: 'tap-wrong-part' }, { step: 's1', t: 15, interaction: 'tap-wrong-part' }];
const now = new Date(NOW).toISOString();

test('period window and previous-period headline', () => {
  const sessions = [
    run('a', 1), run('b', 2, { completed: false }), run('c', 5, { total: 300 }),          // this period (7 d)
    run('d', 9), run('e', 10), run('f', 12), run('g', 13),                                  // previous period
    run('h', 40),                                                                            // out of both
  ];
  const r = computeInsights(sessions, () => steps, samplesFor, { days: 7 }, now);
  assert.equal(r.headline.runs, 3); assert.equal(r.headline.completed, 2);
  assert.ok(Math.abs(r.headline.completionRate - 2 / 3) < 1e-9);
  assert.equal(r.headline.medianRunSec, 120); assert.equal(r.headline.p90RunSec, 300);
  assert.equal(r.previous.runs, 4); assert.equal(r.previous.completed, 4);
  assert.equal(r.perDay.length, 7);
  assert.equal(r.perDay.reduce((n, d) => n + d.runs, 0), 3);
  assert.equal(r.perDay[r.perDay.length - 1].date, now.slice(0, 10), 'last day of the spine is today');
});

test('hints helped, wrong taps per run, filters by config and guide', () => {
  const sessions = [
    run('helped1', 1, { hint: true, wrong: 2, config: 'CFG-A' }),
    run('nope1', 2, { hint: true, wrong: 4, config: 'CFG-A' }),
    run('x', 3, { wrong: 0, config: 'CFG-B', guide: 'g2' }),
  ];
  const all = computeInsights(sessions, () => steps, samplesFor, { days: 30 }, now);
  assert.equal(all.headline.hintsShown, 2); assert.equal(all.headline.hintsHelped, 1);
  assert.ok(Math.abs(all.headline.wrongTapsPerRun - 2) < 1e-9);
  assert.equal(all.headline.operators, 3);
  assert.equal(all.perGuide.length, 2); assert.equal(all.perGuide[0].guideId, 'g1');
  assert.equal(all.perGuide[0].heat.length, 3, 'heat per step in step order');
  assert.equal(all.perGuide[0].hottestStep, 1, 'the wrong-tap step is hottest');
  const cfgA = computeInsights(sessions, () => steps, samplesFor, { days: 30, configId: 'CFG-A' }, now);
  assert.equal(cfgA.headline.runs, 2);
  const g2 = computeInsights(sessions, () => steps, samplesFor, { days: 30, guideId: 'g2' }, now);
  assert.equal(g2.headline.runs, 1); assert.equal(g2.headline.hintsShown, 0);
});

test('empty period is safe', () => {
  const r = computeInsights([], () => steps, samplesFor, { days: 7 }, now);
  assert.equal(r.headline.runs, 0); assert.equal(r.headline.completionRate, 0); assert.equal(r.perGuide.length, 0); assert.equal(r.perDay.length, 7);
});
