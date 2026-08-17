---
id: model-library
name: 3D asset library
area: guides
status: shipped
version: baseline
depends: []
terms: [CAD Import & Conversion, GLB / USDZ]
spec: ../README.md
wireframe: portal
arch: |
  flowchart LR
    subgraph Portal
      UP["Upload model"] --> FMT{"Format?"}
      FMT -->|GLB / USDZ| PASS["Store as-is"]
      FMT -->|OBJ / FBX / STEP| BL["Headless Blender convert (where present)"]
      GLB2["Three.js USDZExporter in browser"] -->|"PUT /models/:id/file.usdz"| ST
    end
    subgraph SIB["SIB routes/models.ts"]
      PASS --> ST[("Model store + usdzStatus")]
      BL --> ST
      KIT["POST /models/:id/kit - assign to anchor, or mark general"]
    end
    subgraph iOS
      DL["GET /models/:id/file.usdz (preferred) or file.glb"] --> SCN["SceneKit node at defaultScale"]
    end
    ST --> DL
---
A shared library of AR-ready models: GLB/USDZ pass through natively, OBJ/FBX/STEP
convert via headless Blender where present, and GLB→USDZ runs in the browser
(Three.js USDZExporter) so the server needs no native toolchain. Models are assigned
per-anchor as kits or marked general, and an author-set real-world default scale
pre-fills every picker — used by guide ghosts and iLOTO point slots alike.
