// loto.ts — iLOTO routes: points, append-only events, derived status,
// training quiz + certifications. See docs/ILOTO.md.
//
// Two properties of this file matter more than any endpoint:
//
//   1. Events are APPEND-ONLY. There is no PATCH or DELETE for events —
//      deliberately, including for admins. Status is derived on read
//      (loto-core.ts), so nothing can "fix" history without leaving a trail.
//
//   2. The server is the referee. validateEvent() enforces the checklist,
//      one-lock-one-person, and the override conditions — a client that
//      skips a step gets a 4xx, not a quiet pass.

import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs   from 'fs';
import path from 'path';
import type {
  LotoPoint,
  LotoEvent,
  LotoCertification,
  LotoQuizQuestion,
  LotoQuizQuestionPublic,
  LotoMap,
  LotoMapStroke,
  SaveLotoMapRequest,
  CreateLotoPointRequest,
  UpdateLotoPointRequest,
  CreateLotoEventRequest,
  SubmitLotoQuizRequest,
  SubmitLotoQuizResult,
  MyLotoEntry,
} from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { anchorStore } from './anchors.js';
import {
  validateEvent,
  derivePointStatus,
  deriveAnchorStatus,
  gradeQuiz,
  validateQuizQuestions,
  LotoValidationError,
} from '../loto/loto-core.js';
import { buildSeedQuestions } from '../loto/quiz-seed.js';

// ── Storage ───────────────────────────────────────────────────────────────────

export const lotoPointStore = new JsonFileStore<LotoPoint>('loto-points');
export const lotoEventStore = new JsonFileStore<LotoEvent>('loto-events');
export const lotoCertStore  = new JsonFileStore<LotoCertification>('loto-certifications');
export const lotoQuizStore  = new JsonFileStore<LotoQuizQuestion>('loto-quiz');
export const lotoMapStore   = new JsonFileStore<LotoMap>('loto-maps');

const DATA_DIR       = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const LOTO_PHOTO_DIR = path.join(DATA_DIR, 'loto-photos');
fs.mkdirSync(LOTO_PHOTO_DIR, { recursive: true });

// Pass threshold + certification validity — env-overridable site policy.
const PASS_RATIO    = Number(process.env.LOTO_PASS_RATIO ?? 0.8);
const VALIDITY_DAYS = Number(process.env.LOTO_CERT_VALIDITY_DAYS ?? 365);

