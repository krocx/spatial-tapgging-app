// step-validation.ts — Spatial Inspection for AR OMS steps (K4, 2026.4.45).
//
// One reference photo per (guide, step), captured by the Author in-app
// ("train"), verified with a live test compare, published with the guide.
// The Operator's live frame is scored against it by the SAME comparator
// engine tag inspection uses (coarse translation registration → SSIM +
// patch-grid) — one perception doctrine across the platform.
//
// Storage: <DATA_DIR>/guide-step-validation/<guideId>-<stepId>.jpg
// The step's `validationTrainedAt` stamp is owned by the routes layer.

import fs from 'fs';
import path from 'path';
import { compareAgainstPassState } from '../perception/image-comparator.js';

const DATA_DIR       = process.env.DATA_DIR ?? './data';
const VALIDATION_DIR = path.join(DATA_DIR, 'guide-step-validation');

function refPath(guideId: string, stepId: string): string {
  return path.join(VALIDATION_DIR, `${guideId}-${stepId}.jpg`);
}

export function saveValidationRef(guideId: string, stepId: string, base64: string): void {
  fs.mkdirSync(VALIDATION_DIR, { recursive: true });
  fs.writeFileSync(refPath(guideId, stepId), Buffer.from(base64, 'base64'));
}

export function hasValidationRef(guideId: string, stepId: string): boolean {
  return fs.existsSync(refPath(guideId, stepId));
}

export function deleteValidationRef(guideId: string, stepId: string): void {
  try { fs.unlinkSync(refPath(guideId, stepId)); } catch { /* absent is fine */ }
}

export interface StepValidationVerdict {
  status: 'PASS' | 'FAIL';
  score:  number;
}

/**
 * Score a live frame against the step's trained reference.
 * Returns null when the step has no reference (caller falls back to manual).
 */
export async function validateStepFrame(
  guideId: string,
  stepId: string,
  liveBase64: string,
): Promise<StepValidationVerdict | null> {
  const p = refPath(guideId, stepId);
  if (!fs.existsSync(p)) return null;
  const ref = fs.readFileSync(p).toString('base64');
  const r = await compareAgainstPassState([ref], liveBase64);
  return { status: r.status, score: r.score };
}
