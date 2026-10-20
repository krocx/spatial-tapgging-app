/**
 * Scorecard routes - the Technology Readiness scorecard SIB keeps for the
 * tracks it has evidence for (docs/TRL-SCORECARD.md).
 *
 * GET  /scorecard                      → the page (sib/portal/scorecard.html)
 * GET  /scorecard/data?quarter=FY27-Q1 → tracks, criteria, latest entry per
 *                                        criterion, lens suggestions, overrides,
 *                                        master verdicts, device profiles, the
 *                                        overview summary
 * POST /scorecard/entries              → add a score (criterion, 1-5,
 *                                        confidence, comment, evidence links)
 * POST /scorecard/lens                 → the track owner confirms / overrides a lens
 * POST /scorecard/master               → record the master sheet's verdict for a track and quarter
 * GET  /scorecard/export.xlsx?quarter= → the workbook block for the master sheet
 *
 * GET  /scorecard/guides             → guide names and ids for the evidence picker
 *
 * Reading is open to anyone with portal access. Every write must carry a
 * person's name: a signed-in UAM user, Engineer or above to score a
 * criterion, Manager or above to confirm a lens or record the verdict. The
 * admin key and the bare API key are refused for writes (they have no name).
 * Stores: data/scorecard-entries, scorecard-lens, scorecard-master (JSON).
 */
