// presence.ts — P1 (2026.4.46): who is in front of a chamber right now.
//
// Multi-user co-authoring rides on two things that already exist:
//   • a SHARED FRAME — every device localises into the chamber's frame (sealed
//     map / object), so poses from two iPads are directly comparable even when
//     they stand in front of two physical units of the same chamber type;
//   • the per-anchor SSE feed (GET /anchors/:id/subscribe).
//
// Each device POSTs its camera pose ~2×/s; SIB keeps the latest entry per
// user IN MEMORY (never persisted — it is not a record, it is a heartbeat)
// and fans it out to the anchor's subscribers as `presence` events. Entries
// that stop refreshing are dropped after STALE_MS with a `presence:left`.
//
// Edit echo: guide-step store writes are announced as `guide-steps` events
// (debounced) so a colleague's pin appears on the other iPad within a second.

import type { PresenceEntry, PresenceUpdate } from '@spatial/shared';
import { storeEvents } from '../stores/json-file-store.js';
import { broadcastToAnchor } from '../tag/tag-subscribe.js';

export const STALE_MS = 30_000;
const SWEEP_MS = 5_000;
const EDIT_DEBOUNCE_MS = 300;

const byAnchor = new Map<string, Map<string, PresenceEntry>>();
let sweepTimer: NodeJS.Timeout | null = null;
let editTimer: NodeJS.Timeout | null = null;
let hooked = false;

// ── Pure validation (unit-tested) ────────────────────────────────────────────

export function validatePresenceUpdate(body: unknown): { ok: true; value: PresenceUpdate } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  if (typeof b.userId !== 'string' || !b.userId.trim()) return { ok: false, error: 'userId is required' };
  if (typeof b.name !== 'string' || !b.name.trim()) return { ok: false, error: 'name is required' };
  const surfaces = ['placeSteps', 'author', 'operator', 'guide'];
  if (typeof b.surface !== 'string' || !surfaces.includes(b.surface)) return { ok: false, error: `surface must be one of ${surfaces.join(', ')}` };
  if (!Array.isArray(b.pose) || b.pose.length !== 16 || !b.pose.every(n => typeof n === 'number' && Number.isFinite(n))) {
    return { ok: false, error: 'pose must be 16 finite numbers' };
  }
  const value: PresenceUpdate = {
    userId:  b.userId.trim().slice(0, 64),
    name:    b.name.trim().slice(0, 80),
    surface: b.surface as PresenceUpdate['surface'],
    pose:    b.pose as number[],
  };
  if (typeof b.role === 'string')    value.role    = b.role.slice(0, 32);
  if (typeof b.guideId === 'string') value.guideId = b.guideId.slice(0, 64);
  if (typeof b.focusId === 'string') value.focusId = b.focusId.slice(0, 64);
  if (typeof b.site === 'string')    value.site    = b.site.trim().slice(0, 40);
  return { ok: true, value };
}

// ── Store ────────────────────────────────────────────────────────────────────

export function updatePresence(anchorId: string, u: PresenceUpdate, now = Date.now()): PresenceEntry {
  ensureHooks();
  let m = byAnchor.get(anchorId);
  if (!m) { m = new Map(); byAnchor.set(anchorId, m); }
  const isNew = !m.has(u.userId);
  const entry: PresenceEntry = { ...u, anchorId, updatedAt: new Date(now).toISOString() };
  m.set(u.userId, entry);
  broadcastToAnchor(anchorId, isNew ? 'presence:joined' : 'presence', entry);
  ensureSweep();
  return entry;
}

export function listPresence(anchorId: string, now = Date.now()): PresenceEntry[] {
  const m = byAnchor.get(anchorId);
  if (!m) return [];
  return [...m.values()].filter(e => now - Date.parse(e.updatedAt) <= STALE_MS);
}

export function leavePresence(anchorId: string, userId: string): boolean {
  const m = byAnchor.get(anchorId);
  if (!m || !m.has(userId)) return false;
  m.delete(userId);
  if (m.size === 0) byAnchor.delete(anchorId);
  broadcastToAnchor(anchorId, 'presence:left', { anchorId, userId, reason: 'left' });
  return true;
}

/** Drop entries that stopped refreshing. Exported for tests. */
export function sweepPresence(now = Date.now()): number {
  let dropped = 0;
  for (const [anchorId, m] of byAnchor) {
    for (const [userId, e] of m) {
      if (now - Date.parse(e.updatedAt) > STALE_MS) {
        m.delete(userId); dropped++;
        broadcastToAnchor(anchorId, 'presence:left', { anchorId, userId, reason: 'timeout' });
      }
    }
    if (m.size === 0) byAnchor.delete(anchorId);
  }
  return dropped;
}

/** Test hook. */
export function resetPresence(): void { byAnchor.clear(); }

// ── Wiring ───────────────────────────────────────────────────────────────────

function ensureSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    sweepPresence();
    if (byAnchor.size === 0 && sweepTimer) { clearInterval(sweepTimer); sweepTimer = null; }
  }, SWEEP_MS);
  sweepTimer.unref?.();
}

function ensureHooks(): void {
  if (hooked) return;
  hooked = true;
  // Edit echo: a colleague's step write → every anchor with people present
  // is told to refresh its steps. Cheap (one small event), debounced.
  storeEvents.on('write', (storeName: string) => {
    if (storeName !== 'guide-steps' && storeName !== 'guides') return;
    if (byAnchor.size === 0) return;
    if (editTimer) clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      for (const anchorId of byAnchor.keys()) {
        broadcastToAnchor(anchorId, 'guide-steps', { anchorId, store: storeName, at: new Date().toISOString() });
      }
    }, EDIT_DEBOUNCE_MS);
  });
}
