---
id: loto-event-log
name: Append-only LOTO audit log
area: iloto
status: shipped
version: 2026.4.42
depends: [iloto-anchors]
terms: [LOTO, Try Test, Supervisor Override]
spec: ILOTO.md
api: |
  GET /loto/events?anchorId= — immutable audit trail (portal · API key)
  GET /loto/events/photo/:filename — event photo evidence (portal · API key)
wireframe: iloto
flow: |
  flowchart LR
    REQ[Apply / remove request] --> REF{Server referees}
    REF -->|checklist incomplete| REJ[400 - named missing step]
    REF -->|foreign lock| FOR[403 - one lock, one person]
    REF -->|valid| EVT[(Event appended - never edited)]
    OVR[Override: 3 confirmations + supervisor + reason] --> EVT
    EVT --> DER[Status derived on read]
arch: |
  sequenceDiagram
    participant W as Worker (iOS)
    participant R as POST /loto/events
    participant C as loto/loto-core.ts - validateEvent
    participant L as Append-only event store
    participant D as derivePointStatus (on read)
    W->>R: apply / remove / override + checklist + photo
    R->>C: Referee: per-kind checklist, try test, cert valid, one-lock-one-person
    alt rule broken
      C-->>W: 400/403 with the named missing step - verbatim in the app
    else valid
      C->>L: Append event (no PATCH or DELETE routes exist)
    end
    W->>D: GET /loto/status | /loto/my | portal board
    D-->>W: Status = latest event wins - derived, never stored
---
Apply, remove and override are events appended to a log with no edit or delete path —
the server enforces per-kind checklists, the mandatory try test, photo evidence on
apply, and one-lock-one-person removal. Status is always derived from the log, never
stored; supervisor override is a distinct event type requiring three OSHA
confirmations and a reason, pinned first in every audit view.
