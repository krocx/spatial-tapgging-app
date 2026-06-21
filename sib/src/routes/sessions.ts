import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Session, CreateSessionRequest, ApiResponse } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';

export const sessionStore = new JsonFileStore<Session>('sessions');

// ── Bounded retention ────────────────────────────────────────────────────────
// Sessions are never deleted by the normal API flow (close only sets endTime),
// so without pruning sessions.json — and the in-memory Map behind it — grows
// forever (407 records and counting as of this writing, each holding a
// growing `observations[]` array). Prune closed sessions older than the
// retention window, and also prune sessions that were opened but never
// closed (abandoned/crashed clients) past a longer grace period so a stuck
// client can't pin a session in memory indefinitely either.
const SESSION_RETENTION_DAYS = parseFloat(process.env.SESSION_RETENTION_DAYS ?? '7');
const STALE_OPEN_SESSION_DAYS = parseFloat(process.env.STALE_OPEN_SESSION_DAYS ?? '30');
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // hourly

export function pruneOldSessions(): number {
  const now = Date.now();
  const closedCutoffMs = SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const openCutoffMs = STALE_OPEN_SESSION_DAYS * 24 * 60 * 60 * 1000;

  const removed = sessionStore.pruneWhere((session) => {
    const referenceTime = session.endTime ?? session.updatedAt ?? session.createdAt;
    const ageMs = now - new Date(referenceTime).getTime();
    if (Number.isNaN(ageMs)) return false;
    return session.endTime ? ageMs > closedCutoffMs : ageMs > openCutoffMs;
  });

  if (removed > 0) {
    console.log(`[SIB] Pruned ${removed} old session(s) (retention=${SESSION_RETENTION_DAYS}d closed / ${STALE_OPEN_SESSION_DAYS}d stale-open)`);
  }
  return removed;
}

// Prune once at startup (handles sessions that piled up while pruning didn't
// exist yet) and then on an hourly timer for the life of the process.
pruneOldSessions();
setInterval(pruneOldSessions, PRUNE_INTERVAL_MS).unref();

const router = Router();

// POST /sessions — open a new session
router.post('/', (req: Request, res: Response) => {
  const body = req.body as CreateSessionRequest;

  if (!body.userId || !body.assetId) {
    return res.status(400).json({
      error: 'Missing required fields: userId, assetId',
      timestamp: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  const session: Session = {
    id: uuidv4(),
    userId: body.userId,
    assetId: body.assetId,
    startTime: now,
    observations: [],
    completedSteps: [],
    createdAt: now,
    updatedAt: now,
  };

  sessionStore.save(session);

  const response: ApiResponse<Session> = {
    data: session,
    timestamp: now,
  };

  return res.status(201).json(response);
});

// GET /sessions — list all sessions
router.get('/', (_req: Request, res: Response) => {
  return res.json({
    data: sessionStore.findAll(),
    timestamp: new Date().toISOString(),
  });
});

// GET /sessions/:id — get a single session
router.get('/:id', (req: Request, res: Response) => {
  const session = sessionStore.findById(req.params.id);
  if (!session) {
    return res.status(404).json({
      error: `Session ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }
  return res.json({ data: session, timestamp: new Date().toISOString() });
});

// PATCH /sessions/:id/close — close a session
router.patch('/:id/close', (req: Request, res: Response) => {
  const session = sessionStore.update(req.params.id, {
    endTime: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (!session) {
    return res.status(404).json({
      error: `Session ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  return res.json({ data: session, timestamp: new Date().toISOString() });
});

export default router;
