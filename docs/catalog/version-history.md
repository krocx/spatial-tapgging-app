---
id: version-history
name: Version history + draft/publish
area: designer
status: shipped
version: baseline
depends: [roadmap-collab]
terms: []
spec: roadmap-mindmapper.md
api: |
  GET /mindmap/:id/versions — saved versions of a map (designer · API key)
  POST /mindmap/:id/restore/:versionId — restore a version (designer · API key)
arch: |
  sequenceDiagram
    participant U as User
    participant V as GET /mindmap/:id/versions
    participant R as POST /mindmap/:id/restore/:versionId
    participant W as Collab auto-snapshot
    W->>W: Snapshots taken during live sessions
    U->>V: Browse history
    U->>R: One-click restore - current state becomes a version too
    Note over R: Draft/publish via POST /mindmap/:id/publish + /unpublish (draft keys, pre-RBAC)
---
Snapshots with one-click restore, auto-snapshotted during collaboration, plus a
per-map draft→publish workflow (draft keys, pre-RBAC). Edits are cheap because
undo is structural, not heroic.
