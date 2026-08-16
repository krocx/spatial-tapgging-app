---
id: loto-event-log
name: Append-only LOTO audit log
area: iloto
status: shipped
version: 2026.4.42
depends: [iloto-anchors]
terms: [LOTO, Try Test, Supervisor Override]
spec: ILOTO.md
wireframe: iloto
flow: |
  flowchart LR
    REQ[Apply / remove request] --> REF{Server referees}
    REF -->|checklist incomplete| REJ[400 - named missing step]
    REF -->|foreign lock| FOR[403 - one lock, one person]
    REF -->|valid| EVT[(Event appended - never edited)]
    OVR[Override: 3 confirmations + supervisor + reason] --> EVT
    EVT --> DER[Status derived on read]
---
Apply, remove and override are events appended to a log with no edit or delete path —
the server enforces per-kind checklists, the mandatory try test, photo evidence on
apply, and one-lock-one-person removal. Status is always derived from the log, never
stored; supervisor override is a distinct event type requiring three OSHA
confirmations and a reason, pinned first in every audit view.
