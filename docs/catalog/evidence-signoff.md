---
id: evidence-signoff
name: Evidence capture + sign-off
area: guides
status: shipped
version: baseline
depends: [spatial-steps]
terms: [Evidence Capture]
spec: ../README.md#ar-work-instructions-ar-oms
api: |
  POST /guide-sessions — sign-off with per-step completions + evidence (app · API key)
  GET /guide-sessions — run history grouped for review (portal · API key)
  GET /guide-sessions/:id/evidence/:stepId — step evidence photo (portal · API key)
wireframe: portal
arch: |
  sequenceDiagram
    participant O as Operator (ARGuideSessionView)
    participant S as POST /guide-sessions
    participant E as GET /guide-sessions/:id/evidence/:stepId
    O->>O: Per-step camera - evidence attached to the step
    O->>S: Sign-off - operator, per-step durations, outcomes, photos
    Note over S: Linked to the live session record if one was open
    E-->>E: Portal AR Guides tab reviews evidence in the lightbox
---
Per-step evidence photos and a completion sign-off recording operator, timestamps
and durations. Sessions are reviewable in the portal with every photo — proof of
work as a by-product of doing the work, not an extra chore.
