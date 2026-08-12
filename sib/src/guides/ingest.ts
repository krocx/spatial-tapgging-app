// ingest.ts — the single path from an ImportedGuide to real Guide + GuideStep records.
//
// Two callers today:
//   • POST /guides/import                    — create a new draft guide from JSON/MES
//   • POST /mindmap/:id/procedure/export     — create OR update from a procedure map
//
// and a third expected: a real MES connector, which syncs periodically and is
// therefore an upsert by nature.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// Two invariants must hold identically for every caller, and an invariant
// implemented twice is one that will eventually hold in only one place:
//
//   1. Sequence numbers in an ImportedGuide are resolved to real step UUIDs
//      in a second pass, so forward references work.
//
//   2. A write must NEVER overwrite spatial placement. posX/posY/posZ,
//      isPlaced and positionSource are owned by whoever physically stood in
//      front of the machine; nothing reached over the network may clobber
//      them. This is the guarantee that makes re-syncing a guide that is in
//      use a safe thing to do.
//
// See docs/PROCEDURE-DESIGNER.md §8.

import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Guide, GuideStep, ImportedGuide } from '@spatial/shared';
import {
  guideStore,
  guideStepStore,
  writeStepImageBuffer,
  deleteStepImage,
  downloadUrl,
} from './store.js';
import { designerImagePath } from '../procedure/designer-images.js';

export interface ApplyImportedGuideOptions {
  anchorId:   string;
  createdBy:  string;
  /**
   * Target an existing guide (upsert). Omit to create a new draft guide.
   * The caller is responsible for any published-state guard.
   */
  guideId?:   string;
  /**
   * sequenceNumber → existing GuideStep.id, supplied by callers that track
   * provenance. Steps matched this way are UPDATED in place and keep their
   * spatial placement; unmatched steps are created fresh.
   *
   * Kept out of ImportedGuide deliberately: provenance is a property of the
   * authoring surface, not of the instruction payload.
   */
  existingStepIdBySeq?: Record<number, string>;
}

export interface ApplyImportedGuideResult {
  guide:       Guide;
  steps:       GuideStep[];
  created:     number;
  updated:     number;
  removed:     number;
  /** Steps still needing AR placement — the guide cannot be published until 0. */
  unplaced:    number;
  /** Image URLs that failed to download. Non-fatal; the step is created without media. */
  imageErrors: string[];
}

/**
 * Fields owned by the device. Never written from an import or a canvas re-sync.
 *
 * The 3D model split is deliberate and worth being precise about:
 *   • ASSIGNMENT  (modelId / modelScale / modelOpacity) — which model, how big,
 *     how transparent. An authoring surface may set these, so an import that
 *     specifies a model wins; an import that is silent preserves the device's.
 *   • PLACEMENT   (modelOffset* / modelRotationY) — where the ghost sits in AR.
 *     Only the device can know this; imports never touch it — EXCEPT when the
 *     import switches to a different model, in which case the old model's
 *     placement is meaningless and is cleared for a fresh AR placement.
 */
function carrySpatial(target: GuideStep, existing: GuideStep, importSetsModel: boolean): void {
  target.posX           = existing.posX;
  target.posY           = existing.posY;
  target.posZ           = existing.posZ;
  target.isPlaced       = existing.isPlaced;
  target.positionSource = existing.positionSource;

  if (!importSetsModel) {
    // Import silent on models → the device's assignment stands untouched.
    target.modelId      = existing.modelId;
    target.modelScale   = existing.modelScale;
    target.modelOpacity = existing.modelOpacity;
  }

  const modelUnchanged = !importSetsModel || target.modelId === existing.modelId;
  if (modelUnchanged) {
    target.modelOffsetX   = existing.modelOffsetX;
    target.modelOffsetY   = existing.modelOffsetY;
    target.modelOffsetZ   = existing.modelOffsetZ;
    target.modelRotationY = existing.modelRotationY;
  }
  // else: new model assigned from the canvas — placement starts fresh on device.
}

