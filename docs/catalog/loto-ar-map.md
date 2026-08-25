---
id: loto-ar-map
name: AR LOTO map
area: iloto
status: shipped
version: 2026.4.42
depends: [iloto-anchors, loto-event-log]
terms: [LOTO, Energy Isolation Point]
spec: ILOTO.md
api: |
  POST /loto/map — save isolation sequence map (app · API key)
  GET /loto/map?anchorId= — load map with live point status (app · API key)
  DELETE /loto/map?anchorId= — remove map (portal · admin key)
wireframe: iloto
arch: |
  flowchart LR
    DRAW["Tap vertices along the conduit in AR (mapEdit mode)"] --> STK["Strokes - start on a Safe Off marker links fedByPointId"]
    STK --> SAVE["POST /loto/map - versioned, history kept"]
    SAVE --> MAP[("LotoMap store")]
    MAP --> REN["renderFlowMap in LotoARSessionView"]
    DER["derivePointStatus per linked breaker"] --> REN
    REN -->|energized| TEAL["Teal pulse animation"]
    REN -->|locked out| GREY["Grey, pulse-free - live status in the lines"]
---
The panel's electricity flow drawn in AR by tapping vertices along the conduit;
starting a line on a Safe Off marker links it to that breaker, making the map
status-aware — lock the breaker out and its lines go grey and pulse-free live,
restore it and the teal flow pulse returns. Saves are versioned with history.
