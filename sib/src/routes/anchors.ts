import express, { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import fs   from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import type { Anchor, CreateAnchorRequest, ApiResponse } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { tagStore } from './tags.js';
import { passStateStore, findPassStateByTag } from '../stores/pass-state-store.js';

export const anchorStore = new JsonFileStore<Anchor>('anchors');

// ── File storage directories ──────────────────────────────────────────────────
// Mirror DATA_DIR logic from JsonFileStore so all binary blobs live next to JSON.
const DATA_DIR      = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const QRIMAGES_DIR  = path.join(DATA_DIR, 'qrimages');
const WORLDMAPS_DIR = path.join(DATA_DIR, 'worldmaps');

// Exported so app.ts can serve the pre-auth /anchors/:id/qrprint endpoint
// without duplicating the DATA_DIR resolution logic.
export { QRIMAGES_DIR };
fs.mkdirSync(QRIMAGES_DIR,  { recursive: true });
fs.mkdirSync(WORLDMAPS_DIR, { recursive: true });

const router = Router();

// ── #64: enforce unique anchor names (assetId) ────────────────────────────────
// assetId is the free-text "anchor name" an Author types when creating an
// anchor (e.g. "Pump-Station-A"). Two anchors with the identical name are
// confusing in the directory list and QR scans (both portal and iOS match on
// assetId for the "Wrong QR" check), so collisions are disambiguated here by
// appending the current time as an HH:MM:SS suffix — done server-side so it
// applies uniformly regardless of which client (iOS or portal) created it.
function ensureUniqueAssetId(assetId: string): string {
  const collision = anchorStore.findAll().some(
    a => a.assetId.toLowerCase() === assetId.toLowerCase()
  );
  if (!collision) return assetId;

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const suffix = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${assetId} ${suffix}`;
}

// ── QR payload builder ────────────────────────────────────────────────────────
// Must produce byte-for-byte identical JSON to the iOS QRAnchorContext.buildCanonicalPayload()
// and the portal's qrPayload():
//   { assetId, anchorId, encryptionKey?, qrSizeCm }
// Key insertion order is preserved by JSON.stringify and matters for QR pattern identity.
function buildCanonicalQRPayload(anchor: Anchor): string {
  const obj: Record<string, unknown> = {
    assetId:  anchor.assetId,
    anchorId: anchor.id,
  };
  if (anchor.encryptionKey) obj.encryptionKey = anchor.encryptionKey;
  obj.qrSizeCm = anchor.qrSizeCm ?? 10;
  return JSON.stringify(obj);
}

// ── QR image generation ───────────────────────────────────────────────────────
// Generates a 512×512 PNG with ECC level M (matching iOS CIQRCodeGenerator setting)
// and stores it in QRIMAGES_DIR/{anchorId}.png.
// Using `qrcode` npm package as the canonical generator — both portal and iOS fetch
// this file so all clients always display the same pixel pattern.
async function generateAndStoreQRImage(anchor: Anchor): Promise<void> {
  const payload = buildCanonicalQRPayload(anchor);
  const pngBuffer = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'M',
    type: 'png',
    width: 512,
    margin: 4,   // 4-module quiet zone per QR spec
    color: { dark: '#000000', light: '#ffffff' },
  });
  const filePath = path.join(QRIMAGES_DIR, `${anchor.id}.png`);
  fs.writeFileSync(filePath, pngBuffer);
  console.log(`[SIB] QR image generated for anchor ${anchor.id} (${pngBuffer.length} bytes)`);
}

// ── POST /anchors — create a new spatial anchor ───────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const body = req.body as CreateAnchorRequest;

  // Validate required fields
  if (!body.assetId || !body.coordinateSystem || !body.position || !body.rotation) {
    return res.status(400).json({
      error: 'Missing required fields: assetId, coordinateSystem, position, rotation',
      timestamp: new Date().toISOString(),
    });
  }

  // If the client provides an id honour it; if already exists return it (idempotent upsert).
  if (typeof (body as any).id === 'string') {
    const existing = anchorStore.findById((body as any).id as string);
    if (existing) {
      return res.status(200).json({ data: existing, timestamp: new Date().toISOString() });
    }
  }

  const now = new Date().toISOString();
  const anchor: Anchor = {
    id: (body as any).id ?? uuidv4(),
    assetId: ensureUniqueAssetId(body.assetId),
    coordinateSystem: body.coordinateSystem,
    position: body.position,
    rotation: body.rotation,
    metadata: body.metadata ?? {},
    // #105: always store an encryption key.  If the iOS app provided one
    // (Author workflow with Keychain-generated key) use it; otherwise generate
    // a random 32-byte key so portal-created anchors immediately have a working
    // QR with no "no encryption key" warning.  E2E security is preserved: the
    // key travels only in the QR payload and is never accessible without it.
    encryptionKey: (body.encryptionKey as string | undefined)?.trim()
      || randomBytes(32).toString('base64'),
    qrSizeCm: typeof (body as any).qrSizeCm === 'number' ? (body as any).qrSizeCm : 10.0,
    anchorType: body.anchorType,
    createdAt: now,
    updatedAt: now,
  };

  anchorStore.save(anchor);

  // Generate canonical QR PNG in the background — don't block the response.
  generateAndStoreQRImage(anchor).catch(err =>
    console.error(`[SIB] QR image generation failed for ${anchor.id}: ${err}`)
  );

  const response: ApiResponse<Anchor> = {
    data: anchor,
    timestamp: now,
  };

  return res.status(201).json(response);
});

// ── GET /anchors — list all anchors ───────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const anchors = anchorStore.findAll();
  return res.json({
    data: anchors,
    timestamp: new Date().toISOString(),
  });
});

// ── GET /anchors/:id — get a single anchor ────────────────────────────────────
router.get('/:id', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({
      error: `Anchor ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }
  return res.json({ data: anchor, timestamp: new Date().toISOString() });
});

