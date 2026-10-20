/**
 * Business Readiness / Impact - the second half of the scorecard (docs/BUSINESS-READINESS.md).
 *
 * The Technology scorecard says whether it works and whether SIB is ready.
 * This half says whether the business is moving: three pillars - Productivity,
 * Velocity, Customer Trust - each a few metrics with a baseline, a now and a
 * target, on the same evidence-and-confidence discipline as the lenses. Where
 * SIB holds the data (run times, attention in the strike zone, first-time-right
 * reads, validation passes, hints per run) the metric fills itself from the
 * usage log every quarter; where it lives in MES, QMS or HR the owner enters it
 * with its source. A pillar's readiness level is how far its needles have moved
 * from baseline toward target; every POC declares which needles it moves.
 *
 * Pure: no I/O. Routes feed it the usage log and the entries.
 *
 * Proprietary & Confidential · Applied Materials.
 */
import type { OmsUsageSession } from '@spatial/shared';
import type { Confidence } from './scorecard-core.js';

export type PillarId = 'productivity' | 'velocity' | 'trust';
export type MetricSource = 'sib' | 'mes' | 'qms' | 'ojt' | 'survey' | 'finance';
/** The source in the owner's words. */
export const SOURCE_WORDS: Record<MetricSource, string> = { sib: 'SIB · automatic', mes: 'MES', qms: 'QMS', ojt: 'OJT · on-the-job training records', survey: 'pulse survey', finance: 'Finance' };

export interface Metric {
  id:         string;
  pillar:     PillarId;
  name:       string;
  unit:       string;                       // "min", "%", "days", "h / unit", "count"
  better:     'lower' | 'higher';
  source:     MetricSource;                 // where the number comes from
  auto?:      boolean;                      // SIB computes it from the usage log
  /** One sentence a lead understands. */
  what:       string;
  /** How it is measured - the formula or the record it is read from. */
  how:        string;
  /** Why it moves the business, and what in the platform moves it. */
  why:        string;
  /** The practice it is borrowed from, named so the rubric is defensible. */
  practice:   string;
  /** Reference range from published cases, marked for what it is. */
  reference?: string;
  weight:     number;                       // within the pillar
}

export interface Pillar { id: PillarId; name: string; question: string; colour: string; metrics: Metric[] }

/** The five readiness words, the same scale as the Technology lenses. */
export const BRL_WORDS: [string, string, string, string, string] = [
  'Baseline only',            // 1: measured, nothing moved
  'Movement in a POC',        // 2: one POC moved it, controlled setting
  'Movement in situ',         // 3: moved on real work, one chamber or team
  'Repeated across chambers', // 4: moved on more than one chamber / team, holds a quarter
  'Business case proven',     // 5: at or past target, finance-grade evidence
];

