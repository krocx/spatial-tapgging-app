/**
 * POC Portfolio routes - every BU, every use-case, where each stands
 * (docs/POC-PORTFOLIO.md).
 *
 * GET   /portfolio                               → the page (sib/portal/portfolio.html)
 * GET   /portfolio/data                          → every use-case + the overview summary
 * GET   /portfolio/usecases/:id                  → one use-case with its live readiness block
 * POST  /portfolio/usecases                      → create a use-case                     (Manager+)
 * PATCH /portfolio/usecases/:id                  → fields, stage (gated), health          (Manager+)
 * POST  /portfolio/usecases/:id/pocs             → add a POC                             (Manager+)
 * PATCH /portfolio/usecases/:id/pocs/:pid        → scope, definition of done, stage (gated), exit, milestone, tracks (Manager+)
 * POST  /portfolio/usecases/:id/pocs/:pid/status      → a dated status entry             (Engineer+)
 * POST  /portfolio/usecases/:id/pocs/:pid/learnings   → a learning (every learning is a metric) (Engineer+)
 * POST  /portfolio/usecases/:id/pocs/:pid/bottlenecks → a bottleneck with owner, severity, needs-leadership (Engineer+)
 * PATCH /portfolio/usecases/:id/pocs/:pid/bottlenecks/:bid → resolve                     (Engineer+)
 * GET   /portfolio/export.xlsx                   → Portfolio · POCs · Status log · Bottlenecks · Readiness
 * GET   /portfolio/export.pptx                   → overview slide + one slide per use-case (pptxgenjs)
 *
 * Reading is open to anyone with portal access. Every write carries a
 * person's name through UAM; the Owner may do everything; the admin key and
 * the bare API key are refused for writes. Readiness numbers are never
 * stored: guides, device forms, runs and verdicts are read from SIB at
 * request time. Store: data/portfolio-usecases (JSON). Seeded on first use
 * with the use-cases the programme runs today.
 */