// ── GET /anchors/:id/qrimage — serve the canonical QR PNG ────────────────────
// The QR PNG is generated once at anchor creation time using a single canonical
// algorithm (qrcode npm, ECC level M).  Both the portal and the iOS app fetch
// this image so all platforms always display the identical pixel pattern.
// If the file is missing (e.g. anchor pre-dates this feature), it is regenerated
// on-the-fly before serving.
router.get('/:id/qrimage', async (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({
      error: `Anchor ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  const filePath = path.join(QRIMAGES_DIR, `${anchor.id}.png`);
  if (!fs.existsSync(filePath)) {
    // Back-fill QR image for anchors created before this feature shipped.
    try {
      await generateAndStoreQRImage(anchor);
    } catch (err) {
      return res.status(500).json({ error: 'Failed to generate QR image', timestamp: new Date().toISOString() });
    }
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');  // 24 h — QR only changes if regenerated
  return res.sendFile(filePath);
});

// ── POST /anchors/:id/qrimage — (re)generate canonical QR PNG ────────────────
// Call this after updating an anchor's encryptionKey or qrSizeCm to refresh the
// stored QR so the portal and iOS app get the updated image.
router.post('/:id/qrimage', async (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({
      error: `Anchor ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  try {
    await generateAndStoreQRImage(anchor);
    return res.json({ data: { regenerated: true, anchorId: anchor.id }, timestamp: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: `QR generation failed: ${err}`, timestamp: new Date().toISOString() });
  }
});

// ── GET /anchors/:id/readiness ────────────────────────────────────────────────
router.get('/:id/readiness', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({
      error: `Anchor ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  const tags = tagStore.findAll().filter(t => t.anchorId === req.params.id);
  const totalTags = tags.length;

  if (totalTags === 0) {
    return res.json({
      data: {
        isReady: false,
        totalTags: 0,
        trainedTags: 0,
        untrainedTagIds: [],
        message: 'Anchor has no tags yet. Add and train tags in Author mode first.',
      },
      timestamp: new Date().toISOString(),
    });
  }

  const untrainedTagIds: string[] = [];
  let trainedCount = 0;
  for (const tag of tags) {
    const ps = findPassStateByTag(tag.id);
    if (ps && ps.images && ps.images.length > 0) {
      trainedCount++;
    } else {
      untrainedTagIds.push(tag.id);
    }
  }

  const isReady = untrainedTagIds.length === 0 && totalTags > 0;

  return res.json({
    data: {
      isReady,
      totalTags,
      trainedTags: trainedCount,
      untrainedTagIds,
      message: isReady
        ? 'Anchor is ready for inspection.'
        : `${untrainedTagIds.length} of ${totalTags} tags are not yet trained.`,
    },
    timestamp: new Date().toISOString(),
  });
});

// ── POST /anchors/:id/worldmap — store an ARWorldMap binary blob ──────────────
// The iOS app serialises an ARWorldMap (NSKeyedArchiver binary plist) and uploads
// it here after a successful QR lock.  On the next session for the same anchor,
// the app downloads this blob and passes it as config.initialWorldMap so ARKit
// relocates into the same feature-point cloud — giving scan-position-independent
// tag placement across sessions and across devices.
//
// Body: raw application/octet-stream binary (ARWorldMap NSKeyedArchiver data).
// Typical size: 2–10 MB.
//
// NOTE: this route deliberately does NOT use express.raw()/bodyParser. Those
// buffer the *entire* upload into one in-memory Buffer before the handler even
// runs, so a handful of concurrent 5–10MB world-map uploads (which we observed
// happening within seconds of each other on the same anchor) can transiently
// hold tens of MB on top of everything else the process already has resident —
// a direct contributor to the Render Starter 512MB OOM. Streaming the request
// straight to a file keeps peak memory to a small fixed buffer regardless of
// upload size.
const MAX_WORLDMAP_BYTES = 50 * 1024 * 1024; // 50mb cap, matches previous express.raw limit

router.post('/:id/worldmap', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({
      error: `Anchor ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  const finalPath = path.join(WORLDMAPS_DIR, `${anchor.id}.worldmap`);
  const tmpPath   = `${finalPath}.tmp-${Date.now()}`;
  const writeStream = fs.createWriteStream(tmpPath);

  let bytesReceived = 0;
  let aborted = false;

  const cleanupTmp = () => fs.unlink(tmpPath, () => { /* best-effort */ });

  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    bytesReceived += chunk.length;
    if (bytesReceived > MAX_WORLDMAP_BYTES) {
      aborted = true;
      writeStream.destroy();
      cleanupTmp();
      if (!res.headersSent) {
        res.status(413).json({
          error: `World map exceeds ${MAX_WORLDMAP_BYTES} byte limit`,
          timestamp: new Date().toISOString(),
        });
      }
      req.destroy();
    }
  });

  req.on('error', (err) => {
    aborted = true;
    writeStream.destroy();
    cleanupTmp();
    if (!res.headersSent) {
      res.status(400).json({ error: `Upload stream error: ${err}`, timestamp: new Date().toISOString() });
    }
  });

  writeStream.on('error', (err) => {
    aborted = true;
    cleanupTmp();
    if (!res.headersSent) {
      res.status(500).json({ error: `Failed to store world map: ${err}`, timestamp: new Date().toISOString() });
    }
  });

  writeStream.on('finish', () => {
    if (aborted) return;
    if (bytesReceived === 0) {
      cleanupTmp();
      return res.status(400).json({
        error: 'Request body must be a non-empty application/octet-stream binary',
        timestamp: new Date().toISOString(),
      });
    }
    fs.rename(tmpPath, finalPath, (err) => {
      if (err) {
        cleanupTmp();
        return res.status(500).json({ error: `Failed to store world map: ${err}`, timestamp: new Date().toISOString() });
      }
      console.log(`[SIB] World map stored for anchor ${anchor.id} (${bytesReceived} bytes, streamed)`);
      return res.status(201).json({
        data: { anchorId: anchor.id, bytes: bytesReceived },
        timestamp: new Date().toISOString(),
      });
    });
  });

  req.pipe(writeStream);
});

// ── GET /anchors/:id/worldmap — retrieve a stored ARWorldMap ──────────────────
// Returns 404 if no world map has been stored yet for this anchor (first session).
// The iOS app interprets a 404 as "no map available" and starts a fresh session.
router.get('/:id/worldmap', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({
      error: `Anchor ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  const filePath = path.join(WORLDMAPS_DIR, `${anchor.id}.worldmap`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({
      error: `No world map stored for anchor ${req.params.id}`,
      timestamp: new Date().toISOString(),
    });
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');  // always serve the freshest map
  return res.sendFile(filePath);
});

// ── DELETE /anchors/:id — cascade-delete anchor + tags + pass-states ──────────
router.delete('/:id', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({
      error: `Anchor ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  // Cascade: delete every tag (and its pass-state) that belongs to this anchor
  const tags = tagStore.findAll().filter(t => t.anchorId === req.params.id);
  let deletedTags = 0;
  let deletedPassStates = 0;
  for (const tag of tags) {
    const ps = findPassStateByTag(tag.id);
    if (ps) { passStateStore.delete(ps.id); deletedPassStates++; }
    tagStore.delete(tag.id);
    deletedTags++;
  }

  anchorStore.delete(req.params.id);

  // Clean up binary blobs (QR image + world map) — ignore errors if files don't exist
  const qrPath  = path.join(QRIMAGES_DIR,  `${req.params.id}.png`);
  const mapPath = path.join(WORLDMAPS_DIR, `${req.params.id}.worldmap`);
  try { fs.unlinkSync(qrPath);  } catch { /* not present */ }
  try { fs.unlinkSync(mapPath); } catch { /* not present */ }

  console.log(
    `[SIB] Deleted anchor ${req.params.id} ` +
    `(+${deletedTags} tags, +${deletedPassStates} pass-states)`
  );

  return res.status(200).json({
    data: { id: req.params.id, deletedTags, deletedPassStates },
    timestamp: new Date().toISOString(),
  });
});

export default router;
