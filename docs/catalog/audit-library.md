---
id: audit-library
name: Audit Reference Library
area: gemba
status: shipped
version: 2026.4.46
depends: [loc-tags, defect-taxonomy]
terms: [Gemba Walk, Focus Area, Finding Category]
spec: GEMBA-WALK.md
api: |
  GET /gemba/library — focus areas → questions, finding categories, risk ratings, version (app, portal · API key)
  GET /gemba/library/export.json — re-importable library (portal · API key)
  POST /gemba/library/import — atomic bulk load: { mode: append|replace, rows | focusAreas } (portal · admin)
  POST /gemba/library/focus-areas — add a focus area (portal · admin)
  PATCH /gemba/library/focus-areas/:id — edit / deactivate (portal · admin)
  DELETE /gemba/library/focus-areas/:id — remove area + its questions (portal · admin)
  POST /gemba/library/questions — add a question under an area (portal · admin)
  PATCH /gemba/library/questions/:id — edit / move / deactivate (portal · admin)
  DELETE /gemba/library/questions/:id — remove (portal · admin)
wireframe: portal
arch: |
  flowchart LR
    XL["Excel / CSV from Corporate Quality<br/>(Focus Area # · Focus Area · Question Code · Title · Question)"] --> P["Portal › GembaWalks › Audit Library<br/>SheetJS parse → preview → Import"]
    P --> I["POST /gemba/library/import<br/>planImport(): validate ALL rows, then apply<br/>append = upsert by code · replace = wipe first"]
    I --> S1[("gemba-focus-areas.json")]
    I --> S2[("gemba-questions.json")]
    S1 & S2 --> G["GET /gemba/library<br/>one call, version stamp"]
    G --> IOS["iOS Gemba Walk: Focus Area → Question picker<br/>(finding stores question CODE + title)"]
    G --> P
---
The vocabulary a Gemba walk is logged in. The PowerApps Gemba Audit tool bound its
pickers to SharePoint reference lists — auditors chose a Focus Area, then one of its
pre-defined questions, and never typed a category. The library brings those lists into
SIB: Corporate Quality maintains them in the portal (add/edit/deactivate, or import the
same Excel they already keep), the app fetches everything in one call, and every
finding is recorded against a question *code* so later edits to the library never
rewrite history. Finding categories (Strength / OFI / NC) and risk ratings (0–3) are
fixed vocabulary served alongside.