export async function applyImportedGuide(
  imported: ImportedGuide,
  opts:     ApplyImportedGuideOptions,
): Promise<ApplyImportedGuideResult> {
  const now = new Date().toISOString();
  const isUpsert = !!opts.guideId && !!guideStore.findById(opts.guideId);

  // ── Guide record ──────────────────────────────────────────────────────────
  let guide: Guide;
  if (isUpsert) {
    const existing = guideStore.findById(opts.guideId!)!;
    guide = {
      ...existing,
      name:        imported.name.trim() || existing.name,
      description: imported.description?.trim() ?? existing.description,
      updatedAt:   now,
    };
  } else {
    guide = {
      id:          opts.guideId ?? uuidv4(),
      anchorId:    opts.anchorId,
      name:        imported.name.trim(),
      description: imported.description?.trim() ?? '',
      published:   false,          // always starts as a draft
      createdBy:   opts.createdBy,
      createdAt:   now,
      updatedAt:   now,
    };
  }
  guideStore.save(guide);

  // ── Pass 1: assign ids, build seq → id map ────────────────────────────────
  // Forward references (a step branching to a later step) mean links can only
  // be resolved once every id is known.
  const priorSteps = isUpsert
    ? guideStepStore.findAll().filter(s => s.guideId === guide.id)
    : [];
  const priorById  = new Map(priorSteps.map(s => [s.id, s]));

  const seqToId = new Map<number, string>();
  const stepIds: string[] = [];
  const reused  = new Set<string>();

  for (const s of imported.steps) {
    const claimed = opts.existingStepIdBySeq?.[s.sequenceNumber];
    const id = claimed && priorById.has(claimed) ? claimed : uuidv4();
    if (priorById.has(id)) reused.add(id);
    seqToId.set(s.sequenceNumber, id);
    stepIds.push(id);
  }

  // ── Images (parallel, non-fatal) ──────────────────────────────────────────
  // Two sources: imageFile = server-local designer store (Procedure Designer —
  // copied, no network), imageUrl = remote (JSON/MES import — downloaded).
  // imageFile wins when both are present.
  const imageErrors: string[] = [];
  const imageBuffers = await Promise.all(
    imported.steps.map(async (s) => {
      if (s.imageFile) {
        const full = designerImagePath(s.imageFile);
        if (!full) { imageErrors.push(`designer:${s.imageFile}`); return null; }
        try { return fs.readFileSync(full); }
        catch { imageErrors.push(`designer:${s.imageFile}`); return null; }
      }
      if (!s.imageUrl) return null;
      const buf = await downloadUrl(s.imageUrl);
      if (!buf) { imageErrors.push(s.imageUrl); return null; }
      return buf;
    }),
  );

  // ── Pass 2: write steps ───────────────────────────────────────────────────
  const written: GuideStep[] = [];
  let created = 0;
  let updated = 0;

  for (let i = 0; i < imported.steps.length; i++) {
    const s        = imported.steps[i];
    const stepId   = stepIds[i];
    const existing = priorById.get(stepId);

    let mediaPath = existing?.mediaPath;
    const buf = imageBuffers[i];
    if (buf) {
      try {
        if (existing?.mediaPath) deleteStepImage(existing.mediaPath);
        mediaPath = writeStepImageBuffer(guide.id, stepId, buf);
      } catch (err) {
        console.error(`[SIB] Failed to save imported image for step ${stepId}:`, err);
        imageErrors.push(s.imageUrl ?? '(write error)');
      }
    }

    const step: GuideStep = {
      id:                 stepId,
      guideId:            guide.id,
      anchorId:           opts.anchorId,
      sequenceNumber:     s.sequenceNumber,
      title:              s.title?.trim()   || undefined,
      text:               s.text.trim(),
      ttsText:            s.ttsText?.trim() || undefined,
      linkUrl:            s.linkUrl?.trim() || undefined,
      mediaType:          mediaPath ? 'image' : undefined,
      mediaPath,
      completionRequired: s.completionRequired ?? true,
      isPlaced:           false,
      nextOnSuccess:      s.nextOnSuccessSeq !== undefined ? seqToId.get(s.nextOnSuccessSeq) : undefined,
      nextOnFailure:      s.nextOnFailureSeq !== undefined ? seqToId.get(s.nextOnFailureSeq) : undefined,
      precondition:       s.preconditionSeq  !== undefined ? seqToId.get(s.preconditionSeq)  : undefined,
      createdAt:          existing?.createdAt ?? now,
      updatedAt:          now,
    };

    // Model ASSIGNMENT from the authoring surface (placement stays device-owned
    // — see carrySpatial).
    const importSetsModel = !!s.modelId;
    if (importSetsModel) {
      step.modelId      = s.modelId;
      step.modelScale   = s.modelScale;
      step.modelOpacity = s.modelOpacity;
    }

    // THE invariant: placement survives every write that isn't from the device.
    if (existing) { carrySpatial(step, existing, importSetsModel); updated++; }
    else          { created++; }

    guideStepStore.save(step);
    written.push(step);
  }

  // ── Remove steps whose node was deleted ───────────────────────────────────
  let removed = 0;
  for (const prior of priorSteps) {
    if (reused.has(prior.id)) continue;
    if (prior.mediaPath) deleteStepImage(prior.mediaPath);
    guideStepStore.delete(prior.id);
    removed++;
  }

  const unplaced = written.filter(s => !s.isPlaced).length;

  console.log(
    `[SIB] Guide ${isUpsert ? 'updated' : 'created'} via ingest: ${guide.id} ("${guide.name}") — ` +
    `${created} created, ${updated} updated, ${removed} removed, ${unplaced} unplaced` +
    (imageErrors.length ? ` (${imageErrors.length} image error(s))` : ''),
  );

  return { guide, steps: written, created, updated, removed, unplaced, imageErrors };
}
