---
id: portal-iloto
name: Portal iLOTO tab
area: iloto
status: shipped
version: 2026.4.42
depends: [loto-event-log, loto-training]
terms: [LOTO, Supervisor Override, Certification]
spec: ILOTO.md
wireframe: portal
---
The EHS review surface: a live status board per control panel (per-point state,
owner, serial), the audit trail with override events pinned first and evidence
photos in the lightbox, the certification registry, and one-click CSV export of
events and certifications. Read-only by design — the portal reviews the log, it
never writes it.
