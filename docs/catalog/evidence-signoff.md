---
id: evidence-signoff
name: Evidence capture + sign-off
area: guides
status: shipped
version: 2026.4.45
depends: [spatial-steps]
terms: [Evidence Capture]
spec: ../README.md#ar-work-instructions-ar-oms
api: |
  POST /guide-sessions - sign-off with per-step completions + evidence (app · API key)
  GET /guide-sessions - run history grouped for review (portal · API key)
  GET /guide-sessions/:id/evidence/:stepId - step evidence photo (portal · API key)
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
and durations. Authors can mark a step "Require evidence photo" (carried through
the Procedure Designer round-trip) and the operator cannot complete it without
one; validated steps supply the validation frame as their evidence. Photos upload
live and the usage log is the system of record (see usage-log); sessions are
reviewable in the portal with every photo and exportable to Excel - proof of work
as a by-product of doing the work, not an extra chore.
