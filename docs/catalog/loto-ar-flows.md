---
id: loto-ar-flows
name: AR authoring + apply/remove flows
area: iloto
status: shipped
version: 2026.4.42
depends: [iloto-anchors, loto-event-log, loto-training]
terms: [LOTO, Try Test, ARWorldMap]
spec: ILOTO.md
wireframe: iloto
---
Every iLOTO AR surface starts with the mandatory panel-QR scan (origin lock, then
worldmap relocalization) — the scan at the panel IS the you-are-here confirmation.
Authors tap breakers and switches to place points; operators run ordered apply
checklists (notify → shutdown → lock → photo → try test → serial) and remove
checklists, with the override form behind an explicit second decision and server 4xx
messages surfaced verbatim.
