// step-models.test.ts — U4 slot doctrine + legacy mirroring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { GuideStep } from '@spatial/shared';
import {
  sanitizeStepModelSlots, applySlotsToLegacy, applyLegacyToSlots,
  effectiveStepModels, stripSlotPlacements, StepModelsError,
} from '../src/guides/step-models.js';

const base = (extra: Partial<GuideStep> = {}): GuideStep => ({
  id: 's1', guideId: 'g', anchorId: 'a', sequenceNumber: 1, text: 't',
  completionRequired: true, isPlaced: false, createdAt: '', updatedAt: '', ...extra,
});

test('effective slots lift legacy fields into slot-1', () => {
  const s = base({ modelId: 'm1', modelScale: 2, modelOffsetY: 0.1 });
  assert.deepEqual(effectiveStepModels(s), [{ slotId: 'slot-1', modelId: 'm1', modelScale: 2, modelOffsetY: 0.1 }]);
  assert.deepEqual(effectiveStepModels(base()), []);
});

test('sanitize caps at 3, requires modelId, rejects duplicate slotIds', () => {
  assert.throws(() => sanitizeStepModelSlots([{ modelId: 'a' }, { modelId: 'b' }, { modelId: 'c' }, { modelId: 'd' }], []), StepModelsError);
  assert.throws(() => sanitizeStepModelSlots([{ slotId: 'x' }], []), StepModelsError);
  assert.throws(() => sanitizeStepModelSlots([{ slotId: 'x', modelId: 'a' }, { slotId: 'x', modelId: 'b' }], []), StepModelsError);
  assert.throws(() => sanitizeStepModelSlots('nope', []), StepModelsError);
});

test('sanitize drops placement when a slot changes shape, keeps it otherwise', () => {
  const prior = [{ slotId: 'slot-1', modelId: 'm1', modelOffsetX: 0.5, modelRotationY: 1 }];
  const same = sanitizeStepModelSlots([{ slotId: 'slot-1', modelId: 'm1', modelOffsetX: 0.7, modelRotationY: 1, modelOpacity: 0.3 }], prior);
  assert.deepEqual(same, [{ slotId: 'slot-1', modelId: 'm1', modelOpacity: 0.3, modelOffsetX: 0.7, modelRotationY: 1 }]);
  const changed = sanitizeStepModelSlots([{ slotId: 'slot-1', modelId: 'm2', modelOffsetX: 0.7, modelScale: 1.5 }], prior);
  assert.deepEqual(changed, [{ slotId: 'slot-1', modelId: 'm2', modelScale: 1.5 }]);
});

test('slots → legacy mirrors slot 1; empty clears', () => {
  const s = base({ models: [{ slotId: 'a', modelId: 'm1', modelScale: 3 }, { slotId: 'b', modelId: 'm2' }] });
  applySlotsToLegacy(s);
  assert.equal(s.modelId, 'm1'); assert.equal(s.modelScale, 3); assert.equal(s.modelOffsetX, undefined);
  const e = base({ modelId: 'old', models: [] });
  applySlotsToLegacy(e);
  assert.equal(e.modelId, undefined); assert.equal(e.models, undefined);
});

test('legacy → slots rewrites slot 1 only; cleared legacy removes slot 1', () => {
  const s = base({ modelId: 'new', modelOffsetZ: 0.2,
    models: [{ slotId: 'a', modelId: 'old', modelOffsetX: 1 }, { slotId: 'b', modelId: 'm2', modelRotationY: 2 }] });
  applyLegacyToSlots(s);
  assert.deepEqual(s.models, [{ slotId: 'a', modelId: 'new', modelOffsetZ: 0.2 }, { slotId: 'b', modelId: 'm2', modelRotationY: 2 }]);
  const c = base({ models: [{ slotId: 'a', modelId: 'old' }, { slotId: 'b', modelId: 'm2', modelScale: 4 }] });
  applyLegacyToSlots(c);
  assert.deepEqual(c.models, [{ slotId: 'b', modelId: 'm2', modelScale: 4 }]);
  assert.equal(c.modelId, 'm2'); assert.equal(c.modelScale, 4);   // re-mirrored from the new slot 1
  const none = base({ models: [{ slotId: 'a', modelId: 'old' }] });
  applyLegacyToSlots(none);
  assert.equal(none.models, undefined);
});

test('stripSlotPlacements keeps assignment, drops device placement', () => {
  assert.deepEqual(stripSlotPlacements([{ slotId: 'a', modelId: 'm', modelScale: 2, modelOpacity: 0.5, modelOffsetX: 1, modelRotationY: 3 }]),
    [{ slotId: 'a', modelId: 'm', modelScale: 2, modelOpacity: 0.5 }]);
  assert.equal(stripSlotPlacements(undefined), undefined);
});
