---
id: loc-tags
name: Markerless findings (LocTags) — reference, photos, markup
area: gemba
status: shipped
version: 2026.4.46
depends: [arworldmap-memory, audit-library]
terms: [Gemba Walk, ARWorldMap, Focus Area, Finding Category]
spec: GEMBA-WALK.md
api: |
  POST /loc-tags — create a finding: questionCode (library) or customFocusArea + customQuestion (custom), category, risk, up to 6 captioned photos, walkId (app · API key)
  GET /loc-tags?anchorId= — findings for a space (app, portal · API key)
  PATCH /loc-tags/:id — category, risk, captions, status (app · API key)
  POST /loc-tags/:id/photos — append photos (app · API key)
  PUT /loc-tags/:id/photos/:file/markup — store the marked-up copy + PencilKit strokes; clear:true removes (app · API key)
  DELETE /loc-tags/:id/photos/:file — remove one photo (app · admin key)
  GET /loc-tags/image/:filename — photo, markup or .pkdrawing (app, portal · API key)
  DELETE /loc-tags/:id — remove finding (portal · admin key)
wireframe: gemba
arch: |
  flowchart LR
    subgraph iOS
      TAP["Tap surface - raycast hit"] --> PIN["LocTag pinned in worldmap frame"]
      PIN --> FORM["Focus Area → Question (or custom text)<br/>Strength / OFI / NC · risk 0-3 · 6 captioned photos · markup"]
      PIN --> PANEL["floating finding panel: pill ↔ card ↔ Open"]
    end
    subgraph SIB
      API["POST /loc-tags"] --> STORE[("loc-tags store")]
      WM["/worldmap - shared spatial memory"]
    end
    FORM --> API
    PIN -.positions live in.-> WM
    STORE --> NEXT["Next walk: relocalize, findings reappear; PATCH /loc-tags/:id closes them"]
---
Tap any surface to drop a finding — no QR, no preparation, no setup walk. The
finding is logged in Corporate Quality's vocabulary (Focus Area → Question, or a
custom free-text entry stored honestly as `custom`), with a Strength / OFI / NC
category, an optional risk rating, up to six captioned photos and PencilKit
markup whose strokes persist for re-editing. Every finding carries a floating
world-anchored panel (pill ↔ card) that never blocks the camera. Arriving at a
checkpoint opens the completion sheet minimized and it re-arms only after walking
more than a metre away.
