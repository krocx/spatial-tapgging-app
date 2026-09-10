import express, { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { randomBytes } from 'crypto';
import fs   from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import type { Anchor, CreateAnchorRequest, UpdateAnchorRequest, ApiResponse, AnchorObjectMeta } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { tagStore } from './tags.js';
import { passStateStore, findPassStateByTag } from '../stores/pass-state-store.js';
import { buildAssemblyEnvelope } from '../tag/tag-emitter.js';
import { subscribeToAnchor } from '../tag/tag-subscribe.js';
import { validatePresenceUpdate, updatePresence, listPresence, leavePresence } from '../sse/presence.js';
import { model3DStore } from './models.js';
import { guideStore } from '../guides/store.js';
import { copyGuideToAnchor } from '../guides/copy.js';
import { currentUamUser, uamIsActive } from '../middleware/auth.js';
import { chamberConfigStore } from './chamber-configs.js';
import { logOpsEvent } from '../ops-log.js';

export const anchorStore = new JsonFileStore<Anchor>('anchors');

// ── File storage directories ──────────────────────────────────────────────────
// Mirror DATA_DIR logic from JsonFileStore so all binary blobs live next to JSON.
const DATA_DIR      = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const QRIMAGES_DIR  = path.join(DATA_DIR, 'qrimages');
const WORLDMAPS_DIR = path.join(DATA_DIR, 'worldmaps');
// B1 (2026.4.46): ARKit reference objects — on-device scans, on-premise files.
const OBJECTS_DIR   = path.join(DATA_DIR, 'objects');

// Exported so app.ts can serve the pre-auth /anchors/:id/qrprint endpoint
// without duplicating the DATA_DIR resolution logic.
export { QRIMAGES_DIR };
fs.mkdirSync(QRIMAGES_DIR,  { recursive: true });
fs.mkdirSync(WORLDMAPS_DIR, { recursive: true });
fs.mkdirSync(OBJECTS_DIR,   { recursive: true });

const objectPath     = (id: string) => path.join(OBJECTS_DIR, `${id}.arobject`);
const objectMetaPath = (id: string) => path.join(OBJECTS_DIR, `${id}.object.json`);
function readObjectMeta(id: string): AnchorObjectMeta | undefined {
  try {
    if (!fs.existsSync(objectMetaPath(id)) || !fs.existsSync(objectPath(id))) return undefined;
    return JSON.parse(fs.readFileSync(objectMetaPath(id), 'utf8')) as AnchorObjectMeta;
  } catch { return undefined; }
}

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
    createdBy: body.createdBy,
    // C1: chamber configuration (validated — an unknown id is dropped, not stored)
    ...(typeof body.configId === 'string' && body.configId.trim()
        && chamberConfigStore.findById(body.configId.trim())
        ? { configId: body.configId.trim() } : {}),
    // B2: origin source — 'object' is a declared intent at creation (the scan
    // comes next); sessions fall back to map/QR until the scan exists.
    ...(body.originSource === 'object' ? { originSource: 'object' as const } : {}),
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

// B1: derived read-only field — when the author sealed the world map (see
// worldmap/meta below). Computed from files so the store never carries it.
function withMapSealed(anchor: Anchor): Anchor {
  const meta = readWorldMapMeta(anchor.id);
  const obj  = readObjectMeta(anchor.id);
  const sealed = !!meta.anchorPose && fs.existsSync(path.join(WORLDMAPS_DIR, `${anchor.id}.worldmap`));
  return {
    ...anchor,
    ...(sealed && { mapSealedAt: meta.capturedAt }),
    ...(obj?.scannedAt && { objectScannedAt: obj.scannedAt }),
  };
}

// ── GET /anchors — list all anchors ───────────────────────────────────────────
router.get('/', (_req: Request, res: Response) => {
  const anchors = anchorStore.findAll().map(withMapSealed);
  return res.json({
    data: anchors,
    timestamp: new Date().toISOString(),
  });
});

// ── GET /anchors/:id/emit — the assembly-level .tag envelope ─────────────────
// Signed Ed25519 emission for the chamber: chamber streams + a member manifest
// carrying the SHA-256 of every part envelope beneath it (Merkle-style tree).
// Registered BEFORE /:id so "emit" isn't swallowed by the param route.
router.get('/:id/emit', (req: Request, res: Response) => {
  const envelope = buildAssemblyEnvelope(req.params.id);
  if (!envelope) {
    return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  }
  if (req.query.download) {
    const safe = envelope.payload.subject.label.replace(/[^\w.-]+/g, '_').slice(0, 60) || envelope.payload.subject.id;
    res.setHeader('Content-Disposition', `attachment; filename="${safe}.tag"`);
  }
  res.setHeader('Content-Type', 'application/json');
  return res.json(envelope);
});

// ── GET /anchors/:id/subscribe — the continuous emitter (SSE) ────────────────
// Live per-chamber push (spec §7): `state` on connect, `changed` whenever the
// assembly envelope moves, naming the exact streams/members that changed so
// readers re-fetch only the delta. Registered BEFORE /:id.
router.get('/:id/subscribe', (req: Request, res: Response) => {
  if (!subscribeToAnchor(req.params.id, res)) {
    res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  }
});

// ── Presence (P1) — who is in front of this chamber right now ───────────────
// In-memory heartbeat, ~2×/s per device, fanned out on /:id/subscribe as
// `presence` / `presence:joined` / `presence:left`. Registered BEFORE /:id.
router.post('/:id/presence', (req: Request, res: Response) => {
  if (!anchorStore.findById(req.params.id)) {
    return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  }
  const v = validatePresenceUpdate(req.body);
  if (v.ok === false) return res.status(400).json({ error: v.error, timestamp: new Date().toISOString() });
  // A signed-in UAM user can't impersonate a colleague: the name follows the token.
  const u = currentUamUser(req);
  if (u) { v.value.name = u.name || v.value.name; v.value.role = u.role; }
  const entry = updatePresence(req.params.id, v.value);
  return res.json({ data: entry, others: listPresence(req.params.id).filter(e => e.userId !== entry.userId), timestamp: entry.updatedAt });
});

router.get('/:id/presence', (req: Request, res: Response) => {
  if (!anchorStore.findById(req.params.id)) {
    return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  }
  return res.json({ data: listPresence(req.params.id), timestamp: new Date().toISOString() });
});

router.delete('/:id/presence/:userId', (req: Request, res: Response) => {
  leavePresence(req.params.id, req.params.userId);
  return res.json({ data: { ok: true }, timestamp: new Date().toISOString() });
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
  return res.json({ data: withMapSealed(anchor), timestamp: new Date().toISOString() });
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

// ── World-map meta: the sealed origin (B1, 2026.4.46) ─────────────────────────
// Doctrine for every anchor-scoped AR surface: the AUTHOR's world map is the
// origin; the QR is the key and a drift check. The meta file records the
// gravity-normalised QR pose *as seen in the sealed map's frame*, so an
// operator who relocalizes into the map can place `anchor_rel` tags from the
// author's pose instead of from a fresh (±5–15 mm, tilt-noisy) QR estimate.
// Same shape as the guide `referenceCameraPose` meta.
//
//   POST /anchors/:id/worldmap/meta  { anchorPose: number[16], capturedAt?, sealedBy? }
//   GET  /anchors/:id/worldmap/meta  → { anchorPose?, capturedAt?, sealedBy?, sealed: boolean }
//
// Uploading the map without meta (older app builds) leaves the anchor
// unsealed — the app keeps today's QR-origin behaviour for it.
export function worldMapMetaPath(anchorId: string): string {
  return path.join(WORLDMAPS_DIR, `${anchorId}.anchorpose.json`);
}

export interface WorldMapMeta {
  anchorPose?: number[];
  capturedAt?: string;
  sealedBy?:   string;
}

export function readWorldMapMeta(anchorId: string): WorldMapMeta {
  try {
    const p = worldMapMetaPath(anchorId);
    if (!fs.existsSync(p)) return {};
    const m = JSON.parse(fs.readFileSync(p, 'utf8')) as WorldMapMeta;
    return Array.isArray(m.anchorPose) && m.anchorPose.length === 16 ? m : {};
  } catch { return {}; }
}

router.post('/:id/worldmap/meta', express.json(), (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  }
  const { anchorPose, capturedAt, sealedBy } = (req.body ?? {}) as Partial<WorldMapMeta>;
  if (!Array.isArray(anchorPose) || anchorPose.length !== 16 ||
      !anchorPose.every(v => typeof v === 'number' && Number.isFinite(v))) {
    return res.status(400).json({ error: 'anchorPose must be 16 finite numbers (column-major 4×4)', timestamp: new Date().toISOString() });
  }
  const meta: WorldMapMeta = {
    anchorPose,
    capturedAt: typeof capturedAt === 'string' && capturedAt ? capturedAt : new Date().toISOString(),
    ...(typeof sealedBy === 'string' && sealedBy.trim() && { sealedBy: sealedBy.trim().slice(0, 80) }),
  };
  try {
    fs.writeFileSync(worldMapMetaPath(anchor.id), JSON.stringify(meta));
  } catch (err) {
    return res.status(500).json({ error: `Failed to store world map meta: ${err}`, timestamp: new Date().toISOString() });
  }
  const hasMap = fs.existsSync(path.join(WORLDMAPS_DIR, `${anchor.id}.worldmap`));
  console.log(`[SIB] World map sealed for anchor ${anchor.id} (${meta.capturedAt}${meta.sealedBy ? ` by ${meta.sealedBy}` : ''}${hasMap ? '' : ' — map not uploaded yet'})`);
  return res.status(201).json({ data: { ...meta, sealed: hasMap }, timestamp: new Date().toISOString() });
});

// ── DELETE /anchors/:id/worldmap — G1 (2026.4.46): unseal ────────────────────
// Removes the map AND the sealed origin. Tags stay (they are QR-relative and
// still valid); the next Author scan re-seals. Technicians can't.
router.delete('/:id/worldmap', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  }
  const actor = currentUamUser(req);
  if (uamIsActive() && actor && actor.role === 'technician') {
    return res.status(403).json({ error: 'Unsealing a world map requires Engineer role or above', timestamp: new Date().toISOString() });
  }
  let removed = 0;
  for (const p of [path.join(WORLDMAPS_DIR, `${anchor.id}.worldmap`), worldMapMetaPath(anchor.id)]) {
    try { fs.unlinkSync(p); removed++; } catch { /* not present */ }
  }
  logOpsEvent({ method: 'DELETE', path: `/anchors/${anchor.id}/worldmap`, outcome: 'allowed', ip: req.ip,
                detail: `unseal "${anchor.assetId}"${actor ? ` by ${actor.name}` : ''} · ${removed} file(s)` });
  console.log(`[SIB] World map unsealed for anchor ${anchor.id} (${removed} files)`);
  return res.json({ data: { anchorId: anchor.id, removed, sealed: false }, timestamp: new Date().toISOString() });
});

