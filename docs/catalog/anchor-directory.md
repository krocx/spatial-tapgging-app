---
id: anchor-directory
name: Anchor directory + print-exact QR
area: portal
status: shipped
version: baseline
depends: [qr-anchoring]
terms: [Anchor, QR Spatial Anchoring]
spec: SERVER-REFERENCE.md
api: |
  GET /anchors — full directory with CSV export source (portal · API key)
  GET /anchors/:id/readiness — trained / placed / world-map summary (portal · API key)
  POST /anchors — create anchor with auto-generated key (portal · API key)
wireframe: portal
arch: |
  flowchart LR
    P["Portal Anchors tab"] --> CRUD["POST / GET / DELETE /anchors"]
    CRUD --> KEY["Encryption key auto-generated for portal-created anchors"]
    P --> QR["QR preview + GET /anchors/:id/qrprint - A4 page at TRUE physical size (qrSizeCm)"]
    QR --> TRUST["Printed size is what 6-DOF tracking trusts"]
    DEL["Delete cascades: tags, pass states, QR blob, worldmap"] --> CRUD
---
Anchors are created and managed in the browser, and the QR PDF prints at true
physical size — which matters, because the printed size is what the 6-DOF tracking
trusts. Encryption keys are auto-generated for portal-created anchors.
