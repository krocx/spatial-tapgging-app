---
id: data-admin
name: Data administration
area: portal
status: shipped
version: baseline
depends: []
terms: [SIB]
spec: SERVER-REFERENCE.md
api: |
  DELETE /anchors/:id — cascade: tags, pass-states, blobs (portal · admin key)
  DELETE /sessions — clear session history (portal · admin key)
  DELETE /guide-sessions — clear guide run history (portal · admin key)
  DELETE /loc-tags/completions — clear Gemba completions (portal · admin key)
wireframe: portal
arch: |
  flowchart LR
    ROW["Per-row delete"] --> CASC["Server-side cascades in each route"]
    BULK["Delete All"] --> CASC
    CASC --> EX["Anchor delete takes tags, pass states, QR blob, worldmap"]
    CASC --> WARN["Portal states the blast radius before confirming"]
    NOTE["Destructive actions are explicit routes - never side effects"] -.-> CASC
---
Per-row and bulk delete with correct cascades, behind the pilot admin gate: with
SIB_ADMIN_KEY set, every DELETE (and the quiz editor) requires unlocking Admin
mode in the portal — the server refuses without X-Admin-Key, the UI hides the
buttons. Deleting an anchor takes its tags, pass states, QR blob and world map
with it, and says so before it does. Destructive
actions are explicit, never side effects.
