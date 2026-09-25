// routes/gemba-walks.ts - G2/G8 (2026.4.46): Gemba walk sessions.
//
//   POST   /gemba/walks                  { anchorId, auditorName, auditorId?, projectId?, organization?, bu?, area?, location? } → walk (open)
//   GET    /gemba/walks?anchorId=&auditorId=&status=&from=&to=   → walks newest first, each with derived summary
//   GET    /gemba/walks/export.xlsx?walkId=|walkIds=a,b|all=true → Summary · Findings (all photos embedded) · Photos sheets
//   GET    /gemba/walks/:id               → { walk, findings[] }
//   PATCH  /gemba/walks/:id               → header fields / notes (open walks; submitted walks: notes only)
//   POST   /gemba/walks/:id/submit        { notes? } → endedAt, status 'submitted', summary
//   POST   /gemba/walks/:id/reopen        → back to 'open' (admin, by role/key like any correction)
//   DELETE /gemba/walks/:id               → removes the walk; findings keep their data, lose walkId (admin)
//
// Findings attach by LocTag.walkId (set by the app at creation). The summary
// is derived on every read - never stored - so it cannot drift.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import type { GembaWalk, LocTag } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { locTagStore, LOCTAG_IMG_DIR } from './loc-tags.js';
import { anchorStore } from './anchors.js';
import { GembaValidationError } from '../gemba/library-core.js';
import { validateStartWalk, validateWalkPatch, summarize } from '../gemba/walk-core.js';
import { buildWorkbookXlsx, type TableRow } from '../oms/xlsx-lite.js';

export const gembaWalkStore = new JsonFileStore<GembaWalk>('gemba-walks');

const router = Router();

function fail(res: Response, err: unknown): void {
  if (err instanceof GembaValidationError) { res.status(err.status).json({ error: err.message }); return; }
  console.error('[SIB] Gemba walk error:', err);
  res.status(500).json({ error: 'Internal error' });
}

