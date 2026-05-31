import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Session, CreateSessionRequest, ApiResponse } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';

export const sessionStore = new JsonFileStore<Session>('sessions');

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
