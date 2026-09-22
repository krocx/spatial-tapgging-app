// oms/insights.ts — the leadership view of the usage log (2026.4.46).
//
// Everything on the Insights page is DERIVED from the same event stream the
// Usage Log and Intelligence read — nothing new is captured. `computeInsights`
// is pure (sessions in, numbers out) so it is unit-tested and cheap to cache.
//
//   headline   runs · completion rate · median run time · hints that helped —
//              each with the previous period for a delta
//   perDay     runs and completions per calendar day (the period's spine)
//   perGuide   runs, median / p90 run time, wrong taps per run, and a heat
//              strip per step (the Intelligence heat, reused as-is)
//   hintTrend  shown / helped per day — "the system is learning" chart
//   wrongTrend wrong-part taps per run per day — the quality proxy
//
// Proprietary & Confidential · Applied Materials.

import type { OmsUsageSession, OmsUsageStepEntry, GuideStep, GuideInsights, InsightsHeadline, InsightsDay, InsightsGuide } from '@spatial/shared';
import { scoreVisit, computeIntelligence, type SampleReader } from './intelligence.js';

export interface InsightsQuery {
  /** Period length in days (7 · 30 · 90). */
  days: number;
  /** End of the period (exclusive), ISO. Defaults to now. */
  until?: string;
  configId?: string;
  guideId?: string;
}

const DAY_MS = 86_400_000;
const pct = (arr: number[], q: number): number => { if (!arr.length) return 0; const i = Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * q))); return arr[i]; };
const asc = (xs: number[]) => [...xs].sort((a, b) => a - b);
const day = (iso: string) => iso.slice(0, 10);

function runSeconds(s: OmsUsageSession): number | undefined {
  if (typeof s.totalSeconds === 'number' && s.totalSeconds > 0) return s.totalSeconds;
  if (s.endedAt) return Math.max(0, (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000);
  const last = s.steps.reduce((m, e) => { const t = e.exitedAt ? Date.parse(e.exitedAt) : NaN; return Number.isFinite(t) && t > m ? t : m; }, 0);
  return last ? Math.max(0, (last - Date.parse(s.startedAt)) / 1000) : undefined;
}

function wrongTaps(s: OmsUsageSession): number {
  return s.steps.reduce((n, e) => n + (e.observations?.wrongPartTaps ?? 0), 0);
}

function headline(sessions: OmsUsageSession[], samplesFor: SampleReader): InsightsHeadline {
  const runs = sessions.length;
  const completed = sessions.filter(s => s.completed).length;
  const secs = asc(sessions.map(runSeconds).filter((x): x is number => x !== undefined && x > 0));
  let shown = 0, helped = 0;
  for (const s of sessions) for (const v of s.steps) if (v.hints?.length) {
    const rows = samplesFor(s.id).filter(r => r.step === v.stepId);
    for (const o of scoreVisit(v, rows)) { if (o.delivery === 'shown') { shown++; if (o.helped) helped++; } }
  }
  return {
    runs, completed, completionRate: runs ? completed / runs : 0,
    medianRunSec: pct(secs, 0.5), p90RunSec: pct(secs, 0.9),
    hintsShown: shown, hintsHelped: helped, hintEffectiveness: shown ? helped / shown : 0,
    wrongTapsPerRun: runs ? sessions.reduce((n, s) => n + wrongTaps(s), 0) / runs : 0,
    operators: new Set(sessions.map(s => s.operatorEmployeeId || s.operatorEmail || s.operatorName)).size,
  };
}

export function computeInsights(
  all: OmsUsageSession[], stepsFor: (guideId: string) => GuideStep[], samplesFor: SampleReader,
  q: InsightsQuery, now = new Date().toISOString(),
): GuideInsights {
  // Calendar days: the period ends at the next UTC midnight so "today" is a full column.
  const until = q.until ? Date.parse(q.until) : (Math.floor(Date.parse(now) / DAY_MS) + 1) * DAY_MS;
  const from = until - q.days * DAY_MS;
  const prevFrom = from - q.days * DAY_MS;
  const inScope = (s: OmsUsageSession) => (!q.configId || s.configId === q.configId) && (!q.guideId || s.guideId === q.guideId);
  const t = (s: OmsUsageSession) => Date.parse(s.startedAt);
  const scoped = all.filter(inScope);
  const cur = scoped.filter(s => t(s) >= from && t(s) < until).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const prev = scoped.filter(s => t(s) >= prevFrom && t(s) < from);

  // Per day — every day of the period is present, so the chart has a spine.
  const perDay: InsightsDay[] = [];
  const byDay = new Map<string, InsightsDay>();
  for (let i = 0; i < q.days; i++) {
    const d = day(new Date(from + i * DAY_MS).toISOString());
    const row: InsightsDay = { date: d, runs: 0, completed: 0, hintsShown: 0, hintsHelped: 0, wrongTaps: 0 };
    byDay.set(d, row); perDay.push(row);
  }
  for (const s of cur) {
    const row = byDay.get(day(s.startedAt)); if (!row) continue;
    row.runs++; if (s.completed) row.completed++;
    row.wrongTaps += wrongTaps(s);
    for (const v of s.steps) if (v.hints?.length) {
      const rows = samplesFor(s.id).filter(r => r.step === v.stepId);
      for (const o of scoreVisit(v, rows)) if (o.delivery === 'shown') { row.hintsShown++; if (o.helped) row.hintsHelped++; }
    }
  }

  // Per guide — the Intelligence heat is reused so the two pages never disagree.
  const guideIds = [...new Set(cur.map(s => s.guideId))];
  const perGuide: InsightsGuide[] = guideIds.map(gid => {
    const runs = cur.filter(s => s.guideId === gid);
    const secs = asc(runs.map(runSeconds).filter((x): x is number => x !== undefined && x > 0));
    const gi = computeIntelligence(gid, runs, stepsFor(gid), samplesFor, now);
    const heat = gi.steps.filter(s => s.stepIndex !== undefined).sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0)).map(s => s.heat);
    return {
      guideId: gid, name: runs[0]?.guideName ?? gid, configCode: runs.find(r => r.configCode)?.configCode,
      runs: runs.length, completed: runs.filter(r => r.completed).length,
      medianRunSec: pct(secs, 0.5), p90RunSec: pct(secs, 0.9),
      wrongTapsPerRun: runs.length ? runs.reduce((n, r) => n + wrongTaps(r), 0) / runs.length : 0,
      heat, hottestStep: heat.length ? heat.indexOf(Math.max(...heat)) + 1 : undefined,
    };
  }).sort((a, b) => b.runs - a.runs);

  return {
    period: { days: q.days, from: new Date(from).toISOString(), until: new Date(until).toISOString() },
    headline: headline(cur, samplesFor), previous: headline(prev, samplesFor),
    perDay, perGuide, generatedAt: now,
  };
}

/** Longest single visit per step across runs — used nowhere yet; kept pure for tests. */
export function visitSeconds(v: OmsUsageStepEntry): number | undefined {
  if (typeof v.durationSeconds === 'number') return v.durationSeconds;
  return v.exitedAt ? Math.max(0, (Date.parse(v.exitedAt) - Date.parse(v.enteredAt)) / 1000) : undefined;
}
