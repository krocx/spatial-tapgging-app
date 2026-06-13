import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Anchor, CreateAnchorRequest, ApiResponse } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { tagStore } from './tags.js';
import { passStateStore, findPassStateByTag } from '../stores/pass-state-store.js';

export const anchorStore = new JsonFileStore<Anchor>('anchors');

const router = Router();

// POST /anchors — create a new spatial anchor
router.post('/', (req: Request, res: Response) => {
  const body = req.body as CreateAnchorRequest;

  // Validate required fields
  if (!body.assetId || !body.coordinateSystem || !body.position || !body.rotation) {
    return res.status(400).json({
      error: 'Missing required fields: assetId, coordinateSystem, position, rotation',
      timestamp: new Date().toISOString(),
    });
  }

  // If the client provides an id (e.g. the QR's anchorId), honour it so that
  // Operator mode can look up tags using the same anchorId from the QR scan.
  // If the anchor already exists with that id, return it (idempotent upsert).
  if (typeof (body as any).id === 'string') {
    const existing = anchorStore.findById((body as any).id as string);
    if (existing) {
      return res.status(200).json({ data: existing, timestamp: new Date().toISOString() });
    }
  }

  const now = new Date().toISOString();
  const anchor: Anchor = {
    id: (body as any).id ?? uuidv4(),
    assetId: body.assetId,
    coordinateSystem: body.coordinateSystem,
    position: body.position,
    rotation: body.rotation,
    metadata: body.metadata ?? {},
    // Phase 3: persist the encryption key so any authorised device can
    // retrieve it and regenerate the full QR (with key embedded) later.
    ...(body.encryptionKey ? { encryptionKey: body.encryptionKey } : {}),
    createdAt: now,
    updatedAt: now,
  };

  anchorStore.save(anchor);

  const response: ApiResponse<Anchor> = {
    data: anchor,
    timestamp: now,
  };

  return res.status(201).json(response);
});

// GET /anchors — list all anchors
router.get('/', (_req: Request, res: Response) => {
  const anchors = anchorStore.findAll();
  return res.json({
    data: anchors,
    timestamp: new Date().toISOString(),
  });
});

// GET /anchors/:id — get a single anchor
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

// GET /anchors/:id/readiness — G1: check whether an anchor is ready for Operator mode.
// "Ready" means every tag associated with the anchor has at least one trained pass-state.
// Returns: { isReady, totalTags, trainedTags, untrainedTagIds }
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

// DELETE /anchors/:id — remove anchor and cascade-delete all its tags + pass-states
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
