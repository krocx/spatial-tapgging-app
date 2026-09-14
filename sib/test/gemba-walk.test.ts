// gemba-walk.test.ts — G2: walk header validation + derived summary; pick lists.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const now = '2026-09-14T00:00:00.000Z';
const finding = (o: Record<string, unknown>) => ({
  id: 'f', anchorId: 'a', title: 't', description: '', defectCategory: 'OTHERS', position: { x: 0, y: 0, z: 0 }, order: 0,
  createdAt: now, updatedAt: now, ...o,
}) as any;

test('validateStartWalk requires anchorId + auditorName, trims header fields', async () => {
  const { validateStartWalk, validateWalkPatch } = await import('../src/gemba/walk-core.js');
  assert.throws(() => validateStartWalk({}), /anchorId/);
  assert.throws(() => validateStartWalk({ anchorId: 'a' }), /auditorName/);
  const w = validateStartWalk({ anchorId: 'a', auditorName: ' Karthik ', projectId: ' KarthikDevTest2 ', organization: 'AGS', bu: '', location: 'Montana', junk: 1 });
  assert.deepEqual(w, { anchorId: 'a', auditorName: 'Karthik', auditorId: undefined, projectId: 'KarthikDevTest2', organization: 'AGS', bu: undefined, area: undefined, location: 'Montana' });
  const p = validateWalkPatch({ projectId: '', notes: ' done ', location: 'Austin' });
  assert.deepEqual(p, { projectId: undefined, location: 'Austin', notes: 'done' });
  assert.throws(() => validateWalkPatch({ auditorName: '  ' }), /auditorName/);
});

test('summarize counts categories, max risk and photos (legacy folded in)', async () => {
  const { summarize, summaryLine } = await import('../src/gemba/walk-core.js');
  const s = summarize([
    finding({ findingCategory: 'OFI', riskRating: 2, photos: [{ path: 'a' }, { path: 'b' }] }),
    finding({ findingCategory: 'NC', riskRating: 3 }),
    finding({ findingCategory: 'STRENGTH' }),
    finding({ referenceImagePath: 'legacy.jpg' }),
  ]);
  assert.deepEqual(s, { findings: 4, strength: 1, ofi: 1, nc: 1, uncategorised: 1, photos: 3, maxRisk: 3 });
  assert.equal(summaryLine(s), '4 findings · 1 strength · 1 OFI · 1 NC · max risk 3');
  assert.equal(summarize([]).maxRisk, undefined);
  assert.equal(summaryLine(summarize([finding({})])), '1 finding');
});

test('pick lists validate, dedupe case-insensitively and cap', async () => {
  const { validateListValues, isListKind, buildSeedLists } = await import('../src/gemba/library-core.js');
  assert.deepEqual(validateListValues([' AGS ', 'ags', '', 'SPG', 7]), ['AGS', 'SPG']);
  assert.throws(() => validateListValues('AGS'), /array/);
  assert.equal(validateListValues(Array.from({ length: 300 }, (_, i) => 'v' + i)).length, 200);
  assert.ok(isListKind('bu') && !isListKind('region'));
  assert.ok(buildSeedLists().location.includes('Montana'));
});
