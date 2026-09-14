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
//   POST   /loc-tags/:id/photos         — G3: append photos { photosBase64:[{base64, caption}] }
//   DELETE /loc-tags/:id/photos/:file   — G3: remove one photo
//   PUT    /loc-tags/:id/photos/:file/markup — G5: attach a marked-up copy { base64 }
//
// G3 (2026.4.46): a finding can be logged against an Audit Reference Library
// question (questionCode → area/question snapshot), carry a finding category
// (Strength / OFI / NC), an optional risk rating (0–3) and up to six photos
// with captions. `referenceImagePath` always mirrors photos[0] so older
// clients and the portal keep working unchanged.

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
import type { LocTagPhoto } from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';
import { GembaValidationError } from '../gemba/library-core.js';
import { findQuestionByCode } from './gemba-library.js';
import {
  resolveFindingFields, validateIncomingPhotos, applyCaptionEdits, defaultTitle, LOC_TAG_MAX_PHOTOS,
} from '../gemba/finding-core.js';

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

function fail(res: Response, err: unknown): void {
  if (err instanceof GembaValidationError) { res.status(err.status).json({ error: err.message }); return; }
  console.error('[SIB] loc-tag error:', err);
  res.status(500).json({ error: 'Internal error' });
}

/** Store a batch of photos; returns the new LocTagPhoto entries. */
function storePhotos(anchorId: string, locTagId: string, photos: { base64: string; caption?: string }[], startIndex: number): LocTagPhoto[] {
  const now = new Date().toISOString();
  return photos.map((p, i) => ({
    path: saveLocTagImage(anchorId, locTagId, p.base64, `p${startIndex + i + 1}`),
    caption: p.caption,
    capturedAt: now,
  }));
}

function unlinkQuiet(filename: string | undefined): void {
  if (!filename || filename.includes('..') || filename.includes('/')) return;
  try { fs.unlinkSync(path.join(LOCTAG_IMG_DIR, filename)); } catch { /* already gone */ }
}

// ── Router ────────────────────────────────────────────────────────────────────

const router = Router();

// POST /loc-tags — Author creates a new LocTag
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as CreateLocTagRequest & { referenceImageBase64?: string };

  // G3: resolve reference-list fields first — a bad question code must fail
  // before any image is written to disk.
  let fields;
  let incoming;
  try {
    fields   = resolveFindingFields(req.body as Record<string, unknown>, findQuestionByCode);
    incoming = validateIncomingPhotos((req.body as { photosBase64?: unknown }).photosBase64);
  } catch (err) { fail(res, err); return; }

  const title = (body.title || '').trim() || defaultTitle(fields, '');
  // description is optional — an empty string is valid. defectCategory is the
  // legacy taxonomy: required unless the finding is logged against a question.
  if (!body.anchorId || !title || (!body.defectCategory && !fields.questionCode)) {
    res.status(400).json({ error: 'anchorId, title, and defectCategory (or questionCode) are required' });
    return;
  }
  if (!body.position || typeof body.position.x !== 'number') {
    res.status(400).json({ error: 'position is required' });
    return;
  }

  const now = new Date().toISOString();
  const id  = uuidv4();

  let photos: LocTagPhoto[] = [];
  try {
    // Legacy single photo first, then the G3 batch — capture order preserved.
    if (body.referenceImageBase64) {
      photos.push({ path: saveLocTagImage(body.anchorId, id, body.referenceImageBase64, 'ref'), capturedAt: now });
    }
    photos = photos.concat(storePhotos(body.anchorId, id, incoming, photos.length));
  } catch (err) {
    console.error('[SIB] Failed to save loc-tag photo:', err);
    for (const p of photos) unlinkQuiet(p.path);
    res.status(500).json({ error: 'Failed to save photo' });
    return;
  }
  if (photos.length > LOC_TAG_MAX_PHOTOS) { for (const p of photos) unlinkQuiet(p.path); res.status(400).json({ error: `At most ${LOC_TAG_MAX_PHOTOS} photos.` }); return; }

  const locTag: LocTag = {
    id,
    anchorId:             body.anchorId,
    title,
    description:          body.description ?? '',
    severity:             body.severity,
    defectCategory:       body.defectCategory ?? 'OTHERS',
    defectCategoryNote:   body.defectCategoryNote,
    referenceImagePath:   photos[0]?.path,
    position:             body.position,
    order:                body.order ?? 0,
    focusAreaCode:        fields.focusAreaCode,
    focusAreaTitle:       fields.focusAreaTitle,
    questionCode:         fields.questionCode,
    questionTitle:        fields.questionTitle,
    questionText:         fields.questionText,
    findingCategory:      fields.findingCategory,
    riskRating:           fields.riskRating,
    photos:               photos.length ? photos : undefined,
    walkId:               typeof body.walkId === 'string' && body.walkId ? body.walkId : undefined,
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
    /** G3: [{ path, caption }] caption edits */
    photos?:             unknown;
    walkId?:             string | null;
  };

  let fields;
  try { fields = resolveFindingFields(req.body as Record<string, unknown>, findQuestionByCode); }
  catch (err) { fail(res, err); return; }

  const updated: LocTag = {
    ...locTag,
    title:              body.title              ?? locTag.title,
    description:        body.description        ?? locTag.description,
    severity:           'severity' in body      ? (body.severity as any) : locTag.severity,
    defectCategory:     (body.defectCategory as any) ?? locTag.defectCategory,
    defectCategoryNote: 'defectCategoryNote' in body
                          ? (body.defectCategoryNote ?? undefined)
                          : locTag.defectCategoryNote,
    ...(fields.clearQuestion
      ? { focusAreaCode: undefined, focusAreaTitle: undefined, questionCode: undefined, questionTitle: undefined, questionText: undefined }
      : {}),
    ...(fields.questionCode ? {
      focusAreaCode: fields.focusAreaCode, focusAreaTitle: fields.focusAreaTitle,
      questionCode: fields.questionCode, questionTitle: fields.questionTitle, questionText: fields.questionText,
    } : {}),
    ...('findingCategory' in fields ? { findingCategory: fields.findingCategory } : {}),
    ...('riskRating'      in fields ? { riskRating: fields.riskRating } : {}),
    ...(body.photos !== undefined ? { photos: applyCaptionEdits(locTag.photos ?? [], body.photos) } : {}),
    ...('walkId' in body ? { walkId: body.walkId || undefined } : {}),
    updatedAt:          new Date().toISOString(),
  };

  locTagStore.save(updated);
  console.log(`[SIB] LocTag updated: ${id}`);

  const resp: ApiResponse<LocTag> = { data: updated, timestamp: new Date().toISOString() };
  res.json(resp);
});

