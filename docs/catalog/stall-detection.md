---
id: stall-detection
name: Stall detection
area: guides
status: shipped
version: baseline
depends: [live-telemetry]
terms: [AR Work Instructions]
spec: ../README.md#ar-work-instructions-ar-oms
arch: |
  sequenceDiagram
    participant O as iOS dwell watchdog (90s timer)
    participant R as POST /guide-sessions/live/:id/events
    participant A as ai-guide-adapter.ts
    O->>O: Step incomplete for 90s
    O->>R: step:stalled event
    R->>A: Adapter sees the stall
    A-->>O: Hint enqueued - surfaces via the hints poll
    Note over O: Timer resets on step change or completion
---
Ninety seconds of dwell on an incomplete step raises a `step:stalled` event and a
hint automatically. The operator who is stuck but hasn't asked for help is exactly
the operator the platform should notice.
