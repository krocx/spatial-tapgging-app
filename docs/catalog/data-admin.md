---
id: data-admin
name: Data administration
area: portal
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: SERVER-REFERENCE.md
wireframe: portal
arch: |
  flowchart LR
    ROW["Per-row delete"] --> CASC["Server-side cascades in each route"]
    BULK["Delete All"] --> CASC
    CASC --> EX["Anchor delete takes tags, pass states, QR blob, worldmap"]
    CASC --> WARN["Portal states the blast radius before confirming"]
    NOTE["Destructive actions are explicit routes - never side effects"] -.-> CASC
---
Per-row and bulk delete with correct cascades — deleting an anchor takes its tags,
pass states, QR blob and world map with it, and says so before it does. Destructive
actions are explicit, never side effects.
