// loto-core.ts — pure iLOTO domain logic: event validation, derived status,
// quiz grading. No I/O, no Express, no stores — the same pattern as the
// procedure compiler, because this is the code an EHS audit will ask about
// and it must be unit-testable in isolation.
//
// The safety-critical rules live HERE, on the server, not in the client:
// a client that skips a checklist step gets a 4xx, not a quiet pass.
// See docs/ILOTO.md §4 for the contract.

import type {
  LotoPoint,
  LotoPointKind,
  LotoPointModel,
  LotoPointStatus,
  LotoAnchorStatus,
  LotoEvent,
  LotoEventType,
  CreateLotoEventRequest,
  LotoQuizQuestion,
  LotoQuizResultItem,
} from '@spatial/shared';

/** Max 3D asset slots per point (lock + tag + hasp covers the field cases).
 *  Lives here, not in @spatial/shared — that package is types-only at runtime. */
export const LOTO_MAX_MODELS = 3;

// ── Checklist definitions (v1 — docs/ILOTO.md §6) ───────────────────────────
// Keys are part of each event's snapshot, so changing these later never
// rewrites history: old events still show exactly what was confirmed.

export const CHECKLISTS: Record<LotoPointKind, Record<'apply' | 'remove', string[]>> = {
  loto: {
    // Full OSHA sequence. tryTestNoStart is the verification-of-isolation
    // step ("try test") — the one most often skipped in the field, and the
    // one this app exists to make unskippable.
    apply:  ['notifiedAffected', 'shutDown', 'tryTestNoStart'],
    remove: ['toolsRemoved', 'personnelClear', 'notifiedAffected'],
  },
  safeoff: {
    // Out-of-service lock: nobody is inside the equipment, so no try-test
    // mandate and no affected-notification requirement (site decision,
    // docs/ILOTO.md §2).
    apply:  ['shutDown'],
    remove: ['personnelClear'],
  },
};

export class LotoValidationError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'LotoValidationError';
  }
}

/** Events for one point, oldest → newest. createdAt is ISO so string sort is
 *  chronological; equal stamps fall back to stable input order. */
function sortEvents(events: LotoEvent[]): LotoEvent[] {
  return [...events].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
}

/** Latest event wins: apply → locked, any remove → clear. */
export function derivePointStatus(point: LotoPoint, events: LotoEvent[]): LotoPointStatus {
  const own = sortEvents(events.filter(e => e.pointId === point.id));
  const last = own[own.length - 1];
  if (!last || last.type !== 'apply') {
    return { point, state: 'clear', ...(last && { lastEventId: last.id }) };
  }
  return {
    point,
    state:        'locked',
    lockedBy:     last.userId,
    lockedByName: last.userName,
    lockedAt:     last.createdAt,
    ...(last.lockSerial && { lockSerial: last.lockSerial }),
    lastEventId:  last.id,
  };
}

export function deriveAnchorStatus(
  anchorId: string,
  points:   LotoPoint[],
  events:   LotoEvent[],
): LotoAnchorStatus {
  const statuses = points
    .filter(p => p.anchorId === anchorId)
    .map(p => derivePointStatus(p, events));
  const anchorEvents = sortEvents(events.filter(e => e.anchorId === anchorId));
  return {
    anchorId,
    points:        statuses,
    lotoActive:    statuses.filter(s => s.state === 'locked' && s.point.kind === 'loto').length,
    safeOffActive: statuses.filter(s => s.state === 'locked' && s.point.kind === 'safeoff').length,
    ...(anchorEvents.length > 0 && { lastEventAt: anchorEvents[anchorEvents.length - 1].createdAt }),
  };
}

/**
 * The referee. Throws LotoValidationError (→ 4xx) unless the event is
 * legitimate against the point's CURRENT derived state.
 *
 *   apply           — point clear (v1: one active lock per point), full
 *                     checklist for the kind confirmed, photo present.
 *   remove          — point locked, AND the remover is the applier
 *                     (OSHA: one lock, one person).
 *   override-remove — point locked, all three OSHA exception confirmations
 *                     true, supervisor + reason given. Never a silent
 *                     fallback: the client must choose this path explicitly.
 */
