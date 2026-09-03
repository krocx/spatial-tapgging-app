// copy.ts — U2 (2026.4.45): copy a guide onto another anchor.
//
// What travels: name/description, every step's text, voice, title, link,
// completion/validation/evidence flags, branch links (re-pointed to the new
// step ids), step media (file duplicated) and 3D model ASSIGNMENTS (slots
// with scale/opacity; placement stripped).
//
// What deliberately does NOT travel — all of it belongs to the SOURCE
// anchor's world map or to that anchor's Spatial Inspection tags:
//   • pin positions (isPlaced=false; the author re-places on the new tool)
//   • model placement (offsets / rotation)
//   • validation training — single reference photos, cone tags, pass-states
//     (validationTrainedAt/Mode/TagId cleared; the step shows "Train" again)
//   • sharing list (the copy is visible to all technicians until re-shared)
// The copy starts unpublished.

import fs   from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { Guide, GuideStep } from '@spatial/shared';
import { guideStore, guideStepStore, STEP_IMG_DIR, stepImageFilename } from './store.js';
import { stripSlotPlacements } from './step-models.js';

export interface CopyGuideOptions {
  targetAnchorId: string;
  name?:          string;   // default: source name (same anchor → " (copy)")
  createdBy:      string;
}

export interface CopyGuideResult {
  guide: Guide;
  steps: GuideStep[];
}

export function copyGuideToAnchor(source: Guide, opts: CopyGuideOptions): CopyGuideResult {
  const now     = new Date().toISOString();
  const guideId = uuidv4();
  const sameAnchor = opts.targetAnchorId === source.anchorId;
  const name = opts.name?.trim() || (sameAnchor ? `${source.name} (copy)` : source.name);

  const guide: Guide = {
    id:          guideId,
    anchorId:    opts.targetAnchorId,
    name,
    description: source.description,
    published:   false,
    createdBy:   opts.createdBy,
    createdAt:   now,
    updatedAt:   now,
  };

  const srcSteps = guideStepStore.findAll()
    .filter(s => s.guideId === source.id)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  // New ids first so branch links can be re-pointed in one pass.
  const idMap = new Map<string, string>(srcSteps.map(s => [s.id, uuidv4()]));
  const remap = (id?: string): string | undefined => (id ? idMap.get(id) : undefined);

  const steps: GuideStep[] = srcSteps.map(s => {
    const newId = idMap.get(s.id)!;
    let mediaPath: string | undefined;
    if (s.mediaPath) {
      try {
        const dest = stepImageFilename(guideId, newId);
        fs.copyFileSync(path.join(STEP_IMG_DIR, s.mediaPath), path.join(STEP_IMG_DIR, dest));
        mediaPath = dest;
      } catch { mediaPath = undefined; /* missing file — copy without media */ }
    }
    const models = stripSlotPlacements(s.models);
    const first  = models?.[0];
    const step: GuideStep = {
      id:                 newId,
      guideId,
      anchorId:           opts.targetAnchorId,
      sequenceNumber:     s.sequenceNumber,
      title:              s.title,
      text:               s.text,
      ttsText:            s.ttsText,
      mediaType:          mediaPath ? s.mediaType : undefined,
      mediaPath,
      linkUrl:            s.linkUrl,
      completionRequired: s.completionRequired,
      isPlaced:           false,
      // model assignment travels; placement does not (legacy fields mirror slot 1)
      models,
      modelId:            first?.modelId      ?? (models ? undefined : s.modelId),
      modelScale:         first?.modelScale   ?? (models ? undefined : s.modelScale),
      modelOpacity:       first?.modelOpacity ?? (models ? undefined : s.modelOpacity),
      nextOnSuccess:      remap(s.nextOnSuccess),
      nextOnFailure:      remap(s.nextOnFailure),
      precondition:       remap(s.precondition),
      validationRequired: s.validationRequired,
      evidenceRequired:   s.evidenceRequired,
      createdAt:          now,
      updatedAt:          now,
    };
    if (!step.models) delete step.models;
    return step;
  });

  guideStore.save(guide);
  for (const st of steps) guideStepStore.save(st);
  console.log(`[SIB] Guide copied: ${source.id} → ${guideId} on anchor ${opts.targetAnchorId} (${steps.length} steps)`);
  return { guide, steps };
}
