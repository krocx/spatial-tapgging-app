import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Observation, ApiResponse } from '@spatial/shared';
import { getAdapter, listAdapters } from '../adapters/perception-adapter.js';
import { sessionStore } from './sessions.js';

const router = Router();

export interface AnalyzeImageRequest {
  imageBase64: string;    // base64-encoded image data
  mimeType: string;       // e.g. "image/jpeg"
  assetId: string;
  anchorId: string;
  tagId: string;
  sessionId: string;
  userId: string;
  adapter?: string;       // defaults to "stub-adapter" in Phase 1
}

// POST /perception/analyze-image
// Accepts a base64 image + context, routes to the named adapter,
// and appends resulting observations to the active session.
router.post('/analyze-image', async (req: Request, res: Response) => {
  const body = req.body as AnalyzeImageRequest;

  const required = ['imageBase64', 'mimeType', 'assetId', 'anchorId', 'tagId', 'sessionId', 'userId'];
  const missing = required.filter((k) => !body[k as keyof AnalyzeImageRequest]);
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing required fields: ${missing.join(', ')}`,
      timestamp: new Date().toISOString(),
    });
  }

  // Resolve the adapter (default to stub in Phase 1)
  const adapterName = body.adapter ?? 'stub-adapter';
  const adapter = getAdapter(adapterName);
  if (!adapter) {
    return res.status(400).json({
      error: `Unknown adapter "${adapterName}". Available: ${listAdapters().join(', ')}`,
      timestamp: new Date().toISOString(),
    });
  }

  // Decode base64 image
  const imageBuffer = Buffer.from(body.imageBase64, 'base64');

  // Run perception
  const observations: Observation[] = await adapter.analyze(imageBuffer, {
    assetId: body.assetId,
    anchorId: body.anchorId,
    tagId: body.tagId,
    userId: body.userId,
  });

  // Stamp each observation with a unique id and timestamp
  const now = new Date().toISOString();
  const stamped: Observation[] = observations.map((obs) => ({
    ...obs,
    id: obs.id ?? uuidv4(),
    timestamp: obs.timestamp ?? now,
    imageId: obs.imageId ?? uuidv4(), // Phase 1: imageId = generated; Phase 2: use object store id
  }));

  // Append observations to the session
  const session = sessionStore.findById(body.sessionId);
  if (session) {
    sessionStore.update(body.sessionId, {
      observations: [...session.observations, ...stamped],
      updatedAt: now,
    });
  }

  const response: ApiResponse<Observation[]> = {
    data: stamped,
    timestamp: now,
  };

  return res.status(200).json(response);
});

// GET /perception/adapters — list registered adapters
router.get('/adapters', (_req: Request, res: Response) => {
  return res.json({
    data: listAdapters(),
    timestamp: new Date().toISOString(),
  });
});

export default router;
