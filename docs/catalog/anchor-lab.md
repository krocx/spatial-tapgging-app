---
id: anchor-lab
name: Anchor trust layer & Anchor Lab
area: tags
status: beta
version: 2026.4.46
depends: [sealed-worldmap, qr-anchoring]
terms: [Anchor, ARWorldMap]
spec: CONNECTED-WORKER.md#anchor-trust-layer-anchor-lab-measured-accuracy
api: |
  POST /anchors — anchorType LAB creates a lab rig (Lab door only) (app · API key)
  POST /anchors/:id/accuracy — one measured mark (rendered-vs-physical mm + lock report + runType) (app · API key)
  GET /anchors/:id/accuracy — samples + summary by device / origin / run (portal · API key)
  DELETE /anchors/:id/accuracy — clear the lab record, marks and runs (portal · API key)
  POST /anchors/:id/accuracy/runs — one run record, Start → Done (median, times, map growth, ghost) (app · API key)
  PUT /anchors/:id/worldmap/photo — the reference photo where the map was sealed (Lab ghost) (app · API key)
wireframe: operator
arch: |
  flowchart LR
    SEAL["Author seals: ARAnchor sib-origin<br/>planted inside the world map"] --> MAP[("sealed .worldmap")]
    MAP --> RELOC["Operator relocalizes<br/>ARKit restores + refines sib-origin"]
    RELOC --> GATE["convergence gate<br/>still 1.5 s → locked · 8 s → approximate"]
    GATE --> TAGS["tags spawn on the settled frame<br/>and follow later refinements"]
    QR["live QR"] -.witness.-> GATE
    GATE --> LAB["Anchor Lab door · rigs<br/>Map only | QR + map runs · mark truth"]
    LAB -->|"POST /anchors/:id/accuracy · /runs"| ACC[("accuracy/{anchor}.jsonl + .runs.jsonl")]
    LAB -->|"clean run → map saved back"| MAP
    ACC --> PORTAL["portal: Lab badge + chart<br/>by device · origin · run"]
---
Anchoring you can trust because it is measured. The origin travels inside the
sealed world map as an ARKit anchor that keeps improving after relocalization,
tags wait for it to settle before they appear, and the live QR's disagreement is
always visible. Anchor Lab turns "it looks a bit off" into millimetres: a tester
marks where each tag's feature really is and the portal charts the error per
device, origin source, run and run type, so the home rig and the cleanroom
compare on the same number. The Lab door (entitlement `lab`) gives that team its
own rigs, runs and history without touching a production chamber. Every run is
a record (median, relocalize/converge, corrections, map growth, ghost use), a
clean run grows the rig's map, and a ghost photo helps a tester stand where
the map was made — all measured in the Lab before production gets any of it.
