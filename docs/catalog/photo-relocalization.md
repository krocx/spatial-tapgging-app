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
  GET /worldmap/:anchorId/reference-photo - author viewpoint card (app · API key)
  GET /worldmap/guide/:guideId/photo - guide re-localization photo (app · API key)
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
reference card - stand roughly here, look roughly there - with an explicit "I'm here"
override for when the space has changed too much to match automatically.

**Demo placement (2026.4.46).** When the operator is not at the equipment at
all - a team in another site reviewing a guide authored elsewhere - the same
card offers "Not at the equipment? Place a demo copy here". The focus ring
shows the surface; one tap puts the whole authored scene there (pins, panels,
ghosts, the assembly), moved rigidly and turned to face the operator. Nothing
is written back: positions are untouched, presence and the drift check stay
off, and the session record carries `placement:demo` so the portal shows it
as a demo, never a real walk.
