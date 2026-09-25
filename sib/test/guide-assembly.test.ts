// guide-assembly.test.ts - AR OJT slice 1: one assembly pose per guide, every
// CAD-positioned step derives from it (pins + assembly slot offsets), the
// chamber configuration can supply it with no author tap, and clearing it
// un-places the steps again.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs   from 'fs';
import os   from 'os';
import path from 'path';
import type { AssemblyPose, ImportedGuide, GuideStep } from '@spatial/shared';

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'sib-assembly-test-'));
process.env.SIB_DATA_DIR = TMP_DATA;

const { applyImportedGuide } = await import('../src/guides/ingest.js');
const { guideStore, guideStepStore } = await import('../src/guides/store.js');
const { deriveStepsFromAssembly, transformPoint, yawOf, validateAssemblyPose, normalizeAssemblyPose } = await import('../src/guides/assembly.js');
const { anchorStore } = await import('../src/routes/anchors.js');
const { chamberConfigStore } = await import('../src/routes/chamber-configs.js');

const yaw90: [number, number, number, number] = [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)];

const imported = (): ImportedGuide => ({
  name: 'Assembly guide',
  assembly: { modelId: 'model-1', source: 'cortona', initialNodes: [{ node: 'cmp:B', show: 'hidden' }] },
  steps: [
    { sequenceNumber: 1, text: 'Install A', cadPosition: [1, 0, 0], nodes: [{ node: 'cmp:A', animate: 'insert' }], models: [{ slotId: 'assembly', modelId: 'model-1', modelOpacity: 1 }] },
    { sequenceNumber: 2, text: 'Install B', cadPosition: [0, 0, 2], nodes: [{ node: 'cmp:B', show: 'solid' }], models: [{ slotId: 'assembly', modelId: 'model-1', modelOpacity: 1 }] },
    { sequenceNumber: 3, text: 'Manual step (no CAD)' },
  ],
});

const stepsFor = (guideId: string): GuideStep[] =>
  guideStepStore.findAll().filter(s => s.guideId === guideId).sort((a, b) => a.sequenceNumber - b.sequenceNumber);

test('math: transformPoint applies scale, rotation and translation; yawOf reads a Y rotation', () => {
  const pose: AssemblyPose = { position: [10, 0, 0], rotation: yaw90, scale: 2, source: 'tap' };
  const p = transformPoint(pose, [1, 0, 0]);          // +X scaled to 2, rotated 90° about Y → −Z
  assert.ok(Math.abs(p[0] - 10) < 1e-6 && Math.abs(p[1]) < 1e-6 && Math.abs(p[2] + 2) < 1e-6, JSON.stringify(p));
  assert.ok(Math.abs(yawOf(yaw90) - Math.PI / 2) < 1e-6);
  assert.equal(validateAssemblyPose({ position: [0, 0, 0], rotation: [0, 0, 0, 1], source: 'tap' }), null);
  assert.match(validateAssemblyPose({ position: [0, 0], rotation: [0, 0, 0, 1], source: 'tap' })!, /position/);
  assert.match(validateAssemblyPose({ position: [0, 0, 0], rotation: [0, 0, 0, 1], source: 'magic' })!, /source/);
  const n = normalizeAssemblyPose({ position: [0, 0, 0], rotation: [0, 0, 0, 2], source: 'tap' }, 'K');
  assert.deepEqual(n.rotation, [0, 0, 0, 1]); assert.equal(n.setBy, 'K'); assert.ok(n.setAt);
});

test('import keeps the assembly + cadPosition and leaves CAD steps unplaced until a pose exists', async () => {
  const r = await applyImportedGuide(imported(), { anchorId: 'anchor-plain', createdBy: 'K' });
  assert.equal(r.guide.assembly?.modelId, 'model-1');
  assert.deepEqual(r.guide.assembly?.initialNodes, [{ node: 'cmp:B', show: 'hidden' }]);
  assert.equal(r.guide.assembly?.pose, undefined);
  const st = stepsFor(r.guide.id);
  assert.deepEqual(st[0].cadPosition, [1, 0, 0]);
  assert.equal(st[0].isPlaced, false); assert.equal(st[2].cadPosition, undefined);
  assert.equal(r.unplaced, 3);
});

