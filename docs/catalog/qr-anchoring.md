---
id: qr-anchoring
name: QR-anchored 6-DOF tracking
area: tags
status: shipped
version: baseline
depends: []
terms: [Anchor, QR Spatial Anchoring, 6-DOF]
spec: APP-FEATURES.md
api: |
  POST /anchors — create anchor, returns id + encryption key for the QR (app, portal · API key)
  GET /anchors/:id — resolve a scanned QR to its anchor (app · API key)
  GET /anchors/:id/qrimage — server-rendered QR PNG (portal · API key)
  GET /anchors/:id/qrprint — print-exact A4 QR page (portal · API key)
wireframe: author
flow: |
  flowchart LR
    PRINT[Print QR at exact size] --> SCAN[Device scans QR]
    SCAN --> LOCK[AR frame locks to asset, gravity-normalised]
    LOCK --> CONTENT[Tags, guides, LOTO points appear in true positions]
arch: |
  flowchart LR
    subgraph iOS["iOS app"]
      CAM["ARKit camera frame"] --> DET["Vision QR detection"]
      DET --> SZ["Scale from anchor.qrSizeCm - printed size is ground truth"]
      SZ --> GRAV["Gravity-normalise orientation"]
      GRAV --> ORIGIN["Session origin = QR pose"]
    end
    subgraph SIB
      A["GET /anchors/:id"] --> QRC["qrSizeCm + encryption key ref"]
    end
    ORIGIN --> CONTENT["All content positioned relative to origin: tags, steps, LOTO points"]
    QRC -.exact print size.-> SZ
---
A printed QR code establishes a six-degrees-of-freedom coordinate frame on the asset,
gravity-normalised so the scan angle never shifts tag positions. Cheap, robust, works
on day one in any environment — and it is the spatial root every other feature hangs
content from.
