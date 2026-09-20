---
id: guide-bundle
name: Guide Bundle (engine-neutral guide contract)
area: guides
status: shipped
version: 2026.4.46
depends: [guide-lifecycle, model-library, cortona3d-import, step-validation]
terms: [Assembly Model, Anchor]
spec: ar-ojt/UNITY-RUNTIME.md
api: |
  GET /guides/:id/bundle — guide + ordered steps + model manifest (GLB URLs) + anchor frames + validation refs + playback conventions, one JSON (any client · same visibility as GET /guides/:id)
  GET /catalog/schema/:name — JSON Schema by name, e.g. guide-bundle (any client · public)
wireframe: portal
arch: |
  flowchart LR
    C["Any client<br/>iOS · Unity · WebXR · portal"] -->|GET /guides/:id/bundle| S["guides/bundle.ts<br/>buildGuideBundle()"]
    S --> G["guide + steps"]
    S --> M["models → /models/:id/file.glb"]
    S --> F["anchor frames: QR (marker size, anchorPose)<br/>sealed world map · guide world map · object scan"]
    S --> V["validation refs + verdict URLs"]
    S --> P["playback conventions<br/>m · Y-up · right-handed · axis-angle · xyzw · cumulative timeline"]
    J["docs/schema/guide-bundle.schema.json"] -. checked by guide-bundle.test .-> S
---
One versioned JSON document (`schema: sib.guide-bundle/1`) that carries
everything a client needs to run a guide, whatever renders it: the guide and
its ordered steps (with the `nodes[]` timeline deltas, `view`, `cadPosition`
and branch fields), a model manifest with GLB/USDZ URLs, the anchor and every
frame it offers (printed QR with marker size and sealed pose, anchor world map,
guide world map with reference camera pose, scanned object with calibration),
the validation references and verdict endpoints per step, and the playback
conventions spelled out (metres, Y-up, right-handed, axis-angle radians,
xyzw quaternions, column-major matrices, cumulative last-write-wins timeline).
A JSON Schema pins the shape and a test builds a bundle and checks it against
the schema, so the contract cannot drift from the server. Unity, WebXR and
native clients integrate against this one endpoint instead of stitching five.
