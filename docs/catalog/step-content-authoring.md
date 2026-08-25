---
id: step-content-authoring
name: Step content authoring on canvas
area: designer
status: shipped
version: 2026.4.42
depends: [procedure-maps, model-library]
terms: [AR Work Instructions]
spec: PROCEDURE-DESIGNER.md
api: |
  POST /mindmap/step-images — upload per-step image (designer · API key)
  GET /mindmap/step-images/:filename — serve step image (designer, app · API key)
wireframe: procdes
arch: |
  flowchart LR
    INSP["Inspector procedure section on a canvas node"] --> F["voice, optional toggle, image, model + scale"]
    F --> IMGUP["POST /mindmap/step-images - content-addressed designer store"]
    F --> SAVE["POST /mindmap/save - sanitizers preserve the fields"]
    SAVE --> COMP["procedure/compiler.ts carries content into steps"]
    COMP --> ING["Ingest copies images into the guide at export"]
    BLUR["Fields commit on blur AND unmount - Saved tick"] -.-> SAVE
---
Voice script, optional-step toggle, reference images (content-addressed designer
store, copied into the guide at export) and 3D model assignment with scale — all
authored on the canvas node and compiled into the guide. Fields commit on blur AND
on unmount with a Saved ✓ tick, so clicking away never loses an edit.
