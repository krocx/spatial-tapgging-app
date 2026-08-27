// tag-subscribe.ts — the .tag continuous emitter (M2): live per-chamber push.
//
// PROPRIETARY & CONFIDENTIAL — Applied Materials. Patent pending.
//
// SSE subscribers on GET /anchors/:id/subscribe receive:
//   event: state    — on connect: current contentVersion + payload hash
//   event: changed  — whenever the chamber's assembly envelope changes,
//                     naming exactly which streams/members moved so readers
//                     re-fetch only the delta
//   heartbeat comments every 25s keep proxies from closing idle streams.
//
// Change detection is event-driven, not polled: the JsonFileStore write bus
// (storeEvents) fires on every persisted mutation; we debounce 400ms, then
// recompute the assembly hash ONLY for anchors that currently have
// subscribers. A slow 30s safety sweep additionally catches file-only changes
// (world-map binaries) that bypass the JSON stores.

import type { Response } from 'express';
import { storeEvents } from '../stores/json-file-store.js';
import { buildAssemblyEnvelope } from './tag-emitter.js';
import { payloadHash, TagPayload } from './tag-core.js';

const DEBOUNCE_MS = 400;
const SAFETY_SWEEP_MS = 30_000;
const HEARTBEAT_MS = 25_000;

// ── Pure diff engine (unit-tested) ───────────────────────────────────────────

/**
 * Names what changed between two assembly payloads: "stream:<name>" for
 * chamber streams (added, removed, or re-hashed), "member:<tagId>" for parts.
 * Empty array = nothing changed (hashes identical).
 */
export function diffAssemblyPayloads(prev: TagPayload, next: TagPayload): string[] {
  const changed: string[] = [];
  const prevStreams = new Map(prev.streams.map(s => [s.name, s.sha256]));
  const nextStreams = new Map(next.streams.map(s => [s.name, s.sha256]));
  for (const [name, hash] of nextStreams) {
    if (prevStreams.get(name) !== hash) changed.push(`stream:${name}`);
  }
  for (const name of prevStreams.keys()) {
    if (!nextStreams.has(name)) changed.push(`stream:${name}`);
  }
  const prevMembers = new Map((prev.members ?? []).map(m => [m.tagId, m.sha256]));
  const nextMembers = new Map((next.members ?? []).map(m => [m.tagId, m.sha256]));
  for (const [id, hash] of nextMembers) {
    if (prevMembers.get(id) !== hash) changed.push(`member:${id}`);
  }
  for (const id of prevMembers.keys()) {
    if (!nextMembers.has(id)) changed.push(`member:${id}`);
  }
  return changed;
}

// ── Subscription manager ─────────────────────────────────────────────────────

interface AnchorSub {
  clients: Set<Response>;
  lastPayload: TagPayload;
  lastHash: string;
}

const subs = new Map<string, AnchorSub>();
let debounceTimer: NodeJS.Timeout | null = null;
let sweepTimer: NodeJS.Timeout | null = null;
let hooked = false;

function send(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function recheckAll(): void {
  for (const [anchorId, sub] of subs) {
    const env = buildAssemblyEnvelope(anchorId);
    if (!env) continue;                       // anchor deleted — clients will see silence + heartbeats
    const hash = payloadHash(env.payload);
    if (hash === sub.lastHash) continue;
    const changed = diffAssemblyPayloads(sub.lastPayload, env.payload);
    sub.lastPayload = env.payload;
    sub.lastHash = hash;
    for (const client of sub.clients) {
      send(client, 'changed', {
        contentVersion: env.payload.contentVersion,
        payloadSha256: hash,
        changed,
      });
    }
  }
}

function ensureHooks(): void {
  if (hooked) return;
  hooked = true;
  storeEvents.on('write', () => {
    if (subs.size === 0) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(recheckAll, DEBOUNCE_MS);
  });
}

function ensureSweep(): void {
  if (sweepTimer || subs.size === 0) return;
  sweepTimer = setInterval(() => {
    if (subs.size === 0) { clearInterval(sweepTimer!); sweepTimer = null; return; }
    recheckAll();
  }, SAFETY_SWEEP_MS);
  sweepTimer.unref?.();
}

/** Attach an SSE client to an anchor's change feed. Returns false if the
 *  anchor doesn't exist (caller responds 404). */
export function subscribeToAnchor(anchorId: string, res: Response): boolean {
  const env = buildAssemblyEnvelope(anchorId);
  if (!env) return false;
  ensureHooks();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let sub = subs.get(anchorId);
  const hash = payloadHash(env.payload);
  if (!sub) {
    sub = { clients: new Set(), lastPayload: env.payload, lastHash: hash };
    subs.set(anchorId, sub);
  } else if (sub.lastHash !== hash) {
    // Catch up the baseline so the next diff is against current truth.
    sub.lastPayload = env.payload;
    sub.lastHash = hash;
  }
  sub.clients.add(res);
  ensureSweep();

  send(res, 'state', {
    contentVersion: env.payload.contentVersion,
    payloadSha256: hash,
    members: (env.payload.members ?? []).length,
  });

  const heartbeat = setInterval(() => { res.write(': hb\n\n'); }, HEARTBEAT_MS);
  heartbeat.unref?.();

  res.on('close', () => {
    clearInterval(heartbeat);
    const s = subs.get(anchorId);
    if (!s) return;
    s.clients.delete(res);
    if (s.clients.size === 0) subs.delete(anchorId);
  });
  return true;
}

/** Test/ops hook: current subscriber counts per anchor. */
export function subscriberCounts(): Record<string, number> {
  return Object.fromEntries([...subs].map(([id, s]) => [id, s.clients.size]));
}
