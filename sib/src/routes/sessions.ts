import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type {
  Session,
  CreateSessionRequest,
  ApiResponse,
  SubmitReportRequest,
  UploadEvidenceRequest,
  EvidenceUploadResponse,
} from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';

// ── Evidence storage directory ────────────────────────────────────────────────
// Images are stored as JPEG files: AnchorID_TagID_YYYYMMDD_HHMMSS.jpg
// DATA_DIR mirrors the pattern used in json-file-store.ts.
const DATA_DIR = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

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

// PATCH /sessions/:id/close — close a session (legacy / backward-compat)
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

// PATCH /sessions/:id/report — submit Phase 4 inspection report
// Called by the iOS app on "End Session": stores ownerName, anchorId, tagRecords,
// overallStatus, endTime, and durationSeconds on the existing session record.
router.patch('/:id/report', (req: Request, res: Response) => {
  const existing = sessionStore.findById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: `Session ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  const body = req.body as SubmitReportRequest;
  if (!body.ownerName || !body.anchorId || !Array.isArray(body.tagRecords)) {
    return res.status(400).json({
      error: 'Missing required fields: ownerName, anchorId, tagRecords',
      timestamp: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  const session = sessionStore.update(req.params.id, {
    ownerName:       body.ownerName,
    anchorId:        body.anchorId,
    anchorName:      body.anchorName,
    endTime:         body.endTime ?? now,
    durationSeconds: body.durationSeconds,
    tagRecords:      body.tagRecords,
    overallStatus:   body.overallStatus,
    updatedAt:       now,
  });

  return res.json({ data: session, timestamp: now });
});

// POST /sessions/:id/evidence/:tagId — upload one evidence image
// Body: { anchorId, imageBase64, mimeType, capturedAt }
// Stores the image as a file: EVIDENCE_DIR/AnchorID_TagID_YYYYMMDD_HHMMSS.jpg
// Returns: { imagePath: "AnchorID_TagID_YYYYMMDD_HHMMSS.jpg" }
router.post('/:id/evidence/:tagId', (req: Request, res: Response) => {
  const body = req.body as UploadEvidenceRequest;

  if (!body.anchorId || !body.imageBase64) {
    return res.status(400).json({
      error: 'Missing required fields: anchorId, imageBase64',
      timestamp: new Date().toISOString(),
    });
  }

  // Build filename: AnchorID_TagID_YYYYMMDD_HHMMSS.jpg
  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : new Date();
  const datePart = capturedAt.toISOString()
    .replace(/[-:]/g, '')     // remove hyphens and colons
    .replace('T', '_')        // replace T separator with underscore
    .replace(/\.\d{3}Z$/, ''); // remove milliseconds and Z
  const filename = `${body.anchorId}_${req.params.tagId}_${datePart}.jpg`;
  const filePath = path.join(EVIDENCE_DIR, filename);

  try {
    // Decode base64 and write JPEG to disk
    const imageBuffer = Buffer.from(body.imageBase64, 'base64');
    fs.writeFileSync(filePath, imageBuffer);
  } catch (err) {
    console.error(`[Sessions] Failed to write evidence image: ${err}`);
    return res.status(500).json({
      error: 'Failed to store evidence image',
      timestamp: new Date().toISOString(),
    });
  }

  const response: EvidenceUploadResponse = { imagePath: filename };
  return res.status(201).json({ data: response, timestamp: new Date().toISOString() });
});

// GET /sessions/evidence/:filename — serve an evidence image
// Used by the portal to display evidence thumbnails.
router.get('/evidence/:filename', (req: Request, res: Response) => {
  // Sanitise: allow only alphanumeric, dash, underscore, dot
  const filename = req.params.filename.replace(/[^a-zA-Z0-9_\-\.]/g, '');
  if (!filename.endsWith('.jpg') && !filename.endsWith('.jpeg') && !filename.endsWith('.png')) {
    return res.status(400).json({ error: 'Invalid filename', timestamp: new Date().toISOString() });
  }

  const filePath = path.join(EVIDENCE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Evidence image not found', timestamp: new Date().toISOString() });
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400'); // evidence images are immutable
  return res.sendFile(filePath);
});

export default router;