export const PILLARS: Pillar[] = [
  {
    id: 'productivity', name: 'Productivity', colour: 'var(--ax-blue)',
    question: 'Do people become contributors sooner, and stay capable?',
    metrics: [
      { id: 'ttc', pillar: 'productivity', name: 'Time to contribution', unit: 'days', better: 'lower', source: 'ojt', weight: 3,
        what: 'How long a new technician takes from first day to working a procedure unsupervised.',
        how: 'Days from the OJT start date to the first solo sign-off on a procedure in scope (OJT record · SIB sign-off). Median over the people who started in the quarter.',
        why: 'The instruction is on the equipment and validated as they go, so a newcomer works the real procedure on day one with the system watching. Every POC that puts a guide in front of a new hire moves this.',
        practice: 'Time-to-proficiency (Kirkpatrick level 3 - behaviour on the job); Boeing and Lockheed report 35-85 % shorter training with AR instructions (vendor-reported).',
        reference: 'Published AR cases: -35 % to -85 % training time (vendor-reported, Boeing / Lockheed Martin).' },
      { id: 'learning-curve', pillar: 'productivity', name: 'Runs to proficiency', unit: 'runs', better: 'lower', source: 'sib', auto: true, weight: 2,
        what: 'How many runs an operator needs before their time matches the guide’s typical time.',
        how: 'Per operator and guide: the run count until a run completes within 1.2× the guide’s median run time. Median over operators with 3+ runs this quarter (usage log).',
        why: 'A short curve means the guide teaches; a long one means it is being read, not followed. Hints, validation and readings all shorten it.',
        practice: 'Learning-curve analysis (Wright); value of the first unsupervised unit.' },
      { id: 'hints-per-run', pillar: 'productivity', name: 'Help needed per run', unit: 'hints', better: 'lower', source: 'sib', auto: true, weight: 1,
        what: 'How often the system had to step in during a run.',
        how: 'Hints shown per completed run, median over the quarter (usage log). Demo runs excluded.',
        why: 'Falling help with rising completion is upskilling made visible; rising help on one step is a content problem the Intelligence page names.',
        practice: 'Assistance rate as a proficiency proxy (connected-worker programmes).' },
      { id: 'people-ready', pillar: 'productivity', name: 'People ready', unit: '%', better: 'higher', source: 'ojt', weight: 2,
        what: 'The share of the target population trained on the platform and active on it.',
        how: 'Operators with a sign-off in the last 30 days ÷ operators in the OJT rollout scope (OJT roster · SIB sign-offs).',
        why: 'Readiness is people, not licences. A POC that trains a crew and sees them keep using it moves this; one that trains and stops does not.',
        practice: 'Adoption rate (Prosci ADKAR - ability and reinforcement).' },
      { id: 'change-readiness', pillar: 'productivity', name: 'Change readiness', unit: '/5', better: 'higher', source: 'survey', weight: 1,
        what: 'How ready the floor and the MEs say they are to run this way.',
        how: 'Quarterly five-question pulse (awareness, desire, knowledge, ability, reinforcement) on a 1-5 scale; mean of the group in scope.',
        why: 'The leading indicator of every other number here. A low score with a good POC says the change, not the technology, is the risk.',
        practice: 'ADKAR pulse (Prosci).' },
    ],
  },
  {
    id: 'velocity', name: 'Velocity', colour: 'var(--ax-green)',
    question: 'Is the work faster, and is the technician in the strike zone?',
    metrics: [
      { id: 'slh', pillar: 'velocity', name: 'Standard labour hours', unit: 'h / unit', better: 'lower', source: 'mes', weight: 3,
        what: 'The labour hours the procedure takes per unit, against the standard.',
        how: 'Earned hours and actual hours from the MES for the procedures in scope; the number here is actual per unit, with the standard as the target.',
        why: 'The headline the business watches. Every minute saved on the floor lands here; a POC that cannot be seen here has not reached production scale yet.',
        practice: 'Labour efficiency (earned ÷ actual hours), standard costing.',
        reference: 'Published AR cases: -25 % assembly time (Boeing wiring, vendor-reported); -35 % to -50 % technician time (Lockheed Martin, vendor-reported).' },
      { id: 'cycle-time', pillar: 'velocity', name: 'Procedure cycle time', unit: 'min', better: 'lower', source: 'sib', auto: true, weight: 3,
        what: 'How long a run of the procedure takes, typically.',
        how: 'Median total time of completed runs per guide in scope this quarter; the baseline is the first quarter the guide was run (usage log). Demo runs excluded.',
        why: 'The platform’s own stopwatch. It moves before the MES notices, so it is the early signal that a POC is working.',
        practice: 'Cycle time (lean); typical and slowest-tenth as Insights already reports.' },
      { id: 'strike-zone', pillar: 'velocity', name: 'Time in the strike zone', unit: '%', better: 'higher', source: 'sib', auto: true, weight: 3,
        what: 'The share of a run the technician spends at the work, not walking to a laptop, a drawing or a tool.',
        how: 'Attention-on-target share from the run’s observations (the step target in view), weighted by step time, over completed runs this quarter (usage log). A manual spaghetti-diagram study per quarter calibrates it.',
        why: 'The strike zone is where value is added. Instructions on the equipment remove the walk to the laptop; readings by camera remove the walk to write a value down.',
        practice: 'Value-added time ratio; spaghetti diagram; motion waste (lean seven wastes).' },
      { id: 'process-improvements', pillar: 'velocity', name: 'Process improvements landed', unit: 'count', better: 'higher', source: 'qms', weight: 1,
        what: 'Changes to the procedure that came out of what the platform showed.',
        how: 'Work-instruction revisions in the quarter whose change record cites a SIB finding (Intelligence hot step, Gemba finding, reading drift).',
        why: 'The platform should make the procedure better, not just faster. This is the count of times it did.',
        practice: 'Kaizen count with attributable source.' },
      { id: 'npt', pillar: 'velocity', name: 'Non-productive time', unit: '%', better: 'lower', source: 'mes', weight: 2,
        what: 'The share of shift time logged to waiting, searching and travel.',
        how: 'MES or time-study categories outside direct work, as a share of shift time, for the crews in scope.',
        why: 'The mirror of the strike zone, from the business’s own clock.',
        practice: 'Non-value-added time (lean); OEE availability loss.' },
    ],
  },
  {
    id: 'trust', name: 'Customer Trust', colour: 'var(--ax-orange)',
    question: 'Is the work right the first time, and do fewer problems reach the customer?',
    metrics: [
      { id: 'ftr', pillar: 'trust', name: 'First-time right', unit: '%', better: 'higher', source: 'sib', auto: true, weight: 3,
        what: 'The share of validated steps that passed on the first attempt - presence, reading, label or barcode.',
        how: 'Steps whose first validation or first read passed ÷ steps validated, over completed runs this quarter (usage log). Overrides and typed values count as not first-time right.',
        why: 'Workmanship issues are caught at the step, by the camera, before the chamber closes. This is the number that turns into fewer DMRs and NCs two quarters later.',
        practice: 'First-pass yield (FPY); rolled throughput yield across the procedure.' },
      { id: 'rework-tasks', pillar: 'trust', name: 'Rework tasks', unit: 'count', better: 'lower', source: 'qms', weight: 2,
        what: 'How many rework tasks were raised on the procedures in scope.',
        how: 'Rework work orders in the quarter attributed to the procedures in scope (QMS / MES).',
        why: 'The first place a workmanship issue costs money. A falling count with a rising first-time-right is the platform doing its job.',
        practice: 'Cost of poor quality (COPQ) - internal failure.' },
      { id: 'rework-hours', pillar: 'trust', name: 'Rework hours', unit: 'h', better: 'lower', source: 'qms', weight: 2,
        what: 'The hours those rework tasks cost.',
        how: 'Hours booked to rework orders in the quarter for the procedures in scope.',
        why: 'The cost beside the count; the business case is written in these hours.',
        practice: 'COPQ - internal failure cost.' },
      { id: 'dmr-early', pillar: 'trust', name: 'DMRs caught at the step', unit: '%', better: 'higher', source: 'qms', weight: 2,
        what: 'Of the discrepant-material reports raised, the share found at the step rather than at test or in the field.',
        how: 'DMRs with origin "in-process" ÷ all DMRs for the procedures in scope (QMS). SIB readings and validations that failed and were corrected are the evidence trail.',
        why: 'An early DMR is a cheap DMR. Readings by camera, label checks and presence validation move the find to the moment of work.',
        practice: 'Escape rate / containment point (1-10-100 rule).' },
      { id: 'field-nc', pillar: 'trust', name: 'Field non-conformances', unit: 'count', better: 'lower', source: 'qms', weight: 3,
        what: 'Non-conformances found at the customer for the procedures in scope.',
        how: 'Field NCs by root-cause procedure in the quarter (QMS). Lags the others by one to two quarters.',
        why: 'The number the customer feels. Everything above is in service of this one.',
        practice: 'Customer-reported defects; warranty / escape rate.' },
    ],
  },
];

