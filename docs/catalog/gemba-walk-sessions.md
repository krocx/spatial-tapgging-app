---
id: gemba-walk-sessions
name: Walk sessions + summary
area: gemba
status: shipped
version: 2026.4.46
depends: [audit-library, loc-tags]
terms: [Gemba Walk, Finding Category]
spec: GEMBA-WALK.md
api: |
  POST /gemba/walks — start a walk with the header (auditor, project, org, BU, area, location) (app · API key)
  GET /gemba/walks — walks with derived summaries; filter by anchor, auditor, status (app, portal · API key)
  GET /gemba/walks/:id — walk + its findings (app, portal · API key)
  PATCH /gemba/walks/:id — header / notes (app, portal · API key)
  POST /gemba/walks/:id/submit — close the walk, return the summary (app · API key)
  POST /gemba/walks/:id/reopen — reopen a submitted walk (portal · admin)
  DELETE /gemba/walks/:id — remove the walk record, findings detached (portal · admin)
  GET /gemba/walks/export.xlsx — one row per finding, first photo embedded; ?walkId= or ?all=true (portal · API key)
  PUT /gemba/library/lists/:kind — walk-header pick list (portal · admin)
wireframe: gemba
arch: |
  flowchart LR
    S["iOS: Start Gemba Walk sheet<br/>auditor · project · org · BU · area · location"] --> W["POST /gemba/walks → walkId"]
    W --> F["findings POST /loc-tags { walkId }"]
    F --> SUB["Finish: map upload → POST /gemba/walks/:id/submit"]
    SUB --> SUM["Session Summary sheet<br/>counts by category · max risk · log"]
    W & F --> P["Portal › GembaWalks › Walk Sessions<br/>rows · chips · expand · ⬇ .xlsx"]
    P --> X["GET /gemba/walks/export.xlsx<br/>buildTableXlsx — photo per row"]
---
The walk is the unit the reviewer cares about — who walked where, for which
project, and what they found. A walk collects the same header the PowerApps tool
did, groups the findings logged under it, and closes with a session summary on
the phone and a one-click Excel in the portal. The summary is derived from the
findings on every read, so it can never disagree with them.