import { Router, type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import type { UseCase, Poc, PocStage, UseCaseStage, PocExit, Health, BottleneckSeverity, UamRole, PortfolioEntry, Bottleneck } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { uamActor } from '../middleware/auth.js';
import { guideStore, guideStepStore } from '../guides/store.js';
import { anchorStore } from './anchors.js';
import { readDeviceProfiles } from './devices.js';
import { readinessReport } from '../guides/readiness.js';
import { omsUsageStore } from '../oms/usage-log.js';
import { buildWorkbookXlsx, type TableRow } from '../oms/xlsx-lite.js';
import { buildScorecard, buildTransition, scorecardTouchedSince } from './scorecard.js';
import { quarterOf, TRACKS } from '../scorecard/scorecard-core.js';
import { readCatalog } from './catalog.js';
import { USECASE_STAGES, POC_STAGES, EXITS, HEALTH, HEALTH_LABEL, healthLabel, dvsComplete, STALE_DAYS, pocGate, useCaseGate, currentPoc, sortForOverview, summary, lastActivity, daysSince, openDecisions, openBottlenecks, seedUseCases, stageLabel, pocStageLabel, exitLabel } from '../portfolio/portfolio-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const useCaseStore = new JsonFileStore<UseCase>('portfolio-usecases');

const MANAGERS: UamRole[] = ['owner', 'manager'];
const ENGINEERS: UamRole[] = ['owner', 'manager', 'engineer'];
const me = (req: Request): { name: string; role: UamRole } | null => { const a = uamActor(req); return a?.kind === 'user' ? { name: a.user.name || a.email, role: a.role } : null; };
const requireNamed = (roles: UamRole[], what: string) => (req: Request, res: Response, next: () => void) => {
  const m = me(req);
  if (!m) { res.status(401).json({ error: `Sign in to ${what}, so the entry carries your name`, timestamp: new Date().toISOString() }); return; }
  if (!roles.includes(m.role)) { res.status(403).json({ error: `${what[0].toUpperCase()}${what.slice(1)} needs the ${roles[roles.length - 1][0].toUpperCase()}${roles[roles.length - 1].slice(1)} role or above`, timestamp: new Date().toISOString() }); return; }
  next();
};
const now = () => new Date().toISOString();
const str = (v: unknown, max = 4000): string | undefined => typeof v === 'string' ? v.trim().slice(0, max) : undefined;
const strs = (v: unknown): string[] | undefined => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map(x => x.trim()).filter(Boolean) : undefined;
const bad = (res: Response, msg: string) => res.status(400).json({ error: msg, timestamp: now() });
const gone = (res: Response, what: string) => res.status(404).json({ error: `${what} not found`, timestamp: now() });

/** First use: the programme's use-cases, so the page never opens empty. */
function ensureSeeded(): void {
  if (useCaseStore.findAll().length) return;
  for (const u of seedUseCases(now(), 'seed')) useCaseStore.save(u);
  console.log('[SIB] POC Portfolio seeded with the programme\'s use-cases');
}

// ── Platform capability in place (from the Catalogue) ───────────────────────
// "Shipped" and "beta" are in use; "planned" and unknown ids are the gap. The
// POC's dependency list is the honest "what we already have behind it".
type Cap = { inPlace: number; total: number; features: { id: string; name: string; status: string; inPlace: boolean }[] };
function capabilityFor(p: { features?: string[] }): Cap {
  const cat = readCatalog();
  const byId = new Map((cat?.data.features ?? []).map(f => [f.id, f]));
  const features = (p.features ?? []).map(id => { const f = byId.get(id); const status = f?.status ?? 'unknown'; return { id, name: f?.name ?? id, status, inPlace: status === 'shipped' || status === 'beta' }; });
  return { inPlace: features.filter(f => f.inPlace).length, total: features.length, features };
}

// ── Live readiness block ─────────────────────────────────────────────────────
export function readinessFor(u: UseCase, quarter = quarterOf()) {
  const profiles = readDeviceProfiles();
  const anchorGuides = u.anchorIds.length ? guideStore.findAll().filter(g => u.anchorIds.includes(g.anchorId)).map(g => g.id) : [];
  const guideIds = [...new Set([...u.guideIds, ...anchorGuides])];
  const guides = guideIds.map(id => guideStore.findById(id)).filter((g): g is NonNullable<typeof g> => !!g).map(g => {
    const steps = guideStepStore.findAll().filter(s => s.guideId === g.id).sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    const r = steps.length ? readinessReport(steps, profiles) : null;
    const anchor = anchorStore.findById(g.anchorId);
    return { id: g.id, name: g.name, anchor: anchor?.assetId ?? g.anchorId, published: g.published, steps: steps.length,
      devices: profiles.map(p => { const c = r?.summary[p.id]; return { id: p.id, name: p.name, delivered: c && c.total ? Math.round((c.native + c.adapted) / c.total * 100) : null }; }) };
  });
  const runsAll = omsUsageStore.findAll().filter(x => guideIds.includes(x.guideId));
  const runs = runsAll.filter(x => !x.demo);
  const sc = buildScorecard(quarter);
  const tr = buildTransition(quarter);
  const tracks = TRACKS.map(t => { const x = sc.tracks.find(y => y.id === t.id); return { id: t.id, name: t.name, L1: x?.lenses[0]?.effective ?? null, L2: x?.lenses[1]?.effective ?? null, verdict: x?.master?.verdict ?? null }; });
  return {
    quarter,
    guides,
    published: guides.filter(g => g.published).length,
    runs: runs.length, completed: runs.filter(r => r.completed).length,
    evidenced: runs.filter(r => r.completed && r.steps.some(e => e.evidence || e.validation)).length,
    demoRuns: runsAll.length - runs.length,
    devices: tr.devices.map(d => ({ id: d.id, name: d.name, verdict: d.verdict, coverage: d.coverage })),
    tracks,
    pocs: Object.fromEntries(u.pocs.map(p => [p.id, { scorecardTouched: p.startedAt ? scorecardTouchedSince(p.tracks, p.startedAt) : false, capability: capabilityFor(p) }])),
    inSib: guideIds.length > 0 || u.anchorIds.length > 0,
  };
}

const overviewRow = (u: UseCase) => {
  const p = currentPoc(u); const last = lastActivity(u); const days = daysSince(last) ?? 0;
  return { id: u.id, bu: u.bu, name: u.name, process: u.process, stage: u.stage, health: u.health, healthReason: u.healthReason, sponsor: u.sponsor, meContact: u.meContact,
    currentPoc: p ? { id: p.id, number: p.number, name: p.name, stage: p.stage, exit: p.exit, nextMilestone: p.nextMilestone, capability: (c => ({ inPlace: c.inPlace, total: c.total }))(capabilityFor(p)) } : null,
    pocs: u.pocs.map(x => { const c = capabilityFor(x); const gate = [!!x.scope?.trim(), !!x.definitionOfDone?.trim(), x.learnings.length > 0, !!x.exit && (x.tracks.length ? (x.startedAt ? scorecardTouchedSince(x.tracks, x.startedAt) : false) : true)]; return { id: x.id, number: x.number, name: x.name, stage: x.stage, exit: x.exit, gate, inPlace: c.inPlace, total: c.total, decisions: x.bottlenecks.filter(b => b.needsLeadership && !b.resolvedAt).length, nextMilestone: x.nextMilestone }; }).sort((a, b) => a.number - b.number),
    decisions: openDecisions(u).length, bottlenecks: openBottlenecks(u).length,
    lastActivity: last, daysSince: days, stale: days > STALE_DAYS, inSib: u.anchorIds.length + u.guideIds.length > 0, dvs: dvsComplete(u) };
};

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(__dirname, '../../portal/portfolio.html'));
});

router.get('/data', (req: Request, res: Response) => {
  ensureSeeded();
  const list = sortForOverview(useCaseStore.findAll());
  const m = me(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: {
    summary: summary(list), rows: list.map(overviewRow),
    stages: USECASE_STAGES, pocStages: POC_STAGES, exits: EXITS, health: HEALTH, healthLabel: HEALTH_LABEL, staleDays: STALE_DAYS,
    tracks: TRACKS.map(t => ({ id: t.id, name: t.name })),
    features: (readCatalog()?.data.features ?? []).map(f => ({ id: f.id, name: f.name, status: f.status, area: f.area })).sort((a, b) => a.name.localeCompare(b.name)),
    anchors: anchorStore.findAll().filter(a => a.anchorType === undefined || a.anchorType === 'QR').map(a => ({ id: a.id, assetId: a.assetId })),
    guides: guideStore.findAll().map(g => ({ id: g.id, name: g.name, anchorId: g.anchorId, published: g.published })),
    me: m, can: { edit: !!m && MANAGERS.includes(m.role), note: !!m && ENGINEERS.includes(m.role) },
  }, timestamp: now() });
});

