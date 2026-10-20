/** Business Readiness / Impact (docs/BUSINESS-READINESS.md): the readiness rule and the auto metrics. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PILLARS, METRICS, progressOf, pillarLevel, impactState, overall, autoMetrics, type ImpactEntry } from '../src/scorecard/impact-core.js';
import { quarterOf } from '../src/scorecard/scorecard-core.js';
import type { OmsUsageSession } from '@spatial/shared';

const ftr = METRICS.find(m => m.id === 'ftr')!, slh = METRICS.find(m => m.id === 'slh')!;

test('progress: direction-aware, clamped, null without the three numbers', () => {
  assert.equal(progressOf(slh, 10, 8, 6), 0.5);            // lower is better: 10 → 6, now 8
  assert.equal(progressOf(ftr, 70, 85, 90), 0.75);          // higher is better
  assert.equal(progressOf(ftr, 70, 60, 90), -0.5);          // went the wrong way - floored
  assert.equal(progressOf(ftr, 70, 95, 90), 1.25);          // past target - kept (shown capped)
  assert.equal(progressOf(ftr, null, 85, 90), null);
  assert.equal(progressOf(ftr, 90, 85, 90), null);          // target = baseline is no needle
});

test('pillar level: progress bands, capped by evidence and coverage', () => {
  const p = PILLARS.find(x => x.id === 'trust')!;
  const mk = (over: Partial<Record<string, { b: number; n: number; t: number; c: 'High' | 'Medium' | 'Low' }>>) => p.metrics.map(m => {
    const o = over[m.id];
    return { metric: m, baseline: o?.b ?? null, now: o?.n ?? null, target: o?.t ?? null, previous: null, progress: o ? progressOf(m, o.b, o.n, o.t) : null, confidence: o?.c ?? null, source: o ? 'x' : null, detail: null };
  });
  // Nothing measured → not measured; one value with no target → Level 1 (baseline only).
  assert.equal(pillarLevel(mk({})).level, null);
  // All five measured, 70 % of the way, High confidence → Level 4.
  const good = mk({ ftr: { b: 70, n: 84, t: 90, c: 'High' }, 'rework-tasks': { b: 20, n: 13, t: 10, c: 'High' }, 'rework-hours': { b: 100, n: 65, t: 50, c: 'Medium' }, 'dmr-early': { b: 40, n: 61, t: 70, c: 'High' }, 'field-nc': { b: 8, n: 5, t: 4, c: 'Medium' } });
  assert.equal(pillarLevel(good).level, 4);
  // Same movement, Low confidence everywhere → capped at 2.
  const low = good.map(m => ({ ...m, confidence: 'Low' as const }));
  assert.equal(pillarLevel(low).level, 2);
  // Only two of five measured, even at target → capped at 3.
  const thin = mk({ ftr: { b: 70, n: 90, t: 90, c: 'High' }, 'field-nc': { b: 8, n: 4, t: 4, c: 'High' } });
  assert.equal(pillarLevel(thin).level, 3);
  // At target with High evidence on all → 5.
  const done = good.map(m => ({ ...m, now: m.target, progress: 1, confidence: 'High' as const }));
  assert.equal(pillarLevel(done).level, 5);
});

test('overall is the lowest pillar; state folds entries and auto numbers', () => {
  const q = 'FY27-Q1', prev = 'FY26-Q4';
  const e = (metricId: string, kind: ImpactEntry['kind'], value: number, quarter = q): ImpactEntry =>
    ({ id: metricId + kind + quarter, metricId, quarter, kind, value, confidence: 'High', source: 'test', by: 'me', at: '2026-10-20T00:00:00Z' });
  const entries = [e('slh', 'baseline', 10), e('slh', 'target', 6), e('slh', 'value', 9, prev), e('slh', 'value', 8), e('cycle-time', 'baseline', 40), e('cycle-time', 'target', 30)];
  const auto = [{ metricId: 'cycle-time', value: 35, n: 25, detail: '25 runs' }];
  const autoPrev = [{ metricId: 'cycle-time', value: 38, n: 10, detail: '10 runs' }];
  const st = impactState(entries, auto, autoPrev, q, prev);
  const vel = st.find(p => p.pillar.id === 'velocity')!;
  const s = vel.metrics.find(m => m.metric.id === 'slh')!, c = vel.metrics.find(m => m.metric.id === 'cycle-time')!;
  assert.equal(s.now, 8); assert.equal(s.previous, 9); assert.equal(s.progress, 0.5);
  assert.equal(c.now, 35); assert.equal(c.previous, 38); assert.equal(c.progress, 0.5); assert.equal(c.confidence, 'High'); assert.equal(c.source, 'SIB usage log');
  assert.equal(vel.level, 3);                                 // 50 % but only 2 of 5 measured → capped at 3
  const o = overall(st);
  assert.equal(o.level, 1);                                   // the lowest pillar: productivity and trust have nothing measured, and a programme is as ready as its weakest promise
});

test('auto metrics from the usage log: cycle time, strike zone, first-time right, hints, learning curve', () => {
  const q = quarterOf(new Date('2026-10-20T00:00:00Z'));
  const run = (op: string, guide: string, day: number, secs: number, extra: Partial<OmsUsageSession['steps'][number]> = {}, demo = false): OmsUsageSession => ({
    id: `${op}-${guide}-${day}`, guideId: guide, guideName: guide, anchorId: 'a', anchorName: 'A', operatorName: op, startedAt: `2026-10-${String(day).padStart(2, '0')}T08:00:00Z`,
    totalSeconds: secs, completed: true, ...(demo ? { demo: { ts: 'x' } } : {}),
    steps: [{ stepId: 's1', enteredAt: 'x', outcome: 'completed', durationSeconds: secs, validation: { mode: 'system', result: 'pass' }, observations: { samples: 10, onTargetRatio: 0.8 } as never, ...extra }],
  } as OmsUsageSession);
  const runs = [
    run('ann', 'g', 1, 600), run('ann', 'g', 2, 500), run('ann', 'g', 3, 420),   // guide median 420 s → 1.2× = 504 s: ann is there on run 2
    run('bob', 'g', 4, 400, { readings: [{ kind: 'text-match', result: 'pass', read: 'x', typed: false, onFail: 'block', words: '' }] }),
    run('bob', 'g', 5, 380, { validation: { mode: 'system', result: 'fail', overridden: true } }),
    run('bob', 'g', 6, 390, { hints: [{ id: 'h', signal: 's', ts: 'x', via: 'template', delivery: 'shown' }] }),
    run('cat', 'g', 7, 9999, {}, true),                                          // demo: excluded
  ];
  const a = Object.fromEntries(autoMetrics(runs, q, quarterOf).map(x => [x.metricId, x]));
  assert.equal(a['cycle-time'].n, 6);
  assert.equal(a['cycle-time'].value, 7);                       // median of 600,500,420,400,380,390 s → 420 s → 7.0 min
  assert.equal(a['strike-zone'].value, 80);
  assert.equal(a['ftr'].value, 83);                              // 5 of 6 validated steps first-time right (the override is not)
  assert.equal(a['hints-per-run'].value, 0);
  assert.equal(a['learning-curve'].value, 2);                    // ann: run 2; bob: run 1 → median of [1, 2] = 2 (upper median)
});
