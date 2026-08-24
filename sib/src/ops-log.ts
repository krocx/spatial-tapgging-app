// ops-log.ts — append-only record of admin & destructive actions.
//
// The Render-logs-style trail for "who did what to the data": every request
// that passes through the admin gate (DELETEs, /admin/*, quiz admin) is
// recorded with its outcome, plus explicit events from the backup route.
// Identity is the request IP until SSO lands — honest about its limits, but
// "a DELETE hit /guides/x from 10.1.2.3 at 14:02 and was ALLOWED" already
// answers most incident questions.
//
// Bounded: the store self-prunes to the newest MAX_EVENTS so it can never
// grow into a disk problem — it is an ops aid, not the compliance log
// (iLOTO's append-only event store remains untouchable and unpruned).

import { v4 as uuidv4 } from 'uuid';
import { JsonFileStore } from './stores/json-file-store.js';

export interface OpsEvent {
  id:      string;
  ts:      string;                                  // ISO 8601
  method:  string;
  path:    string;
  outcome: 'allowed' | 'denied' | 'gate-off';       // gate-off = no SIB_ADMIN_KEY set
  ip?:     string;
  detail?: string;                                  // e.g. "backup full · 132.4 MB"
}

const MAX_EVENTS = 1000;

export const opsLogStore = new JsonFileStore<OpsEvent>('admin-ops-log');

export function logOpsEvent(e: Omit<OpsEvent, 'id' | 'ts'>): void {
  try {
    opsLogStore.save({ id: uuidv4(), ts: new Date().toISOString(), ...e });
    const all = opsLogStore.findAll();
    if (all.length > MAX_EVENTS) {
      const cutoff = [...all].sort((a, b) => a.ts.localeCompare(b.ts))
        .slice(0, all.length - MAX_EVENTS);
      for (const old of cutoff) opsLogStore.delete(old.id);
    }
  } catch (err) {
    // The log must never break the action it observes.
    console.warn('[ops-log] failed to record event:', err);
  }
}

export function recentOpsEvents(limit = 200): OpsEvent[] {
  return opsLogStore.findAll()
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, Math.min(Math.max(limit, 1), MAX_EVENTS));
}