router.get('/usecases/:id', (req: Request, res: Response) => {
  ensureSeeded();
  const u = useCaseStore.findById(req.params.id); if (!u) return gone(res, 'Use-case');
  for (const p of u.pocs) p.features ??= [];
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: { useCase: u, readiness: readinessFor(u), row: overviewRow(u) }, timestamp: now() });
});

// ── Writes ───────────────────────────────────────────────────────────────────
const touch = (u: UseCase, by: string) => { u.updatedAt = now(); u.updatedBy = by; useCaseStore.save(u); };

router.post('/usecases', requireNamed(MANAGERS, 'create a use-case'), (req: Request, res: Response) => {
  const b = req.body ?? {};
  const bu = str(b.bu, 40), name = str(b.name, 160), question = str(b.question);
  if (!bu || !name || !question) return bad(res, 'bu, name and question are required');
  const u: UseCase = { id: uuidv4(), bu, name, question, process: str(b.process, 120), sponsor: str(b.sponsor, 120), meContact: str(b.meContact, 120),
    stage: 'identified', health: 'green', anchorIds: strs(b.anchorIds) ?? [], guideIds: strs(b.guideIds) ?? [], pocs: [],
    dvs: b.dvs && typeof b.dvs === 'object' ? { differentiated: str(b.dvs.differentiated), valuable: str(b.dvs.valuable), sustainable: str(b.dvs.sustainable) } : undefined,
    createdAt: now(), createdBy: me(req)!.name, updatedAt: now(), updatedBy: me(req)!.name };
  useCaseStore.save(u);
  res.status(201).json({ data: u, timestamp: now() });
});

router.patch('/usecases/:id', requireNamed(MANAGERS, 'edit a use-case'), (req: Request, res: Response) => {
  const u = useCaseStore.findById(req.params.id); if (!u) return gone(res, 'Use-case');
  const b = req.body ?? {};
  for (const k of ['bu', 'name', 'question', 'process', 'sponsor', 'meContact', 'healthReason'] as const) { const v = str(b[k], k === 'question' ? 4000 : 160); if (v !== undefined) (u as unknown as Record<string, unknown>)[k] = v; }
  if (b.dvs !== undefined && typeof b.dvs === 'object' && b.dvs) { u.dvs = { ...(u.dvs ?? {}) }; for (const k of ['differentiated', 'valuable', 'sustainable'] as const) { const v = str((b.dvs as Record<string, unknown>)[k]); if (v !== undefined) u.dvs[k] = v; } }
  if (b.anchorIds !== undefined) u.anchorIds = strs(b.anchorIds) ?? [];
  if (b.guideIds !== undefined) u.guideIds = strs(b.guideIds) ?? [];
  if (b.health !== undefined) { if (!HEALTH.includes(b.health)) return bad(res, 'health must be green, amber or red'); if (b.health !== 'green' && !str(b.healthReason) && !u.healthReason) return bad(res, 'Amber or red needs a reason'); u.health = b.health as Health; }
  if (b.stage !== undefined) {
    if (!USECASE_STAGES.some(s => s.id === b.stage)) return bad(res, 'Unknown stage');
    const g = useCaseGate(u, b.stage as UseCaseStage); if (!g.ok) return bad(res, g.why);
    u.stage = b.stage as UseCaseStage;
  }
  touch(u, me(req)!.name);
  res.json({ data: u, timestamp: now() });
});

router.post('/usecases/:id/pocs', requireNamed(MANAGERS, 'add a POC'), (req: Request, res: Response) => {
  const u = useCaseStore.findById(req.params.id); if (!u) return gone(res, 'Use-case');
  const b = req.body ?? {};
  const name = str(b.name, 160); if (!name) return bad(res, 'name is required');
  const number = Number.isInteger(b.number) && b.number > 0 ? b.number : (Math.max(0, ...u.pocs.map(p => p.number)) + 1);
  if (u.pocs.some(p => p.number === number)) return bad(res, `POC-${number} already exists`);
  const p: Poc = { id: uuidv4(), number, name, scope: str(b.scope), definitionOfDone: str(b.definitionOfDone), stage: 'planned',
    tracks: (strs(b.tracks) ?? []).filter(t => TRACKS.some(x => x.id === t)), features: strs(b.features) ?? [], status: [], bottlenecks: [], learnings: [] };
  u.pocs.push(p); touch(u, me(req)!.name);
  res.status(201).json({ data: p, timestamp: now() });
});

const findPoc = (req: Request, res: Response): { u: UseCase; p: Poc } | null => {
  const u = useCaseStore.findById(req.params.id); if (!u) { gone(res, 'Use-case'); return null; }
  const p = u.pocs.find(x => x.id === req.params.pid); if (!p) { gone(res, 'POC'); return null; }
  return { u, p };
};

