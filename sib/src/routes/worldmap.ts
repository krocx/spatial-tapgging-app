// worldmap.ts — Phase 2: ARWorldMap upload/download for Loc-Tag anchors
//
// ARWorldMap is a binary blob serialized by ARKit (NSKeyedArchiver).
// We store it on disk as a raw binary file (not base64) to keep file I/O
// efficient; the client sends/receives it as base64 over the REST API.
//
// Endpoints:
//   POST  /worldmap/upload                        — Author saves map (+ optional reference photo)
//   GET   /worldmap/:anchorId                     — Operator downloads map to re-localize
//   GET   /worldmap/:anchorId/reference-photo     — Serve the reference photo (JPEG)

import { Router } from 'express';
import type { Request, Response } from 'express';
import fs   from 'fs';
import path from 'path';
import type { ApiResponse } from '@spatial/shared';

// ── Storage ───────────────────────────────────────────────────────────────────

const DATA_DIR      = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const WORLDMAPS_DIR = path.join(DATA_DIR, 'worldmaps');
fs.mkdirSync(WORLDMAPS_DIR, { recursive: true });

// Guide-scoped worldmaps live in a separate directory to avoid namespace clashes
// with anchor worldmaps.
const GUIDE_WORLDMAPS_DIR = path.join(DATA_DIR, 'guide-worldmaps');
fs.mkdirSync(GUIDE_WORLDMAPS_DIR, { recursive: true });

function worldMapPath(anchorId: string): string {
  return path.join(WORLDMAPS_DIR, `${anchorId}.arworldmap`);
}

function refPhotoPath(anchorId: string): string {
  return path.join(WORLDMAPS_DIR, `${anchorId}.refphoto.jpg`);
}

function guideWorldMapPath(guideId: string): string {
  return path.join(GUIDE_WORLDMAPS_DIR, `${guideId}.arworldmap`);
}

function guideRefPhotoPath(guideId: string): string {
  return path.join(GUIDE_WORLDMAPS_DIR, `${guideId}.refphoto.jpg`);
}

/** X1: camera pose (column-major 4×4, 16 floats, world-map coords) at the
 *  moment the reference photo was taken — the operator's "I'm Here" pose is
 *  compared against it to detect a relocalization that latched onto a moved
 *  object (QR moved → every pin off). */
function guideRefPosePath(guideId: string): string {
  return path.join(GUIDE_WORLDMAPS_DIR, `${guideId}.refpose.json`);
}

function isValidAnchorId(anchorId: string): boolean {
  return !anchorId.includes('..') && !anchorId.includes('/');
}

