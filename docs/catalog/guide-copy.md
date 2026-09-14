---
id: guide-copy
name: Copy guide · duplicate anchor · model slots
area: guides
status: shipped
version: 2026.4.45
depends: [guide-move, ghost-overlays, model-library]
terms: [AR Work Instructions, Anchor, CAD Import & Conversion]
spec: CONNECTED-WORKER.md#copy-guide-duplicate-anchor-model-slots
api: |
  POST /guides/:id/copy — clone a guide onto another anchor (or same, as "(copy)"); pins and training stay behind (app, portal · API key)
  POST /anchors/:id/duplicate — template copy: new id, QR and key; metadata, kit and guides copied (app, portal · API key)
  PATCH /guides/:id/steps/:stepId — models[] (max 3 slots), slot 1 mirrored to legacy modelId fields (app, portal, designer · API key)
wireframe: portal
arch: |
  flowchart LR
    G["guide on chamber A"] -->|"POST /guides/:id/copy"| G2["draft on chamber B<br/>steps · photos · branches · flags · model slots<br/>no pins, no training"]
    A["chamber A"] -->|"POST /anchors/:id/duplicate"| A2["chamber A copy<br/>new QR + key · kit · guides as drafts<br/>no map, tags, loc-tags, LOTO points"]
    S["GuideStep.models[] ≤ 3 slots"] -->|mirror| L["legacy modelId / scale / opacity"]
    S --> PS["Place Steps: adjust each slot · cube toggle · Copy models to…"]
---
Authoring once and rolling out many: copy a guide to another chamber (a draft
until re-placed — pins, placements and validation training belong to the source
map), or duplicate a whole chamber as a template (new QR, its own encryption key,
guides copied, nothing that describes the old physical location). A step now
holds up to three 3D model slots with their own scale, opacity and placement;
slot 1 mirrors into the legacy fields so older builds, imports, the compiler and
the portal keep working unchanged.