import { Router, type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { JsonFileStore } from '../stores/json-file-store.js';
import { uamActor } from '../middleware/auth.js';
import type { UamRole } from '@spatial/shared';
import { guideStore } from './guides.js';
import { anchorStore } from './anchors.js';
import { buildWorkbookXlsx, type TableRow } from '../oms/xlsx-lite.js';
import { readDeviceProfiles } from './devices.js';
import { guideStepStore } from '../guides/store.js';
import { omsUsageStore } from '../oms/usage-log.js';
import { readinessReport } from '../guides/readiness.js';
import { useCaseStore } from './portfolio.js';
import { PILLARS, METRICS, BRL_WORDS, SOURCE_WORDS, autoMetrics, impactState, overall, contributions, metricById, type ImpactEntry, type PocImpactClaim } from '../scorecard/impact-core.js';
import type { UseCase } from '@spatial/shared';
import { TRACKS, latestByCriterion, suggestLens, masterOutcome, quarterOf, quarterAfter, transitionVerdict, TRANSITION_RULE, type Entry, type LensOverride, type MasterVerdict, type TrackId, type Lens, type Confidence, type Verdict, type EvidenceLink } from '../scorecard/scorecard-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryStore  = new JsonFileStore<Entry>('scorecard-entries');
const lensStore   = new JsonFileStore<LensOverride & { id: string }>('scorecard-lens');
const masterStore = new JsonFileStore<MasterVerdict & { id: string }>('scorecard-master');
const impactStore = new JsonFileStore<ImpactEntry>('scorecard-impact');

const CONF: Confidence[] = ['High', 'Medium', 'Low'];
const VERDICTS: Verdict[] = ['ADVANCE', 'CONTINUE', 'PARK', 'CLOSE'];
const SCORERS: UamRole[] = ['owner', 'manager', 'engineer'];
const OWNERS: UamRole[] = ['owner', 'manager'];
const me = (req: Request): { name: string; role: UamRole } | null => { const a = uamActor(req); return a?.kind === 'user' ? { name: a.user.name || a.email, role: a.role } : null; };
const who = (req: Request): string => me(req)?.name ?? 'unknown';
/** A write needs a named, signed-in person with one of the roles. */
const requireNamed = (roles: UamRole[], what: string) => (req: Request, res: Response, next: () => void) => {
  const m = me(req);
  if (!m) { res.status(401).json({ error: `Sign in to ${what}, so the entry carries your name`, timestamp: new Date().toISOString() }); return; }
  if (!roles.includes(m.role)) { res.status(403).json({ error: `${what[0].toUpperCase()}${what.slice(1)} needs the ${roles[roles.length - 1][0].toUpperCase()}${roles[roles.length - 1].slice(1)} role or above`, timestamp: new Date().toISOString() }); return; }
  next();
};
const isQuarter = (q: unknown): q is string => typeof q === 'string' && /^FY\d{2}-Q[1-4]$/.test(q);

/** POC Portfolio gate: has anyone scored one of these tracks since `sinceIso`? */
export function scorecardTouchedSince(trackIds: string[], sinceIso: string): boolean {
  if (!trackIds.length) return true;
  return entryStore.findAll().some(e => trackIds.includes(e.trackId) && e.at >= sinceIso);
}

export function buildScorecard(quarter: string) {
  const entries = entryStore.findAll();
  const profiles = readDeviceProfiles();
  const tracks = TRACKS.map(t => {
    const latest = latestByCriterion(entries, t.id, quarter);
    const lenses = (['L1', 'L2'] as Lens[]).map(lens => {
      const s = suggestLens(t, lens, latest);
      const o = lensStore.findAll().filter(x => x.trackId === t.id && x.lens === lens && x.quarter === quarter).sort((a, b) => a.at < b.at ? 1 : -1)[0];
      return { ...s, override: o ? { score: o.score ?? null, confidence: o.confidence ?? null, note: o.note, by: o.by, at: o.at } : null,
        effective: o?.score ?? s.suggested, effectiveConfidence: o?.confidence ?? s.confidence };
    });
    const perDevice = t.id === 'hardware-fit' ? profiles.map(p => {
      const ld = latestByCriterion(entries, t.id, quarter, p.id);
      return { deviceId: p.id, name: p.name, scored: ld.size, L1: suggestLens(t, 'L1', ld), L2: suggestLens(t, 'L2', ld) };
    }) : undefined;
    const master = masterStore.findAll().filter(m => m.trackId === t.id && m.quarter === quarter).sort((a, b) => a.at < b.at ? 1 : -1)[0] ?? null;
    const all = entries.filter(e => e.trackId === t.id && e.quarter === quarter);
    const evidenceCount = all.reduce((n, e) => n + e.evidence.length, 0);
    const openGaps = t.criteria.filter(k => { const e = latest.get(k.id); return e && e.score <= 2; }).map(k => ({ criterionId: k.id, name: k.name, score: latest.get(k.id)!.score }));
    return { ...t, latest: Object.fromEntries(latest), lenses, perDevice, master, entries: all.length, evidenceCount, openGaps };
  });
  return { quarter, tracks, profiles, generatedAt: new Date().toISOString() };
}

/** The glasses-transition view: one row per device, by the stated rule (scorecard-core.ts). */
export function buildTransition(quarter: string) {
  const profiles = readDeviceProfiles();
  const entries = entryStore.findAll();
  const hw = TRACKS.find(t => t.id === 'hardware-fit')!;
  // Coverage across the published guides the library shows (their anchor exists).
  const anchors = new Set(anchorStore.findAll().map(a => a.id));
  const guides = guideStore.findAll().filter(g => g.published && anchors.has(g.anchorId));
  const steps = guideStepStore.findAll();
  const cov: Record<string, { native: number; adapted: number; assisted: number; total: number }> = {};
  for (const p of profiles) cov[p.id] = { native: 0, adapted: 0, assisted: 0, total: 0 };
  for (const g of guides) {
    const st = steps.filter(s => s.guideId === g.id).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    if (!st.length) continue;
    const r = readinessReport(st, profiles);
    for (const p of profiles) { const c = r.summary[p.id]; if (!c) continue; cov[p.id].native += c.native; cov[p.id].adapted += c.adapted; cov[p.id].assisted += c.assisted; cov[p.id].total += c.total; }
  }
  // Runs per device from the usage log's work context (XR kit · … · <profile>, Even G2 · companion); everything else ran on the iPad.
  // Demo placements (scene placed by tap, not at the equipment) are counted apart: a demo never lifts a verdict.
  const all = omsUsageStore.findAll();
  const usage = all.filter(u => !u.demo);
  const demoOf = (p: { id: string; delivery: string }) => all.filter(u => u.demo && runFilter(p)(u)).length;
  const runFilter = (p: { id: string; delivery: string }) => (u: typeof all[number]) => {
    const wc = (u.workContext || '').toLowerCase();
    if (p.id === 'even-g2') return wc.startsWith('even g2');
    if (p.delivery === 'app') return !wc.startsWith('xr kit') && !wc.startsWith('even g2');
    return wc.startsWith('xr kit') && wc.includes(p.id);
  };
  const runsOf = (p: { id: string; delivery: string }) => usage.filter(runFilter(p));
  const devices = profiles.map(p => {
    const latest = latestByCriterion(entries, 'hardware-fit', quarter, p.id);
    const l1 = suggestLens(hw, 'L1', latest), l2 = suggestLens(hw, 'L2', latest);
    const c = cov[p.id]; const coverage = c.total ? (c.native + c.adapted) / c.total : null; const nativeShare = c.total ? c.native / c.total : null;
    const runs = runsOf(p); const evidencedRuns = runs.filter(u => u.completed && u.steps.some(e => e.evidence || e.validation)).length;
    const blockers = hw.criteria.filter(k => { const e = latest.get(k.id); return e && e.score <= 2; }).map(k => ({ criterionId: k.id, name: k.name, score: latest.get(k.id)!.score }));
    const both = [l1.confidence, l2.confidence].filter(Boolean) as Confidence[];
    const conf: Confidence | null = both.length ? (both.includes('Low') ? 'Low' : both.includes('Medium') ? 'Medium' : 'High') : null;
    const v = transitionVerdict({ coverage, nativeShare, l1: l1.suggested, l2: l2.suggested, confidence: conf, runs: runs.length, evidencedRuns, blockers });
    return { id: p.id, name: p.name, delivery: p.delivery, display: p.display, overlay: p.overlay, coverage, nativeShare, steps: c.total, guides: guides.length, l1: l1.suggested, l2: l2.suggested, confidence: conf, scored: latest.size, of: hw.criteria.length, runs: runs.length, demoRuns: demoOf(p), evidencedRuns, blockers, ...v };
  });
  const order: Record<string, number> = { 'READY FOR PILOT': 0, 'ASSESSING': 1, 'NOT YET': 2, 'NOT SCORED': 3 };
  devices.sort((a, b) => order[a.verdict] - order[b.verdict] || (b.coverage ?? 0) - (a.coverage ?? 0));
  const counts = { ready: devices.filter(d => d.verdict === 'READY FOR PILOT').length, assessing: devices.filter(d => d.verdict === 'ASSESSING').length, notYet: devices.filter(d => d.verdict === 'NOT YET').length, notScored: devices.filter(d => d.verdict === 'NOT SCORED').length };
  const foundation = ['content-pipeline', 'ar-sdk'].map(id => { const m = masterStore.findAll().filter(x => x.trackId === id && x.quarter === quarter).sort((a, b) => a.at < b.at ? 1 : -1)[0] ?? null; return { trackId: id, name: TRACKS.find(t => t.id === id)!.name, verdict: m?.verdict ?? null, at: m?.at ?? null }; });
  return { quarter, rule: TRANSITION_RULE, publishedGuides: guides.length, devices, counts, foundation };
}

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../../portal/scorecard.html'));
});

