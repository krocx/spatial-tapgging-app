---
id: resolution-tracking
name: Resolution tracking
area: gemba
status: shipped
version: baseline
depends: [loc-tags, defect-taxonomy]
terms: [Evidence Capture]
spec: APP-FEATURES.md
wireframe: portal
arch: |
  sequenceDiagram
    participant W as Next walk (iOS)
    participant P as PATCH /loc-tags/:id
    participant Po as Portal audit trail
    W->>W: Finding reappears in place (worldmap)
    W->>P: resolved / still present / escalated + completion photo
    P-->>Po: Full history per finding - nothing disappears silently
    Note over P: Status changes are updates on the finding, evidence photos append
---
Findings are tracked to closure: resolved, still present, or escalated, with
completion photos on resolution. The portal shows the full audit trail per walk, so
nothing quietly disappears between rounds.
