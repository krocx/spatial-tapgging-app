// guide-ingest.test.ts — behaviour lock for the shared guide ingestion service.
//
// applyImportedGuide is the single path from an ImportedGuide to real Guide +
// GuideStep records. It is reached from POST /guides/import and from the
// Procedure Designer export, and will later be reached by an MES connector.
//
// The create-mode cases pin the behaviour POST /guides/import had when the
// logic lived inline in the route handler, so the extraction is provably
// behaviour-preserving. The upsert cases cover the new re-sync semantics.
//
// The most important test in this file is 'placement survives a re-sync':
// that invariant is what makes it safe to re-send a procedure that is in use.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs   from 'fs';
import os   from 'os';
import path from 'path';
import type { ImportedGuide, GuideStep } from '@spatial/shared';

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-ingest-test-'));
process.env.SIB_DATA_DIR = TMP_DATA;   // MUST be set before importing stores

const { applyImportedGuide } = await import('../src/guides/ingest.js');
const { guideStore, guideStepStore } = await import('../src/guides/store.js');

const ANCHOR = 'anchor-1';
const AUTHOR = 'Karthik';

function guideOf(steps: ImportedGuide['steps'], name = 'Test guide'): ImportedGuide {
  return { name, steps };
}

const stepsFor = (guideId: string): GuideStep[] =>
  guideStepStore.findAll()
    .filter(s => s.guideId === guideId)
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

// ── Create mode — pins the original POST /guides/import behaviour ────────────

test('creates a draft guide with steps in sequence order', async () => {
  const r = await applyImportedGuide(
    guideOf([
      { sequenceNumber: 1, title: 'One',   text: 'do one' },
      { sequenceNumber: 2, title: 'Two',   text: 'do two' },
    ]),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );

  assert.equal(r.guide.published, false, 'imports always start as drafts');
  assert.equal(r.guide.createdBy, AUTHOR);
  assert.equal(r.guide.anchorId, ANCHOR);
  assert.equal(r.created, 2);
  assert.equal(r.updated, 0);
  assert.equal(r.removed, 0);
  assert.deepEqual(r.steps.map(s => s.sequenceNumber), [1, 2]);
});

test('every created step starts unplaced', async () => {
  const r = await applyImportedGuide(
    guideOf([{ sequenceNumber: 1, title: 'One', text: 'x' }]),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );
  assert.equal(r.steps[0].isPlaced, false);
  assert.equal(r.unplaced, 1);
});

test('sequence-number branch links resolve to real step ids, including forward references', async () => {
  const r = await applyImportedGuide(
    guideOf([
      { sequenceNumber: 1, title: 'Check', text: 'x', nextOnSuccessSeq: 3, nextOnFailureSeq: 2 },
      { sequenceNumber: 2, title: 'Fix',   text: 'x', nextOnSuccessSeq: 3 },
      { sequenceNumber: 3, title: 'Done',  text: 'x', preconditionSeq: 1 },
    ]),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );

  const [s1, s2, s3] = r.steps;
  assert.equal(s1.nextOnSuccess, s3.id, 'forward reference to a later step must resolve');
  assert.equal(s1.nextOnFailure, s2.id);
  assert.equal(s2.nextOnSuccess, s3.id);
  assert.equal(s3.precondition,  s1.id);
});

test('completionRequired defaults to true and is respected when set false', async () => {
  const r = await applyImportedGuide(
    guideOf([
      { sequenceNumber: 1, title: 'A', text: 'x' },
      { sequenceNumber: 2, title: 'B', text: 'x', completionRequired: false },
    ]),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );
  assert.equal(r.steps[0].completionRequired, true);
  assert.equal(r.steps[1].completionRequired, false);
});

test('blank optional fields become undefined rather than empty strings', async () => {
  const r = await applyImportedGuide(
    guideOf([{ sequenceNumber: 1, title: '  ', text: '  do it  ', ttsText: '  ' }]),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );
  assert.equal(r.steps[0].title, undefined);
  assert.equal(r.steps[0].ttsText, undefined);
  assert.equal(r.steps[0].text, 'do it', 'text is trimmed');
  assert.equal(r.steps[0].mediaType, undefined, 'no image means no mediaType');
});

test('an unreachable image url is non-fatal and reported', async () => {
  const r = await applyImportedGuide(
    guideOf([{ sequenceNumber: 1, title: 'A', text: 'x', imageUrl: 'http://127.0.0.1:1/nope.jpg' }]),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );
  assert.equal(r.created, 1, 'the step is still created');
  assert.equal(r.steps[0].mediaPath, undefined);
  assert.equal(r.imageErrors.length, 1);
});

// ── Upsert mode — new re-sync semantics ─────────────────────────────────────

