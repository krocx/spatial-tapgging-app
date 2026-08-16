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
---
A shared library of AR-ready models: GLB/USDZ pass through natively, OBJ/FBX/STEP
convert via headless Blender where present, and GLB→USDZ runs in the browser
(Three.js USDZExporter) so the server needs no native toolchain. Models are assigned
per-anchor as kits or marked general, and an author-set real-world default scale
pre-fills every picker — used by guide ghosts and iLOTO point slots alike.
