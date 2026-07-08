// loc-tags.ts — Phase 2: Loc-Tag (Gemba audit walk) routes
//
// Endpoints:
//   POST   /loc-tags                    — Author: create a LocTag
//   GET    /loc-tags?anchorId=xxx       — List LocTags for an anchor
//   GET    /loc-tags/image/:filename    — Serve a reference or completion photo
//   PATCH  /loc-tags/:id               — Author: update mutable fields of a LocTag
//   DELETE /loc-tags/:id               — Author: remove a LocTag + its completions
//   POST   /loc-tags/:id/completion     — Operator: submit completion record
//   GET    /loc-tags/:id/completions    — List all completions for a LocTag

import { Router } from 'express';
import type { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs   from 'fs';
import path from 'path';
import type {
  LocTag,
  LocTagCompletion,
  CreateLocTagRequest,
  SubmitLocTagCompletionRequest,
  ApiResponse,
} from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';

// ── Storage ───────────────────────────────────────────────────────────────────

export const locTagStore       = new JsonFileStore<LocTag>('loc-tags');
export const locTagCompletionStore = new JsonFileStore<LocTagCompletion>('loc-tag-completions');

const DATA_DIR      = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const LOCTAG_IMG_DIR = path.join(DATA_DIR, 'loctag-images');
fs.mkdirSync(LOCTAG_IMG_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

function saveLocTagImage(anchorId: string, locTagId: string, base64: string, suffix: string): string {
  const date   = new Date();
  const stamp  = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`;
  const filename = `${anchorId}_${locTagId}_${suffix}_${stamp}.jpg`;
  const buf    = Buffer.from(base64, 'base64');
  fs.writeFileSync(path.join(LOCTAG_IMG_DIR, filename), buf);
  return filename;
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// POST /loc-tags — Author creates a new LocTag
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as CreateLocTagRequest & { referenceImageBase64?: string };

  if (!body.anchorId || !body.title || !body.description || !body.defectCategory) {
    res.status(400).json({ error: 'anchorId, title, description, and defectCategory are required' });
    return;
  }

  const now = new Date().toISOString();
  const id  = uuidv4();

  let referenceImagePath: string | undefined;
  if (body.referenceImageBase64) {
    try {
      referenceImagePath = saveLocTagImage(body.anchorId, id, body.referenceImageBase64, 'ref');
    } catch (err) {
      console.error('[SIB] Failed to save loc-tag reference image:', err);
      res.status(500).json({ error: 'Failed to save reference image' });
      return;
    }
  }

  const locTag: LocTag = {
    id,
    anchorId:             body.anchorId,
    title:                body.title,
    description:          body.description,
    severity:             body.severity,
    defectCategory:       body.defectCategory,
    defectCategoryNote:   body.defectCategoryNote,
    referenceImagePath,
    position:             body.position,
    order:                body.order ?? 0,
    createdAt:            now,
    updatedAt:            now,
  };

  locTagStore.save(locTag);
  console.log(`[SIB] LocTag created: ${id} for anchor ${body.anchorId}`);

  const resp: ApiResponse<LocTag> = { data: locTag, timestamp: now };
  res.status(201).json(resp);
});

// GET /loc-tags?anchorId=xxx — list all LocTags for an anchor, sorted by order
router.get('/', (req: Request, res: Response): void => {
  const { anchorId } = req.query;

  if (!anchorId || typeof anchorId !== 'string') {
    res.status(400).json({ error: 'anchorId query parameter is required' });
    return;
  }

  const tags = locTagStore
    .findAll()
    .filter(t => t.anchorId === anchorId)
    .sort((a, b) => a.order - b.order);

  const resp: ApiResponse<LocTag[]> = {
    data:      tags,
    timestamp: new Date().toISOString(),
  };
  res.json(resp);
});

// GET /loc-tags/image/:filename — serve a reference or completion photo
// (requires auth via the app-level apiKeyAuth middleware)
router.get('/image/:filename', (req: Request, res: Response): void => {
  const filename = req.params.filename;
  // Basic path-traversal guard
  if (filename.includes('..') || filename.includes('/')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }
  const filePath = path.join(LOCTAG_IMG_DIR, filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Image not found' });
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.sendFile(filePath);
});

// POST /loc-tags/:id/completion — Operator submits a completion record
router.post('/:id/completion', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const locTag = locTagStore.findById(id);
  if (!locTag) {
    res.status(404).json({ error: `LocTag ${id} not found` });
    return;
  }

  const body = req.body as SubmitLocTagCompletionRequest;
  if (!body.status || !body.operatorName) {
    res.status(400).json({ error: 'status and operatorName are required' });
    return;
  }

  const now    = new Date().toISOString();
  const compId = uuidv4();

  let completionImagePath: string | undefined;
  if (body.completionImageBase64) {
    try {
      completionImagePath = saveLocTagImage(locTag.anchorId, id, body.completionImageBase64, 'done');
    } catch (err) {
      console.error('[SIB] Failed to save loc-tag completion image:', err);
      res.status(500).json({ error: 'Failed to save completion image' });
      return;
    }
  }

  const completion: LocTagCompletion = {
    id:                   compId,
    locTagId:             id,
    anchorId:             locTag.anchorId,
    operatorName:         body.operatorName,
    status:               body.status,
    completionImagePath,
    note:                 body.note,
    completedAt:          now,
  };

  locTagCompletionStore.save(completion);
  console.log(`[SIB] LocTag completion saved: ${compId} for locTag ${id} — ${body.status}`);

  const resp: ApiResponse<LocTagCompletion> = { data: completion, timestamp: now };
  res.status(201).json(resp);
});

// PATCH /loc-tags/:id — Author updates mutable fields of an existing LocTag
router.patch('/:id', (req: Request, res: Response): void => {
  const { id } = req.params;
  const locTag = locTagStore.findById(id);
  if (!locTag) {
    res.status(404).json({ error: `LocTag ${id} not found` });
    return;
  }

  const body = req.body as {
    title?:              string;
    description?:        string;
    severity?:           string | null;
    defectCategory?:     string;
    defectCategoryNote?: string | null;
  };

  const updated: LocTag = {
    ...locTag,
    title:              body.title              ?? locTag.title,
    description:        body.description        ?? locTag.description,
    severity:           'severity' in body      ? (body.severity as any) : locTag.severity,
    defectCategory:     (body.defectCategory as any) ?? locTag.defectCategory,
    defectCategoryNote: 'defectCategoryNote' in body
                          ? (body.defectCategoryNote ?? undefined)
                          : locTag.defectCategoryNote,
    updatedAt:          new Date().toISOString(),
  };

  locTagStore.save(updated);
  console.log(`[SIB] LocTag updated: ${id}`);

  const resp: ApiResponse<LocTag> = { data: updated, timestamp: new Date().toISOString() };
  res.json(resp);
});

// DELETE /loc-tags/:id — Author removes a LocTag
router.delete('/:id', (req: Request, res: Response): void => {
  const { id } = req.params;
  const locTag = locTagStore.findById(id);
  if (!locTag) {
    res.status(404).json({ error: `LocTag ${id} not found` });
    return;
  }

  locTagStore.delete(id);
  // Also remove completions for this tag
  const completions = locTagCompletionStore.findAll().filter(c => c.locTagId === id);
  for (const c of completions) locTagCompletionStore.delete(c.id);

  console.log(`[SIB] LocTag deleted: ${id} (${completions.length} completions removed)`);
  res.status(204).send();
});

// GET /loc-tags/:id/completions — list all completions for a LocTag
router.get('/:id/completions', (req: Request, res: Response): void => {
  const { id } = req.params;

  const completions = locTagCompletionStore
    .findAll()
    .filter(c => c.locTagId === id)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));

  const resp: ApiResponse<LocTagCompletion[]> = {
    data:      completions,
    timestamp: new Date().toISOString(),
  };
  res.json(resp);
});

export default router;
