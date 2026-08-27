/**
 * .tag envelope format tests — canonicalization determinism, signing,
 * conformance validation, and the emitter's Merkle member manifest.
 * Spec: docs/TAG-FORMAT.md (PROPRIETARY & CONFIDENTIAL — patent pending).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Emitter + stores read SIB_DATA_DIR at module load — set it FIRST.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tagfmt-'));
process.env.SIB_DATA_DIR = TMP;

const {
  canonicalize, sha256Hex, payloadHash, signPayload, rawPublicKey,
  validateTagEnvelope, TAG_FORMAT_VERSION,
} = await import('../src/tag/tag-core.js');
const { buildPartEnvelope, buildAssemblyEnvelope } = await import('../src/tag/tag-emitter.js');
const { tagStore } = await import('../src/routes/tags.js');
const { anchorStore } = await import('../src/routes/anchors.js');

import type { TagPayload, TagEnvelope } from '../src/tag/tag-core.js';

const basePayload = (): TagPayload => ({
  format: TAG_FORMAT_VERSION,
  kind: 'part',
  subject: { id: 't1', label: 'Valve V-101', anchorId: 'a1', type: 'visual' },
  issuer: { platform: 'SIB', version: '2026.4.42' },
  spatial: { x: '0.120000', y: '-0.450000', z: '1.000000' },
  streams: [{ name: 'checkpoint', ref: '/tags/t1', sha256: 'a'.repeat(64), contentVersion: '2026-01-01T00:00:00.000Z' }],
  subscribe: { hints: ['/perception/pass-state/t1'] },
  contentVersion: '2026-01-01T00:00:00.000Z',
});

const keys = crypto.generateKeyPairSync('ed25519');
const pubRaw = rawPublicKey(keys.publicKey);
const signed = (p: TagPayload): TagEnvelope => ({ payload: p, signature: signPayload(p, keys.privateKey, pubRaw) });

test('canonicalize: key order irrelevant, undefined dropped, deterministic', () => {
  const a = canonicalize({ b: '2', a: '1', c: { z: 'x', y: ['1', '2'] }, skip: undefined });
  const b = canonicalize({ c: { y: ['1', '2'], z: 'x' }, a: '1', b: '2' });
  assert.equal(a, b);
  assert.equal(a, '{"a":"1","b":"2","c":{"y":["1","2"],"z":"x"}}');
});

test('payloadHash: identical content → identical hash; any change → different', () => {
  const h1 = payloadHash(basePayload());
  const h2 = payloadHash(basePayload());
  assert.equal(h1, h2);
  const changed = basePayload();
  changed.subject.label = 'Valve V-102';
  assert.notEqual(payloadHash(changed), h1);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('sign + validate: conformant envelope passes with and without pinned key', () => {
  const env = signed(basePayload());
  assert.deepEqual(validateTagEnvelope(env), []);
  assert.deepEqual(validateTagEnvelope(env, pubRaw.toString('base64')), []);
});

test('validate: tampered payload fails signature check', () => {
  const env = signed(basePayload());
  env.payload.subject.label = 'Tampered';
  const errs = validateTagEnvelope(env);
  assert.ok(errs.some(e => /signature verification failed/.test(e)), errs.join('; '));
});

test('validate: wrong pinned issuer key rejected', () => {
  const env = signed(basePayload());
  const other = rawPublicKey(crypto.generateKeyPairSync('ed25519').publicKey).toString('base64');
  assert.ok(validateTagEnvelope(env, other).some(e => /pinned issuer key/.test(e)));
});

test('validate: determinism rule rejects JSON numbers anywhere in the payload', () => {
  const p = basePayload() as unknown as Record<string, unknown>;
  (p.subject as Record<string, unknown>).order = 3;
  const errs = validateTagEnvelope(signed(p as unknown as TagPayload));
  assert.ok(errs.some(e => /no JSON numbers/.test(e)), errs.join('; '));
});

test('validate: structural rules — kind, streams, members discipline', () => {
  const bad = basePayload();
  (bad as { kind: string }).kind = 'blob';
  bad.streams = [];
  const errs = validateTagEnvelope(signed(bad));
  assert.ok(errs.some(e => /unknown kind/.test(e)));
  assert.ok(errs.some(e => /non-empty array/.test(e)));

  const partWithMembers = basePayload();  // kind stays 'part'
  (partWithMembers as { members?: unknown }).members = [{ tagId: 'x', label: 'x', ref: '/y', sha256: 'zz' }];
  const errs2 = validateTagEnvelope(signed(partWithMembers));
  assert.ok(errs2.some(e => /must not carry members/.test(e)), errs2.join('; '));
  assert.ok(errs2.some(e => /64-hex sha256/.test(e)));
});

// ── Emitter integration (temp data dir) ──────────────────────────────────────

const now = new Date().toISOString();
anchorStore.save({
  id: 'anc-1', assetId: 'CHAMBER-7', coordinateSystem: 'ARKit' as never,
  position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 },
  metadata: { name: 'Etch Chamber 7' }, createdAt: now, updatedAt: now,
} as never);
tagStore.save({
  id: 'tag-1', anchorId: 'anc-1', type: 'visual' as never, label: 'Lid clamp',
  expectedOutcome: 'Seated', metadata: { pos_x: 0.1, pos_y: 0.2, pos_z: 0.3 },
  createdAt: now, updatedAt: now,
} as never);
tagStore.save({
  id: 'tag-2', anchorId: 'anc-1', type: 'visual' as never, label: 'View port',
  expectedOutcome: 'Clean', metadata: {}, createdAt: now, updatedAt: now,
} as never);

test('emitter: part envelope is conformant, deterministic, spatially stringified', () => {
  const e1 = buildPartEnvelope('tag-1')!;
  assert.deepEqual(validateTagEnvelope(e1), []);
  assert.equal(e1.payload.kind, 'part');
  assert.equal(e1.payload.spatial?.x, '0.100000');       // float → fixed string
  const e2 = buildPartEnvelope('tag-1')!;
  assert.equal(payloadHash(e1.payload), payloadHash(e2.payload));  // no emit-time wobble
  assert.equal(buildPartEnvelope('nope'), null);
});

test('emitter: assembly manifest Merkle-links members; part change breaks the link', () => {
  const asm = buildAssemblyEnvelope('anc-1')!;
  assert.deepEqual(validateTagEnvelope(asm), []);
  assert.equal(asm.payload.kind, 'assembly');
  assert.equal(asm.payload.members!.length, 2);

  const member = asm.payload.members!.find(m => m.tagId === 'tag-1')!;
  const live = buildPartEnvelope('tag-1')!;
  assert.equal(member.sha256, payloadHash(live.payload));  // manifest matches live part

  // Mutate the part → its hash changes → stale manifest no longer matches.
  tagStore.update('tag-1', { label: 'Lid clamp (rev B)', updatedAt: new Date().toISOString() } as never);
  const after = buildPartEnvelope('tag-1')!;
  assert.notEqual(member.sha256, payloadHash(after.payload));
  // Re-emitted assembly heals the link.
  const asm2 = buildAssemblyEnvelope('anc-1')!;
  assert.equal(asm2.payload.members!.find(m => m.tagId === 'tag-1')!.sha256, payloadHash(after.payload));
});

test('emitter: assembly never embeds the anchor encryption key', () => {
  const asm = buildAssemblyEnvelope('anc-1')!;
  assert.ok(!JSON.stringify(asm).includes('encryptionKey') || !JSON.stringify(asm).match(/"encryptionKey":"[^"]/));
});