export const METRICS: Metric[] = PILLARS.flatMap(p => p.metrics);
export const metricById = (id: string): Metric | undefined => METRICS.find(m => m.id === id);

/** A number entered by a person (MES / QMS / HR / survey) or computed by SIB, per quarter. */
export interface ImpactEntry {
  id:         string;
  metricId:   string;
  quarter:    string;                 // FY27-Q1
  kind:       'baseline' | 'value' | 'target';
  value:      number;
  confidence: Confidence;
  source:     string;                 // "MES report WI-4471 Q1", "QMS export 2026-10-12", "SIB usage log"
  scope?:     string;                 // the chamber / crew / procedure set the number covers
  note?:      string;
  by:         string;
  at:         string;
  /** Sample data loaded for review; removed as one. */
  sample?:    boolean;
}

/** What a POC says it will move, and what the quarter says it did. */
export interface PocImpactClaim { pocId: string; pocName: string; useCase: string; metricId: string; hypothesis?: number; measured?: number; note?: string }

// ── Auto metrics from the usage log ─────────────────────────────────────────

const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const quarterOfIso = (iso: string, quarterOf: (d: Date) => string) => quarterOf(new Date(iso));

export interface AutoMetric { metricId: string; value: number | null; n: number; detail: string }

/**
 * The five numbers SIB can compute on its own for a quarter. `quarterOf` is
 * the scorecard's fiscal mapping so the two halves agree on what a quarter is.
 */
