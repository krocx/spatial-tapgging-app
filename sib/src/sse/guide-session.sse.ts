// guide-session.sse.ts — Live guide session state stream (AI readiness, Phase 2 Step 1)
//
// Manages in-flight LiveGuideSession records and fans real-time step events out
// to SSE observers (AI agents, dashboards) via Server-Sent Events.
//
// Architecture:
//   iOS Operator  ──POST /guide-sessions/live──────────► openLiveSession()
//   iOS Operator  ──POST /guide-sessions/live/:id/events─► pushEvent()
//   AI agent      ──GET  /guide-sessions/live/:id/stream─► subscribeSse()
//   iOS sign-off  ──POST /guide-sessions ─────────────────► closeLiveSession()
//
// Intentionally ephemeral: LiveGuideSession records live in memory only.
// The durable record is the GuideSession created at sign-off; this module
// bridges the gap by giving observers visibility DURING the active walk.
//
// SSE wire format (standard):
//   id: <eventId>\n
//   event: <type>\n
//   data: <JSON>\n\n

import type { Response } from 'express';
import { v4 as uuidv4 }  from 'uuid';
import type {
  LiveGuideSession,
  GuideSessionEvent,
  GuideSessionEventType,
  OpenLiveSessionRequest,
  PushGuideSessionEventRequest,
  AIHint,
  GuideStep,
} from '@spatial/shared';
import {
  getActiveAIGuideAdapter,
  type AIGuideContext,
} from '../adapters/ai-guide-adapter.js';
import { guideStepStore } from '../routes/guides.js';
import { omsUsageStore } from '../oms/usage-log.js';
import { preferredVia, retiredSignals } from '../oms/intelligence.js';
import { guideBaselines } from '../oms/observations.js';
import { detectSignals, phraseHint, type SignalKind } from '../oms/signals.js';

// ── In-memory store ───────────────────────────────────────────────────────────

/** All active + recently-closed live sessions (cleared on server restart). */
const sessions = new Map<string, LiveGuideSession>();

/** SSE subscribers per live session. */
const subscribers = new Map<string, Set<Response>>();

/**
 * Per-session hint queue. iOS polls GET /live/:id/hints to drain this.
 * Consume-once: hints are removed after being read so they're not re-shown.
 */
const hintQueues = new Map<string, AIHint[]>();

/**
 * Retry counter per session: tracks how many `step:retried` events have fired
 * on the *current* step. Reset to 0 whenever the step changes.
 */
const retryCounters = new Map<string, number>();

/** C2: signals already fired per session, keyed by step visit ("stepId#enteredAt"). */
const firedSignals = new Map<string, Map<string, Set<SignalKind>>>();
const signalInFlight = new Set<string>();

/** Auto-evict closed sessions after this window to avoid unbounded growth. */
const EVICT_AFTER_MS = 60 * 60 * 1000; // 1 hour

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Open a new live session record. Called by the iOS app when the Operator
 * enters a guide (before the first step is shown).
 * Returns the newly-assigned liveSessionId.
 */
export function openLiveSession(req: OpenLiveSessionRequest): LiveGuideSession {
  const id  = uuidv4();
  const now = new Date().toISOString();

  const startedEvent: GuideSessionEvent = {
    id:            uuidv4(),
    liveSessionId: id,
    type:          'session:started',
    ts:            now,
  };

  const session: LiveGuideSession = {
    id,
    guideId:          req.guideId,
    anchorId:         req.anchorId,
    guideName:        req.guideName,
    anchorName:       req.anchorName,
    operatorName:     req.operatorName,
    startedAt:        now,
    currentStepIndex: 0,
    events:           [startedEvent],
  };

  sessions.set(id, session);
  hintQueues.set(id, []);
  retryCounters.set(id, 0);
  console.log(`[live-session] Opened ${id} — guide "${req.guideName}" by ${req.operatorName}`);
  return session;
}

/**
 * Append an event to a live session and fan it out to all SSE subscribers.
 * Returns the created event, or null if the session doesn't exist.
 */
export function pushEvent(
  liveSessionId: string,
  req:           PushGuideSessionEventRequest,
): GuideSessionEvent | null {
  const session = sessions.get(liveSessionId);
  if (!session) return null;

  const event: GuideSessionEvent = {
    id:            uuidv4(),
    liveSessionId,
    type:          req.type,
    ts:            new Date().toISOString(),
    ...(req.stepId          !== undefined && { stepId:          req.stepId          }),
    ...(req.stepIndex       !== undefined && { stepIndex:       req.stepIndex       }),
    ...(req.durationSeconds !== undefined && { durationSeconds: req.durationSeconds }),
    ...(req.payload         !== undefined && { payload:         req.payload         }),
  };

  session.events.push(event);

  // Track the latest known step position so GET /live/:id can report current state.
  // Reset the retry counter whenever the Operator moves to a new step.
  if (req.type === 'step:entered' && req.stepIndex !== undefined) {
    session.currentStepIndex = req.stepIndex;
    retryCounters.set(liveSessionId, 0);
  }

  // Count retries on the current step and invoke the AI guide adapter if warranted.
  if (req.type === 'step:retried') {
    const prev = retryCounters.get(liveSessionId) ?? 0;
    const next = prev + 1;
    retryCounters.set(liveSessionId, next);
    maybeGenerateHint(liveSessionId, session, next, false);
  }

  // A stall means the Operator has dwelled on the current step past the client
  // side threshold without completing it. iOS fires this at most once per step
  // visit, so no server-side debounce is needed here.
  if (req.type === 'step:stalled') {
    const retries = retryCounters.get(liveSessionId) ?? 0;
    maybeGenerateHint(liveSessionId, session, retries, true);
  }

  broadcastToSubscribers(liveSessionId, event);
  return event;
}

