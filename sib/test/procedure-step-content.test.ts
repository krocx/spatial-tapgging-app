// procedure-step-content.test.ts — slice 2: step content flows from canvas
// metadata through the compiler and ingestion into real GuideSteps.
//
// The cases that matter most are the model-semantics ones: assignment
// (modelId/scale/opacity) may come from the canvas, placement
// (offsets/rotationY) is device-owned — and switching models clears the old
// model's placement, because it belonged to a different object.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs   from 'fs';
import os   from 'os';
import path from 'path';
import type { Mindmap, MindmapNode, MindmapEdge, MindmapEdgeRole } from '@spatial/shared';

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-step-content-'));
process.env.SIB_DATA_DIR = TMP_DATA;   // MUST precede store imports

const { compileProcedure }   = await import('../src/procedure/compiler.js');
const { applyImportedGuide } = await import('../src/guides/ingest.js');
const { guideStepStore }     = await import('../src/guides/store.js');
const { saveDesignerImage, DESIGNER_IMG_DIR } = await import('../src/procedure/designer-images.js');

// Minimal valid JPEG (SOI + APP0 header + EOI) — enough for magic-byte checks.
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
  0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

const N = (id: string, x: number, text: string, stepMeta?: Record<string, unknown>): MindmapNode =>
  ({ id, x, y: 0, text, notes: 'body', type: 'generic',
     metadata: stepMeta ? { step: stepMeta } : {}, updatedAt: 1 });

const E = (from: string, to: string, role: MindmapEdgeRole): MindmapEdge =>
  ({ id: `${from}-${to}`, from, to, role, type: 'directed', updatedAt: 1 });

const M = (nodes: MindmapNode[], edges: MindmapEdge[]): Mindmap =>
  ({ id: 'm', name: 'P', createdAt: 1, updatedAt: 1, kind: 'procedure', nodes, edges });

// ── Compiler emission ───────────────────────────────────────────────────────

test('compiler emits voice, optional, image and model from metadata.step', () => {
  const r = compileProcedure(M(
    [N('a', 0, 'S1', {
       ttsText: '  Speak this  ', optional: true, imageFile: 'abc.jpg',
       modelId: 'model-1', modelScale: 0.5, modelOpacity: 0.4,
     }),
     N('b', 100, 'S2')],
    [E('a', 'b', 'next')],
  ));
  assert.equal(r.ok, true);
  const s1 = r.guide!.steps[0];
  assert.equal(s1.ttsText, 'Speak this', 'trimmed');
  assert.equal(s1.completionRequired, false, 'optional → not required');
  assert.equal(s1.imageFile, 'abc.jpg');
  assert.equal(s1.modelId, 'model-1');
  assert.equal(s1.modelScale, 0.5);
  assert.equal(s1.modelOpacity, 0.4);

  const s2 = r.guide!.steps[1];
  assert.equal(s2.completionRequired, true, 'default stays required');
  assert.equal(s2.ttsText, undefined);
  assert.equal(s2.modelId, undefined);
});

test('compiler warns per step without an image, and rejects junk meta values', () => {
  const r = compileProcedure(M(
    [N('a', 0, 'S1', { modelScale: -3, modelOpacity: 7, ttsText: '   ' }),
     N('b', 100, 'S2', { imageFile: 'x.jpg' })],
    [E('a', 'b', 'next')],
  ));
  assert.equal(r.ok, true);
  const noImage = r.issues.filter(i => i.code === 'no-image');
  assert.equal(noImage.length, 1, 'only the imageless step warns');
  assert.equal(noImage[0].nodeId, 'a');
  const s1 = r.guide!.steps[0];
  assert.equal(s1.modelScale, undefined, 'negative scale dropped');
  assert.equal(s1.ttsText, undefined, 'blank tts dropped');
});

test('compiler carries a valid reference link and drops a non-http one', () => {
  const r = compileProcedure(M(
    [N('a', 0, 'S1', { linkUrl: '  https://example.com/sop.pdf  ' }),
     N('b', 100, 'S2', { linkUrl: 'javascript:alert(1)' })],
    [E('a', 'b', 'next')],
  ));
  assert.equal(r.ok, true);
  assert.equal(r.guide!.steps[0].linkUrl, 'https://example.com/sop.pdf', 'trimmed and kept');
  assert.equal(r.guide!.steps[1].linkUrl, undefined, 'non-http scheme dropped');
});

test('ingest writes linkUrl onto the guide step and clears it when absent on re-sync', async () => {
  const first = await applyImportedGuide(
    { name: 'GL', steps: [{ sequenceNumber: 1, title: 'A', text: 'x', linkUrl: 'https://example.com/v' }] },
    { anchorId: 'anchor-l', createdBy: 'K' },
  );
  assert.equal(first.steps[0].linkUrl, 'https://example.com/v');

  // Re-sync with the link removed on the canvas → cleared on the step
  // (authoring-surface-owned, like text — unlike device-owned placement).
  const second = await applyImportedGuide(
    { name: 'GL', steps: [{ sequenceNumber: 1, title: 'A', text: 'x' }] },
    { anchorId: 'anchor-l', createdBy: 'K', guideId: first.guide.id,
      existingStepIdBySeq: { 1: first.steps[0].id } },
  );
  assert.equal(second.updated, 1);
  assert.equal(second.steps[0].id, first.steps[0].id);
  assert.equal(second.steps[0].linkUrl, undefined, 'removed link cleared');
});

// ── Ingest: designer image copy ─────────────────────────────────────────────

