// oms/intelligence.ts — C3 (2026.4.46): the effectiveness loop.
//
// Every hint C2 fired is scored by what happened AFTER it, using the raw
// observation samples already on disk (observations/<session>.jsonl) and the
// visit outcome. Scores roll up per (step, signal, phrasing) and feed back:
//
//   • C2 asks `retiredSignals(guideId, stepId)` before firing — a signal with
//     low effectiveness or a high mute rate on a step is retired there;
//   • `preferredVia(guideId, stepId, signal)` lets a step fall back to the
//     template when the LLM phrasing scores lower;
//   • the portal Intelligence page reads `GET /guide-sessions/intelligence/:id`
//     — per-step heat (stall / wrong-part / attention / look-away / validation
//     / left rates), the hint table, and author-facing notes.
//
// "Helped" per signal (the symptom eased after the hint):
//   dwell            visit completed within max(30 s, step p50) of the hint
//   wrong-part       no tap-wrong-part sample after the hint
//   attention-off    on-target ratio after the hint > before
//   look-away        a viewAligned sample after the hint
//   validate-retry   the visit's verdict is pass (and it completed)
//
// Retirement (per step, per signal, over the last RECENT_VISITS visits):
//   shown ≥ 5 and effectiveness < 0.3   → retired (low effectiveness)
//   shown+muted ≥ 4 and muted/(shown+muted) ≥ 0.5 → retired (muted)
// It lifts by itself when newer visits push the score back over the line.
//
// `scoreVisit`, `computeIntelligence` are pure; the JSONL reader is injected.

import fs   from 'fs';
import path from 'path';
import type {
  GuideIntelligence, GuideStep, HintEffectiveness, OmsUsageSession, OmsUsageStepEntry,
  SessionObservation, StepBaseline, StepIntelligence,
} from '@spatial/shared';
import { DATA_DIR } from '../data-dir.js';
import { omsUsageStore } from './usage-log.js';
import { computeBaselines } from './observations.js';
import { effectiveTriggers } from './signals.js';
import { guideStore } from '../guides/store.js';

export const RECENT_VISITS = 50;
export const MIN_SHOWN_FOR_RETIRE = 10;
export const LOW_EFFECTIVENESS = 0.3;
export const MIN_FOR_MUTE_RETIRE = 6;
export const HIGH_MUTE_RATE = 0.5;

export type RawSample = SessionObservation & { step: string };
export type SampleReader = (liveSessionId: string) => RawSample[];

/** Default reader: the JSONL C1 appends (best-effort; missing file = no samples). */
export function readSamples(liveSessionId: string): RawSample[] {
  try {
    const file = path.join(DATA_DIR, 'observations', `${liveSessionId.replace(/[^a-zA-Z0-9-_]/g, '')}.jsonl`);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) as RawSample; } catch { return null; } }).filter((s): s is RawSample => !!s);
  } catch { return []; }
}

export interface HintOutcome { signal: string; via: 'llm' | 'template'; delivery: 'shown' | 'muted'; helped: boolean }

/** Score every hint on one visit (pure). `samples` are the raw rows for the visit's step. */
export function scoreVisit(visit: OmsUsageStepEntry, samples: SessionObservation[], baseline?: StepBaseline): HintOutcome[] {
  const out: HintOutcome[] = [];
  const entered = Date.parse(visit.enteredAt);
  const visitEnd = visit.exitedAt ? Date.parse(visit.exitedAt) : (visit.durationSeconds !== undefined ? entered + visit.durationSeconds * 1000 : NaN);
  for (const h of visit.hints ?? []) {
    const delivery = h.delivery ?? 'shown';
    if (delivery === 'muted') { out.push({ signal: h.signal, via: h.via, delivery, helped: false }); continue; }
    const hintT = Math.max(0, (Date.parse(h.ts) - entered) / 1000);      // seconds into the visit
    const before = samples.filter(s => s.t < hintT);
    const after  = samples.filter(s => s.t >= hintT);
    let helped = false;
    switch (h.signal) {
      case 'dwell': {
        const window = Math.max(30, baseline?.dwellSec.p50 ?? 0);
        helped = visit.outcome === 'completed' && Number.isFinite(visitEnd) && (visitEnd - Date.parse(h.ts)) / 1000 <= window;
        break;
      }
      case 'wrong-part':
        helped = after.length > 0 && !after.some(s => s.interaction === 'tap-wrong-part');
        break;
      case 'attention-off': {
        const ratio = (xs: SessionObservation[]) => { const a = xs.filter(s => s.attention); if (!a.length) return -1; return a.filter(s => s.attention === 'target' || s.attention === 'assembly' || s.attention === 'pin').length / a.length; };
        const rb = ratio(before), ra = ratio(after);
        helped = ra >= 0 && ra > rb;
        break;
      }
      case 'look-away':
        helped = after.some(s => s.viewAligned === true || s.interaction === 'look-aligned');
        break;
      case 'validate-retry':
        helped = visit.outcome === 'completed' && visit.validation?.result === 'pass';
        break;
      default:
        helped = visit.outcome === 'completed';
    }
    out.push({ signal: h.signal, via: h.via, delivery, helped });
  }
  return out;
}

