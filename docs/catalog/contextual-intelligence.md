---
id: contextual-intelligence
name: Contextual intelligence — observations, baselines, signal hints, effectiveness loop
area: guides
status: shipped
version: 2026.4.46
depends: [usage-log, live-telemetry, ai-guidance]
terms: [Operator Mode]
spec: CONTEXTUAL-INTELLIGENCE.md
api: |
  POST /guide-sessions/live/:id/observations — batch of 1 Hz engine-neutral observations for the current step (attention, distance, alignment, movement, interactions) (any client · API key)
  GET /guide-sessions/baselines/:guideId — learned per-step baselines: dwell p50/p90, on-target ratio, wrong-part taps, replays, validation fail rate, stall rate (portal · any client)
  GET /guide-sessions/intelligence/:guideId — C3: per-step heat (left / validation / wrong-part / stall / attention / viewpoint rates), hint effectiveness table with retirements, author-facing fix notes (portal · API key)
wireframe: operator
arch: |
  flowchart LR
    D["Any client<br/>iPad · Unity · WebXR · glasses"] -->|1 Hz samples, 5 s batches| O["POST /guide-sessions/live/:id/observations"]
    O --> R["usage record: per-visit roll-up<br/>attention · taps · replays · alignment · distance"]
    O --> J["observations/<session>.jsonl (raw)"]
    R --> B["computeBaselines(): percentiles over completed visits"]
    B --> G["GET /guide-sessions/baselines/:guideId"]
    G --> S["signals.ts: this visit vs. baseline<br/>dwell · attention-off · wrong-part · look-away · validate-retry"]
    S --> P["phrase: template (baseline facts) or LLM via ask/llm.ts"]
    P --> H["hint queue → GET /guide-sessions/live/:id/hints"]
    H -->|what happened after| E["intelligence.ts: score each hint<br/>retire weak signals per step · prefer better phrasing"]
    E -->|retiredSignals · preferredVia| S
    E --> I["GET /guide-sessions/intelligence/:guideId<br/>portal 🧠 Intelligence: heat · hints · notes"]
---
The device is a sensor and SIB is the judge. While an operator is on a step,
the client streams a compact, engine-neutral observation record — what the
view centre is on, distance and aim to the step target, look-from-here
alignment, movement, and discrete interactions such as tapping the wrong part
or replaying the animation. SIB rolls these into the usage record and learns
per-guide, per-step baselines from completed visits: dwell percentiles,
on-target ratio, wrong-part taps, replays, validation fail rate, stall rate.
Nothing is hard-coded; the numbers come from real sessions and sharpen with
every one. After each batch the current visit is compared with that baseline
and each new deviation (dwell past the p90, attention below the p10, wrong-part
taps beyond the p90, never aligned on a viewed step, repeated validation
misses) becomes one hint — phrased from the baseline facts, or by the Ask-SIB
model when one is configured — delivered through the hint queue every client
already polls. A Unity, WebXR or glasses client gets the same intelligence by
posting the same JSON.

**C3 — the loop closes.** Every hint is scored by what happened after it,
from the raw samples and the visit outcome (dwell: completed within the
window; wrong-part: no more wrong taps; attention-off: on-target ratio rose;
look-away: viewpoint reached; validate-retry: passed). Per step and signal,
over the last 50 visits: shown ≥ 5 with effectiveness < 30 %, or mute rate
≥ 50 % over ≥ 4, retires the signal on that step — C2 stops firing it — and
it lifts by itself when newer runs improve; where both LLM and template
phrasings have evidence and the LLM scores lower, the step uses the template.
The portal's **🧠 Intelligence** page (AR Guides Sessions) shows per-step
heat, the rate tiles, the hint table with 🔕 retired badges, and notes that
point authors at the content to fix rather than the hint.