/**
 * C1: a HUMAN hint from a coaching author. Same queue, same consume-once
 * poll on iOS; `source: 'human'` + `from` drive the operator's card, and
 * an optional `pointer` (guide-map frame) draws a "look here" marker.
 * Returns null if the session doesn't exist.
 */
export function queueHumanHint(liveSessionId: string, input: { text: string; from?: string; stepId?: string; pointer?: number[] }): AIHint | null {
  const session = sessions.get(liveSessionId);
  const queue = hintQueues.get(liveSessionId);
  if (!session || !queue) return null;
  const hint: AIHint = {
    id: uuidv4(),
    liveSessionId,
    ...(input.stepId && { stepId: input.stepId }),
    text: input.text,
    action: 'none',
    trigger: 'coach',
    source: 'human',
    ...(input.from && { from: input.from }),
    ...(input.pointer && { pointer: input.pointer }),
    ts: new Date().toISOString(),
  };
  queue.push(hint);
  return hint;
}

export function liveSessionAnchorId(liveSessionId: string): string | undefined {
  return sessions.get(liveSessionId)?.anchorId;
}

/**
 * Retrieve and clear all pending AI hints for a live session.
 * iOS calls this on every poll cycle (consume-once semantics).
 */
export function drainHints(liveSessionId: string): AIHint[] {
  const queue = hintQueues.get(liveSessionId);
  if (!queue || queue.length === 0) return [];
  const copy = [...queue];
  queue.length = 0; // drain in place
  return copy;
}

/**
 * Close a live session when the Operator submits the sign-off.
 * Links the resulting GuideSession id so observers can follow up.
 */
export function closeLiveSession(liveSessionId: string, linkedSessionId: string): void {
  firedSignals.delete(liveSessionId);
  const session = sessions.get(liveSessionId);
  if (!session) return;

  const now = new Date().toISOString();
  session.linkedSessionId = linkedSessionId;
  session.closedAt        = now;

  const event: GuideSessionEvent = {
    id:            uuidv4(),
    liveSessionId,
    type:          'session:submitted',
    ts:            now,
    payload:       { linkedSessionId },
  };
  session.events.push(event);
  broadcastToSubscribers(liveSessionId, event);

  // Drain all SSE connections for this session — it's done.
  const subs = subscribers.get(liveSessionId);
  if (subs) {
    for (const res of subs) {
      try { res.end(); } catch { /* already closed */ }
    }
    subscribers.delete(liveSessionId);
  }

  console.log(`[live-session] Closed ${liveSessionId} → linked to GuideSession ${linkedSessionId}`);

  // Schedule eviction so the maps don't grow forever.
  setTimeout(() => {
    sessions.delete(liveSessionId);
    hintQueues.delete(liveSessionId);
    retryCounters.delete(liveSessionId);
    console.log(`[live-session] Evicted ${liveSessionId}`);
  }, EVICT_AFTER_MS).unref();
}

/**
 * Look up a live session by id. Returns undefined if not found.
 */
/** Open (not yet submitted) live runs — for /stats and the Compass status dot. */
export function liveRunCount(): number {
  let n = 0;
  for (const s of sessions.values()) if (!s.closedAt) n++;
  return n;
}

export function getLiveSession(id: string): LiveGuideSession | undefined {
  return sessions.get(id);
}

/**
 * Register an Express Response as an SSE subscriber for this session.
 * Immediately replays all buffered events so the observer catches up.
 * Cleans up automatically when the client disconnects.
 */
