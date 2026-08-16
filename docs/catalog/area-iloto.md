---
id: iloto
kind: area
name: iLOTO — Lockout/Tagout
color: "#ef4444"
order: 5
wireframe: iloto
flow: |
  flowchart LR
    CERT[Training quiz -> certification] --> GATE{Certified?}
    GATE -->|no| CERT
    GATE -->|yes| SCAN[Scan panel QR - session origin]
    SCAN --> APPLY[Apply: checklist + photo + try test]
    APPLY --> LOG[(Append-only event log)]
    LOG --> STATUS[Derived status: AR walk, My LOTO, portal]
    STATUS --> REMOVE[Remove: own lock only]
    REMOVE --> LOG
    OVR[Supervisor override] -.exception.-> LOG
---
Spatial Lockout/Tagout on OSHA 1910.147 lines: yellow Safe Off points on breakers,
red LOTO points on switches, and an append-only event log the server referees —
checklists, mandatory try test, photo evidence, one-lock-one-person. Status is always
derived from the log, never edited; the app records, the physical lock protects.