export function validateEvent(
  point:   LotoPoint | undefined,
  current: LotoPointStatus | undefined,
  req:     CreateLotoEventRequest,
): void {
  if (!point) throw new LotoValidationError(404, 'Unknown LOTO point');
  if (!req.userId?.trim() || !req.userName?.trim()) {
    throw new LotoValidationError(400, 'userId and userName are required — every event is attributable');
  }
  const type: LotoEventType = req.type;

  if (type === 'apply') {
    if (current?.state === 'locked') {
      throw new LotoValidationError(409,
        `Point is already locked by ${current.lockedByName}. One active lock per point (v1).`);
    }
    const required = CHECKLISTS[point.kind].apply;
    const missing = required.filter(k => req.checklist?.[k] !== true);
    if (missing.length > 0) {
      throw new LotoValidationError(400,
        `Checklist incomplete: ${missing.join(', ')} must be confirmed before applying.`);
    }
    if (!req.photoBase64) {
      throw new LotoValidationError(400,
        'A photo of the applied lock is required evidence for an apply event.');
    }
    return;
  }

  // remove / override-remove
  if (current?.state !== 'locked') {
    throw new LotoValidationError(409, 'Point has no active lock to remove.');
  }

  if (type === 'remove') {
    if (req.userId !== current.lockedBy) {
      throw new LotoValidationError(403,
        `This lock was applied by ${current.lockedByName}. Only they may remove it ` +
        '(one lock, one person). A supervisor override is a separate, documented action.');
    }
    const required = CHECKLISTS[point.kind].remove;
    const missing = required.filter(k => req.checklist?.[k] !== true);
    if (missing.length > 0) {
      throw new LotoValidationError(400,
        `Checklist incomplete: ${missing.join(', ')} must be confirmed before removal.`);
    }
    return;
  }

  if (type === 'override-remove') {
    const o = req.override;
    if (!o) throw new LotoValidationError(400, 'Override details are required for override-remove.');
    if (!o.supervisorName?.trim() || !o.reason?.trim()) {
      throw new LotoValidationError(400, 'Supervisor name and reason are required for an override.');
    }
    if (!(o.verifiedAbsent && o.contactAttempted && o.willInformBeforeReturn)) {
      throw new LotoValidationError(400,
        'All three override conditions must be confirmed: employee verified absent, ' +
        'contact attempted, and they will be informed before returning to work.');
    }
    return;
  }

  throw new LotoValidationError(400, `Unknown event type: ${type as string}`);
}

// ── Model slots (up to LOTO_MAX_MODELS 3D assets per point) ─────────────────

const finiteOrUndef = (v: unknown): number | undefined =>
  typeof v === 'number' && isFinite(v) ? v : undefined;

/**
 * Validates incoming model slots and enforces the placement doctrine PER SLOT:
 * a slot whose modelId CHANGED (matched by slotId against the existing point)
 * has its placement stripped — placement belongs to a shape, and the old
 * shape is gone. Unchanged slots keep whatever placement the client sent
 * (which is how the AR adjust gestures persist).
 *
 * Throws 400 on structural problems; caps at LOTO_MAX_MODELS.
 */
