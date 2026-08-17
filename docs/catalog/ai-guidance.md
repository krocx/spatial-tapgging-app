---
id: ai-guidance
name: AI-assisted guidance
area: guides
status: shipped
version: baseline
depends: [live-telemetry, stall-detection, adapter-architecture]
terms: [Adapter, AI Dynamic Instructions]
spec: ../README.md
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
    Note over O: Stale hints discarded at poll; auto-dismissed when the step completes
---
An adapter watches the live session stream and decides when to help; hints are
delivered through a consume-once queue and auto-dismissed when their step completes.
Today's adapter is rule-based (retries, stalls); the interface is the point — a
local model drops in without touching the client.