export function subscribeSse(liveSessionId: string, res: Response): boolean {
  const session = sessions.get(liveSessionId);
  if (!session) return false;

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
  res.flushHeaders();

  // Replay historical events so new subscribers are in sync immediately.
  for (const event of session.events) {
    writeSseFrame(res, event);
  }

  // If the session is already closed, end the stream immediately after replay.
  if (session.closedAt) {
    res.end();
    return true;
  }

  // Register for future events.
  const room = subscribers.get(liveSessionId) ?? new Set<Response>();
  room.add(res);
  subscribers.set(liveSessionId, room);

  // Clean up on client disconnect.
  res.on('close', () => {
    room.delete(res);
    if (room.size === 0) subscribers.delete(liveSessionId);
  });

  return true;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Asynchronously ask the active AI guide adapter whether to intervene and,
 * if so, generate a hint. The hint is enqueued for iOS to poll.
 * Fire-and-forget: never blocks the event-push response path.
 */
function maybeGenerateHint(
  liveSessionId: string,
  session:       LiveGuideSession,
  retryCount:    number,
  stalled:       boolean,
): void {
  const adapter = getActiveAIGuideAdapter();
  if (!adapter) return;

  // Load guide steps for this session to give the adapter graph context.
  const guideSteps: GuideStep[] = guideStepStore
    .findAll()
    .filter((s: GuideStep) => s.guideId === session.guideId)
    .sort((a: GuideStep, b: GuideStep) => a.sequenceNumber - b.sequenceNumber);

  const currentStep = guideSteps[session.currentStepIndex] as GuideStep | undefined;

  const ctx: AIGuideContext = {
    liveSession:  session,
    guideSteps,
    currentStep,
    recentEvents: session.events.slice(-20), // last 20 events for context
    retryCount,
    stalled,
  };

  if (!adapter.shouldIntervene(ctx)) return;

  // Run async — do not await; we never want this to slow down event pushes.
  adapter.generateHint(ctx).then((hint) => {
    if (!hint) return;
    const queue = hintQueues.get(liveSessionId);
    if (queue) {
      queue.push(hint);
      console.log(`[ai-guide] Hint queued for session ${liveSessionId} (step ${hint.stepId})`);
    }
  }).catch((err: unknown) => {
    console.error('[ai-guide] generateHint error:', err);
  });
}

/**
 * C2: after an observation batch lands, compare the current visit with the
 * step's learned baseline and queue a hint for each NEW deviation. Runs at
 * most once per session at a time; never blocks the ingest response.
 */
export function evaluateSignals(liveSessionId: string): void {
  const session = sessions.get(liveSessionId);
  if (!session || session.closedAt || signalInFlight.has(liveSessionId)) return;
  const rec = omsUsageStore.findById(liveSessionId);
  if (!rec) return;
  const visit = [...rec.steps].reverse().find(e => e.outcome === 'open');
  if (!visit) return;
  const step = guideStepStore.findById(visit.stepId);
  if (!step) return;
  const key = `${visit.stepId}#${visit.enteredAt}`;
  let perSession = firedSignals.get(liveSessionId);
  if (!perSession) { perSession = new Map(); firedSignals.set(liveSessionId, perSession); }
  let fired = perSession.get(key);
  if (!fired) { fired = new Set(); perSession.set(key, fired); }

  const baseline = guideBaselines(session.guideId).steps.find(b => b.stepId === visit.stepId);
  const elapsedSec = Math.max(0, (Date.now() - Date.parse(visit.enteredAt)) / 1000);
  // C3: signals retired on this step (low effectiveness / muted) never fire.
  const retired = retiredSignals(session.guideId, visit.stepId);
  const signals = detectSignals({ visit, elapsedSec, baseline, step, alreadyFired: fired }).filter(s => !retired.has(s.kind));
  if (!signals.length) return;
  for (const s of signals) fired.add(s.kind);

  // Part names the step is about — display names from the model's extras are
  // not stored server-side; fall back to the node names without the prefix.
  const partNames = (step.nodes ?? []).map(n => n.label ?? n.node.replace(/^cmp:/, '').replace(/_/g, ' ')).filter((v, i, a) => a.indexOf(v) === i);

  signalInFlight.add(liveSessionId);
  (async () => {
    for (const sig of signals) {
      const { text, via } = await phraseHint(sig, step, partNames, { forceTemplate: preferredVia(session.guideId, step.id, sig.kind) === 'template' });
      const hint: AIHint = {
        id: uuidv4(), liveSessionId, stepId: step.id, text, action: 'none',
        trigger: 'signal', source: 'ai', signal: sig.kind, evidence: sig.evidence, via,
        ts: new Date().toISOString(),
      };
      hintQueues.get(liveSessionId)?.push(hint);
      // Record on the visit for C3 (effectiveness = what happened after).
      const fresh = omsUsageStore.findById(liveSessionId);
      const entry = fresh?.steps.find(e => e.stepId === visit.stepId && e.enteredAt === visit.enteredAt);
      if (fresh && entry) { (entry.hints ??= []).push({ id: hint.id, signal: sig.kind, ts: hint.ts, via }); omsUsageStore.save(fresh); }
      console.log(`[ci] hint (${sig.kind}, ${via}) for session ${liveSessionId}: ${sig.evidence}`);
    }
  })().catch(err => console.error('[ci] evaluateSignals error:', err))
    .finally(() => signalInFlight.delete(liveSessionId));
}

function broadcastToSubscribers(liveSessionId: string, event: GuideSessionEvent): void {
  const room = subscribers.get(liveSessionId);
  if (!room || room.size === 0) return;

  for (const res of room) {
    try {
      writeSseFrame(res, event);
    } catch {
      room.delete(res);
    }
  }
}

function writeSseFrame(res: Response, event: GuideSessionEvent): void {
  res.write(`id: ${event.id}\n`);
  res.write(`event: ${event.type}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
  // flush() is available when compression middleware is installed; call if present.
  if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
    (res as unknown as { flush: () => void }).flush();
  }
}
