// usage-log.ts — the AR OMS Usage Log (K2, 2026.4.45).
//
// Durable, per-step usage records keyed by liveSessionId, derived ENTIRELY
// server-side from the live-session event stream — the iOS app sends nothing
// extra beyond the workContext at session open. LiveGuideSession stays
// intentionally ephemeral (AI telemetry); this store is the system of record
// for "who worked which Production # / guide, for how long, step by step".
//
// Event mapping:
//   session open      → new record (workContext + operator identity captured)
//   step:entered      → close any open entry as 'left', open a new one
//   step:completed    → close the matching open entry as 'completed'
//   step:failed       → close the matching open entry as 'failed'
//   session:submitted → close remaining entry, stamp endedAt/totalSeconds
//   sign-off POST     → link the durable GuideSession id (belt & braces end)

import type {
  GuideSessionEventType,
  LiveGuideSession,
  OmsUsageSession,
  OmsUsageStepEntry,
  OpenLiveSessionRequest,
  PushGuideSessionEventRequest,
} from '@spatial/shared';
import { JsonFileStore } from '../stores/json-file-store.js';

export const omsUsageStore = new JsonFileStore<OmsUsageSession>('oms-usage-log');

const seconds = (fromIso: string, toIso: string): number =>
  Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 1000));

/** Create the usage record when a live session opens. */
export function usageOpen(
  live: LiveGuideSession,
  req: OpenLiveSessionRequest,
  verified?: { email?: string; employeeId?: string },
): OmsUsageSession {
  const rec: OmsUsageSession = {
    id:           live.id,
    guideId:      live.guideId,
    guideName:    live.guideName,
    anchorId:     live.anchorId,
    anchorName:   live.anchorName,
    operatorName: live.operatorName,
    startedAt:    live.startedAt,
    completed:    false,
    steps:        [],
    ...(req.workContext?.trim() ? { workContext: req.workContext.trim() } : {}),
    // Token-verified identity wins over client-supplied fields.
    ...((verified?.email ?? req.operatorEmail) ? { operatorEmail: verified?.email ?? req.operatorEmail } : {}),
    ...((verified?.employeeId ?? req.operatorEmployeeId)
      ? { operatorEmployeeId: verified?.employeeId ?? req.operatorEmployeeId } : {}),
  };
  omsUsageStore.save(rec);
  return rec;
}

/** Close the newest still-open step entry, if any. */
function closeOpenEntry(
  rec: OmsUsageSession,
  outcome: OmsUsageStepEntry['outcome'],
  ts: string,
  durationSeconds?: number,
): void {
  for (let i = rec.steps.length - 1; i >= 0; i--) {
    const e = rec.steps[i];
    if (e.outcome === 'open') {
      e.outcome         = outcome;
      e.exitedAt        = ts;
      e.durationSeconds = durationSeconds ?? seconds(e.enteredAt, ts);
      return;
    }
  }
}

/** Fold one live-session event into the usage record. Unknown ids are ignored
 *  (e.g. sessions opened before this feature deployed). */
export function usageRecordEvent(
  liveSessionId: string,
  type: GuideSessionEventType,
  req: PushGuideSessionEventRequest,
): void {
  const rec = omsUsageStore.findById(liveSessionId);
  if (!rec) return;
  const ts = new Date().toISOString();

  switch (type) {
    case 'step:entered': {
      if (!req.stepId) break;
      closeOpenEntry(rec, 'left', ts);
      rec.steps.push({
        stepId:    req.stepId,
        ...(req.stepIndex !== undefined ? { stepIndex: req.stepIndex } : {}),
        enteredAt: ts,
        outcome:   'open',
      });
      break;
    }
    case 'step:completed':
      closeOpenEntry(rec, 'completed', ts, req.durationSeconds);
      break;
    case 'step:failed':
      closeOpenEntry(rec, 'failed', ts, req.durationSeconds);
      break;
    case 'session:submitted':
      closeOpenEntry(rec, 'left', ts);
      rec.endedAt      = ts;
      rec.totalSeconds = seconds(rec.startedAt, ts);
      rec.completed    = true;
      break;
    default:
      return;   // retried/stalled/perception events don't change timing rows
  }
  omsUsageStore.save(rec);
}

/** Link the durable sign-off record; also finalises timing if the
 *  session:submitted event never arrived (e.g. offline queue drain). */
export function usageLinkSignOff(liveSessionId: string, signOffSessionId: string): void {
  const rec = omsUsageStore.findById(liveSessionId);
  if (!rec) return;
  rec.signOffSessionId = signOffSessionId;
  if (!rec.endedAt) {
    const ts = new Date().toISOString();
    closeOpenEntry(rec, 'left', ts);
    rec.endedAt      = ts;
    rec.totalSeconds = seconds(rec.startedAt, ts);
    rec.completed    = true;
  }
  omsUsageStore.save(rec);
}

/** Listing with optional filters, newest first. */
export function listUsage(filter?: { workContext?: string; guideId?: string }): OmsUsageSession[] {
  let all = omsUsageStore.findAll();
  if (filter?.workContext) all = all.filter(u => u.workContext === filter.workContext);
  if (filter?.guideId)     all = all.filter(u => u.guideId === filter.guideId);
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