test('setting the pose derives pins and assembly-slot offsets; clearing un-places again', async () => {
  const r = await applyImportedGuide(imported(), { anchorId: 'anchor-plain', createdBy: 'K' });
  const guide = { ...r.guide, assembly: { ...r.guide.assembly!, pose: normalizeAssemblyPose({ position: [10, 0, 0], rotation: yaw90, source: 'tap' }) } };
  const now = new Date().toISOString();
  const changed = deriveStepsFromAssembly(guide, stepsFor(r.guide.id), now);
  assert.equal(changed.length, 2, 'only CAD steps change');
  const s1 = changed[0];
  assert.equal(s1.isPlaced, true); assert.equal(s1.positionSource, 'cad');
  assert.ok(Math.abs(s1.posX! - 10) < 1e-4 && Math.abs(s1.posZ! + 1) < 1e-4, `pin ${s1.posX},${s1.posZ}`);
  const slot = s1.models!.find(m => m.slotId === 'assembly')!;
  // model origin (10,0,0) relative to the pin (10,0,−1) → offset (0,0,+1); yaw 90°; legacy mirror follows slot 1
  assert.ok(Math.abs(slot.modelOffsetX!) < 1e-4 && Math.abs(slot.modelOffsetZ! - 1) < 1e-4);
  assert.ok(Math.abs(slot.modelRotationY! - Math.PI / 2) < 1e-4);
  assert.equal(s1.modelId, 'model-1'); assert.ok(Math.abs(s1.modelRotationY! - Math.PI / 2) < 1e-4);
  // clear
  const cleared = deriveStepsFromAssembly({ ...guide, assembly: { modelId: 'model-1' } }, changed, now);
  assert.equal(cleared.length, 2);
  assert.equal(cleared[0].isPlaced, false); assert.equal(cleared[0].posX, undefined);
  assert.equal(cleared[0].models!.find(m => m.slotId === 'assembly')!.modelOffsetX, undefined);
  assert.equal(cleared[0].cadPosition![0], 1, 'cadPosition itself is authoring data and stays');
});

test('zero-touch: a chamber configuration with a default pose places the guide at import', async () => {
  chamberConfigStore.save({ id: 'cfg-1', code: 'PXP-A', name: 'PXP A', defaultAssemblyPose: { position: [0, 0, 1], rotation: [0, 0, 0, 1], source: 'tap' }, createdAt: 'x', updatedAt: 'x' });
  anchorStore.save({ id: 'anchor-cfg', assetId: 'A', configId: 'cfg-1', coordinateSystem: 'qr', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 }, metadata: {}, createdAt: 'x', updatedAt: 'x' } as never);
  const r = await applyImportedGuide(imported(), { anchorId: 'anchor-cfg', createdBy: 'K' });
  assert.equal(r.guide.assembly?.pose?.source, 'config');
  const st = stepsFor(r.guide.id);
  assert.equal(st[0].isPlaced, true); assert.equal(st[1].isPlaced, true); assert.equal(st[2].isPlaced, false);
  assert.ok(Math.abs(st[0].posX! - 1) < 1e-6 && Math.abs(st[0].posZ! - 1) < 1e-6);
  assert.equal(r.unplaced, 1);
});

test('re-import of the same model keeps the pose; a different model drops it', async () => {
  const r = await applyImportedGuide(imported(), { anchorId: 'anchor-plain', createdBy: 'K' });
  guideStore.save({ ...r.guide, assembly: { ...r.guide.assembly!, pose: normalizeAssemblyPose({ position: [1, 2, 3], rotation: [0, 0, 0, 1], source: 'tap' }) } });
  const again = await applyImportedGuide(imported(), { anchorId: 'anchor-plain', createdBy: 'K', guideId: r.guide.id });
  assert.deepEqual(again.guide.assembly?.pose?.position, [1, 2, 3]);
  assert.equal(stepsFor(r.guide.id)[0].isPlaced, true);
  const other = imported(); other.assembly!.modelId = 'model-2';
  const swapped = await applyImportedGuide(other, { anchorId: 'anchor-plain', createdBy: 'K', guideId: r.guide.id });
  assert.equal(swapped.guide.assembly?.pose, undefined);
});
