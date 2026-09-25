// oms/observations.ts - C1 (2026.4.46): contextual-intelligence observations.
//
// The device is a sensor; SIB is the judge. Clients stream compact,
// engine-neutral observation records while the operator is on a step
// (attention target, distance/angle to the target, look alignment, movement,
// discrete interactions). This module:
//
//   • folds a batch into the usage record's per-visit roll-up
//     (OmsUsageStepEntry.observations) - durable, small, exportable;
//   • appends the raw samples to a per-session JSONL file for later analysis
//     (one line per observation; never images, never free text);
//   • learns per-guide / per-step BASELINES from completed visits: dwell
//     percentiles, on-target ratio, wrong-part taps, replays, validation fail
//     rate, stall rate. Nothing hard-coded - every number comes from real
//     sessions and moves as more arrive. C2 turns deviations from these
//     baselines into hints; C3 closes the loop on hint effectiveness.
//
// `summarize` and `computeBaselines` are pure so they are unit-tested.

import fs   from 'fs';
import path from 'path';
import type {
  GuideBaselines,
  ObservationBatchRequest,
  OmsUsageSession,
  SessionObservation,
  StepBaseline,
  StepObservationSummary,
} from '@spatial/shared';
import { DATA_DIR } from '../data-dir.js';
import { omsUsageStore } from './usage-log.js';

// ── Raw sample store (JSONL per live session) ────────────────────────────────

const OBS_DIR = path.join(DATA_DIR, 'observations');
fs.mkdirSync(OBS_DIR, { recursive: true });

const MAX_BATCH = 600;            // 10 min at 1 Hz - anything larger is a bug or abuse
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function obsPath(liveSessionId: string): string {
  return path.join(OBS_DIR, `${liveSessionId.replace(/[^a-zA-Z0-9-_]/g, '')}.jsonl`);
}

/** Validate + clamp one observation; returns null when it is not usable. */
export function sanitizeObservation(o: unknown): SessionObservation | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (typeof r.t !== 'number' || !Number.isFinite(r.t) || r.t < 0) return null;
  const out: SessionObservation = { t: Math.round(r.t * 10) / 10 };
  const att = r.attention;
  if (att === 'target' || att === 'assembly' || att === 'pin' || att === 'panel' || att === 'away' || att === 'none') out.attention = att;
  if (typeof r.targetDistM === 'number' && Number.isFinite(r.targetDistM) && r.targetDistM >= 0 && r.targetDistM < 100) out.targetDistM = Math.round(r.targetDistM * 100) / 100;
  if (typeof r.targetAngleDeg === 'number' && Number.isFinite(r.targetAngleDeg)) out.targetAngleDeg = Math.max(0, Math.min(180, Math.round(r.targetAngleDeg)));
  if (typeof r.viewAligned === 'boolean') out.viewAligned = r.viewAligned;
  if (typeof r.moving === 'boolean') out.moving = r.moving;
  const inter = r.interaction;
  if (typeof inter === 'string' && ['tap-part', 'tap-wrong-part', 'replay', 'panel-open', 'panel-close', 'validate-attempt', 'realign', 'look-aligned', 'stall'].includes(inter)) {
    out.interaction = inter as SessionObservation['interaction'];
  }
  if (typeof r.node === 'string' && r.node.length <= 120) out.node = r.node;
  return out;
}

/** Fold observations into a summary (pure). `prev` continues an existing roll-up. */
export function summarize(observations: SessionObservation[], prev?: StepObservationSummary): StepObservationSummary {
  const s: StepObservationSummary = prev
    ? { ...prev, attention: { ...prev.attention } }
    : { samples: 0, attention: {}, onTargetRatio: 0, wrongPartTaps: 0, partTaps: 0, replays: 0, validateAttempts: 0, realigns: 0, stalls: 0, movingSec: 0 };
  const dists: number[] = [];
  let aligned = s.alignedSec;
  for (const o of observations) {
    if (o.attention) {
      s.samples++;
      s.attention[o.attention] = (s.attention[o.attention] ?? 0) + 1;
    }
    if (o.viewAligned !== undefined) aligned = (aligned ?? 0) + (o.viewAligned ? 1 : 0);
    if (o.moving) s.movingSec++;
    if (o.targetDistM !== undefined) dists.push(o.targetDistM);
    switch (o.interaction) {
      case 'tap-part':         s.partTaps++; break;
      case 'tap-wrong-part':   s.wrongPartTaps++; break;
      case 'replay':           s.replays++; break;
      case 'validate-attempt': s.validateAttempts++; break;
      case 'realign':          s.realigns++; break;
      case 'stall':            s.stalls++; break;
      default: break;
    }
  }
  if (aligned !== undefined) s.alignedSec = aligned;
  const on = (s.attention.target ?? 0) + (s.attention.assembly ?? 0) + (s.attention.pin ?? 0);
  s.onTargetRatio = s.samples ? Math.round((on / s.samples) * 100) / 100 : 0;
  if (dists.length) {
    // Running median: blend with the previous one weighted by sample count.
    const sorted = [...dists].sort((a, b) => a - b);
    const med = sorted[Math.floor(sorted.length / 2)];
    s.medianDistM = prev?.medianDistM !== undefined && prev.samples > 0
      ? Math.round(((prev.medianDistM * prev.samples + med * dists.length) / (prev.samples + dists.length)) * 100) / 100
      : med;
  }
  return s;
}