export function autoMetrics(all: OmsUsageSession[], quarter: string, quarterOf: (d: Date) => string, guideIds?: string[]): AutoMetric[] {
  const inScope = all.filter(u => !u.demo && (!guideIds || guideIds.includes(u.guideId)));
  const thisQ = inScope.filter(u => quarterOfIso(u.startedAt, quarterOf) === quarter);
  const done = thisQ.filter(u => u.completed && u.totalSeconds);

  // Cycle time: median completed run, minutes, over the guides run this quarter.
  const cycle = median(done.map(u => u.totalSeconds! / 60));

  // Strike zone: attention on target, weighted by step time.
  let onT = 0, tot = 0;
  for (const u of done) for (const s of u.steps) {
    if (s.observations && s.observations.samples && s.durationSeconds) { onT += (s.observations.onTargetRatio ?? 0) * s.durationSeconds; tot += s.durationSeconds; }
  }
  const strike = tot > 0 ? (onT / tot) * 100 : null;

  // First-time right: validated steps (system/manual verdict or a reading) that passed first time.
  let ftrN = 0, ftrOk = 0;
  for (const u of done) for (const s of u.steps) {
    const v = s.validation, r = s.readings ?? [];
    if (!v && !r.length) continue;
    ftrN++;
    const vOk = !v || (v.result === 'pass' && !v.overridden);
    const rOk = r.every(x => x.result === 'pass' && !x.typed);
    if (vOk && rOk) ftrOk++;
  }
  const ftr = ftrN ? (ftrOk / ftrN) * 100 : null;

  // Help needed per run: hints shown per completed run.
  const hints = median(done.map(u => u.steps.reduce((n, s) => n + (s.hints ?? []).filter(h => h.delivery !== 'muted').length, 0)));

  // Runs to proficiency: per operator+guide, runs until within 1.2× the guide median (all quarters, so a curve can be seen).
  const byGuide = new Map<string, number[]>();
  for (const u of inScope.filter(u => u.completed && u.totalSeconds)) (byGuide.get(u.guideId) ?? byGuide.set(u.guideId, []).get(u.guideId)!).push(u.totalSeconds!);
  const gMed = new Map([...byGuide].map(([g, xs]) => [g, median(xs)!]));
  const byOp = new Map<string, OmsUsageSession[]>();
  for (const u of inScope.filter(u => u.completed && u.totalSeconds)) {
    const k = `${u.operatorEmployeeId || u.operatorName}|${u.guideId}`;
    (byOp.get(k) ?? byOp.set(k, []).get(k)!).push(u);
  }
  const curves: number[] = [];
  for (const [k, runs] of byOp) {
    if (runs.length < 3) continue;
    const g = k.split('|')[1]; const m = gMed.get(g); if (!m) continue;
    runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    const i = runs.findIndex(r => r.totalSeconds! <= m * 1.2);
    if (i >= 0 && quarterOfIso(runs[i].startedAt, quarterOf) === quarter) curves.push(i + 1);
  }
  const curve = median(curves);

  return [
    { metricId: 'cycle-time', value: cycle === null ? null : +cycle.toFixed(1), n: done.length, detail: `${done.length} completed runs` },
    { metricId: 'strike-zone', value: strike === null ? null : +strike.toFixed(0), n: done.length, detail: `${Math.round(tot / 60)} step-minutes observed` },
    { metricId: 'ftr', value: ftr === null ? null : +ftr.toFixed(0), n: ftrN, detail: `${ftrOk} of ${ftrN} validated steps` },
    { metricId: 'hints-per-run', value: hints, n: done.length, detail: `${done.length} completed runs` },
    { metricId: 'learning-curve', value: curve, n: curves.length, detail: `${curves.length} operator-guide curves` },
  ];
}

