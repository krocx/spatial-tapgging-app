---
id: sessions-review
name: Sessions / Gemba / AR Guides review
area: portal
status: shipped
version: baseline
depends: [inspection-sessions, resolution-tracking, evidence-signoff]
terms: [Evidence Capture]
spec: SERVER-REFERENCE.md
api: |
  GET /sessions — inspection history (portal · API key)
  PATCH /sessions/:id/report — reviewer notes on a session (portal · API key)
wireframe: portal
arch: |
  flowchart LR
    subgraph Portal["Portal (single-file index.html)"]
      T["Sessions / Gemba / AR Guides tabs"] --> F["apiFetch with X-API-Key"]
      T --> LB["Evidence blob cache + openLightbox"]
      T --> CSV["downloadCSV - client-side"]
    end
    F --> R1["GET /sessions + evidence"]
    F --> R2["GET /loc-tags"]
    F --> R3["GET /guide-sessions + per-step evidence"]
---
Full history of every inspection session, Gemba walk and guided procedure — grouped,
with evidence photos in a lightbox, CSV export, and pilot-scale review tools:
free-text search, per-anchor and date-range filters, and show-more pagination
on every tab. The review side of everything the
phone records.
