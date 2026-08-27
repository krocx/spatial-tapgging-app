// tag-core.ts — the .tag envelope format, pure logic (no I/O, no stores).
//
// PROPRIETARY & CONFIDENTIAL — Applied Materials. Patent pending.
// Spec: docs/TAG-FORMAT.md. This module is the reference implementation of
// the L1 envelope layer; the emitter (tag-emitter.ts) and the conformance
// validator both build on it.
//
// Design invariants (see spec §2):
//   · Deterministic: the payload carries NO emission timestamp and NO JSON
//     numbers (floats are fixed-precision strings), so identical content
//     always canonicalizes to identical bytes → identical hashes.
//   · Tamper-evident: every stream/member is a reference + SHA-256; the
//     Ed25519 signature covers the canonical payload bytes.
//   · Open kinds: 'part' | 'assembly' shipped; 'group' reserved for
//     TagGroup sub-assemblies (v1.1).

import crypto from 'crypto';

export const TAG_FORMAT_VERSION = 'tag/1.0';

export interface TagStreamRef {
  /** Stream name from the spec registry (checkpoint, training, worldmap, …). */
  name: string;
  /** Relative SIB URL the stream resolves at (authorised channels only). */
  ref: string;
  /** SHA-256 (hex) of the stream's canonical content at emission time. */
  sha256: string;
  /** updatedAt of the underlying record(s) — content version, not emit time. */
  contentVersion?: string;
}

export interface TagMemberRef {
  tagId: string;
  label: string;
  /** Relative URL of the member's own .tag emission. */
  ref: string;
  /** SHA-256 (hex) of the member's canonical payload — the Merkle link. */
  sha256: string;
}

export interface TagPayload {
  format: typeof TAG_FORMAT_VERSION;
  /** 'part' = one tagged part · 'assembly' = a chamber (anchor) manifest. */
  kind: 'part' | 'assembly';
  subject: {
    id: string;
    label: string;
    /** part envelopes: owning chamber */
    anchorId?: string;
    /** assembly envelopes: chamber asset id */
    assetId?: string;
    type?: string;
  };
  issuer: { platform: 'SIB'; version: string };
  /** Fixed-precision string coordinates (determinism rule — no JSON numbers). */
  spatial?: { x: string; y: string; z: string };
  streams: TagStreamRef[];
  /** assembly only — one entry per part beneath this chamber. */
  members?: TagMemberRef[];
  /** v1: hint URLs only; live per-anchor push arrives in M2. */
  subscribe: { hints: string[] };
  /** max updatedAt across everything the envelope commits to. */
  contentVersion: string;
}

export interface TagSignature {
  alg: 'Ed25519';
  /** Raw 32-byte public key, base64. */
  publicKey: string;
  /** Raw 64-byte signature over the canonical payload bytes, base64. */
  sig: string;
}

export interface TagEnvelope {
  payload: TagPayload;
  signature: TagSignature;
}

// ── Canonical serialization (spec §3) ────────────────────────────────────────
// Recursive key-sort + JSON.stringify semantics. Because payloads contain no
// JSON numbers, this is reproducible byte-for-byte in any language.

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>)
    .filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return '{' + keys.map(k =>
    JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k]),
  ).join(',') + '}';
}

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** The hash that member manifests and external verifiers commit to. */
export function payloadHash(payload: TagPayload): string {
  return sha256Hex(canonicalize(payload));
}

// ── Signing (spec §4) ────────────────────────────────────────────────────────

export function signPayload(payload: TagPayload, privateKey: crypto.KeyObject, publicKeyRaw: Buffer): TagSignature {
  const sig = crypto.sign(null, Buffer.from(canonicalize(payload)), privateKey);
  return { alg: 'Ed25519', publicKey: publicKeyRaw.toString('base64'), sig: sig.toString('base64') };
}

/** Raw 32-byte Ed25519 public key = last 32 bytes of the SPKI DER export. */
export function rawPublicKey(publicKey: crypto.KeyObject): Buffer {
  return (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).subarray(-32);
}

function keyObjectFromRaw(publicKeyRawB64: string): crypto.KeyObject {
  // Rebuild SPKI DER around the raw key: fixed 12-byte Ed25519 prefix.
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const der = Buffer.concat([prefix, Buffer.from(publicKeyRawB64, 'base64')]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

// ── Conformance validation (spec §6 — seed of the L2 profile) ────────────────

const HEX64 = /^[0-9a-f]{64}$/;

function findNumbers(value: unknown, path: string, out: string[]): void {
  if (typeof value === 'number') { out.push(path); return; }
  if (Array.isArray(value)) value.forEach((v, i) => findNumbers(v, `${path}[${i}]`, out));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) findNumbers(v, `${path}.${k}`, out);
  }
}

/**
 * Validate an envelope: structure, determinism rules, and signature.
 * Returns [] when conformant; a list of human-readable violations otherwise.
 * `expectedPublicKey` (raw base64) pins the issuer — omit to trust the
 * embedded key (offline first-scan; the app pins it thereafter).
 */
export function validateTagEnvelope(env: TagEnvelope, expectedPublicKey?: string): string[] {
  const errs: string[] = [];
  const p = env?.payload;
  if (!p) return ['missing payload'];
  if (p.format !== TAG_FORMAT_VERSION) errs.push(`unknown format "${p.format}"`);
  if (p.kind !== 'part' && p.kind !== 'assembly') errs.push(`unknown kind "${p.kind}"`);
  if (!p.subject?.id || !p.subject?.label) errs.push('subject.id and subject.label are required');
  if (!p.issuer?.platform || !p.issuer?.version) errs.push('issuer.platform and issuer.version are required');
  if (!p.contentVersion) errs.push('contentVersion is required');
  if (!Array.isArray(p.streams) || p.streams.length === 0) errs.push('streams must be a non-empty array');
  for (const s of p.streams ?? []) {
    if (!s.name || !s.ref || !HEX64.test(s.sha256 ?? '')) {
      errs.push(`stream "${s?.name ?? '?'}" needs name, ref and a 64-hex sha256`);
    }
  }
  if (p.kind === 'assembly' && !Array.isArray(p.members)) errs.push('assembly envelopes require a members array');
  if (p.kind === 'part' && p.members) errs.push('part envelopes must not carry members');
  for (const m of p.members ?? []) {
    if (!m.tagId || !m.ref || !HEX64.test(m.sha256 ?? '')) {
      errs.push(`member "${m?.tagId ?? '?'}" needs tagId, ref and a 64-hex sha256`);
    }
  }
  const numbers: string[] = [];
  findNumbers(p, 'payload', numbers);
  if (numbers.length) errs.push(`determinism rule: no JSON numbers allowed — found at ${numbers.slice(0, 3).join(', ')}`);

  const sig = env.signature;
  if (!sig || sig.alg !== 'Ed25519' || !sig.publicKey || !sig.sig) {
    errs.push('signature block must be { alg: "Ed25519", publicKey, sig }');
    return errs;
  }
  if (expectedPublicKey && sig.publicKey !== expectedPublicKey) {
    errs.push('signature public key does not match the pinned issuer key');
  }
  try {
    const ok = crypto.verify(
      null,
      Buffer.from(canonicalize(p)),
      keyObjectFromRaw(sig.publicKey),
      Buffer.from(sig.sig, 'base64'),
    );
    if (!ok) errs.push('signature verification failed — payload does not match signature');
  } catch (e) {
    errs.push(`signature verification error: ${(e as Error).message}`);
  }
  return errs;
}
