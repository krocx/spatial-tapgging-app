// oms/signals.ts — C2 (2026.4.46): deviations from the learned baseline
// become hints. Nothing here is a fixed threshold in disguise: every trigger
// compares the current visit with the step's baseline (C1) — what other
// people did on this very step — and the floor values only exist to stop a
// two-session baseline from firing on noise.
//
//   signal          fires when (this visit vs. baseline)
//   ─────────────── ─────────────────────────────────────────────────────────
//   dwell           elapsed > dwellSec.p90 (baseline needs ≥ 3 visits)
//   attention-off   ≥ 15 samples and onTargetRatio < 20 % (FLOOR), or below
//                   the baseline p10 when that is stricter
//   wrong-part      wrongPartTaps ≥ 3 (FLOOR); a baseline p90 of 1 tightens
//                   it to 2 — a noisy baseline never LOOSENS it
//   look-away       step has a view, ≥ 20 samples, never aligned (FLOOR: 20 s;
//                   a baseline median under 20 s brings it earlier)
//   validate-retry  ≥ 3 validation attempts on the visit, no pass verdict
//
// Floors are absolute so a fresh guide — or one whose baseline is a tester's
// own wrong taps — still coaches. Baselines can only make a trigger EARLIER.
// `mode: 'demo'` ignores baselines altogether: floors only, every run alike.
//
// Each signal fires ONCE per visit. Phrasing: a template that quotes the
// baseline ("most people finish this in about 50 s") — or, when an LLM is
// configured (ASK_LLM_URL), the same facts handed to the model with the
// step's text and part names to phrase; the template is the fallback.
//
// `detectSignals` and `templateHint` are pure and unit-tested; `phraseHint`
// wraps the optional LLM call.

import type { GuideStep, OmsUsageStepEntry, StepBaseline } from '@spatial/shared';
import { chatCompletion, llmConfig } from '../ask/llm.js';

export type SignalKind = 'dwell' | 'attention-off' | 'wrong-part' | 'look-away' | 'validate-retry';

export interface Signal {
  kind:      SignalKind;
  /** Compact, human-readable evidence for the log / portal (no free text from the device). */
  evidence:  string;
  /** The facts a phrasing (template or LLM) may quote. */
  facts:     Record<string, number | string>;
}

/** The floors — the most a signal ever needs. */
export const FLOORS = { wrongTaps: 3, attentionBelow: 0.20, attentionSamples: 15, lookAwaySec: 20, dwellMinSec: 20 };

/** What a step currently needs to fire, given its baseline and mode. */
export function effectiveTriggers(baseline: StepBaseline | undefined, mode: 'normal' | 'demo' = 'normal') {
  const trusted = mode === 'normal' && !!baseline && baseline.sessions >= MIN_BASELINE_VISITS;
  const wrongTaps = trusted && baseline?.wrongPartTaps ? Math.min(FLOORS.wrongTaps, Math.max(2, baseline.wrongPartTaps.p90 + 1)) : FLOORS.wrongTaps;
  const attentionBelow = trusted && baseline?.onTargetRatio ? Math.max(FLOORS.attentionBelow, baseline.onTargetRatio.p10) : FLOORS.attentionBelow;
  const lookAwayAfterSec = trusted && baseline ? Math.min(FLOORS.lookAwaySec, Math.max(10, baseline.dwellSec.p50)) : FLOORS.lookAwaySec;
  const dwellAfterSec = trusted && baseline ? Math.max(FLOORS.dwellMinSec, baseline.dwellSec.p90) : undefined;
  return { wrongTaps, attentionBelow, lookAwayAfterSec, dwellAfterSec, mode };
}

export interface SignalInput {
  visit:        OmsUsageStepEntry;
  /** Guide CI mode (Guide.ciMode); demo = floors only. */
  mode?:        'normal' | 'demo';
  elapsedSec:   number;
  baseline?:    StepBaseline;
  step:         GuideStep;
  alreadyFired: ReadonlySet<SignalKind>;
}

const MIN_BASELINE_VISITS = 3;

