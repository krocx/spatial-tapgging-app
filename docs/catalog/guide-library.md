---
id: guide-library
name: Guide Library
area: portal
status: shipped
version: baseline
depends: [guide-lifecycle, guide-import]
terms: [AR Work Instructions]
spec: ../README.md#anchor-portal-portal
wireframe: portal
arch: |
  flowchart LR
    LIB["Guide Library tab"] --> LIST["GET /guides + GET /guides/:id/steps"]
    LIST --> PLC["Per-step isPlaced badges - placement status at a glance"]
    LIB --> PUB["Publish / Unpublish via PATCH /guides/:id"]
    LIB --> IMP["Import button - xlsx / JSON modal with preview"]
    LIB --> GRAPH["Task graph visualisation per guide"]
    LIB --> FILT["Live filter + post-import jump-and-flash"]
---
Browse, filter, publish/unpublish, import and delete guides, with per-step placement
status at a glance. The library is where an authored or imported procedure becomes —
or stops being — something operators can see.
