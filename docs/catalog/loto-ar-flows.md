---
id: loto-ar-flows
name: AR authoring + apply/remove flows
area: iloto
status: shipped
version: 2026.4.42
depends: [iloto-anchors, loto-event-log, loto-training]
terms: [LOTO, Try Test, ARWorldMap]
spec: ILOTO.md
api: |
  POST /loto/events — apply / remove / override with checklist + photo (app · API key)
  GET /loto/status?anchorId= — derived per-point lock state (app, portal · API key)
wireframe: iloto
arch: |
  sequenceDiagram
    participant U as User (iOS)
    participant G as LotoARGateFlow -> QRScanGateView
    participant W as Worldmap (local -> SIB -> fresh)
    participant E as POST /loto/events
    U->>G: Every iLOTO AR surface starts here - no exceptions
    G->>G: Panel QR scan locks the session origin
    G->>W: Relocalize markers into position
    U->>E: Ordered checklist flow - notify, shutdown, lock, photo, try test, serial
    E-->>U: 4xx rule violations surface verbatim
    Note over G: Author exit re-saves the worldmap for the next session
---
Every iLOTO AR surface starts with the mandatory panel-QR scan (origin lock, then
worldmap relocalization) — the scan at the panel IS the you-are-here confirmation.
Authors tap breakers and switches to place points; operators run ordered apply
checklists (notify → shutdown → lock → photo → try test → serial) and remove
checklists, with the override form behind an explicit second decision and server 4xx
messages surfaced verbatim.
