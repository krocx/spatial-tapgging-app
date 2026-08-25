---
id: arworldmap-memory
name: ARWorldMap spatial memory
area: gemba
status: shipped
version: baseline
depends: []
terms: [ARWorldMap]
spec: APP-FEATURES.md
api: |
  POST /worldmap/upload — share ARWorldMap for an anchor (app · API key)
  GET /worldmap/:anchorId — download shared map for relocalization (app · API key)
wireframe: gemba
arch: |
  sequenceDiagram
    participant D as iOS device
    participant L as Local Documents/ cache
    participant S as SIB /worldmap
    Note over D: Author finishes a session
    D->>L: Save ARWorldMap locally
    D->>S: POST /worldmap/upload (anchor) or /worldmap/guide/:guideId/upload
    Note over D: Later session, any device
    D->>L: Try local map first
    alt local miss
      D->>S: GET /worldmap/:anchorId - download shared map
    end
    D->>D: ARKit relocalizes - fresh map only as last resort
    S-->>D: GET /worldmap/:anchorId/reference-photo - author viewpoint card
---
Apple's saved "memory of a space": the device recognises a previously-mapped area and
restores findings in their true positions without any marker. This is the persistence
layer under Gemba walks — and the relocalization fallback for every AR surface.
