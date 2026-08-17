---
id: ghost-overlays
name: 3D ghost overlays per step
area: guides
status: shipped
version: baseline
depends: [spatial-steps, model-library]
terms: [CAD Import & Conversion, GLB / USDZ]
spec: ../README.md
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
pan/pinch/rotate gesture kit. Canvas owns model assignment; the device owns AR
placement.
