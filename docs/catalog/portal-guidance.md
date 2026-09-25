---
id: portal-guidance
name: Portal guided assistance
area: portal
status: shipped
version: 2026.4.45
depends: [home-page, chamber-configs, guide-library]
terms: [Anchor Portal]
spec: CONNECTED-WORKER.md#portal-guided-assistance
api: |
  GET /stats - chamberConfigs, chambersAssigned, guides, placedGuides drive the checklist (browser · public)
wireframe: portal
flow: |
  flowchart LR
    C["🧭 Getting started checklist<br/>configuration → chamber + QR → guide → steps placed → first run"] -->|"live from /stats"| G["milestones turn green · 3/5 minimises · 5/5 celebrates"]
    T["page tours (spotlight) once per page<br/>❔ Show me replays"] --> U["Home · Chambers · Guide Library · AR Guides · Admin"]
    E["empty states → next steps"] --> U
---
The portal's first-time experience in the iOS tour's voice: a getting-started
checklist whose milestones turn green from live server data and link into the
right page, spotlight tours of the controls that matter on each page, and empty
states that say what to do next instead of "no data". A settings toggle turns it
off; technicians never see it. The portal itself opens on a tile-grid Home with a
hash router and admin sub-pages.