test('ingest copies a designer image into the guide step-image store', async () => {
  const filename = saveDesignerImage(TINY_JPEG.toString('base64'));
  assert.ok(fs.existsSync(path.join(DESIGNER_IMG_DIR, filename)));

  const r = await applyImportedGuide(
    { name: 'G', steps: [{ sequenceNumber: 1, title: 'A', text: 'x', imageFile: filename }] },
    { anchorId: 'anchor-1', createdBy: 'K' },
  );
  assert.equal(r.imageErrors.length, 0);
  assert.ok(r.steps[0].mediaPath, 'step gained a media file');
  assert.equal(r.steps[0].mediaType, 'image');
  // The designer original is untouched (content-addressed store keeps it).
  assert.ok(fs.existsSync(path.join(DESIGNER_IMG_DIR, filename)));
});

test('ingest reports a missing designer image as non-fatal', async () => {
  const r = await applyImportedGuide(
    { name: 'G', steps: [{ sequenceNumber: 1, title: 'A', text: 'x', imageFile: 'deadbeefdeadbeefdeadbeef.jpg' }] },
    { anchorId: 'anchor-1', createdBy: 'K' },
  );
  assert.equal(r.steps.length, 1, 'step still created');
  assert.equal(r.steps[0].mediaPath, undefined);
  assert.equal(r.imageErrors.length, 1);
  assert.match(r.imageErrors[0], /^designer:/);
});

// ── Ingest: model assignment vs placement ───────────────────────────────────

test('canvas model assignment applies while device placement survives (same model)', async () => {
  const first = await applyImportedGuide(
    { name: 'G', steps: [{ sequenceNumber: 1, title: 'A', text: 'x', modelId: 'm-1', modelScale: 1 }] },
    { anchorId: 'anchor-1', createdBy: 'K' },
  );
  // Device places the pin AND the ghost model.
  guideStepStore.save({
    ...first.steps[0], isPlaced: true, posX: 1, posY: 2, posZ: 3,
    modelOffsetX: 0.1, modelOffsetY: 0.2, modelOffsetZ: 0.3, modelRotationY: 1.0,
  });

  // Canvas re-sync: same model, new scale.
  const again = await applyImportedGuide(
    { name: 'G', steps: [{ sequenceNumber: 1, title: 'A', text: 'x', modelId: 'm-1', modelScale: 2 }] },
    { anchorId: 'anchor-1', createdBy: 'K',
      guideId: first.guide.id, existingStepIdBySeq: { 1: first.steps[0].id } },
  );
  const s = again.steps[0];
  assert.equal(s.modelScale, 2, 'assignment updated from canvas');
  assert.equal(s.modelOffsetX, 0.1, 'placement survives — same model');
  assert.equal(s.modelRotationY, 1.0);
  assert.equal(s.isPlaced, true);
  assert.equal(s.posX, 1);
});

test('switching models clears the old placement but never the pin position', async () => {
  const first = await applyImportedGuide(
    { name: 'G', steps: [{ sequenceNumber: 1, title: 'A', text: 'x', modelId: 'm-1' }] },
    { anchorId: 'anchor-1', createdBy: 'K' },
  );
  guideStepStore.save({
    ...first.steps[0], isPlaced: true, posX: 5, posY: 6, posZ: 7,
    modelOffsetX: 0.9, modelRotationY: 2.0,
  });

  const again = await applyImportedGuide(
    { name: 'G', steps: [{ sequenceNumber: 1, title: 'A', text: 'x', modelId: 'm-2' }] },
    { anchorId: 'anchor-1', createdBy: 'K',
      guideId: first.guide.id, existingStepIdBySeq: { 1: first.steps[0].id } },
  );
  const s = again.steps[0];
  assert.equal(s.modelId, 'm-2');
  assert.equal(s.modelOffsetX, undefined, 'old model placement cleared');
  assert.equal(s.modelRotationY, undefined);
  assert.equal(s.isPlaced, true, 'the PIN placement is untouched');
  assert.equal(s.posX, 5);
});

test('import silent on models preserves the device assignment entirely', async () => {
  const first = await applyImportedGuide(
    { name: 'G', steps: [{ sequenceNumber: 1, title: 'A', text: 'x' }] },
    { anchorId: 'anchor-1', createdBy: 'K' },
  );
  // Device (iOS editor) assigns and places a model.
  guideStepStore.save({
    ...first.steps[0], modelId: 'device-model', modelScale: 0.7,
    modelOffsetX: 0.4, modelRotationY: 0.5,
  });

  const again = await applyImportedGuide(
    { name: 'G', steps: [{ sequenceNumber: 1, title: 'A edited', text: 'y' }] },
    { anchorId: 'anchor-1', createdBy: 'K',
      guideId: first.guide.id, existingStepIdBySeq: { 1: first.steps[0].id } },
  );
  const s = again.steps[0];
  assert.equal(s.modelId, 'device-model', 'silent import leaves assignment alone');
  assert.equal(s.modelScale, 0.7);
  assert.equal(s.modelOffsetX, 0.4);
});

// ── Designer image store guards ─────────────────────────────────────────────

test('designer image store is content-addressed and validates payloads', () => {
  const a = saveDesignerImage(TINY_JPEG.toString('base64'));
  const b = saveDesignerImage(TINY_JPEG.toString('base64'));
  assert.equal(a, b, 'same bytes → same filename');
  assert.throws(() => saveDesignerImage(Buffer.from('not a jpeg').toString('base64')),
    /Only JPEG/);
  assert.throws(() => saveDesignerImage(''), /Empty/);
});
