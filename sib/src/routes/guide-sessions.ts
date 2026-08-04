// guide-sessions.ts — AR OMS Phase 3: Guide session sign-off routes + evidence
//
// A GuideSession is created atomically when the Operator taps "Sign & Submit" —
// there is no "open / close" lifecycle like inspection sessions. The entire
// session record (step completions, duration, sign-off name) is submitted in
// a single POST once the Operator finishes the guide.
//
// Endpoints (sign-off + history):
//   POST /guide-sessions                          — Operator: submit completed session
//   GET  /guide-sessions?all=true                 — list all sessions (portal)
//   GET  /guide-sessions?anchorId=xxx             — list sessions for an anchor
//   GET  /guide-sessions?guideId=xxx              — list sessions for a specific guide
//   GET  /guide-sessions/:id                      — get a single session
//   GET  /guide-sessions/:id/evidence/:stepId     — serve evidence photo for a step
//   DELETE /guide-sessions/:id                    — remove a session + evidence
//   DELETE /guide-sessions                        — remove ALL sessions + evidence
//
// Endpoints (live session-state stream — AI readiness Phase 2, Step 1):
//   POST /guide-sessions/live                     — open a live session (returns liveSessionId)
//   POST /guide-sessions/live/:id/events          — push a step event (iOS, fire-and-forget)
//   GET  /guide-sessions/live/:id/stream          — SSE stream for observers (AI agents)
//   GET  /guide-sessions/live/:id                 — current session snapshot (catch-up)
//   GET  /guide-sessions/live/:id/hints           — AI hint poll; consume-once (Step 3)

import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import type {
  GuideSession,
  GuideStepCompletion,
  CreateGuideSessionRequest,
  OpenLiveSessionRequest,
  PushGuideSessionEventRequest,
  ApiResponse,
} from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import {
  openLiveSession,
  pushEvent,
  closeLiveSession,
  getLiveSession,
  subscribeSse,
  drainHints,
} from '../sse/guide-session.sse.js';

// ── Storage ───────────────────────────────────────────────────────────────────

export const guideSessionStore = new JsonFileStore<GuideSession>('guide-sessions');

// Evidence photos are stored under DATA_DIR/guide-session-evidence/{sessionId}/{stepId}.jpg
const DATA_DIR       = process.env.DATA_DIR ?? './data';
const EVIDENCE_DIR   = path.join(DATA_DIR, 'guide-session-evidence');

