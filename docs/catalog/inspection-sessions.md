---
id: inspection-sessions
name: Inspection sessions + evidence
area: tags
status: shipped
version: baseline
depends: [batch-validation]
terms: [Evidence Capture]
spec: APP-FEATURES.md
wireframe: portal
arch: |
  sequenceDiagram
    participant O as Operator (iOS)
    participant S as POST /sessions
    participant E as POST /sessions/:id/evidence/:tagId
    participant P as Portal Sessions tab
    O->>S: Session record - per-tag verdicts, retakes, timestamps
    O->>E: Evidence photos per tag
    P->>S: GET /sessions + GET /sessions/evidence/:filename
    P-->>P: Grouped review with lightbox + client-side CSV export
    Note over S: sessions.json pruned to stay bounded
---
Every inspection is a session: per-tag results, retakes, evidence photos, timestamps.
Sessions land in the portal as reviewable reports with CSV export — the audit trail
for today and the training data flywheel for future defect-detection models.
