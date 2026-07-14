// tag-groups.ts — Inspection Sets (Tag Groups)
//
// A TagGroup is a named collection of Tags attached to one Anchor.
// Mirrors the AR Guide pattern: Author creates named Inspection Sets,
// assigns Tags to them via groupId, and Operators select a set to inspect.
//
// Endpoints:
//   POST   /tag-groups                      — Author: create a TagGroup
//   GET    /tag-groups?anchorId=xxx         — list TagGroups for an anchor
//   GET    /tag-groups/:id                  — get a single TagGroup
//   PATCH  /tag-groups/:id                  — Author: rename / update description
//   DELETE /tag-groups/:id                  — Author: delete group (tags lose groupId, not deleted)

import { Router, type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { TagGroup, CreateTagGroupRequest, UpdateTagGroupRequest, ApiResponse } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { anchorStore } from './anchors.js';
import { tagStore } from './tags.js';

export const tagGroupStore = new JsonFileStore<TagGroup>('tag-groups');

const router = Router();

// POST /tag-groups — create an Inspection Set on an existing anchor
router.post('/', (req: Request, res: Response) => {
  const body = req.body as CreateTagGroupRequest;

  if (!body.anchorId || !body.name?.trim()) {
    return res.status(400).json({
      error: 'Missing required fields: anchorId, name',
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
  const group: TagGroup = {
    id:          uuidv4(),
    anchorId:    body.anchorId,
    name:        body.name.trim(),
    ...(body.description && { description: body.description.trim() }),
    ...(body.createdBy   && { createdBy:   body.createdBy }),
    createdAt:   now,
    updatedAt:   now,
  };

  tagGroupStore.save(group);

  console.log(`[SIB] Created tag group "${group.name}" (${group.id}) for anchor ${group.anchorId}`);

  const response: ApiResponse<TagGroup> = { data: group, timestamp: now };
  return res.status(201).json(response);
});

// GET /tag-groups?anchorId=xxx — list all Inspection Sets for an anchor
router.get('/', (req: Request, res: Response) => {
  const { anchorId } = req.query;
  let groups = tagGroupStore.findAll();
  if (typeof anchorId === 'string') {
    groups = groups.filter((g) => g.anchorId === anchorId);
  }
  // Sort by creation date ascending (oldest first) for stable list order
  groups.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return res.json({ data: groups, timestamp: new Date().toISOString() });
});

// GET /tag-groups/:id — get a single TagGroup
router.get('/:id', (req: Request, res: Response) => {
  const group = tagGroupStore.findById(req.params.id);
  if (!group) {
    return res.status(404).json({
      error: `TagGroup ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }
  return res.json({ data: group, timestamp: new Date().toISOString() });
});

// PATCH /tag-groups/:id — rename or update description
router.patch('/:id', (req: Request, res: Response) => {
  const group = tagGroupStore.findById(req.params.id);
  if (!group) {
    return res.status(404).json({
      error: `TagGroup ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  const body = req.body as UpdateTagGroupRequest;
  const now = new Date().toISOString();
  const updated: TagGroup = {
    ...group,
    ...(body.name        !== undefined && { name:        body.name.trim() }),
    ...(body.description !== undefined && { description: body.description?.trim() }),
    updatedAt: now,
  };

  tagGroupStore.save(updated);

  console.log(`[SIB] Updated tag group ${req.params.id}: ${JSON.stringify(body)}`);

  const response: ApiResponse<TagGroup> = { data: updated, timestamp: now };
  return res.status(200).json(response);
});

// DELETE /tag-groups/:id — delete the group record.
// Tags that belonged to this group lose their groupId (they become ungrouped)
// but are NOT deleted — their pass-states and training data are preserved.
router.delete('/:id', (req: Request, res: Response) => {
  const group = tagGroupStore.findById(req.params.id);
  if (!group) {
    return res.status(404).json({
      error: `TagGroup ${req.params.id} not found`,
      timestamp: new Date().toISOString(),
    });
  }

  // Unlink tags from the deleted group (clear their groupId)
  const now = new Date().toISOString();
  const linkedTags = tagStore.findAll().filter(t => t.groupId === req.params.id);
  for (const tag of linkedTags) {
    const { groupId: _removed, ...rest } = tag;
    tagStore.save({ ...rest, updatedAt: now });
  }

  tagGroupStore.delete(req.params.id);

  console.log(`[SIB] Deleted tag group ${req.params.id} ("${group.name}"); unlinked ${linkedTags.length} tag(s)`);

  return res.status(200).json({
    data: { id: req.params.id, unlinkedTags: linkedTags.length },
    timestamp: now,
  });
});

export default router;
