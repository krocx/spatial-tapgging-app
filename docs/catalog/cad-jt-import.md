---
id: cad-jt-import
name: CAD (.JT) model import
area: guides
status: planned
version: baseline
depends: [model-library, guide-import]
terms: [SIB]
spec: ../README.md#3d-model-library
arch: |
  flowchart LR
    JT[".JT from the CAD system"] -.planned.-> C["convert to GLB with named parts"]
    C --> M["model library: variants · colours · part labels"]
    J["JSON work instructions"] --> S["each step attached to a part of the model"]
    NOTE["ETCH ESC: the non-3D-OMS path"] -.-> C
---
The non-3D-OMS path for content that has no publication: import the CAD
model as .JT, convert it to the model library's GLB with named parts, and
attach JSON work instructions to its parts step by step. Planned; ETCH ESC
POC-1 is where it starts.