function rate(n: number, d: number): number | undefined { return d > 0 ? Math.round((n / d) * 100) / 100 : undefined; }

/** Build the whole picture for one guide (pure apart from the injected sample reader). */
export function computeIntelligence(
  guideId: string, sessions: OmsUsageSession[], steps: GuideStep[], samplesFor: SampleReader,
  now = new Date().toISOString(), mode: 'normal' | 'demo' = 'normal',
): GuideIntelligence {
  const mine = sessions.filter(s => s.guideId === guideId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const baselines = computeBaselines(guideId, mine, now);
  const stepMeta = new Map(steps.map(s => [s.id, s]));

  type Acc = {
    visits: number; all: number; left: number; stalled: number; obsVisits: number; wrongVisits: number;
    attnVisits: number; attnOff: number; viewVisits: number; neverAligned: number;
    hints: Map<string, { shown: number; muted: number; helped: number }>; recentVisits: number;
  };
  const acc = new Map<string, Acc>();
  const get = (id: string) => { let a = acc.get(id); if (!a) { a = { visits: 0, all: 0, left: 0, stalled: 0, obsVisits: 0, wrongVisits: 0, attnVisits: 0, attnOff: 0, viewVisits: 0, neverAligned: 0, hints: new Map(), recentVisits: 0 }; acc.set(id, a); } return a; };

  // Newest visits first per step so the hint window is "the last RECENT_VISITS".
  const visitsByStep = new Map<string, { visit: OmsUsageStepEntry; sessionId: string }[]>();
  for (const s of mine) for (const e of s.steps) {
    if (!visitsByStep.has(e.stepId)) visitsByStep.set(e.stepId, []);
    visitsByStep.get(e.stepId)!.push({ visit: e, sessionId: s.id });
  }
  const sampleCache = new Map<string, RawSample[]>();
  const samplesOf = (sessionId: string) => { let v = sampleCache.get(sessionId); if (!v) { v = samplesFor(sessionId); sampleCache.set(sessionId, v); } return v; };

  for (const [stepId, list] of visitsByStep) {
    const a = get(stepId);
    const baseline = baselines.steps.find(b => b.stepId === stepId);
    const step = stepMeta.get(stepId);
    list.reverse();                                                     // newest first
    for (const { visit, sessionId } of list) {
      if (visit.outcome === 'open') continue;
      a.all++;
      if (visit.outcome === 'left' || visit.outcome === 'failed') a.left++;
      if (visit.outcome === 'completed') a.visits++;
      const o = visit.observations;
      if (o) {
        a.obsVisits++;
        if (o.stalls > 0) a.stalled++;
        if (o.wrongPartTaps > 0) a.wrongVisits++;
        if (o.samples >= 15) { a.attnVisits++; if (o.onTargetRatio < 0.5) a.attnOff++; }
        if (step?.view && o.samples >= 20) { a.viewVisits++; if ((o.alignedSec ?? 0) === 0) a.neverAligned++; }
      }
      if (visit.hints?.length && a.recentVisits < RECENT_VISITS) {
        a.recentVisits++;
        const rows = samplesOf(sessionId).filter(s => s.step === stepId);
        for (const h of scoreVisit(visit, rows, baseline)) {
          const key = `${h.signal}|${h.via}`;
          let c = a.hints.get(key); if (!c) { c = { shown: 0, muted: 0, helped: 0 }; a.hints.set(key, c); }
          if (h.delivery === 'muted') c.muted++; else { c.shown++; if (h.helped) c.helped++; }
        }
      }
    }
  }

  let retiredHints = 0;
  const out: StepIntelligence[] = [];
  const ordered = [...steps].sort((x, y) => x.sequenceNumber - y.sequenceNumber);
  const ids = [...new Set([...ordered.map(s => s.id), ...acc.keys()])];
  for (const stepId of ids) {
    const a = acc.get(stepId);
    const step = stepMeta.get(stepId);
    const baseline = baselines.steps.find(b => b.stepId === stepId);
    const si: StepIntelligence = {
      stepId, ...(step && { stepIndex: step.sequenceNumber, title: step.title || step.text.slice(0, 60) }),
      visits: a?.visits ?? 0, heat: 0, hints: [], notes: [],
      ...(baseline && { dwellSec: baseline.dwellSec }),
    };
    // What the engine needs on this step right now (portal "engine" line) — floors on a fresh guide.
    {
      const t = effectiveTriggers(baseline, mode);
      si.triggers = { wrongTaps: t.wrongTaps, attentionBelowPct: Math.round(t.attentionBelow * 100), lookAwayAfterSec: t.lookAwayAfterSec, ...(t.dwellAfterSec !== undefined && { dwellAfterSec: Math.round(t.dwellAfterSec) }), mode };
    }
    if (a) {
      si.stallRate        = rate(a.stalled, a.obsVisits);
      si.wrongPartRate    = rate(a.wrongVisits, a.obsVisits);
      si.attentionOffRate = rate(a.attnOff, a.attnVisits);
      si.lookAwayRate     = rate(a.neverAligned, a.viewVisits);
      si.leftRate         = rate(a.left, a.all);
      if (baseline?.validationFailRate !== undefined) si.validationFailRate = baseline.validationFailRate;
      // Signal-level totals decide retirement (phrasings share the step's fate for muting).
      const bySignal = new Map<string, { shown: number; muted: number; helped: number }>();
      for (const [key, c] of a.hints) { const sig = key.split('|')[0]; const t = bySignal.get(sig) ?? { shown: 0, muted: 0, helped: 0 }; t.shown += c.shown; t.muted += c.muted; t.helped += c.helped; bySignal.set(sig, t); }
      for (const [key, c] of a.hints) {
        const [signal, via] = key.split('|') as [string, 'llm' | 'template'];
        const t = bySignal.get(signal)!;
        const eff = t.shown ? t.helped / t.shown : undefined;
        const muteRate = t.shown + t.muted ? t.muted / (t.shown + t.muted) : 0;
        let reason: string | undefined;
        if (t.shown >= MIN_SHOWN_FOR_RETIRE && eff !== undefined && eff < LOW_EFFECTIVENESS) reason = `helped ${t.helped} of ${t.shown} — below ${Math.round(LOW_EFFECTIVENESS * 100)} %`;
        else if (t.shown + t.muted >= MIN_FOR_MUTE_RETIRE && muteRate >= HIGH_MUTE_RATE) reason = `muted ${t.muted} of ${t.shown + t.muted} times`;
        const cell: HintEffectiveness = {
          signal, via, shown: c.shown, muted: c.muted, helped: c.helped,
          ...(c.shown > 0 && { effectiveness: Math.round((c.helped / c.shown) * 100) / 100 }),
          retired: !!reason, ...(reason && { reason }),
        };
        si.hints.push(cell);
      }
      si.hints.sort((x, y) => x.signal.localeCompare(y.signal) || x.via.localeCompare(y.via));
      retiredHints += new Set(si.hints.filter(h => h.retired).map(h => h.signal)).size;
      // Heat: weighted rates, 0–100.
      const w = (v: number | undefined, k: number) => (v ?? 0) * k;
      si.heat = Math.min(100, Math.round(100 * (w(si.leftRate, 0.35) + w(si.validationFailRate, 0.2) + w(si.wrongPartRate, 0.15) + w(si.stallRate, 0.15) + w(si.attentionOffRate, 0.1) + w(si.lookAwayRate, 0.05))));

      // Author-facing notes — only when there is enough behind the number.
      const pct = (v: number) => `${Math.round(v * 100)} %`;
      if (a.obsVisits >= 3 && (si.wrongPartRate ?? 0) >= 0.3) si.notes.push(`${pct(si.wrongPartRate!)} of visits tap a part that is not in this step — the part label or photo is not distinguishing it.`);
      if (a.obsVisits >= 3 && (si.stallRate ?? 0) >= 0.3) si.notes.push(`${pct(si.stallRate!)} of visits stall here — the instruction may be missing a sub-step or the animation is too fast.`);
      if (a.attnVisits >= 3 && (si.attentionOffRate ?? 0) >= 0.4) si.notes.push(`${pct(si.attentionOffRate!)} of visits spend most of the step looking away from the part — check the pin and the model placement.`);
      if (a.viewVisits >= 3 && (si.lookAwayRate ?? 0) >= 0.5) si.notes.push(`${pct(si.lookAwayRate!)} of visits never reach the recommended viewpoint — it may be unreachable on the floor; consider re-recording it.`);
      if (baseline && baseline.sessions >= 3 && (si.validationFailRate ?? 0) >= 0.4) si.notes.push(`${pct(si.validationFailRate!)} of validations fail on the first verdict — retrain the reference or relax the framing.`);
      if (a.all >= 3 && (si.leftRate ?? 0) >= 0.3) si.notes.push(`${pct(si.leftRate!)} of visits end without completing — people give up or branch away here.`);
      if (baseline && baseline.sessions >= 3 && baseline.dwellSec.p90 > 3 * Math.max(10, baseline.dwellSec.p50)) si.notes.push(`Dwell is uneven: typical ${baseline.dwellSec.p50} s, slowest tenth ${baseline.dwellSec.p90} s — some people are lost on this step.`);
      for (const h of si.hints.filter(h => h.retired)) if (!si.notes.some(n => n.includes(`"${h.signal}"`))) si.notes.push(`The "${h.signal}" hint is retired on this step (${h.reason}) — the step content, not the hint, needs the fix.`);
    }
    out.push(si);
  }

  const withData = out.filter(s => s.visits > 0).length;
  const confidence: GuideIntelligence['confidence'] =
    mine.length === 0 || withData === 0 ? 'none' : mine.length < 3 ? 'low' : mine.length < 10 ? 'medium' : 'high';
  return { guideId, computedAt: now, sessions: mine.length, confidence, retiredHints, steps: out };
}

// ── Cached access for C2 + the route ─────────────────────────────────────────

const cache = new Map<string, { at: number; value: GuideIntelligence }>();
const TTL_MS = 60_000;
let stepLookup: (guideId: string) => GuideStep[] = () => [];
/** Wired by the routes layer (avoids a store import cycle). */
export function setIntelligenceStepLookup(fn: (guideId: string) => GuideStep[]): void { stepLookup = fn; }

/** `fresh` bypasses the cache (the portal page); C2's per-batch calls use the 60 s cache. */
export function guideIntelligence(guideId: string, fresh = false): GuideIntelligence {
  const hit = cache.get(guideId);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = computeIntelligence(guideId, omsUsageStore.findAll(), stepLookup(guideId), readSamples, new Date().toISOString(), guideStore.findById(guideId)?.ciMode ?? 'normal');
  cache.set(guideId, { at: Date.now(), value });
  return value;
}

/** Signals C2 must not fire on this step right now. */
export function retiredSignals(guideId: string, stepId: string): Set<string> {
  const si = guideIntelligence(guideId).steps.find(s => s.stepId === stepId);
  return new Set((si?.hints ?? []).filter(h => h.retired).map(h => h.signal));
}

/** 'template' when both phrasings have enough evidence and the LLM scores lower; otherwise no preference. */
export function preferredVia(guideId: string, stepId: string, signal: string): 'template' | undefined {
  const si = guideIntelligence(guideId).steps.find(s => s.stepId === stepId);
  const llm = si?.hints.find(h => h.signal === signal && h.via === 'llm');
  const tpl = si?.hints.find(h => h.signal === signal && h.via === 'template');
  if (llm && tpl && llm.shown >= MIN_SHOWN_FOR_RETIRE && tpl.shown >= MIN_SHOWN_FOR_RETIRE
      && (llm.effectiveness ?? 0) < (tpl.effectiveness ?? 0)) return 'template';
  return undefined;
}