router.get('/data', (req: Request, res: Response) => {
  const quarter = isQuarter(req.query.quarter) ? req.query.quarter : quarterOf();
  // This quarter, the next four (so the FY27 reviews can be scored ahead), and any quarter with data.
  const now = quarterOf();
  const quarters = [...new Set([now, ...[1, 2, 3, 4].map(n => quarterAfter(now, n)), ...entryStore.findAll().map(e => e.quarter), ...masterStore.findAll().map(m => m.quarter)])].sort();
  res.setHeader('Cache-Control', 'no-store');
  const m = me(req);
  res.json({ data: { ...buildScorecard(quarter), transition: buildTransition(quarter), quarters, me: m, can: { score: !!m && SCORERS.includes(m.role), confirm: !!m && OWNERS.includes(m.role) }, history: entryStore.findAll().filter(e => e.quarter === quarter).sort((a, b) => a.at < b.at ? 1 : -1).slice(0, 200) }, timestamp: new Date().toISOString() });
});

router.post('/entries', requireNamed(SCORERS, 'score a criterion'), (req: Request, res: Response) => {
  const b = req.body as Partial<Entry>;
  const track = TRACKS.find(t => t.id === b.trackId);
  const crit = track?.criteria.find(k => k.id === b.criterionId);
  const score = Number(b.score);
  if (!track || !crit) { res.status(400).json({ error: 'Unknown track or criterion' }); return; }
  if (!(score >= 1 && score <= 5 && Number.isInteger(score))) { res.status(400).json({ error: 'score must be 1 to 5' }); return; }
  if (!CONF.includes(b.confidence as Confidence)) { res.status(400).json({ error: 'confidence must be High, Medium or Low' }); return; }
  const quarter = isQuarter(b.quarter) ? b.quarter : quarterOf();
  const evidence: EvidenceLink[] = Array.isArray(b.evidence) ? b.evidence.filter(e => e && typeof e.ref === 'string' && e.ref.trim()).map(e => ({ kind: e.kind || 'link', ref: String(e.ref).trim().slice(0, 500), ...(e.label ? { label: String(e.label).slice(0, 120) } : {}) })) : [];
  if (!evidence.length && score >= 4) { res.status(400).json({ error: 'A 4 or 5 needs at least one piece of evidence - a score without evidence is an opinion' }); return; }
  const entry: Entry = {
    id: uuidv4(), trackId: track.id, criterionId: crit.id, quarter, score: score as Entry['score'], confidence: b.confidence as Confidence,
    comment: String(b.comment ?? '').slice(0, 2000), evidence, by: who(req), at: new Date().toISOString(),
    ...(track.id === 'hardware-fit' && typeof b.deviceId === 'string' && b.deviceId ? { deviceId: b.deviceId } : {}),
    ...(typeof b.guideId === 'string' && b.guideId ? { guideId: b.guideId } : {}),
  };
  entryStore.save(entry);
  res.status(201).json({ data: entry, timestamp: new Date().toISOString() });
});

router.post('/lens', requireNamed(OWNERS, 'confirm a lens'), (req: Request, res: Response) => {
  const b = req.body as Partial<LensOverride>;
  if (!TRACKS.some(t => t.id === b.trackId) || (b.lens !== 'L1' && b.lens !== 'L2')) { res.status(400).json({ error: 'Unknown track or lens' }); return; }
  const score = b.score === undefined || b.score === null ? undefined : Number(b.score);
  if (score !== undefined && !(score >= 1 && score <= 5 && Number.isInteger(score))) { res.status(400).json({ error: 'score must be 1 to 5' }); return; }
  if (b.confidence !== undefined && !CONF.includes(b.confidence)) { res.status(400).json({ error: 'confidence must be High, Medium or Low' }); return; }
  if (score !== undefined && !String(b.note ?? '').trim()) { res.status(400).json({ error: 'An override needs a note saying why' }); return; }
  const o = { id: uuidv4(), trackId: b.trackId as TrackId, lens: b.lens as Lens, quarter: isQuarter(b.quarter) ? b.quarter : quarterOf(), ...(score !== undefined ? { score } : {}), ...(b.confidence ? { confidence: b.confidence } : {}), note: String(b.note ?? '').slice(0, 1000), by: who(req), at: new Date().toISOString() };
  lensStore.save(o);
  res.status(201).json({ data: o, timestamp: new Date().toISOString() });
});

router.post('/master', requireNamed(OWNERS, 'record the verdict'), (req: Request, res: Response) => {
  const b = req.body as Partial<MasterVerdict>;
  if (!TRACKS.some(t => t.id === b.trackId) || !VERDICTS.includes(b.verdict as Verdict)) { res.status(400).json({ error: 'Unknown track or verdict' }); return; }
  const m = { id: uuidv4(), trackId: b.trackId as TrackId, quarter: isQuarter(b.quarter) ? b.quarter : quarterOf(), verdict: b.verdict as Verdict, ...(typeof b.weighted === 'number' ? { weighted: b.weighted } : {}), ...(b.note ? { note: String(b.note).slice(0, 1000) } : {}), by: who(req), at: new Date().toISOString() };
  masterStore.save(m);
  res.status(201).json({ data: m, timestamp: new Date().toISOString() });
});

// Guide names for the evidence picker (anyone who can read the page). Same
// rule as the Guide Library: a guide is listed through its anchor, so guides
// whose anchor is gone stay in the store (their logs and sessions still
// resolve as evidence) but are not offered here. Anchor name disambiguates.
router.get('/guides', (_req: Request, res: Response) => {
  const anchors = new Map(anchorStore.findAll().map(a => [a.id, a.assetId || a.id]));
  const guides = guideStore.findAll().filter(g => anchors.has(g.anchorId))
    .map(g => ({ id: g.id, name: g.name, anchor: anchors.get(g.anchorId)!, published: !!g.published }))
    .sort((a, b) => a.anchor.localeCompare(b.anchor) || a.name.localeCompare(b.name));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: guides, timestamp: new Date().toISOString() });
});

