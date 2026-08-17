---
id: map-export-import
name: Export / import + whiteboard photos
area: designer
status: shipped
version: baseline
depends: [roadmap-collab]
terms: [VLM]
spec: roadmap-mindmapper.md
arch: |
  flowchart LR
    MAP["Canvas map"] --> PNGSVG["PNG / SVG export - rendered client-side"]
    MAP --> JSON["JSON export via POST /mindmap/export - cross-server import"]
    WB["Whiteboard photo"] --> OLL["POST /mindmap/import-image - local Ollama vision model"]
    OLL --> DRAFT["Editable draft map - nothing leaves the network"]
    SIB2["POST /mindmap/:id/import-sib - SIB ontology in/out"] --> MAP
---
PNG, SVG and JSON export; cross-server JSON import; SIB ontology import/export. A
local vision model (Ollama) can also turn a whiteboard photo into an editable draft
map — the sketch from the meeting becomes the plan without retyping.
