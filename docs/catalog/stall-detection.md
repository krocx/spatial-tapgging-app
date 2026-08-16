---
id: stall-detection
name: Stall detection
area: guides
status: shipped
version: baseline
depends: [live-telemetry]
terms: [AR Work Instructions]
spec: ../README.md
---
Ninety seconds of dwell on an incomplete step raises a `step:stalled` event and a
hint automatically. The operator who is stuck but hasn't asked for help is exactly
the operator the platform should notice.
