// guides.ts — AR OMS Phase 1: Guide + Step routes
//
// Endpoints:
//   POST   /guides                           — Author: create a Guide
//   POST   /guides/import                    — Import a guide from an InstructionsSourceAdapter
//   GET    /guides?anchorId=xxx              — List published guides for an anchor
//   GET    /guides?anchorId=xxx&all=true     — List all guides (drafts + published) for Authors
//   GET    /guides/:id                       — Get a single Guide
//   PATCH  /guides/:id                       — Author: update name, description, published flag
//   DELETE /guides/:id                       — Author: cascade-delete Guide + all Steps
//   GET    /guides/:id/steps                 — List steps in sequence order
//   POST   /guides/:id/steps                 — Author: create a Step (with optional image)
//   PATCH  /guides/:id/steps/:stepId         — Author: update Step text / sequence / media
//   DELETE /guides/:id/steps/:stepId         — Author: delete a single Step
//   GET    /guides/step-image/:filename      — Serve a step media image

import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs   from 'fs';
import path from 'path';
import https from 'https';
import http  from 'http';
import type {
  Guide,
  GuideStep,
  CreateGuideRequest,
  UpdateGuideRequest,
  CreateGuideStepRequest,
  UpdateGuideStepRequest,
  ImportGuideRequest,
  ImportGuideResult,
  ApiResponse,
} from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import {
  getInstructionsSourceAdapter,
  getActiveInstructionsSourceAdapter,
} from '../adapters/instructions-source-adapter.js';

// ── Storage ───────────────────────────────────────────────────────────────────

export const guideStore     = new JsonFileStore<Guide>('guides');
export const guideStepStore = new JsonFileStore<GuideStep>('guide-steps');

