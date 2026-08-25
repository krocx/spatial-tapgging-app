---
id: ai-guidance
name: AI-assisted guidance
area: guides
status: shipped
version: baseline
depends: [live-telemetry, stall-detection, adapter-architecture]
terms: [Adapter, AI Dynamic Instructions]
spec: ../README.md#ar-work-instructions-ar-oms
api: |
  GET /guide-sessions/live/:id/hints — consume-once contextual hint queue (app · API key)
arch: |
  sequenceDiagram
    participant M as guide-session.sse.ts
    participant A as adapters/ai-guide-adapter.ts
    participant Q as Consume-once hint queue
    participant O as Operator (iOS poll)
    M->>A: Session event (retry, step:stalled, ...)
    A->>A: Decide whether to help (rule-based today, model-swappable interface)
    A->>Q: Enqueue hint for the step
    O->>Q: GET /guide-sessions/live/:id/hints
    Q-->>O: Hint delivered once, then consumed
    Note over O: Stale hints discarded at poll and auto-dismissed when the step completes
---
An adapter watches the live session stream and decides when to help; hints are
delivered through a consume-once queue and surface in AR as a glanceable ✨ assist
chip — auto-expanding into the full card only on a stall (the operator is stuck),
with recovery-step and replay-voice actions, a session hint tray, and a per-step
cooldown. Hints auto-dismiss when their step completes.
Today's adapter is rule-based (retries, stalls); the interface is the point — a
local model drops in without touching the client.
