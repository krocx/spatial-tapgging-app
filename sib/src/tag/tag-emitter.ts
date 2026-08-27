// tag-emitter.ts — builds and signs .tag envelopes from live SIB stores.
//
// PROPRIETARY & CONFIDENTIAL — Applied Materials. Patent pending.
//
// Two emissions (CAD part / part-assembly model):
//   buildPartEnvelope(tagId)       — one tagged part on a chamber
//   buildAssemblyEnvelope(anchorId)— the chamber: chamber streams + a member
//                                    manifest hashing every part envelope
//                                    beneath it (Merkle-style integrity tree:
//                                    change any part → its hash changes → the
//                                    assembly manifest no longer matches until
//                                    re-emitted).
//
// Signing key: Ed25519, generated on first boot, persisted at
// <SIB_DATA_DIR>/tag-signing-key.json (top-level *.json → included in the
// `data` backup scope automatically). Rotation = delete the file, restart.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { PLATFORM_VERSION } from '../version.js';
import {
  TAG_FORMAT_VERSION, TagEnvelope, TagPayload, TagStreamRef, TagMemberRef,
  canonicalize, sha256Hex, payloadHash, signPayload, rawPublicKey,
} from './tag-core.js';
import { tagStore } from '../routes/tags.js';
import { anchorStore } from '../routes/anchors.js';
import { tagGroupStore } from '../routes/tag-groups.js';
import { sessionStore } from '../routes/sessions.js';
import { model3DStore } from '../routes/models.js';
import { locTagStore } from '../routes/loc-tags.js';
import { lotoPointStore, lotoEventStore } from '../routes/loto.js';
import { guideStore, guideStepStore } from '../routes/guides.js';
import { findPassStateByTag } from '../stores/pass-state-store.js';

const DATA_DIR = process.env.SIB_DATA_DIR ?? path.join(process.cwd(), '.sib-data');
const KEY_FILE = () => path.join(DATA_DIR, 'tag-signing-key.json');

// ── Issuer key management ────────────────────────────────────────────────────

let cachedKeys: { privateKey: crypto.KeyObject; publicKeyRaw: Buffer } | null = null;

export function issuerKeys(): { privateKey: crypto.KeyObject; publicKeyRaw: Buffer } {
  if (cachedKeys) return cachedKeys;
  const file = KEY_FILE();
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { privateKeyPem: string };
    const privateKey = crypto.createPrivateKey(saved.privateKeyPem);
    const publicKey = crypto.createPublicKey(privateKey);
    cachedKeys = { privateKey, publicKeyRaw: rawPublicKey(publicKey) };
    return cachedKeys;
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    alg: 'Ed25519',
    createdAt: new Date().toISOString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyRawB64: rawPublicKey(publicKey).toString('base64'),
  }, null, 2), { mode: 0o600 });
  console.log('[tag-emitter] generated Ed25519 issuer key →', file);
  cachedKeys = { privateKey, publicKeyRaw: rawPublicKey(publicKey) };
  return cachedKeys;
}

/** Test hook — forget the cached key (e.g. after pointing SIB_DATA_DIR elsewhere). */
export function resetIssuerKeysForTest(): void { cachedKeys = null; }

// ── Helpers ──────────────────────────────────────────────────────────────────

const recordHash = (records: unknown): string => sha256Hex(canonicalize(records));

/** Large binaries: hash file bytes, memoised by path+mtime+size. */
const fileHashCache = new Map<string, string>();
function fileHash(filePath: string): string {
  const st = fs.statSync(filePath);
  const key = `${filePath}|${st.mtimeMs}|${st.size}`;
  const hit = fileHashCache.get(key);
  if (hit) return hit;
  const h = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  fileHashCache.set(key, h);
  if (fileHashCache.size > 200) fileHashCache.delete(fileHashCache.keys().next().value as string);
  return h;
}

const maxVersion = (...stamps: (string | undefined)[]): string =>
  stamps.filter((s): s is string => !!s).sort().pop() ?? '1970-01-01T00:00:00.000Z';

/** Determinism rule: floats travel as fixed-precision strings. */
const fixed = (n: unknown): string | undefined =>
  typeof n === 'number' && Number.isFinite(n) ? n.toFixed(6) : undefined;

// ── Part envelope ────────────────────────────────────────────────────────────

