---
id: portal-iloto
name: Portal iLOTO tab
area: iloto
status: shipped
version: 2026.4.42
depends: [loto-event-log, loto-training]
terms: [LOTO, Supervisor Override, Certification]
spec: ILOTO.md
api: |
  GET /loto/quiz/admin — bank WITH answers (portal · admin key)
  POST /loto/quiz/questions — add question (portal · admin key)
  PATCH /loto/quiz/questions/:id — edit question (portal · admin key)
  POST /loto/quiz/import — bulk replace bank, JSON/CSV (portal · admin key)
wireframe: portal
arch: |
  flowchart LR
    subgraph Portal["Portal iLOTO tab (read-only by design)"]
      B["Status board"] --> S["GET /loto/status"]
      A["Audit trail - overrides pinned first"] --> E["GET /loto/events + evidence lightbox"]
      C["Cert registry"] --> CT["GET /loto/certifications"]
      CSV["Client-side CSV export"]
    end
    Q["Training questions editor"] --> QA["GET /loto/quiz/admin + POST /loto/quiz/import (atomic)"]
    NOTE["No portal route can write an event - the log is append-only from the field"] -.-> E
---
The EHS review surface: a live status board per control panel (per-point state,
owner, serial), the audit trail with override events pinned first and evidence
photos in the lightbox, the certification registry, and one-click CSV export of
events and certifications. Read-only by design — the portal reviews the log, it
never writes it.
