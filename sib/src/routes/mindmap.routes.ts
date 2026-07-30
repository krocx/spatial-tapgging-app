// mindmap.routes.ts — REST surface for the Roadmap Mind-Mapper.
// Mounted at /mindmap (behind apiKeyAuth) in app.ts.
//
//   POST   /mindmap/save                      — create / full-save a map (+version snapshot)
//   GET    /mindmap/load/:id                  — load a map
//   GET    /mindmap/list                      — list map summaries
//   POST   /mindmap/export                    — { id, format: json|svg } → file download
//   DELETE /mindmap/:id                       — delete map + its versions
//   GET    /mindmap/:id/versions              — version history (metadata only)
//   POST   /mindmap/:id/restore/:versionId    — restore a snapshot

import { Router, type Request, type Response } from 'express';
import type { ApiResponse, Mindmap, MindmapSummary } from '@spatial/shared';
import {
  MindmapError,
  saveMindmap,
  loadMindmap,
  listMindmaps,
  deleteMindmap,
  getVersions,
  restoreVersion,
  exportMindmap,
} from '../controllers/mindmap.controller.js';
import { broadcastMapSync } from '../ws/mindmap.ws.js';

const router = Router();

function fail(res: Response, err: unknown): Response {
  const status = err instanceof MindmapError ? err.status : 500;
  const message = err instanceof Error ? err.message : 'Internal error';
  return res.status(status).json({ error: message, timestamp: new Date().toISOString() });
}

function ok<T>(res: Response, data: T, status = 200): Response {
  const response: ApiResponse<T> = { data, timestamp: new Date().toISOString() };
  return res.status(status).json(response);
}

router.post('/save', (req: Request, res: Response) => {
  try {
    const map = saveMindmap(req.body);
    // Keep any live collaborators in sync with a REST-side save.
    broadcastMapSync(map);
    return ok<Mindmap>(res, map, 201);
  } catch (err) { return fail(res, err); }
});

router.get('/load/:id', (req: Request, res: Response) => {
  try { return ok<Mindmap>(res, loadMindmap(req.params.id)); }
  catch (err) { return fail(res, err); }
});

router.get('/list', (_req: Request, res: Response) => {
  try { return ok<MindmapSummary[]>(res, listMindmaps()); }
  catch (err) { return fail(res, err); }
});

router.post('/export', (req: Request, res: Response) => {
  try {
    const { id, format } = (req.body ?? {}) as { id?: string; format?: string };
    if (!id || !format) {
      throw new MindmapError(400, 'Missing required fields: id, format');
    }
    const result = exportMindmap(id, format);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.body);
  } catch (err) { return fail(res, err); }
});

router.get('/:id/versions', (req: Request, res: Response) => {
  try { return ok(res, getVersions(req.params.id)); }
  catch (err) { return fail(res, err); }
});

router.post('/:id/restore/:versionId', (req: Request, res: Response) => {
  try {
    const map = restoreVersion(req.params.id, req.params.versionId);
    broadcastMapSync(map);
    return ok<Mindmap>(res, map);
  } catch (err) { return fail(res, err); }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    deleteMindmap(req.params.id);
    return ok(res, { deleted: req.params.id });
  } catch (err) { return fail(res, err); }
});

export default router;
