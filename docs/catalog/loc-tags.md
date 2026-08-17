---
id: loc-tags
name: Markerless issue pinning (LocTags)
area: gemba
status: shipped
version: baseline
depends: [arworldmap-memory]
terms: [Gemba Walk, ARWorldMap]
spec: APP-FEATURES.md
wireframe: gemba
arch: |
  flowchart LR
    subgraph iOS
      TAP["Tap surface - raycast hit"] --> PIN["LocTag pinned in worldmap frame"]
      PIN --> FORM["Category + severity + photo (LocTagFormSheet)"]
    end
    subgraph SIB
      API["POST /loc-tags"] --> STORE[("loc-tags store")]
      WM["/worldmap - shared spatial memory"]
    end
    FORM --> API
    PIN -.positions live in.-> WM
    STORE --> NEXT["Next walk: relocalize, findings reappear; PATCH /loc-tags/:id closes them"]
---
Tap any surface to drop a finding — no QR, no preparation, no setup walk. Arriving at
a checkpoint opens the completion sheet minimized (AR stays visible and interactive
behind it) and it re-arms only after walking more than a metre away, so it never
traps the user in a bounce-back loop.
