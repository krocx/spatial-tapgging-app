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
  LotoPointStatus,
  LotoAnchorStatus,
  LotoEvent,
  LotoEventType,
  CreateLotoEventRequest,
  LotoQuizQuestion,
  LotoQuizResultItem,
} from '@spatial/shared';

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
