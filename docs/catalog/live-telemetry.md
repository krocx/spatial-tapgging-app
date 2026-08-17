---
id: live-telemetry
name: Live session telemetry (SSE)
area: guides
status: shipped
version: baseline
depends: [evidence-signoff]
terms: [AR Work Instructions, SIB]
spec: SERVER-REFERENCE.md
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
