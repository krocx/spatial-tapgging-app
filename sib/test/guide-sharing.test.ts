/**
 * Per-user guide sharing — visibility predicate rules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideVisibleTo } from '../src/uam/guide-visibility.js';
import type { Guide, UamUser } from '@spatial/shared';

const g = (over: Partial<Guide> = {}): Guide => ({
  id: 'g1', anchorId: 'a1', name: 'G', description: '', published: true,
  createdBy: 'k', createdAt: 'x', updatedAt: 'x', ...over,
});
const u = (role: UamUser['role'], email = 'tech@amat.com'): UamUser => ({
  id: 'u1', email, employeeId: 'E1', name: 'U', role, createdAt: 'x', updatedAt: 'x',
});

test('unidentified callers keep historical behaviour (see everything the route already allows)', () => {
  assert.ok(guideVisibleTo(undefined, g()));
  assert.ok(guideVisibleTo(undefined, g({ sharedWith: ['someone@else.com'] })));
});

test('engineer/manager/owner always see every guide, shared or not', () => {
  for (const role of ['engineer', 'manager', 'owner'] as const) {
    assert.ok(guideVisibleTo(u(role), g({ sharedWith: ['other@x.com'] })));
    assert.ok(guideVisibleTo(u(role), g({ published: false })));
  }
});

test('technician: unshared = visible; shared-with-them = visible; shared-with-others = hidden', () => {
  assert.ok(guideVisibleTo(u('technician'), g()));                                    // no list
  assert.ok(guideVisibleTo(u('technician'), g({ sharedWith: [] })));                  // empty list
  assert.ok(guideVisibleTo(u('technician'), g({ sharedWith: ['tech@amat.com'] })));   // on the list
  assert.ok(!guideVisibleTo(u('technician'), g({ sharedWith: ['other@amat.com'] }))); // off the list
});

test('technician never sees drafts; email matching is normalized', () => {
  assert.ok(!guideVisibleTo(u('technician'), g({ published: false })));
  assert.ok(guideVisibleTo(u('technician', '  TECH@AMAT.COM '), g({ sharedWith: ['tech@amat.com'] })));
});
