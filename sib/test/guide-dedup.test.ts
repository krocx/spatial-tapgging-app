/**
 * Import de-duplication (2026.4.50, backlog #2): a same-name guide is found
 * (trash excluded, newest wins); an update through the ingest path keeps the
 * guide id, the step ids by position, placement and validation training,
 * and adds or removes steps at the end.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SIB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-dedup-'));
process.env.DATA_DIR = process.env.SIB_DATA_DIR;

const { guideStore, guideStepStore } = await import('../src/guides/store.js');
const { findExistingGuide, existingStepIdsBySeq } = await import('../src/guides/dedup.js');
const { applyImportedGuide } = await import('../src/guides/ingest.js');

const now = new Date().toISOString();
const imported = (n: number, name = 'Bee Assembly (V.04.04)') => ({
  name, steps: Array.from({ length: n }, (_, i) => ({ sequenceNumber: i + 1, title: `Step ${i + 1} v2`, text: `do ${i + 1}`, completionRequired: true })),
});

test('same-name guide is found; the newest wins; whitespace and case do not matter', () => {
  guideStore.save({ id: 'g-old', anchorId: 'a1', name: 'Bee Assembly (V.04.04)', description: '', published: false, createdBy: 'k', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } as Parameters<typeof guideStore.save>[0]);
  guideStore.save({ id: 'g-new', anchorId: 'a1', name: 'bee  assembly (v.04.04) ', description: '', published: true, createdBy: 'k', createdAt: now, updatedAt: now } as Parameters<typeof guideStore.save>[0]);
  const m = findExistingGuide('Bee Assembly (V.04.04)', 'a1');
  assert.equal(m?.guideId, 'g-new');
  assert.equal(m?.matches, 2);
  assert.equal(findExistingGuide('Hydraulic Press', 'a1'), null);
});

test('update keeps the guide id, the step ids by position, placement and validation training', async () => {
  const first = await applyImportedGuide(imported(3, 'Drill Driver'), { anchorId: 'a1', createdBy: 'k' });
  const gid = first.guide.id;
  const s2 = { ...first.steps[1], posX: 1, posY: 2, posZ: 3, isPlaced: true, positionSource: 'tap', validationTrainedAt: now, validationMode: 'cone', validationTagId: 'tag-7' } as Parameters<typeof guideStepStore.save>[0];
  guideStepStore.save(s2);

  const inc = imported(4, 'Drill Driver');
  const second = await applyImportedGuide(inc, { anchorId: 'a1', createdBy: 'k', guideId: gid, existingStepIdBySeq: existingStepIdsBySeq(gid, inc.steps.map(s => s.sequenceNumber)) });
  assert.equal(second.guide.id, gid);
  assert.equal(second.updated, 3); assert.equal(second.created, 1); assert.equal(second.removed, 0);
  const kept = second.steps[1];
  assert.equal(kept.id, s2.id);
  assert.equal(kept.title, 'Step 2 v2');
  assert.equal(kept.posX, 1); assert.ok(kept.isPlaced);
  assert.equal(kept.validationTagId, 'tag-7'); assert.equal(kept.validationMode, 'cone');
  assert.equal(guideStepStore.findAll().filter(s => s.guideId === gid).length, 4);

  const inc2 = imported(2, 'Drill Driver');
  const third = await applyImportedGuide(inc2, { anchorId: 'a1', createdBy: 'k', guideId: gid, existingStepIdBySeq: existingStepIdsBySeq(gid, inc2.steps.map(s => s.sequenceNumber)) });
  assert.equal(third.removed, 2);
  assert.equal(guideStepStore.findAll().filter(s => s.guideId === gid).length, 2);
});
