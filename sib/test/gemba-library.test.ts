// gemba-library.test.ts — G1 Audit Reference Library: validation, import
// planning (atomic, upsert-by-code), flat-row conversion, seed shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const now = '2026-09-14T00:00:00.000Z';
const area = (code: string, id = 'a-' + code) => ({ id, code, title: 'Area ' + code, order: 1, active: true, createdAt: now, updatedAt: now });
const q = (code: string, focusAreaId: string) => ({ id: 'q-' + code, focusAreaId, code, title: 'T', text: 'Text', order: 1, active: true, createdAt: now, updatedAt: now });

test('validateFocusArea / validateQuestion normalise codes and require fields', async () => {
  const { validateFocusArea, validateQuestion, GembaValidationError } = await import('../src/gemba/library-core.js');
  assert.deepEqual(validateFocusArea({ code: ' 14 ', title: '  6S Audits ' }), { code: '14', title: '6S Audits' });
  assert.throws(() => validateFocusArea({ title: 'x' }), GembaValidationError);
  assert.throws(() => validateFocusArea({ code: '1' }), GembaValidationError);
  const vq = validateQuestion({ code: 'p5142', text: 'Ask people to explain the 6S program.' });
  assert.equal(vq.code, 'P5142');
  assert.equal(vq.title, 'Ask people to explain the 6S program.');   // title defaults from text
  assert.throws(() => validateQuestion({ code: 'P1', text: '' }), /text is required/);
});

test('planImport: append upserts by code, replace counts everything as new', async () => {
  const { planImport } = await import('../src/gemba/library-core.js');
  const areas = [area('14')];
  const qs = [q('P5141', 'a-14')];
  const payload = { focusAreas: [
    { code: '14', title: '6S Audits (renamed)', questions: [{ code: 'p5141', text: 'updated' }, { code: 'P5142', text: 'new' }] },
    { code: '15', title: 'New area' },
  ] };
  const plan = planImport(payload, areas, qs);
  assert.equal(plan.mode, 'append');
  assert.deepEqual(plan.counts, { areasNew: 1, areasUpdated: 1, questionsNew: 1, questionsUpdated: 1 });
  assert.equal(plan.focusAreas[0].existing?.id, 'a-14');
  assert.equal(plan.focusAreas[0].questions[0].existing?.id, 'q-P5141');
  assert.equal(plan.focusAreas[0].questions[0].input.order, 1);
  assert.equal(plan.focusAreas[1].input.order, 2);

  const rep = planImport({ ...payload, mode: 'replace' }, areas, qs);
  assert.deepEqual(rep.counts, { areasNew: 2, areasUpdated: 0, questionsNew: 2, questionsUpdated: 0 });
});

test('planImport rejects duplicates and bad rows before anything is applied', async () => {
  const { planImport } = await import('../src/gemba/library-core.js');
  assert.throws(() => planImport({ focusAreas: [] }, [], []), /non-empty/);
  assert.throws(() => planImport({ focusAreas: [{ code: '1', title: 'a' }, { code: '1', title: 'b' }] }, [], []), /appears twice/);
  assert.throws(() => planImport({ focusAreas: [
    { code: '1', title: 'a', questions: [{ code: 'Q1', text: 'x' }] },
    { code: '2', title: 'b', questions: [{ code: 'q1', text: 'y' }] },
  ] }, [], []), /Question code "Q1" appears twice/);
  assert.throws(() => planImport({ focusAreas: [{ code: '1', title: 'a', questions: [{ code: 'Q1', text: '' }] }] }, [], []), /question 1/);
});

test('rowsToImport groups flat xlsx rows into focus areas', async () => {
  const { rowsToImport } = await import('../src/gemba/library-core.js');
  const out = rowsToImport([
    { areaCode: '14', areaTitle: '6S Audits', code: 'P5141', title: '6S Procedure Awareness', text: 'Ask…' },
    { areaCode: '14', areaTitle: '',          code: 'P5142', title: 'Concept Understanding',  text: 'Explain…' },
    { areaCode: '1',  areaTitle: 'Quality policy awareness' },
  ]);
  assert.equal(out.mode, 'append');
  assert.equal(out.focusAreas.length, 2);
  assert.equal(out.focusAreas[0].title, '6S Audits');
  assert.equal(out.focusAreas[0].questions?.length, 2);
  assert.equal(out.focusAreas[1].questions?.length, 0);
  assert.throws(() => rowsToImport([{ code: 'P1', text: 'x' }]), /focus area code is missing/);
});

test('seed library is the 15 focus areas, no questions', async () => {
  const { buildSeedLibrary, planImport, GEMBA_FINDING_CATEGORIES, GEMBA_RISK_RATINGS, isFindingCategory, isRiskRating } = await import('../src/gemba/library-core.js');
  const plan = planImport(buildSeedLibrary(), [], []);
  assert.equal(plan.mode, 'replace');
  assert.equal(plan.counts.areasNew, 15);
  assert.equal(plan.counts.questionsNew, 0);
  assert.equal(plan.focusAreas[14].input.code, '15');
  assert.deepEqual(GEMBA_FINDING_CATEGORIES.map(c => c.code), ['STRENGTH', 'OFI', 'NC']);
  assert.deepEqual(GEMBA_RISK_RATINGS.map(r => r.value), [0, 1, 2, 3]);
  assert.ok(isFindingCategory('OFI') && !isFindingCategory('ofi'));
  assert.ok(isRiskRating(2) && !isRiskRating(4) && !isRiskRating('2'));
});