const DATA_DIR         = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const STEP_IMG_DIR     = path.join(DATA_DIR, 'guide-step-images');
fs.mkdirSync(STEP_IMG_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function saveStepImage(guideId: string, stepId: string, base64: string): string {
  const date   = new Date();
  const stamp  = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
  const filename = `${guideId}_${stepId}_${stamp}.jpg`;
  const buf    = Buffer.from(base64, 'base64');
  fs.writeFileSync(path.join(STEP_IMG_DIR, filename), buf);
  return filename;
}

function deleteStepImage(filename: string): void {
  try {
    fs.unlinkSync(path.join(STEP_IMG_DIR, filename));
  } catch { /* not present — ignore */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Download a remote image URL and return its bytes as a Buffer.
 * Supports http and https. Follows up to 3 redirects.
 * Resolves with null on any network / HTTP error so the caller can treat
 * image failures as non-fatal.
 */
function downloadUrl(url: string, redirectsLeft = 3): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { timeout: 15_000 }, (res) => {
      // Follow redirects
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location && redirectsLeft > 0) {
        resolve(downloadUrl(res.headers.location, redirectsLeft - 1));
        return;
      }
      if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
        console.warn(`[SIB] Image download failed (${res.statusCode}): ${url}`);
        resolve(null);
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', () => resolve(null));
    });
    req.on('error',   () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// POST /guides/import — import a guide from an InstructionsSourceAdapter
//
// MUST be registered before /:id routes so the literal "import" path is not
// treated as a guide id by Express.
//
// Body: ImportGuideRequest { anchorId, createdBy, sourceType?, payload }
// The adapter identified by sourceType (default: active adapter) is called
// with `payload`. It returns an ImportedGuide which is then persisted as a
// new Guide + GuideSteps. Images referenced by imageUrl are downloaded and
// stored locally. Graph links (nextOnSuccessSeq etc.) are resolved to real
// step UUIDs in a second pass after all steps are created.
router.post('/import', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as ImportGuideRequest;

  if (!body.anchorId || !body.createdBy || !body.payload) {
    res.status(400).json({
      error: 'anchorId, createdBy, and payload are required',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Select adapter
  const adapter = body.sourceType
    ? getInstructionsSourceAdapter(body.sourceType)
    : getActiveInstructionsSourceAdapter();

  if (!adapter) {
    res.status(400).json({
      error: `No InstructionsSourceAdapter found for sourceType "${body.sourceType ?? 'active'}"`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Fetch the normalised ImportedGuide from the adapter
  let imported;
  try {
    imported = await adapter.fetchGuide(body.payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[SIB] Import adapter error:', err);
    res.status(422).json({
      error: `Adapter error: ${msg}`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (!imported.steps || imported.steps.length === 0) {
    res.status(422).json({
      error: 'ImportedGuide must contain at least one step',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const now     = new Date().toISOString();
  const guideId = uuidv4();

  // ── Create the Guide record ────────────────────────────────────────────────
  const guide: Guide = {
    id:          guideId,
    anchorId:    body.anchorId,
    name:        imported.name.trim(),
    description: imported.description?.trim() ?? '',
    published:   false,   // always starts as draft — Author must publish
    createdBy:   body.createdBy,
    createdAt:   now,
    updatedAt:   now,
  };
  guideStore.save(guide);
  console.log(`[SIB] Guide imported (${adapter.name}): ${guideId} ("${guide.name}") — ${imported.steps.length} steps`);

  // ── First pass: assign UUIDs and build seq→id map ─────────────────────────
  const seqToId = new Map<number, string>();
  const stepIds: string[] = [];
  for (const s of imported.steps) {
    const stepId = uuidv4();
    seqToId.set(s.sequenceNumber, stepId);
    stepIds.push(stepId);
  }

  // ── Download images in parallel (non-fatal) ────────────────────────────────
  const imageErrors: string[] = [];
  const imageBuffers = await Promise.all(
    imported.steps.map(async (s) => {
      if (!s.imageUrl) return null;
      const buf = await downloadUrl(s.imageUrl);
      if (!buf) {
        imageErrors.push(s.imageUrl);
        return null;
      }
      return buf;
    }),
  );

  // ── Create GuideStep records ───────────────────────────────────────────────
  const createdSteps: GuideStep[] = [];

  for (let i = 0; i < imported.steps.length; i++) {
    const s      = imported.steps[i];
    const stepId = stepIds[i];

    // Save downloaded image (if any)
    let mediaPath: string | undefined;
    const buf = imageBuffers[i];
    if (buf) {
      try {
        const date     = new Date();
        const stamp    = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2,'0')}${String(date.getDate()).padStart(2,'0')}_${String(date.getHours()).padStart(2,'0')}${String(date.getMinutes()).padStart(2,'0')}${String(date.getSeconds()).padStart(2,'0')}`;
        const filename = `${guideId}_${stepId}_${stamp}.jpg`;
        fs.writeFileSync(path.join(STEP_IMG_DIR, filename), buf);
        mediaPath = filename;
      } catch (err) {
        console.error(`[SIB] Failed to save imported image for step ${stepId}:`, err);
        imageErrors.push(s.imageUrl ?? '(write error)');
      }
    }

    // Resolve sequence-number graph refs to real UUIDs
    const nextOnSuccess = s.nextOnSuccessSeq !== undefined ? seqToId.get(s.nextOnSuccessSeq) : undefined;
    const nextOnFailure = s.nextOnFailureSeq !== undefined ? seqToId.get(s.nextOnFailureSeq) : undefined;
    const precondition  = s.preconditionSeq  !== undefined ? seqToId.get(s.preconditionSeq)  : undefined;

    const step: GuideStep = {
      id:                 stepId,
      guideId,
      anchorId:           body.anchorId,
      sequenceNumber:     s.sequenceNumber,
      title:              s.title?.trim()   || undefined,
      text:               s.text.trim(),
      ttsText:            s.ttsText?.trim() || undefined,
      mediaType:          mediaPath ? 'image' : undefined,
      mediaPath,
      completionRequired: s.completionRequired ?? true,
      isPlaced:           false,   // spatial placement done separately in AR
      nextOnSuccess,
      nextOnFailure,
      precondition,
      createdAt:          now,
      updatedAt:          now,
    };

    guideStepStore.save(step);
    createdSteps.push(step);
  }

  console.log(`[SIB] Imported ${createdSteps.length} steps for guide ${guideId}` +
    (imageErrors.length ? ` (${imageErrors.length} image error(s))` : ''));

  const result: ImportGuideResult = { guide, steps: createdSteps, imageErrors };
  const resp: ApiResponse<ImportGuideResult> = { data: result, timestamp: now };
  res.status(201).json(resp);
});

// GET /guides/step-image/:filename — serve a step media image
// IMPORTANT: must be registered BEFORE /:id routes to avoid "step-image" matching as an id.
router.get('/step-image/:filename', (req: Request, res: Response): void => {
  const filename = req.params.filename;
  if (filename.includes('..') || filename.includes('/')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }
  const filePath = path.join(STEP_IMG_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Step image not found' });
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

// POST /guides — Author creates a new Guide
router.post('/', (req: Request, res: Response): void => {
  const body = req.body as CreateGuideRequest;

  if (!body.anchorId || !body.name?.trim() || !body.createdBy) {
    res.status(400).json({
      error: 'anchorId, name, and createdBy are required',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const now = new Date().toISOString();
  const guide: Guide = {
    id:          uuidv4(),
    anchorId:    body.anchorId,
    name:        body.name.trim(),
    description: body.description?.trim() ?? '',
    published:   false,   // always starts as draft
    createdBy:   body.createdBy,
    createdAt:   now,
    updatedAt:   now,
  };

  guideStore.save(guide);
  console.log(`[SIB] Guide created: ${guide.id} ("${guide.name}") for anchor ${body.anchorId}`);

  const resp: ApiResponse<Guide> = { data: guide, timestamp: now };
  res.status(201).json(resp);
});

// GET /guides?anchorId=xxx — list guides for an anchor
// ?all=true  → include drafts (Author view)
// (default)  → published only (Operator view)
router.get('/', (req: Request, res: Response): void => {
  const { anchorId, all } = req.query;

  if (!anchorId || typeof anchorId !== 'string') {
    res.status(400).json({
      error: 'anchorId query parameter is required',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  let guides = guideStore
    .findAll()
    .filter(g => g.anchorId === anchorId);

  if (all !== 'true') {
    guides = guides.filter(g => g.published);
  }

  // Sort by name for consistent ordering
  guides.sort((a, b) => a.name.localeCompare(b.name));

  const resp: ApiResponse<Guide[]> = {
    data:      guides,
    timestamp: new Date().toISOString(),
  };
  res.json(resp);
});

// GET /guides/:id — get a single Guide
router.get('/:id', (req: Request, res: Response): void => {
  const guide = guideStore.findById(req.params.id);
  if (!guide) {
    res.status(404).json({
      error: `Guide ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.json({ data: guide, timestamp: new Date().toISOString() });
});

// PATCH /guides/:id — Author updates name, description, or published flag
router.patch('/:id', (req: Request, res: Response): void => {
  const guide = guideStore.findById(req.params.id);
  if (!guide) {
    res.status(404).json({
      error: `Guide ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const body = req.body as UpdateGuideRequest;
  const now  = new Date().toISOString();

  const updated: Guide = {
    ...guide,
    name:        body.name?.trim()        ?? guide.name,
    description: body.description != null ? body.description.trim() : guide.description,
    published:   body.published    != null ? body.published           : guide.published,
    updatedAt:   now,
  };

  guideStore.save(updated);
  console.log(`[SIB] Guide updated: ${guide.id} (published=${updated.published})`);

  const resp: ApiResponse<Guide> = { data: updated, timestamp: now };
  res.json(resp);
});

// DELETE /guides/:id — cascade-delete guide + all its steps
router.delete('/:id', (req: Request, res: Response): void => {
  const guide = guideStore.findById(req.params.id);
  if (!guide) {
    res.status(404).json({
      error: `Guide ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const steps = guideStepStore.findAll().filter(s => s.guideId === req.params.id);
  for (const step of steps) {
    if (step.mediaPath) deleteStepImage(step.mediaPath);
    guideStepStore.delete(step.id);
  }
  guideStore.delete(req.params.id);

  console.log(`[SIB] Guide deleted: ${req.params.id} (+${steps.length} steps)`);
  res.status(204).send();
});

// GET /guides/:id/steps — list steps in ascending sequenceNumber order
router.get('/:id/steps', (req: Request, res: Response): void => {
  const guide = guideStore.findById(req.params.id);
  if (!guide) {
    res.status(404).json({
      error: `Guide ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const steps = guideStepStore
    .findAll()
    .filter(s => s.guideId === req.params.id)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const resp: ApiResponse<GuideStep[]> = {
    data:      steps,
    timestamp: new Date().toISOString(),
  };
  res.json(resp);
});

// POST /guides/:id/steps — Author adds a step to a Guide
router.post('/:id/steps', (req: Request, res: Response): void => {
  const guide = guideStore.findById(req.params.id);
  if (!guide) {
    res.status(404).json({
      error: `Guide ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const body = req.body as CreateGuideStepRequest;

  if (!body.text?.trim()) {
    res.status(400).json({
      error: 'text is required for a step',
      timestamp: new Date().toISOString(),
    });
    return;
  }
  if (typeof body.sequenceNumber !== 'number' || body.sequenceNumber < 1) {
    res.status(400).json({
      error: 'sequenceNumber must be a positive integer',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const now    = new Date().toISOString();
  const stepId = uuidv4();

  let mediaPath: string | undefined;
  if (body.mediaBase64 && body.mediaType === 'image') {
    try {
      mediaPath = saveStepImage(guide.id, stepId, body.mediaBase64);
    } catch (err) {
      console.error('[SIB] Failed to save step image:', err);
      res.status(500).json({
        error: 'Failed to save step image',
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }

  const step: GuideStep = {
    id:                 stepId,
    guideId:            guide.id,
    anchorId:           guide.anchorId,
    sequenceNumber:     body.sequenceNumber,
    title:              body.title?.trim() || undefined,
    text:               body.text.trim(),
    ttsText:            body.ttsText?.trim(),
    mediaType:          body.mediaType,
    mediaPath,
    completionRequired: body.completionRequired ?? true,
    // Phase 2: spatial placement — new steps start unplaced
    isPlaced:           false,
    createdAt:          now,
    updatedAt:          now,
  };

  guideStepStore.save(step);

  // If the guide was published, adding a new (unplaced) step reverts it to draft
  // so Authors must re-place and re-publish before Operators see it.
  if (guide.published) {
    guideStore.update(guide.id, { published: false, updatedAt: now });
    console.log(`[SIB] Guide ${guide.id} reverted to draft (new step added to published guide)`);
  } else {
    guideStore.update(guide.id, { updatedAt: now });
  }

  console.log(`[SIB] GuideStep created: ${stepId} (seq=${body.sequenceNumber}) in guide ${guide.id}`);

  const resp: ApiResponse<GuideStep> = { data: step, timestamp: now };
  res.status(201).json(resp);
});

// PATCH /guides/:id/steps/:stepId — Author updates a step
router.patch('/:id/steps/:stepId', (req: Request, res: Response): void => {
  const guide = guideStore.findById(req.params.id);
  if (!guide) {
    res.status(404).json({
      error: `Guide ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const step = guideStepStore.findById(req.params.stepId);
  if (!step || step.guideId !== req.params.id) {
    res.status(404).json({
      error: `Step ${req.params.stepId} not found in guide ${req.params.id}`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const body = req.body as UpdateGuideStepRequest;
  const now  = new Date().toISOString();

  let mediaPath = step.mediaPath;

  // mediaBase64 === null or "" (empty string sentinel from iOS) → clear existing image
  if ((body.mediaBase64 === null || body.mediaBase64 === '') && step.mediaPath) {
    deleteStepImage(step.mediaPath);
    mediaPath = undefined;
  }
  // mediaBase64 is a new base64 string → replace image
  else if (typeof body.mediaBase64 === 'string' && body.mediaBase64.length > 0) {
    if (step.mediaPath) deleteStepImage(step.mediaPath);
    try {
      mediaPath = saveStepImage(guide.id, step.id, body.mediaBase64);
    } catch (err) {
      console.error('[SIB] Failed to save replacement step image:', err);
      res.status(500).json({
        error: 'Failed to save step image',
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }

  const updated: GuideStep = {
    ...step,
    sequenceNumber:     body.sequenceNumber     ?? step.sequenceNumber,
    title:              'title' in body ? (body.title?.trim() || undefined) : step.title,
    text:               body.text?.trim()       ?? step.text,
    ttsText:            'ttsText' in body       ? body.ttsText?.trim() : step.ttsText,
    completionRequired: body.completionRequired ?? step.completionRequired,
    mediaPath,
    // Phase 2: spatial placement fields (only update when explicitly provided)
    posX:               'posX'            in body ? body.posX            : step.posX,
    posY:               'posY'            in body ? body.posY            : step.posY,
    posZ:               'posZ'            in body ? body.posZ            : step.posZ,
    isPlaced:           'isPlaced'        in body ? (body.isPlaced ?? step.isPlaced) : step.isPlaced,
    positionSource:     'positionSource'  in body ? body.positionSource  : step.positionSource,
    // 3D model ghost overlay fields (only update when explicitly provided)
    // body.modelId may be null (explicit clear) — coerce null → undefined for the stored record
    modelId:            'modelId'         in body ? (body.modelId ?? undefined) : step.modelId,
    modelScale:         'modelScale'      in body ? body.modelScale       : step.modelScale,
    modelOpacity:       'modelOpacity'    in body ? body.modelOpacity     : step.modelOpacity,
    modelOffsetX:       'modelOffsetX'    in body ? body.modelOffsetX     : step.modelOffsetX,
    modelOffsetY:       'modelOffsetY'    in body ? body.modelOffsetY     : step.modelOffsetY,
    modelOffsetZ:       'modelOffsetZ'    in body ? body.modelOffsetZ     : step.modelOffsetZ,
    modelRotationY:     'modelRotationY'  in body ? body.modelRotationY   : step.modelRotationY,
    // Conditional task graph fields — null in body clears, key absent keeps existing
    nextOnSuccess:      'nextOnSuccess'   in body ? (body.nextOnSuccess ?? undefined) : step.nextOnSuccess,
    nextOnFailure:      'nextOnFailure'   in body ? (body.nextOnFailure ?? undefined) : step.nextOnFailure,
    precondition:       'precondition'    in body ? (body.precondition  ?? undefined) : step.precondition,
    updatedAt: now,
  };

  guideStepStore.save(updated);
  guideStore.update(guide.id, { updatedAt: now });

  console.log(`[SIB] GuideStep updated: ${step.id} in guide ${guide.id}`);

  const resp: ApiResponse<GuideStep> = { data: updated, timestamp: now };
  res.json(resp);
});

// DELETE /guides/:id/steps/:stepId — Author deletes a single step
router.delete('/:id/steps/:stepId', (req: Request, res: Response): void => {
  const guide = guideStore.findById(req.params.id);
  if (!guide) {
    res.status(404).json({
      error: `Guide ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const step = guideStepStore.findById(req.params.stepId);
  if (!step || step.guideId !== req.params.id) {
    res.status(404).json({
      error: `Step ${req.params.stepId} not found in guide ${req.params.id}`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (step.mediaPath) deleteStepImage(step.mediaPath);
  guideStepStore.delete(step.id);
  guideStore.update(guide.id, { updatedAt: new Date().toISOString() });

  console.log(`[SIB] GuideStep deleted: ${step.id} from guide ${guide.id}`);
  res.status(204).send();
});

export default router;
