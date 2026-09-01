/**
 * UAM tests — role rules, token sign/verify, and the routes' invariants
 * (allow-list login, employee-ID match, last-owner guard) via the stores.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'uam-'));
process.env.SIB_DATA_DIR = TMP;

const {
  canManageRole, roleAtLeast, isUamRole, normalizeEmail,
  makeToken, verifyToken, TOKEN_TTL_MS,
} = await import('../src/uam/uam-core.js');
const { uamUserStore, uamSecret, findUserByEmail } = await import('../src/routes/uam.js');

test('role ladder: rank comparisons and validity', () => {
  assert.ok(roleAtLeast('owner', 'manager'));
  assert.ok(roleAtLeast('manager', 'technician'));
  assert.ok(!roleAtLeast('technician', 'engineer'));
  assert.ok(isUamRole('engineer'));
  assert.ok(!isUamRole('superuser'));
});

test('canManageRole: owner manages all; manager everything except owner; others nothing', () => {
  assert.ok(canManageRole('owner', 'owner'));
  assert.ok(canManageRole('owner', 'technician'));
  assert.ok(canManageRole('manager', 'manager'));
  assert.ok(canManageRole('manager', 'engineer'));
  assert.ok(!canManageRole('manager', 'owner'));      // cannot touch owner records
  assert.ok(!canManageRole('engineer', 'technician'));
  assert.ok(!canManageRole('technician', 'technician'));
});

test('tokens: round-trip, normalization, expiry, tamper', () => {
  const secret = 'test-secret';
  const t = makeToken('  Karthik.ASVSRK@Gmail.com ', secret);
  assert.equal(verifyToken(t, secret), 'karthik.asvsrk@gmail.com');   // normalized identity

  // expiry — verification fails one ms past TTL
  const now = Date.now();
  const t2 = makeToken('a@b.com', secret, now);
  assert.equal(verifyToken(t2, secret, now + TOKEN_TTL_MS - 1), 'a@b.com');
  assert.equal(verifyToken(t2, secret, now + TOKEN_TTL_MS + 1), null);

  // tamper — flip the email, keep the signature
  const [, exp, sig] = t2.split('|');
  const forged = `${Buffer.from('evil@b.com').toString('base64url')}|${exp}|${sig}`;
  assert.equal(verifyToken(forged, secret), null);
  // wrong secret
  assert.equal(verifyToken(t2, 'other-secret'), null);
  // garbage
  assert.equal(verifyToken('not|a', secret), null);
  assert.equal(verifyToken('', secret), null);
});

test('secret: generated once, persisted, stable across calls', () => {
  const s1 = uamSecret();
  const s2 = uamSecret();
  assert.equal(s1, s2);
  assert.match(s1, /^[0-9a-f]{64}$/);
  assert.ok(fs.existsSync(path.join(TMP, 'uam-session-secret.json')));
});

test('store: email lookup is normalized', () => {
  const now = new Date().toISOString();
  uamUserStore.save({
    id: 'u1', email: 'karthik@amat.com', employeeId: 'E100', name: 'Karthik',
    role: 'owner', createdAt: now, updatedAt: now,
  });
  assert.equal(findUserByEmail('  KARTHIK@amat.com ')?.id, 'u1');
  assert.equal(findUserByEmail('nobody@amat.com'), undefined);
});
