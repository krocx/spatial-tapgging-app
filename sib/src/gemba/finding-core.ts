// gemba/finding-core.ts - G3: the reference-list fields on a finding (LocTag).
// Pure: resolves and validates what POST/PATCH /loc-tags send, snapshotting
// the chosen question from the Audit Reference Library so the finding is
// self-contained forever. No I/O; the route passes in the lookup.

import type { LocTag, LocTagPhoto, GembaFindingCategory, GembaRiskRating, GembaFocusArea, GembaQuestion } from '@spatial/shared';
import { isFindingCategory, isRiskRating, normCode, GembaValidationError } from './library-core.js';

export const LOC_TAG_MAX_PHOTOS = 6;
export const LOC_TAG_MAX_CAPTION = 300;

export type QuestionLookup = (code: unknown) => { question: GembaQuestion; area: GembaFocusArea } | undefined;

export type FindingFields = Pick<LocTag,
  'focusAreaCode' | 'focusAreaTitle' | 'questionCode' | 'questionTitle' | 'questionText' | 'findingCategory' | 'riskRating' | 'referenceSource'>;
const MAX_CUSTOM_AREA = 120, MAX_CUSTOM_QUESTION = 2000;

/**
 * Resolve the G3 fields from a request body. Returns only the keys that were
 * present (so PATCH can merge). `questionCode: null` clears the question.
 */
export function resolveFindingFields(body: Record<string, unknown>, lookup: QuestionLookup): Partial<FindingFields> & { clearQuestion?: boolean } {
  const out: Partial<FindingFields> & { clearQuestion?: boolean } = {};

  if ('questionCode' in body) {
    if (body.questionCode === null || body.questionCode === '') {
      out.clearQuestion = true;
    } else {
      const hit = lookup(body.questionCode);
      if (!hit) throw new GembaValidationError(400, `Unknown question code "${normCode(body.questionCode)}" - not in the Audit Reference Library.`);
      out.focusAreaCode  = hit.area.code;
      out.focusAreaTitle = hit.area.title;
      out.questionCode   = hit.question.code;
      out.questionTitle  = hit.question.title;
      out.questionText   = hit.question.text;
      out.referenceSource = 'library';
    }
  }
  // Free text: same shape (area + question) but no codes and source 'custom',
  // so a report can never pass a typed entry off as a library item.
  if (!out.questionCode && ('customQuestion' in body || 'customFocusArea' in body)) {
    const q = typeof body.customQuestion === 'string' ? body.customQuestion.trim().slice(0, MAX_CUSTOM_QUESTION) : '';
    const a = typeof body.customFocusArea === 'string' ? body.customFocusArea.trim().slice(0, MAX_CUSTOM_AREA) : '';
    if (q) {
      out.focusAreaCode  = undefined;
      out.focusAreaTitle = a || undefined;
      out.questionCode   = undefined;
      out.questionTitle  = q.length > 60 ? q.slice(0, 57) + '…' : q;
      out.questionText   = q;
      out.referenceSource = 'custom';
    } else if ('customQuestion' in body) {
      throw new GembaValidationError(400, 'customQuestion cannot be empty.');
    }
  }
  if ('findingCategory' in body) {
    const v = typeof body.findingCategory === 'string' ? body.findingCategory.trim().toUpperCase() : body.findingCategory;
    if (v === null || v === '') out.findingCategory = undefined;
    else if (isFindingCategory(v)) out.findingCategory = v as GembaFindingCategory;
    else throw new GembaValidationError(400, 'findingCategory must be STRENGTH, OFI or NC.');
  }
  if ('riskRating' in body) {
    const v = body.riskRating;
    if (v === null || v === '') out.riskRating = undefined;
    else {
      const n = typeof v === 'string' ? Number(v) : v;
      if (!isRiskRating(n)) throw new GembaValidationError(400, 'riskRating must be 0, 1, 2 or 3.');
      out.riskRating = n as GembaRiskRating;
    }
  }
  return out;
}

/** Validate an incoming photo list (base64 + caption). Throws on abuse. */
export interface IncomingPhoto { base64: string; caption?: string }
export function validateIncomingPhotos(raw: unknown, alreadyStored = 0): IncomingPhoto[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new GembaValidationError(400, 'photosBase64 must be an array.');
  if (alreadyStored + raw.length > LOC_TAG_MAX_PHOTOS) {
    throw new GembaValidationError(400, `A finding holds at most ${LOC_TAG_MAX_PHOTOS} photos.`);
  }
  return raw.map((p, i) => {
    const r = (p ?? {}) as Record<string, unknown>;
    const base64 = typeof r.base64 === 'string' ? r.base64.trim() : '';
    if (base64.length < 64) throw new GembaValidationError(400, `Photo ${i + 1}: base64 image data is missing.`);
    const caption = typeof r.caption === 'string' ? r.caption.trim().slice(0, LOC_TAG_MAX_CAPTION) : undefined;
    return { base64, caption: caption || undefined };
  });
}

/** Caption edits: [{ path, caption }] → merged photo list (unknown paths ignored). */
export function applyCaptionEdits(photos: LocTagPhoto[], edits: unknown): LocTagPhoto[] {
  if (!Array.isArray(edits)) return photos;
  const byPath = new Map<string, string | null>();
  for (const e of edits) {
    const r = (e ?? {}) as Record<string, unknown>;
    if (typeof r.path !== 'string') continue;
    byPath.set(r.path, typeof r.caption === 'string' ? r.caption.trim().slice(0, LOC_TAG_MAX_CAPTION) : null);
  }
  return photos.map(p => {
    if (!byPath.has(p.path)) return p;
    const c = byPath.get(p.path);
    return { ...p, caption: c ? c : undefined };
  });
}

/** Title for a finding logged against a question when the client sent none. */
export function defaultTitle(fields: Partial<FindingFields>, fallback: string): string {
  if (fields.questionCode) return `${fields.questionCode} - ${fields.questionTitle ?? ''}`.trim();
  if (fields.referenceSource === 'custom' && fields.questionTitle) return fields.questionTitle;
  return fallback;
}
