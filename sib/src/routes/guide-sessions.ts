// guide-sessions.ts — AR OMS Phase 1: Guide session sign-off routes
//
// A GuideSession is created atomically when the Operator taps "Sign & Submit" —
// there is no "open / close" lifecycle like inspection sessions. The entire
// session record (step completions, duration, sign-off name) is submitted in
// a single POST once the Operator finishes the guide.
//
// Endpoints:
//   POST /guide-sessions                          — Operator: submit completed session
//   GET  /guide-sessions?anchorId=xxx             — list sessions for an anchor
//   GET  /guide-sessions?guideId=xxx              — list sessions for a specific guide
//   GET  /guide-sessions/:id                      — get a single session

import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  GuideSession,
  CreateGuideSessionRequest,
  ApiResponse,
} from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';

// ── Storage ───────────────────────────────────────────────────────────────────

export const guideSessionStore = new JsonFileStore<GuideSession>('guide-sessions');

// ── Bounded retention (mirrors sessions.ts pattern) ──────────────────────────
// Guide sessions are append-only; prune records older than the retention window
// to prevent unbounded growth of guide-sessions.json.

const SESSION_RETENTION_DAYS = parseFloat(process.env.SESSION_RETENTION_DAYS ?? '90');
const PRUNE_INTERVAL_MS      = 24 * 60 * 60 * 1000; // daily

export function pruneOldGuideSessions(): number {
  const cutoffMs = SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const now      = Date.now();

  const removed = guideSessionStore.pruneWhere((session) => {
    const ageMs = now - new Date(session.createdAt).getTime();
    return !Number.isNaN(ageMs) && ageMs > cutoffMs;
  });

  if (removed > 0) {
    console.log(`[SIB] Pruned ${removed} old guide session(s) (retention=${SESSION_RETENTION_DAYS}d)`);
  }
  return removed;
}

pruneOldGuideSessions();
setInterval(pruneOldGuideSessions, PRUNE_INTERVAL_MS).unref();

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// POST /guide-sessions — Operator submits a completed guide session
router.post('/', (req: Request, res: Response): void => {
  const body = req.body as CreateGuideSessionRequest;

  if (
    !body.guideId       ||
    !body.anchorId      ||
    !body.guideName     ||
    !body.anchorName    ||
    !body.signedOffBy   ||
    !body.startedAt     ||
    !body.completedAt   ||
    typeof body.durationSeconds !== 'number' ||
    !Array.isArray(body.stepCompletions)
  ) {
    res.status(400).json({
      error: 'Missing required fields: guideId, anchorId, guideName, anchorName, signedOffBy, startedAt, completedAt, durationSeconds, stepCompletions',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const now = new Date().toISOString();
  const session: GuideSession = {
    id:              uuidv4(),
    guideId:         body.guideId,
    anchorId:        body.anchorId,
    guideName:       body.guideName,
    anchorName:      body.anchorName,
    signedOffBy:     body.signedOffBy,
    startedAt:       body.startedAt,
    completedAt:     body.completedAt,
    durationSeconds: body.durationSeconds,
    stepCompletions: body.stepCompletions,
    createdAt:       now,
    updatedAt:       now,
  };

  guideSessionStore.save(session);
  console.log(
    `[SIB] GuideSession created: ${session.id} — guide "${body.guideName}" ` +
    `signed by ${body.signedOffBy} (${body.stepCompletions.length} steps, ${Math.round(body.durationSeconds)}s)`
  );

  const resp: ApiResponse<GuideSession> = { data: session, timestamp: now };
  res.status(201).json(resp);
});

// GET /guide-sessions?anchorId=xxx  — list sessions for an anchor (newest first)
// GET /guide-sessions?guideId=xxx   — list sessions for a specific guide (newest first)
// Both query params may be combined for narrower filtering.
router.get('/', (req: Request, res: Response): void => {
  const { anchorId, guideId } = req.query;

  if (!anchorId && !guideId) {
    res.status(400).json({
      error: 'At least one of anchorId or guideId is required',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  let sessions = guideSessionStore.findAll();

  if (typeof anchorId === 'string') {
    sessions = sessions.filter(s => s.anchorId === anchorId);
  }
  if (typeof guideId === 'string') {
    sessions = sessions.filter(s => s.guideId === guideId);
  }

  // Newest first
  sessions.sort((a, b) => b.completedAt.localeCompare(a.completedAt));

  const resp: ApiResponse<GuideSession[]> = {
    data:      sessions,
    timestamp: new Date().toISOString(),
  };
  res.json(resp);
});

// GET /guide-sessions/:id — get a single session
router.get('/:id', (req: Request, res: Response): void => {
  const session = guideSessionStore.findById(req.params.id);
  if (!session) {
    res.status(404).json({
      error: `GuideSession ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.json({ data: session, timestamp: new Date().toISOString() });
});

export default router;