// The workbook block for the master sheet: one row per track and lens in the
// master's column order, the criteria beneath, and an evidence sheet with SIB
// ids anyone can open.
router.get('/export.xlsx', (req: Request, res: Response) => {
  const quarter = isQuarter(req.query.quarter) ? req.query.quarter : quarterOf();
  const sc = buildScorecard(quarter);
  const lensRows: TableRow[] = [];
  const critRows: TableRow[] = [];
  const evRows: TableRow[] = [];
  let ev = 0;
  const evRefs = new Map<string, string>();
  for (const t of sc.tracks) {
    for (const L of t.lenses) {
      const refs: string[] = [];
      for (const k of t.criteria.filter(k => k.lens === L.lens)) {
        const e = (t.latest as Record<string, Entry>)[k.id]; if (!e) continue;
        for (const link of e.evidence) {
          const key = `${link.kind}:${link.ref}`;
          let id = evRefs.get(key);
          if (!id) { id = `SIB-${String(++ev).padStart(3, '0')}`; evRefs.set(key, id); evRows.push({ cells: [id, t.name, quarter, L.lens, link.label || `${k.name}: ${e.comment || e.score}`, `${link.kind} ${link.ref}`, e.confidence, e.by, e.at.slice(0, 10)] }); }
          if (!refs.includes(id)) refs.push(id);
        }
      }
      lensRows.push({ cells: [t.name, quarter, L.lens, L.effective ?? '', L.effectiveConfidence ?? '', refs.join(', '), L.suggested === null ? 'no criteria scored' : `${L.suggested} (${L.rule})`, L.override ? `${L.override.by}: ${L.override.note}` : ''] });
    }
    for (const k of t.criteria) {
      const e = (t.latest as Record<string, Entry>)[k.id];
      critRows.push({ cells: [t.name, k.lens, k.name, e?.score ?? '', e?.confidence ?? '', e?.comment ?? '', e ? e.evidence.map(l => `${l.kind} ${l.ref}`).join('; ') : '', e?.by ?? '', e?.at.slice(0, 10) ?? ''] });
    }
  }
  const tr = buildTransition(quarter);
  const trRows: TableRow[] = tr.devices.map(d => ({ cells: [d.name, d.verdict, d.coverage === null ? '' : Math.round(d.coverage * 100) + ' %', d.nativeShare === null ? '' : Math.round(d.nativeShare * 100) + ' %', d.l1 ?? '', d.l2 ?? '', d.confidence ?? '', d.runs, d.evidencedRuns, d.blockers.map(b => `${b.name} (${b.score})`).join('; '), d.because, d.moves] }));
  // Business Readiness block (docs/BUSINESS-READINESS.md): the needles for the quarter.
  const bAll = omsUsageStore.findAll();
  const bPrev = quarterAfter(quarter, -1);
  const bState = impactState(impactStore.findAll(), autoMetrics(bAll, quarter, quarterOf), autoMetrics(bAll, bPrev, quarterOf), quarter, bPrev);
  const bRows: TableRow[] = bState.flatMap(p => p.metrics.map(m => ({ cells: [
    p.pillar.name, m.metric.name, m.metric.unit, m.metric.better === 'lower' ? 'lower is better' : 'higher is better',
    m.baseline ?? '', m.previous ?? '', m.now ?? '', m.target ?? '',
    m.progress === null ? '' : Math.round(Math.max(0, Math.min(1, m.progress)) * 100) + ' %',
    m.confidence ?? '', m.source ?? '', m.metric.auto ? 'SIB' : m.metric.source.toUpperCase(), m.detail ?? '',
  ] })));
  const bPillarRows: TableRow[] = [
    ...bState.map(p => ({ cells: [p.pillar.name, p.level ?? '', p.word, p.progress === null ? '' : Math.round(p.progress * 100) + ' %', p.measured, p.pillar.metrics.length, p.moving] })),
    (() => { const o = overall(bState); return { cells: ['Overall', o.level ?? '', o.word, o.progress === null ? '' : Math.round(o.progress * 100) + ' %', '', '', ''] }; })(),
  ];
  const buf = buildWorkbookXlsx([
    { name: 'Business readiness', headers: ['Pillar', 'Level', 'Readiness', 'Progress to target', 'Measured', 'Metrics', 'Moving'], rows: bPillarRows, colWidths: [18, 7, 26, 18, 10, 9, 8], freezeHeader: true },
    { name: 'Needles', headers: ['Pillar', 'Metric', 'Unit', 'Direction', 'Baseline', 'Previous quarter', 'This quarter', 'Target', 'Progress', 'Confidence', 'Source', 'From', 'Detail'], rows: bRows, colWidths: [16, 28, 9, 16, 10, 14, 12, 10, 10, 11, 30, 7, 40], freezeHeader: true },
    { name: 'Glasses transition', headers: ['Device', 'Verdict', 'Steps delivered', 'Native', 'L1', 'L2', 'Confidence', 'Runs', 'Evidenced runs', 'Blockers', 'Because', 'What moves it'], rows: trRows, colWidths: [24, 16, 14, 10, 5, 5, 11, 7, 13, 40, 50, 60], freezeHeader: true },
    { name: 'SIB Import', headers: ['Track', 'Quarter', 'Lens', 'Score', 'Confidence', 'Evidence refs', 'Suggested from criteria', 'Owner note'], rows: lensRows, colWidths: [26, 10, 7, 7, 11, 24, 60, 50], freezeHeader: true },
    { name: 'Criteria', headers: ['Track', 'Lens', 'Criterion', 'Score', 'Confidence', 'Comment', 'Evidence', 'Scored by', 'Date'], rows: critRows, colWidths: [26, 6, 28, 7, 11, 50, 50, 16, 11], freezeHeader: true },
    { name: 'Evidence', headers: ['Ref', 'Track', 'Quarter', 'Lens', 'What the evidence is', 'Where it lives (SIB id / link)', 'Confidence', 'Captured by', 'Date'], rows: evRows, colWidths: [9, 26, 10, 7, 50, 50, 11, 16, 11], freezeHeader: true },
  ]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="SIB-scorecard-${quarter}.xlsx"`);
  res.send(buf);
});

/** For the Overview tab: what the master gate would say with the owner's L3-L5 (entered on the master sheet) - we only preview with SIB's L1/L2 and nulls. */
export { masterOutcome };

// ── Business Readiness / Impact (docs/BUSINESS-READINESS.md) ─────────────────
// GET /scorecard/impact?quarter= - the three pillars with every metric's
// baseline / now / target / previous, the readiness level per pillar and
// overall, the POC claims against each needle, and what to enter next.
router.get('/impact', (req: Request, res: Response) => {
  const quarter = isQuarter(req.query.quarter) ? req.query.quarter : quarterOf();
  const prev = quarterAfter(quarter, -1);
  const all = omsUsageStore.findAll();
  const auto = autoMetrics(all, quarter, quarterOf);
  const autoPrev = autoMetrics(all, prev, quarterOf);
  const entries = impactStore.findAll();
  const pillars = impactState(entries, auto, autoPrev, quarter, prev);
  // Every POC's claims on the needles, with the use-case for context.
  const claims: PocImpactClaim[] = [];
  for (const u of useCaseStore.findAll()) for (const p of u.pocs ?? []) for (const c of p.impacts ?? []) {
    if (!metricById(c.metricId)) continue;
    claims.push({ pocId: p.id, pocName: `POC-${p.number} ${p.name}`, useCase: u.name, metricId: c.metricId, hypothesis: c.hypothesis, measured: c.measured, note: c.note });
  }
  // Risks, bottlenecks and support needed: from the portfolio, for the use-cases whose POCs claim a needle.
  const claimingUse = new Set(claims.map(c => c.useCase));
  const risks: { useCase: string; poc?: string; kind: 'bottleneck' | 'health' | 'milestone'; severity: string; needsLeadership: boolean; owner?: string; text: string; at?: string }[] = [];
  for (const u of useCaseStore.findAll()) {
    if (!claimingUse.has(u.name)) continue;
    if (u.health && u.health !== 'green') risks.push({ useCase: u.name, kind: 'health', severity: u.health === 'red' ? 'high' : 'medium', needsLeadership: u.health === 'red', text: `Use-case ${u.health === 'red' ? 'off track' : 'at risk'}${u.healthReason ? ': ' + u.healthReason : ''}` });
    for (const p of u.pocs ?? []) {
      for (const b of p.bottlenecks ?? []) if (!b.resolvedAt) risks.push({ useCase: u.name, poc: `POC-${p.number} ${p.name}`, kind: 'bottleneck', severity: b.severity, needsLeadership: !!b.needsLeadership, owner: b.owner, text: b.text, at: b.at });
      if (p.nextMilestone?.due && p.stage === 'in-progress' && new Date(p.nextMilestone.due) < new Date()) risks.push({ useCase: u.name, poc: `POC-${p.number} ${p.name}`, kind: 'milestone', severity: 'medium', needsLeadership: false, text: `Milestone overdue: ${p.nextMilestone.text} (due ${p.nextMilestone.due})` });
    }
  }
  risks.sort((a, b) => Number(b.needsLeadership) - Number(a.needsLeadership) || ({ high: 3, medium: 2, low: 1 }[b.severity] ?? 0) - ({ high: 3, medium: 2, low: 1 }[a.severity] ?? 0));
  // What to enter next: metrics with no baseline, no target, or no value this quarter.
  const todo = pillars.flatMap(p => p.metrics.filter(m => m.baseline === null || m.target === null || m.now === null).map(m => ({
    metricId: m.metric.id, pillar: p.pillar.name, name: m.metric.name, source: m.metric.source,
    missing: [m.baseline === null ? 'baseline' : null, m.target === null ? 'target' : null, m.now === null ? (m.metric.auto ? 'no runs yet' : 'this quarter’s value') : null].filter(Boolean) as string[],
  })));
  const m = me(req);
  res.json({ data: {
    quarter, previous: prev, pillars, overall: overall(pillars), words: BRL_WORDS, claims, todo, risks,
    contributions: contributions(pillars, claims), sourceWords: SOURCE_WORDS,
    sample: entries.some(e => e.sample) || useCaseStore.findAll().some(u => u.name.startsWith('[Sample]')),
    quarters: [...new Set([quarter, prev, ...entries.map(e => e.quarter)])].sort(),
    metrics: METRICS.map(x => ({ id: x.id, pillar: x.pillar, name: x.name, unit: x.unit, better: x.better, source: x.source, auto: !!x.auto, what: x.what, how: x.how, why: x.why, practice: x.practice, reference: x.reference ?? null, weight: x.weight })),
    pillarsMeta: PILLARS.map(p => ({ id: p.id, name: p.name, question: p.question, colour: p.colour })),
    history: entries.filter(e => e.kind === 'value').map(e => ({ metricId: e.metricId, quarter: e.quarter, value: e.value, confidence: e.confidence, source: e.source, by: e.by, at: e.at })),
    can: { enter: !!m && SCORERS.includes(m.role), target: !!m && OWNERS.includes(m.role) }, me: m,
  }, timestamp: new Date().toISOString() });
});

// POST /scorecard/impact/entries - a baseline, a value for a quarter, or a target.
// Values and baselines: Engineer and above, with the source named. Targets: Manager and above.
router.post('/impact/entries', requireNamed(SCORERS, 'enter a business number'), (req: Request, res: Response) => {
  const b = req.body as Partial<ImpactEntry>;
  const metric = metricById(String(b.metricId));
  if (!metric) { res.status(400).json({ error: 'Unknown metric' }); return; }
  const kind = b.kind === 'baseline' || b.kind === 'target' || b.kind === 'value' ? b.kind : null;
  if (!kind) { res.status(400).json({ error: 'kind must be baseline, value or target' }); return; }
  if (kind === 'target' && !OWNERS.includes(me(req)!.role)) { res.status(403).json({ error: 'Setting a target needs the Manager role or above' }); return; }
  const value = Number(b.value);
  if (!Number.isFinite(value)) { res.status(400).json({ error: 'value must be a number' }); return; }
  if (!CONF.includes(b.confidence as Confidence)) { res.status(400).json({ error: 'confidence must be High, Medium or Low' }); return; }
  const source = String(b.source ?? '').trim();
  if (!source) { res.status(400).json({ error: 'Name the source - the report, export or study the number comes from. A number without a source is an opinion.' }); return; }
  if (metric.auto && kind === 'value') { res.status(400).json({ error: `${metric.name} is computed by SIB from the usage log; enter its baseline and target, the value fills itself` }); return; }
  const entry: ImpactEntry = {
    id: uuidv4(), metricId: metric.id, quarter: isQuarter(b.quarter) ? b.quarter : quarterOf(), kind, value, confidence: b.confidence as Confidence,
    source: source.slice(0, 300), ...(b.scope ? { scope: String(b.scope).slice(0, 200) } : {}), ...(b.note ? { note: String(b.note).slice(0, 2000) } : {}),
    by: who(req), at: new Date().toISOString(),
  };
  impactStore.save(entry);
  res.status(201).json({ data: entry, timestamp: new Date().toISOString() });
});

// GET /scorecard/impact/template.xlsx?quarter= - the needles as a workbook to fill in and import back:
// one row per needle with what it is and how it is measured, the numbers SIB already has, and
// empty cells for this quarter's value, the baseline and the target. Automatic needles take only
// baseline and target. A second sheet explains the words.
router.get('/impact/template.xlsx', (req: Request, res: Response) => {
  const quarter = isQuarter(req.query.quarter) ? req.query.quarter : quarterOf();
  const prev = quarterAfter(quarter, -1);
  const all = omsUsageStore.findAll();
  const st = impactState(impactStore.findAll(), autoMetrics(all, quarter, quarterOf), autoMetrics(all, prev, quarterOf), quarter, prev);
  const rows: TableRow[] = st.flatMap(p => p.metrics.map(m => ({ cells: [
    p.pillar.name, m.metric.id, m.metric.name, m.metric.unit, m.metric.better === 'lower' ? 'lower is better' : 'higher is better',
    m.metric.auto ? 'SIB computes the value - enter baseline and target only' : SOURCE_WORDS[m.metric.source], m.metric.how,
    m.baseline ?? '', m.metric.auto ? (m.now ?? '') : '', m.target ?? '', '', '', '', '',
  ] })));
  const words: TableRow[] = [
    { cells: ['Value for ' + quarter, 'The number for this quarter, in the metric\u2019s unit. Leave blank to keep what SIB has. Not read for automatic needles.'] },
    { cells: ['Baseline', 'The number from the last full quarter before the platform. Enter once; a new value replaces it.'] },
    { cells: ['Target', 'Where the sponsor wants it. Managers and above; a new value replaces it.'] },
    { cells: ['Source', 'Required for any row with a number: the report, export or study it comes from (e.g. "MES labour report FY26-Q4, WI-4471").'] },
    { cells: ['Scope', 'Optional: the chamber, crew or procedure set the number covers.'] },
    { cells: ['Confidence', 'High: repeated on real work, reproducible. Medium: more than once in a controlled setting. Low: once, a demo or hearsay. Blank = Medium.'] },
    { cells: ['Note', 'Optional.'] },
    { cells: ['Metric id', 'Do not change - the import matches rows by it.'] },
  ];
  const buf = buildWorkbookXlsx([
    { name: 'Needles ' + quarter, headers: ['Pillar', 'Metric id', 'Metric', 'Unit', 'Direction', 'Source', 'How it is measured', 'Baseline', 'SIB value (read-only)', 'Target', 'Value for ' + quarter, 'Source of the numbers', 'Scope', 'Confidence', 'Note'], rows, colWidths: [16, 18, 28, 9, 16, 26, 60, 10, 14, 10, 14, 36, 24, 11, 36], freezeHeader: true },
    { name: 'How to fill', headers: ['Column', 'What goes in it'], rows: words, colWidths: [22, 110], freezeHeader: true },
  ]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="business-readiness-${quarter}.xlsx"`);
  res.send(buf);
});