// Seed the question bank ONLY when empty: after first boot the stored
// questions are the truth and EHS edits (they're data) survive redeploys.
if (lotoQuizStore.findAll().length === 0) {
  const now = new Date().toISOString();
  for (const q of buildSeedQuestions(now)) lotoQuizStore.save(q);
  console.log(`[SIB] Seeded LOTO quiz bank (${lotoQuizStore.findAll().length} questions)`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function savePhoto(eventId: string, base64: string): string {
  const filename = `${eventId}.jpg`;
  fs.writeFileSync(path.join(LOTO_PHOTO_DIR, filename), Buffer.from(base64, 'base64'));
  return filename;
}

function fail(res: Response, err: unknown): void {
  if (err instanceof LotoValidationError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[SIB] iLOTO error:', err);
  res.status(500).json({ error: 'Internal error' });
}

/** Newest valid certification for a user, or undefined. */
export function currentCertification(userId: string): LotoCertification | undefined {
  const now = new Date().toISOString();
  return lotoCertStore.findAll()
    .filter(c => c.userId === userId && c.passed && c.expiresAt > now)
    .sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1))[0];
}

const router = Router();

// ── Points ───────────────────────────────────────────────────────────────────

// POST /loto/points — author defines an isolation point (placed in AR on device).
router.post('/points', (req: Request, res: Response): void => {
  const body = req.body as CreateLotoPointRequest;
  if (!body.anchorId || !body.label?.trim() || !body.position ||
      (body.kind !== 'safeoff' && body.kind !== 'loto')) {
    res.status(400).json({ error: 'anchorId, kind (safeoff|loto), label and position are required' });
    return;
  }
  const now = new Date().toISOString();
  const point: LotoPoint = {
    id:        uuidv4(),
    anchorId:  body.anchorId,
    kind:      body.kind,
    label:     body.label.trim(),
    ...(body.circuitId?.trim() && { circuitId: body.circuitId.trim() }),
    position:  body.position,
    ...(body.modelId && { modelId: body.modelId }),
    ...(body.modelScale !== undefined && { modelScale: body.modelScale }),
    createdBy: body.createdBy ?? 'Anonymous',
    createdAt: now,
    updatedAt: now,
  };
  lotoPointStore.save(point);
  res.status(201).json(point);
});

// GET /loto/points?anchorId=
router.get('/points', (req: Request, res: Response): void => {
  const anchorId = req.query.anchorId as string | undefined;
  const all = lotoPointStore.findAll();
  res.json(anchorId ? all.filter(p => p.anchorId === anchorId) : all);
});

// PATCH /loto/points/:id — label/circuit/model/position/placement.
// Model doctrine (same as GuideStep): ASSIGNMENT (modelId/scale) may change
// freely; switching to a DIFFERENT model clears the old model's PLACEMENT
// (offsets/rotation) — placement belongs to a shape, not a point.
router.patch('/points/:id', (req: Request, res: Response): void => {
  const point = lotoPointStore.findById(req.params.id);
  if (!point) { res.status(404).json({ error: 'Point not found' }); return; }
  const body = req.body as UpdateLotoPointRequest;

  const modelChanged = 'modelId' in body && (body.modelId || undefined) !== point.modelId;

  const updated = lotoPointStore.update(point.id, {
    ...(body.label?.trim() && { label: body.label.trim() }),
    ...('circuitId' in body && { circuitId: body.circuitId?.trim() || undefined }),
    ...(body.position && { position: body.position }),
    ...('modelId' in body && { modelId: body.modelId || undefined }),
    ...(body.modelScale !== undefined && { modelScale: body.modelScale }),
    // Placement: explicit values win; a model CHANGE resets stale placement.
    ...(modelChanged
      ? { modelOffsetX: undefined, modelOffsetY: undefined,
          modelOffsetZ: undefined, modelRotationY: undefined }
      : {
          ...(body.modelOffsetX   !== undefined && { modelOffsetX:   body.modelOffsetX }),
          ...(body.modelOffsetY   !== undefined && { modelOffsetY:   body.modelOffsetY }),
          ...(body.modelOffsetZ   !== undefined && { modelOffsetZ:   body.modelOffsetZ }),
          ...(body.modelRotationY !== undefined && { modelRotationY: body.modelRotationY }),
        }),
    updatedAt: new Date().toISOString(),
  } as Partial<LotoPoint>);
  res.json(updated);
});

// DELETE /loto/points/:id — blocked while a lock is active on it. The event
// history for the point is KEPT: deleting an audit trail is not a thing.
router.delete('/points/:id', (req: Request, res: Response): void => {
  const point = lotoPointStore.findById(req.params.id);
  if (!point) { res.status(404).json({ error: 'Point not found' }); return; }
  const status = derivePointStatus(point, lotoEventStore.findAll());
  if (status.state === 'locked') {
    res.status(409).json({
      error: `Point is locked by ${status.lockedByName} — remove the lock before deleting the point.`,
    });
    return;
  }
  lotoPointStore.delete(point.id);
  res.json({ deleted: true });
});

// ── Events (append-only) ─────────────────────────────────────────────────────

// POST /loto/events — apply / remove / override-remove. The referee.
router.post('/events', (req: Request, res: Response): void => {
  try {
    const body    = req.body as CreateLotoEventRequest;
    const point   = lotoPointStore.findById(body.pointId);
    const current = point ? derivePointStatus(point, lotoEventStore.findAll()) : undefined;
    validateEvent(point, current, body);

    const id  = uuidv4();
    const now = new Date().toISOString();

    let photoPath: string | undefined;
    if (body.photoBase64) {
      try { photoPath = savePhoto(id, body.photoBase64); }
      catch (err) {
        console.error('[SIB] Failed to save LOTO evidence photo:', err);
        res.status(500).json({ error: 'Failed to save evidence photo' });
        return;
      }
    }

    const event: LotoEvent = {
      id,
      anchorId:  point!.anchorId,
      pointId:   point!.id,
      type:      body.type,
      userId:    body.userId.trim(),
      userName:  body.userName.trim(),
      ...(body.lockSerial?.trim() && { lockSerial: body.lockSerial.trim() }),
      checklist: body.checklist ?? {},
      ...(photoPath && { photoPath }),
      ...(body.override && { override: body.override }),
      ...(body.note?.trim() && { note: body.note.trim() }),
      createdAt: now,
    };
    lotoEventStore.save(event);
    if (body.type === 'override-remove') {
      console.log(`[SIB] iLOTO OVERRIDE: ${body.override?.supervisorName} removed ` +
        `${point!.label} lock (applied by ${current?.lockedByName}) — ${body.override?.reason}`);
    }
    res.status(201).json({
      event,
      status: derivePointStatus(point!, lotoEventStore.findAll()),
    });
  } catch (err) { fail(res, err); }
});

// GET /loto/events?anchorId=&pointId= — audit trail, newest first.
router.get('/events', (req: Request, res: Response): void => {
  const anchorId = req.query.anchorId as string | undefined;
  const pointId  = req.query.pointId  as string | undefined;
  let events = lotoEventStore.findAll();
  if (anchorId) events = events.filter(e => e.anchorId === anchorId);
  if (pointId)  events = events.filter(e => e.pointId === pointId);
  events.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  res.json(events);
});

// GET /loto/events/photo/:filename — evidence photo.
router.get('/events/photo/:filename', (req: Request, res: Response): void => {
  // Photos are named <eventId>.jpg by us; reject anything path-like.
  if (!/^[a-zA-Z0-9-]+\.jpg$/.test(req.params.filename)) {
    res.status(400).json({ error: 'Bad filename' });
    return;
  }
  const full = path.join(LOTO_PHOTO_DIR, req.params.filename);
  if (!fs.existsSync(full)) { res.status(404).json({ error: 'Photo not found' }); return; }
  res.type('jpeg').send(fs.readFileSync(full));
});

// ── Derived status ───────────────────────────────────────────────────────────

// GET /loto/status?anchorId= — per-point states + panel summary (hub banner).
router.get('/status', (req: Request, res: Response): void => {
  const anchorId = req.query.anchorId as string | undefined;
  if (!anchorId) { res.status(400).json({ error: 'anchorId is required' }); return; }
  res.json(deriveAnchorStatus(anchorId, lotoPointStore.findAll(), lotoEventStore.findAll()));
});

// GET /loto/my?userId= — my active locks across ALL anchors (My LOTO).
router.get('/my', (req: Request, res: Response): void => {
  const userId = req.query.userId as string | undefined;
  if (!userId) { res.status(400).json({ error: 'userId is required' }); return; }
  const events = lotoEventStore.findAll();
  const entries: MyLotoEntry[] = [];
  for (const point of lotoPointStore.findAll()) {
    const status = derivePointStatus(point, events);
    if (status.state === 'locked' && status.lockedBy === userId) {
      const anchor = anchorStore.findById(point.anchorId);
      entries.push({
        anchorId:   point.anchorId,
        anchorName: anchor?.assetId ?? point.anchorId,
        status,
      });
    }
  }
  entries.sort((a, b) => ((a.status.lockedAt ?? '') < (b.status.lockedAt ?? '') ? 1 : -1));
  res.json(entries);
});

// ── AR LOTO map ──────────────────────────────────────────────────────────────
// Versioned: every save creates version+1; prior versions are kept (cheap,
// and "what did the map say then" is a question EHS asks). GET returns the
// highest version. DELETE removes the map entirely (authoring content, not
// audit — events are the untouchable record, the map is a drawing).

function latestMap(anchorId: string): LotoMap | undefined {
  return lotoMapStore.findAll()
    .filter(m => m.anchorId === anchorId)
    .sort((a, b) => b.version - a.version)[0];
}

const isFiniteVec = (v: unknown): boolean => {
  const p = v as { x?: unknown; y?: unknown; z?: unknown };
  return typeof p?.x === 'number' && isFinite(p.x)
      && typeof p?.y === 'number' && isFinite(p.y)
      && typeof p?.z === 'number' && isFinite(p.z);
};

// POST /loto/map — save a new version of the panel's flow map.
router.post('/map', (req: Request, res: Response): void => {
  const body = req.body as SaveLotoMapRequest;
  if (!body.anchorId || !Array.isArray(body.strokes)) {
    res.status(400).json({ error: 'anchorId and strokes are required' });
    return;
  }
  const strokes: LotoMapStroke[] = [];
  for (const s of body.strokes) {
    if (!Array.isArray(s.points) || s.points.length < 2 || !s.points.every(isFiniteVec)) {
      res.status(400).json({ error: 'Every stroke needs at least 2 finite vertices' });
      return;
    }
    if (s.fedByPointId && !lotoPointStore.findById(s.fedByPointId)) {
      res.status(400).json({ error: `fedByPointId ${s.fedByPointId} is not a known point` });
      return;
    }
    strokes.push({
      id:     s.id ?? uuidv4(),
      points: s.points,
      ...(s.circuitId?.trim() && { circuitId: s.circuitId.trim() }),
      ...(s.fedByPointId && { fedByPointId: s.fedByPointId }),
    });
  }
  const map: LotoMap = {
    id:        uuidv4(),
    anchorId:  body.anchorId,
    version:   (latestMap(body.anchorId)?.version ?? 0) + 1,
    strokes,
    createdBy: body.createdBy ?? 'Anonymous',
    createdAt: new Date().toISOString(),
  };
  lotoMapStore.save(map);
  res.status(201).json(map);
});

// GET /loto/map?anchorId= — latest version (404 when none).
router.get('/map', (req: Request, res: Response): void => {
  const anchorId = req.query.anchorId as string | undefined;
  if (!anchorId) { res.status(400).json({ error: 'anchorId is required' }); return; }
  const map = latestMap(anchorId);
  if (!map) { res.status(404).json({ error: 'No flow map for this panel yet' }); return; }
  res.json(map);
});

// DELETE /loto/map?anchorId= — remove the map (all versions).
router.delete('/map', (req: Request, res: Response): void => {
  const anchorId = req.query.anchorId as string | undefined;
  if (!anchorId) { res.status(400).json({ error: 'anchorId is required' }); return; }
  const removed = lotoMapStore.pruneWhere(m => m.anchorId === anchorId);
  res.json({ deleted: removed });
});

// ── Training ─────────────────────────────────────────────────────────────────

// GET /loto/quiz — questions WITHOUT answers (grading is server-side only).
router.get('/quiz', (_req: Request, res: Response): void => {
  const publicQuestions: LotoQuizQuestionPublic[] = lotoQuizStore.findAll()
    .map(({ id, prompt, choices }) => ({ id, prompt, choices }));
  res.json({ questions: publicQuestions, passRatio: PASS_RATIO });
});

// POST /loto/quiz/submit — grade + issue a certification record (pass or fail
// — failed attempts are records too; the gate checks `passed` + expiry).
router.post('/quiz/submit', (req: Request, res: Response): void => {
  const body = req.body as SubmitLotoQuizRequest;
  if (!body.userId?.trim() || !body.userName?.trim() || typeof body.answers !== 'object') {
    res.status(400).json({ error: 'userId, userName and answers are required' });
    return;
  }
  const questions = lotoQuizStore.findAll();
  if (questions.length === 0) { res.status(503).json({ error: 'Question bank is empty' }); return; }

  const graded = gradeQuiz(questions, body.answers, PASS_RATIO);
  const issuedAt  = new Date();
  const expiresAt = new Date(issuedAt.getTime() + VALIDITY_DAYS * 24 * 60 * 60 * 1000);
  const certification: LotoCertification = {
    id:        uuidv4(),
    userId:    body.userId.trim(),
    userName:  body.userName.trim(),
    score:     graded.score,
    total:     graded.total,
    passed:    graded.passed,
    issuedAt:  issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
  lotoCertStore.save(certification);
  const result: SubmitLotoQuizResult = { certification, results: graded.results };
  res.status(201).json(result);
});

// ── Quiz administration (portal EHS editor) ──────────────────────────────────
// The public GET /loto/quiz strips answers; these admin routes carry them.
// Editing never touches issued certifications — a cert records what was
// passed WHEN it was passed; future takers face the current bank.

// GET /loto/quiz/admin — full questions incl. correctIndex + explanation.
router.get('/quiz/admin', (_req: Request, res: Response): void => {
  const questions = lotoQuizStore.findAll()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  res.json({ questions, passRatio: PASS_RATIO });
});

// POST /loto/quiz/questions — add one question.
router.post('/quiz/questions', (req: Request, res: Response): void => {
  try {
    const [input] = validateQuizQuestions([req.body]);
    const now = new Date().toISOString();
    const question: LotoQuizQuestion = { id: uuidv4(), ...input, createdAt: now, updatedAt: now };
    lotoQuizStore.save(question);
    res.status(201).json(question);
  } catch (err) { fail(res, err); }
});

// PATCH /loto/quiz/questions/:id — full-field update (the editor sends the
// whole question; partial patches of a 4-way choice list invite index bugs).
router.patch('/quiz/questions/:id', (req: Request, res: Response): void => {
  try {
    const existing = lotoQuizStore.findById(req.params.id);
    if (!existing) { res.status(404).json({ error: 'Question not found' }); return; }
    const [input] = validateQuizQuestions([req.body]);
    const updated = lotoQuizStore.update(existing.id, {
      ...input, updatedAt: new Date().toISOString(),
    });
    res.json(updated);
  } catch (err) { fail(res, err); }
});

// DELETE /loto/quiz/questions/:id — the portal warns when the bank runs low;
// an empty bank simply blocks new certifications (submit returns 503).
router.delete('/quiz/questions/:id', (req: Request, res: Response): void => {
  if (!lotoQuizStore.findById(req.params.id)) {
    res.status(404).json({ error: 'Question not found' });
    return;
  }
  lotoQuizStore.delete(req.params.id);
  res.json({ deleted: true, remaining: lotoQuizStore.findAll().length });
});

// POST /loto/quiz/import — bulk load. ATOMIC: everything validates first,
// then applies; a half-imported bank can never exist.
// Body: { mode: 'append' | 'replace', questions: [...] }
router.post('/quiz/import', (req: Request, res: Response): void => {
  try {
    const body = req.body as { mode?: string; questions?: unknown };
    const mode = body.mode === 'replace' ? 'replace' : 'append';
    const inputs = validateQuizQuestions(body.questions);

    if (mode === 'replace') {
      lotoQuizStore.pruneWhere(() => true);
    }
    const now = new Date().toISOString();
    const created: LotoQuizQuestion[] = inputs.map(input => {
      const q: LotoQuizQuestion = { id: uuidv4(), ...input, createdAt: now, updatedAt: now };
      lotoQuizStore.save(q);
      return q;
    });
    console.log(`[SIB] LOTO quiz import (${mode}): +${created.length} questions, bank now ${lotoQuizStore.findAll().length}`);
    res.status(201).json({ mode, imported: created.length, total: lotoQuizStore.findAll().length });
  } catch (err) { fail(res, err); }
});

// GET /loto/certifications?userId= — newest first; head is the current one.
router.get('/certifications', (req: Request, res: Response): void => {
  const userId = req.query.userId as string | undefined;
  let certs = lotoCertStore.findAll();
  if (userId) certs = certs.filter(c => c.userId === userId);
  certs.sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1));
  res.json(certs);
});

export default router;
