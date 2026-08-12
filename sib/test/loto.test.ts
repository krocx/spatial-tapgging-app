// loto.test.ts — the safety-critical rules of iLOTO, tested against the pure
// core (loto-core.ts) plus the seeded quiz bank's integrity.
//
// These are the rules an EHS audit will ask about:
//   • checklist cannot be skipped (per kind, per direction)
//   • one active lock per point (v1)
//   • one lock, one person — removal only by the applier
//   • override requires all three OSHA exception confirmations
//   • status is derived from the event log, latest event wins

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  LotoPoint, LotoEvent, CreateLotoEventRequest, LotoOverride,
} from '@spatial/shared';

import {
  validateEvent,
  derivePointStatus,
  deriveAnchorStatus,
  gradeQuiz,
  LotoValidationError,
  CHECKLISTS,
} from '../src/loto/loto-core.js';
import { buildSeedQuestions } from '../src/loto/quiz-seed.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const P = (id: string, kind: 'safeoff' | 'loto'): LotoPoint => ({
  id, anchorId: 'panel-1', kind, label: `${kind}-${id}`,
  position: { x: 0, y: 0, z: 0 },
  createdBy: 'author', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});

let seq = 0;
const E = (pointId: string, type: LotoEvent['type'], userId: string, at?: string): LotoEvent => ({
  id: `e${++seq}`, anchorId: 'panel-1', pointId, type,
  userId, userName: userId.toUpperCase(),
  checklist: {}, createdAt: at ?? `2026-02-01T00:0${seq}:00Z`,
});

const fullChecklist = (keys: string[]): Record<string, boolean> =>
  Object.fromEntries(keys.map(k => [k, true]));

const applyReq = (point: LotoPoint, userId: string, over: Partial<CreateLotoEventRequest> = {}): CreateLotoEventRequest => ({
  anchorId: point.anchorId, pointId: point.id, type: 'apply',
  userId, userName: userId.toUpperCase(),
  checklist: fullChecklist(CHECKLISTS[point.kind].apply),
  photoBase64: 'ZmFrZQ==',
  ...over,
});

const removeReq = (point: LotoPoint, userId: string, over: Partial<CreateLotoEventRequest> = {}): CreateLotoEventRequest => ({
  anchorId: point.anchorId, pointId: point.id, type: 'remove',
  userId, userName: userId.toUpperCase(),
  checklist: fullChecklist(CHECKLISTS[point.kind].remove),
  ...over,
});

const okOverride: LotoOverride = {
  supervisorName: 'SUP', reason: 'Employee left site, shift ended',
  verifiedAbsent: true, contactAttempted: true, willInformBeforeReturn: true,
};

const expectReject = (status: number, fn: () => void, label: string): void => {
  try { fn(); assert.fail(`${label}: expected rejection`); }
  catch (err) {
    assert.ok(err instanceof LotoValidationError, `${label}: wrong error type`);
    assert.equal(err.status, status, `${label}: wrong status (${(err as Error).message})`);
  }
};

// ── Derived status ──────────────────────────────────────────────────────────

test('status: no events → clear; apply → locked with owner; remove → clear again', () => {
  const p = P('a', 'loto');
  assert.equal(derivePointStatus(p, []).state, 'clear');

  const applied = derivePointStatus(p, [E('a', 'apply', 'kar')]);
  assert.equal(applied.state, 'locked');
  assert.equal(applied.lockedBy, 'kar');

  const cleared = derivePointStatus(p, [E('a', 'apply', 'kar'), E('a', 'remove', 'kar')]);
  assert.equal(cleared.state, 'clear');
});

test('status: latest event wins regardless of input order', () => {
  const p = P('a', 'loto');
  const e1 = E('a', 'apply', 'kar', '2026-02-01T08:00:00Z');
  const e2 = E('a', 'remove', 'kar', '2026-02-01T09:00:00Z');
  const e3 = E('a', 'apply', 'bob', '2026-02-01T10:00:00Z');
  const s = derivePointStatus(p, [e3, e1, e2]);   // shuffled on purpose
  assert.equal(s.state, 'locked');
  assert.equal(s.lockedBy, 'bob');
});

test('status: override-remove clears the point', () => {
  const p = P('a', 'loto');
  const s = derivePointStatus(p, [E('a', 'apply', 'kar'), E('a', 'override-remove', 'sup')]);
  assert.equal(s.state, 'clear');
});

test('anchor status: counts red and yellow separately, ignores other anchors', () => {
  const pts = [P('a', 'loto'), P('b', 'loto'), P('c', 'safeoff')];
  const foreign: LotoEvent = { ...E('z', 'apply', 'x'), anchorId: 'panel-2' };
  const s = deriveAnchorStatus('panel-1', pts,
    [E('a', 'apply', 'kar'), E('c', 'apply', 'kar'), foreign]);
  assert.equal(s.lotoActive, 1);
  assert.equal(s.safeOffActive, 1);
  assert.equal(s.points.length, 3);
});

// ── Apply validation ────────────────────────────────────────────────────────

test('apply: full checklist + photo accepted for both kinds', () => {
  for (const kind of ['loto', 'safeoff'] as const) {
    const p = P('a', kind);
    validateEvent(p, derivePointStatus(p, []), applyReq(p, 'kar'));   // must not throw
  }
});

