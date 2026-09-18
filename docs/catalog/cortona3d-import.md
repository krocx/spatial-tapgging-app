---
id: cortona3d-import
name: Cortona3D RapidManual import (VRML97 + PROTOs)
area: guides
status: shipped
version: 2026.4.46
depends: [guide-import, guide-ingestion, model-library]
terms: [Instruction Import, Assembly Model]
spec: ar-ojt/CORTONA3D-IMPORT.md
api: |
  POST /guides/import/cortona — published RapidManual .htm (or bundle ZIP) → draft guide + assembly GLB (portal · API key)
  PATCH /guides/:id — { assemblyPose } places the whole assembly once; null clears it (iOS · portal · API key)
  PATCH /chamber-configs/:id — { defaultAssemblyPose } shared placement for every chamber of a configuration (portal · Engineer+)
wireframe: portal
arch: |
  sequenceDiagram
    participant P as Portal (Import modal, .htm)
    participant S as SIB POST /guides/import/cortona
    participant B as import/cortona/bundle.ts
    participant V as vrml.ts (PROTOs kept)
    participant Pr as procedure.ts + widgets.ts
    participant G as glb.ts
    participant M as Model3D store
    participant I as guides/ingest.ts
    P->>S: raw .htm (X-Filename, strict?)
    S->>B: solo+zip script block -> ZIP -> gunzip (magic bytes)
    B->>V: merged VRML97 scene
    V->>Pr: Procedure/Step/SubStep + Set_* commands + ROUTEs
    Pr-->>S: per-SubStep nodes[] show/ghost/insert, view, callout text
    S->>S: interactivity Procedure/Item -> one step per work item (sub-step deltas merged)
    V->>G: ObjectVM/Transform graph + IndexedFaceSet -> GLB (cmp:<DEF> nodes, extras)
    G->>M: registerGeneratedGlb (USDZ pending -> portal converts)
    S->>I: applyImportedGuide (assembly slot on every step)
    S-->>P: guide + model + content-free import log
---
Imports a published Cortona3D RapidManual procedure (the single-file `.htm`)
directly into the Guide Library. The importer reads the embedded scene bundle
with our own VRML97 parser — one that keeps PROTO declarations and instances,
because Cortona expresses the entire procedure (steps, substeps, show/hide,
motion, camera) as proprietary PROTOs wired by ROUTEs that every stock loader
drops silently. Output: a draft guide with one step per document work item (`<Procedure>/<Item>`
in `interactivity.xml`; its animation sub-steps' deltas merged; SubStep
fallback when there is no Procedure tree; set-up steps dropped), titles and
body text from the document, callout text folded in, an assembly GLB
whose node names address parts (`cmp:<DEF>`, with part numbers from the BOM in
`extras`), and per-step `nodes[]` presentation deltas (hidden / ghost /
insert / move / colour) plus a suggested view. Unrecognised PROTO types are
listed in the content-free import log; strict mode refuses them. First
consumer of the CAD-driven content model in `docs/ar-ojt/CAD-CONTENT.md`.