function findingsOf(walkId: string): LocTag[] {
  return locTagStore.findAll().filter(t => t.walkId === walkId).sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

function withSummary(w: GembaWalk): GembaWalk {
  return { ...w, summary: summarize(findingsOf(w.id)) };
}

/** Live count for /stats: walks open right now. */
export function openWalkCount(): number {
  return gembaWalkStore.findAll().filter(w => w.status === 'open').length;
}

// ── Create / list ───────────────────────────────────────────────────────────

router.post('/', (req: Request, res: Response): void => {
  try {
    const input = validateStartWalk(req.body);
    if (!anchorStore.findById(input.anchorId)) throw new GembaValidationError(404, 'Anchor not found.');
    const now = new Date().toISOString();
    const walk: GembaWalk = { id: uuidv4(), ...input, status: 'open', startedAt: now };
    gembaWalkStore.save(walk);
    console.log(`[SIB] Gemba walk started: ${walk.id} by ${walk.auditorName} (${walk.projectId ?? 'no project'})`);
    res.status(201).json({ data: withSummary(walk), timestamp: now });
  } catch (err) { fail(res, err); }
});

router.get('/', (req: Request, res: Response): void => {
  const q = req.query as Record<string, string | undefined>;
  let walks = gembaWalkStore.findAll();
  if (q.anchorId)  walks = walks.filter(w => w.anchorId === q.anchorId);
  if (q.auditorId) walks = walks.filter(w => w.auditorId === q.auditorId);
  if (q.status === 'open' || q.status === 'submitted') walks = walks.filter(w => w.status === q.status);
  // Date window on startedAt (ISO date or datetime; `to` is inclusive of that day).
  if (q.from && /^\d{4}-\d{2}-\d{2}/.test(q.from)) walks = walks.filter(w => w.startedAt >= q.from!);
  if (q.to && /^\d{4}-\d{2}-\d{2}/.test(q.to)) { const to = q.to.length === 10 ? q.to + 'T23:59:59.999Z' : q.to; walks = walks.filter(w => w.startedAt <= to); }
  walks.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  res.json({ data: walks.map(withSummary), timestamp: new Date().toISOString() });
});

// ── Export (before /:id so the literal path wins) ───────────────────────────
//
// Workbook: Summary (one row per walk: header + counts) · Findings (one row
// per finding, ALL photos embedded side by side, caption beside each) ·
// Photos (one row per photo - filter by caption / markup). Selection:
// ?walkId= | ?walkIds=a,b,c (≤ 200, what the portal table shows) | ?all=true.

const MAX_EXPORT_PHOTOS = 6;             // LOC_TAG_MAX_PHOTOS - columns are fixed
const MAX_EXPORT_WALKS  = 200;

const HEAD_COLS   = ['Walk date', 'Auditor', 'Employee ID', 'Project ID', 'Organization', 'BU', 'Area', 'Location', 'Space', 'Walk status'];
const HEAD_WIDTHS = [12, 18, 12, 16, 14, 14, 12, 14, 16, 11];

const SUMMARY_COLS   = [...HEAD_COLS, 'Started', 'Ended', 'Findings', 'Strength', 'OFI', 'NC', 'Uncategorised', 'Max risk', 'Photos', 'Notes'];
const SUMMARY_WIDTHS = [...HEAD_WIDTHS, 20, 20, 9, 9, 6, 6, 13, 9, 7, 40];

const FINDING_COLS = [...HEAD_COLS, 'Stop #', 'Focus Area', 'Question Code', 'Question', 'Source', 'Finding Category', 'Risk', 'Notes', 'Photos', 'Marked up', 'Logged at'];
const FINDING_WIDTHS = [...HEAD_WIDTHS, 7, 24, 13, 40, 9, 14, 6, 30, 7, 9, 20];
for (let i = 1; i <= MAX_EXPORT_PHOTOS; i++) { FINDING_COLS.push(`Photo ${i}`, `Caption ${i}`); FINDING_WIDTHS.push(36, 28); }
const PHOTO_COL0 = FINDING_COLS.indexOf('Photo 1');

const PHOTO_COLS   = [...HEAD_COLS, 'Stop #', 'Question', 'Finding Category', 'Photo #', 'Caption', 'Marked up', 'Captured at', 'Photo'];
const PHOTO_WIDTHS = [...HEAD_WIDTHS, 7, 40, 14, 8, 40, 9, 20, 36];

function photoBuffer(file: string | undefined): Buffer | undefined {
  if (!file || file.includes('..')) return undefined;
  const abs = path.join(LOCTAG_IMG_DIR, file);
  return fs.existsSync(abs) ? fs.readFileSync(abs) : undefined;
}

function selectWalks(q: Record<string, string | undefined>): GembaWalk[] | { error: string; status: number } {
  if (q.walkId) {
    const w = gembaWalkStore.findById(q.walkId);
    return w ? [w] : { error: 'Walk not found', status: 404 };
  }
  if (q.walkIds) {
    const ids = q.walkIds.split(',').map(x => x.trim()).filter(Boolean);
    if (!ids.length || ids.length > MAX_EXPORT_WALKS) return { error: `walkIds must list 1–${MAX_EXPORT_WALKS} walks.`, status: 400 };
    const walks = ids.map(id => gembaWalkStore.findById(id)).filter((w): w is GembaWalk => !!w);
    if (!walks.length) return { error: 'None of those walks exist.', status: 404 };
    return walks.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  if (q.all === 'true') return gembaWalkStore.findAll().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return { error: 'Pass ?walkId=, ?walkIds=a,b,c or ?all=true', status: 400 };
}

router.get('/export.xlsx', (req: Request, res: Response): void => {
  const sel = selectWalks(req.query as Record<string, string | undefined>);
  if (!Array.isArray(sel)) { res.status(sel.status).json({ error: sel.error }); return; }
  const walks = sel;

  const summaryRows: TableRow[] = [];
  const findingRows: TableRow[] = [];
  const photoRows:   TableRow[] = [];

  for (const w of walks) {
    const space = anchorStore.findById(w.anchorId)?.assetId ?? w.anchorId.slice(0, 8);
    const head = [w.startedAt.slice(0, 10), w.auditorName, w.auditorId ?? '', w.projectId ?? '', w.organization ?? '',
                  w.bu ?? '', w.area ?? '', w.location ?? '', space, w.status];
    const findings = findingsOf(w.id);
    const s = summarize(findings);
    summaryRows.push({ cells: [...head, w.startedAt, w.endedAt ?? '', s.findings, s.strength, s.ofi, s.nc, s.uncategorised,
                                s.maxRisk ?? '', s.photos, w.notes ?? ''] });
    if (!findings.length) { findingRows.push({ cells: [...head, '', '', '', '(no findings)'] }); continue; }

    for (const f of findings) {
      const photos = f.photos ?? (f.referenceImagePath ? [{ path: f.referenceImagePath, caption: undefined as string | undefined,
                                                            markupPath: undefined as string | undefined, capturedAt: f.createdAt }] : []);
      const markedUp = photos.filter(p => p.markupPath).length;
      const question = f.questionText ?? f.title;
      const cells: (string | number | undefined)[] = [...head, f.order + 1,
        f.focusAreaCode ? `${f.focusAreaCode} ${f.focusAreaTitle ?? ''}`.trim() : (f.focusAreaTitle ?? ''),
        f.questionCode ?? '', question,
        f.referenceSource === 'custom' ? 'custom' : (f.questionCode ? 'library' : 'legacy'),
        f.findingCategory ?? f.defectCategory, f.riskRating ?? '', f.description, photos.length, markedUp, f.createdAt];
      const images: { col: number; data: Buffer }[] = [];
      photos.slice(0, MAX_EXPORT_PHOTOS).forEach((p, i) => {
        // The marked-up copy is the evidence the reviewer wants; original otherwise.
        const buf = photoBuffer(p.markupPath ?? p.path);
        cells[PHOTO_COL0 + i * 2]     = buf ? '' : (p.path ? '(file missing)' : '');
        cells[PHOTO_COL0 + i * 2 + 1] = p.caption ?? '';
        if (buf) images.push({ col: PHOTO_COL0 + i * 2, data: buf });
        photoRows.push({ cells: [...head, f.order + 1, question, f.findingCategory ?? f.defectCategory, i + 1, p.caption ?? '',
                                 p.markupPath ? 'yes' : 'no', p.capturedAt ?? '', buf ? '' : '(file missing)'],
                         image: buf });
      });
      findingRows.push({ cells, images });
    }
  }

  const buf = buildWorkbookXlsx([
    { name: 'Summary',  headers: SUMMARY_COLS, rows: summaryRows, colWidths: SUMMARY_WIDTHS, freezeHeader: true },
    { name: 'Findings', headers: FINDING_COLS, rows: findingRows, colWidths: FINDING_WIDTHS, freezeHeader: true },
    { name: 'Photos',   headers: PHOTO_COLS,   rows: photoRows,   colWidths: PHOTO_WIDTHS,   imgCol: PHOTO_COLS.length - 1, freezeHeader: true },
  ]);
  const q = req.query as Record<string, string | undefined>;
  const name = q.walkId ? `gemba-walk-${q.walkId.slice(0, 8)}.xlsx`
             : q.walkIds ? `gemba-walks-${walks.length}-${new Date().toISOString().slice(0, 10)}.xlsx`
             : `gemba-walks-${new Date().toISOString().slice(0, 10)}.xlsx`;
  console.log(`[SIB] Gemba export: ${walks.length} walk(s), ${findingRows.length} finding row(s), ${photoRows.length} photo(s)`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send(buf);
});

// ── One walk ────────────────────────────────────────────────────────────────

router.get('/:id', (req: Request, res: Response): void => {
  const w = gembaWalkStore.findById(req.params.id);
  if (!w) { res.status(404).json({ error: 'Walk not found' }); return; }
  res.json({ data: { walk: withSummary(w), findings: findingsOf(w.id) }, timestamp: new Date().toISOString() });
});

router.patch('/:id', (req: Request, res: Response): void => {
  try {
    const w = gembaWalkStore.findById(req.params.id);
    if (!w) { res.status(404).json({ error: 'Walk not found' }); return; }
    const patch = validateWalkPatch(req.body);
    if (w.status === 'submitted') {
      const keys = Object.keys(patch).filter(k => k !== 'notes');
      if (keys.length) throw new GembaValidationError(409, 'Walk is submitted - only notes can change (reopen to edit the header).');
    }
    const updated = gembaWalkStore.update(w.id, patch as Partial<GembaWalk>)!;
    res.json({ data: withSummary(updated), timestamp: new Date().toISOString() });
  } catch (err) { fail(res, err); }
});

router.post('/:id/submit', (req: Request, res: Response): void => {
  try {
    const w = gembaWalkStore.findById(req.params.id);
    if (!w) { res.status(404).json({ error: 'Walk not found' }); return; }
    const notes = validateWalkPatch({ notes: (req.body as { notes?: unknown })?.notes ?? w.notes ?? '' }).notes;
    const now = new Date().toISOString();
    const updated = gembaWalkStore.update(w.id, { status: 'submitted', endedAt: w.endedAt ?? now, notes })!;
    const out = withSummary(updated);
    console.log(`[SIB] Gemba walk submitted: ${w.id} - ${out.summary?.findings ?? 0} findings`);
    res.json({ data: out, timestamp: now });
  } catch (err) { fail(res, err); }
});

// POST /gemba/walks/:id/adopt { locTagIds?: string[] } - attach findings on
// the same space that have no walk (logged before a header existed) to this
// walk. Default: all of them. Never moves a finding from another walk.
router.post('/:id/adopt', (req: Request, res: Response): void => {
  const w = gembaWalkStore.findById(req.params.id);
  if (!w) { res.status(404).json({ error: 'Walk not found' }); return; }
  const wanted = Array.isArray((req.body as { locTagIds?: unknown })?.locTagIds)
    ? new Set(((req.body as { locTagIds: unknown[] }).locTagIds).filter((x): x is string => typeof x === 'string')) : null;
  const orphans = locTagStore.findAll().filter(t => t.anchorId === w.anchorId && !t.walkId && (!wanted || wanted.has(t.id)));
  for (const t of orphans) locTagStore.update(t.id, { walkId: w.id, updatedAt: new Date().toISOString() });
  console.log(`[SIB] Gemba walk ${w.id}: adopted ${orphans.length} finding(s) without a header`);
  res.json({ data: { adopted: orphans.length, walk: withSummary(gembaWalkStore.findById(w.id)!) }, timestamp: new Date().toISOString() });
});

router.post('/:id/reopen', (req: Request, res: Response): void => {
  const w = gembaWalkStore.findById(req.params.id);
  if (!w) { res.status(404).json({ error: 'Walk not found' }); return; }
  const updated = gembaWalkStore.update(w.id, { status: 'open', endedAt: undefined })!;
  res.json({ data: withSummary(updated), timestamp: new Date().toISOString() });
});

router.delete('/:id', (req: Request, res: Response): void => {
  const w = gembaWalkStore.findById(req.params.id);
  if (!w) { res.status(404).json({ error: 'Walk not found' }); return; }
  let detached = 0;
  for (const f of findingsOf(w.id)) { locTagStore.update(f.id, { walkId: undefined }); detached++; }
  gembaWalkStore.delete(w.id);
  res.json({ deleted: true, findingsDetached: detached, timestamp: new Date().toISOString() });
});

export default router;
