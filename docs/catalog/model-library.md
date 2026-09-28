---
id: model-library
name: 3D asset library
area: guides
status: shipped
version: baseline
depends: []
terms: [CAD Import & Conversion, GLB / USDZ]
spec: ../README.md#3d-model-library
api: |
  GET /models?anchorId= - anchor kit + all general models (app, portal · API key)
  GET /models/:id - metadata incl. usdzStatus (app, portal · API key)
  GET /models/:id/file.usdz - USDZ binary, preferred on device (app · API key)
  GET /models/:id/file.glb?budget=N - GLB; with a triangle budget, the smallest server-built variant at or above it, else the full model; X-SIB-Model-Variant / X-SIB-Model-Triangles headers (app, portal · API key)
  POST /models/:id/variants - (re)build the reduced copies in the job worker; poll GET /models/jobs/:id (portal · Engineer+)
  POST /models - upload GLB/USDZ/OBJ/FBX/STEP (portal · API key)
  PUT /models/:id/file.usdz - browser converter write-back (portal · API key)
  PATCH /models/:id - rename / default scale / category (portal · API key)
  POST /models/:id/kit - assign to / remove from an anchor kit (portal · API key)
  DELETE /models/:id - remove model + files (portal · admin key)
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
pre-fills every picker - used by guide ghosts and iLOTO point slots alike.

**Reduced copies (2026.4.46).** Every imported assembly gets a ladder of
reduced GLBs built once on the server (2.5 M / 1.2 M / 700 k / 350 k
triangles, only the steps below the source) by the same vertex clustering
the device used to run itself. A device asks `?budget=` for what it can
draw and downloads a file that already fits - the Bee drone is 6.9 MB at
700 k instead of 23 MB, and the census and reduction on the device are
skipped. The Models page shows the variants and their sizes on each card
with a rebuild button; variants are deleted with the model. Full detail:
docs/ar-ojt/MODEL-VARIANTS.md.
