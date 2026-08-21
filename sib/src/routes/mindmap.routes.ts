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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  importSib,
  publishMindmap,
  unlockByKey,
  withPublished,
  assertAccess,
} from '../controllers/mindmap.controller.js';
import { broadcastMapSync } from '../ws/mindmap.ws.js';
import { mindmapStore } from '../models/mindmap.model.js';
import {
  ProcedureError,
  validateProcedure,
  exportProcedure,
} from '../procedure/export.js';
import {
  DesignerImageError,
  saveDesignerImage,
  designerImagePath,
} from '../procedure/designer-images.js';

/**
 * Persist a map without snapshotting a version. Used by the procedure export to
 * stamp step provenance onto nodes — bookkeeping, not an authored edit, so it
 * should not consume a slot in the version history.
 */
function saveMindmapRecord(map: Mindmap): void {
  mindmapStore.save(map);
}

const router = Router();

/** Draft key for the addressed map (publish workflow, pre-RBAC). */
function draftKeyOf(req: Request): string | undefined {
  const h = req.headers['x-draft-key'];
  const v = Array.isArray(h) ? h[0] : h;
  return v?.trim() || undefined;
}

/** X-Draft-Keys: "mapId1:key1,mapId2:key2" — used by /list. */
function draftKeysOf(req: Request): Map<string, string> {
  const h = req.headers['x-draft-keys'];
  const v = Array.isArray(h) ? h[0] : h;
  const out = new Map<string, string>();
  for (const pair of (v ?? '').split(',')) {
    const i = pair.indexOf(':');
    if (i > 0) out.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return out;
}

function fail(res: Response, err: unknown): Response {
  const status =
    err instanceof MindmapError       ? err.status :
    err instanceof ProcedureError     ? err.status :
    err instanceof DesignerImageError ? err.status : 500;
  const message = err instanceof Error ? err.message : 'Internal error';
  // Procedure failures carry the pre-flight issue list — the client needs it to
  // point at the offending step rather than just showing a message.
  const issues = err instanceof ProcedureError && err.issues.length ? { issues: err.issues } : {};
  return res.status(status).json({ error: message, ...issues, timestamp: new Date().toISOString() });
}

function ok<T>(res: Response, data: T, status = 200): Response {
  const response: ApiResponse<T> = { data, timestamp: new Date().toISOString() };
  return res.status(status).json(response);
}

router.post('/save', (req: Request, res: Response) => {
  try {
    const { map, draftKey } = saveMindmap(req.body, draftKeyOf(req));
    // Keep any live collaborators in sync with a REST-side save.
    broadcastMapSync(map);
    // Creation responses carry the draft key exactly once.
    return ok(res, draftKey ? { ...map, draftKey } : map, 201);
  } catch (err) { return fail(res, err); }
});

router.get('/load/:id', (req: Request, res: Response) => {
  try {
    assertAccess(req.params.id, draftKeyOf(req));
    return ok<Mindmap>(res, withPublished(loadMindmap(req.params.id)));
  } catch (err) { return fail(res, err); }
});

router.get('/list', (req: Request, res: Response) => {
  try { return ok<MindmapSummary[]>(res, listMindmaps(draftKeysOf(req))); }
  catch (err) { return fail(res, err); }
});

// GET /mindmap/glossary — the roadmap dictionary (docs/roadmap-glossary.md),
// served at runtime so editing the markdown updates the tool with no rebuild.
// Works from src (tsx), dist (compiled), and the Docker image (/app/docs).
const __routesDir = path.dirname(fileURLToPath(import.meta.url));
const GLOSSARY_CANDIDATES = [
  path.join(__routesDir, '../../../docs/roadmap-glossary.md'),   // repo: sib/{src|dist}/routes → docs/
  path.join(process.cwd(), 'docs/roadmap-glossary.md'),          // Docker: cwd /app
  path.join(process.cwd(), '../docs/roadmap-glossary.md'),       // dev: cwd sib/
];

router.get('/glossary', (_req: Request, res: Response) => {
  for (const candidate of GLOSSARY_CANDIDATES) {
    try {
      const markdown = fs.readFileSync(candidate, 'utf8');
      return ok(res, { markdown, updatedAt: fs.statSync(candidate).mtimeMs });
    } catch { /* try next location */ }
  }
  return res.status(404).json({
    error: 'Glossary not found — expected docs/roadmap-glossary.md alongside the SIB deployment',
    timestamp: new Date().toISOString(),
  });
});

router.post('/export', (req: Request, res: Response) => {
  try {
    const { id, format } = (req.body ?? {}) as { id?: string; format?: string };
    if (!id || !format) {
      throw new MindmapError(400, 'Missing required fields: id, format');
    }
    assertAccess(id, draftKeyOf(req));
    const result = exportMindmap(id, format);
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    return res.send(result.body);
  } catch (err) { return fail(res, err); }
});

// POST /mindmap/import-image — { image: base64, mimeType } → PREVIEW graph
// (not persisted; the client creates a draft via /save if the user accepts).
// Extraction runs on the locally configured vision model — see vision-adapter.ts.
router.post('/import-image', (req: Request, res: Response) => {
  void (async () => {
    try {
      const { image, mimeType } = (req.body ?? {}) as { image?: string; mimeType?: string };
      if (!image || typeof image !== 'string') {
        throw new MindmapError(400, 'Missing required field: image (base64)');
      }
      if (image.length > 12_000_000) {
        throw new MindmapError(413, 'Image too large — downscale to ~1280px before upload');
      }
      const mime = typeof mimeType === 'string' && /^image\/(png|jpe?g|webp)$/.test(mimeType)
        ? mimeType : 'image/jpeg';
      const { extractMindmapFromImage } = await import('../adapters/vision-adapter.js');
      const result = await extractMindmapFromImage(image, mime);
      return ok(res, result);
    } catch (err) {
      const status = err instanceof MindmapError ? err.status : 502;
      const message = err instanceof Error ? err.message : 'Vision extraction failed';
      return res.status(status).json({ error: message, timestamp: new Date().toISOString() });
    }
  })();
});

// POST /mindmap/unlock — { draftKey } → map summary; how teammates open a shared draft.
router.post('/unlock', (req: Request, res: Response) => {
  try {
    const { draftKey } = (req.body ?? {}) as { draftKey?: string };
    if (!draftKey?.trim()) throw new MindmapError(400, 'Missing required field: draftKey');
    return ok(res, unlockByKey(draftKey.trim()));
  } catch (err) { return fail(res, err); }
});

// POST /mindmap/:id/publish  |  /:id/unpublish — draft-key holder only.
router.post('/:id/publish', (req: Request, res: Response) => {
  try { return ok<Mindmap>(res, publishMindmap(req.params.id, draftKeyOf(req), true)); }
  catch (err) { return fail(res, err); }
});
router.post('/:id/unpublish', (req: Request, res: Response) => {
  try { return ok<Mindmap>(res, publishMindmap(req.params.id, draftKeyOf(req), false)); }
  catch (err) { return fail(res, err); }
});

// POST /mindmap/:id/import-sib — merge SIB anchors/tags into the map.
// Body: { anchorId?: string } — omit to import the full anchor/tag graph.
router.post('/:id/import-sib', (req: Request, res: Response) => {
  try {
    assertAccess(req.params.id, draftKeyOf(req));
    const { anchorId } = (req.body ?? {}) as { anchorId?: string };
    const result = importSib(req.params.id, anchorId);
    if (result.addedNodes > 0 || result.addedEdges > 0) broadcastMapSync(result.map);
    return ok(res, result);
  } catch (err) { return fail(res, err); }
});

// ── Procedure Designer ──────────────────────────────────────────────────────
// A `kind: 'procedure'` map compiles into an AR guide.
// See docs/PROCEDURE-DESIGNER.md.

// POST /mindmap/step-images — upload a step reference image (base64 JPEG).
// Content-addressed; the response filename goes into node.metadata.step.imageFile.
// Registered BEFORE /:id routes so "step-images" is not read as a map id.
router.post('/step-images', (req: Request, res: Response) => {
  try {
    const { image } = (req.body ?? {}) as { image?: string };
    if (!image?.trim()) throw new DesignerImageError(400, 'Missing required field: image (base64 JPEG)');
    const filename = saveDesignerImage(image.trim());
    return ok(res, { filename }, 201);
  } catch (err) { return fail(res, err); }
});

// GET /mindmap/step-images/:filename — serve a designer image.
router.get('/step-images/:filename', (req: Request, res: Response) => {
  const full = designerImagePath(req.params.filename);
  if (!full) return res.status(404).json({ error: 'Image not found', timestamp: new Date().toISOString() });
  return res.sendFile(full);
});

// POST /mindmap/:id/procedure/validate — pre-flight only; never writes.
// Returns the census, derived step numbers, and any blocking/warning issues.
router.post('/:id/procedure/validate', (req: Request, res: Response) => {
  try {
    assertAccess(req.params.id, draftKeyOf(req));
    const map = loadMindmap(req.params.id);
    return ok(res, validateProcedure(map));
  } catch (err) { return fail(res, err); }
});

// POST /mindmap/:id/procedure/export — send the procedure to the Guide Library.
//
// Body: { anchorId?, createdBy, guideId?, confirmUnpublish? }
// Creates a DRAFT guide with every new step unplaced — placement happens on
// device and is never written from here.
router.post('/:id/procedure/export', async (req: Request, res: Response) => {
  try {
    assertAccess(req.params.id, draftKeyOf(req));
    const map  = loadMindmap(req.params.id);
    const body = (req.body ?? {}) as {
      anchorId?: string; createdBy?: string; guideId?: string; confirmUnpublish?: boolean;
    };

    if (!body.createdBy?.trim()) {
      throw new ProcedureError(400, 'createdBy is required');
    }

    const { result, provenance } = await exportProcedure(map, {
      anchorId:         body.anchorId,
      createdBy:        body.createdBy.trim(),
      guideId:          body.guideId,
      confirmUnpublish: body.confirmUnpublish === true,
    });

    // Persist provenance onto the nodes so the next re-sync matches these steps
    // instead of duplicating them. Also pins the map's anchor on first export.
    const stamped: Mindmap = {
      ...map,
      anchorId: map.anchorId ?? body.anchorId,
      nodes: map.nodes.map(n => {
        const p = provenance[n.id];
        return p ? { ...n, metadata: { ...n.metadata, guide: p } } : n;
      }),
      // Map and guide agree as of now — resets the stale-map warning that
      // "Edit in Designer" shows when the guide changed elsewhere since.
      guideSync: { guideId: result.guideId, syncedAt: Date.now() },
      updatedAt: Date.now(),
    };
    saveMindmapRecord(stamped);
    broadcastMapSync(stamped);

    return ok(res, result, 201);
  } catch (err) { return fail(res, err); }
});

router.get('/:id/versions', (req: Request, res: Response) => {
  try {
    assertAccess(req.params.id, draftKeyOf(req));
    return ok(res, getVersions(req.params.id));
  } catch (err) { return fail(res, err); }
});

router.post('/:id/restore/:versionId', (req: Request, res: Response) => {
  try {
    assertAccess(req.params.id, draftKeyOf(req));
    const map = restoreVersion(req.params.id, req.params.versionId);
    broadcastMapSync(map);
    return ok<Mindmap>(res, map);
  } catch (err) { return fail(res, err); }
});

router.delete('/:id', (req: Request, res: Response) => {
  try {
    deleteMindmap(req.params.id, draftKeyOf(req));
    return ok(res, { deleted: req.params.id });
  } catch (err) { return fail(res, err); }
});

export default router;
