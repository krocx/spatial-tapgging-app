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
import {
  getInstructionsSourceAdapter,
  getActiveInstructionsSourceAdapter,
} from '../adapters/instructions-source-adapter.js';
import {
  guideStore,
  guideStepStore,
  STEP_IMG_DIR,
  saveStepImage,
  deleteStepImage,
} from '../guides/store.js';
import { applyImportedGuide } from '../guides/ingest.js';
import { guideVisibleTo } from '../uam/guide-visibility.js';
import { currentUamUser, uamIsActive } from '../middleware/auth.js';
import { normalizeEmail } from '../uam/uam-core.js';
import { findUserByEmail } from './uam.js';
import { guideToProcedureMap, toMindmapRecord } from '../procedure/reverse-compiler.js';
import { boundGuideId } from '../procedure/export.js';
import { mindmapStore, mindmapAccessStore } from '../models/mindmap.model.js';
import { saveDesignerImage } from '../procedure/designer-images.js';

// ── Storage ───────────────────────────────────────────────────────────────────
// Stores live in ../guides/store.js so the ingestion service can share them
// without a circular import. Re-exported here because existing consumers
// (e.g. sse/guide-session.sse.ts) import them from this module.

export { guideStore, guideStepStore };

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

  // Persistence, image download and seq→UUID resolution all live in the shared
  // ingestion service, which the Procedure Designer export also calls. Keeping
  // one implementation matters most for the rule that a write must never
  // overwrite spatial placement — see sib/src/guides/ingest.ts.
  const applied = await applyImportedGuide(imported, {
    anchorId:  body.anchorId,
    createdBy: body.createdBy,
  });

  console.log(`[SIB] Guide imported (${adapter.name}): ${applied.guide.id} ("${applied.guide.name}") — ${applied.steps.length} steps`);

  const result: ImportGuideResult = {
    guide:       applied.guide,
    steps:       applied.steps,
    imageErrors: applied.imageErrors,
  };
  const resp: ApiResponse<ImportGuideResult> = { data: result, timestamp: new Date().toISOString() };
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

  // Per-user sharing (UAM): technicians see only guides shared with them
  // (or with everyone). Engineer+ and unidentified callers are unaffected.
  const viewer = currentUamUser(req);
  guides = guides.filter(g => guideVisibleTo(viewer, g));

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
  // Sharing: a guide outside a technician's list answers 404, not 403 —
  // deep links must not confirm existence of unshared work.
  if (!guide || !guideVisibleTo(currentUamUser(req), guide)) {
    res.status(404).json({
      error: `Guide ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  res.json({ data: guide, timestamp: new Date().toISOString() });
});

// PATCH /guides/:id — Author updates name, description, or published flag
// POST /guides/:id/edit-map — open (or create) the procedure map for a guide.
//
// The round-trip's front door: guides born on the canvas already have a linked
// map (via guideSync / node provenance) and simply re-open it; imported or
// hand-built guides get a map GENERATED by the reverse-compiler, named
// "[Guide] <name>", published immediately (no draft key needed to edit), with
// per-node provenance so re-sync updates steps in place and placement survives.
//
// `stale: true` in the response means the guide changed elsewhere (iOS, portal,
// another import) AFTER the map last agreed with it — the client must warn
// before a re-sync from that map overwrites those edits.
router.post('/:id/edit-map', (req: Request, res: Response): void => {
  const guide = guideStore.findById(req.params.id);
  if (!guide) {
    res.status(404).json({
      error: `Guide ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Already linked? guideSync is authoritative; node provenance covers maps
  // created before guideSync existed.
  const maps = mindmapStore.findAll();
  const linked = maps.find(m => m.guideSync?.guideId === guide.id)
              ?? maps.find(m => boundGuideId(m) === guide.id);
  if (linked) {
    const stale = new Date(guide.updatedAt).getTime() > (linked.guideSync?.syncedAt ?? 0);
    res.json({
      data: { mapId: linked.id, mapName: linked.name, created: false, stale },
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const steps = guideStepStore.findAll().filter(s => s.guideId === guide.id);

  // Copy step media into the designer image store so the Inspector previews it.
  // A missing file just skips: ingest keeps the existing mediaPath when a node
  // carries no imageFile, so the guide's image survives the round-trip anyway.
  const imageFileByStepId: Record<string, string> = {};
  for (const s of steps) {
    if (!s.mediaPath) continue;
    try {
      const buf = fs.readFileSync(path.join(STEP_IMG_DIR, s.mediaPath));
      imageFileByStepId[s.id] = saveDesignerImage(buf.toString('base64'));
    } catch {
      console.warn(`[edit-map] step image missing on disk: ${s.mediaPath} (guide ${guide.id})`);
    }
  }

  const compiled = guideToProcedureMap(guide, steps, imageFileByStepId);
  const map = toMindmapRecord(compiled, guide);
  mindmapStore.save(map);
  // Published from birth — an edit map must open without a draft key.
  mindmapAccessStore.save({ id: map.id, draftKey: uuidv4(), published: true });
  console.log(`[edit-map] Generated "${map.name}" (${map.nodes.length} nodes) for guide ${guide.id}`);

  res.status(201).json({
    data: { mapId: map.id, mapName: map.name, created: true, stale: false },
    timestamp: new Date().toISOString(),
  });
});

router.patch('/:id', (req: Request, res: Response): void => {
  const guide = guideStore.findById(req.params.id);
  if (!guide) {
    res.status(404).json({
      error: `Guide ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const body = req.body as UpdateGuideRequest & { anchorId?: string };
  const now  = new Date().toISOString();

  // Per-user sharing: replace the whole list. [] = back to "all technicians".
  // Emails must exist in the allow-list (catches typos before they strand a
  // technician), and editing the list needs Engineer+ once UAM is active.
  let sharedWith = guide.sharedWith;
  if (body.sharedWith !== undefined) {
    if (!Array.isArray(body.sharedWith) || body.sharedWith.some(e => typeof e !== 'string')) {
      res.status(400).json({ error: 'sharedWith must be an array of emails', timestamp: now });
      return;
    }
    const actor = currentUamUser(req);
    if (uamIsActive() && actor && actor.role === 'technician') {
      res.status(403).json({ error: 'Sharing requires Engineer role or above', timestamp: now });
      return;
    }
    const normalized = [...new Set(body.sharedWith.map(e => normalizeEmail(e)))];
    const unknown = normalized.filter(e => !findUserByEmail(e));
    if (unknown.length) {
      res.status(400).json({ error: `Not in the access list: ${unknown.join(', ')}`, timestamp: now });
      return;
    }
    sharedWith = normalized.length ? normalized : undefined;   // [] clears back to "everyone"
  }

  const updated: Guide = {
    ...guide,
    name:        body.name?.trim()        ?? guide.name,
    description: body.description != null ? body.description.trim() : guide.description,
    published:   body.published    != null ? body.published           : guide.published,
    anchorId:    body.anchorId?.trim()    || guide.anchorId,
    sharedWith,
    updatedAt:   now,
  };

  // Moving a guide to another anchor: anchorId is denormalised onto every
  // step, so they move together. Spatial placement is CLEARED — positions
  // were captured in the OLD anchor's world map and are meaningless (and
  // dangerous, floating mid-air) in the new one. Steps must be re-placed on
  // device, exactly like a fresh import.
  if (updated.anchorId !== guide.anchorId) {
    const moved = guideStepStore.findAll().filter(s => s.guideId === guide.id);
    for (const step of moved) {
      guideStepStore.save({
        ...step,
        anchorId: updated.anchorId,
        posX: undefined, posY: undefined, posZ: undefined,
        isPlaced: false, positionSource: undefined,
        modelOffsetX: undefined, modelOffsetY: undefined,
        modelOffsetZ: undefined, modelRotationY: undefined,
        updatedAt: now,
      });
    }
    // A published guide with suddenly-unplaced steps would break operators.
    if (updated.published) updated.published = false;
    console.log(`[SIB] Guide ${guide.id} moved ${guide.anchorId} → ${updated.anchorId}: ${moved.length} steps unplaced, guide unpublished`);
  }

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
  // Same visibility rule as GET /:id — steps of an unshared guide are 404
  // for technicians outside its list (no enumeration via deep links).
  if (!guide || !guideVisibleTo(currentUamUser(req), guide)) {
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
    linkUrl:            body.linkUrl?.trim() || undefined,
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
    // null clears; absent preserves (same contract as mediaBase64)
    linkUrl:            'linkUrl' in body       ? (body.linkUrl?.trim() || undefined) : step.linkUrl,
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