// POST /scorecard/impact/import - rows from the filled template (parsed in the browser):
// [{ metricId, value?, baseline?, target?, source, scope?, confidence?, note? }]. Same rules as
// single entries; the whole file is checked before anything is saved, and the reply says what went in.
router.post('/impact/import', requireNamed(SCORERS, 'import business numbers'), (req: Request, res: Response) => {
  const quarter = isQuarter(req.body?.quarter) ? req.body.quarter : quarterOf();
  const rows = Array.isArray(req.body?.rows) ? req.body.rows as Record<string, unknown>[] : [];
  const canTarget = OWNERS.includes(me(req)!.role);
  const out: ImpactEntry[] = []; const problems: string[] = []; const skipped: string[] = [];
  const num = (v: unknown) => v === '' || v === null || v === undefined ? null : (Number.isFinite(Number(v)) ? Number(v) : NaN);
  for (const r of rows) {
    const metric = metricById(String(r.metricId ?? '').trim());
    if (!metric) { if (String(r.metricId ?? '').trim()) problems.push(`Unknown metric id "${r.metricId}"`); continue; }
    const kinds: [ImpactEntry['kind'], number | null][] = [['baseline', num(r.baseline)], ['target', num(r.target)], ['value', metric.auto ? null : num(r.value)]];
    const present = kinds.filter(([, v]) => v !== null);
    if (!present.length) { skipped.push(metric.name); continue; }
    if (present.some(([, v]) => Number.isNaN(v))) { problems.push(`${metric.name}: a cell is not a number`); continue; }
    const source = String(r.source ?? '').trim();
    if (!source) { problems.push(`${metric.name}: the source is missing`); continue; }
    const conf = ['High', 'Medium', 'Low'].includes(String(r.confidence)) ? String(r.confidence) as Confidence : 'Medium';
    for (const [kind, value] of present) {
      if (kind === 'target' && !canTarget) { problems.push(`${metric.name}: setting a target needs the Manager role`); continue; }
      out.push({ id: uuidv4(), metricId: metric.id, quarter, kind, value: value as number, confidence: conf, source: source.slice(0, 300),
        ...(r.scope ? { scope: String(r.scope).slice(0, 200) } : {}), ...(r.note ? { note: String(r.note).slice(0, 2000) } : {}), by: who(req), at: new Date().toISOString() });
    }
  }
  if (problems.length) { res.status(400).json({ error: `Nothing imported - fix these first: ${problems.join('; ')}`, problems, timestamp: new Date().toISOString() }); return; }
  for (const e of out) impactStore.save(e);
  res.json({ data: { saved: out.length, skipped, quarter }, timestamp: new Date().toISOString() });
});

