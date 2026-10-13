/**
 * Guide lifecycle (2026.4.50): archive hides from technicians; delete moves
 * the guide, its steps, its map and its tags to the trash; restore puts them
 * back; purge removes them; runs are never touched; the integrity report
 * sees a session whose guide is in the trash.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SIB_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-lifecycle-'));
process.env.DATA_DIR = process.env.SIB_DATA_DIR;

const { guideStore, guideStepStore } = await import('../src/guides/store.js');
const { guideSessionStore } = await import('../src/routes/guide-sessions.js');
const { tagStore } = await import('../src/routes/tags.js');
const { mindmapStore } = await import('../src/models/mindmap.model.js');
const { archiveGuide, trashGuide, restoreGuide, purgeTrash, guideTrashStore, runsOf, integrityReport } = await import('../src/guides/lifecycle.js');
const { guideVisibleTo } = await import('../src/uam/guide-visibility.js');

const now = new Date().toISOString();
const guide = { id: 'g-life', anchorId: 'a1', name: 'Life', description: '', published: true, createdBy: 'k', createdAt: now, updatedAt: now } as Parameters<typeof guideStore.save>[0];
const tech = { id: 'u1', email: 't@amat.com', employeeId: 'E', name: 'T', role: 'technician' as const, createdAt: now, updatedAt: now };

test('archive hides the guide from technicians and unpublishes it; restore brings it back', () => {
  guideStore.save(guide);
  const a = archiveGuide(guide, 'mgr@amat.com', true);
  assert.ok(a.archivedAt && !a.published);
  assert.ok(!guideVisibleTo(tech, a));
  const b = archiveGuide(a, 'mgr@amat.com', false);
  assert.ok(!b.archivedAt);
});

test('delete → trash keeps runs, takes steps, map and tags; restore puts them back; purge removes them', () => {
  guideStore.save({ ...guide, published: true });
  guideStepStore.save({ id: 's1', guideId: guide.id, sequenceNumber: 1, title: 'Seat', text: '', createdAt: now, updatedAt: now, validationTagId: 'tag1' } as Parameters<typeof guideStepStore.save>[0]);
  tagStore.save({ id: 'tag1', anchorId: 'a1', name: 'cone', createdAt: now, updatedAt: now } as unknown as Parameters<typeof tagStore.save>[0]);
  mindmapStore.save({ id: 'm1', name: '[Guide] Life', nodes: [], edges: [], createdAt: 1, updatedAt: 1, guideSync: { guideId: guide.id, syncedAt: 1 } } as Parameters<typeof mindmapStore.save>[0]);
  guideSessionStore.save({ id: 'sess1', guideId: guide.id, anchorId: 'a1', guideName: 'Life', anchorName: 'A', signedOffBy: 'x', startedAt: now, completedAt: now, durationSeconds: 1, stepCompletions: [], createdAt: now } as Parameters<typeof guideSessionStore.save>[0]);
  assert.equal(runsOf(guide.id), 1);

  const item = trashGuide(guide, 'owner@amat.com');
  assert.equal(item.runs, 1); assert.equal(item.steps.length, 1); assert.equal(item.tags.length, 1); assert.ok(item.map);
  assert.ok(!guideStore.findById(guide.id)); assert.ok(!guideStepStore.findById('s1')); assert.ok(!tagStore.findById('tag1')); assert.ok(!mindmapStore.findById('m1'));
  assert.ok(guideSessionStore.findById('sess1'), 'runs stay');
  assert.ok(Date.parse(item.expiresAt) - Date.parse(item.deletedAt) >= 29 * 86400_000);

  const rep = integrityReport();
  assert.equal(rep.sessionsWithoutGuide.length, 1); assert.ok(rep.sessionsWithoutGuide[0].inTrash); assert.equal(rep.trash.length, 1);

  const back = restoreGuide(guide.id, 'owner@amat.com');
  assert.ok(back && guideStore.findById(guide.id) && guideStepStore.findById('s1') && tagStore.findById('tag1') && mindmapStore.findById('m1'));
  assert.equal(guideTrashStore.findAll().length, 0);

  trashGuide(guide, 'owner@amat.com');
  assert.ok(purgeTrash(guide.id, 'owner@amat.com'));
  assert.equal(guideTrashStore.findAll().length, 0); assert.ok(!guideStore.findById(guide.id));
  assert.ok(guideSessionStore.findById('sess1'), 'runs stay after purge too');
});
