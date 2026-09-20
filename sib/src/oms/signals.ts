// oms/signals.ts — C2 (2026.4.46): deviations from the learned baseline
// become hints. Nothing here is a fixed threshold in disguise: every trigger
// compares the current visit with the step's baseline (C1) — what other
// people did on this very step — and the floor values only exist to stop a
// two-session baseline from firing on noise.
//
//   signal          fires when (this visit vs. baseline)
//   ─────────────── ─────────────────────────────────────────────────────────
//   dwell           elapsed > dwellSec.p90 (baseline needs ≥ 3 visits)
//   attention-off   ≥ 15 samples and onTargetRatio < onTargetRatio.p10
//   wrong-part      wrongPartTaps > wrongPartTaps.p90 (and ≥ 2)
//   look-away       step has a view, ≥ 20 samples, never aligned, and the
//                   visit is already past the median dwell
//   validate-retry  ≥ 3 validation attempts on the visit, no pass verdict
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

export interface SignalInput {
  visit:        OmsUsageStepEntry;
  elapsedSec:   number;
  baseline?:    StepBaseline;
  step:         GuideStep;
  alreadyFired: ReadonlySet<SignalKind>;
}

const MIN_BASELINE_VISITS = 3;

export function detectSignals(input: SignalInput): Signal[] {
  const { visit, elapsedSec, baseline, step, alreadyFired } = input;
  const out: Signal[] = [];
  const o = visit.observations;
  const trusted = !!baseline && baseline.sessions >= MIN_BASELINE_VISITS;

  if (trusted && baseline && !alreadyFired.has('dwell') && elapsedSec > Math.max(20, baseline.dwellSec.p90)) {
    out.push({ kind: 'dwell',
      evidence: `on step ${Math.round(elapsedSec)} s; 90 % of ${baseline.sessions} visits finished within ${baseline.dwellSec.p90} s`,
      facts: { elapsedSec: Math.round(elapsedSec), typicalSec: baseline.dwellSec.p50, p90Sec: baseline.dwellSec.p90, visits: baseline.sessions } });
  }

  if (o && trusted && baseline?.onTargetRatio && !alreadyFired.has('attention-off')
      && o.samples >= 15 && o.onTargetRatio < baseline.onTargetRatio.p10) {
    out.push({ kind: 'attention-off',
      evidence: `attention on target ${Math.round(o.onTargetRatio * 100)} % over ${o.samples} s; others ≥ ${Math.round(baseline.onTargetRatio.p10 * 100)} %`,
      facts: { onTargetPct: Math.round(o.onTargetRatio * 100), typicalPct: Math.round(baseline.onTargetRatio.p50 * 100), samples: o.samples } });
  }

  if (o && !alreadyFired.has('wrong-part')) {
    const cap = trusted && baseline?.wrongPartTaps ? Math.max(1, baseline.wrongPartTaps.p90) : 2;
    if (o.wrongPartTaps > cap) {
      out.push({ kind: 'wrong-part',
        evidence: `${o.wrongPartTaps} taps on parts this step is not about (others ≤ ${cap})`,
        facts: { wrongTaps: o.wrongPartTaps, cap } });
    }
  }

  if (o && step.view && !alreadyFired.has('look-away') && o.samples >= 20 && (o.alignedSec ?? 0) === 0) {
    const pastTypical = trusted && baseline ? elapsedSec > baseline.dwellSec.p50 : elapsedSec > 45;
    if (pastTypical) {
      out.push({ kind: 'look-away',
        evidence: `never matched the recommended viewpoint in ${o.samples} s`,
        facts: { samples: o.samples } });
    }
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
export async function phraseHint(signal: Signal, step: GuideStep, partNames: string[] = []): Promise<{ text: string; via: 'llm' | 'template' }> {
  const fallback = templateHint(signal, step, partNames);
  if (!llmConfig()) return { text: fallback, via: 'template' };
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