router.patch('/usecases/:id/pocs/:pid', requireNamed(MANAGERS, 'edit a POC'), (req: Request, res: Response) => {
  const f = findPoc(req, res); if (!f) return; const { u, p } = f;
  const b = req.body ?? {};
  for (const k of ['name', 'scope', 'definitionOfDone', 'exitReason'] as const) { const v = str(b[k], k === 'name' ? 160 : 4000); if (v !== undefined) p[k] = v; }
  if (b.tracks !== undefined) p.tracks = (strs(b.tracks) ?? []).filter(t => TRACKS.some(x => x.id === t));
  if (b.features !== undefined) p.features = strs(b.features) ?? [];
  if (b.exit !== undefined) { if (b.exit !== null && !EXITS.some(e => e.id === b.exit)) return bad(res, 'Unknown exit'); p.exit = (b.exit ?? undefined) as PocExit | undefined; }
  if (b.nextMilestone !== undefined) {
    if (b.nextMilestone === null) delete p.nextMilestone;
    else { const text = str(b.nextMilestone?.text, 240), due = str(b.nextMilestone?.due, 10); if (!text || !due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return bad(res, 'A milestone needs text and a date (YYYY-MM-DD)'); p.nextMilestone = { text, due }; }
  }
  if (b.stage !== undefined) {
    if (!POC_STAGES.some(s => s.id === b.stage)) return bad(res, 'Unknown POC stage');
    const target = b.stage as PocStage;
    const g = pocGate(p, target, p.startedAt ? scorecardTouchedSince(p.tracks, p.startedAt) : false); if (!g.ok) return bad(res, g.why);
    if (target === 'in-progress' && p.stage !== 'in-progress') { p.startedAt = now(); if (u.stage === 'identified' || u.stage === 'scoping' || u.stage === 'agreed') u.stage = 'active'; }
    if (target === 'completed') { p.completedAt = now(); if (p.exit === 'pilot') u.stage = 'pilot'; if (p.exit === 'parked' && !u.pocs.some(x => x.id !== p.id && x.stage !== 'completed')) u.stage = 'parked'; }
    p.stage = target;
  }
  touch(u, me(req)!.name);
  res.json({ data: p, timestamp: now() });
});

const entry = (req: Request, text: string): PortfolioEntry => ({ id: uuidv4(), at: now(), by: me(req)!.name, text });

router.post('/usecases/:id/pocs/:pid/status', requireNamed(ENGINEERS, 'add a status note'), (req: Request, res: Response) => {
  const f = findPoc(req, res); if (!f) return;
  const text = str(req.body?.text); if (!text) return bad(res, 'text is required');
  const e = entry(req, text); f.p.status.push(e); touch(f.u, me(req)!.name);
  res.status(201).json({ data: e, timestamp: now() });
});
router.post('/usecases/:id/pocs/:pid/redteam', requireNamed(ENGINEERS, 'add a red-team entry'), (req: Request, res: Response) => {
  const f = findPoc(req, res); if (!f) return;
  const text = str(req.body?.text); if (!text) return bad(res, 'text is required');
  const e = entry(req, text); (f.p.redTeam ??= []).push(e); touch(f.u, me(req)!.name);
  res.status(201).json({ data: e, timestamp: now() });
});
router.post('/usecases/:id/pocs/:pid/learnings', requireNamed(ENGINEERS, 'add a learning'), (req: Request, res: Response) => {
  const f = findPoc(req, res); if (!f) return;
  const text = str(req.body?.text); if (!text) return bad(res, 'text is required');
  const e = entry(req, text); f.p.learnings.push(e); touch(f.u, me(req)!.name);
  res.status(201).json({ data: e, timestamp: now() });
});
router.post('/usecases/:id/pocs/:pid/bottlenecks', requireNamed(ENGINEERS, 'add a bottleneck'), (req: Request, res: Response) => {
  const f = findPoc(req, res); if (!f) return;
  const b = req.body ?? {};
  const text = str(b.text), owner = str(b.owner, 120);
  if (!text || !owner) return bad(res, 'text and owner are required');
  const severity: BottleneckSeverity = ['low', 'medium', 'high'].includes(b.severity) ? b.severity : 'medium';
  const bn: Bottleneck = { ...entry(req, text), owner, severity, needsLeadership: b.needsLeadership === true };
  f.p.bottlenecks.push(bn); touch(f.u, me(req)!.name);
  res.status(201).json({ data: bn, timestamp: now() });
});
router.patch('/usecases/:id/pocs/:pid/bottlenecks/:bid', requireNamed(ENGINEERS, 'resolve a bottleneck'), (req: Request, res: Response) => {
  const f = findPoc(req, res); if (!f) return;
  const bn = f.p.bottlenecks.find(x => x.id === req.params.bid); if (!bn) return gone(res, 'Bottleneck');
  const b = req.body ?? {};
  if (b.resolution !== undefined) { const r = str(b.resolution); if (!r) return bad(res, 'resolution text is required'); bn.resolution = r; bn.resolvedAt = now(); bn.resolvedBy = me(req)!.name; }
  if (b.needsLeadership !== undefined) bn.needsLeadership = b.needsLeadership === true;
  if (b.owner !== undefined) { const o = str(b.owner, 120); if (o) bn.owner = o; }
  touch(f.u, me(req)!.name);
  res.json({ data: bn, timestamp: now() });
});

// ── Exports ──────────────────────────────────────────────────────────────────
const d = (iso?: string) => iso ? iso.slice(0, 10) : '';

router.get('/export.xlsx', (_req: Request, res: Response) => {
  ensureSeeded();
  const list = sortForOverview(useCaseStore.findAll());
  const port: TableRow[] = [], pocs: TableRow[] = [], status: TableRow[] = [], bott: TableRow[] = [], ready: TableRow[] = [];
  for (const u of list) {
    const r = overviewRow(u); const rd = readinessFor(u);
    port.push({ cells: [u.bu, u.name, u.process ?? '', stageLabel(u.stage), healthLabel(u.health), u.healthReason ?? '', r.currentPoc ? `POC-${r.currentPoc.number} ${r.currentPoc.name} (${pocStageLabel(r.currentPoc.stage)})` : '', r.currentPoc?.nextMilestone ? `${r.currentPoc.nextMilestone.text} · ${r.currentPoc.nextMilestone.due}` : '', r.decisions, r.bottlenecks, d(r.lastActivity), r.daysSince, u.sponsor ?? '', u.meContact ?? '', u.dvs?.differentiated ?? '', u.dvs?.valuable ?? '', u.dvs?.sustainable ?? ''] });
    for (const p of [...u.pocs].sort((a, b) => a.number - b.number)) {
      pocs.push({ cells: [u.bu, u.name, `POC-${p.number}`, p.name, pocStageLabel(p.stage), p.scope ?? '', p.definitionOfDone ?? '', p.tracks.map(t => TRACKS.find(x => x.id === t)?.name ?? t).join(', '), d(p.startedAt), d(p.completedAt), exitLabel(p.exit), p.exitReason ?? '', p.nextMilestone ? `${p.nextMilestone.text} · ${p.nextMilestone.due}` : '', p.learnings.map(l => `${d(l.at)} ${l.by}: ${l.text}`).join('\n'), (p.redTeam ?? []).map(l => `${d(l.at)} ${l.by}: ${l.text}`).join('\n')] });
      for (const s of p.status) status.push({ cells: [u.bu, u.name, `POC-${p.number}`, d(s.at), s.by, s.text] });
      for (const b of p.bottlenecks) bott.push({ cells: [u.bu, u.name, `POC-${p.number}`, d(b.at), b.by, b.text, b.owner, b.severity, b.needsLeadership ? 'yes' : '', b.resolvedAt ? `${d(b.resolvedAt)} ${b.resolvedBy}: ${b.resolution}` : 'open'] });
    }
    ready.push({ cells: [u.bu, u.name, rd.inSib ? 'yes' : 'not started in SIB', rd.published, rd.guides.length, rd.runs, rd.completed, rd.evidenced, rd.demoRuns, rd.devices.map(x => `${x.name}: ${x.verdict}`).join('; '), rd.tracks.map(t => `${t.name}: L1 ${t.L1 ?? '-'} · L2 ${t.L2 ?? '-'}${t.verdict ? ` · ${t.verdict}` : ''}`).join('; '), rd.quarter] });
  }
  const buf = buildWorkbookXlsx([
    { name: 'Portfolio', headers: ['BU', 'Use-case', 'Process', 'Stage', 'Health', 'Health reason', 'Current POC', 'Next milestone', 'Decisions waiting', 'Open bottlenecks', 'Last activity', 'Days since', 'Sponsor', 'ME', 'DVS · differentiated', 'DVS · valuable', 'DVS · sustainable'], rows: port, colWidths: [8, 40, 12, 18, 10, 30, 40, 36, 10, 10, 12, 8, 18, 18, 50, 50, 50], freezeHeader: true },
    { name: 'POCs', headers: ['BU', 'Use-case', 'POC', 'Name', 'Stage', 'Scope', 'Definition of done', 'Tracks', 'Started', 'Completed', 'Exit', 'Exit reason', 'Next milestone', 'Learnings', 'Red team: what would make this fail'], rows: pocs, colWidths: [8, 36, 7, 34, 11, 50, 50, 26, 11, 11, 16, 30, 36, 60, 60], freezeHeader: true },
    { name: 'Status log', headers: ['BU', 'Use-case', 'POC', 'Date', 'By', 'Status'], rows: status, colWidths: [8, 36, 7, 11, 18, 90], freezeHeader: true },
    { name: 'Bottlenecks', headers: ['BU', 'Use-case', 'POC', 'Raised', 'By', 'Bottleneck', 'Owner', 'Severity', 'Needs leadership', 'Resolution'], rows: bott, colWidths: [8, 36, 7, 11, 18, 60, 18, 9, 10, 50], freezeHeader: true },
    { name: 'Readiness', headers: ['BU', 'Use-case', 'In SIB', 'Published guides', 'Guides linked', 'Runs', 'Completed', 'Evidenced', 'Demo runs', 'Device verdicts', 'Scorecard lenses', 'Quarter'], rows: ready, colWidths: [8, 36, 14, 10, 10, 7, 10, 10, 9, 60, 70, 9], freezeHeader: true },
  ]);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="SIB-POC-portfolio-${now().slice(0, 10)}.xlsx"`);
  res.send(buf);
});

router.get('/export.pptx', async (_req: Request, res: Response) => {
  ensureSeeded();
  type PptxCtor = typeof import('pptxgenjs').default;
  let pptxgen: PptxCtor | null = null;
  try { const mod = await import('pptxgenjs'); pptxgen = ((mod as { default?: PptxCtor }).default ?? (mod as unknown as PptxCtor)); } catch { pptxgen = null; }
  if (!pptxgen) { res.status(503).json({ error: 'PowerPoint export needs the pptxgenjs package on this server (npm install)', timestamp: now() }); return; }
  const list = sortForOverview(useCaseStore.findAll());
  const sm = summary(list);
  const BLUE = '4495BC', NAVY = '1B3A5C', INK = '222222', INK2 = '555555', INK3 = '8A8A8A', RULE = 'D6DEE6', TINT = 'EAF2F8', WHITE = 'FFFFFF', GREEN = '7AB800';
  const HC: Record<Health, string> = { green: '2E6B12', amber: 'C98A00', red: 'C0392B' };
  const F = 'Arial';
  const pres = new pptxgen(); pres.layout = 'LAYOUT_WIDE';
  const base = (kicker: string, title: string, sub?: string) => {
    const s = pres.addSlide(); s.background = { color: WHITE };
    s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.12, fill: { color: BLUE }, line: { color: BLUE } });
    s.addText(kicker, { x: 0.5, y: 0.26, w: 10, h: 0.26, fontFace: F, fontSize: 9.5, color: BLUE, bold: true, charSpacing: 2 });
    s.addText(title, { x: 0.5, y: 0.48, w: 12.3, h: 0.5, fontFace: F, fontSize: 20, color: NAVY, bold: true, fit: 'shrink' });
    if (sub) s.addText(sub, { x: 0.5, y: 0.96, w: 12.3, h: 0.3, fontFace: F, fontSize: 10, color: INK2 });
    s.addText([{ text: 'applied', options: { color: BLUE } }, { text: 'x', options: { color: GREEN } }, { text: `  Connected Worker  ·  POC Portfolio  ·  exported ${now().slice(0, 10)}  ·  Proprietary & Confidential - Applied Materials`, options: { color: INK3 } }], { x: 0.5, y: 7.08, w: 12, h: 0.26, fontFace: F, fontSize: 8 });
    return s;
  };
  const H = (t: string) => ({ text: t, options: { bold: true, color: WHITE, fill: { color: BLUE }, fontFace: F, fontSize: 9, valign: 'middle' as const } });
  const C = (t: string, o: Record<string, unknown> = {}) => ({ text: t, options: { color: INK, fontFace: F, fontSize: 8.5, valign: 'top' as const, ...o } });
  const L = (t: string) => C(t, { bold: true, color: NAVY, fill: { color: TINT } });
  const TBL = { border: { type: 'solid' as const, pt: 0.75, color: RULE }, margin: 0.05, autoPage: false };

  // Overview
  {
    const s = base('POC PORTFOLIO  ·  OVERVIEW', `${sm.bus.length} BUs · ${sm.useCases} use-cases · ${sm.pocsInProgress} POCs in progress · ${sm.pocsCompleted} completed · ${sm.decisions} decision${sm.decisions === 1 ? '' : 's'} waiting on leadership`,
      'Decisions waiting first, then health, then the stalest. Readiness numbers read from SIB at export time.');
    const rows = [[H('BU'), H('Use-case'), H('Current POC'), H('Stage'), H('Health'), H('Next milestone'), H('Decisions'), H('Updated')],
      ...list.map(u => { const r = overviewRow(u); return [L(u.bu), C(u.name), C(r.currentPoc ? `POC-${r.currentPoc.number} · ${r.currentPoc.name} (${pocStageLabel(r.currentPoc.stage)})` : '-'), C(stageLabel(u.stage)), C(healthLabel(u.health), { bold: true, color: HC[u.health] }), C(r.currentPoc?.nextMilestone ? `${r.currentPoc.nextMilestone.text} · ${r.currentPoc.nextMilestone.due}` : '-'), C(r.decisions ? String(r.decisions) : '-', { align: 'center', bold: !!r.decisions, color: r.decisions ? 'C0392B' : INK }), C(`${d(r.lastActivity)}${r.stale ? ' · stale' : ''}`, { color: r.stale ? 'C0392B' : INK })]; })];
    s.addTable(rows, { ...TBL, x: 0.5, y: 1.4, w: 12.33, colW: [0.8, 3.3, 3.1, 0.9, 0.8, 2.2, 0.75, 0.48] });
  }
  // Rail map slide: one line per use-case, a station per stage, filled when the gate evidence exists.
  {
    const s = base('POC PORTFOLIO  ·  RAIL MAP', 'Where each use-case is on the line, and what is ahead', 'Filled = gate evidence exists · outline = ahead · ring = you are here · n/m under a POC = platform capability already in place (Catalogue) · flag = decision waiting on leadership');
    const maxPoc = Math.max(3, ...list.map(u => u.pocs.length));
    const cols = ['HVP identified', 'Scoping · HVP review', 'DoD · scope locked', ...Array.from({ length: maxPoc }, (_, i) => `POC-${i + 1}`), 'Pilot', 'Ready to proliferate'];
    const LX = 0.5, LW = 3.0, X0 = LX + LW, CW = (12.83 - X0 - 0.9) / cols.length, Y0 = 1.55, RH = Math.min(0.9, (6.9 - Y0 - 0.3) / Math.max(1, list.length));
    const cx = (i: number) => X0 + i * CW + CW / 2;
    const PAL = ['4495BC', '64B5C4', 'A27BC9', 'E0A100', '6C7BD9', '7AB800'];
    const bus = [...new Set(list.map(u => u.bu))].sort();
    cols.forEach((c, i) => s.addText(c, { x: cx(i) - CW / 2, y: Y0 - 0.3, w: CW, h: 0.25, fontFace: F, fontSize: 7.5, color: INK3, bold: true, align: 'center', fit: 'shrink' }));
    // Framework phase band above the columns (docs/POSITIONING.md § Framework)
    const phases: [string, number, number][] = [['HIGH VALUE PROBLEM', 0, 1], ['XR PROPOSAL', 2, 2], ['DVS PROOF', 3, 2 + maxPoc], ['WMO SUCCESS', 3 + maxPoc, cols.length - 1]];
    for (const [name, a, b] of phases) { const x = cx(a) - CW / 2 + 0.04, w = cx(b) + CW / 2 - 0.04 - x; s.addShape(pres.ShapeType.rect, { x, y: Y0 - 0.62, w, h: 0.24, fill: { color: TINT }, line: { color: TINT } }); s.addText(name, { x, y: Y0 - 0.62, w, h: 0.24, fontFace: F, fontSize: 7.5, color: BLUE, bold: true, align: 'center', charSpacing: 1.5 }); }
    const SO = ['identified', 'scoping', 'agreed', 'active', 'pilot', 'adopted'];
    list.forEach((u, ri) => {
      const y = Y0 + ri * RH + RH / 2; const color = PAL[Math.max(0, bus.indexOf(u.bu)) % PAL.length];
      const si = SO.indexOf(u.stage); const pocs = [...u.pocs].sort((a, b) => a.number - b.number);
      let here = u.stage === 'adopted' ? cols.length - 1 : u.stage === 'pilot' ? cols.length - 2 : (u.stage === 'identified' ? 0 : u.stage === 'scoping' ? 1 : 2);
      pocs.forEach((p, i) => { if (p.stage !== 'planned') here = Math.max(here, 3 + i); });
      s.addText(u.name, { x: LX, y: y - 0.3, w: LW - 0.1, h: 0.3, fontFace: F, fontSize: 10, color: NAVY, bold: true, fit: 'shrink' });
      s.addText(`${u.bu}${u.process ? ' · ' + u.process : ''} · ${healthLabel(u.health)}${u.stage === 'parked' ? ' · parked' : ''}`, { x: LX, y: y, w: LW - 0.1, h: 0.25, fontFace: F, fontSize: 8.5, color: HC[u.health] });
      s.addShape(pres.ShapeType.line, { x: cx(0), y, w: cx(here) - cx(0), h: 0, line: { color, width: 3 } });
      if (u.stage !== 'parked' && here < cols.length - 1) s.addShape(pres.ShapeType.line, { x: cx(here), y, w: cx(cols.length - 1) - cx(here), h: 0, line: { color, width: 1, dashType: 'sysDot' } });
      cols.forEach((c, i) => {
        let done = false, sub = '', cap = '', flag = false;
        if (i <= 2) done = si >= i; else if (i < 3 + maxPoc) { const p = pocs[i - 3]; if (!p) return; done = p.stage === 'completed'; sub = p.stage === 'in-progress' ? 'in progress' : p.stage === 'completed' ? (exitLabel(p.exit).toLowerCase() || 'done') : 'planned'; const cp = capabilityFor(p); if (cp.total) cap = `${cp.inPlace}/${cp.total}`; flag = p.bottlenecks.some(b => b.needsLeadership && !b.resolvedAt); }
        else done = c === 'Pilot' ? si >= 4 : si >= 5;
        const r = i === here && u.stage !== 'parked' ? 0.11 : 0.075;
        if (i === here && u.stage !== 'parked') s.addShape(pres.ShapeType.ellipse, { x: cx(i) - 0.17, y: y - 0.17, w: 0.34, h: 0.34, fill: { color: WHITE }, line: { color, width: 1.5 } });
        s.addShape(pres.ShapeType.ellipse, { x: cx(i) - r, y: y - r, w: 2 * r, h: 2 * r, fill: { color: done || i === here ? color : WHITE }, line: { color, width: 1.5 } });
        if (sub) s.addText(sub, { x: cx(i) - CW / 2, y: y - 0.42, w: CW, h: 0.2, fontFace: F, fontSize: 7.5, color: INK3, align: 'center' });
        if (cap) s.addText(cap, { x: cx(i) - CW / 2, y: y + 0.17, w: CW, h: 0.2, fontFace: F, fontSize: 8, color: INK2, align: 'center', bold: true });
        if (flag) { s.addShape(pres.ShapeType.rect, { x: cx(i) + 0.15, y: y - 0.33, w: 0.025, h: 0.3, fill: { color: 'C0392B' }, line: { color: 'C0392B' } }); s.addShape(pres.ShapeType.triangle, { x: cx(i) + 0.175, y: y - 0.33, w: 0.16, h: 0.13, fill: { color: 'C0392B' }, line: { color: 'C0392B' }, rotate: 90 }); }
      });
      const cp = currentPoc(u);
      if (cp?.nextMilestone) s.addText(`next ${cp.nextMilestone.due}`, { x: 12.83 - 1.1, y: y - 0.12, w: 1.1, h: 0.25, fontFace: F, fontSize: 8, color: INK2, align: 'right' });
    });
  }
  // One slide per use-case
  for (const u of list) {
    const rd = readinessFor(u); const r = overviewRow(u);
    const s = base(`${u.bu}  ·  ${stageLabel(u.stage).toUpperCase()}  ·  ${healthLabel(u.health).toUpperCase()}`, u.name, `${u.process ? `Process: ${u.process} · ` : ''}Sponsor: ${u.sponsor || '-'} · ME: ${u.meContact || '-'} · updated ${d(r.lastActivity)} by ${u.updatedBy}`);
    s.addText('BUSINESS QUESTION', { x: 0.5, y: 1.35, w: 6, h: 0.22, fontFace: F, fontSize: 8.5, color: BLUE, bold: true, charSpacing: 1.5 });
    s.addText(u.question, { x: 0.5, y: 1.55, w: 7.6, h: 0.62, fontFace: F, fontSize: 10, color: INK, valign: 'top' });
    s.addText([{ text: 'DVS  ', options: { bold: true, color: BLUE } }, { text: u.dvs?.differentiated ? `Differentiated: ${u.dvs.differentiated}  ·  Valuable: ${u.dvs.valuable ?? '-'}  ·  Sustainable: ${u.dvs.sustainable ?? '-'}` : 'not written yet', options: { color: INK2 } }], { x: 0.5, y: 2.15, w: 7.6, h: 0.48, fontFace: F, fontSize: 8, valign: 'top' });
    const pocRows = [[H('POC'), H('Stage'), H('Definition of done'), H('Exit'), H('Next milestone')],
      ...[...u.pocs].sort((a, b) => a.number - b.number).map(p => [L(`POC-${p.number} ${p.name}`), C(pocStageLabel(p.stage)), C(p.definitionOfDone || '-'), C(exitLabel(p.exit) + (p.exitReason ? ` - ${p.exitReason}` : '')), C(p.nextMilestone ? `${p.nextMilestone.text} · ${p.nextMilestone.due}` : '-')])];
    s.addTable(pocRows, { ...TBL, x: 0.5, y: 2.65, w: 7.6, colW: [2.1, 0.9, 2.6, 1.0, 1.0] });
    const cur = currentPoc(u);
    const statusText = cur && cur.status.length ? cur.status.slice(-3).reverse().map(e => `${d(e.at)} · ${e.by}: ${e.text}`).join('\n') : 'No status entry yet.';
    s.addText('LATEST STATUS', { x: 0.5, y: 5.0, w: 6, h: 0.22, fontFace: F, fontSize: 8.5, color: BLUE, bold: true, charSpacing: 1.5 });
    s.addText(statusText, { x: 0.5, y: 5.2, w: 7.6, h: 1.0, fontFace: F, fontSize: 9, color: INK, valign: 'top' });
    const open = openBottlenecks(u);
    s.addText('BOTTLENECKS · DECISIONS', { x: 0.5, y: 6.2, w: 6, h: 0.22, fontFace: F, fontSize: 8.5, color: BLUE, bold: true, charSpacing: 1.5 });
    s.addText(open.length ? open.slice(0, 3).map(b => `${b.needsLeadership ? 'DECISION · ' : ''}${b.text} (${b.owner}, ${b.severity}, since ${d(b.at)})`).join('\n') : 'None open.', { x: 0.5, y: 6.4, w: 7.6, h: 0.65, fontFace: F, fontSize: 9, color: open.some(b => b.needsLeadership) ? 'C0392B' : INK, valign: 'top' });
    // readiness block, right column
    s.addShape(pres.ShapeType.rect, { x: 8.4, y: 1.35, w: 4.43, h: 5.7, fill: { color: 'F5F8FB' }, line: { color: RULE, pt: 0.75 } });
    s.addText('READINESS · READ FROM SIB', { x: 8.55, y: 1.42, w: 4.2, h: 0.22, fontFace: F, fontSize: 8.5, color: BLUE, bold: true, charSpacing: 1.5 });
    const lines: string[] = rd.inSib
      ? [`${rd.published} published guide${rd.published === 1 ? '' : 's'} (${rd.guides.length} linked)`, `${rd.runs} runs · ${rd.completed} completed · ${rd.evidenced} evidenced${rd.demoRuns ? ` · ${rd.demoRuns} demo` : ''}`, '', 'Devices (platform-wide, this quarter):', ...rd.devices.map(x => `  ${x.name}: ${x.verdict}${x.coverage !== null ? ` · ${Math.round(x.coverage * 100)} % delivered` : ''}`), '', 'Scorecard lenses:', ...rd.tracks.map(t => `  ${t.name}: L1 ${t.L1 ?? '-'} · L2 ${t.L2 ?? '-'}${t.verdict ? ` · ${t.verdict}` : ''}`)]
      : ['Not started in SIB yet - no chamber or guide linked.', '', 'Devices (platform-wide, this quarter):', ...rd.devices.map(x => `  ${x.name}: ${x.verdict}`)];
    s.addText(lines.join('\n'), { x: 8.55, y: 1.68, w: 4.2, h: 5.3, fontFace: F, fontSize: 9, color: INK, valign: 'top' });
  }
  const buf = await pres.write({ outputType: 'nodebuffer' }) as Buffer;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename="SIB-POC-portfolio-${now().slice(0, 10)}.pptx"`);
  res.send(buf);
});

export default router;
