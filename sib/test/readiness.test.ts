// readiness.test.ts - step needs, device profiles and the join
// (guides/readiness.ts, docs/ar-ojt/DEVICE-ADAPTIVE-INSTRUCTIONS.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepNeeds, judge, readinessOf, readinessReport, profileFrom, type DeviceProfile } from '../src/guides/readiness.js';

const P = (o: Partial<DeviceProfile>): DeviceProfile => ({ id: 'x', name: 'x', display: 'full', overlay: '3d', input: ['touch'], delivery: 'app', ...o });
const quest = P({ id: 'quest', display: 'full', overlay: '3d', input: ['hands', 'voice'], delivery: 'xrkit' });
const rayneo = P({ id: 'rayneo', display: 'small', overlay: 'reduced', input: ['ring', 'voice'], delivery: 'xrkit' });
const g2 = P({ id: 'g2', display: 'text', overlay: 'none', input: ['ring', 'trackpad'], delivery: 'companion-text' });
const oakley = P({ id: 'oakley', display: 'none', overlay: 'none', input: ['voice'], delivery: 'spoken' });

test('needs are derived from the step; an author override wins', () => {
  assert.deepEqual(stepNeeds({ text: 'Fit the cover.' }), ['text']);
  assert.deepEqual(stepNeeds({ text: 'Lower the ring into the groove.', cadPosition: [0, 0, 0], nodes: [{ node: 'cmp:A', animate: 'insert', from: [0, 1, 0], to: [0, 0, 0] }] }), ['text', 'spatial', 'motion', 'part-id']);
  assert.deepEqual(stepNeeds({ text: 'Torque the four bolts to 2.5 Nm while holding the bracket.', mediaPath: 'x.jpg' }), ['text', 'media', 'hands-busy']);
  assert.deepEqual(stepNeeds({ text: 'x', nodes: [{ node: 'cmp:H#s3f2', show: 'solid' }] }), ['text', 'motion', 'part-id']);
  assert.deepEqual(stepNeeds({ text: 'x', cadPosition: [0, 0, 0], needs: ['text', 'bogus'] }), ['text']);
});

test('the join: native on a full headset, adapted on text and spoken devices, assisted where a device cannot carry the need', () => {
  const s = { text: 'Lower the ring into the groove.', cadPosition: [0, 0, 0] as [number, number, number], nodes: [{ node: 'cmp:A', animate: 'insert' as const, from: [0, 1, 0] as [number, number, number], to: [0, 0, 0] as [number, number, number] }] };
  assert.equal(readinessOf(s, quest).level, 'native');
  assert.equal(readinessOf(s, rayneo).level, 'native');
  assert.equal(readinessOf(s, g2).level, 'adapted');
  assert.equal(readinessOf(s, oakley).level, 'adapted');
  const m = { text: 'Compare with the picture.', mediaPath: 'p.jpg' };
  assert.equal(readinessOf(m, g2).level, 'assisted');
  assert.equal(readinessOf(m, rayneo).level, 'adapted');
  const hose = { text: 'Seat the seal.', nodes: [{ node: 'cmp:S#s1f0', show: 'solid' as const }] };
  assert.equal(judge('motion', rayneo, { hasHoseFrames: true }).level, 'adapted');
  assert.equal(readinessOf(hose, quest).level, 'native');
  const busy = { text: 'Hold the bracket and tighten.' };
  assert.equal(readinessOf(busy, g2).level, 'adapted');
  assert.equal(readinessOf(busy, P({ input: ['touch'] })).level, 'assisted');
});

test('report: per-step levels and a deliverable percentage per profile', () => {
  const steps = [
    { id: '1', sequenceNumber: 1, title: 'A', text: 'Fit the cover.' },
    { id: '2', sequenceNumber: 2, title: 'B', text: 'Compare with the picture.', mediaPath: 'p.jpg' },
  ];
  const r = readinessReport(steps, [quest, g2]);
  assert.equal(r.summary.quest.deliverable, 100);
  assert.equal(r.summary.g2.assisted, 1);
  assert.equal(r.summary.g2.deliverable, 50);
  assert.equal(r.steps[1].byProfile.g2.level, 'assisted');
});

test('profiles parse from frontmatter and reject bad fields', () => {
  assert.ok(profileFrom({ id: 'a', name: 'A', display: 'text', overlay: 'none', input: ['ring'], delivery: 'companion-text' }));
  assert.equal(profileFrom({ id: 'a', name: 'A', display: 'huge', overlay: 'none', input: [], delivery: 'app' }), null);
});
