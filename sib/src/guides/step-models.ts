// step-models.ts — U4 (2026.4.45): multiple 3D assets per guide step.
//
// Doctrine (mirrors sib/src/loto/loto-core.ts model slots):
//   • A step holds up to GUIDE_STEP_MAX_MODELS slots, each its own model,
//     scale, opacity and DEVICE-owned placement (offsets from the pin + Y rot).
//   • Placement belongs to a SHAPE: a slot whose modelId changes loses it.
//   • The legacy single-model fields on GuideStep (modelId, modelScale, …)
//     are kept MIRRORED to slot 1 in both directions so older app builds,
//     the procedure compiler, imports and the portal keep working unchanged.
//
// This module is pure (no store access) so it is unit-testable.

import type { GuideStep, GuideStepModel } from '@spatial/shared';

export const GUIDE_STEP_MAX_MODELS = 3;

export class StepModelsError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'StepModelsError';
  }
}

const finiteOrUndef = (v: unknown): number | undefined =>
  typeof v === 'number' && isFinite(v) ? v : undefined;

/** The step's slots as a CLIENT should see them: `models` when present, else
 *  the legacy fields lifted into one synthetic slot (or none). */
export function effectiveStepModels(step: GuideStep): GuideStepModel[] {
  if (step.models && step.models.length > 0) return step.models;
  return slotsFromLegacy(step);
}

function slotsFromLegacy(step: GuideStep): GuideStepModel[] {
  if (!step.modelId) return [];
  return [{
    slotId: 'slot-1',
    modelId: step.modelId,
    ...(step.modelScale     !== undefined && { modelScale:     step.modelScale }),
    ...(step.modelOpacity   !== undefined && { modelOpacity:   step.modelOpacity }),
    ...(step.modelOffsetX   !== undefined && { modelOffsetX:   step.modelOffsetX }),
    ...(step.modelOffsetY   !== undefined && { modelOffsetY:   step.modelOffsetY }),
    ...(step.modelOffsetZ   !== undefined && { modelOffsetZ:   step.modelOffsetZ }),
    ...(step.modelRotationY !== undefined && { modelRotationY: step.modelRotationY }),
  }];
}

/**
 * Validate an incoming `models` array against the step's existing slots.
 * Throws StepModelsError(400) on structural problems; caps at the max.
 */
export function sanitizeStepModelSlots(raw: unknown, existing: GuideStepModel[] | undefined): GuideStepModel[] {
  if (!Array.isArray(raw)) throw new StepModelsError(400, 'models must be an array of slots');
  if (raw.length > GUIDE_STEP_MAX_MODELS) {
    throw new StepModelsError(400, `A step holds at most ${GUIDE_STEP_MAX_MODELS} 3D models.`);
  }
  const prior = new Map((existing ?? []).map(s => [s.slotId, s]));
  const seen  = new Set<string>();
  return raw.map((r, i) => {
    const s = (r ?? {}) as Record<string, unknown>;
    const slotId  = typeof s.slotId === 'string' && s.slotId.trim() ? s.slotId.trim() : `slot-${i + 1}`;
    const modelId = typeof s.modelId === 'string' ? s.modelId.trim() : '';
    if (!modelId) throw new StepModelsError(400, `Slot ${i + 1}: modelId is required.`);
    if (seen.has(slotId)) throw new StepModelsError(400, `Duplicate slotId "${slotId}".`);
    seen.add(slotId);

    const was = prior.get(slotId);
    const modelChanged = !!was && was.modelId !== modelId;
    const slot: GuideStepModel = { slotId, modelId };
    const scale   = finiteOrUndef(s.modelScale);
    const opacity = finiteOrUndef(s.modelOpacity);
    if (scale   !== undefined && scale > 0)                   slot.modelScale   = scale;
    if (opacity !== undefined && opacity >= 0 && opacity <= 1) slot.modelOpacity = opacity;
    if (!modelChanged) {
      const ox = finiteOrUndef(s.modelOffsetX);
      const oy = finiteOrUndef(s.modelOffsetY);
      const oz = finiteOrUndef(s.modelOffsetZ);
      const ry = finiteOrUndef(s.modelRotationY);
      if (ox !== undefined) slot.modelOffsetX   = ox;
      if (oy !== undefined) slot.modelOffsetY   = oy;
      if (oz !== undefined) slot.modelOffsetZ   = oz;
      if (ry !== undefined) slot.modelRotationY = ry;
    }
    return slot;
  });
}

/** After `models` was written: mirror slot 1 into the legacy fields
 *  (or clear them when there are no slots). Mutates and returns the step. */
export function applySlotsToLegacy(step: GuideStep): GuideStep {
  const first = step.models?.[0];
  step.modelId        = first?.modelId;
  step.modelScale     = first?.modelScale;
  step.modelOpacity   = first?.modelOpacity;
  step.modelOffsetX   = first?.modelOffsetX;
  step.modelOffsetY   = first?.modelOffsetY;
  step.modelOffsetZ   = first?.modelOffsetZ;
  step.modelRotationY = first?.modelRotationY;
  if (step.models && step.models.length === 0) delete step.models;
  return step;
}

/** After the legacy fields were written (older app, compiler, import):
 *  rewrite slot 1 to match, keeping every other slot untouched. A cleared
 *  legacy modelId removes slot 1 only. Mutates and returns the step. */
export function applyLegacyToSlots(step: GuideStep): GuideStep {
  const rest = (step.models ?? []).slice(1);
  if (!step.modelId) {
    // Legacy clear = "remove slot 1". The next slot moves up and becomes the
    // new slot 1, so the legacy fields are re-mirrored from it (invariant:
    // legacy fields == slot 1, always).
    step.models = rest;
    return applySlotsToLegacy(step);
  }
  const keepId = step.models?.[0]?.slotId ?? 'slot-1';
  const first: GuideStepModel = { slotId: keepId, modelId: step.modelId };
  if (step.modelScale     !== undefined) first.modelScale     = step.modelScale;
  if (step.modelOpacity   !== undefined) first.modelOpacity   = step.modelOpacity;
  if (step.modelOffsetX   !== undefined) first.modelOffsetX   = step.modelOffsetX;
  if (step.modelOffsetY   !== undefined) first.modelOffsetY   = step.modelOffsetY;
  if (step.modelOffsetZ   !== undefined) first.modelOffsetZ   = step.modelOffsetZ;
  if (step.modelRotationY !== undefined) first.modelRotationY = step.modelRotationY;
  step.models = [first, ...rest];
  return step;
}

/** Strip DEVICE-owned placement from every slot (guide moved/copied to another
 *  anchor: positions belonged to the old world map). Keeps assignments. */
export function stripSlotPlacements(models: GuideStepModel[] | undefined): GuideStepModel[] | undefined {
  if (!models) return undefined;
  return models.map(({ slotId, modelId, modelScale, modelOpacity }) => ({
    slotId, modelId,
    ...(modelScale   !== undefined && { modelScale }),
    ...(modelOpacity !== undefined && { modelOpacity }),
  }));
}

export const LEGACY_MODEL_KEYS = [
  'modelId', 'modelScale', 'modelOpacity',
  'modelOffsetX', 'modelOffsetY', 'modelOffsetZ', 'modelRotationY',
] as const;
