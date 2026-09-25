// gemba-finding.test.ts - G3: reference-list fields on a finding.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const now = '2026-09-14T00:00:00.000Z';
const lookup = (code: unknown) => {
  const c = String(code ?? '').trim().toUpperCase();
  if (c !== 'P5142') return undefined;
  return {
    area:     { id: 'a14', code: '14', title: '6S Audits', order: 1, active: true, createdAt: now, updatedAt: now },
    question: { id: 'q', focusAreaId: 'a14', code: 'P5142', title: 'Concept Understanding', text: 'Explain 6S', order: 2, active: true, createdAt: now, updatedAt: now },
  };
};

test('resolveFindingFields snapshots the question and validates category/rating', async () => {
  const { resolveFindingFields } = await import('../src/gemba/finding-core.js');
  const f = resolveFindingFields({ questionCode: ' p5142 ', findingCategory: 'ofi', riskRating: '2' }, lookup);
  assert.equal(f.focusAreaCode, '14'); assert.equal(f.focusAreaTitle, '6S Audits');
  assert.equal(f.questionCode, 'P5142'); assert.equal(f.questionTitle, 'Concept Understanding'); assert.equal(f.questionText, 'Explain 6S');
  assert.equal(f.findingCategory, 'OFI'); assert.equal(f.riskRating, 2);
  assert.throws(() => resolveFindingFields({ questionCode: 'NOPE' }, lookup), /Unknown question code "NOPE"/);
  assert.throws(() => resolveFindingFields({ findingCategory: 'MAJOR' }, lookup), /STRENGTH, OFI or NC/);
  assert.throws(() => resolveFindingFields({ riskRating: 4 }, lookup), /0, 1, 2 or 3/);
  assert.deepEqual(resolveFindingFields({}, lookup), {});
  const cleared = resolveFindingFields({ questionCode: null, riskRating: null, findingCategory: '' }, lookup);
  assert.equal(cleared.clearQuestion, true);
  assert.ok('riskRating' in cleared && cleared.riskRating === undefined);
  assert.ok('findingCategory' in cleared && cleared.findingCategory === undefined);
});

test('validateIncomingPhotos bounds count and caption length', async () => {
  const { validateIncomingPhotos, LOC_TAG_MAX_PHOTOS, LOC_TAG_MAX_CAPTION } = await import('../src/gemba/finding-core.js');
  const b64 = 'A'.repeat(100);
  assert.deepEqual(validateIncomingPhotos(undefined), []);
  const ok = validateIncomingPhotos([{ base64: b64, caption: ' x'.repeat(400) }, { base64: b64 }]);
  assert.equal(ok.length, 2);
  assert.ok(ok[0].caption!.length <= LOC_TAG_MAX_CAPTION);
  assert.equal(ok[1].caption, undefined);
  assert.throws(() => validateIncomingPhotos([{ base64: 'short' }]), /Photo 1/);
  assert.throws(() => validateIncomingPhotos(Array.from({ length: LOC_TAG_MAX_PHOTOS + 1 }, () => ({ base64: b64 }))), /at most/);
  assert.throws(() => validateIncomingPhotos([{ base64: b64 }], LOC_TAG_MAX_PHOTOS), /at most/);
  assert.throws(() => validateIncomingPhotos('nope'), /array/);
});

test('applyCaptionEdits + defaultTitle', async () => {
  const { applyCaptionEdits, defaultTitle } = await import('../src/gemba/finding-core.js');
  const photos = [{ path: 'a.jpg', caption: 'old', capturedAt: now }, { path: 'b.jpg', capturedAt: now }];
  const out = applyCaptionEdits(photos, [{ path: 'a.jpg', caption: '' }, { path: 'b.jpg', caption: 'new' }, { path: 'zzz', caption: 'x' }]);
  assert.equal(out[0].caption, undefined); assert.equal(out[1].caption, 'new'); assert.equal(out.length, 2);
  assert.equal(applyCaptionEdits(photos, 'junk'), photos);
  assert.equal(defaultTitle({ questionCode: 'P5142', questionTitle: 'Concept Understanding' }, 'x'), 'P5142 - Concept Understanding');
  assert.equal(defaultTitle({}, 'Fallback'), 'Fallback');
});

test('custom (free-text) entries carry the same shape but no codes and source "custom"', async () => {
  const { resolveFindingFields, defaultTitle } = await import('../src/gemba/finding-core.js');
  const f = resolveFindingFields({ customFocusArea: ' Tool Setup ', customQuestion: '  Is the torque wrench calibrated?  ', findingCategory: 'NC', riskRating: 3 }, lookup);
  assert.equal(f.referenceSource, 'custom');
  assert.equal(f.focusAreaCode, undefined); assert.equal(f.questionCode, undefined);
  assert.equal(f.focusAreaTitle, 'Tool Setup');
  assert.equal(f.questionText, 'Is the torque wrench calibrated?');
  assert.equal(f.questionTitle, 'Is the torque wrench calibrated?');
  assert.equal(f.findingCategory, 'NC'); assert.equal(f.riskRating, 3);
  assert.equal(defaultTitle(f, 'fallback'), 'Is the torque wrench calibrated?');
  // Long text → truncated title, full text kept.
  const long = 'x'.repeat(100);
  const g = resolveFindingFields({ customQuestion: long }, lookup);
  assert.equal(g.questionTitle?.length, 58); assert.equal(g.questionText, long);
  // Library code wins over custom text; empty custom question is rejected.
  const h = resolveFindingFields({ questionCode: 'P5142', customQuestion: 'ignored' }, lookup);
  assert.equal(h.referenceSource, 'library'); assert.equal(h.questionCode, 'P5142');
  assert.throws(() => resolveFindingFields({ customQuestion: '   ' }, lookup), /customQuestion cannot be empty/);
  // A stray customFocusArea alone is ignored (no question → nothing resolved).
  assert.deepEqual(resolveFindingFields({ customFocusArea: 'Area' }, lookup), {});
});
