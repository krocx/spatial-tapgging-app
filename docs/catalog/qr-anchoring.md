---
id: qr-anchoring
name: QR-anchored 6-DOF tracking
area: tags
status: shipped
version: baseline
depends: []
terms: [Anchor, QR Spatial Anchoring, 6-DOF]
spec: APP-FEATURES.md
wireframe: author
flow: |
  flowchart LR
    PRINT[Print QR at exact size] --> SCAN[Device scans QR]
    SCAN --> LOCK[AR frame locks to asset, gravity-normalised]
    LOCK --> CONTENT[Tags, guides, LOTO points appear in true positions]
---
A printed QR code establishes a six-degrees-of-freedom coordinate frame on the asset,
gravity-normalised so the scan angle never shifts tag positions. Cheap, robust, works
on day one in any environment — and it is the spatial root every other feature hangs
content from.