// POST /scorecard/impact/sample - load the review sample (ETCH · 3D OMS → AR OMS): a use-case with three
// POCs claiming needles, open bottlenecks, and three quarters of numbers, all marked sample. Owner only.
// DELETE /scorecard/impact/sample removes it as one.
router.post('/impact/sample', requireNamed(['owner'], 'load the sample'), (req: Request, res: Response) => {
  const now = new Date().toISOString(); const by = who(req);
  const q0 = quarterOf(), q1 = quarterAfter(q0, -1), q2 = quarterAfter(q0, -2);
  const E = (metricId: string, kind: ImpactEntry['kind'], quarter: string, value: number, confidence: Confidence = 'Medium'): ImpactEntry =>
    ({ id: uuidv4(), metricId, kind, quarter, value, confidence, source: 'SAMPLE · ETCH 3D OMS → AR OMS review data', scope: 'ETCH · Centura chamber lid and lift procedures', by, at: now, sample: true });
  const B = (id: string, v: number) => E(id, 'baseline', q2, v, 'High');
  const T = (id: string, v: number) => E(id, 'target', q2, v, 'High');
  const V = (id: string, q: string, v: number, c: Confidence = 'Medium') => E(id, 'value', q, v, c);
  const entries = [
    B('ttc', 45), T('ttc', 25), V('ttc', q1, 41), V('ttc', q0, 36, 'High'),
    B('people-ready', 20), T('people-ready', 80), V('people-ready', q1, 35), V('people-ready', q0, 48, 'High'),
    B('change-readiness', 2.8), T('change-readiness', 4.2), V('change-readiness', q1, 3.1, 'Low'), V('change-readiness', q0, 3.4),
    B('learning-curve', 5), T('learning-curve', 2), B('hints-per-run', 2.5), T('hints-per-run', 0.5),
    B('slh', 14.5), T('slh', 11), V('slh', q1, 14.1), V('slh', q0, 13.2, 'High'),
    B('cycle-time', 12), T('cycle-time', 6), B('strike-zone', 55), T('strike-zone', 75),
    B('process-improvements', 0), T('process-improvements', 6), V('process-improvements', q1, 1), V('process-improvements', q0, 2, 'High'),
    B('npt', 28), T('npt', 15), V('npt', q1, 26, 'Low'), V('npt', q0, 23),
    B('ftr', 71), T('ftr', 92),
    B('rework-tasks', 18), T('rework-tasks', 8), V('rework-tasks', q1, 16), V('rework-tasks', q0, 12, 'High'),
    B('rework-hours', 96), T('rework-hours', 40), V('rework-hours', q1, 88), V('rework-hours', q0, 70, 'High'),
    B('dmr-early', 40), T('dmr-early', 75), V('dmr-early', q1, 48), V('dmr-early', q0, 58),
    B('field-nc', 6), T('field-nc', 2), V('field-nc', q1, 6), V('field-nc', q0, 5, 'Low'),
  ];
  for (const e of entries) impactStore.save(e);
  const pe = (text: string, daysAgo: number) => ({ id: uuidv4(), at: new Date(Date.now() - daysAgo * 86400000).toISOString(), by, text });
  const uc: UseCase = {
    id: 'sample-etch-3doms-aroms', bu: 'ETCH', name: '[Sample] ETCH · 3D OMS to AR OMS', question: 'Can the 3D OMS lid and lift procedures run as AR work instructions on the Centura, with fewer workmanship issues and less time per unit?',
    process: 'Centura chamber lid · lift assembly', sponsor: 'ETCH WMO lead', meContact: 'ME, Centura line', stage: 'active', health: 'amber', healthReason: 'Cleanroom-rated glasses not yet available; iPad pilot holds the date',
    anchorIds: [], guideIds: [], dvs: { differentiated: 'Validation and readings by camera, not a checklist', valuable: 'Rework hours and field NCs on the lid procedure', sustainable: 'Procedures authored once in the Designer, imported from 3D OMS' },
    pocs: [
      { id: 'sample-poc-1', number: 1, name: 'Lid procedure in AR on the iPad', scope: 'The 42-step lid procedure, one chamber, two crews. Out: lift assembly, glasses.', definitionOfDone: 'Two crews run the procedure in AR for four weeks with validation on; cycle time, first-time right and strike zone measured against the baseline.',
        stage: 'completed', startedAt: new Date(Date.now() - 95 * 86400000).toISOString(), completedAt: new Date(Date.now() - 20 * 86400000).toISOString(), exit: 'next-poc', tracks: ['content-pipeline', 'hardware-fit'], features: ['spatial-steps', 'step-validation', 'usage-log'],
        impacts: [{ metricId: 'cycle-time', hypothesis: -4, measured: -3.5, note: 'crew B faster than crew A; night shift not measured' }, { metricId: 'ftr', hypothesis: 10, measured: 13 }, { metricId: 'strike-zone', hypothesis: 15, measured: 11, note: 'tool fetch still off-target' }, { metricId: 'rework-tasks', hypothesis: -5, measured: -4 }, { metricId: 'ttc', hypothesis: -10, measured: -9 }],
        status: [pe('Four-week run complete; crews asked to keep the iPads', 20), pe('Crew B on week 2; validation false-fail on step 31 fixed by retraining the cone', 55)], bottlenecks: [], learnings: [pe('A step validated by the camera is re-done less: rework tasks on the lid fell from 18 to 14 in the quarter, with the drop on the steps that have validation', 20), pe('Tool fetch is the largest off-target block (strike zone 66 %, not 70 %): a tool shadow board at the chamber is the next move', 22)],
        redTeam: [pe('If the cone retraining is needed per chamber the author cost does not scale', 60)] },
      { id: 'sample-poc-2', number: 2, name: 'Readings and labels on the floor', scope: 'Leak-check reading, torque display and the three serial labels on the lid procedure read by camera. Out: glasses.', definitionOfDone: 'Readings and labels judged on device for six weeks; DMRs caught at the step counted against the QMS.',
        stage: 'in-progress', startedAt: new Date(Date.now() - 18 * 86400000).toISOString(), tracks: ['content-pipeline'], features: ['spatial-readings', 'usage-log'],
        impacts: [{ metricId: 'dmr-early', hypothesis: 20 }, { metricId: 'ftr', hypothesis: 5 }, { metricId: 'rework-hours', hypothesis: -20 }],
        status: [pe('Leak checker display reads at 0.5 % stability; torque display next week', 3)], bottlenecks: [{ ...pe('Luna labels: Data Matrix only decodes within 30 cm; needs the label size review with the supplier', 5), owner: 'ME, Centura line', severity: 'medium', needsLeadership: false }], learnings: [],
        nextMilestone: { text: 'Six-week readings run complete', due: new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10) } },
      { id: 'sample-poc-3', number: 3, name: 'Glasses pilot on the lift assembly (HoloLens 2)', scope: 'The lift assembly on cleanroom-rated glasses, hands free. Out: lid procedure.', definitionOfDone: 'One crew, two weeks, non-productive time and SLH measured; Hardware Fit scored.',
        stage: 'planned', tracks: ['hardware-fit', 'ar-sdk'], features: ['xr-kit', 'device-readiness'],
        impacts: [{ metricId: 'npt', hypothesis: -8 }, { metricId: 'slh', hypothesis: -1.5 }, { metricId: 'ttc', hypothesis: -5 }],
        status: [], bottlenecks: [
          { ...pe('GIS firewall: device MDM and the SIB endpoint for HoloLens are not approved; without it the pilot cannot start', 12), owner: 'IT security partner', severity: 'high', needsLeadership: true },
          { ...pe('Cleanroom-rated glasses: two units on order, delivery unconfirmed', 9), owner: 'Programme', severity: 'high', needsLeadership: true },
        ], learnings: [], nextMilestone: { text: 'Pilot start', due: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10) } },
    ],
    createdAt: now, createdBy: by, updatedAt: now, updatedBy: by,
  };
  useCaseStore.save(uc);
  res.status(201).json({ data: { entries: entries.length, useCase: uc.name }, timestamp: now });
});
router.delete('/impact/sample', requireNamed(['owner'], 'remove the sample'), (_req: Request, res: Response) => {
  let n = 0;
  for (const e of impactStore.findAll()) if (e.sample) { impactStore.delete(e.id); n++; }
  for (const u of useCaseStore.findAll()) if (u.name.startsWith('[Sample]')) { useCaseStore.delete(u.id); n++; }
  res.json({ data: { removed: n }, timestamp: new Date().toISOString() });
});

