// routes/gemba-library.ts — Audit Reference Library (G1, 2026.4.46).
//
//   GET    /gemba/library                       → { data: GembaLibrary }         (any API-key holder; iOS + portal)
//   GET    /gemba/library/export.json           → GembaLibraryImport (re-importable, download)
//   POST   /gemba/library/import                → atomic bulk load { mode, focusAreas } or { mode, rows }   (admin)
//   POST   /gemba/library/focus-areas           → add                                                       (admin)
//   PATCH  /gemba/library/focus-areas/:id       → title/code/order/active                                   (admin)
//   DELETE /gemba/library/focus-areas/:id       → removes its questions too                                 (admin)
//   POST   /gemba/library/questions             → add { focusAreaId, code, title, text }                    (admin)
//   PATCH  /gemba/library/questions/:id                                                                     (admin)
//   DELETE /gemba/library/questions/:id                                                                     (admin)
//
// Admin = middleware/auth.ts isAdminRequest (any write under /gemba/library).
// Findings keep the question CODE + title they were logged against, so
// editing the library later never rewrites history (same doctrine as the
// LOTO quiz bank vs issued certifications).

import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { GembaFocusArea, GembaQuestion, GembaLibrary } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import {
  GembaValidationError, GEMBA_FINDING_CATEGORIES, GEMBA_RISK_RATINGS,
  validateFocusArea, validateQuestion, planImport, rowsToImport, buildSeedLibrary, normCode,
  type FlatRow,
} from '../gemba/library-core.js';

export const gembaFocusAreaStore = new JsonFileStore<GembaFocusArea>('gemba-focus-areas');
export const gembaQuestionStore  = new JsonFileStore<GembaQuestion>('gemba-questions');

// Seed once, on an empty server — never over what Corporate Quality imported.
if (gembaFocusAreaStore.count() === 0) {
  applyImport(planImport(buildSeedLibrary(), [], []));
  console.log(`[SIB] Gemba library seeded: ${gembaFocusAreaStore.count()} focus areas, ${gembaQuestionStore.count()} questions`);
}

const router = Router();

function fail(res: Response, err: unknown): void {
  if (err instanceof GembaValidationError) { res.status(err.status).json({ error: err.message }); return; }
  console.error('[SIB] Gemba library error:', err);
  res.status(500).json({ error: 'Internal error' });
}

/** Version = newest updatedAt across both stores — cheap, and changes on every write. */
function libraryVersion(): string {
  let v = '';
  for (const r of [...gembaFocusAreaStore.findAll(), ...gembaQuestionStore.findAll()]) if (r.updatedAt > v) v = r.updatedAt;
  return v || '0';
}

export function buildLibrary(includeInactive = false): GembaLibrary {
  const byOrder = <T extends { order: number; code: string }>(a: T, b: T) => a.order - b.order || a.code.localeCompare(b.code, undefined, { numeric: true });
  const qs = gembaQuestionStore.findAll().filter(q => includeInactive || q.active);
  const focusAreas = gembaFocusAreaStore.findAll()
    .filter(a => includeInactive || a.active)
    .sort(byOrder)
    .map(a => ({ ...a, questions: qs.filter(q => q.focusAreaId === a.id).sort(byOrder) }));
  return {
    focusAreas,
    categories: [...GEMBA_FINDING_CATEGORIES],
    ratings:    [...GEMBA_RISK_RATINGS],
    version:    libraryVersion(),
  };
}

function applyImport(plan: ReturnType<typeof planImport>): void {
  const now = new Date().toISOString();
  if (plan.mode === 'replace') {
    gembaQuestionStore.pruneWhere(() => true);
    gembaFocusAreaStore.pruneWhere(() => true);
  }
  for (const fa of plan.focusAreas) {
    let area: GembaFocusArea;
    if (fa.existing) {
      area = gembaFocusAreaStore.update(fa.existing.id, {
        title: fa.input.title, order: fa.input.order ?? fa.existing.order,
        active: fa.input.active ?? fa.existing.active, updatedAt: now,
      })!;
    } else {
      area = { id: uuidv4(), code: fa.input.code, title: fa.input.title, order: fa.input.order ?? 0,
               active: fa.input.active ?? true, createdAt: now, updatedAt: now };
      gembaFocusAreaStore.save(area);
    }
    for (const q of fa.questions) {
      if (q.existing) {
        gembaQuestionStore.update(q.existing.id, {
          focusAreaId: area.id, title: q.input.title, text: q.input.text,
          order: q.input.order ?? q.existing.order, active: q.input.active ?? q.existing.active, updatedAt: now,
        });
      } else {
        gembaQuestionStore.save({ id: uuidv4(), focusAreaId: area.id, code: q.input.code, title: q.input.title,
          text: q.input.text, order: q.input.order ?? 0, active: q.input.active ?? true, createdAt: now, updatedAt: now });
      }
    }
  }
}

// ── Read ────────────────────────────────────────────────────────────────────

router.get('/', (req: Request, res: Response): void => {
  const all = req.query.all === 'true' || req.query.all === '1';
  res.json({ data: buildLibrary(all), timestamp: new Date().toISOString() });
});