// ── Readiness ────────────────────────────────────────────────────────────────

export interface MetricState {
  metric:     Metric;
  baseline:   number | null;
  now:        number | null;
  target:     number | null;
  previous:   number | null;          // the quarter before, for the needle's ghost
  progress:   number | null;          // 0..1 from baseline toward target (can exceed 1, shown capped)
  confidence: Confidence | null;
  source:     string | null;
  detail:     string | null;
  n?:         number;
}

export interface PillarState {
  pillar:   Pillar;
  metrics:  MetricState[];
  progress: number | null;            // weighted mean of metric progress, 0..1
  level:    number | null;            // 1..5
  word:     string;
  measured: number;                   // metrics with a now
  moving:   number;                   // metrics with progress > 0.05
}

export function progressOf(m: Metric, baseline: number | null, now: number | null, target: number | null): number | null {
  if (baseline === null || now === null || target === null || target === baseline) return null;
  const p = (now - baseline) / (target - baseline);
  return Math.max(-0.5, Math.min(1.5, p));
}

/**
 * The pillar's readiness level from its needles. Progress alone is not
 * enough: the level is capped by the evidence - a pillar whose numbers are all
 * Low confidence cannot be above 2, and one with fewer than half its metrics
 * measured cannot be above 3, so a good POC number does not read as a
 * business case.
 */
export function pillarLevel(ms: MetricState[]): { progress: number | null; level: number | null; word: string } {
  const withP = ms.filter(x => x.progress !== null);
  if (!withP.length) return { progress: null, level: ms.some(x => x.now !== null) ? 1 : null, word: ms.some(x => x.now !== null) ? BRL_WORDS[0] : 'Not measured' };
  const wsum = withP.reduce((s, x) => s + x.metric.weight, 0);
  const progress = withP.reduce((s, x) => s + Math.max(0, Math.min(1, x.progress!)) * x.metric.weight, 0) / wsum;
  let level = progress >= 0.95 ? 5 : progress >= 0.6 ? 4 : progress >= 0.3 ? 3 : progress > 0.05 ? 2 : 1;
  const confs = withP.map(x => x.confidence).filter(Boolean) as Confidence[];
  if (confs.length && confs.every(c => c === 'Low')) level = Math.min(level, 2);
  if (withP.length < Math.ceil(ms.length / 2)) level = Math.min(level, 3);
  if (level === 5 && !confs.some(c => c === 'High')) level = 4;
  return { progress, level, word: BRL_WORDS[level - 1] };
}