// PATCH /scorecard/impact/claims - a POC's claim on a needle (hypothesis, and later the measured change). Manager+.
router.patch('/impact/claims', requireNamed(OWNERS, 'record a POC impact'), (req: Request, res: Response) => {
  const b = req.body as { useCaseId?: string; pocId?: string; metricId?: string; hypothesis?: number | null; measured?: number | null; note?: string };
  const u = useCaseStore.findById(String(b.useCaseId));
  const poc = u?.pocs?.find(p => p.id === b.pocId);
  if (!u || !poc) { res.status(404).json({ error: 'Unknown use-case or POC' }); return; }
  if (!metricById(String(b.metricId))) { res.status(400).json({ error: 'Unknown metric' }); return; }
  poc.impacts = poc.impacts ?? [];
  let c = poc.impacts.find(x => x.metricId === b.metricId);
  if (!c) { c = { metricId: String(b.metricId) }; poc.impacts.push(c); }
  if (b.hypothesis !== undefined) { if (b.hypothesis === null) delete c.hypothesis; else c.hypothesis = Number(b.hypothesis); }
  if (b.measured !== undefined) { if (b.measured === null) delete c.measured; else c.measured = Number(b.measured); }
  if (b.note !== undefined) { if (b.note) c.note = String(b.note).slice(0, 500); else delete c.note; }
  useCaseStore.save(u);
  res.json({ data: poc.impacts, timestamp: new Date().toISOString() });
});

export default router;
