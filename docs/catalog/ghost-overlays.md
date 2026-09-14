---
id: ghost-overlays
name: 3D ghost overlays per step
area: guides
status: shipped
version: 2026.4.45
depends: [spatial-steps, model-library]
terms: [CAD Import & Conversion, GLB / USDZ]
spec: ../README.md#3d-model-library
api: |
  GET /models/:id/file.usdz — overlay model, preferred format (app · API key)
  GET /models/:id/file.glb — overlay model fallback (app · API key)
wireframe: arguides
arch: |
  flowchart LR
    CANVAS["Model assigned to step - canvas/portal owns WHICH model"] --> STEP["GuideStep.modelId + defaultScale"]
    STEP --> DL["iOS downloads USDZ via SIBClient"]
    DL --> NODE["Translucent SCNNode at step position"]
    NODE --> ADJ["Author gestures: H/V pan, pinch scale, Y-rotate"]
    ADJ --> OFF["modelOffsets + rotation PATCHed to the step - device owns WHERE"]
    STEP -.model changed?.-> RESET["Server clears stale placement - a shape's placement dies with the shape"]
---
A translucent 3D model rendered at a step — "the part goes here, like this" — with
author-set scale, opacity, offset and Y-rotation, adjusted in AR with the shared
pan/pinch/rotate gesture kit and a live opacity slider (also quick-adjustable in
the Guide Library). A step holds up to three model slots (see guide-copy). Canvas
owns model assignment; the device owns AR placement.