// Client caches need nothing server-side: WorldMapCache compares the meta's
// capturedAt; after an unseal GET …/meta has none, so a fresh map downloads.

// ── B1 (2026.4.46): ARKit reference object per chamber ────────────────────────
// The Author scans the chamber once on the iPad (ARObjectScanningConfiguration
// — entirely on-device); the resulting ARReferenceObject archive is stored
// here and cached by the app, so detection runs offline too. It is a sparse
// feature-point cloud, not a mesh or a photo. Meta rides in the query string
// because the body is the raw binary (streamed, like world maps).
//
//   POST   /anchors/:id/object?extent=x,y,z&center=x,y,z&featurePoints=N&scannedBy=…
//   GET    /anchors/:id/object            → application/octet-stream
//   GET    /anchors/:id/object/meta       → AnchorObjectMeta | 404
//   DELETE /anchors/:id/object            → engineer+
const MAX_OBJECT_BYTES = 30 * 1024 * 1024;

router.post('/:id/object', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  }
  const actor = currentUamUser(req);
  if (uamIsActive() && actor && actor.role === 'technician') {
    return res.status(403).json({ error: 'Scanning an object requires Engineer role or above', timestamp: new Date().toISOString() });
  }
  const triple = (v: unknown) => {
    if (typeof v !== 'string') return undefined;
    const p = v.split(',').map(Number);
    return p.length === 3 && p.every(Number.isFinite) ? { x: p[0], y: p[1], z: p[2] } : undefined;
  };
  const q = req.query;
  const finalPath = objectPath(anchor.id);
  const tmpPath   = `${finalPath}.tmp-${Date.now()}`;
  const ws = fs.createWriteStream(tmpPath);
  let bytes = 0, aborted = false;
  const cleanup = () => fs.unlink(tmpPath, () => { /* best-effort */ });
  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    bytes += chunk.length;
    if (bytes > MAX_OBJECT_BYTES) {
      aborted = true; ws.destroy(); cleanup();
      if (!res.headersSent) res.status(413).json({ error: `Object exceeds ${MAX_OBJECT_BYTES} bytes`, timestamp: new Date().toISOString() });
      req.destroy();
    }
  });
  req.on('error', () => { aborted = true; ws.destroy(); cleanup(); if (!res.headersSent) res.status(400).json({ error: 'Upload stream error' }); });
  ws.on('error', (err) => { aborted = true; cleanup(); if (!res.headersSent) res.status(500).json({ error: `Failed to store object: ${err}` }); });
  ws.on('finish', () => {
    if (aborted) return;
    if (bytes === 0) { cleanup(); return res.status(400).json({ error: 'Body must be the .arobject archive', timestamp: new Date().toISOString() }); }
    fs.rename(tmpPath, finalPath, (err) => {
      if (err) { cleanup(); return res.status(500).json({ error: `Failed to store object: ${err}`, timestamp: new Date().toISOString() }); }
      const meta: AnchorObjectMeta = {
        scannedAt: new Date().toISOString(),
        ...(typeof q.scannedBy === 'string' && q.scannedBy.trim() && { scannedBy: q.scannedBy.trim().slice(0, 80) }),
        ...(triple(q.extent) && { extent: triple(q.extent) }),
        ...(triple(q.center) && { center: triple(q.center) }),
        ...(typeof q.featurePoints === 'string' && Number.isFinite(Number(q.featurePoints)) && { featurePoints: Number(q.featurePoints) }),
        sizeBytes: bytes,
      };
      try { fs.writeFileSync(objectMetaPath(anchor.id), JSON.stringify(meta)); } catch { /* non-fatal */ }
      logOpsEvent({ method: 'POST', path: `/anchors/${anchor.id}/object`, outcome: 'allowed', ip: req.ip,
                    detail: `object scan "${anchor.assetId}"${actor ? ` by ${actor.name}` : ''} · ${(bytes / 1024).toFixed(0)} KB · ${meta.featurePoints ?? '?'} pts` });
      console.log(`[SIB] Reference object stored for anchor ${anchor.id} (${bytes} bytes)`);
      return res.status(201).json({ data: { anchorId: anchor.id, ...meta }, timestamp: new Date().toISOString() });
    });
  });
  req.pipe(ws);
});

