// ai-guide-adapter.ts — AI Dynamic Instructions adapter (Step 3, AI-readiness gap plan)
//
// Mirrors the structure of perception-adapter.ts:
//   • Define the AIGuideAdapter interface (the extension point)
//   • Provide a StubAIGuideAdapter (fully self-contained — no LLM call, no cloud)
//   • Maintain a registry so a real LLM adapter can be swapped in without touching
//     any of the surrounding infrastructure
//
// Intervention logic (stub):
//   After RETRY_THRESHOLD `step:retried` events on the same step, the stub fires.
//   It generates a hint from the step's ttsText (if present) or a generic nudge.
//   If the step has a `nextOnFailure` branch, the hint includes a navigate action
//   so iOS can offer the user a "Go to recovery step" button.
//
// To register a real LLM adapter (e.g. local Ollama, self-hosted model):
//   1. Implement AIGuideAdapter
//   2. Call registerAIGuideAdapter(new MyAdapter())
//   3. Optionally set it as the active adapter with setActiveAIGuideAdapter('my-adapter')

import { v4 as uuidv4 } from 'uuid';
import type { AIHint, GuideSessionEvent, GuideStep, LiveGuideSession } from '@spatial/shared';

// ── Adapter contract ──────────────────────────────────────────────────────────

export interface AIGuideContext {
  /** The full in-flight live session (event history, current step index). */
  liveSession:   LiveGuideSession;
  /** All steps for this guide in sequenceNumber order (with graph fields). */
  guideSteps:    GuideStep[];
  /** The step the Operator is currently on (resolved from currentStepIndex). */
  currentStep:   GuideStep | undefined;
  /** Events emitted since the session started. */
  recentEvents:  GuideSessionEvent[];
  /** Number of `step:retried` events on the current step so far. */
  retryCount:    number;
}

export interface AIGuideAdapter {
  readonly name: string;

  /**
   * Return true if the adapter should generate a hint for this context.
   * Called synchronously after every `step:retried` push — keep it fast.
   */
  shouldIntervene(ctx: AIGuideContext): boolean;

  /**
   * Generate and return a hint, or null if the adapter declines.
   * May be async (e.g. an LLM call). The result is queued and delivered to iOS.
   */
  generateHint(ctx: AIGuideContext): Promise<AIHint | null>;
}

// ── Stub adapter (no external dependencies) ───────────────────────────────────

/** Trigger a hint after this many retries on the same step. */
const RETRY_THRESHOLD = 3;

export class StubAIGuideAdapter implements AIGuideAdapter {
  readonly name = 'stub-ai-guide';

  shouldIntervene(ctx: AIGuideContext): boolean {
    return ctx.retryCount >= RETRY_THRESHOLD;
  }

  async generateHint(ctx: AIGuideContext): Promise<AIHint | null> {
    const step = ctx.currentStep;
    if (!step) return null;

    // Build hint text: prefer the step's TTS script as it's authored guidance.
    // Fall back to a generic nudge that references the step title/text.
    const stepLabel = step.title?.trim() || step.text.slice(0, 60);
    const hintText  = step.ttsText?.trim()
      ?? `You've retried "${stepLabel}" ${ctx.retryCount} times. Double-check the reference image and try again from a stable position.`;

    const hint: AIHint = {
      id:            uuidv4(),
      liveSessionId: ctx.liveSession.id,
      stepId:        step.id,
      text:          hintText,
      ts:            new Date().toISOString(),
    };

    // If this step has a nextOnFailure branch, surface a navigate action
    // so iOS can offer the user a "Go to recovery step" button.
    if (step.nextOnFailure) {
      hint.action       = 'navigate';
      hint.targetStepId = step.nextOnFailure;
    } else {
      hint.action = 'none';
    }

    console.log(`[ai-guide] Stub hint for step ${step.id} (retries=${ctx.retryCount}): "${hintText.slice(0, 80)}…"`);
    return hint;
  }
}

// ── Registry ──────────────────────────────────────────────────────────────────

const registry   = new Map<string, AIGuideAdapter>();
let   activeName = 'stub-ai-guide';

export function registerAIGuideAdapter(adapter: AIGuideAdapter): void {
  registry.set(adapter.name, adapter);
}

export function setActiveAIGuideAdapter(name: string): void {
  if (!registry.has(name)) {
    throw new Error(`[ai-guide] Adapter "${name}" is not registered`);
  }
  activeName = name;
  console.log(`[ai-guide] Active adapter set to "${name}"`);
}

export function getActiveAIGuideAdapter(): AIGuideAdapter | undefined {
  return registry.get(activeName);
}

export function listAIGuideAdapters(): string[] {
  return Array.from(registry.keys());
}

// Register the stub by default.
registerAIGuideAdapter(new StubAIGuideAdapter());