function ensureEvidenceDir(sessionId: string): string {
  const dir = path.join(EVIDENCE_DIR, sessionId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

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

// ── Live session-state stream ─────────────────────────────────────────────────
// These routes MUST be registered before the /:id wildcard routes below or
// Express would try to match "live" as a session id.

// POST /guide-sessions/live — open a live tracking session
router.post('/live', (req: Request, res: Response): void => {
  const body = req.body as OpenLiveSessionRequest;

  if (!body.guideId || !body.anchorId || !body.guideName || !body.anchorName || !body.operatorName) {
    res.status(400).json({
      error: 'Missing required fields: guideId, anchorId, guideName, anchorName, operatorName',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const session = openLiveSession(body);
  res.status(201).json({ data: session, timestamp: new Date().toISOString() });
});

// POST /guide-sessions/live/:id/events — iOS pushes a step event (fire-and-forget)
router.post('/live/:id/events', (req: Request, res: Response): void => {
  const body = req.body as PushGuideSessionEventRequest;

  if (!body.type) {
    res.status(400).json({ error: 'Missing required field: type', timestamp: new Date().toISOString() });
    return;
  }

  const event = pushEvent(req.params.id, body);
  if (!event) {
    res.status(404).json({
      error: `Live session ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.status(201).json({ data: event, timestamp: new Date().toISOString() });
});

// GET /guide-sessions/live/:id/stream — SSE stream for AI agents / dashboards
// Auth: when SIB_API_KEY is set, clients must provide it as ?key= (browsers
// can't set headers on EventSource connections).
router.get('/live/:id/stream', (req: Request, res: Response): void => {
  const ok = subscribeSse(req.params.id, res);
  if (!ok) {
    res.status(404).json({
      error: `Live session ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }
  // subscribeSse takes ownership of `res` — do not call res.end() here.
});

// GET /guide-sessions/live/:id — current session snapshot (catch-up for new observers)
router.get('/live/:id', (req: Request, res: Response): void => {
  const session = getLiveSession(req.params.id);
  if (!session) {
    res.status(404).json({
      error: `Live session ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.json({ data: session, timestamp: new Date().toISOString() });
});

// GET /guide-sessions/live/:id/hints — AI hint poll (iOS, consume-once)
//
// iOS calls this every ~5 s during an active guide session.
// Returns all queued AI hints and clears the queue so hints are not re-shown.
// Returns an empty array when no hints are pending — always 200.
router.get('/live/:id/hints', (req: Request, res: Response): void => {
  const hints = drainHints(req.params.id);
  res.json({ data: hints, timestamp: new Date().toISOString() });
});

// ── Sign-off (durable record) ─────────────────────────────────────────────────

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

  const now       = new Date().toISOString();
  const sessionId = uuidv4();

  // ── Save evidence photos and replace base64 with path ────────────────────
  const processedCompletions: GuideStepCompletion[] = body.stepCompletions.map((completion) => {
    const { evidencePhotoBase64, ...rest } = completion as GuideStepCompletion & { evidencePhotoBase64?: string };

    if (evidencePhotoBase64) {
      try {
        const dir      = ensureEvidenceDir(sessionId);
        const filename = `${completion.stepId}.jpg`;
        const filepath = path.join(dir, filename);
        const buffer   = Buffer.from(evidencePhotoBase64, 'base64');
        fs.writeFileSync(filepath, buffer);
        const relativePath = `guide-session-evidence/${sessionId}/${filename}`;
        console.log(`[SIB] Evidence saved: ${relativePath}`);
        return { ...rest, evidencePhotoPath: relativePath };
      } catch (err) {
        console.error(`[SIB] Failed to save evidence for step ${completion.stepId}:`, err);
        return rest;
      }
    }
    return rest;
  });

  const session: GuideSession = {
    id:              sessionId,
    guideId:         body.guideId,
    anchorId:        body.anchorId,
    guideName:       body.guideName,
    anchorName:      body.anchorName,
    signedOffBy:     body.signedOffBy,
    startedAt:       body.startedAt,
    completedAt:     body.completedAt,
    durationSeconds: body.durationSeconds,
    stepCompletions: processedCompletions,
    createdAt:       now,
    updatedAt:       now,
  };

  guideSessionStore.save(session);
  console.log(
    `[SIB] GuideSession created: ${session.id} — guide "${body.guideName}" ` +
    `signed by ${body.signedOffBy} (${body.stepCompletions.length} steps, ${Math.round(body.durationSeconds)}s)`
  );

  // Link the durable record back to the live session (if one was opened).
  // This closes the SSE stream and pushes a session:submitted event to observers.
  if (body.liveSessionId) {
    closeLiveSession(body.liveSessionId, session.id);
  }

  const resp: ApiResponse<GuideSession> = { data: session, timestamp: now };
  res.status(201).json(resp);
});

// GET /guide-sessions — list sessions (all, by anchor, or by guide)
//   ?all=true       → return all sessions (portal overview)
//   ?anchorId=xxx   → filter by anchor
//   ?guideId=xxx    → filter by guide
//   Multiple params may be combined.
router.get('/', (req: Request, res: Response): void => {
  const { anchorId, guideId, all } = req.query;

  // Require at least one filter unless explicitly requesting all
  if (!anchorId && !guideId && all !== 'true') {
    res.status(400).json({
      error: 'Provide anchorId, guideId, or all=true',
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
  // Prevent ":id" matching "evidence" sub-path — handled by full route
  if (req.params.id === 'evidence') {
    res.status(400).json({ error: 'Invalid session id', timestamp: new Date().toISOString() });
    return;
  }
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

// GET /guide-sessions/:id/evidence/:stepId — serve evidence photo
router.get('/:id/evidence/:stepId', (req: Request, res: Response): void => {
  const { id, stepId } = req.params;
  const filepath = path.join(EVIDENCE_DIR, id, `${stepId}.jpg`);

  if (!fs.existsSync(filepath)) {
    res.status(404).json({
      error: `Evidence not found for session ${id}, step ${stepId}`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  fs.createReadStream(filepath).pipe(res);
});

// DELETE /guide-sessions/:id — remove a single guide session + its evidence folder
router.delete('/:id', (req: Request, res: Response): void => {
  const session = guideSessionStore.findById(req.params.id);
  if (!session) { res.status(404).json({ error: 'Guide session not found' }); return; }
  const evidenceDir = path.join(EVIDENCE_DIR, req.params.id);
  if (fs.existsSync(evidenceDir)) fs.rmSync(evidenceDir, { recursive: true, force: true });
  guideSessionStore.delete(req.params.id);
  console.log(`[SIB] Guide session deleted: ${req.params.id}`);
  res.status(204).send();
});

// DELETE /guide-sessions — remove ALL guide sessions + all evidence folders
router.delete('/', (_req: Request, res: Response): void => {
  const all = guideSessionStore.findAll();
  for (const s of all) {
    const dir = path.join(EVIDENCE_DIR, s.id);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  const count = guideSessionStore.pruneWhere(() => true);
  console.log(`[SIB] Deleted all ${count} guide session(s)`);
  res.json({ deleted: count, timestamp: new Date().toISOString() });
});

export default router;