router.get('/export.json', (_req: Request, res: Response): void => {
  const lib = buildLibrary(true);
  const payload = {
    mode: 'replace',
    focusAreas: lib.focusAreas.map(a => ({
      code: a.code, title: a.title, order: a.order, active: a.active,
      questions: a.questions.map(q => ({ code: q.code, title: q.title, text: q.text, order: q.order, active: q.active })),
    })),
  };
  res.setHeader('Content-Disposition', `attachment; filename="gemba-library-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(payload);
});

// ── Import (atomic) ─────────────────────────────────────────────────────────

router.post('/import', (req: Request, res: Response): void => {
  try {
    const body = req.body as { mode?: string; rows?: FlatRow[]; focusAreas?: unknown };
    const mode = body.mode === 'replace' ? 'replace' : 'append';
    const payload = Array.isArray(body.rows) ? rowsToImport(body.rows, mode) : { ...body, mode };
    const plan = planImport(payload, gembaFocusAreaStore.findAll(), gembaQuestionStore.findAll());
    applyImport(plan);
    console.log(`[SIB] Gemba library import (${plan.mode}): areas +${plan.counts.areasNew}/~${plan.counts.areasUpdated}, questions +${plan.counts.questionsNew}/~${plan.counts.questionsUpdated}`);
    res.status(201).json({ mode: plan.mode, ...plan.counts,
      totalFocusAreas: gembaFocusAreaStore.count(), totalQuestions: gembaQuestionStore.count() });
  } catch (err) { fail(res, err); }
});

// ── Focus areas ─────────────────────────────────────────────────────────────

router.post('/focus-areas', (req: Request, res: Response): void => {
  try {
    const input = validateFocusArea(req.body);
    if (gembaFocusAreaStore.findAll().some(a => a.code === input.code)) {
      throw new GembaValidationError(409, `Focus area code "${input.code}" already exists.`);
    }
    const now = new Date().toISOString();
    const maxOrder = Math.max(0, ...gembaFocusAreaStore.findAll().map(a => a.order));
    const area: GembaFocusArea = { id: uuidv4(), code: input.code, title: input.title,
      order: input.order ?? maxOrder + 1, active: input.active ?? true, createdAt: now, updatedAt: now };
    gembaFocusAreaStore.save(area);
    res.status(201).json(area);
  } catch (err) { fail(res, err); }
});

router.patch('/focus-areas/:id', (req: Request, res: Response): void => {
  try {
    const existing = gembaFocusAreaStore.findById(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Focus area not found' }); return; }
    const input = validateFocusArea({ ...existing, ...req.body });
    if (input.code !== existing.code && gembaFocusAreaStore.findAll().some(a => a.code === input.code)) {
      throw new GembaValidationError(409, `Focus area code "${input.code}" already exists.`);
    }
    res.json(gembaFocusAreaStore.update(existing.id, { ...input, updatedAt: new Date().toISOString() }));
  } catch (err) { fail(res, err); }
});

router.delete('/focus-areas/:id', (req: Request, res: Response): void => {
  const existing = gembaFocusAreaStore.findById(req.params.id);
  if (!existing) { res.status(404).json({ error: 'Focus area not found' }); return; }
  const removedQs = gembaQuestionStore.pruneWhere(q => q.focusAreaId === existing.id);
  gembaFocusAreaStore.delete(existing.id);
  res.json({ deleted: true, questionsRemoved: removedQs });
});

// ── Questions ───────────────────────────────────────────────────────────────

router.post('/questions', (req: Request, res: Response): void => {
  try {
    const focusAreaId = typeof req.body?.focusAreaId === 'string' ? req.body.focusAreaId : '';
    const area = gembaFocusAreaStore.findById(focusAreaId);
    if (!area) throw new GembaValidationError(400, 'focusAreaId must reference an existing focus area.');
    const input = validateQuestion(req.body);
    if (gembaQuestionStore.findAll().some(q => q.code === input.code)) {
      throw new GembaValidationError(409, `Question code "${input.code}" already exists.`);
    }
    const now = new Date().toISOString();
    const maxOrder = Math.max(0, ...gembaQuestionStore.findAll().filter(q => q.focusAreaId === area.id).map(q => q.order));
    const q: GembaQuestion = { id: uuidv4(), focusAreaId: area.id, code: input.code, title: input.title, text: input.text,
      order: input.order ?? maxOrder + 1, active: input.active ?? true, createdAt: now, updatedAt: now };
    gembaQuestionStore.save(q);
    res.status(201).json(q);
  } catch (err) { fail(res, err); }
});

router.patch('/questions/:id', (req: Request, res: Response): void => {
  try {
    const existing = gembaQuestionStore.findById(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Question not found' }); return; }
    const input = validateQuestion({ ...existing, ...req.body });
    if (input.code !== existing.code && gembaQuestionStore.findAll().some(q => q.code === input.code)) {
      throw new GembaValidationError(409, `Question code "${input.code}" already exists.`);
    }
    let focusAreaId = existing.focusAreaId;
    if (typeof req.body?.focusAreaId === 'string' && req.body.focusAreaId !== existing.focusAreaId) {
      if (!gembaFocusAreaStore.findById(req.body.focusAreaId)) throw new GembaValidationError(400, 'focusAreaId must reference an existing focus area.');
      focusAreaId = req.body.focusAreaId;
    }
    res.json(gembaQuestionStore.update(existing.id, { ...input, focusAreaId, updatedAt: new Date().toISOString() }));
  } catch (err) { fail(res, err); }
});

router.delete('/questions/:id', (req: Request, res: Response): void => {
  if (!gembaQuestionStore.findById(req.params.id)) { res.status(404).json({ error: 'Question not found' }); return; }
  gembaQuestionStore.delete(req.params.id);
  res.json({ deleted: true });
});

/** Lookup used by loc-tag validation (G3): question by code, with its area. */
export function findQuestionByCode(code: unknown): { question: GembaQuestion; area: GembaFocusArea } | undefined {
  const c = normCode(code);
  if (!c) return undefined;
  const question = gembaQuestionStore.findAll().find(q => q.code === c);
  if (!question) return undefined;
  const area = gembaFocusAreaStore.findById(question.focusAreaId);
  return area ? { question, area } : undefined;
}

export default router;