router.get('/:id/object', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  if (!fs.existsSync(objectPath(anchor.id))) {
    return res.status(404).json({ error: `No reference object for anchor ${anchor.id}`, timestamp: new Date().toISOString() });
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  return res.sendFile(objectPath(anchor.id));
});

router.get('/:id/object/meta', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  const meta = readObjectMeta(anchor.id);
  if (!meta) return res.status(404).json({ error: `No reference object for anchor ${anchor.id}`, timestamp: new Date().toISOString() });
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ data: meta, timestamp: new Date().toISOString() });
});

// B2: calibration — the object's pose in the QR frame, written by an Author
// session that saw both. Sixteen finite numbers, column-major.
router.patch('/:id/object/meta', express.json(), (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  const meta = readObjectMeta(anchor.id);
  if (!meta) return res.status(404).json({ error: `No reference object for anchor ${anchor.id}`, timestamp: new Date().toISOString() });
  const { objectPoseInQR } = (req.body ?? {}) as { objectPoseInQR?: unknown };
  if (!Array.isArray(objectPoseInQR) || objectPoseInQR.length !== 16 ||
      !objectPoseInQR.every(v => typeof v === 'number' && Number.isFinite(v))) {
    return res.status(400).json({ error: 'objectPoseInQR must be 16 finite numbers (column-major 4×4)', timestamp: new Date().toISOString() });
  }
  const next: AnchorObjectMeta = { ...meta, objectPoseInQR, calibratedAt: new Date().toISOString() };
  try { fs.writeFileSync(objectMetaPath(anchor.id), JSON.stringify(next)); }
  catch (err) { return res.status(500).json({ error: `Failed to store calibration: ${err}`, timestamp: new Date().toISOString() }); }
  console.log(`[SIB] Object calibrated to QR frame for anchor ${anchor.id}`);
  return res.json({ data: next, timestamp: new Date().toISOString() });
});