export function sanitizeModelSlots(
  raw:      unknown,
  existing: LotoPointModel[] | undefined,
): LotoPointModel[] {
  if (!Array.isArray(raw)) {
    throw new LotoValidationError(400, 'models must be an array of slots');
  }
  if (raw.length > LOTO_MAX_MODELS) {
    throw new LotoValidationError(400, `A point holds at most ${LOTO_MAX_MODELS} 3D assets.`);
  }
  const prior = new Map((existing ?? []).map(s => [s.slotId, s]));
  const seen = new Set<string>();
  return raw.map((r, i) => {
    const s = r as Record<string, unknown>;
    const slotId  = typeof s.slotId === 'string' && s.slotId.trim() ? s.slotId.trim() : `slot-${i + 1}`;
    const modelId = typeof s.modelId === 'string' ? s.modelId.trim() : '';
    if (!modelId) throw new LotoValidationError(400, `Slot ${i + 1}: modelId is required.`);
    if (seen.has(slotId)) throw new LotoValidationError(400, `Duplicate slotId "${slotId}".`);
    seen.add(slotId);

    const was = prior.get(slotId);
    const modelChanged = !!was && was.modelId !== modelId;
    const slot: LotoPointModel = { slotId, modelId };
    const scale = finiteOrUndef(s.modelScale);
    if (scale !== undefined) slot.modelScale = scale;
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
    // modelChanged → placement deliberately dropped, fresh AR adjust needed.
    return slot;
  });
}

/** The point's slots as the CLIENT should see them: `models` when present,
 *  else the legacy single-model fields lifted into one synthetic slot. */
export function effectiveModelSlots(p: LotoPoint): LotoPointModel[] {
  if (p.models && p.models.length > 0) return p.models;
  if (!p.modelId) return [];
  return [{
    slotId: 'legacy',
    modelId: p.modelId,
    ...(p.modelScale     !== undefined && { modelScale:     p.modelScale }),
    ...(p.modelOffsetX   !== undefined && { modelOffsetX:   p.modelOffsetX }),
    ...(p.modelOffsetY   !== undefined && { modelOffsetY:   p.modelOffsetY }),
    ...(p.modelOffsetZ   !== undefined && { modelOffsetZ:   p.modelOffsetZ }),
    ...(p.modelRotationY !== undefined && { modelRotationY: p.modelRotationY }),
  }];
}

// ── Quiz question validation (admin editing / import) ───────────────────────

export interface QuizQuestionInput {
  prompt:       string;
  choices:      string[];
  correctIndex: number;
  explanation:  string;
}

/**
 * Validates raw question input (portal editor or import file). Throws on the
 * FIRST problem with a message naming the question number — imports are
 * all-or-nothing so a half-imported bank can never exist.
 */
export function validateQuizQuestions(raw: unknown): QuizQuestionInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new LotoValidationError(400, 'Provide a non-empty array of questions.');
  }
  return raw.map((q, i) => {
    const n = i + 1;
    const item = q as Record<string, unknown>;
    const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : '';
    if (!prompt) throw new LotoValidationError(400, `Question ${n}: prompt is required.`);

    const choices = Array.isArray(item.choices)
      ? item.choices.map(c => (typeof c === 'string' ? c.trim() : '')) : [];
    if (choices.length < 2 || choices.length > 6) {
      throw new LotoValidationError(400, `Question ${n}: needs 2–6 choices (got ${choices.length}).`);
    }
    if (choices.some(c => c.length === 0)) {
      throw new LotoValidationError(400, `Question ${n}: choices cannot be empty.`);
    }

    const correctIndex = typeof item.correctIndex === 'number' ? item.correctIndex : NaN;
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) {
      throw new LotoValidationError(400,
        `Question ${n}: correctIndex must be 0–${choices.length - 1}.`);
    }

    const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
    return { prompt, choices, correctIndex, explanation };
  });
}

// ── Quiz grading ────────────────────────────────────────────────────────────

export interface GradeResult {
  score:   number;
  total:   number;
  passed:  boolean;
  results: LotoQuizResultItem[];
}

/** Grades server-side: correct answers never travel to the client inside the
 *  question payload, so the quiz cannot be scraped from the app. */
export function gradeQuiz(
  questions: LotoQuizQuestion[],
  answers:   Record<string, number>,
  passRatio: number,
): GradeResult {
  const results: LotoQuizResultItem[] = questions.map(q => ({
    questionId:   q.id,
    correct:      answers[q.id] === q.correctIndex,
    correctIndex: q.correctIndex,
    explanation:  q.explanation,
  }));
  const score = results.filter(r => r.correct).length;
  const total = questions.length;
  return { score, total, passed: total > 0 && score / total >= passRatio, results };
}
