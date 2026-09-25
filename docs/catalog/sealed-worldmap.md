---
id: sealed-worldmap
name: Sealed world maps (one localization doctrine)
area: tags
status: shipped
version: 2026.4.46
depends: [arworldmap-memory, qr-anchoring]
terms: [ARWorldMap, Anchor, QR Spatial Anchoring]
spec: CONNECTED-WORKER.md#sealed-world-maps-one-localization-doctrine
api: |
  POST /anchors/:id/worldmap/meta - seal: gravity-normalised QR pose in the map frame (app · API key)
  GET /anchors/:id/worldmap/meta - sealed pose + capturedAt for the shared loader (app · API key)
  DELETE /anchors/:id/worldmap - unseal: remove map + meta (app, portal · API key)
  DELETE /worldmap/guide/:guideId - reset a guide's map, photo, meta; un-place its steps (app, portal · API key)
  PATCH /worldmap/guide/:guideId/meta - capturedAt, referenceCameraPose, objectPoseInMap (app · API key)
wireframe: author
arch: |
  flowchart LR
    AU["Author scans QR"] -->|"map + QR pose in map frame"| M[("worldmap + .anchorpose.json")]
    OP["Operator scans QR"] --> R["relocalize into sealed map"]
    R -->|"tags from the author's pose"| T["anchor_rel tags exact"]
    R -->|"live QR vs sealed > 5 cm / 10°"| D["QR moved? Using the sealed map"]
    R -->|timeout| F["live QR pose · reduced accuracy note"]
    WC["iOS WorldMapCache<br/>meta first · reuse by capturedAt · offline cache"] --> R
---
The author's world map is the origin; the QR is the key and a drift check. An
author seals the map with the QR pose in that map's frame; operators relocalize
into it and place tags from the author's pose, with the live QR only compared
against it. Operator scans no longer overwrite the author's map, unsealed anchors
behave exactly as before until an author scans them, and one shared loader
serves the QR gate, guide sessions and model placement - meta first, local copy
reused, offline degrades to the cache.
