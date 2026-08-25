---
id: photo-relocalization
name: Photo-guided re-localization
area: gemba
status: shipped
version: baseline
depends: [arworldmap-memory]
terms: [ARWorldMap]
spec: APP-FEATURES.md
api: |
  GET /worldmap/:anchorId/reference-photo — author viewpoint card (app · API key)
  GET /worldmap/guide/:guideId/photo — guide re-localization photo (app · API key)
wireframe: gemba
arch: |
  sequenceDiagram
    participant D as iOS (LocTagOperatorView)
    participant S as GET /worldmap/:anchorId/reference-photo
    D->>D: ARWorldMap relocalization starts
    alt not matched within 20s
      D->>S: Fetch author viewpoint photo
      S-->>D: Reference card - stand here, look there
      D->>D: User taps "I'm Here" - manual override anchors the session
    end
    D->>D: Findings restore at their saved positions
---
When relocalization needs help, the author's original viewpoint is shown as a
reference card — stand roughly here, look roughly there — with an explicit "I'm here"
override for when the space has changed too much to match automatically.
