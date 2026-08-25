---
id: iloto-anchors
name: iLOTO anchors + hub
area: iloto
status: shipped
version: 2026.4.42
depends: [qr-anchoring, arworldmap-memory]
terms: [LOTO, Energy Isolation Point, Anchor]
spec: ILOTO.md
api: |
  POST /loto/points — create isolation point with AR placement (app · API key)
  GET /loto/points?anchorId= — points for an anchor (app, portal · API key)
  PATCH /loto/points/:id — edit point / assign 3D asset slots (app · API key)
  DELETE /loto/points/:id — remove point (portal · admin key)
wireframe: iloto
arch: |
  flowchart LR
    CR["Anchor created with type LOTO - one per control panel"] --> AN[("Anchor store: QR + qrSizeCm + worldmap")]
    AN --> HUB["ILOTOHubView - six tiles"]
    HUB --> ST["GET /loto/status - live banner per panel"]
    HUB --> GATE["Certification gate: apply/remove tiles locked without valid cert"]
    AN --> PTS["POST /loto/points - authored on breakers and switches"]
---
A 'LOTO' anchor type — one per control panel, full QR + worldmap flow — and an iOS
hub with a live status banner, six tiles and the certification gate. Yellow Safe Off
points go on breakers (out-of-service, no try test); red LOTO points go on switches
(personal lockout, full six-step procedure).