router.delete('/:id/object', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  const actor = currentUamUser(req);
  if (uamIsActive() && actor && actor.role === 'technician') {
    return res.status(403).json({ error: 'Removing an object scan requires Engineer role or above', timestamp: new Date().toISOString() });
  }
  let removed = 0;
  for (const p of [objectPath(anchor.id), objectMetaPath(anchor.id)]) { try { fs.unlinkSync(p); removed++; } catch { /* absent */ } }
  logOpsEvent({ method: 'DELETE', path: `/anchors/${anchor.id}/object`, outcome: 'allowed', ip: req.ip,
                detail: `remove object scan "${anchor.assetId}"${actor ? ` by ${actor.name}` : ''}` });
  return res.json({ data: { anchorId: anchor.id, removed }, timestamp: new Date().toISOString() });
});

router.get('/:id/worldmap/meta', (req: Request, res: Response) => {
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) {
    return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: new Date().toISOString() });
  }
  const meta = readWorldMapMeta(anchor.id);
  const hasMap = fs.existsSync(path.join(WORLDMAPS_DIR, `${anchor.id}.worldmap`));
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ data: { ...meta, sealed: hasMap && !!meta.anchorPose }, timestamp: new Date().toISOString() });
});

// ── DELETE /anchors — cascade-delete ALL anchors + tags + pass-states ────────
router.delete('/', (_req: Request, res: Response) => {
  const anchors = anchorStore.findAll();
  let deletedAnchors = 0;
  let deletedTags = 0;
  let deletedPassStates = 0;

  for (const anchor of anchors) {
    const tags = tagStore.findAll().filter(t => t.anchorId === anchor.id);
    for (const tag of tags) {
      const ps = findPassStateByTag(tag.id);
      if (ps) { passStateStore.delete(ps.id); deletedPassStates++; }
      tagStore.delete(tag.id);
      deletedTags++;
    }
    anchorStore.delete(anchor.id);
    deletedAnchors++;

    // Clean up binary blobs
    const qrPath  = path.join(QRIMAGES_DIR,  `${anchor.id}.png`);
    const mapPath = path.join(WORLDMAPS_DIR, `${anchor.id}.worldmap`);
    try { fs.unlinkSync(qrPath);  } catch { /* not present */ }
    try { fs.unlinkSync(mapPath); } catch { /* not present */ }
    try { fs.unlinkSync(worldMapMetaPath(anchor.id)); } catch { /* not present */ }
    try { fs.unlinkSync(objectPath(anchor.id)); } catch { /* not present */ }
    try { fs.unlinkSync(objectMetaPath(anchor.id)); } catch { /* not present */ }
  }

  console.log(
    `[SIB] Deleted all ${deletedAnchors} anchor(s) ` +
    `(+${deletedTags} tags, +${deletedPassStates} pass-states)`
  );

  return res.json({
    data: { deleted: deletedAnchors, deletedTags, deletedPassStates },
    timestamp: new Date().toISOString(),
  });
});

