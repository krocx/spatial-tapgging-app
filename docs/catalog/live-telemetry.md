---
id: live-telemetry
name: Live session telemetry (SSE)
area: guides
status: shipped
version: baseline
depends: [evidence-signoff]
terms: [AR Work Instructions, SIB]
spec: SERVER-REFERENCE.md
api: |
  POST /guide-sessions/live — open live session (app · API key)
  POST /guide-sessions/live/:id/events — push step events incl. step:stalled (app · API key)
  GET /guide-sessions/live/:id/stream — SSE feed of a running session (portal · API key)
  GET /guide-sessions/live/:id — live session snapshot (portal · API key)
arch: |
  sequenceDiagram
    participant O as Operator (iOS)
    participant R as POST /guide-sessions/live/:id/events
    participant M as sse/guide-session.sse.ts
    participant W as Observers (SSE)
    O->>R: step entered / completed / failed / retry / stalled ... (7 event types)
    R->>M: Push into live session
    M-->>W: GET /guide-sessions/live/:id/stream - real-time fan-out
    M->>M: Each event also invokes the AI guide adapter
    Note over M: Session linked to the sign-off record on completion
---
Seven event types stream over Server-Sent Events during a guided walk — step
entered, completed, failed, stalled and friends — so observers see progress in real
time and the AI guidance adapter has live context to react to.