test('placement survives a re-sync', async () => {
  const first = await applyImportedGuide(
    guideOf([
      { sequenceNumber: 1, title: 'One', text: 'original' },
      { sequenceNumber: 2, title: 'Two', text: 'original' },
    ]),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );

  // Simulate an Author placing both steps in AR on device.
  for (const s of first.steps) {
    guideStepStore.save({
      ...s,
      posX: 1.5, posY: 0.25, posZ: -3,
      isPlaced: true,
      positionSource: 'tap',
      modelId: 'model-9', modelScale: 0.5, modelRotationY: 1.57,
    });
  }

  const again = await applyImportedGuide(
    guideOf([
      { sequenceNumber: 1, title: 'One', text: 'EDITED' },
      { sequenceNumber: 2, title: 'Two', text: 'EDITED' },
    ]),
    {
      anchorId: ANCHOR,
      createdBy: AUTHOR,
      guideId: first.guide.id,
      existingStepIdBySeq: { 1: first.steps[0].id, 2: first.steps[1].id },
    },
  );

  assert.equal(again.created, 0);
  assert.equal(again.updated, 2);
  assert.equal(again.unplaced, 0, 'placed steps stay placed');

  for (const s of again.steps) {
    assert.equal(s.text, 'EDITED', 'structural fields update');
    assert.equal(s.isPlaced, true, 'placement must never be overwritten by a canvas write');
    assert.equal(s.posX, 1.5);
    assert.equal(s.posY, 0.25);
    assert.equal(s.posZ, -3);
    assert.equal(s.positionSource, 'tap');
    assert.equal(s.modelId, 'model-9', 'the AR-placed model transform travels with position');
    assert.equal(s.modelScale, 0.5);
    assert.equal(s.modelRotationY, 1.57);
  }
});

test('re-sync keeps step ids stable so live sessions and evidence stay valid', async () => {
  const first = await applyImportedGuide(
    guideOf([{ sequenceNumber: 1, title: 'One', text: 'x' }]),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );
  const originalId = first.steps[0].id;

  const again = await applyImportedGuide(
    guideOf([{ sequenceNumber: 1, title: 'One renamed', text: 'y' }]),
    {
      anchorId: ANCHOR, createdBy: AUTHOR,
      guideId: first.guide.id,
      existingStepIdBySeq: { 1: originalId },
    },
  );
  assert.equal(again.steps[0].id, originalId);
});

test('a step removed from the canvas is deleted on re-sync', async () => {
  const first = await applyImportedGuide(
    guideOf([
      { sequenceNumber: 1, title: 'Keep',   text: 'x' },
      { sequenceNumber: 2, title: 'Remove', text: 'x' },
    ]),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );

  const again = await applyImportedGuide(
    guideOf([{ sequenceNumber: 1, title: 'Keep', text: 'x' }]),
    {
      anchorId: ANCHOR, createdBy: AUTHOR,
      guideId: first.guide.id,
      existingStepIdBySeq: { 1: first.steps[0].id },
    },
  );

  assert.equal(again.removed, 1);
  assert.equal(stepsFor(first.guide.id).length, 1);
});

test('a step added on the canvas is created and flagged unplaced', async () => {
  const first = await applyImportedGuide(
    guideOf([{ sequenceNumber: 1, title: 'One', text: 'x' }]),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );
  guideStepStore.save({ ...first.steps[0], isPlaced: true, posX: 0, posY: 0, posZ: 0 });

  const again = await applyImportedGuide(
    guideOf([
      { sequenceNumber: 1, title: 'One', text: 'x' },
      { sequenceNumber: 2, title: 'New', text: 'x' },
    ]),
    {
      anchorId: ANCHOR, createdBy: AUTHOR,
      guideId: first.guide.id,
      existingStepIdBySeq: { 1: first.steps[0].id },
    },
  );

  assert.equal(again.created, 1);
  assert.equal(again.updated, 1);
  assert.equal(again.unplaced, 1, 'only the new step needs placing');
});

test('re-sync preserves the guide id, creation time and published flag', async () => {
  const first = await applyImportedGuide(
    guideOf([{ sequenceNumber: 1, title: 'One', text: 'x' }], 'Original name'),
    { anchorId: ANCHOR, createdBy: AUTHOR },
  );
  guideStore.save({ ...first.guide, published: true });

  const again = await applyImportedGuide(
    guideOf([{ sequenceNumber: 1, title: 'One', text: 'x' }], 'New name'),
    {
      anchorId: ANCHOR, createdBy: AUTHOR,
      guideId: first.guide.id,
      existingStepIdBySeq: { 1: first.steps[0].id },
    },
  );

  assert.equal(again.guide.id, first.guide.id);
  assert.equal(again.guide.createdAt, first.guide.createdAt);
  assert.equal(again.guide.name, 'New name', 'the name follows the map');
  assert.equal(again.guide.published, true,
    'ingest does not change publication state — the caller guards that');
});

test('an unknown existing step id falls back to creating a fresh step', async () => {
  const r = await applyImportedGuide(
    guideOf([{ sequenceNumber: 1, title: 'One', text: 'x' }]),
    {
      anchorId: ANCHOR, createdBy: AUTHOR,
      existingStepIdBySeq: { 1: 'does-not-exist' },
    },
  );
  assert.equal(r.created, 1);
  assert.notEqual(r.steps[0].id, 'does-not-exist');
});