// ── DELETE /anchors/:id — cascade-delete anchor + tags + pass-states ──────────
// ── PATCH /anchors/:id — C1: rename / assign chamber configuration ─────────────
// Body: { assetId?, configId? } — configId null clears. Engineer+ (technicians
// never edit anchors). Nothing spatial changes: pins, world map, tags stay.
router.patch('/:id', (req: Request, res: Response) => {
  const now = new Date().toISOString();
  const anchor = anchorStore.findById(req.params.id);
  if (!anchor) return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: now });
  const actor = currentUamUser(req);
  if (uamIsActive() && actor && actor.role === 'technician') {
    return res.status(403).json({ error: 'Editing an anchor requires Engineer role or above', timestamp: now });
  }
  const body = (req.body ?? {}) as UpdateAnchorRequest;
  const updated: Anchor = { ...anchor, updatedAt: now };
  if (typeof body.assetId === 'string') {
    const a = body.assetId.trim();
    if (!a) return res.status(400).json({ error: 'assetId cannot be empty', timestamp: now });
    if (a.toLowerCase() !== anchor.assetId.toLowerCase()) updated.assetId = ensureUniqueAssetId(a);
  }
  if ('configId' in body) {
    if (body.configId === null || body.configId === '') {
      delete updated.configId;
    } else if (typeof body.configId === 'string') {
      if (!chamberConfigStore.findById(body.configId)) {
        return res.status(404).json({ error: `Configuration ${body.configId} not found`, timestamp: now });
      }
      updated.configId = body.configId;
    }
  }
  // B2: origin source
  if ('originSource' in body) {
    if (body.originSource === 'object') {
      updated.originSource = 'object';
    } else if (body.originSource === 'worldMap' || body.originSource === undefined) {
      delete updated.originSource;
    } else {
      return res.status(400).json({ error: "originSource must be 'worldMap' or 'object'", timestamp: now });
    }
  }
  anchorStore.save(updated);
  return res.json({ data: withMapSealed(updated), timestamp: now });
});

