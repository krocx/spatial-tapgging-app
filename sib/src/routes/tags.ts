import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Tag, CreateTagRequest, UpdateTagRequest, ApiResponse } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { anchorStore } from './anchors.js';
import { passStateStore, findPassStateByTag } from '../stores/pass-state-store.js';

export const tagStore = new JsonFileStore<Tag>('tags');

const router = Router();

// POST /tags — create a tag on an existing anchor
router.post('/', (req: Request, res: Response) => {
  const body = req.body as CreateTagRequest;

  if (!body.anchorId || !body.type || !body.label) {
    return res.status(400).json({
      error: 'Missing required fields: anchorId, type, label',
      timestamp: new Date().toISOString(),
    });
  }

  // Ensure the referenced anchor exists
  const anchor = anchorStore.findById(body.anchorId);
  if (!anchor) {
    return res.status(404).json({
      error: `Referenced anchor ${body.anchorId} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  const tag: Tag = {
    id: uuidv4(),
    anchorId: body.anchorId,
    type: body.type,
    label: body.label,
    expectedOutcome: body.expectedOutcome ?? '',
    ...(body.checkDescription !== undefined && { checkDescription: body.checkDescription }),
    ...(body.order !== undefined && { order: body.order }),
    metadata: body.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };

  tagStore.save(tag);

  const response: ApiResponse<Tag> = {
    data: tag,
    timestamp: now,
  };

  return res.status(201).json(response);
});

// GET /tags — list all tags (optionally filter by anchorId)
// Each tag is enriched with a server-computed `isTrained` boolean so clients
// can display trained/untrained status without a separate readiness call.
router.get('/', (req: Request, res: Response) => {
  const { anchorId } = req.query;
  let tags = tagStore.findAll();
  if (typeof anchorId === 'string') {
    tags = tags.filter((t) => t.anchorId === anchorId);
  }
  const enriched = tags.map(tag => ({
    ...tag,
    isTrained: findPassStateByTag(tag.id) !== null,
  }));
  return res.json({ data: enriched, timestamp: new Date().toISOString() });
});

// GET /tags/:id — get a single tag
router.get('/:id', (req: Request, res: Response) => {
  const tag = tagStore.findById(req.params.id);
  if (!tag) {
    return res.status(404).json({
      error: `Tag ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }
  return res.json({ data: tag, timestamp: new Date().toISOString() });
});

// PATCH /tags/:id — update mutable fields (label, expectedOutcome, checkDescription, order)
router.patch('/:id', (req: Request, res: Response) => {
  const tag = tagStore.findById(req.params.id);
  if (!tag) {
    return res.status(404).json({
      error: `Tag ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  const body = req.body as UpdateTagRequest;

  // Only write fields that were explicitly supplied
  const now = new Date().toISOString();
  const updated: Tag = {
    ...tag,
    ...(body.label            !== undefined && { label:            body.label }),
    ...(body.expectedOutcome  !== undefined && { expectedOutcome:  body.expectedOutcome }),
    ...(body.checkDescription !== undefined && { checkDescription: body.checkDescription }),
    ...(body.order            !== undefined && { order:            body.order }),
    // Deep-merge incoming metadata so existing keys (anchor_rel_*, etc.) are preserved.
    // Feature prints and OCR text are stored this way without touching other fields.
    ...(body.metadata !== undefined && { metadata: { ...tag.metadata, ...body.metadata } }),
    updatedAt: now,
  };

  tagStore.save(updated);

  console.log(`[SIB] Updated tag ${req.params.id}: ${JSON.stringify(body)}`);

  const response: ApiResponse<Tag> = { data: updated, timestamp: now };
  return res.status(200).json(response);
});

// DELETE /tags/:id — remove a single tag and its pass-state
router.delete('/:id', (req: Request, res: Response) => {
  const tag = tagStore.findById(req.params.id);
  if (!tag) {
    return res.status(404).json({
      error: `Tag ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  // Cascade: remove pass-state if one exists
  const ps = findPassStateByTag(req.params.id);
  if (ps) passStateStore.delete(ps.id);

  tagStore.delete(req.params.id);

  console.log(`[SIB] Deleted tag ${req.params.id}${ps ? ' (+ pass-state)' : ''}`);
  return res.status(200).json({ data: { id: req.params.id }, timestamp: new Date().toISOString() });
});

// DELETE /tags?anchorId=X — bulk-delete all tags (and pass-states) for an anchor
router.delete('/', (req: Request, res: Response) => {
  const { anchorId } = req.query;
  if (typeof anchorId !== 'string' || !anchorId) {
    return res.status(400).json({
      error: 'anchorId query param is required',
      timestamp: new Date().toISOString(),
    });
  }

  const tags = tagStore.findAll().filter(t => t.anchorId === anchorId);
  let deletedTags = 0;
  let deletedPassStates = 0;

  for (const tag of tags) {
    const ps = findPassStateByTag(tag.id);
    if (ps) { passStateStore.delete(ps.id); deletedPassStates++; }
    tagStore.delete(tag.id);
    deletedTags++;
  }

  console.log(`[SIB] Bulk-deleted ${deletedTags} tags + ${deletedPassStates} pass-states for anchor ${anchorId}`);
  return res.status(200).json({
    data: { deletedTags, deletedPassStates },
    timestamp: new Date().toISOString(),
  });
});

export default router;
