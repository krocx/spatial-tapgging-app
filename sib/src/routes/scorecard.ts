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
import { TRACKS, latestByCriterion, suggestLens, masterOutcome, quarterOf, quarterAfter, type Entry, type LensOverride, type MasterVerdict, type TrackId, type Lens, type Confidence, type Verdict, type EvidenceLink } from '../scorecard/scorecard-core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entryStore  = new JsonFileStore<Entry>('scorecard-entries');
const lensStore   = new JsonFileStore<LensOverride & { id: string }>('scorecard-lens');
const masterStore = new JsonFileStore<MasterVerdict & { id: string }>('scorecard-master');

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
  res.json({ data: { ...buildScorecard(quarter), quarters, me: m, can: { score: !!m && SCORERS.includes(m.role), confirm: !!m && OWNERS.includes(m.role) }, history: entryStore.findAll().filter(e => e.quarter === quarter).sort((a, b) => a.at < b.at ? 1 : -1).slice(0, 200) }, timestamp: new Date().toISOString() });
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
  const buf = buildWorkbookXlsx([
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
export default router;