// ── POST /anchors/:id/duplicate — template copy (U3, 2026.4.45) ───────────────
//
// Body: { assetId?, createdBy? }. Creates a NEW anchor (new id, new QR, its
// own encryption key) that carries the source's metadata, anchor type, QR
// size and 3D model kit membership, then copies every guide onto it via the
// U2 copy (steps + media + model assignments; pins, placement and validation
// training cleared). The world map, tags, loc-tags and LOTO points are NOT
// copied — they describe the source's physical location. The author scans
// the new tool's world map and re-places the steps.
router.post('/:id/duplicate', (req: Request, res: Response) => {
  const now    = new Date().toISOString();
  const source = anchorStore.findById(req.params.id);
  if (!source) {
    return res.status(404).json({ error: `Anchor ${req.params.id} not found`, timestamp: now });
  }
  const actor = currentUamUser(req);
  if (uamIsActive() && actor && actor.role === 'technician') {
    return res.status(403).json({ error: 'Duplicating an anchor requires Engineer role or above', timestamp: now });
  }
  const body = (req.body ?? {}) as { assetId?: unknown; createdBy?: unknown };
  const wanted = typeof body.assetId === 'string' && body.assetId.trim()
    ? body.assetId.trim() : `${source.assetId} copy`;
  const createdBy = typeof body.createdBy === 'string' && body.createdBy.trim()
    ? body.createdBy.trim() : (actor?.name ?? source.createdBy ?? 'author');

  const anchor: Anchor = {
    id:               uuidv4(),
    assetId:          ensureUniqueAssetId(wanted),
    coordinateSystem: source.coordinateSystem,
    position:         source.position,
    rotation:         source.rotation,
    metadata:         { ...source.metadata, duplicatedFrom: source.id },
    encryptionKey:    randomBytes(32).toString('base64'),   // never share a key between tools
    qrSizeCm:         source.qrSizeCm,
    anchorType:       source.anchorType,
    ...(source.configId ? { configId: source.configId } : {}),   // C1: same configuration
    createdBy,
    createdAt:        now,
    updatedAt:        now,
  };
  anchorStore.save(anchor);
  generateAndStoreQRImage(anchor).catch(err =>
    console.error(`[SIB] QR image generation failed for ${anchor.id}: ${err}`)
  );

  // Model kit: every model assigned to the source is assigned to the copy.
  let kitCount = 0;
  for (const m of model3DStore.findAll()) {
    const inKit = (m.anchorIds ?? []).includes(source.id) || m.anchorId === source.id;
    if (!inKit) continue;
    const ids = new Set([...(m.anchorIds ?? []), ...(m.anchorId ? [m.anchorId] : [])]);
    ids.add(anchor.id);
    model3DStore.save({ ...m, anchorIds: [...ids], updatedAt: now });
    kitCount++;
  }

  // Guides: U2 copy for each (drafts, unplaced, untrained).
  const guides = guideStore.findAll().filter(g => g.anchorId === source.id);
  let stepCount = 0;
  for (const g of guides) {
    const r = copyGuideToAnchor(g, { targetAnchorId: anchor.id, name: g.name, createdBy });
    stepCount += r.steps.length;
  }

  console.log(`[SIB] Anchor duplicated: ${source.id} → ${anchor.id} ("${anchor.assetId}"): ${guides.length} guides / ${stepCount} steps, ${kitCount} kit models`);
  const resp = {
    data: { ...anchor, copied: { guides: guides.length, steps: stepCount, kitModels: kitCount } },
    timestamp: now,
  };
  return res.status(201).json(resp);
});

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
  try { fs.unlinkSync(worldMapMetaPath(req.params.id)); } catch { /* not present */ }
  try { fs.unlinkSync(objectPath(req.params.id)); } catch { /* not present */ }
  try { fs.unlinkSync(objectMetaPath(req.params.id)); } catch { /* not present */ }

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
