---
id: dynamics-guides-import
name: Dynamics 365 Guides import (.guide package)
area: guides
status: shipped
version: 2026.4.50
depends: [guide-import, guide-ingestion, model-library, cortona3d-import]
terms: [Instruction Import, Assembly Model]
spec: DYNAMICS-GUIDES-IMPORT.md
api: |
  POST /guides/import/dynamics - a Microsoft Dynamics 365 Guides `.guide` export (flat tar) → 202 job; read in a worker, one at a time; ?mode=ask|update|new as for Cortona; ?flipZ=0 keeps Unity's frame (diagnosis) (portal · API key)
  GET /guides/import/jobs/:id - poll the import: queued | processing | done (guide, steps, model or null, report, report text) | failed (portal · API key)
  POST /guides/import/jobs/:id/apply - { mode: update | new } finishes an import that stopped on an existing guide (portal · API key)
  POST /guides/import/jobs/:id/discard - the caller cancelled; drops the parsed guide and the assembly it registered (portal · API key)
  POST /guides/import - { sourceType: 'dynamics', payload: { packageBase64 } } the text path: steps and branches only, no 3D, no pictures (any · API key)
  GET /guides/:id/import-log - the content-free report kept for the guide, with the source guide GUID and every asset's version (portal · API key)
wireframe: portal
arch: |
  sequenceDiagram
    participant P as Portal (Import modal, .guide)
    participant S as SIB POST /guides/import/dynamics
    participant W as import/worker (one at a time)
    participant T as dynamics/tar.ts
    participant B as dynamics/body.ts (OData)
    participant G as dynamics/glb-merge.ts
    participant M as Model3D store
    participant I as guides/ingest.ts
    P->>S: raw .guide (X-Filename)
    S->>W: buffer transferred, job id answered (202)
    W->>T: flat POSIX tar -> entries (paths, links, oversize refused)
    T->>B: Guide_Manifest, Guide_Body, Metadata_<guid>
    B-->>W: tasks/steps ordered by previous-links, responses, placements, attention
    W->>G: every placed object -> node pl:<guid> of ONE GLB (Unity LH -> RH)
    G-->>W: merged GLB + bounds, step images out of the package
    W-->>S: ImportedGuide (sections, branches, nodes[], cadPosition) + report
    S->>M: registerGeneratedGlb (the assembly - placed once at the QR by the author)
    S->>I: applyImportedGuide, then step images beside their steps
    S-->>P: guide + model + content-free report (counts and GUIDs only)
---
Imports a guide exported from Microsoft Dynamics 365 Guides (the `.guide`
file "Export guide" writes - retired by Microsoft at the end of 2026) into
the Guide Library as a draft, through the same path a Cortona3D publication
takes: one job at a time in a worker, poll, then update-or-new when a guide
with that name already exists.

What comes across: tasks become sections; every step keeps its text and its
picture; a question step's responses become the step's success / failure
branches (the response texts stay in the step as a numbered list, since SIB
has no response buttons; a third acting response is noted); the completion
step becomes the last step with evidence required. Every placed 3D object -
the author's own models and the stock holograms alike - becomes a node of one
merged assembly model in the Guides anchor frame, so the author places the
assembly once at the SIB QR and each step then shows, hides, ghosts (X-ray)
or colours its objects exactly as Guides did; the attention director's
position (or the shown objects' centroid) becomes the step's position in the
assembly. Coordinates are converted from Unity's left-handed frame behind one
flag. Guides concepts SIB has no place for - triggers, interactables, anchor
objects, animation takes and speeds, videos and audio, the folder tree - are
listed as "not represented" in the report rather than imported half-way.

The report is content-free (counts, option-set labels and GUIDs; never
instruction text, asset names or URLs) and is kept with the guide together
with the source guide's GUID and every asset's version, for a later re-import
check. `npm run guide:inspect -- file.guide --tree` dry-runs a package from a
terminal and writes nothing. No real guides were used to build this: the
whole suite runs on synthetic packages (`--make-sample` writes one).
