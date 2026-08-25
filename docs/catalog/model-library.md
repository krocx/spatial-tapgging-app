---
id: model-library
name: 3D asset library
area: guides
status: shipped
version: baseline
depends: []
terms: [CAD Import & Conversion, GLB / USDZ]
spec: ../README.md#3d-model-library
wireframe: portal
arch: |
  flowchart LR
    subgraph Portal["Portal (browser)"]
      UP["Upload model"] --> FMT{"Format?"}
      FMT -->|USDZ| PASS["Store as-is - usdzStatus: ready"]
      FMT -->|GLB| CONV["In-browser GLB to USDZ: Three.js GLTFLoader + USDZExporter"]
      FMT -->|OBJ / FBX / STEP| BL["Headless Blender convert to GLB (where present)"]
      BL --> CONV
      CONV -->|"auto-upload PUT /models/:id/file.usdz"| ST
    end
    subgraph SIB["SIB routes/models.ts"]
      PASS --> ST[("Model store: file.glb + file.usdz + usdzStatus")]
      KIT["POST /models/:id/kit - assign to anchor kit, or mark general"]
    end
    subgraph iOS["iOS (SIBClient)"]
      LIST["GET /models?anchorId= - anchor kit + all 'general' models"] --> DL["GET /models/:id/file.usdz preferred, file.glb fallback - cached on device"]
      DL --> SCN["SceneKit node at author defaultScale"]
    end
    ST --> DL
    ST -."GET /models/:id - usdzStatus gates Preview".-> DL
---
A shared library of AR-ready models: GLB/USDZ pass through natively, OBJ/FBX/STEP
convert via headless Blender where present, and GLB→USDZ runs in the browser
(Three.js r169 USDZExporter, vendored locally with CDN fallback) so the server
needs no native toolchain. Models are assigned
per-anchor as kits or marked general, and an author-set real-world default scale
pre-fills every picker — used by guide ghosts and iLOTO point slots alike.
