// presence.test.ts — P1: validation, staleness sweep, join/left semantics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePresenceUpdate, updatePresence, listPresence, leavePresence, sweepPresence, resetPresence, STALE_MS,
} from '../src/sse/presence.js';

const pose = Array.from({ length: 16 }, (_, i) => (i % 5 === 0 ? 1 : 0));

test('validatePresenceUpdate rejects bad shapes and trims fields', () => {
  assert.equal(validatePresenceUpdate(null).ok, false);
  assert.equal(validatePresenceUpdate({ userId: 'u', name: 'n', surface: 'placeSteps', pose: [1, 2] }).ok, false);
  assert.equal(validatePresenceUpdate({ userId: 'u', name: 'n', surface: 'nope', pose }).ok, false);
  const v = validatePresenceUpdate({ userId: ' u1 ', name: ' Priya ', surface: 'placeSteps', pose, site: ' US ', focusId: 's1' });
  assert.equal(v.ok, true);
  if (v.ok) {
    assert.equal(v.value.userId, 'u1');
    assert.equal(v.value.name, 'Priya');
    assert.equal(v.value.site, 'US');
    assert.equal(v.value.focusId, 's1');
  }
});

test('updatePresence keeps the latest entry per user; list excludes stale; sweep drops them', () => {
  resetPresence();
  const t0 = Date.parse('2026-09-10T00:00:00Z');
  updatePresence('a1', { userId: 'u1', name: 'A', surface: 'placeSteps', pose }, t0);
  updatePresence('a1', { userId: 'u2', name: 'B', surface: 'placeSteps', pose }, t0 + 1000);
  updatePresence('a1', { userId: 'u1', name: 'A', surface: 'placeSteps', pose, focusId: 'step-2' }, t0 + 2000);
  const list = listPresence('a1', t0 + 2500);
  assert.equal(list.length, 2);
  assert.equal(list.find(e => e.userId === 'u1')?.focusId, 'step-2');
  // u2 goes quiet
  assert.equal(listPresence('a1', t0 + 1000 + STALE_MS + 1).length, 1);
  assert.equal(sweepPresence(t0 + 1000 + STALE_MS + 1), 1);
  assert.equal(listPresence('a1', t0 + 1000 + STALE_MS + 1).map(e => e.userId).join(), 'u1');
  assert.equal(leavePresence('a1', 'u1'), true);
  assert.equal(leavePresence('a1', 'u1'), false);
  assert.equal(listPresence('a1').length, 0);
});