function isValidGuideId(guideId: string): boolean {
  return !guideId.includes('..') && !guideId.includes('/');
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// POST /worldmap/upload
// Body: { anchorId: string, worldMapBase64: string, capturedAt: string, referencePhotoBase64?: string }
// referencePhotoBase64 is a JPEG snapshot taken at the moment the Author saved their
// first tag, giving Operators a visual landmark for where to stand when re-localizing.
router.post('/upload', (req: Request, res: Response): void => {
  const { anchorId, worldMapBase64, capturedAt, referencePhotoBase64 } = req.body as {
    anchorId:              string;
    worldMapBase64:        string;
    capturedAt:            string;
    referencePhotoBase64?: string;
  };

  if (!anchorId || !worldMapBase64) {
    res.status(400).json({ error: 'anchorId and worldMapBase64 are required' });
    return;
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(worldMapBase64, 'base64');
  } catch {
    res.status(400).json({ error: 'worldMapBase64 is not valid base64' });
    return;
  }

  try {
    fs.writeFileSync(worldMapPath(anchorId), buf);
  } catch (err) {
    console.error('[SIB] Failed to write world map:', err);
    res.status(500).json({ error: 'Failed to save world map' });
    return;
  }

  // Optional: save reference photo for Operator re-localization guidance
  let refPhotoSaved = false;
  if (referencePhotoBase64) {
    try {
      const photoBuf = Buffer.from(referencePhotoBase64, 'base64');
      fs.writeFileSync(refPhotoPath(anchorId), photoBuf);
      refPhotoSaved = true;
      console.log(`[SIB] Reference photo saved for anchor ${anchorId} (${photoBuf.length} bytes)`);
    } catch (err) {
      // Non-fatal: log but don't fail the whole upload
      console.error('[SIB] Failed to save reference photo (non-fatal):', err);
    }
  }

  console.log(`[SIB] ARWorldMap saved for anchor ${anchorId} (${buf.length} bytes, captured ${capturedAt})`);

  const resp: ApiResponse<{ anchorId: string; sizeBytes: number; refPhotoSaved: boolean }> = {
    data:      { anchorId, sizeBytes: buf.length, refPhotoSaved },
    timestamp: new Date().toISOString(),
  };
  res.status(201).json(resp);
});

// ── Guide-scoped worldmap routes ──────────────────────────────────────────────
// IMPORTANT: these must be registered BEFORE /:anchorId catch-all routes so
// Express doesn't capture "guide" as an anchorId.

// POST /worldmap/guide/:guideId/upload
// Body: { guideId, worldMapBase64, capturedAt, referencePhotoBase64? }
// Author saves the ARWorldMap captured during guide step placement.
router.post('/guide/:guideId/upload', (req: Request, res: Response): void => {
  const { guideId } = req.params;
  if (!isValidGuideId(guideId)) {
    res.status(400).json({ error: 'Invalid guideId' });
    return;
  }

  const { worldMapBase64, capturedAt, referencePhotoBase64, referenceCameraPose } = req.body as {
    worldMapBase64:        string;
    capturedAt:            string;
    referencePhotoBase64?: string;
    referenceCameraPose?:  number[];
  };

  if (!worldMapBase64) {
    res.status(400).json({ error: 'worldMapBase64 is required' });
    return;
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(worldMapBase64, 'base64');
  } catch {
    res.status(400).json({ error: 'worldMapBase64 is not valid base64' });
    return;
  }

  try {
    fs.writeFileSync(guideWorldMapPath(guideId), buf);
  } catch (err) {
    console.error('[SIB] Failed to write guide world map:', err);
    res.status(500).json({ error: 'Failed to save guide world map' });
    return;
  }

  let refPhotoSaved = false;
  if (referencePhotoBase64) {
    try {
      const photoBuf = Buffer.from(referencePhotoBase64, 'base64');
      fs.writeFileSync(guideRefPhotoPath(guideId), photoBuf);
      refPhotoSaved = true;
      console.log(`[SIB] Reference photo saved for guide ${guideId} (${photoBuf.length} bytes)`);
    } catch (err) {
      console.error('[SIB] Failed to save guide reference photo (non-fatal):', err);
    }
  }

  // X1: reference camera pose rides along with the photo (only when a photo
  // was captured this save — the pose belongs to that frame).
  if (referencePhotoBase64 && Array.isArray(referenceCameraPose)
      && referenceCameraPose.length === 16 && referenceCameraPose.every(n => typeof n === 'number' && isFinite(n))) {
    try {
      fs.writeFileSync(guideRefPosePath(guideId), JSON.stringify({ referenceCameraPose, capturedAt }));
    } catch (err) { console.error('[SIB] Failed to save reference pose (non-fatal):', err); }
  }

  console.log(`[SIB] ARWorldMap saved for guide ${guideId} (${buf.length} bytes, captured ${capturedAt})`);

  const resp: ApiResponse<{ guideId: string; sizeBytes: number; refPhotoSaved: boolean }> = {
    data:      { guideId, sizeBytes: buf.length, refPhotoSaved },
    timestamp: new Date().toISOString(),
  };
  res.status(201).json(resp);
});

// GET /worldmap/guide/:guideId/meta — X1: { referenceCameraPose?: number[16], capturedAt? }
router.get('/guide/:guideId/meta', (req: Request, res: Response): void => {
  const { guideId } = req.params;
  if (!isValidGuideId(guideId)) {
    res.status(400).json({ error: 'Invalid guideId' });
    return;
  }
  let meta: Record<string, unknown> = {};
  try {
    if (fs.existsSync(guideRefPosePath(guideId))) {
      meta = JSON.parse(fs.readFileSync(guideRefPosePath(guideId), 'utf8')) as Record<string, unknown>;
    }
  } catch { meta = {}; }
  res.json({ data: meta, timestamp: new Date().toISOString() });
});

// GET /worldmap/guide/:guideId/photo
// Returns the reference JPEG captured when the Author saved step positions.
// 404 if no photo was uploaded.
router.get('/guide/:guideId/photo', (req: Request, res: Response): void => {
  const { guideId } = req.params;
  if (!isValidGuideId(guideId)) {
    res.status(400).json({ error: 'Invalid guideId' });
    return;
  }

  const filePath = guideRefPhotoPath(guideId);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: `No reference photo found for guide ${guideId}` });
    return;
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(filePath);
});

// GET /worldmap/guide/:guideId
// Returns the binary ARWorldMap for a guide as application/octet-stream.
// 404 if the Author has not yet placed steps and saved a worldmap.
router.get('/guide/:guideId', (req: Request, res: Response): void => {
  const { guideId } = req.params;
  if (!isValidGuideId(guideId)) {
    res.status(400).json({ error: 'Invalid guideId' });
    return;
  }

  const filePath = guideWorldMapPath(guideId);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: `No world map found for guide ${guideId}` });
    return;
  }

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type',   'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('X-Guide-Id',     guideId);

  const stream = fs.createReadStream(filePath);
  stream.on('error', err => {
    console.error('[SIB] Error streaming guide world map:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream guide world map' });
    }
  });
  stream.pipe(res);
});

// ── Anchor worldmap routes (existing) ─────────────────────────────────────────

// GET /worldmap/:anchorId/reference-photo
// Returns the reference JPEG captured at the Author's first tag save.
// 404 if no photo was uploaded (older anchors or Author skipped it).
router.get('/:anchorId/reference-photo', (req: Request, res: Response): void => {
  const { anchorId } = req.params;

  if (!isValidAnchorId(anchorId)) {
    res.status(400).json({ error: 'Invalid anchorId' });
    return;
  }

  const filePath = refPhotoPath(anchorId);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: `No reference photo found for anchor ${anchorId}` });
    return;
  }

  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(filePath);
});

// GET /worldmap/:anchorId
// Returns the binary ARWorldMap as application/octet-stream.
// The iOS client calls Data(contentsOf:) after writing the response body to disk.
router.get('/:anchorId', (req: Request, res: Response): void => {
  const { anchorId } = req.params;

  if (!isValidAnchorId(anchorId)) {
    res.status(400).json({ error: 'Invalid anchorId' });
    return;
  }

  const filePath = worldMapPath(anchorId);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: `No world map found for anchor ${anchorId}` });
    return;
  }

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Type',   'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('X-Anchor-Id',    anchorId);

  const stream = fs.createReadStream(filePath);
  stream.on('error', err => {
    console.error('[SIB] Error streaming world map:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to stream world map' });
    }
  });
  stream.pipe(res);
});

export default router;
