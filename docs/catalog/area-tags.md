---
id: tags
kind: area
name: Spatial Inspection
color: "#3b82f6"
order: 1
wireframe: author
flow: |
  flowchart LR
    QR[Scan printed QR] --> ANCH[Anchor locks AR frame: sealed map · object · live QR]
    ANCH --> TAG[Author places typed tags · colleagues visible]
    TAG --> TRAIN[Multi-angle reference capture]
    TRAIN --> VAL[Operator batch validation]
    VAL --> SCORE[Patch-grid scoring + confidence]
    SCORE --> SESS[Session report + evidence in portal]
---
The original core of the platform: printed QR codes lock an AR coordinate frame to a
physical asset, authors pin typed inspection checkpoints in 3D space, and operators
validate everything on the anchor with one capture. The author's sealed world map
(or the chamber's scanned shape) is the origin and the QR the key; reference imagery
is trained in-app by the people who know the part and encrypted at source.
