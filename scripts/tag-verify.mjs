#!/usr/bin/env node
// tag-verify - verify a SIB .tag envelope offline (structure, determinism,
// canonical hash, Ed25519 signature) and, with --sib, resolve every stream
// and member to check the committed SHA-256s against the live server.
//
//   node scripts/tag-verify.mjs envelope.json
//   node scripts/tag-verify.mjs envelope.json --pubkey <raw32 b64>
//   node scripts/tag-verify.mjs envelope.json --sib https://sib.example --key <api key>
//
// Own code on Node's crypto only. Mirrors sib/src/tag/tag-core.ts so a reader
// in another language can be checked against the same rules: sort keys at
// every level, no whitespace, JSON.stringify string escaping, SHA-256 over the
// UTF-8 bytes, Ed25519 over those same bytes. Exit 0 = conformant.

import fs from 'node:fs';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error('usage: tag-verify <envelope.json> [--pubkey b64] [--sib url --key apikey]'); process.exit(2); }

const env = JSON.parse(fs.readFileSync(file, 'utf8'));
const errs = [];

// ── canonical form (spec §3) ────────────────────────────────────────────────
function canonicalize(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
}
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ── structure + determinism (spec §2, §6) ───────────────────────────────────
const p = env.payload;
if (!p) errs.push('missing payload');
else {
  if (!['tag/1.0', 'tag/1.1'].includes(p.format)) errs.push(`unknown format ${p.format}`);
  if (!['part', 'assembly'].includes(p.kind)) errs.push(`unknown kind ${p.kind}`);
  if (!p.subject?.id || !p.subject?.label) errs.push('subject.id/label required');
  if (!Array.isArray(p.streams) || !p.streams.length) errs.push('streams required');
  for (const s of p.streams ?? []) if (!/^[0-9a-f]{64}$/.test(s.sha256 ?? '')) errs.push(`stream ${s.name}: bad sha256`);
  if (p.kind === 'assembly' && !Array.isArray(p.members)) errs.push('assembly needs members[]');
  if (p.kind === 'part' && p.members) errs.push('part must not carry members');
  if (p.frame) {
    if (p.frame.kind !== 'qr' || !p.frame.markerId) errs.push('frame needs kind "qr" + markerId');
    if (p.frame.anchorPose && p.frame.anchorPose.length !== 16) errs.push('frame.anchorPose must have 16 entries');
  }
  const nums = [];
  (function walk(v, path) {
    if (typeof v === 'number') nums.push(path);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  })(p, 'payload');
  if (nums.length) errs.push(`determinism: JSON numbers at ${nums.slice(0, 3).join(', ')}`);
}

// ── signature (spec §4) ─────────────────────────────────────────────────────
const canon = p ? canonicalize(p) : '';
const hash = sha256(canon);
const sig = env.signature;
if (!sig || sig.alg !== 'Ed25519' || !sig.publicKey || !sig.sig) errs.push('signature block must be { alg:"Ed25519", publicKey, sig }');
else {
  const pinned = opt('--pubkey');
  if (pinned && pinned !== sig.publicKey) errs.push('public key does not match --pubkey');
  try {
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(sig.publicKey, 'base64')]);
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    if (!crypto.verify(null, Buffer.from(canon), key, Buffer.from(sig.sig, 'base64'))) errs.push('signature does not verify');
  } catch (e) { errs.push(`signature check failed: ${e.message}`); }
}

// ── optional: resolve streams/members against a SIB origin ──────────────────
const sib = opt('--sib');
if (sib && p) {
  const headers = opt('--key') ? { 'X-API-Key': opt('--key') } : {};
  for (const m of p.members ?? []) {
    try {
      const r = await fetch(sib.replace(/\/$/, '') + m.ref, { headers });
      const j = await r.json();
      const memberEnv = j.data ?? j;
      const h = sha256(canonicalize(memberEnv.payload));
      if (h !== m.sha256) errs.push(`member ${m.tagId}: live hash ${h.slice(0, 12)}… ≠ committed ${m.sha256.slice(0, 12)}… (content changed since emission)`);
    } catch (e) { errs.push(`member ${m.tagId}: ${e.message}`); }
  }
  for (const s of p.streams ?? []) {
    try {
      const r = await fetch(sib.replace(/\/$/, '') + s.ref, { headers });
      if (!r.ok) errs.push(`stream ${s.name}: HTTP ${r.status}`);
    } catch (e) { errs.push(`stream ${s.name}: ${e.message}`); }
  }
}

console.log(`format      ${p?.format ?? '?'}   kind ${p?.kind ?? '?'}   subject ${p?.subject?.label ?? '?'} (${p?.subject?.id ?? '?'})`);
console.log(`payloadHash ${hash}`);
console.log(`issuer key  ${sig?.publicKey ?? '?'}`);
if (p?.frame) console.log(`frame       qr ${p.frame.markerId}${p.frame.markerSizeM ? ` · ${p.frame.markerSizeM} m` : ''}${p.frame.anchorPose ? ' · sealed pose' : ''}`);
console.log(`streams     ${(p?.streams ?? []).map(s => s.name).join(', ')}${p?.members ? `   members ${p.members.length}` : ''}`);
if (errs.length) { console.log('\nNOT CONFORMANT'); for (const e of errs) console.log('  ✗ ' + e); process.exit(1); }
console.log('\nOK - conformant' + (sib ? ' and consistent with ' + sib : ''));