export function detectSignals(input: SignalInput): Signal[] {
  const { visit, elapsedSec, baseline, step, alreadyFired } = input;
  const mode = input.mode ?? 'normal';
  const out: Signal[] = [];
  const o = visit.observations;
  const trusted = mode === 'normal' && !!baseline && baseline.sessions >= MIN_BASELINE_VISITS;
  const eff = effectiveTriggers(baseline, mode);

  if (trusted && baseline && eff.dwellAfterSec !== undefined && !alreadyFired.has('dwell') && elapsedSec > eff.dwellAfterSec) {
    out.push({ kind: 'dwell',
      evidence: `on step ${Math.round(elapsedSec)} s; 90 % of ${baseline.sessions} visits finished within ${baseline.dwellSec.p90} s`,
      facts: { elapsedSec: Math.round(elapsedSec), typicalSec: baseline.dwellSec.p50, p90Sec: baseline.dwellSec.p90, visits: baseline.sessions } });
  }

  if (o && !alreadyFired.has('attention-off') && o.samples >= FLOORS.attentionSamples && o.onTargetRatio < eff.attentionBelow) {
    const typical = trusted && baseline?.onTargetRatio ? Math.round(baseline.onTargetRatio.p50 * 100) : Math.round(eff.attentionBelow * 100);
    out.push({ kind: 'attention-off',
      evidence: `attention on target ${Math.round(o.onTargetRatio * 100)} % over ${o.samples} s; needs ≥ ${Math.round(eff.attentionBelow * 100)} %`,
      facts: { onTargetPct: Math.round(o.onTargetRatio * 100), typicalPct: typical, samples: o.samples } });
  }

  if (o && !alreadyFired.has('wrong-part') && o.wrongPartTaps >= eff.wrongTaps) {
    out.push({ kind: 'wrong-part',
      evidence: `${o.wrongPartTaps} taps on parts this step is not about (fires at ${eff.wrongTaps})`,
      facts: { wrongTaps: o.wrongPartTaps, cap: eff.wrongTaps - 1 } });
  }

  if (o && step.view && !alreadyFired.has('look-away') && o.samples >= FLOORS.lookAwaySec && (o.alignedSec ?? 0) === 0 && elapsedSec > eff.lookAwayAfterSec) {
    out.push({ kind: 'look-away',
      evidence: `never matched the recommended viewpoint in ${o.samples} s`,
      facts: { samples: o.samples } });
  }

  if (o && !alreadyFired.has('validate-retry') && o.validateAttempts >= 3 && visit.validation?.result !== 'pass') {
    out.push({ kind: 'validate-retry',
      evidence: `${o.validateAttempts} validation attempts without a pass`,
      facts: { attempts: o.validateAttempts, ...(baseline?.validationFailRate !== undefined && { failRatePct: Math.round(baseline.validationFailRate * 100) }) } });
  }
  return out;
}

/** Template phrasing — the fallback and the ground truth for tests. */
export function templateHint(signal: Signal, step: GuideStep, partNames: string[] = []): string {
  const label = step.title?.trim() || step.text.slice(0, 50).trim();
  const parts = partNames.length ? partNames.slice(0, 2).join(' and ') : undefined;
  const f = signal.facts;
  switch (signal.kind) {
    case 'dwell':
      return `Most people finish “${label}” in about ${f.typicalSec} s. If something is unclear, open the panel or replay the animation${parts ? ` for the ${parts}` : ''}.`;
    case 'attention-off':
      return `The step is about ${parts ?? 'the highlighted part'} — it has been out of view for a while. Turn back to it; the blue marker shows the best angle.`;
    case 'wrong-part':
      return `That part is not in this step. Look for ${parts ?? 'the highlighted part'}; it pulses when the step starts.`;
    case 'look-away':
      return `Stand where the blue camera marker is for a clear view of ${parts ?? 'this step'} — others align there first.`;
    case 'validate-retry':
      return `Validation keeps missing. Match the ghost image as closely as you can, hold still, then capture${f.failRatePct !== undefined ? ` — this step fails for ${f.failRatePct} % of people on the first try, so you are not alone` : ''}.`;
  }
}

/** Phrase with the LLM when configured; always falls back to the template. */
export async function phraseHint(signal: Signal, step: GuideStep, partNames: string[] = [], opts: { forceTemplate?: boolean } = {}): Promise<{ text: string; via: 'llm' | 'template' }> {
  const fallback = templateHint(signal, step, partNames);
  // C3: a step where the LLM phrasing scored below the template falls back.
  if (opts.forceTemplate || !llmConfig()) return { text: fallback, via: 'template' };
  try {
    const text = await chatCompletion([
      { role: 'system', content:
        'You coach a technician wearing AR glasses through a maintenance step. Write ONE short hint (max 160 characters), plain and specific, no greeting, no emoji, no markdown. ' +
        'Use only the facts given; never invent numbers or part names. If the facts mention how others did, you may say so briefly.' },
      { role: 'user', content: JSON.stringify({
        step: { title: step.title ?? '', text: step.text.slice(0, 400) },
        parts: partNames.slice(0, 4),
        signal: signal.kind,
        evidence: signal.evidence,
        facts: signal.facts,
        fallback,
      }) },
    ], { timeoutMs: 8_000, temperature: 0.3, maxTokens: 80 });
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length < 12 || clean.length > 220) return { text: fallback, via: 'template' };
    return { text: clean, via: 'llm' };
  } catch {
    return { text: fallback, via: 'template' };
  }
}