// DELETE /loc-tags/completions — remove ALL Gemba Walk completion records
router.delete('/completions', (_req: Request, res: Response): void => {
  const count = locTagCompletionStore.pruneWhere(() => true);
  console.log(`[SIB] Deleted all ${count} Gemba Walk completion(s)`);
  res.json({ deleted: count, timestamp: new Date().toISOString() });
});

// DELETE /loc-tags/completions/:id — remove a single Gemba Walk completion
router.delete('/completions/:id', (req: Request, res: Response): void => {
  const completion = locTagCompletionStore.findById(req.params.id);
  if (!completion) { res.status(404).json({ error: 'Completion not found' }); return; }
  locTagCompletionStore.delete(req.params.id);
  console.log(`[SIB] Gemba Walk completion deleted: ${req.params.id}`);
  res.status(204).send();
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
  for (const p of locTag.photos ?? []) { unlinkQuiet(p.path); unlinkQuiet(p.markupPath); }
  if (locTag.referenceImagePath && !(locTag.photos ?? []).some(p => p.path === locTag.referenceImagePath)) unlinkQuiet(locTag.referenceImagePath);
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

// ── G3: photos ────────────────────────────────────────────────────────────────

// POST /loc-tags/:id/photos — append { photosBase64: [{ base64, caption? }] }
router.post('/:id/photos', (req: Request, res: Response): void => {
  const locTag = locTagStore.findById(req.params.id);
  if (!locTag) { res.status(404).json({ error: `LocTag ${req.params.id} not found` }); return; }
  try {
    const existing = locTag.photos ?? (locTag.referenceImagePath ? [{ path: locTag.referenceImagePath, capturedAt: locTag.createdAt }] : []);
    const incoming = validateIncomingPhotos((req.body as { photosBase64?: unknown }).photosBase64, existing.length);
    if (!incoming.length) { res.status(400).json({ error: 'No photos in request.' }); return; }
    const added  = storePhotos(locTag.anchorId, locTag.id, incoming, existing.length);
    const photos = existing.concat(added);
    const updated: LocTag = { ...locTag, photos, referenceImagePath: photos[0].path, updatedAt: new Date().toISOString() };
    locTagStore.save(updated);
    res.status(201).json({ data: updated, timestamp: updated.updatedAt });
  } catch (err) { fail(res, err); }
});

// DELETE /loc-tags/:id/photos/:filename — remove one photo (and its markup)
router.delete('/:id/photos/:filename', (req: Request, res: Response): void => {
  const locTag = locTagStore.findById(req.params.id);
  if (!locTag) { res.status(404).json({ error: `LocTag ${req.params.id} not found` }); return; }
  const photos = locTag.photos ?? [];
  const victim = photos.find(p => p.path === req.params.filename);
  if (!victim) { res.status(404).json({ error: 'Photo not found on this finding' }); return; }
  unlinkQuiet(victim.path); unlinkQuiet(victim.markupPath);
  const remaining = photos.filter(p => p !== victim);
  const updated: LocTag = { ...locTag, photos: remaining.length ? remaining : undefined,
    referenceImagePath: remaining[0]?.path, updatedAt: new Date().toISOString() };
  locTagStore.save(updated);
  res.json({ data: updated, timestamp: updated.updatedAt });
});

// PUT /loc-tags/:id/photos/:filename/markup — G5: { base64 } marked-up copy
router.put('/:id/photos/:filename/markup', (req: Request, res: Response): void => {
  const locTag = locTagStore.findById(req.params.id);
  if (!locTag) { res.status(404).json({ error: `LocTag ${req.params.id} not found` }); return; }
  const photos = locTag.photos ?? [];
  const idx = photos.findIndex(p => p.path === req.params.filename);
  if (idx < 0) { res.status(404).json({ error: 'Photo not found on this finding' }); return; }
  const base64 = typeof req.body?.base64 === 'string' ? req.body.base64.trim() : '';
  if (base64.length < 64) { res.status(400).json({ error: 'base64 image data is missing.' }); return; }
  unlinkQuiet(photos[idx].markupPath);
  const markupPath = saveLocTagImage(locTag.anchorId, locTag.id, base64, `m${idx + 1}`);
  const next = photos.map((p, i) => i === idx ? { ...p, markupPath } : p);
  const updated: LocTag = { ...locTag, photos: next, updatedAt: new Date().toISOString() };
  locTagStore.save(updated);
  res.json({ data: updated, timestamp: updated.updatedAt });
});

export default router;
