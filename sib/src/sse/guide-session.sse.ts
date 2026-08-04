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
    maybeGenerateHint(liveSessionId, session, next);
  }

  broadcastToSubscribers(liveSessionId, event);
  return event;
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