/** Ingest a batch: roll up into the usage record + append raw JSONL.
 *  Returns the summary for the visit, or null if the session is unknown. */
export function ingestObservations(liveSessionId: string, batch: ObservationBatchRequest): StepObservationSummary | null {
  const rec = omsUsageStore.findById(liveSessionId);
  if (!rec) return null;
  const clean = (Array.isArray(batch.observations) ? batch.observations : [])
    .slice(0, MAX_BATCH).map(sanitizeObservation).filter((o): o is SessionObservation => !!o);
  if (!clean.length) return null;

  // Newest visit of this step (the open one, or the last closed one - the
  // client may flush after completing).
  let entry = undefined as OmsUsageSession['steps'][number] | undefined;
  for (let i = rec.steps.length - 1; i >= 0; i--) {
    if (rec.steps[i].stepId === batch.stepId) { entry = rec.steps[i]; break; }
  }
  if (!entry) return null;
  entry.observations = summarize(clean, entry.observations);
  omsUsageStore.save(rec);

  try {
    const file = obsPath(liveSessionId);
    if (!fs.existsSync(file) || fs.statSync(file).size < MAX_FILE_BYTES) {
      const lines = clean.map(o => JSON.stringify({ step: batch.stepId, ...o })).join('\n') + '\n';
      fs.appendFileSync(file, lines);
    }
  } catch { /* raw samples are best-effort; the roll-up is the record */ }
  return entry.observations;
}

// ── Baselines ────────────────────────────────────────────────────────────────

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}
const asc = (a: number[]) => [...a].sort((x, y) => x - y);

/** Learn per-step baselines from usage sessions of one guide (pure). */
export function computeBaselines(guideId: string, sessions: OmsUsageSession[], now = new Date().toISOString()): GuideBaselines {
  const mine = sessions.filter(s => s.guideId === guideId);
  const byStep = new Map<string, { dwell: number[]; onTarget: number[]; wrong: number[]; replays: number[]; verdicts: number; fails: number; visits: number; stalled: number }>();
  for (const s of mine) {
    for (const e of s.steps) {
      if (e.outcome !== 'completed') continue;            // only finished visits define "normal"
      let b = byStep.get(e.stepId);
      if (!b) { b = { dwell: [], onTarget: [], wrong: [], replays: [], verdicts: 0, fails: 0, visits: 0, stalled: 0 }; byStep.set(e.stepId, b); }
      b.visits++;
      if (typeof e.durationSeconds === 'number') b.dwell.push(e.durationSeconds);
      if (e.validation) { b.verdicts++; if (e.validation.result === 'fail') b.fails++; }
      const o = e.observations;
      if (o) {
        if (o.samples >= 3) b.onTarget.push(o.onTargetRatio);
        b.wrong.push(o.wrongPartTaps);
        b.replays.push(o.replays);
        if (o.stalls > 0) b.stalled++;
      }
    }
  }
  const steps: StepBaseline[] = [];
  for (const [stepId, b] of byStep) {
    if (!b.dwell.length) continue;
    const dwell = asc(b.dwell);
    const sb: StepBaseline = {
      stepId, sessions: b.visits,
      dwellSec: { p50: pct(dwell, 0.5), p90: pct(dwell, 0.9) },
    };
    if (b.onTarget.length) { const a = asc(b.onTarget); sb.onTargetRatio = { p50: pct(a, 0.5), p10: pct(a, 0.1) }; }
    if (b.wrong.length)    { const a = asc(b.wrong);    sb.wrongPartTaps = { p50: pct(a, 0.5), p90: pct(a, 0.9) }; }
    if (b.replays.length)  { const a = asc(b.replays);  sb.replays = { p50: pct(a, 0.5) }; }
    if (b.verdicts)        sb.validationFailRate = Math.round((b.fails / b.verdicts) * 100) / 100;
    if (b.visits && b.onTarget.length + b.wrong.length > 0) sb.stallRate = Math.round((b.stalled / b.visits) * 100) / 100;
    steps.push(sb);
  }
  return { guideId, computedAt: now, sessions: mine.length, steps };
}

const baselineCache = new Map<string, { at: number; value: GuideBaselines }>();
const BASELINE_TTL_MS = 60_000;

/** Baselines for a guide from the usage store, cached for a minute. */
export function guideBaselines(guideId: string): GuideBaselines {
  const hit = baselineCache.get(guideId);
  if (hit && Date.now() - hit.at < BASELINE_TTL_MS) return hit.value;
  const value = computeBaselines(guideId, omsUsageStore.findAll());
  baselineCache.set(guideId, { at: Date.now(), value });
  return value;
}