/** Fold entries and auto numbers into the state for one quarter. */
export function impactState(entries: ImpactEntry[], auto: AutoMetric[], autoPrev: AutoMetric[], quarter: string, prevQuarter: string): PillarState[] {
  const latest = (metricId: string, kind: ImpactEntry['kind'], q?: string) =>
    entries.filter(e => e.metricId === metricId && e.kind === kind && (!q || e.quarter === q)).sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
  const latestUpTo = (metricId: string, kind: ImpactEntry['kind'], q: string) =>
    entries.filter(e => e.metricId === metricId && e.kind === kind && e.quarter <= q).sort((a, b) => b.quarter.localeCompare(a.quarter) || b.at.localeCompare(a.at))[0] ?? null;
  return PILLARS.map(p => {
    const metrics: MetricState[] = p.metrics.map(m => {
      const b = latest(m.id, 'baseline'), t = latest(m.id, 'target');
      const a = auto.find(x => x.metricId === m.id), ap = autoPrev.find(x => x.metricId === m.id);
      const v = latestUpTo(m.id, 'value', quarter), vp = latestUpTo(m.id, 'value', prevQuarter);
      const now = m.auto && a && a.value !== null ? a.value : v ? v.value : null;
      const previous = m.auto && ap && ap.value !== null ? ap.value : (vp && vp.quarter !== quarter ? vp.value : null);
      const confidence: Confidence | null = m.auto && a && a.value !== null ? (a.n >= 20 ? 'High' : a.n >= 5 ? 'Medium' : 'Low') : v ? v.confidence : null;
      const source = m.auto && a && a.value !== null ? 'SIB usage log' : v ? v.source : null;
      const detail = m.auto && a ? a.detail : v?.note ?? null;
      const baseline = b ? b.value : null, target = t ? t.value : null;
      return { metric: m, baseline, now, target, previous, progress: progressOf(m, baseline, now, target), confidence, source, detail, n: a?.n };
    });
    const { progress, level, word } = pillarLevel(metrics);
    return { pillar: p, metrics, progress, level, word, measured: metrics.filter(x => x.now !== null).length, moving: metrics.filter(x => (x.progress ?? 0) > 0.05).length };
  });
}

/**
 * Who moved the needle: per pillar, each POC's share of the progress, from
 * the change it measured on each needle (its measured delta over the
 * baseline-to-target distance, weighted as the pillar weights its needles).
 * Claims with only a hypothesis are carried as `expected` so the picture
 * shows what is promised beside what is proven. The remainder of the
 * pillar's progress that no POC claims is `unattributed`.
 */
export interface Contribution { pocId: string; pocName: string; useCase: string; measured: number; expected: number }
export interface PillarContributions { pillar: PillarId; progress: number; pocs: Contribution[]; unattributed: number }
export function contributions(ps: PillarState[], claims: PocImpactClaim[]): PillarContributions[] {
  return ps.map(p => {
    const wsum = p.metrics.reduce((s, m) => s + m.metric.weight, 0);
    const by = new Map<string, Contribution>();
    for (const m of p.metrics) {
      const span = m.baseline !== null && m.target !== null ? m.target - m.baseline : null;
      if (!span) continue;
      for (const c of claims.filter(c => c.metricId === m.metric.id)) {
        const e = by.get(c.pocId) ?? { pocId: c.pocId, pocName: c.pocName, useCase: c.useCase, measured: 0, expected: 0 };
        if (c.measured !== undefined) e.measured += Math.max(0, c.measured / span) * m.metric.weight / wsum;
        else if (c.hypothesis !== undefined) e.expected += Math.max(0, c.hypothesis / span) * m.metric.weight / wsum;
        by.set(c.pocId, e);
      }
    }
    const progress = p.progress ?? 0;
    const claimed = [...by.values()].reduce((s, c) => s + c.measured, 0);
    return { pillar: p.pillar.id, progress, pocs: [...by.values()].sort((a, b) => b.measured - a.measured), unattributed: Math.max(0, progress - claimed) };
  });
}

/** The programme's one number: weighted mean of the pillar progress, and the lowest pillar level. */
export function overall(ps: PillarState[]): { progress: number | null; level: number | null; word: string } {
  const withP = ps.filter(p => p.progress !== null);
  if (!withP.length) return { progress: null, level: null, word: 'Not measured' };
  const progress = withP.reduce((s, p) => s + p.progress!, 0) / withP.length;
  const level = Math.min(...ps.map(p => p.level ?? 1));
  return { progress, level, word: BRL_WORDS[level - 1] };
}
