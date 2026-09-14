// routes/gemba-walks.ts — G2/G8 (2026.4.46): Gemba walk sessions.
//
//   POST   /gemba/walks                  { anchorId, auditorName, auditorId?, projectId?, organization?, bu?, area?, location? } → walk (open)
//   GET    /gemba/walks?anchorId=&auditorId=&status=   → walks newest first, each with derived summary
//   GET    /gemba/walks/export.xlsx?walkId=|all=true   → one row per finding (photo embedded), walk header repeated
//   GET    /gemba/walks/:id               → { walk, findings[] }
//   PATCH  /gemba/walks/:id               → header fields / notes (open walks; submitted walks: notes only)
//   POST   /gemba/walks/:id/submit        { notes? } → endedAt, status 'submitted', summary
//   POST   /gemba/walks/:id/reopen        → back to 'open' (admin, by role/key like any correction)
//   DELETE /gemba/walks/:id               → removes the walk; findings keep their data, lose walkId (admin)
//
// Findings attach by LocTag.walkId (set by the app at creation). The summary
// is derived on every read — never stored — so it cannot drift.

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
import { buildTableXlsx, type TableRow } from '../oms/xlsx-lite.js';

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
  walks.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  res.json({ data: walks.map(withSummary), timestamp: new Date().toISOString() });
});

// ── Export (before /:id so the literal path wins) ───────────────────────────

const EXPORT_COLS = ['Walk date', 'Auditor', 'Employee ID', 'Project ID', 'Organization', 'BU', 'Area', 'Location', 'Walk status',
  'Stop #', 'Focus Area', 'Question Code', 'Question', 'Source', 'Finding Category', 'Risk', 'Notes', 'Photo caption', 'Photos', 'Logged at', 'Photo'];
const EXPORT_WIDTHS = [12, 18, 12, 16, 14, 14, 12, 14, 11, 7, 24, 13, 40, 9, 14, 6, 30, 30, 7, 20, 36];

router.get('/export.xlsx', (req: Request, res: Response): void => {
  const q = req.query as Record<string, string | undefined>;
  let walks: GembaWalk[];
  if (q.walkId) {
    const w = gembaWalkStore.findById(q.walkId);
    if (!w) { res.status(404).json({ error: 'Walk not found' }); return; }
    walks = [w];
  } else if (q.all === 'true') {
    walks = gembaWalkStore.findAll().sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  } else {
    res.status(400).json({ error: 'Pass ?walkId= or ?all=true' }); return;
  }
  const rows: TableRow[] = [];
  for (const w of walks) {
    const head = [w.startedAt.slice(0, 10), w.auditorName, w.auditorId ?? '', w.projectId ?? '', w.organization ?? '',
                  w.bu ?? '', w.area ?? '', w.location ?? '', w.status];
    const findings = findingsOf(w.id);
    if (!findings.length) { rows.push({ cells: [...head, '', '', '', '(no findings)', ''] }); continue; }
    for (const f of findings) {
      const photos = f.photos ?? (f.referenceImagePath ? [{ path: f.referenceImagePath, caption: undefined as string | undefined, markupPath: undefined as string | undefined }] : []);
      const first = photos[0];
      const file = first ? (first.markupPath ?? first.path) : undefined;
      const abs = file && !file.includes('..') ? path.join(LOCTAG_IMG_DIR, file) : undefined;
      rows.push({
        cells: [...head, f.order + 1,
          f.focusAreaCode ? `${f.focusAreaCode} ${f.focusAreaTitle ?? ''}`.trim() : (f.focusAreaTitle ?? ''),
          f.questionCode ?? '', f.questionText ?? f.title,
          f.referenceSource === 'custom' ? 'custom' : (f.questionCode ? 'library' : 'legacy'),
          f.findingCategory ?? f.defectCategory,
          f.riskRating ?? '', f.description, first?.caption ?? '', photos.length, f.createdAt, ''],
        image: abs && fs.existsSync(abs) ? fs.readFileSync(abs) : undefined,
      });
    }
  }
  const buf = buildTableXlsx('Gemba Walks', EXPORT_COLS, rows, EXPORT_WIDTHS, EXPORT_COLS.length - 1);
  const name = q.walkId ? `gemba-walk-${q.walkId.slice(0, 8)}.xlsx` : `gemba-walks-${new Date().toISOString().slice(0, 10)}.xlsx`;
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
      if (keys.length) throw new GembaValidationError(409, 'Walk is submitted — only notes can change (reopen to edit the header).');
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
    console.log(`[SIB] Gemba walk submitted: ${w.id} — ${out.summary?.findings ?? 0} findings`);
    res.json({ data: out, timestamp: now });
  } catch (err) { fail(res, err); }
});

// POST /gemba/walks/:id/adopt { locTagIds?: string[] } — attach findings on
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