test('apply: missing any required checklist key is rejected (LOTO try test included)', () => {
  const p = P('a', 'loto');
  for (const key of CHECKLISTS.loto.apply) {
    const checklist = fullChecklist(CHECKLISTS.loto.apply);
    checklist[key] = false;
    expectReject(400,
      () => validateEvent(p, derivePointStatus(p, []), applyReq(p, 'kar', { checklist })),
      `checklist key ${key}`);
  }
});

test('apply: photo evidence is mandatory', () => {
  const p = P('a', 'loto');
  expectReject(400,
    () => validateEvent(p, derivePointStatus(p, []), applyReq(p, 'kar', { photoBase64: undefined })),
    'missing photo');
});

test('apply: second lock on a locked point is rejected (one active lock, v1)', () => {
  const p = P('a', 'loto');
  const current = derivePointStatus(p, [E('a', 'apply', 'kar')]);
  expectReject(409, () => validateEvent(p, current, applyReq(p, 'bob')), 'double lock');
});

test('apply: unknown point → 404; anonymous user → 400', () => {
  const p = P('a', 'loto');
  expectReject(404, () => validateEvent(undefined, undefined, applyReq(p, 'kar')), 'unknown point');
  expectReject(400,
    () => validateEvent(p, derivePointStatus(p, []), applyReq(p, '  ', { userName: '' })),
    'anonymous');
});

// ── Remove validation ───────────────────────────────────────────────────────

test('remove: applier may remove with full checklist', () => {
  const p = P('a', 'loto');
  const current = derivePointStatus(p, [E('a', 'apply', 'kar')]);
  validateEvent(p, current, removeReq(p, 'kar'));   // must not throw
});

test('remove: anyone else is rejected 403 — one lock, one person', () => {
  const p = P('a', 'loto');
  const current = derivePointStatus(p, [E('a', 'apply', 'kar')]);
  expectReject(403, () => validateEvent(p, current, removeReq(p, 'bob')), 'foreign removal');
});

test('remove: clear point → 409; incomplete checklist → 400', () => {
  const p = P('a', 'loto');
  expectReject(409, () => validateEvent(p, derivePointStatus(p, []), removeReq(p, 'kar')), 'nothing to remove');
  const current = derivePointStatus(p, [E('a', 'apply', 'kar')]);
  expectReject(400,
    () => validateEvent(p, current, removeReq(p, 'kar', { checklist: { toolsRemoved: true } })),
    'partial checklist');
});

// ── Override validation ─────────────────────────────────────────────────────

test('override-remove: all three confirmations + supervisor + reason accepted', () => {
  const p = P('a', 'loto');
  const current = derivePointStatus(p, [E('a', 'apply', 'kar')]);
  validateEvent(p, current,
    removeReq(p, 'sup', { type: 'override-remove', override: okOverride }));   // must not throw
});

test('override-remove: any missing confirmation or blank field is rejected', () => {
  const p = P('a', 'loto');
  const current = derivePointStatus(p, [E('a', 'apply', 'kar')]);
  const cases: Array<Partial<LotoOverride>> = [
    { verifiedAbsent: false },
    { contactAttempted: false },
    { willInformBeforeReturn: false },
    { supervisorName: ' ' },
    { reason: '' },
  ];
  for (const brokenPatch of cases) {
    expectReject(400, () => validateEvent(p, current, removeReq(p, 'sup', {
      type: 'override-remove', override: { ...okOverride, ...brokenPatch },
    })), `override ${JSON.stringify(brokenPatch)}`);
  }
  expectReject(400, () => validateEvent(p, current,
    removeReq(p, 'sup', { type: 'override-remove' })), 'override without details');
});

// ── Quiz ────────────────────────────────────────────────────────────────────

test('quiz: seed bank is well-formed (4 choices, correctIndex in range, unique ids)', () => {
  const qs = buildSeedQuestions('2026-01-01T00:00:00Z');
  assert.ok(qs.length >= 15, 'bank has a real number of questions');
  const ids = new Set(qs.map(q => q.id));
  assert.equal(ids.size, qs.length, 'ids unique');
  for (const q of qs) {
    assert.ok(q.choices.length === 4, `${q.id}: 4 choices`);
    assert.ok(q.correctIndex >= 0 && q.correctIndex < q.choices.length, `${q.id}: index in range`);
    assert.ok(q.explanation.length > 20, `${q.id}: has a real explanation`);
  }
});

test('quiz: grading — pass at ratio, fail below, per-question feedback', () => {
  const qs = buildSeedQuestions('2026-01-01T00:00:00Z').slice(0, 10);
  const allRight = Object.fromEntries(qs.map(q => [q.id, q.correctIndex]));
  const perfect = gradeQuiz(qs, allRight, 0.8);
  assert.equal(perfect.score, 10);
  assert.equal(perfect.passed, true);

  // 7 of 10 with an 0.8 threshold fails; unanswered counts as wrong.
  const sevenRight = Object.fromEntries(qs.slice(0, 7).map(q => [q.id, q.correctIndex]));
  const partial = gradeQuiz(qs, sevenRight, 0.8);
  assert.equal(partial.score, 7);
  assert.equal(partial.passed, false);
  assert.equal(partial.results.filter(r => !r.correct).length, 3);

  const empty = gradeQuiz([], {}, 0.8);
  assert.equal(empty.passed, false, 'empty bank can never pass');
});