export function buildPartEnvelope(tagId: string): TagEnvelope | null {
  const tag = tagStore.findById(tagId);
  if (!tag) return null;

  const streams: TagStreamRef[] = [{
    name: 'checkpoint',
    ref: `/tags/${tag.id}`,
    sha256: recordHash(tag),
    contentVersion: tag.updatedAt,
  }];

  const pass = findPassStateByTag(tag.id);
  if (pass) {
    streams.push({
      name: 'training',
      ref: `/perception/pass-state/${tag.id}`,
      sha256: recordHash(pass),
      contentVersion: (pass as { updatedAt?: string }).updatedAt ?? tag.updatedAt,
    });
  }

  if (tag.groupId) {
    const group = tagGroupStore.findById(tag.groupId);
    if (group) {
      streams.push({
        name: 'group',
        ref: `/tag-groups/${group.id}`,
        sha256: recordHash(group),
        contentVersion: (group as { updatedAt?: string }).updatedAt,
      });
    }
  }

  const m = tag.metadata as Record<string, unknown>;
  const x = fixed(m?.pos_x), y = fixed(m?.pos_y), z = fixed(m?.pos_z);

  const payload: TagPayload = {
    format: TAG_FORMAT_VERSION,
    kind: 'part',
    subject: { id: tag.id, label: tag.label, anchorId: tag.anchorId, type: tag.type },
    issuer: { platform: 'SIB', version: PLATFORM_VERSION },
    ...(x && y && z ? { spatial: { x, y, z } } : {}),
    streams,
    subscribe: { hints: [`/perception/pass-state/${tag.id}`] },
    contentVersion: maxVersion(tag.updatedAt, ...streams.map(s => s.contentVersion)),
  };
  const { privateKey, publicKeyRaw } = issuerKeys();
  return { payload, signature: signPayload(payload, privateKey, publicKeyRaw) };
}

// ── Assembly envelope ────────────────────────────────────────────────────────

export function buildAssemblyEnvelope(anchorId: string): TagEnvelope | null {
  const anchor = anchorStore.findById(anchorId);
  if (!anchor) return null;

  const streams: TagStreamRef[] = [{
    name: 'anchor',
    ref: `/anchors/${anchor.id}`,
    sha256: recordHash({ ...anchor, encryptionKey: undefined }),  // never commit the AES key into an envelope
    contentVersion: (anchor as { updatedAt?: string }).updatedAt,
  }];

  const worldmapFile = path.join(DATA_DIR, 'worldmaps', `${anchor.id}.arworldmap`);
  if (fs.existsSync(worldmapFile)) {
    streams.push({ name: 'worldmap', ref: `/worldmap/${anchor.id}`, sha256: fileHash(worldmapFile) });
  }

  const guides = guideStore.findAll().filter(g => g.anchorId === anchor.id);
  if (guides.length) {
    const steps = guideStepStore.findAll().filter(s => guides.some(g => g.id === s.guideId));
    streams.push({
      name: 'guides',
      ref: `/guides?anchorId=${anchor.id}`,
      sha256: recordHash({ guides, steps }),
      contentVersion: maxVersion(...guides.map(g => (g as { updatedAt?: string }).updatedAt)),
    });
  }

  const kit = model3DStore.findAll().filter(mo =>
    mo.category === 'general' || (mo.anchorIds ?? []).includes(anchor.id) || mo.anchorId === anchor.id);
  if (kit.length) {
    streams.push({ name: 'models', ref: `/models?anchorId=${anchor.id}`, sha256: recordHash(kit) });
  }

  const lotoPoints = lotoPointStore.findAll().filter(pt => pt.anchorId === anchor.id);
  if (lotoPoints.length) {
    const lotoEvents = lotoEventStore.findAll().filter(ev => ev.anchorId === anchor.id);
    streams.push({
      name: 'loto',
      ref: `/loto/status?anchorId=${anchor.id}`,
      sha256: recordHash({ points: lotoPoints, events: lotoEvents }),
    });
  }

  const findings = locTagStore.findAll().filter(lt => lt.anchorId === anchor.id);
  if (findings.length) {
    streams.push({ name: 'gemba', ref: `/loc-tags?anchorId=${anchor.id}`, sha256: recordHash(findings) });
  }

  const sessions = sessionStore.findAll().filter(s =>
    s.anchorId === anchor.id || s.assetId === anchor.assetId);
  if (sessions.length) {
    streams.push({ name: 'inspections', ref: `/sessions`, sha256: recordHash(sessions) });
  }

  // Member manifest — the Merkle links to every part on this chamber.
  const parts = tagStore.findAll()
    .filter(t => t.anchorId === anchor.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const members: TagMemberRef[] = [];
  for (const part of parts) {
    const env = buildPartEnvelope(part.id);
    if (!env) continue;
    members.push({
      tagId: part.id,
      label: part.label,
      ref: `/tags/${part.id}/emit`,
      sha256: payloadHash(env.payload),
    });
  }

  const payload: TagPayload = {
    format: TAG_FORMAT_VERSION,
    kind: 'assembly',
    subject: { id: anchor.id, label: String(anchor.metadata?.name ?? anchor.assetId), assetId: anchor.assetId },
    issuer: { platform: 'SIB', version: PLATFORM_VERSION },
    streams,
    members,
    subscribe: { hints: [`/loto/status?anchorId=${anchor.id}`, '/guide-sessions/live'] },
    contentVersion: maxVersion(
      ...streams.map(s => s.contentVersion),
      ...parts.map(p => p.updatedAt),
    ),
  };
  const { privateKey, publicKeyRaw } = issuerKeys();
  return { payload, signature: signPayload(payload, privateKey, publicKeyRaw) };
}
