---
id: object-anchoring
name: Object anchoring - scan, origin, movable equipment
area: tags
status: beta
version: 2026.4.46
depends: [sealed-worldmap, model-library]
terms: [Object Anchoring, Anchor, ARWorldMap]
spec: CONNECTED-WORKER.md#object-anchoring-scan-origin-movable-equipment-shape-ghost
api: |
  POST /anchors/:id/object - store the .arobject scan (streamed, 30 MB cap); ?merge=1 adds a second device's scan (app · API key)
  GET /anchors/:id/object - reference object for the on-device cache (app · API key)
  GET /anchors/:id/object/meta - extent, points, sides, scannedOn, calibrations, shape model (app, portal · API key)
  PATCH /anchors/:id/object/meta - objectPoseInQR, shapeModelId / pose / scale (app · API key)
  DELETE /anchors/:id/object - remove the scan (app, portal · API key)
wireframe: author
arch: |
  flowchart LR
    SC["ObjectScanView<br/>≥600 pts · ≥3 of 6 sides"] -->|"POST /anchors/:id/object"| OBJ[(".arobject + meta<br/>objectPoseInQR · shapeModel*")]
    OBJ --> DET["ARSessionManager detectionObjects → object pose"]
    DET --> GATE["QR gate frame priority<br/>object › sealed map › live QR"]
    DET --> RB["Place Steps / guide: setWorldOrigin onto map frame<br/>via objectPoseInMap"]
    DET --> WD["watchdog: chamber moved → re-align · Undo<br/>tracking pill · timed finder"]
    DET --> GH["shape model ghost ~6 s at every recognition"]
---
A chamber can be found by its shape: an author scans it into an ARKit reference
object on the iPad, a first QR scan that also sees the object stores the
calibration, and from then on the object supplies the frame - tags stay
QR-relative and pins map-relative underneath, so nothing about the data model
changed. Movable equipment is handled by a watchdog that re-aligns with an Undo
toast, a second iPhone can improve a scan by merging into the original frame,
and an optional shape model flashes as a ghost so a glance confirms where the
app thinks the chamber is.
